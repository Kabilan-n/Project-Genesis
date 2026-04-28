import { execute, queryOne } from '../db.js';
import type { Agent, Conversation, TradeRecord, RelationshipDelta } from '../types.js';

type RelType =
  | 'stranger' | 'acquaintance' | 'friend' | 'close_friend'
  | 'romantic_partner' | 'rival' | 'enemy' | 'family' | 'widowed';

// Romantic-partner thresholds. Lowered interaction_count from prior implicit
// (>=10 by close_friend dominance) to >=4 so the state is reachable.
const ROMANCE_TRUST_FLOOR     = 80;
const ROMANCE_AFFECTION_FLOOR = 85;
const ROMANCE_INTERACTIONS    = 4;

// Post-pairing transitions.
const ROMANCE_FADE_TRUST      = 50; // partner stays until trust dips below this
const BREAKUP_AFFECTION_FLOOR = 30; // affection collapse triggers breakup
const BREAKUP_TO_ENEMY_FEAR   = 50; // breakup-to-enemy if fear exceeds this

/**
 * Manages relationship score evolution and type upgrades.
 * Called after conversations and trades to apply deltas.
 */
export class RelationshipEngine {

  /** Apply relationship changes from a completed conversation to both sides. */
  async applyConversationChanges(conv: Conversation): Promise<void> {
    const { initiator_agent_id, target_agent_id, relationship_changes } = conv;

    for (const [agentId, delta] of Object.entries(relationship_changes)) {
      const otherId = agentId === initiator_agent_id ? target_agent_id : initiator_agent_id;
      await this.upsertRelationship(agentId, otherId, delta, conv.outcome);
    }

    // Also update belonging needs for both agents if positive outcome
    if (conv.outcome === 'bonding' || conv.outcome === 'friendly') {
      const belongingGain = conv.outcome === 'bonding' ? 5 : 2;
      await execute(
        `UPDATE agents.agent_state
         SET need_belonging = LEAST(100, need_belonging + $1)
         WHERE agent_id = ANY($2)`,
        [belongingGain, [initiator_agent_id, target_agent_id]]
      );
    } else if (conv.outcome === 'hostile' || conv.outcome === 'conflict') {
      // Negative interaction hurts belonging
      await execute(
        `UPDATE agents.agent_state
         SET need_belonging = GREATEST(0, need_belonging - 3)
         WHERE agent_id = ANY($1)`,
        [[initiator_agent_id, target_agent_id]]
      );
    }
  }

  /** Apply relationship changes from a completed trade. */
  async applyTradeChanges(trade: TradeRecord): Promise<void> {
    const { offerer_agent_id, receiver_agent_id, status } = trade;

    const deltas: Record<TradeRecord['status'], RelationshipDelta> = {
      accepted:  { trust: 3,  respect: 2,  affection: 1,  fear: 0  },
      rejected:  { trust: -2, respect: -1, affection: -1, fear: 0  },
      countered: { trust: 1,  respect: 1,  affection: 0,  fear: 0  },
      pending:   { trust: 0,  respect: 0,  affection: 0,  fear: 0  },
      expired:   { trust: -2, respect: -1, affection: 0,  fear: 0  },
    };

    const delta = deltas[status];
    const outcome = status === 'accepted' ? 'friendly' : status === 'rejected' ? 'neutral' : 'neutral';

    await this.upsertRelationship(offerer_agent_id, receiver_agent_id, delta, outcome as any);
    await this.upsertRelationship(receiver_agent_id, offerer_agent_id, delta, outcome as any);

    // Trade acceptance boosts esteem slightly for both parties
    if (status === 'accepted') {
      await execute(
        `UPDATE agents.agent_state
         SET need_esteem = LEAST(100, need_esteem + 3)
         WHERE agent_id = ANY($1)`,
        [[offerer_agent_id, receiver_agent_id]]
      );
    }
  }

