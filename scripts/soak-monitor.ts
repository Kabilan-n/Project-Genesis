#!/usr/bin/env tsx
/**
 * Soak-test monitor (Phase 9 / Task 9.1).
 *
 * Polls GET /metrics every N seconds and appends each sample to a CSV
 * file. Also captures process RSS for the simulation if a pid file is
 * available, so memory growth can be plotted alongside DB-level stats.
 *
 * Usage:
 *   tsx scripts/soak-monitor.ts \
 *     --api http://localhost:3001 \
 *     --interval 60 \
 *     --out docs/soak/soak-$(date +%Y%m%d-%H%M).csv
 *
 * Run for ≥24h alongside the simulation. Stop with Ctrl+C; the CSV is
 * flushed continuously so partial runs are still usable.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';

interface Args {
  api: string;
  interval: number;
  out: string;
}

function parseArgs(argv: string[]): Args {
  const args: Partial<Args> = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--api')      args.api = argv[++i];
    else if (a === '--interval') args.interval = parseInt(argv[++i], 10);
    else if (a === '--out') args.out = argv[++i];
  }
  return {
    api:      args.api      ?? 'http://localhost:3001',
    interval: args.interval ?? 60,
    out:      args.out      ?? `docs/soak/soak-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
  };
}

const CSV_HEADER = [
  'timestamp_iso',
  'tick_age_s',
  'current_tick',
  'alive_agents',
  'dead_agents',
  'events_last_hour',
  'events_last_day',
  'events_total',
  'conversations',
  'trades',
  'wars_total',
  'wars_active',
  'skirmishes',
  'chronicles',
  'rss_mb',
].join(',') + '\n';

interface MetricsResponse {
  timestamp: string;
  worlds: Array<{ current_tick: number; tick_age_seconds: number | null }>;
  agents: { by_world_and_status: Array<{ status: string; count: number }> };
  events: { last_hour: number; last_day: number; total: number };
  conversations: number;
  trades: number;
  wars: { total: number; active: number };
  skirmishes: number;
  chronicles: { count: number };
}

function csvRow(m: MetricsResponse, rssMb: number): string {
  const firstWorld = m.worlds[0] ?? { current_tick: 0, tick_age_seconds: null };
  const alive = m.agents.by_world_and_status
    .filter((r) => r.status === 'alive').reduce((s, r) => s + r.count, 0);
  const dead = m.agents.by_world_and_status
    .filter((r) => r.status === 'dead').reduce((s, r) => s + r.count, 0);
  return [
    m.timestamp,
    firstWorld.tick_age_seconds ?? '',
    firstWorld.current_tick,
    alive,
    dead,
    m.events.last_hour,
    m.events.last_day,
    m.events.total,
    m.conversations,
    m.trades,
    m.wars.total,
    m.wars.active,
    m.skirmishes,
    m.chronicles.count,
    rssMb.toFixed(1),
  ].join(',') + '\n';
}

async function sample(api: string): Promise<MetricsResponse | null> {
  try {
    const res = await fetch(`${api}/metrics`);
    if (!res.ok) {
      console.warn(`[soak] /metrics returned ${res.status}`);
      return null;
    }
    return await res.json() as MetricsResponse;
  } catch (err) {
    console.warn('[soak] /metrics fetch failed:', err);
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const dir = dirname(args.out);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(args.out)) writeFileSync(args.out, CSV_HEADER, 'utf8');

  console.log(`[soak] polling ${args.api}/metrics every ${args.interval}s → ${args.out}`);
  console.log(`[soak] Ctrl+C to stop. Partial CSV is flushed continuously.`);

  let running = true;
  process.on('SIGINT',  () => { running = false; });
  process.on('SIGTERM', () => { running = false; });

  while (running) {
    const m = await sample(args.api);
    if (m) {
      const rssMb = process.memoryUsage().rss / 1024 / 1024;
      appendFileSync(args.out, csvRow(m, rssMb), 'utf8');
    }
    await new Promise((r) => setTimeout(r, args.interval * 1000));
  }
  console.log('[soak] stopped.');
}

main().catch((err) => {
  console.error('[soak] fatal:', err);
  process.exit(1);
});
