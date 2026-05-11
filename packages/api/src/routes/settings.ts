import type { FastifyInstance } from 'fastify';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Settings routes — expose read-only runtime configuration to the observer UI.
 * These values come from env vars set at server startup (not editable at runtime).
 */

/**
 * WORLD_ID fallback chain (mirrors packages/simulation/src/util/worldId.ts):
 *   1. process.env.WORLD_ID
 *   2. .genesis-world-id file at repo root, written by `npm run db:seed`
 */
function resolveWorldId(): string {
  if (process.env.WORLD_ID) return process.env.WORLD_ID;
  // packages/api/src/routes → repo root is ../../../..
  const candidate = join(__dirname, '..', '..', '..', '..', '.genesis-world-id');
  if (existsSync(candidate)) {
    try {
      return readFileSync(candidate, 'utf8').trim();
    } catch {
      return '';
    }
  }
  return '';
}

export async function settingsRoutes(app: FastifyInstance) {
  // GET /config — return current simulation configuration visible to the UI
  app.get('/config', async () => {
    return {
      llm_provider:     process.env.LLM_PROVIDER     ?? 'anthropic',
      llm_model:        process.env.LLM_MODEL         ?? 'claude-haiku-4-5',
      optimize_prompts: process.env.OPTIMIZE_PROMPTS  === 'true',
      tick_interval_ms: parseInt(process.env.SIMULATION_TICK_INTERVAL_MS ?? '5000'),
      world_size:       parseInt(process.env.WORLD_SIZE     ?? '50'),
      initial_agents:   parseInt(process.env.INITIAL_AGENTS ?? '8'),
      // Stabilization Task 8.4: frontend can read this instead of needing
      // NEXT_PUBLIC_WORLD_ID baked in at build time.
      world_id:         resolveWorldId(),
    };
  });
}