  private async upsertRelationship(
    agentId: string,
    otherId: string,
    delta: RelationshipDelta,
    outcome: Conversation['outcome'] | 'neutral'
  ): Promise<void> {
    const isPositive = outcome === 'bonding' || outcome === 'friendly' || outcome === 'reconciliation';
    const isNegative = outcome === 'hostile' || outcome === 'conflict';

    await execute(
      `INSERT INTO social.relationships
         (agent_id, other_agent_id, trust_score, affection_score, respect_score, fear_score,
          relationship_type, interaction_count, positive_interaction_count, negative_interaction_count,
          last_interaction_tick)
       SELECT $1, $2,
         LEAST(100, GREATEST(0, COALESCE((SELECT trust_score    FROM social.relationships WHERE agent_id=$1 AND other_agent_id=$2), 5) + $3)),
         LEAST(100, GREATEST(0, COALESCE((SELECT affection_score FROM social.relationships WHERE agent_id=$1 AND other_agent_id=$2), 5) + $4)),
         LEAST(100, GREATEST(0, COALESCE((SELECT respect_score  FROM social.relationships WHERE agent_id=$1 AND other_agent_id=$2), 5) + $5)),
         LEAST(100, GREATEST(0, COALESCE((SELECT fear_score     FROM social.relationships WHERE agent_id=$1 AND other_agent_id=$2), 0) + $6)),
         'stranger',
         COALESCE((SELECT interaction_count          FROM social.relationships WHERE agent_id=$1 AND other_agent_id=$2), 0) + 1,
         COALESCE((SELECT positive_interaction_count FROM social.relationships WHERE agent_id=$1 AND other_agent_id=$2), 0) + $7,
         COALESCE((SELECT negative_interaction_count FROM social.relationships WHERE agent_id=$1 AND other_agent_id=$2), 0) + $8,
         0
       ON CONFLICT (agent_id, other_agent_id) DO UPDATE SET
         trust_score    = LEAST(100, GREATEST(0, social.relationships.trust_score    + $3)),
         affection_score= LEAST(100, GREATEST(0, social.relationships.affection_score+ $4)),
         respect_score  = LEAST(100, GREATEST(0, social.relationships.respect_score  + $5)),
         fear_score     = LEAST(100, GREATEST(0, social.relationships.fear_score     + $6)),
         interaction_count           = social.relationships.interaction_count + 1,
         positive_interaction_count  = social.relationships.positive_interaction_count + $7,
         negative_interaction_count  = social.relationships.negative_interaction_count + $8,
         last_interaction_tick       = EXCLUDED.last_interaction_tick`,
      [
        agentId, otherId,
        delta.trust ?? 0,
        delta.affection ?? 0,
        delta.respect ?? 0,
        delta.fear ?? 0,
        isPositive ? 1 : 0,
        isNegative ? 1 : 0,
      ]
    );

    // Now upgrade relationship type based on new scores
    await this.upgradeRelationshipType(agentId, otherId);
  }

  /**
   * Decay trust/affection for relationships that haven't had interaction recently.
   * Called once per day (at day boundary) to simulate natural relationship drift.
   */
  async decayStaleRelationships(worldId: string, currentTick: number): Promise<void> {
    // Relationships with no interaction in the last 2 days (2880 ticks) decay slightly
    const staleTicks = 2880;
    await execute(
      `UPDATE social.relationships
       SET trust_score     = GREATEST(5, trust_score - 1),
           affection_score = GREATEST(3, affection_score - 1),
           fear_score       = GREATEST(0, fear_score - 1)
       WHERE agent_id IN (SELECT agent_id FROM agents.agents WHERE world_id = $1 AND status = 'alive')
         AND last_interaction_tick < $2
         AND relationship_type NOT IN ('enemy', 'family')`,
      [worldId, currentTick - staleTicks]
    );
  }

  private async upgradeRelationshipType(agentId: string, otherId: string): Promise<void> {
    const rel = await queryOne<{
      trust_score: number;
      affection_score: number;
      respect_score: number;
      fear_score: number;
      interaction_count: number;
      positive_interaction_count: number;
      negative_interaction_count: number;
      relationship_type: RelType;
      is_romantic_candidate: boolean;
    }>(
      `SELECT trust_score, affection_score, respect_score, fear_score,
              interaction_count, positive_interaction_count, negative_interaction_count,
              relationship_type, is_romantic_candidate
       FROM social.relationships
       WHERE agent_id = $1 AND other_agent_id = $2`,
      [agentId, otherId]
    );

    if (!rel) return;

    // `widowed` is a terminal state set explicitly when a partner dies; the
    // determineType state machine never assigns or escapes it.
    if (rel.relationship_type === 'widowed') return;

    // Monogamy gate: only consider promoting to romantic_partner if neither
    // side is already paired with someone else.
    const partnerStatusBlocksRomance =
      (await this.hasExistingPartner(agentId, otherId)) ||
      (await this.hasExistingPartner(otherId, agentId));

    const newType = this.determineType({
      ...rel,
      partner_status_blocks_romance: partnerStatusBlocksRomance,
    });

    if (newType !== rel.relationship_type) {
      // Stamp romantic_started_tick the first time we transition into the
      // partnered state so post-pairing transitions can reason about it.
      const stampClause = newType === 'romantic_partner' && rel.relationship_type !== 'romantic_partner'
        ? ', romantic_started_tick = COALESCE(romantic_started_tick, last_interaction_tick)'
        : '';
      await execute(
        `UPDATE social.relationships
         SET relationship_type = $1${stampClause}
         WHERE agent_id = $2 AND other_agent_id = $3`,
        [newType, agentId, otherId]
      );
    }
  }

