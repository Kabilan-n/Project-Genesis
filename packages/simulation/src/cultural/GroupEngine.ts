import { query, queryOne, execute } from '../db.js';
import type { Agent, Group, GroupMember } from '../types.js';

const GROUP_COLOURS = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981',
  '#3b82f6', '#ef4444', '#8b5cf6', '#06b6d4',
];

// Belonging bonus for being in a group (per tick)
const GROUP_BELONGING_BONUS   = 0.02;
// If a member hasn't interacted with the group for N ticks, contribution drops
const INACTIVITY_CONTRIBUTION_DECAY = 0.001;
// Group disbands if average contribution drops below this
const DISBAND_THRESHOLD = -10;
// Max members before group becomes unwieldy (no hard cap but prompt notes it)
const SUGGESTED_MAX_MEMBERS = 15;

/**
 * GroupEngine — Phase 3
 *
 * Manages group/tribe lifecycle:
 *  - Formation:    Agent calls `form_group [name] [purpose]`
 *  - Joining:      Agent calls `join_group [group_name]`
 *  - Tick pass:    Apply belonging bonuses, decay contributions of inactive members
 *  - Disbanding:   Group ceases if average contribution is too negative
 *  - Territory:    Group claims a map region centred on the founder's position
 */
export class GroupEngine {

  // ── Formation ───────────────────────────────────────────────────────────────

  async formGroup(
    founder: Agent,
    name: string,
    purpose: string,
    tick: number,
    day: number
  ): Promise<Group> {
    // Check founder isn't already in a group
    if (founder.group_id) {
      // Leave current group first
      await this.leaveGroup(founder, tick);
    }

    // Pick a colour not already used in this world
    const colour = await this.pickColour(founder.world_id);

    // Compute shared_values from founder's traits (top-weighted traits become group values)
    const sharedValues = this.deriveGroupValues(founder);

    const row = await queryOne<{ group_id: string }>(
      `INSERT INTO social.groups
         (world_id, name, purpose, founder_id, leader_id, status,
          territory_x, territory_y, territory_radius, shared_values,
          colour, formed_tick, formed_day, member_count)
       VALUES ($1,$2,$3,$4,$4,'active',$5,$6,5,$7::jsonb,$8,$9,$10,1)
       RETURNING group_id`,
      [
        founder.world_id, name, purpose,
        founder.agent_id,
        founder.state.position_x, founder.state.position_y,
        JSON.stringify(sharedValues),
        colour, tick, day,
      ]
    );

    const groupId = row!.group_id;

    // Add founder as member with role 'founder'
    await execute(
      `INSERT INTO social.group_members
         (group_id, agent_id, role, joined_tick, joined_day, contribution_score)
       VALUES ($1, $2, 'founder', $3, $4, 10)`,
      [groupId, founder.agent_id, tick, day]
    );

    // Mark agent's current group
    await execute(
      `UPDATE agents.agents SET group_id = $1 WHERE agent_id = $2`,
      [groupId, founder.agent_id]
    );

    return {
      group_id: groupId,
      world_id: founder.world_id,
      name,
      purpose,
      founder_id: founder.agent_id,
      leader_id: founder.agent_id,
      status: 'active',
      territory_x: founder.state.position_x,
      territory_y: founder.state.position_y,
      territory_radius: 5,
      shared_values: sharedValues,
      colour,
      formed_tick: tick,
      formed_day: day,
      member_count: 1,
    };
  }

  // ── Joining ─────────────────────────────────────────────────────────────────

  async joinGroup(
    agent: Agent,
    groupName: string,
    tick: number,
    day: number
  ): Promise<Group | null> {
    // Find group by name in this world
    const group = await queryOne<Group>(
      `SELECT * FROM social.groups
       WHERE world_id = $1 AND LOWER(name) = LOWER($2) AND status = 'active'`,
      [agent.world_id, groupName]
    );

    if (!group || !group.group_id) return null;

    // Already a member?
    const existing = await queryOne<{ group_id: string }>(
      `SELECT group_id FROM social.group_members
       WHERE group_id = $1 AND agent_id = $2`,
      [group.group_id, agent.agent_id]
    );
    if (existing) return group;

    // Leave current group if any
    if (agent.group_id) {
      await this.leaveGroup(agent, tick);
    }

    // Join
    await execute(
      `INSERT INTO social.group_members
         (group_id, agent_id, role, joined_tick, joined_day, contribution_score)
       VALUES ($1, $2, 'recruit', $3, $4, 0)`,
      [group.group_id, agent.agent_id, tick, day]
    );

    await execute(
      `UPDATE agents.agents SET group_id = $1 WHERE agent_id = $2`,
      [group.group_id, agent.agent_id]
    );

    await execute(
      `UPDATE social.groups SET member_count = member_count + 1 WHERE group_id = $1`,
      [group.group_id]
    );

    return group;
  }

  // ── Leaving / Disbanding ────────────────────────────────────────────────────

  async leaveGroup(agent: Agent, tick: number): Promise<void> {
    if (!agent.group_id) return;

    await execute(
      `DELETE FROM social.group_members WHERE group_id = $1 AND agent_id = $2`,
      [agent.group_id, agent.agent_id]
    );

    await execute(
      `UPDATE agents.agents SET group_id = NULL WHERE agent_id = $1`,
      [agent.agent_id]
    );

    await execute(
      `UPDATE social.groups
       SET member_count = GREATEST(0, member_count - 1)
       WHERE group_id = $1`,
      [agent.group_id]
    );

    // Check if group should disband (0 members left)
    const grp = await queryOne<{ member_count: number }>(
      `SELECT member_count FROM social.groups WHERE group_id = $1`,
      [agent.group_id]
    );
    if (grp && grp.member_count === 0) {
      await execute(
        `UPDATE social.groups SET status = 'disbanded', disbanded_tick = $1 WHERE group_id = $2`,
        [tick, agent.group_id]
      );
    }
  }

