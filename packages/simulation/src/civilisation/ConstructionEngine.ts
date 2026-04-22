import { query, queryOne, execute } from '../db.js';
import type { Agent } from '../types.js';

export type StructureType = 'shelter' | 'farm' | 'storage' | 'watchtower' | 'market_stall' | 'temple' | 'forge' | 'library';

export interface Structure {
  structure_id: string;
  world_id: string;
  group_id?: string;
  builder_id?: string;
  x: number;
  y: number;
  structure_type: StructureType;
  name?: string;
  hp: number;
  capacity?: number;
  bonus_json: Record<string, number>;
  build_progress: number;
  is_complete: boolean;
  built_tick: number;
  built_day: number;
}

// Resource cost per structure type
const BUILD_COSTS: Record<StructureType, Record<string, number>> = {
  shelter:      { wood: 20, stone: 10 },
  farm:         { wood: 10, seeds: 5 },
  storage:      { wood: 30, stone: 20 },
  watchtower:   { wood: 25, stone: 30 },
  market_stall: { wood: 15 },
  temple:       { stone: 50, wood: 20 },
  forge:        { stone: 40, ore: 20 },
  library:      { wood: 40, parchment: 10 },
};

// Ticks to complete construction (1 tick = 1 sim-minute)
const BUILD_TIME: Record<StructureType, number> = {
  shelter:      180,  // 3 hours
  farm:         360,  // 6 hours
  storage:      240,  // 4 hours
  watchtower:   300,  // 5 hours
  market_stall: 120,  // 2 hours
  temple:       720,  // 12 hours
  forge:        480,  // 8 hours
  library:      600,  // 10 hours
};

// Stat bonuses per structure type when complete
const STRUCTURE_BONUSES: Record<StructureType, Record<string, number>> = {
  shelter:      { rest_bonus: 15, hp_recovery_mult: 1.5 },
  farm:         { food_yield_mult: 1.5, farm_radius: 3 },
  storage:      { inventory_cap_bonus: 100 },
  watchtower:   { perception_radius_bonus: 4, defense_bonus: 0.2 },
  market_stall: { trade_range_bonus: 10 },
  temple:       { belief_conviction_gain: 0.02, ritual_bonus: 1.5 },
  forge:        { tool_crafting_speed: 1.3, combat_bonus: 0.15 },
  library:      { skill_xp_mult: 1.3, knowledge_spread_bonus: 0.2 },
};

// Skill level required to build
const BUILD_SKILL_REQ: Partial<Record<StructureType, { skill: string; level: number }>> = {
  farm:    { skill: 'farming', level: 20 },
  forge:   { skill: 'crafting', level: 30 },
  library: { skill: 'literacy', level: 25 },
  temple:  { skill: 'ritual', level: 20 },
};

/**
 * ConstructionEngine — Phase 5 Civilisation
 *
 * Manages the building of persistent structures on map tiles:
 *   - `startConstruction`   — agent begins building; deducts resources
 *   - `advanceConstruction` — each tick the builder contributes progress
 *   - `completeConstruction` — apply bonuses, update tile state
 *   - `applyStructureBonuses` — called during agent actions to grant benefits
 *   - `damageStructure`     — raids/weather can degrade structures
 */
export class ConstructionEngine {

  // ── Starting a build ──────────────────────────────────────────────────────────

