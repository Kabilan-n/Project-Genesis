import { query, queryOne, execute } from '../db.js';
import Anthropic from '@anthropic-ai/sdk';
import { engineLogger } from '../observability/logger.js';

const log = engineLogger('ObserverEngine');

const MODEL = process.env.LLM_MODEL ?? 'claude-haiku-4-5';

// Take a world snapshot every N ticks
const SNAPSHOT_INTERVAL_TICKS = 360; // every 6 hours of sim time
// Keep heatmap stats per day
const STATS_PRUNE_AFTER_TICKS = 14400; // keep 10 days of per-tick stats

export interface WorldSnapshot {
  snapshot_id: string;
  world_id: string;
  tick: number;
  day: number;
  time_of_day: string;
  agent_count: number;
  alive_agents: Array<{ agent_id: string; name: string; x: number; y: number; hp: number; group_id?: string; belief_id?: string }>;
  group_states: Array<{ group_id: string; name: string; member_count: number; at_war_with: string[] }>;
  active_wars: Array<{ war_id: string; aggressor: string; defender: string; status: string }>;
}

export interface AgentBiography {
  biography_id?: string;
  world_id: string;
  agent_id: string;
  narrative: string;
  generated_tick: number;
  word_count: number;
}

export interface WeatherEvent {
  weather_id: string;
  world_id: string;
  weather_type: 'drought' | 'flood' | 'storm' | 'blight' | 'abundance';
  center_x: number;
  center_y: number;
  radius: number;
  started_tick: number;
  ends_tick: number;
  severity: number;
  resource_mult: number;
  hp_drain_rate: number;
  is_active: boolean;
}

export interface SpectatorIntervention {
  intervention_id?: string;
  world_id: string;
  user_id?: string;
  intervention_type: 'drop_resource' | 'trigger_weather' | 'spawn_agent' | 'gift_tech' | 'natural_disaster';
  parameters: Record<string, unknown>;
  applied_tick: number;
  applied_day: number;
  applied: boolean;
}

/**
 * ObserverEngine — Phase 6 Observer Enrichment
 *
 * Powers the observer-facing tools:
 *   - `takeSnapshot`         — capture world state for timeline scrubber
 *   - `recordStats`          — record per-tick world statistics
 *   - `updateHeatmap`        — increment tile-level aggregates
 *   - `generateBiography`    — LLM-written agent life story
 *   - `applyIntervention`    — execute a spectator-triggered event
 *   - `triggerWeather`       — create a weather event affecting resources/HP
 *   - `applyActiveWeather`   — apply ongoing weather effects per tick
 *   - `runObserverTick`      — orchestrate all per-tick observer work
 */
export class ObserverEngine {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  // ── Main tick orchestrator ────────────────────────────────────────────────────

  async runObserverTick(worldId: string, tick: number, day: number): Promise<void> {
    // Record world stats every tick
    await this.recordStats(worldId, tick, day);

    // Take snapshot periodically
    if (tick % SNAPSHOT_INTERVAL_TICKS === 0) {
      await this.takeSnapshot(worldId, tick, day);
    }

    // Apply active weather effects
    await this.applyActiveWeather(worldId, tick);

    // Apply pending spectator interventions
    await this.applyPendingInterventions(worldId, tick, day);

    // Prune old stats to keep DB lean
    if (tick % 1440 === 0) {
      await this.pruneOldStats(worldId, tick);
    }
  }

  // ── Snapshots ─────────────────────────────────────────────────────────────────

