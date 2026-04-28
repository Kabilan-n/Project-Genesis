import dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });
import Redis from 'ioredis';
import { WorldEngine } from './world/WorldEngine.js';
import { AgentEngine } from './agent/AgentEngine.js';
import { MemoryDecay } from './social/MemoryDecay.js';
import { LLMFactory } from './llm/LLMFactory.js';
import { execute as dbExecute, query as dbQuery } from './db.js';
import { GroupEngine } from './cultural/GroupEngine.js';
// Phase 5 — Conflict & Governance
import { ConflictEngine } from './conflict/ConflictEngine.js';
import { GovernanceEngine } from './conflict/GovernanceEngine.js';
// Phase 5 — Civilisation
import { LawEngine } from './civilisation/LawEngine.js';
import { EconomyEngine } from './civilisation/EconomyEngine.js';
import { ConstructionEngine } from './civilisation/ConstructionEngine.js';
import { TechnologyEngine } from './civilisation/TechnologyEngine.js';
import { ChronicleEngine } from './civilisation/ChronicleEngine.js';
// Phase 6 — Belief & Culture
import { BeliefEngine } from './cultural/BeliefEngine.js';
// Phase 6 — Observer
import { ObserverEngine } from './observer/ObserverEngine.js';
import { getPool } from './db.js';

const TICK_INTERVAL = parseInt(process.env.SIMULATION_TICK_INTERVAL_MS ?? '5000');
const WORLD_ID = process.env.WORLD_ID ?? '';

