import { query, queryOne, execute } from '../db.js';
import type { Agent, GossipClaim, GossipEvent, Reputation } from '../types.js';

// How much a single gossip event shifts the listener's trust of the subject
const BASE_TRUST_SHIFT = 6;
// High-trust gossiper's words carry more weight
const TRUST_CREDIBILITY_MULTIPLIER = 0.015; // per trust point above 50
// Sceptical agents (low trust_default) are harder to convince
const SCEPTICISM_REDUCTION = 0.008;          // per trust_default point below 50

const POSITIVE_CLAIMS: GossipClaim[] = ['trustworthy', 'skilled', 'generous', 'heroic'];
const NEGATIVE_CLAIMS: GossipClaim[] = ['dangerous', 'deceptive', 'weak', 'cruel'];

/**
 * GossipEngine — Phase 3
 *
 * Models word-of-mouth reputation spreading.
 *
 * When an agent executes a `gossip [listener] [subject] [claim]` action:
 * 1. Listener's relationship trust/fear of subject shifts based on the claim
 * 2. The subject's global reputation score updates
 * 3. Whether the listener "believes" the gossip depends on their trust in
 *    the gossiper and their own scepticism trait (trust_default)
 */
export class GossipEngine {

  /**
   * Process a gossip action from gossiper → listener about subject.
   * Returns the gossip event record.
   */
  async processGossip(
    gossiper: Agent,
    listener: Agent,
    subject: Agent,
    claim: GossipClaim,
    tick: number,
    day: number
  ): Promise<GossipEvent> {
    // How much the listener trusts the gossiper
    const gossiperRel = await this.getRelationship(listener.agent_id, gossiper.agent_id);
    const gossiperTrust = gossiperRel?.trust_score ?? listener.traits.trust_default;

    // Credibility of this gossip instance
    const credibility = this.computeCredibility(gossiperTrust, listener.traits.trust_default);

    // Does the listener believe it? (probabilistic based on credibility)
    const believed = Math.random() < credibility;

    let trustChangeSubject = 0;

    if (believed) {
      const isPositive = POSITIVE_CLAIMS.includes(claim);
      const isNegative = NEGATIVE_CLAIMS.includes(claim);

      const shiftMagnitude = BASE_TRUST_SHIFT * credibility;

      if (isPositive) {
        trustChangeSubject = +shiftMagnitude;
        await this.shiftRelationship(listener.agent_id, subject.agent_id, {
          trust: +shiftMagnitude,
          affection: +(shiftMagnitude * 0.3),
          fear: -(shiftMagnitude * 0.2),
        });
      } else if (isNegative) {
        trustChangeSubject = -shiftMagnitude;
        const fearGain = claim === 'dangerous' || claim === 'cruel' ? shiftMagnitude * 0.8 : 0;
        await this.shiftRelationship(listener.agent_id, subject.agent_id, {
          trust: -shiftMagnitude,
          fear: +fearGain,
        });
      }

      // Update subject's world-level reputation
      await this.updateReputation(subject.agent_id, subject.world_id, claim, tick);
    }

    // Persist gossip event
    const row = await queryOne<{ gossip_id: string }>(
      `INSERT INTO social.gossip_events
         (world_id, gossiper_id, listener_id, subject_id, claim, believed, trust_change_subject, tick, day)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING gossip_id`,
      [
        gossiper.world_id, gossiper.agent_id, listener.agent_id,
        subject.agent_id, claim, believed, trustChangeSubject, tick, day,
      ]
    );

    return {
      gossip_id: row!.gossip_id,
      world_id: gossiper.world_id,
      gossiper_id: gossiper.agent_id,
      listener_id: listener.agent_id,
      subject_id: subject.agent_id,
      claim,
      believed,
      trust_change_subject: trustChangeSubject,
      tick,
      day,
    };
  }