  // ── Per-tick pass ────────────────────────────────────────────────────────────

  /**
   * Called each tick from the simulation runner.
   * Applies belonging bonuses to all group members and decays contributions.
   * Once per day: checks for group cohesion and possibly disbands.
   */
  async runGroupTick(worldId: string, tick: number): Promise<void> {
    // Apply belonging bonus to all group members
    await execute(
      `UPDATE agents.agent_state s
       SET need_belonging = LEAST(100, need_belonging + $1)
       FROM agents.agents a
       WHERE s.agent_id = a.agent_id
         AND a.world_id = $2
         AND a.group_id IS NOT NULL
         AND a.status = 'alive'`,
      [GROUP_BELONGING_BONUS, worldId]
    );

    // Daily check: decay contribution scores + check disband
    if (tick % 1440 === 0 && tick > 0) {
      await this.dailyCohesionCheck(worldId, tick);
    }
  }

  private async dailyCohesionCheck(worldId: string, tick: number): Promise<void> {
    // Get all active groups in this world
    const groups = await query<{ group_id: string; name: string }>(
      `SELECT group_id, name FROM social.groups WHERE world_id = $1 AND status = 'active'`,
      [worldId]
    );

    for (const grp of groups) {
      // Decay contribution scores of members who haven't acted recently
      await execute(
        `UPDATE social.group_members
         SET contribution_score = contribution_score - $1
         WHERE group_id = $2`,
        [INACTIVITY_CONTRIBUTION_DECAY * 1440, grp.group_id]
      );

      // Check average contribution — if too low, disband
      const stats = await queryOne<{ avg_contribution: number; member_count: number }>(
        `SELECT AVG(contribution_score) as avg_contribution, COUNT(*) as member_count
         FROM social.group_members
         WHERE group_id = $1`,
        [grp.group_id]
      );

      if (stats && stats.avg_contribution < DISBAND_THRESHOLD) {
        await this.disbandGroup(grp.group_id, tick);
      }
    }
  }

  async disbandGroup(groupId: string, tick: number): Promise<void> {
    // Clear group_id from all members
    await execute(
      `UPDATE agents.agents SET group_id = NULL
       WHERE group_id = $1`,
      [groupId]
    );

    // Mark disbanded
    await execute(
      `UPDATE social.groups SET status = 'disbanded', disbanded_tick = $1 WHERE group_id = $2`,
      [tick, groupId]
    );
  }

  // ── Contribution tracking ───────────────────────────────────────────────────

  /**
   * Boost a member's contribution score when they do something for the group
   * (trade with members, defend territory, gather resources near territory).
   */
  async recordContribution(agentId: string, groupId: string, amount: number): Promise<void> {
    await execute(
      `UPDATE social.group_members
       SET contribution_score = contribution_score + $1
       WHERE group_id = $2 AND agent_id = $3`,
      [amount, groupId, agentId]
    );
  }

  // ── Query helpers ────────────────────────────────────────────────────────────

  async getGroup(groupId: string): Promise<Group | null> {
    return queryOne<Group>(
      `SELECT * FROM social.groups WHERE group_id = $1`,
      [groupId]
    );
  }

  async getGroupMembers(groupId: string): Promise<Array<GroupMember & { name: string }>> {
    return query<GroupMember & { name: string }>(
      `SELECT gm.*, a.name
       FROM social.group_members gm
       JOIN agents.agents a ON a.agent_id = gm.agent_id
       WHERE gm.group_id = $1
       ORDER BY gm.contribution_score DESC`,
      [groupId]
    );
  }

  async getAgentGroup(agentId: string): Promise<Group | null> {
    return queryOne<Group>(
      `SELECT g.* FROM social.groups g
       JOIN agents.agents a ON a.group_id = g.group_id
       WHERE a.agent_id = $1 AND g.status = 'active'`,
      [agentId]
    );
  }

  async getWorldGroups(worldId: string): Promise<Group[]> {
    return query<Group>(
      `SELECT * FROM social.groups
       WHERE world_id = $1 AND status = 'active'
       ORDER BY member_count DESC`,
      [worldId]
    );
  }

  async getNearbyGroups(worldId: string, x: number, y: number, radius: number): Promise<Array<Group & { member_count: number }>> {
    return query<Group & { member_count: number }>(
      `SELECT * FROM social.groups
       WHERE world_id = $1 AND status = 'active'
         AND territory_x IS NOT NULL
         AND ABS(territory_x - $2) <= $4
         AND ABS(territory_y - $3) <= $4
       ORDER BY ABS(territory_x - $2) + ABS(territory_y - $3) ASC
       LIMIT 5`,
      [worldId, x, y, radius]
    );
  }

  // ── Private utilities ────────────────────────────────────────────────────────

  private deriveGroupValues(founder: Agent): Record<string, number> {
    const t = founder.traits;
    return {
      cooperation:  Math.round((t.empathy + t.fairness) / 2),
      ambition:     Math.round(t.ambition),
      aggression:   Math.round(t.aggression),
      curiosity:    Math.round(t.curiosity),
      loyalty:      Math.round(t.loyalty),
    };
  }

  private async pickColour(worldId: string): Promise<string> {
    const usedColours = await query<{ colour: string }>(
      `SELECT colour FROM social.groups WHERE world_id = $1 AND status = 'active'`,
      [worldId]
    );
    const usedSet = new Set(usedColours.map(r => r.colour));
    return GROUP_COLOURS.find(c => !usedSet.has(c)) ?? GROUP_COLOURS[Math.floor(Math.random() * GROUP_COLOURS.length)];
  }
}