  /**
   * Returns true if `agentId` is currently in any `romantic_partner`
   * relationship excluding `excludeOtherId`. Used by the monogamy gate.
   */
  async hasExistingPartner(agentId: string, excludeOtherId?: string): Promise<boolean> {
    const row = await queryOne<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM social.relationships
         WHERE agent_id = $1
           AND relationship_type = 'romantic_partner'
           AND ($2::uuid IS NULL OR other_agent_id <> $2)
       ) AS exists`,
      [agentId, excludeOtherId ?? null]
    );
    return row?.exists ?? false;
  }

  /**
   * Mark every relationship pointing AT a deceased agent as `widowed` for
   * the surviving side. Called from AgentEngine.killAgent.
   */
  async markWidowed(deceasedAgentId: string): Promise<void> {
    await execute(
      `UPDATE social.relationships
       SET relationship_type = 'widowed'
       WHERE other_agent_id = $1
         AND relationship_type = 'romantic_partner'`,
      [deceasedAgentId]
    );
  }

  /**
   * Pure relationship-type state machine. All inputs are passed in;
   * no DB calls. The orchestrator (`upgradeRelationshipType`) is
   * responsible for fetching `partner_status_blocks_romance` and
   * the current `relationship_type`.
   */
  private determineType(rel: {
    trust_score: number;
    affection_score: number;
    respect_score: number;
    fear_score: number;
    interaction_count: number;
    positive_interaction_count: number;
    negative_interaction_count: number;
    relationship_type?: RelType;
    is_romantic_candidate?: boolean;
    partner_status_blocks_romance?: boolean;
  }): RelType {
    const {
      trust_score, affection_score, respect_score, fear_score,
      interaction_count, positive_interaction_count,
      relationship_type, is_romantic_candidate, partner_status_blocks_romance,
    } = rel;

    // Enemy: very low trust and high fear or hostility.
    if (trust_score < 15 && (fear_score > 50 || affection_score < 5)) return 'enemy';

    // Rival: low trust but high respect (competing).
    if (trust_score < 30 && respect_score > 50) return 'rival';

    // ─── Post-pairing transitions ────────────────────────────────────────
    // Once paired, the relationship persists through dips. Only an
    // affection collapse breaks the pair; trust dipping below 50 fades it
    // to a friendship state.
    if (relationship_type === 'romantic_partner') {
      if (affection_score < BREAKUP_AFFECTION_FLOOR) {
        return fear_score > BREAKUP_TO_ENEMY_FEAR ? 'enemy' : 'acquaintance';
      }
      if (trust_score < ROMANCE_FADE_TRUST) return 'friend';
      return 'romantic_partner';
    }

    // ─── Promote to romantic_partner ─────────────────────────────────────
    // Evaluated BEFORE close_friend so the high-trust, high-affection,
    // candidacy-flagged path doesn't get swallowed by the friend ladder.
    if (
      is_romantic_candidate === true &&
      partner_status_blocks_romance !== true &&
      trust_score >= ROMANCE_TRUST_FLOOR &&
      affection_score >= ROMANCE_AFFECTION_FLOOR &&
      interaction_count >= ROMANCE_INTERACTIONS
    ) {
      return 'romantic_partner';
    }

    // Close friend: requires deep sustained trust + many positive interactions.
    if (trust_score >= 80 && affection_score >= 70 && interaction_count >= 15 && positive_interaction_count >= 10) return 'close_friend';

    // Friend: substantial trust built over time.
    if (trust_score >= 55 && affection_score >= 40 && interaction_count >= 8 && positive_interaction_count >= 5) return 'friend';

    // Acquaintance: a few positive meetings.
    if (interaction_count >= 3 && trust_score >= 20) return 'acquaintance';

    return 'stranger';
  }
}
