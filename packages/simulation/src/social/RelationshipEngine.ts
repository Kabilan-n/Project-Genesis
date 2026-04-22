import { execute, queryOne } from '../db.js';
import type { Agent, Conversation, TradeRecord, RelationshipDelta } from '../types.js';

type RelType = 'stranger' | 'acquaintance' | 'friend' | 'close_friend' | 'romantic_partner' | 'rival' | 'enemy' | 'family';

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
      relationship_type: string;
    }>(
      `SELECT trust_score, affection_score, respect_score, fear_score,
              interaction_count, positive_interaction_count, negative_interaction_count,
              relationship_type
       FROM social.relationships
       WHERE agent_id = $1 AND other_agent_id = $2`,
      [agentId, otherId]
    );

    if (!rel) return;

    const newType = this.determineType(rel);
    if (newType !== rel.relationship_type) {
      await execute(
        `UPDATE social.relationships SET relationship_type = $1
         WHERE agent_id = $2 AND other_agent_id = $3`,
        [newType, agentId, otherId]
      );
    }
  }

  private determineType(rel: {
    trust_score: number;
    affection_score: number;
    respect_score: number;
    fear_score: number;
    interaction_count: number;
    positive_interaction_count: number;
    negative_interaction_count: number;
  }): RelType {
    const { trust_score, affection_score, respect_score, fear_score, interaction_count, positive_interaction_count } = rel;

    // Enemy: very low trust and high fear or hostility
    if (trust_score < 15 && (fear_score > 50 || affection_score < 5)) return 'enemy';

    // Rival: low trust but high respect (competing)
    if (trust_score < 30 && respect_score > 50) return 'rival';

    // Close friend: requires deep sustained trust + many positive interactions
    if (trust_score >= 80 && affection_score >= 70 && interaction_count >= 15 && positive_interaction_count >= 10) return 'close_friend';

    // Romantic partner: very high affection + trust + meaningful history
    if (trust_score >= 85 && affection_score >= 90 && interaction_count >= 10) return 'romantic_partner';

    // Friend: substantial trust built over time
    if (trust_score >= 55 && affection_score >= 40 && interaction_count >= 8 && positive_interaction_count >= 5) return 'friend';

    // Acquaintance: a few positive meetings
    if (interaction_count >= 3 && trust_score >= 20) return 'acquaintance';

    return 'stranger';
  }
}
