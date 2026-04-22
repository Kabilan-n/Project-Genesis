import { query, queryOne, execute } from '../db.js';
import type { Agent } from '../types.js';

export interface Technology {
  tech_id: string;
  world_id: string;
  group_id?: string;
  name: string;
  description?: string;
  tech_tier: number;
  required_skills: Array<{ skill: string; min_level: number }>;
  unlocks_actions: string[];
  unlocks_bonus: Record<string, number>;
  discovered_by?: string;
  discovered_tick: number;
  discovered_day: number;
  is_lost: boolean;
}

/**
 * Technology tree definition.
 * Each tech has prerequisite skills (any group member may satisfy them)
 * and unlocks new action verbs + stat bonuses.
 */
const TECH_TREE: Array<{
  name: string;
  description: string;
  tier: number;
  required_skills: Array<{ skill: string; min_level: number }>;
  unlocks_actions: string[];
  unlocks_bonus: Record<string, number>;
}> = [
  // Tier 1 — Primitive
  {
    name: 'Fire Making',
    description: 'Master the art of creating fire for warmth, cooking, and signalling.',
    tier: 1,
    required_skills: [{ skill: 'survival', min_level: 10 }],
    unlocks_actions: ['make_fire', 'cook_food'],
    unlocks_bonus: { food_nutrition_mult: 1.3, cold_resist: 0.5 },
  },
  {
    name: 'Stone Knapping',
    description: 'Shape stones into cutting tools and weapons.',
    tier: 1,
    required_skills: [{ skill: 'crafting', min_level: 10 }],
    unlocks_actions: ['craft_tool'],
    unlocks_bonus: { gathering_speed: 1.2, combat_power_bonus: 5 },
  },
  {
    name: 'Basket Weaving',
    description: 'Create containers from plant fibres to carry more resources.',
    tier: 1,
    required_skills: [{ skill: 'crafting', min_level: 5 }],
    unlocks_actions: ['craft_container'],
    unlocks_bonus: { carry_capacity_bonus: 50 },
  },

  // Tier 2 — Agricultural
  {
    name: 'Agriculture',
    description: 'Cultivate crops systematically to ensure food security.',
    tier: 2,
    required_skills: [{ skill: 'farming', min_level: 20 }, { skill: 'survival', min_level: 15 }],
    unlocks_actions: ['plant_crop', 'harvest'],
    unlocks_bonus: { food_yield_mult: 1.8, farm_efficiency: 1.5 },
  },
  {
    name: 'Animal Husbandry',
    description: 'Domesticate and breed animals for food and labour.',
    tier: 2,
    required_skills: [{ skill: 'farming', min_level: 25 }],
    unlocks_actions: ['tame_animal', 'breed_animal'],
    unlocks_bonus: { food_production_bonus: 20, leather_yield: 1.5 },
  },
  {
    name: 'Pottery',
    description: 'Create clay vessels for water storage and preservation.',
    tier: 2,
    required_skills: [{ skill: 'crafting', min_level: 20 }],
    unlocks_actions: ['craft_vessel'],
    unlocks_bonus: { water_storage_bonus: 100, food_spoil_resist: 0.3 },
  },

  // Tier 3 — Metalworking & Writing
  {
    name: 'Metallurgy',
    description: 'Smelt ore into metal tools and weapons.',
    tier: 3,
    required_skills: [{ skill: 'crafting', min_level: 40 }, { skill: 'mining', min_level: 30 }],
    unlocks_actions: ['smelt_ore', 'forge_weapon'],
    unlocks_bonus: { combat_power_bonus: 20, tool_durability: 2.0 },
  },
  {
    name: 'Writing',
    description: 'Develop a symbol system to record knowledge and laws.',
    tier: 3,
    required_skills: [{ skill: 'literacy', min_level: 30 }, { skill: 'analytical', min_level: 25 }],
    unlocks_actions: ['write_record', 'teach_reading'],
    unlocks_bonus: { knowledge_retention: 0.2, myth_believability: 0.15 },
  },

  // Tier 4 — Organisational
  {
    name: 'Currency System',
    description: 'Establish a standardised medium of exchange.',
    tier: 4,
    required_skills: [{ skill: 'trading', min_level: 40 }, { skill: 'literacy', min_level: 35 }],
    unlocks_actions: ['mint_currency', 'establish_market'],
    unlocks_bonus: { trade_efficiency: 0.3, market_range_bonus: 5 },
  },
  {
    name: 'Military Tactics',
    description: 'Coordinate group combat for tactical advantage.',
    tier: 4,
    required_skills: [{ skill: 'combat', min_level: 40 }, { skill: 'leadership', min_level: 30 }],
    unlocks_actions: ['coordinated_raid', 'form_legion'],
    unlocks_bonus: { group_combat_mult: 1.4, siege_power: 1.5 },
  },

  // Tier 5 — Advanced Civilisation
  {
    name: 'Philosophy',
    description: 'Develop systematic moral and logical frameworks.',
    tier: 5,
    required_skills: [{ skill: 'analytical', min_level: 60 }, { skill: 'literacy', min_level: 50 }],
    unlocks_actions: ['debate', 'write_philosophy'],
    unlocks_bonus: { belief_spread_mult: 1.5, conviction_decay_resist: 0.5 },
  },
  {
    name: 'Engineering',
    description: 'Advanced construction principles enabling large-scale structures.',
    tier: 5,
    required_skills: [{ skill: 'construction', min_level: 60 }, { skill: 'analytical', min_level: 50 }],
    unlocks_actions: ['build_wall', 'build_aqueduct'],
    unlocks_bonus: { structure_hp_mult: 2.0, build_speed_mult: 1.5 },
  },
];

