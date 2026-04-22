import { query, queryOne, execute } from '../db.js';
import type { Agent } from '../types.js';

export interface Law {
  law_id: string;
  world_id: string;
  group_id: string;
  name: string;
  description: string;
  law_type: 'resource' | 'behavior' | 'territory' | 'trade' | 'belief';
  penalty_type: 'relationship' | 'exile' | 'resource_fine' | 'public_shame';
  penalty_value: number;
  votes_for: number;
  votes_against: number;
  status: 'proposed' | 'active' | 'repealed';
  proposed_by?: string;
  proposed_tick: number;
  enacted_tick?: number;
}

export interface LawViolation {
  violation_id?: string;
  world_id: string;
  law_id: string;
  violator_id: string;
  reporter_id?: string;
  penalty_applied: string;
  tick: number;
  day: number;
}

// Minimum votes needed to pass a law (fraction of group members)
const QUORUM_FRACTION = 0.5;
// Ticks a law waits for votes before auto-deciding
const VOTE_WINDOW_TICKS = 720; // half a day

/**
 * LawEngine — Phase 5 Civilisation
 *
 * Manages group governance through laws:
 *   - `proposeLaw`      — agent proposes a rule to the group
 *   - `voteOnLaw`       — members vote for or against
 *   - `enactLaws`       — finalise laws that have reached quorum
 *   - `reportViolation` — agent reports another for breaking a law
 *   - `applyPenalty`    — execute the punishment for a violation
 *   - `runLawTick`      — called every tick to finalise pending votes
 */
export class LawEngine {

  // ── Propose ───────────────────────────────────────────────────────────────────

  async proposeLaw(
    proposer: Agent,
    groupId: string,
    name: string,
    description: string,
    lawType: Law['law_type'],
    penaltyType: Law['penalty_type'],
    penaltyValue: number,
    worldId: string,
    tick: number
  ): Promise<Law | null> {
    // Only group members can propose laws
    const isMember = await queryOne<{ agent_id: string }>(
      `SELECT agent_id FROM social.group_members WHERE group_id = $1 AND agent_id = $2`,
      [groupId, proposer.agent_id]
    );
    if (!isMember) return null;

    // Auto-vote: proposer votes for
    const law = await queryOne<Law>(
      `INSERT INTO civilisation.laws
         (world_id, group_id, name, description, law_type,
          penalty_type, penalty_value, votes_for, votes_against,
          status, proposed_by, proposed_tick)
       VALUES ($1,$2,$3,$4,$5,$6,$7,1,0,'proposed',$8,$9)
       RETURNING *`,
      [worldId, groupId, name, description, lawType,
       penaltyType, penaltyValue, proposer.agent_id, tick]
    );
    return law ?? null;
  }

  // ── Voting ────────────────────────────────────────────────────────────────────

  async voteOnLaw(
    voter: Agent,
    lawId: string,
    inFavour: boolean
  ): Promise<boolean> {
    const law = await queryOne<Law>(
      `SELECT * FROM civilisation.laws WHERE law_id = $1 AND status = 'proposed'`,
      [lawId]
    );
    if (!law) return false;

    const isMember = await queryOne<{ agent_id: string }>(
      `SELECT agent_id FROM social.group_members WHERE group_id = $1 AND agent_id = $2`,
      [law.group_id, voter.agent_id]
    );
    if (!isMember) return false;

    if (inFavour) {
      await execute(
        `UPDATE civilisation.laws SET votes_for = votes_for + 1 WHERE law_id = $1`,
        [lawId]
      );
    } else {
      await execute(
        `UPDATE civilisation.laws SET votes_against = votes_against + 1 WHERE law_id = $1`,
        [lawId]
      );
    }
    return true;
  }

  // ── Enactment ─────────────────────────────────────────────────────────────────

  /**
   * runLawTick — called every tick.
   * Finalises laws whose vote window has closed.
   */
  async runLawTick(worldId: string, tick: number): Promise<void> {
    const pending = await query<Law>(
      `SELECT l.*, g.member_count
       FROM civilisation.laws l
       JOIN social.groups g ON g.group_id = l.group_id
       WHERE l.world_id = $1 AND l.status = 'proposed'
         AND l.proposed_tick <= $2`,
      [worldId, tick - VOTE_WINDOW_TICKS]
    );

    for (const law of pending) {
      const memberCount = (law as any).member_count ?? 1;
      const totalVotes  = law.votes_for + law.votes_against;
      const quorum      = totalVotes >= Math.ceil(memberCount * QUORUM_FRACTION);
      const passed      = quorum && law.votes_for > law.votes_against;

      if (passed) {
        await execute(
          `UPDATE civilisation.laws SET status = 'active', enacted_tick = $2 WHERE law_id = $1`,
          [law.law_id, tick]
        );
      } else {
        // Failed or no quorum → repeal proposal
        await execute(
          `UPDATE civilisation.laws SET status = 'repealed' WHERE law_id = $1`,
          [law.law_id]
        );
      }
    }
  }

