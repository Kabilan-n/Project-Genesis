import { query, queryOne, execute } from '../db.js';
import type { Agent, LeadershipEvent, Group } from '../types.js';

/**
 * GovernanceEngine — Phase 5
 *
 * Handles intra-group power dynamics:
 *   - `challengeLeadership`  — agent attempts to usurp the leader
 *   - `exileMember`          — leader banishes a member from the group
 *   - `defectToGroup`        — agent switches from one group to another
 */
export class GovernanceEngine {

  // ── Leadership challenges ────────────────────────────────────────────────────

  /**
   * challengeLeadership — challenger attempts to dethrone the current leader.
   *
   * Mechanism selection:
   *   - intimidation: aggression > 70 (high-aggression challengers)
   *   - demonstration: curiosity > 70 || analytical > 70 (skilled challengers)
   *   - vote: default (social challengers)
   *
   * Outcome depends on challenger vs incumbent support scores derived from
   * member relationships.
   */
  async challengeLeadership(
    challenger: Agent,
    groupId: string,
    worldId: string,
    tick: number,
    day: number
  ): Promise<LeadershipEvent | null> {
    const group = await queryOne<Group & { leader_id: string }>(
      `SELECT * FROM social.groups WHERE group_id = $1`,
      [groupId]
    );
    if (!group || group.leader_id === challenger.agent_id) return null;

    const incumbentId = group.leader_id;

    // Determine mechanism
    let mechanism: LeadershipEvent['mechanism'] = 'vote';
    if (challenger.traits.aggression > 70) mechanism = 'intimidation';
    else if (challenger.traits.curiosity > 70 || challenger.traits.analytical > 70) mechanism = 'demonstration';

    // Count member support via average trust scores
    const members = await query<{ agent_id: string }>(
      `SELECT agent_id FROM social.group_members WHERE group_id = $1 AND agent_id != $2 AND agent_id != $3`,
      [groupId, challenger.agent_id, incumbentId]
    );

    let voteChallenger = 0;
    let voteIncumbent  = 0;

    // Challenger's base support from their own traits
    const challengerScore = this.leaderScore(challenger);

    // Incumbent's score from DB traits
    const incumbentRow = await queryOne<{ aggression: number; leadership_tendency: number; extraversion: number; ambition: number }>(
      `SELECT aggression, leadership_tendency, extraversion, ambition
       FROM agents.agent_traits WHERE agent_id = $1`,
      [incumbentId]
    );
    const incumbentScore = incumbentRow
      ? (incumbentRow.leadership_tendency * 0.4 + incumbentRow.extraversion * 0.3 + incumbentRow.ambition * 0.3) / 100
      : 0.5;

    for (const member of members) {
      // Compare trust scores toward challenger vs incumbent
      const trustChallenger = await queryOne<{ trust_score: number }>(
        `SELECT trust_score FROM social.relationships WHERE agent_id = $1 AND other_agent_id = $2`,
        [member.agent_id, challenger.agent_id]
      );
      const trustIncumbent = await queryOne<{ trust_score: number }>(
        `SELECT trust_score FROM social.relationships WHERE agent_id = $1 AND other_agent_id = $2`,
        [member.agent_id, incumbentId]
      );

      const tc = (trustChallenger?.trust_score ?? 50) / 100 * challengerScore;
      const ti = (trustIncumbent?.trust_score ?? 50) / 100 * incumbentScore;

      if (tc > ti) voteChallenger++;
      else voteIncumbent++;
    }

    // Challenger and incumbent each vote for themselves
    voteChallenger++;
    voteIncumbent++;

    // Apply mechanism modifiers
    if (mechanism === 'intimidation') {
      // Intimidation adds raw aggression bonus for challenger
      voteChallenger += Math.floor(challenger.traits.aggression / 20);
    } else if (mechanism === 'demonstration') {
      voteChallenger += Math.floor((challenger.traits.curiosity + challenger.traits.analytical) / 40);
    }

    let outcome: LeadershipEvent['outcome'];
    if (Math.abs(voteChallenger - voteIncumbent) <= 1) {
      outcome = 'split'; // Tie → split factions (no immediate change)
    } else if (voteChallenger > voteIncumbent) {
      outcome = 'challenger_wins';
    } else {
      outcome = 'incumbent_wins';
    }

    // Apply outcome
    if (outcome === 'challenger_wins') {
      await execute(
        `UPDATE social.groups SET leader_id = $2 WHERE group_id = $1`,
        [groupId, challenger.agent_id]
      );
      // Promote challenger, demote incumbent
      await execute(
        `UPDATE social.group_members SET role = 'leader' WHERE group_id = $1 AND agent_id = $2`,
        [groupId, challenger.agent_id]
      );
      await execute(
        `UPDATE social.group_members SET role = 'elder' WHERE group_id = $1 AND agent_id = $2`,
        [groupId, incumbentId]
      );
    }

    // Persist leadership event
    const event = await queryOne<LeadershipEvent>(
      `INSERT INTO conflict.leadership_events
         (world_id, group_id, challenger_id, incumbent_id, mechanism, outcome,
          votes_challenger, votes_incumbent, tick, day)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [worldId, groupId, challenger.agent_id, incumbentId, mechanism, outcome,
       voteChallenger, voteIncumbent, tick, day]
    );

    return event ?? null;
  }

  // ── Exile ─────────────────────────────────────────────────────────────────────

  /**
   * exileMember — leader removes a member from the group permanently.
   * The exiled agent becomes is_exiled = true with exiled_from = group_id.
   */
  async exileMember(
    leaderId: string,
    targetAgentId: string,
    groupId: string,
    worldId: string
  ): Promise<boolean> {
    // Verify leader is actually the group leader
    const group = await queryOne<{ leader_id: string }>(
      `SELECT leader_id FROM social.groups WHERE group_id = $1`,
      [groupId]
    );
    if (!group || group.leader_id !== leaderId) return false;

    // Remove from group
    await execute(
      `DELETE FROM social.group_members WHERE group_id = $1 AND agent_id = $2`,
      [groupId, targetAgentId]
    );
    await execute(
      `UPDATE agents.agents
       SET group_id = NULL, is_exiled = TRUE, exiled_from = $2
       WHERE agent_id = $1`,
      [targetAgentId, groupId]
    );
    await execute(
      `UPDATE social.groups SET member_count = GREATEST(0, member_count - 1) WHERE group_id = $1`,
      [groupId]
    );

    return true;
  }

  // ── Defection ────────────────────────────────────────────────────────────────

  /**
   * defectToGroup — agent leaves their current group and joins a new one.
   * This is distinct from join_group (which is for groupless agents).
   */
  async defectToGroup(
    agent: Agent,
    newGroupId: string,
    tick: number,
    day: number
  ): Promise<boolean> {
    if (!agent.group_id || agent.group_id === newGroupId) return false;

    // Leave old group
    const oldGroupId = agent.group_id;
    await execute(
      `DELETE FROM social.group_members WHERE group_id = $1 AND agent_id = $2`,
      [oldGroupId, agent.agent_id]
    );
    await execute(
      `UPDATE social.groups SET member_count = GREATEST(0, member_count - 1) WHERE group_id = $1`,
      [oldGroupId]
    );

    // Join new group
    await execute(
      `INSERT INTO social.group_members (group_id, agent_id, role, joined_tick, joined_day)
       VALUES ($1, $2, 'recruit', $3, $4)
       ON CONFLICT (group_id, agent_id) DO NOTHING`,
      [newGroupId, agent.agent_id, tick, day]
    );
    await execute(
      `UPDATE agents.agents SET group_id = $2 WHERE agent_id = $1`,
      [agent.agent_id, newGroupId]
    );
    await execute(
      `UPDATE social.groups SET member_count = member_count + 1 WHERE group_id = $1`,
      [newGroupId]
    );

    return true;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private leaderScore(agent: Agent): number {
    return (
      agent.traits.leadership_tendency * 0.4 +
      agent.traits.extraversion        * 0.3 +
      agent.traits.ambition            * 0.3
    ) / 100;
  }

  /** Retrieve a compact list of groups that are enemies of the given group */
  async getEnemyGroups(groupId: string, worldId: string): Promise<Array<{ group_id: string; name: string }>> {
    return query<{ group_id: string; name: string }>(
      `SELECT g.group_id, g.name
       FROM social.groups g
       WHERE g.world_id = $1
         AND g.group_id = ANY(
           SELECT unnest(at_war_with) FROM social.groups WHERE group_id = $2
         )`,
      [worldId, groupId]
    );
  }
}