  async takeSnapshot(worldId: string, tick: number, day: number): Promise<WorldSnapshot | null> {
    const [agents, groups, wars, world] = await Promise.all([
      query<{ agent_id: string; name: string; position_x: number; position_y: number; hp: number; group_id?: string; primary_belief_id?: string }>(
        `SELECT a.agent_id, a.name, s.position_x, s.position_y, s.hp, a.group_id, a.primary_belief_id
         FROM agents.agents a
         JOIN agents.agent_state s ON s.agent_id = a.agent_id
         WHERE a.world_id = $1 AND a.status = 'alive'`,
        [worldId]
      ),
      query<{ group_id: string; name: string; member_count: number; at_war_with: string[] }>(
        `SELECT group_id, name, member_count, at_war_with FROM social.groups
         WHERE world_id = $1 AND status = 'active'`,
        [worldId]
      ),
      query<{ war_id: string; aggressor_group_id: string; defender_group_id: string; status: string }>(
        `SELECT war_id, aggressor_group_id, defender_group_id, status
         FROM conflict.wars WHERE world_id = $1 AND status = 'active'`,
        [worldId]
      ),
      queryOne<{ time_of_day: string }>(
        `SELECT time_of_day FROM worlds.worlds WHERE world_id = $1`,
        [worldId]
      ),
    ]);

    const snapshot = await queryOne<WorldSnapshot>(
      `INSERT INTO observer.world_snapshots
         (world_id, tick, day, time_of_day, agent_count,
          alive_agents, group_states, active_wars)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (world_id, tick) DO UPDATE
         SET alive_agents = EXCLUDED.alive_agents,
             group_states = EXCLUDED.group_states,
             active_wars = EXCLUDED.active_wars
       RETURNING *`,
      [
        worldId, tick, day,
        world?.time_of_day ?? 'day',
        agents.length,
        JSON.stringify(agents.map(a => ({
          agent_id: a.agent_id, name: a.name,
          x: a.position_x, y: a.position_y,
          hp: a.hp, group_id: a.group_id ?? null,
          belief_id: a.primary_belief_id ?? null,
        }))),
        JSON.stringify(groups),
        JSON.stringify(wars.map(w => ({
          war_id: w.war_id,
          aggressor: w.aggressor_group_id,
          defender: w.defender_group_id,
          status: w.status,
        }))),
      ]
    );

    return snapshot ?? null;
  }

  // ── Stats recording ───────────────────────────────────────────────────────────