async function main() {
  if (!WORLD_ID) {
    console.error('[Simulation] WORLD_ID env var is required');
    process.exit(1);
  }

  console.log(`[Simulation] Starting for world ${WORLD_ID}`);
  console.log(`[Simulation] Tick interval: ${TICK_INTERVAL}ms`);

  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

  // ── Engine instantiation ───────────────────────────────────────────────────
  const worldEngine      = new WorldEngine(WORLD_ID);
  const agentEngine      = new AgentEngine(worldEngine, redis);
  const memoryDecay      = new MemoryDecay({
    db:  { execute: dbExecute, query: dbQuery },
    llm: LLMFactory.fromEnv(),
    logger: {
      info:  (obj, msg) => console.log('[MemoryDecay]',  msg ?? '', obj),
      warn:  (obj, msg) => console.warn('[MemoryDecay]', msg ?? '', obj),
      error: (obj, msg) => console.error('[MemoryDecay]', msg ?? '', obj),
    },
  });
  const groupEngine      = new GroupEngine();
  const conflictEngine   = new ConflictEngine();
  const beliefEngine     = new BeliefEngine();
  const lawEngine        = new LawEngine();
  const economyEngine    = new EconomyEngine();
  const constructionEngine = new ConstructionEngine();
  const technologyEngine = new TechnologyEngine();
  const chronicleEngine  = new ChronicleEngine();
  const observerEngine   = new ObserverEngine();

  let running = true;
  let lastDay  = -1;

  process.on('SIGINT',  () => { running = false; });
  process.on('SIGTERM', () => { running = false; });

  // Recover any consolidation passes that were in flight when the process
  // last exited. Idempotent: if there are none, this is a single SELECT.
  try {
    const startupTick = await worldEngine.getCurrentTick();
    const startupDay  = Math.floor(startupTick / 1440);
    await memoryDecay.resumePendingConsolidations(WORLD_ID, startupDay);
  } catch (err) {
    console.error('[Simulation] resumePendingConsolidations failed:', err);
  }

  while (running) {
    const start = Date.now();

    try {
      // ── Advance world tick ───────────────────────────────────────────────
      const tick = await worldEngine.advanceTick();
      const day  = Math.floor(tick / 1440);
      const isNewDay = day !== lastDay;
      if (isNewDay) lastDay = day;

      // Regenerate resources (apply weather_mult from ObserverEngine)
      await worldEngine.regenerateResources();

      // Get all alive agents
      const agentIds = await worldEngine.getActiveAgentIds();

      // Publish tick event
      await redis.publish('genesis:events', JSON.stringify({
        type: 'world:tick',
        tick,
        day,
        time_of_day: getTimeOfDay(tick),
        agent_count: agentIds.length,
      }));

      // ── Per-agent decision cycle ─────────────────────────────────────────
      for (const agentId of agentIds) {
        try {
          await agentEngine.runAgentTick(agentId, tick, day);
        } catch (err) {
          console.error(`[Simulation] Error running agent ${agentId}:`, err);
        }
      }

      // ── Phase 2: Memory decay ────────────────────────────────────────────
      try {
        await memoryDecay.runDecayPass(WORLD_ID, tick);
      } catch (err) {
        console.error('[Simulation] Memory decay error:', err);
      }

      // ── Phase 3: Group belonging bonus + daily cohesion check ────────────
      try {
        await groupEngine.runGroupTick(WORLD_ID, tick);
      } catch (err) {
        console.error('[Simulation] Group tick error:', err);
      }

      // ── Phase 5: Conflict — war termination + treaty ratification ────────
      try {
        await conflictEngine.checkWarTermination(WORLD_ID, tick);
      } catch (err) {
        console.error('[Simulation] Conflict tick error:', err);
      }

      // ── Phase 5: Law — enact proposed laws ───────────────────────────────
      try {
        await lawEngine.runLawTick(WORLD_ID, tick);
      } catch (err) {
        console.error('[Simulation] Law tick error:', err);
      }

      // ── Phase 6: Belief — passive conviction decay + on_war rituals ──────
      try {
        await beliefEngine.runBeliefTick(WORLD_ID, tick);
      } catch (err) {
        console.error('[Simulation] Belief tick error:', err);
      }

      // ── Phase 6: Observer — stats, snapshots, weather, interventions ──────
      try {
        await observerEngine.runObserverTick(WORLD_ID, tick, day);
      } catch (err) {
        console.error('[Simulation] Observer tick error:', err);
      }

      // ── Daily passes (once per in-game day) ──────────────────────────────
      if (isNewDay) {
        // Economy: expire listings, update price history
        try {
          await economyEngine.runMarketTick(WORLD_ID, tick, day);
        } catch (err) {
          console.error('[Simulation] Economy tick error:', err);
        }

        // Belief extinction check
        try {
          await beliefEngine.checkBeliefExtinction(WORLD_ID);
        } catch (err) {
          console.error('[Simulation] Belief extinction error:', err);
        }

        // Chronicle: check if a new era has completed
        try {
          const shouldChronicle = await chronicleEngine.shouldGenerate(WORLD_ID, day);
          if (shouldChronicle) {
            const chronicle = await chronicleEngine.generateChronicle(WORLD_ID, day, tick);
            if (chronicle) {
              console.log(`[Simulation] Chronicle generated: "${chronicle.era_name}" (Days ${chronicle.era_start_day}–${chronicle.era_end_day})`);
              await redis.publish('genesis:events', JSON.stringify({
                type: 'culture:chronicle',
                chronicle_id: chronicle.chronicle_id,
                era_name: chronicle.era_name,
                era_start_day: chronicle.era_start_day,
                era_end_day: chronicle.era_end_day,
                tick,
              }));
            }
          }
        } catch (err) {
          console.error('[Simulation] Chronicle error:', err);
        }
      }

      const elapsed = Date.now() - start;
      console.log(`[Simulation] Tick ${tick} (Day ${day}) — ${agentIds.length} agents — ${elapsed}ms`);

      const remaining = TICK_INTERVAL - elapsed;
      if (remaining > 0) {
        await sleep(remaining);
      }
    } catch (err) {
      console.error('[Simulation] Tick error:', err);
      await sleep(TICK_INTERVAL);
    }
  }

  console.log('[Simulation] Shutting down...');
  await redis.quit();
  await getPool().end();
}

function getTimeOfDay(tick: number): string {
  const m = tick % 1440;
  if (m < 360)  return 'pre-dawn';
  if (m < 720)  return 'morning';
  if (m < 900)  return 'midday';
  if (m < 1080) return 'afternoon';
  if (m < 1260) return 'evening';
  return 'night';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('[Simulation] Fatal error:', err);
  process.exit(1);
});