/**
 * TechnologyEngine — Phase 5 Civilisation
 *
 * Manages tech discovery and progression:
 *   - `checkDiscoveries`   — called after skill XP gain; check if new techs are unlockable
 *   - `discoverTech`       — agent/group unlocks a technology
 *   - `spreadTech`         — share technology with another group (trade/alliance)
 *   - `checkTechLoss`      — tech can be lost when the discoverer dies with no other knowledgeable member
 *   - `getUnlockedActions` — get all action verbs unlocked for a group
 *   - `getAvailableTechs`  — what techs a group is close to discovering
 */
export class TechnologyEngine {

  // ── Discovery ─────────────────────────────────────────────────────────────────

  /**
   * checkDiscoveries — called when agent gains skill XP.
   * Checks all TECH_TREE entries the agent's group hasn't discovered yet.
   */
  async checkDiscoveries(
    agent: Agent,
    worldId: string,
    tick: number,
    day: number
  ): Promise<Technology[]> {
    if (!agent.group_id) return [];

    const discovered: Technology[] = [];

    // Get all techs already known by this group
    const knownTechs = await query<{ name: string }>(
      `SELECT t.name FROM civilisation.technologies t
       JOIN civilisation.group_technologies gt ON gt.tech_id = t.tech_id
       WHERE gt.group_id = $1`,
      [agent.group_id]
    );
    const knownNames = new Set(knownTechs.map(t => t.name));

    // Get this agent's skills
    const skills = await query<{ skill_name: string; level: number }>(
      `SELECT skill_name, level FROM agents.agent_skills WHERE agent_id = $1`,
      [agent.agent_id]
    );
    const skillMap = new Map(skills.map(s => [s.skill_name, s.level]));

    for (const techDef of TECH_TREE) {
      if (knownNames.has(techDef.name)) continue;

      // Check if this agent alone satisfies all prerequisites
      const qualifies = techDef.required_skills.every(req => {
        const agentLevel = skillMap.get(req.skill) ?? 0;
        return agentLevel >= req.min_level;
      });

      if (qualifies) {
        const tech = await this.discoverTech(agent, techDef, worldId, tick, day);
        if (tech) discovered.push(tech);
      }
    }

    return discovered;
  }