  async startConstruction(
    builder: Agent,
    structureType: StructureType,
    x: number,
    y: number,
    name: string,
    worldId: string,
    tick: number,
    day: number
  ): Promise<Structure | null> {
    // Check tile is passable and not already occupied
    const tile = await queryOne<{ is_passable: boolean; structure_id: string | null }>(
      `SELECT is_passable, structure_id FROM worlds.map_tiles
       WHERE world_id = $1 AND x = $2 AND y = $3`,
      [worldId, x, y]
    );
    if (!tile?.is_passable || tile.structure_id) return null;

    // Check skill requirement
    const req = BUILD_SKILL_REQ[structureType];
    if (req) {
      const skill = await queryOne<{ level: number }>(
        `SELECT level FROM agents.agent_skills WHERE agent_id = $1 AND skill_name = $2`,
        [builder.agent_id, req.skill]
      );
      if (!skill || skill.level < req.level) return null;
    }

    // Check and deduct resources
    const costs = BUILD_COSTS[structureType];
    for (const [resource, amount] of Object.entries(costs)) {
      const inv = await queryOne<{ amount: number }>(
        `SELECT amount FROM economy.inventory WHERE agent_id = $1 AND resource_type = $2`,
        [builder.agent_id, resource]
      );
      if (!inv || inv.amount < amount) return null; // insufficient resources
    }

    // Deduct resources
    for (const [resource, amount] of Object.entries(costs)) {
      await execute(
        `UPDATE economy.inventory SET amount = amount - $3
         WHERE agent_id = $1 AND resource_type = $2`,
        [builder.agent_id, resource, amount]
      );
    }

    const structure = await queryOne<Structure>(
      `INSERT INTO civilisation.structures
         (world_id, group_id, builder_id, x, y, structure_type, name,
          bonus_json, build_progress, is_complete, built_tick, built_day)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,FALSE,$9,$10)
       ON CONFLICT (world_id, x, y, structure_type) DO NOTHING
       RETURNING *`,
      [
        worldId, builder.group_id ?? null, builder.agent_id,
        x, y, structureType, name,
        JSON.stringify(STRUCTURE_BONUSES[structureType]),
        tick, day,
      ]
    );
    if (!structure) return null;

    // Mark tile as having a structure (in progress)
    await execute(
      `UPDATE worlds.map_tiles SET has_structure = TRUE, structure_id = $3
       WHERE world_id = $1 AND x = $2`,
      [worldId, `(${x},${y})`, structure.structure_id]
    );
    // Correct parameterized query for tile update
    await execute(
      `UPDATE worlds.map_tiles SET has_structure = TRUE, structure_id = $4
       WHERE world_id = $1 AND x = $2 AND y = $3`,
      [worldId, x, y, structure.structure_id]
    );

    return structure;
  }

  // ── Advancing progress ────────────────────────────────────────────────────────

  /**
   * advanceConstruction — called when agent uses 'build' action.
   * Each call adds 1 / BUILD_TIME progress (completes in BUILD_TIME 'build' actions).
   */
  async advanceConstruction(
    builder: Agent,
    structureId: string,
    worldId: string,
    tick: number
  ): Promise<{ progress: number; completed: boolean }> {
    const structure = await queryOne<Structure>(
      `SELECT * FROM civilisation.structures WHERE structure_id = $1 AND is_complete = FALSE`,
      [structureId]
    );
    if (!structure) return { progress: 0, completed: false };

    const buildTime = BUILD_TIME[structure.structure_type];
    const increment = 1 / buildTime;
    const newProgress = Math.min(1, structure.build_progress + increment);
    const completed   = newProgress >= 1;

    await execute(
      `UPDATE civilisation.structures
       SET build_progress = $2, is_complete = $3
       WHERE structure_id = $1`,
      [structureId, newProgress, completed]
    );

    if (completed) {
      await this.onConstructionComplete(structure, tick);
    }

    // Gain construction XP
    await execute(
      `INSERT INTO agents.agent_skills (agent_id, skill_name, level, xp)
       VALUES ($1, 'construction', 0, 5)
       ON CONFLICT (agent_id, skill_name)
       DO UPDATE SET
         xp = agents.agent_skills.xp + 5,
         level = LEAST(100, agents.agent_skills.level + CASE WHEN agents.agent_skills.xp + 5 >= agents.agent_skills.level * 10 THEN 1 ELSE 0 END)`,
      [builder.agent_id]
    );

    return { progress: newProgress, completed };
  }