  /**
   * Get an agent's current reputation in the world.
   * Creates a default record if none exists.
   */
  async getReputation(agentId: string, worldId: string): Promise<Reputation> {
    const rep = await queryOne<Reputation>(
      `SELECT * FROM social.reputation WHERE agent_id = $1 AND world_id = $2`,
      [agentId, worldId]
    );

    if (rep) return rep;

    // Bootstrap
    await execute(
      `INSERT INTO social.reputation (agent_id, world_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [agentId, worldId]
    );
    return {
      agent_id: agentId,
      world_id: worldId,
      trustworthiness: 50,
      generosity: 50,
      skill_renown: 10,
      danger_level: 0,
      total_reports: 0,
      positive_reports: 0,
      negative_reports: 0,
      last_updated_tick: 0,
    };
  }

  /**
   * Get the overall reputation summary for an agent to inject into prompts.
   * Returns a short natural language description.
   */
  async getReputationSummary(agentId: string, worldId: string): Promise<string> {
    const rep = await this.getReputation(agentId, worldId);
    if (rep.total_reports === 0) return 'Unknown to most';

    const parts: string[] = [];
    if (rep.trustworthiness >= 70) parts.push('widely trusted');
    else if (rep.trustworthiness <= 30) parts.push('considered untrustworthy');
    if (rep.skill_renown >= 60) parts.push('respected for skill');
    if (rep.danger_level >= 60) parts.push('feared by many');
    if (rep.generosity >= 70) parts.push('known for generosity');

    return parts.length > 0 ? parts.join(', ') : 'average reputation';
  }

  /**
   * Boost reputation when agent performs a notable positive action
   * (e.g., accepted trade, helped someone).
   */
  async boostReputation(
    agentId: string,
    worldId: string,
    dimension: 'trustworthiness' | 'generosity' | 'skill_renown',
    amount: number,
    tick: number
  ): Promise<void> {
    await execute(
      `INSERT INTO social.reputation (agent_id, world_id, ${dimension}, total_reports, positive_reports, last_updated_tick)
       VALUES ($1, $2, LEAST(100, 50 + $3), 1, 1, $4)
       ON CONFLICT (agent_id, world_id) DO UPDATE SET
         ${dimension} = LEAST(100, social.reputation.${dimension} + $3),
         total_reports = social.reputation.total_reports + 1,
         positive_reports = social.reputation.positive_reports + 1,
         last_updated_tick = $4`,
      [agentId, worldId, amount, tick]
    );
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Credibility = how likely the listener believes the gossip.
   * Range 0.2–0.9.
   */
  private computeCredibility(gossiperTrust: number, listenerScepticism: number): number {
    let base = 0.5;
    // More trusted gossiper → more believable
    base += (gossiperTrust - 50) * TRUST_CREDIBILITY_MULTIPLIER;
    // More sceptical listener → harder to convince
    base -= (50 - listenerScepticism) * SCEPTICISM_REDUCTION;
    return Math.max(0.2, Math.min(0.9, base));
  }

  private async updateReputation(
    subjectId: string,
    worldId: string,
    claim: GossipClaim,
    tick: number
  ): Promise<void> {
    const isPositive = POSITIVE_CLAIMS.includes(claim);

    // Map claim to the dimension it most directly affects
    const dimensionMap: Partial<Record<GossipClaim, string>> = {
      trustworthy: 'trustworthiness',
      deceptive:   'trustworthiness',
      skilled:     'skill_renown',
      weak:        'skill_renown',
      generous:    'generosity',
      dangerous:   'danger_level',
      cruel:       'danger_level',
      heroic:      'trustworthiness',
    };

    const dimension = dimensionMap[claim] ?? 'trustworthiness';
    const shift = isPositive ? 4 : -4;

    await execute(
      `INSERT INTO social.reputation (agent_id, world_id, ${dimension}, total_reports, positive_reports, negative_reports, last_updated_tick)
       VALUES ($1, $2, LEAST(100, GREATEST(0, 50 + $3)), 1, $4, $5, $6)
       ON CONFLICT (agent_id, world_id) DO UPDATE SET
         ${dimension}      = LEAST(100, GREATEST(0, social.reputation.${dimension} + $3)),
         total_reports     = social.reputation.total_reports + 1,
         positive_reports  = social.reputation.positive_reports + $4,
         negative_reports  = social.reputation.negative_reports + $5,
         last_updated_tick = $6`,
      [
        subjectId, worldId, shift,
        isPositive ? 1 : 0,
        isPositive ? 0 : 1,
        tick,
      ]
    );
  }

  private async shiftRelationship(
    agentId: string,
    otherId: string,
    delta: { trust?: number; affection?: number; fear?: number }
  ): Promise<void> {
    await execute(
      `INSERT INTO social.relationships
         (agent_id, other_agent_id, trust_score, affection_score, respect_score, fear_score,
          relationship_type, interaction_count, positive_interaction_count,
          negative_interaction_count, last_interaction_tick)
       SELECT $1, $2,
         LEAST(100, GREATEST(0, COALESCE((SELECT trust_score    FROM social.relationships WHERE agent_id=$1 AND other_agent_id=$2), 10) + $3)),
         LEAST(100, GREATEST(0, COALESCE((SELECT affection_score FROM social.relationships WHERE agent_id=$1 AND other_agent_id=$2), 10) + $4)),
         10, -- respect unchanged
         LEAST(100, GREATEST(0, COALESCE((SELECT fear_score     FROM social.relationships WHERE agent_id=$1 AND other_agent_id=$2), 0) + $5)),
         'stranger', 0, 0, 0, 0
       ON CONFLICT (agent_id, other_agent_id) DO UPDATE SET
         trust_score     = LEAST(100, GREATEST(0, social.relationships.trust_score    + $3)),
         affection_score = LEAST(100, GREATEST(0, social.relationships.affection_score + $4)),
         fear_score      = LEAST(100, GREATEST(0, social.relationships.fear_score     + $5))`,
      [
        agentId, otherId,
        delta.trust ?? 0,
        delta.affection ?? 0,
        delta.fear ?? 0,
      ]
    );
  }

  private async getRelationship(
    agentId: string,
    otherId: string
  ): Promise<{ trust_score: number } | null> {
    return queryOne<{ trust_score: number }>(
      `SELECT trust_score FROM social.relationships
       WHERE agent_id = $1 AND other_agent_id = $2`,
      [agentId, otherId]
    );
  }
}
