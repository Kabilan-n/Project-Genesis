import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../db.js';

/**
 * Operational metrics endpoint for soak / regression monitoring.
 *
 * The simulation's in-process counters (llmParseFailures, ticksSkipped,
 * circuit-breaker state) live inside its own Node process and aren't
 * directly accessible from the API. So this endpoint reports what the
 * API CAN see — DB-derived state — which is the right shape for soak
 * tests anyway:
 *
 *   - alive / dead agent counts, plus cause-of-death breakdown
 *   - event throughput over the last hour, day, and total
 *   - conversation / trade / war / skirmish counters
 *   - chronicle count + most recent era
 *   - current tick + how long since the last tick advanced
 *
 * Phase 9 / Task 9.1 polls this endpoint every minute and writes to CSV.
 * No auth — same trust model as /health and /config. Allowlisted from
 * rate limit so the soak monitor doesn't trip it.
 */
export async function metricsRoutes(app: FastifyInstance) {
  app.get('/metrics', {
    config: { rateLimit: false },
  }, async () => {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo  = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Run everything in parallel — these are independent reads.
    const [
      worldStats,
      agentCounts,
      deathBreakdown,
      eventsLastHour,
      eventsLastDay,
      eventsTotal,
      conversationCount,
      tradeCount,
      warCount,
      skirmishCount,
      chronicleCount,
      latestChronicle,
    ] = await Promise.all([
      query<{ world_id: string; current_tick: number; last_advanced_at: string | null; status: string }>(
        `SELECT world_id, current_tick, last_advanced_at, status FROM worlds.worlds`,
      ),
      query<{ world_id: string; status: string; count: number }>(
        `SELECT world_id, status, COUNT(*)::int as count
         FROM agents.agents
         GROUP BY world_id, status`,
      ),
      query<{ cause: string; count: number }>(
        `SELECT
           COALESCE(consequences->>'cause', 'unknown') as cause,
           COUNT(*)::int as count
         FROM events.events
         WHERE event_type = 'death'
         GROUP BY cause`,
      ),
      queryOne<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM events.events WHERE created_at >= $1`,
        [oneHourAgo],
      ),
      queryOne<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM events.events WHERE created_at >= $1`,
        [oneDayAgo],
      ),
      queryOne<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM events.events`,
      ),
      queryOne<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM social.conversations`,
      ),
      queryOne<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM economy.trades`,
      ),
      queryOne<{ count: number; active: number }>(
        `SELECT
           COUNT(*)::int as count,
           COUNT(*) FILTER (WHERE status = 'active')::int as active
         FROM conflict.wars`,
      ),
      queryOne<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM conflict.skirmishes`,
      ),
      queryOne<{ count: number }>(
        `SELECT COUNT(*)::int as count FROM civilisation.chronicles`,
      ),
      queryOne<{ era_name: string; era_end_day: number; generated_tick: number }>(
        `SELECT era_name, era_end_day, generated_tick
         FROM civilisation.chronicles
         ORDER BY generated_tick DESC LIMIT 1`,
      ),
    ]);

    return {
      timestamp: now.toISOString(),
      worlds: worldStats.map((w) => ({
        world_id: w.world_id,
        current_tick: w.current_tick,
        last_advanced_at: w.last_advanced_at,
        tick_age_seconds: w.last_advanced_at
          ? Math.round((now.getTime() - new Date(w.last_advanced_at).getTime()) / 1000)
          : null,
        status: w.status,
      })),
      agents: {
        by_world_and_status: agentCounts,
        deaths_by_cause: deathBreakdown,
      },
      events: {
        last_hour: eventsLastHour?.count ?? 0,
        last_day:  eventsLastDay?.count ?? 0,
        total:     eventsTotal?.count ?? 0,
      },
      conversations: conversationCount?.count ?? 0,
      trades: tradeCount?.count ?? 0,
      wars: {
        total: warCount?.count ?? 0,
        active: warCount?.active ?? 0,
      },
      skirmishes: skirmishCount?.count ?? 0,
      chronicles: {
        count: chronicleCount?.count ?? 0,
        latest: latestChronicle ?? null,
      },
    };
  });
}