  private async discoverTech(
    agent: Agent,
    techDef: typeof TECH_TREE[number],
    worldId: string,
    tick: number,
    day: number
  ): Promise<Technology | null> {
    const tech = await queryOne<Technology>(
      `INSERT INTO civilisation.technologies
         (world_id, group_id, name, description, tech_tier,
          required_skills, unlocks_actions, unlocks_bonus,
          discovered_by, discovered_tick, discovered_day)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (world_id, group_id, name) DO NOTHING
       RETURNING *`,
      [
        worldId,
        agent.group_id ?? null,
        techDef.name,
        techDef.description,
        techDef.tier,
        JSON.stringify(techDef.required_skills),
        techDef.unlocks_actions,
        JSON.stringify(techDef.unlocks_bonus),
        agent.agent_id,
        tick,
        day,
      ]
    );
    if (!tech) return null;

    // Link to group
    if (agent.group_id) {
      await execute(
        `INSERT INTO civilisation.group_technologies (group_id, tech_id, adopted_tick)
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [agent.group_id, tech.tech_id, tick]
      );
    }

    // Add to agent's known_tech_ids
    await execute(
      `UPDATE agents.agents SET known_tech_ids = array_append(known_tech_ids, $2::uuid)
       WHERE agent_id = $1`,
      [agent.agent_id, tech.tech_id]
    );

    return tech;
  }

  // ── Tech spreading ────────────────────────────────────────────────────────────

  /**
   * spreadTech — share a technology with another group via alliance/trade.
   * Both groups must have an active alliance or resource_sharing treaty.
   */
  async spreadTech(
    sourceTechId: string,
    sourceGroupId: string,
    targetGroupId: string,
    worldId: string,
    tick: number
  ): Promise<boolean> {
    // Check alliance treaty
    const treaty = await queryOne<{ treaty_id: string }>(
      `SELECT treaty_id FROM conflict.treaties
       WHERE ((group_a_id = $1 AND group_b_id = $2) OR (group_a_id = $2 AND group_b_id = $1))
         AND treaty_type IN ('alliance', 'resource_sharing')
         AND status = 'active'`,
      [sourceGroupId, targetGroupId]
    );
    if (!treaty) return false;

    // Add tech to target group
    await execute(
      `INSERT INTO civilisation.group_technologies (group_id, tech_id, adopted_tick)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [targetGroupId, sourceTechId, tick]
    );

    return true;
  }

  // ── Tech loss ─────────────────────────────────────────────────────────────────

  /**
   * checkTechLoss — called when an agent dies.
   * If the dead agent was the only one who knew a unique tech, it may be lost.
   */
  async checkTechLoss(
    deadAgentId: string,
    groupId: string | null,
    worldId: string
  ): Promise<Technology[]> {
    if (!groupId) return [];

    const lost: Technology[] = [];

    // Find techs discovered by this agent
    const agentTechs = await query<Technology>(
      `SELECT t.* FROM civilisation.technologies t
       WHERE t.discovered_by = $1 AND t.is_lost = FALSE`,
      [deadAgentId]
    );

    for (const tech of agentTechs) {
      // Check if any other group member has this tech (knows it)
      const otherKnowers = await queryOne<{ count: number }>(
        `SELECT COUNT(*) as count
         FROM agents.agents
         WHERE group_id = $1
           AND status = 'alive'
           AND agent_id != $2
           AND $3 = ANY(known_tech_ids)`,
        [groupId, deadAgentId, tech.tech_id]
      );

      if (!otherKnowers || otherKnowers.count === 0) {
        // Tech is lost — small chance recovery (5%)
        if (Math.random() > 0.05) {
          await execute(
            `UPDATE civilisation.technologies SET is_lost = TRUE WHERE tech_id = $1`,
            [tech.tech_id]
          );
          lost.push(tech);
        }
      }
    }

    return lost;
  }

  // ── Query helpers ─────────────────────────────────────────────────────────────

  async getGroupTechs(groupId: string): Promise<Technology[]> {
    return query<Technology>(
      `SELECT t.* FROM civilisation.technologies t
       JOIN civilisation.group_technologies gt ON gt.tech_id = t.tech_id
       WHERE gt.group_id = $1 AND t.is_lost = FALSE`,
      [groupId]
    );
  }

  async getUnlockedActions(groupId: string): Promise<string[]> {
    const techs = await this.getGroupTechs(groupId);
    const actions = new Set<string>();
    for (const tech of techs) {
      for (const action of tech.unlocks_actions) {
        actions.add(action);
      }
    }
    return Array.from(actions);
  }

  async getGroupBonuses(groupId: string): Promise<Record<string, number>> {
    const techs = await this.getGroupTechs(groupId);
    const combined: Record<string, number> = {};
    for (const tech of techs) {
      for (const [key, val] of Object.entries(tech.unlocks_bonus)) {
        combined[key] = (combined[key] ?? 1) * (typeof val === 'number' ? val : 1);
      }
    }
    return combined;
  }

  async getAvailableTechs(groupId: string, worldId: string): Promise<Array<typeof TECH_TREE[number] & { missing_skills: string[] }>> {
    const knownTechs = await query<{ name: string }>(
      `SELECT t.name FROM civilisation.technologies t
       JOIN civilisation.group_technologies gt ON gt.tech_id = t.tech_id
       WHERE gt.group_id = $1`,
      [groupId]
    );
    const knownNames = new Set(knownTechs.map(t => t.name));

    // Get all group member skills (max level per skill across all members)
    const groupSkills = await query<{ skill_name: string; level: number }>(
      `SELECT skill_name, MAX(level) as level
       FROM agents.agent_skills
       WHERE agent_id IN (
         SELECT agent_id FROM social.group_members WHERE group_id = $1
       )
       GROUP BY skill_name`,
      [groupId]
    );
    const skillMap = new Map(groupSkills.map(s => [s.skill_name, s.level]));

    return TECH_TREE
      .filter(t => !knownNames.has(t.name))
      .map(t => ({
        ...t,
        missing_skills: t.required_skills
          .filter(req => (skillMap.get(req.skill) ?? 0) < req.min_level)
          .map(req => `${req.skill} (need ${req.min_level}, have ${skillMap.get(req.skill) ?? 0})`),
      }))
      .filter(t => t.missing_skills.length <= 2) // only show close ones
      .sort((a, b) => a.tier - b.tier);
  }

  async getWorldTechs(worldId: string): Promise<Technology[]> {
    return query<Technology>(
      `SELECT * FROM civilisation.technologies WHERE world_id = $1 AND is_lost = FALSE
       ORDER BY tech_tier, discovered_tick`,
      [worldId]
    );
  }
}