  async recordStats(worldId: string, tick: number, day: number): Promise<void> {
    const stats = await queryOne<{
      alive_count: number; dead_count: number;
      avg_hp: number; avg_food: number; avg_water: number; avg_belonging: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'alive') AS alive_count,
         COUNT(*) FILTER (WHERE status = 'dead')  AS dead_count,
         AVG(s.hp)             AS avg_hp,
         AVG(s.need_food)      AS avg_food,
         AVG(s.need_water)     AS avg_water,
         AVG(s.need_belonging) AS avg_belonging
       FROM agents.agents a
       LEFT JOIN agents.agent_state s ON s.agent_id = a.agent_id
       WHERE a.world_id = $1`,
      [worldId]
    );

    const [groupCount, warCount, beliefCount, structureCount, marketCount] = await Promise.all([
      queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM social.groups WHERE world_id = $1 AND status = 'active'`, [worldId]),
      queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM conflict.wars WHERE world_id = $1 AND status = 'active'`, [worldId]),
      queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM culture.belief_systems WHERE world_id = $1 AND is_extinct = FALSE`, [worldId]),
      queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM civilisation.structures WHERE world_id = $1 AND is_complete = TRUE`, [worldId]),
      queryOne<{ count: number }>(`SELECT COUNT(*) AS count FROM civilisation.markets WHERE world_id = $1 AND is_open = TRUE`, [worldId]),
    ]);

    await execute(
      `INSERT INTO observer.world_stats
         (world_id, tick, day, alive_count, dead_count, avg_hp, avg_food, avg_water,
          avg_belonging, group_count, war_count, belief_count, structure_count, market_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (world_id, tick) DO NOTHING`,
      [
        worldId, tick, day,
        stats?.alive_count ?? 0, stats?.dead_count ?? 0,
        stats?.avg_hp ?? 0, stats?.avg_food ?? 0, stats?.avg_water ?? 0,
        stats?.avg_belonging ?? 0,
        groupCount?.count ?? 0, warCount?.count ?? 0,
        beliefCount?.count ?? 0, structureCount?.count ?? 0,
        marketCount?.count ?? 0,
      ]
    );
  }

  // ── Heatmap ───────────────────────────────────────────────────────────────────

  async updateHeatmap(
    worldId: string,
    x: number,
    y: number,
    day: number,
    field: 'population_ticks' | 'extraction_count' | 'skirmish_count' | 'ritual_count',
    increment = 1
  ): Promise<void> {
    await execute(
      `INSERT INTO observer.heatmap_data (world_id, x, y, day)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (world_id, x, y, day) DO NOTHING`,
      [worldId, x, y, day]
    );
    await execute(
      `UPDATE observer.heatmap_data SET ${field} = ${field} + $4
       WHERE world_id = $1 AND x = $2 AND y = $3 AND day = $4`,
      [worldId, x, y, day, increment]
    );
  }

  async getHeatmapData(worldId: string, day: number, field: string): Promise<Array<{ x: number; y: number; value: number }>> {
    return query(
      `SELECT x, y, ${field} AS value FROM observer.heatmap_data
       WHERE world_id = $1 AND day = $2 AND ${field} > 0`,
      [worldId, day]
    );
  }

  // ── Biography generation ──────────────────────────────────────────────────────

  async generateBiography(agentId: string, worldId: string, tick: number): Promise<AgentBiography | null> {
    // Fetch agent info
    const agent = await queryOne<{
      name: string; archetype: string; status: string; birth_tick: number;
      death_tick?: number; generation: number;
    }>(
      `SELECT name, archetype, status, birth_tick, death_tick, generation
       FROM agents.agents WHERE agent_id = $1`,
      [agentId]
    );
    if (!agent) return null;

    // Fetch key life events
    const events = await query<{ title: string; summary?: string; day: number; event_type: string }>(
      `SELECT title, summary, day, event_type FROM events.events
       WHERE $1 = ANY(participant_agent_ids) AND world_id = $2
         AND significance IN ('major','moderate','historic')
       ORDER BY day ASC LIMIT 30`,
      [agentId, worldId]
    );

    // Fetch relationships
    const relationships = await query<{ other_agent_name: string; relationship_type: string; trust_score: number }>(
      `SELECT a.name AS other_agent_name, r.relationship_type, r.trust_score
       FROM social.relationships r
       JOIN agents.agents a ON a.agent_id = r.other_agent_id
       WHERE r.agent_id = $1
       ORDER BY ABS(r.trust_score - 50) DESC LIMIT 8`,
      [agentId]
    );

    // Fetch belief
    const belief = await queryOne<{ belief_name: string; conviction: number }>(
      `SELECT bs.name AS belief_name, ab.conviction
       FROM culture.agent_beliefs ab
       JOIN culture.belief_systems bs ON bs.belief_id = ab.belief_id
       WHERE ab.agent_id = $1 ORDER BY ab.conviction DESC LIMIT 1`,
      [agentId]
    );

    // Build prompt
    const ageInDays = agent.death_tick
      ? Math.floor((agent.death_tick - agent.birth_tick) / 1440)
      : Math.floor((tick - agent.birth_tick) / 1440);

    const eventLines = events.map(e => `Day ${e.day}: ${e.title}${e.summary ? ' — ' + e.summary.slice(0, 80) : ''}`).join('\n');
    const relLines = relationships.map(r => `${r.other_agent_name} (${r.relationship_type}, trust: ${r.trust_score})`).join(', ');

    const prompt = `Write a compelling biographical account of ${agent.name}, a ${agent.archetype.toLowerCase()} who lived ${ageInDays} days in a primordial world.
${agent.status === 'dead' ? 'They have since died.' : 'They are still alive.'}
${belief ? `They followed the belief "${belief.belief_name}" with ${(belief.conviction * 100).toFixed(0)}% conviction.` : ''}

KEY EVENTS IN THEIR LIFE:
${eventLines || 'No major recorded events.'}

NOTABLE RELATIONSHIPS: ${relLines || 'No strong bonds.'}

Write 2-3 paragraphs as if you are a historian describing their life. Focus on their defining moments, relationships, and legacy. Use vivid, narrative prose. Do not use bullet points.`;

    let narrative = '';
    try {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      });
      narrative = response.content[0].type === 'text' ? response.content[0].text.trim() : '';
    } catch {
      narrative = `${agent.name} lived for ${ageInDays} days as a ${agent.archetype}. Their story is one of survival and discovery in a world still finding its shape.`;
    }

    const bio = await queryOne<AgentBiography>(
      `INSERT INTO observer.agent_biographies
         (world_id, agent_id, narrative, generated_tick, word_count)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (agent_id) DO UPDATE
         SET narrative = EXCLUDED.narrative,
             generated_tick = EXCLUDED.generated_tick,
             word_count = EXCLUDED.word_count
       RETURNING *`,
      [worldId, agentId, narrative, tick, narrative.split(/\s+/).length]
    );

    return bio ?? null;
  }

  // ── Weather ───────────────────────────────────────────────────────────────────

  async triggerWeather(
    worldId: string,
    weatherType: WeatherEvent['weather_type'],
    centerX: number,
    centerY: number,
    radius: number,
    severity: number,
    durationTicks: number,
    startTick: number
  ): Promise<WeatherEvent | null> {
    const mults: Record<WeatherEvent['weather_type'], { resource_mult: number; hp_drain_rate: number }> = {
      drought:    { resource_mult: 0.3, hp_drain_rate: 0.003 },
      flood:      { resource_mult: 0.5, hp_drain_rate: 0.002 },
      storm:      { resource_mult: 0.7, hp_drain_rate: 0.005 },
      blight:     { resource_mult: 0.2, hp_drain_rate: 0.001 },
      abundance:  { resource_mult: 2.0, hp_drain_rate: 0 },
    };

    const effects = mults[weatherType];
    const scaledMult = 1 + (effects.resource_mult - 1) * severity;
    const scaledDrain = effects.hp_drain_rate * severity;

    const weather = await queryOne<WeatherEvent>(
      `INSERT INTO observer.weather_events
         (world_id, weather_type, center_x, center_y, radius,
          started_tick, ends_tick, severity, resource_mult, hp_drain_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [worldId, weatherType, centerX, centerY, radius,
       startTick, startTick + durationTicks, severity, scaledMult, scaledDrain]
    );

    // Apply resource_mult to affected nodes
    if (weather) {
      await execute(
        `UPDATE worlds.resource_nodes
         SET weather_mult = $5
         WHERE world_id = $1
           AND ABS(x - $2) <= $4 AND ABS(y - $3) <= $4`,
        [worldId, centerX, centerY, radius, scaledMult]
      );
    }

    return weather ?? null;
  }

  async applyActiveWeather(worldId: string, tick: number): Promise<void> {
    // Deactivate expired weather
    const expired = await query<WeatherEvent>(
      `UPDATE observer.weather_events SET is_active = FALSE
       WHERE world_id = $1 AND ends_tick <= $2 AND is_active = TRUE
       RETURNING *`,
      [worldId, tick]
    );

    // Restore normal resource_mult for expired weather
    for (const w of expired) {
      await execute(
        `UPDATE worlds.resource_nodes SET weather_mult = 1.0
         WHERE world_id = $1
           AND ABS(x - $2) <= $3 AND ABS(y - $4) <= $3`,
        [worldId, w.center_x, w.radius, w.center_y]
      );
    }

    // Apply HP drain from active damaging weather
    const active = await query<WeatherEvent>(
      `SELECT * FROM observer.weather_events
       WHERE world_id = $1 AND is_active = TRUE AND hp_drain_rate > 0`,
      [worldId]
    );

    for (const w of active) {
      await execute(
        `UPDATE agents.agent_state ags
         SET hp = GREATEST(0, hp - $5)
         FROM agents.agents a
         WHERE a.agent_id = ags.agent_id
           AND a.world_id = $1
           AND a.status = 'alive'
           AND ABS(ags.position_x - $2) <= $4
           AND ABS(ags.position_y - $3) <= $4`,
        [worldId, w.center_x, w.center_y, w.radius, w.hp_drain_rate]
      );
    }
  }

  // ── Spectator interventions ───────────────────────────────────────────────────

  async queueIntervention(
    worldId: string,
    userId: string,
    type: SpectatorIntervention['intervention_type'],
    params: Record<string, unknown>,
    tick: number,
    day: number
  ): Promise<SpectatorIntervention | null> {
    const intervention = await queryOne<SpectatorIntervention>(
      `INSERT INTO observer.interventions
         (world_id, user_id, intervention_type, parameters, applied_tick, applied_day)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [worldId, userId, type, JSON.stringify(params), tick, day]
    );
    return intervention ?? null;
  }

  private async applyPendingInterventions(worldId: string, tick: number, day: number): Promise<void> {
    const pending = await query<SpectatorIntervention>(
      `SELECT * FROM observer.interventions
       WHERE world_id = $1 AND applied = FALSE AND applied_tick <= $2`,
      [worldId, tick]
    );

    for (const intervention of pending) {
      try {
        await this.executeIntervention(intervention, worldId, tick, day);
        await execute(
          `UPDATE observer.interventions SET applied = TRUE WHERE intervention_id = $1`,
          [intervention.intervention_id]
        );
      } catch (err) {
        log.error({
          err: String(err), interventionId: intervention.intervention_id,
        }, 'intervention_failed');
      }
    }
  }

  private async executeIntervention(
    intervention: SpectatorIntervention,
    worldId: string,
    tick: number,
    day: number
  ): Promise<void> {
    const p = intervention.parameters;

    switch (intervention.intervention_type) {
      case 'drop_resource': {
        const { resource_type, amount, x, y } = p as { resource_type: string; amount: number; x: number; y: number };
        // Add to resource node or create temporary node
        await execute(
          `INSERT INTO worlds.resource_nodes
             (world_id, x, y, resource_type, current_amount, max_capacity, extraction_rate, regen_rate)
           VALUES ($1, $2, $3, $4, $5, $5, 10, 0)
           ON CONFLICT DO NOTHING`,
          [worldId, x, y, resource_type, amount]
        );
        break;
      }

      case 'trigger_weather': {
        const { weather_type, x, y, radius, severity, duration } = p as any;
        await this.triggerWeather(
          worldId, weather_type, x, y,
          radius ?? 8, severity ?? 0.7,
          duration ?? 720, tick
        );
        break;
      }

      case 'gift_tech': {
        const { tech_name, group_id } = p as { tech_name: string; group_id: string };
        // Find the tech
        const tech = await queryOne<{ tech_id: string }>(
          `SELECT tech_id FROM civilisation.technologies WHERE world_id = $1 AND name = $2 LIMIT 1`,
          [worldId, tech_name]
        );
        if (tech && group_id) {
          await execute(
            `INSERT INTO civilisation.group_technologies (group_id, tech_id, adopted_tick)
             VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
            [group_id, tech.tech_id, tick]
          );
        }
        break;
      }

      case 'natural_disaster': {
        const { weather_type, x, y, severity } = p as any;
        await this.triggerWeather(worldId, weather_type ?? 'storm', x, y, 15, severity ?? 0.9, 480, tick);
        break;
      }
    }
  }

  // ── Query helpers ─────────────────────────────────────────────────────────────

  async getSnapshotAtTick(worldId: string, tick: number): Promise<WorldSnapshot | null> {
    return queryOne<WorldSnapshot>(
      `SELECT * FROM observer.world_snapshots
       WHERE world_id = $1 AND tick <= $2
       ORDER BY tick DESC LIMIT 1`,
      [worldId, tick]
    );
  }

  async getSnapshotRange(worldId: string, startTick: number, endTick: number): Promise<WorldSnapshot[]> {
    return query<WorldSnapshot>(
      `SELECT * FROM observer.world_snapshots
       WHERE world_id = $1 AND tick >= $2 AND tick <= $3
       ORDER BY tick ASC`,
      [worldId, startTick, endTick]
    );
  }

  async getWorldStats(worldId: string, days = 30): Promise<Array<Record<string, unknown>>> {
    return query(
      `SELECT * FROM observer.world_stats WHERE world_id = $1
       ORDER BY tick ASC
       OFFSET (SELECT GREATEST(0, COUNT(*) - $2 * 1440) FROM observer.world_stats WHERE world_id = $1)`,
      [worldId, days]
    );
  }

  async getDailyStats(worldId: string, days = 30): Promise<Array<Record<string, unknown>>> {
    return query(
      `SELECT day,
         AVG(alive_count) AS alive_count, AVG(dead_count) AS dead_count,
         AVG(avg_hp) AS avg_hp, AVG(avg_food) AS avg_food, AVG(avg_water) AS avg_water,
         AVG(group_count) AS group_count, AVG(war_count) AS war_count,
         AVG(belief_count) AS belief_count
       FROM observer.world_stats
       WHERE world_id = $1
       GROUP BY day ORDER BY day DESC LIMIT $2`,
      [worldId, days]
    );
  }

  async getAgentBiography(agentId: string): Promise<AgentBiography | null> {
    return queryOne<AgentBiography>(
      `SELECT * FROM observer.agent_biographies WHERE agent_id = $1`,
      [agentId]
    );
  }

  async getActiveWeather(worldId: string): Promise<WeatherEvent[]> {
    return query<WeatherEvent>(
      `SELECT * FROM observer.weather_events WHERE world_id = $1 AND is_active = TRUE`,
      [worldId]
    );
  }

  async getWatchedWorlds(userId: string): Promise<Array<{ world_id: string; display_order: number; is_active: boolean }>> {
    return query(
      `SELECT world_id, display_order, is_active FROM observer.watched_worlds
       WHERE user_id = $1 ORDER BY display_order ASC`,
      [userId]
    );
  }

  async addWatchedWorld(userId: string, worldId: string): Promise<void> {
    await execute(
      `INSERT INTO observer.watched_worlds (user_id, world_id, display_order)
       VALUES ($1, $2, (SELECT COALESCE(MAX(display_order), 0) + 1 FROM observer.watched_worlds WHERE user_id = $1))
       ON CONFLICT (user_id, world_id) DO UPDATE SET is_active = TRUE`,
      [userId, worldId]
    );
  }

  private async pruneOldStats(worldId: string, tick: number): Promise<void> {
    await execute(
      `DELETE FROM observer.world_stats WHERE world_id = $1 AND tick < $2`,
      [worldId, tick - STATS_PRUNE_AFTER_TICKS]
    );
  }
}