  private async onConstructionComplete(structure: Structure, tick: number): Promise<void> {
    // Capacity bonuses
    let capacity: number | null = null;
    if (structure.structure_type === 'storage') capacity = 200;
    else if (structure.structure_type === 'farm') capacity = 50;

    if (capacity !== null) {
      await execute(
        `UPDATE civilisation.structures SET capacity = $2 WHERE structure_id = $1`,
        [structure.structure_id, capacity]
      );
    }

    console.log(`[ConstructionEngine] ${structure.structure_type} completed at (${structure.x}, ${structure.y}) — tick ${tick}`);
  }

  // ── Structure benefits (called per tick when agent is on tile) ────────────────

  /**
   * applyStructureBonuses — called when agent is resting/gathering on a structured tile.
   * Returns the bonus values that were applied.
   */
  async applyStructureBonuses(
    agentId: string,
    x: number,
    y: number,
    worldId: string,
    activity: string
  ): Promise<Record<string, number>> {
    const structure = await queryOne<Structure>(
      `SELECT s.* FROM civilisation.structures s
       WHERE s.world_id = $1 AND s.x = $2 AND s.y = $3 AND s.is_complete = TRUE`,
      [worldId, x, y]
    );
    if (!structure) return {};

    const applied: Record<string, number> = {};

    // Apply rest bonus when sleeping in shelter
    if (structure.structure_type === 'shelter' && activity === 'resting') {
      const restBonus = structure.bonus_json.rest_bonus ?? 0;
      if (restBonus > 0) {
        await execute(
          `UPDATE agents.agent_state SET need_rest = LEAST(100, need_rest + $2) WHERE agent_id = $1`,
          [agentId, restBonus * 0.01] // applied as fraction per tick
        );
        applied.rest_bonus = restBonus;
      }
    }

    // Farm boost when gathering food nearby
    if (structure.structure_type === 'farm' && activity.startsWith('gathering_food')) {
      const mult = structure.bonus_json.food_yield_mult ?? 1;
      applied.food_yield_mult = mult;
      // Return the mult — WorldEngine should apply it during resource extraction
    }

    return applied;
  }

  // ── Damage ────────────────────────────────────────────────────────────────────

  async damageStructure(structureId: string, damage: number): Promise<boolean> {
    const result = await queryOne<{ hp: number }>(
      `UPDATE civilisation.structures SET hp = GREATEST(0, hp - $2)
       WHERE structure_id = $1
       RETURNING hp`,
      [structureId, damage]
    );

    if (result && result.hp <= 0) {
      // Structure destroyed
      await execute(
        `UPDATE worlds.map_tiles SET has_structure = FALSE, structure_id = NULL
         WHERE structure_id = $1`,
        [structureId]
      );
      await execute(
        `DELETE FROM civilisation.structures WHERE structure_id = $1`,
        [structureId]
      );
      return true; // destroyed
    }
    return false;
  }

  // ── Query helpers ─────────────────────────────────────────────────────────────

  async getStructuresForWorld(worldId: string): Promise<Structure[]> {
    return query<Structure>(
      `SELECT * FROM civilisation.structures WHERE world_id = $1 AND is_complete = TRUE`,
      [worldId]
    );
  }

  async getStructureAt(worldId: string, x: number, y: number): Promise<Structure | null> {
    return queryOne<Structure>(
      `SELECT * FROM civilisation.structures
       WHERE world_id = $1 AND x = $2 AND y = $3 AND is_complete = TRUE`,
      [worldId, x, y]
    );
  }

  async getStructuresForGroup(groupId: string): Promise<Structure[]> {
    return query<Structure>(
      `SELECT * FROM civilisation.structures WHERE group_id = $1`,
      [groupId]
    );
  }

  getBuildCosts(structureType: StructureType): Record<string, number> {
    return BUILD_COSTS[structureType] ?? {};
  }

  getBuildableTypes(): StructureType[] {
    return Object.keys(BUILD_COSTS) as StructureType[];
  }
}