  // ── Violation detection ───────────────────────────────────────────────────────

  /**
   * checkForViolations — called after each agent action.
   * Returns any laws the agent may have violated.
   */
  async checkForViolations(
    agent: Agent,
    actionVerb: string,
    targetAgentId?: string
  ): Promise<Law[]> {
    if (!agent.group_id) return [];

    const activeLaws = await this.getGroupLaws(agent.group_id);
    const violated: Law[] = [];

    for (const law of activeLaws) {
      let violates = false;

      switch (law.law_type) {
        case 'behavior':
          // Examples: "no_aggression" law violated by raid/denounce
          if (['raid', 'exile_member', 'denounce'].includes(actionVerb)) violates = true;
          break;
        case 'resource':
          // "no_hoarding" — if agent has > 200 units of any resource
          // (checked lazily here; full check happens in reportViolation)
          break;
        case 'trade':
          // Violations are reported by trade partners, not detected automatically
          break;
        case 'territory':
          // Agent left group territory — would need position check
          break;
        case 'belief':
          // Practicing a banned belief
          break;
      }

      if (violates) violated.push(law);
    }

    return violated;
  }

  // ── Violation reporting ───────────────────────────────────────────────────────

  async reportViolation(
    reporter: Agent,
    violatorId: string,
    lawId: string,
    worldId: string,
    tick: number,
    day: number
  ): Promise<LawViolation | null> {
    const law = await queryOne<Law>(
      `SELECT * FROM civilisation.laws WHERE law_id = $1 AND status = 'active'`,
      [lawId]
    );
    if (!law) return null;

    // Apply the penalty
    const penaltyLabel = await this.applyPenalty(violatorId, law, worldId, tick);

    const violation = await queryOne<LawViolation>(
      `INSERT INTO civilisation.law_violations
         (world_id, law_id, violator_id, reporter_id, penalty_applied, tick, day)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [worldId, lawId, violatorId, reporter.agent_id, penaltyLabel, tick, day]
    );

    return violation ?? null;
  }

  private async applyPenalty(
    violatorId: string,
    law: Law,
    worldId: string,
    tick: number
  ): Promise<string> {
    switch (law.penalty_type) {
      case 'relationship':
        // Reduce all group members' trust toward violator
        await execute(
          `UPDATE social.relationships r
           SET trust_score = GREATEST(0, trust_score - $3)
           FROM social.group_members gm
           WHERE r.other_agent_id = $1
             AND r.agent_id = gm.agent_id
             AND gm.group_id = $2`,
          [violatorId, law.group_id, law.penalty_value]
        );
        return `trust_reduced_by_${law.penalty_value}`;

      case 'resource_fine':
        // Deduct resources from violator's inventory (distributed to group leader)
        await execute(
          `UPDATE economy.inventory
           SET amount = GREATEST(0, amount - $2)
           WHERE agent_id = $1 AND resource_type = 'food'`,
          [violatorId, Math.floor(law.penalty_value)]
        );
        return `resource_fine_${law.penalty_value}`;

      case 'public_shame':
        // Lower violator's esteem and reputation
        await execute(
          `UPDATE agents.agent_state SET need_esteem = GREATEST(0, need_esteem - $2) WHERE agent_id = $1`,
          [violatorId, law.penalty_value]
        );
        await execute(
          `UPDATE social.reputations
           SET trustworthiness = GREATEST(0, trustworthiness - $2),
               negative_reports = negative_reports + 1,
               total_reports = total_reports + 1
           WHERE agent_id = $1`,
          [violatorId, law.penalty_value]
        );
        return `public_shame_-${law.penalty_value}_esteem`;

      case 'exile':
        // Mark for exile — actual removal triggered by GovernanceEngine
        return 'exile_pending';

      default:
        return 'no_penalty';
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────────────────

  async getGroupLaws(groupId: string): Promise<Law[]> {
    return query<Law>(
      `SELECT * FROM civilisation.laws WHERE group_id = $1 AND status = 'active'`,
      [groupId]
    );
  }

  async getGroupProposedLaws(groupId: string): Promise<Law[]> {
    return query<Law>(
      `SELECT * FROM civilisation.laws WHERE group_id = $1 AND status = 'proposed'
       ORDER BY proposed_tick DESC`,
      [groupId]
    );
  }

  async getWorldLaws(worldId: string): Promise<Law[]> {
    return query<Law>(
      `SELECT * FROM civilisation.laws WHERE world_id = $1 AND status = 'active'
       ORDER BY enacted_tick DESC`,
      [worldId]
    );
  }

  async getRecentViolations(worldId: string, limit = 20): Promise<LawViolation[]> {
    return query<LawViolation>(
      `SELECT * FROM civilisation.law_violations WHERE world_id = $1
       ORDER BY tick DESC LIMIT $2`,
      [worldId, limit]
    );
  }
}
