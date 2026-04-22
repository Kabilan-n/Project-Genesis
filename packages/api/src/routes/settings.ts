import type { FastifyInstance } from 'fastify';

/**
 * Settings routes — expose read-only runtime configuration to the observer UI.
 * These values come from env vars set at server startup (not editable at runtime).
 */
export async function settingsRoutes(app: FastifyInstance) {
  // GET /config — return current simulation configuration visible to the UI
  app.get('/config', async () => {
    return {
      llm_provider:     process.env.LLM_PROVIDER     ?? 'anthropic',
      llm_model:        process.env.LLM_MODEL         ?? 'claude-haiku-4-5-20251001',
      optimize_prompts: process.env.OPTIMIZE_PROMPTS  === 'true',
      tick_interval_ms: parseInt(process.env.SIMULATION_TICK_INTERVAL_MS ?? '5000'),
      world_size:       parseInt(process.env.WORLD_SIZE     ?? '50'),
      initial_agents:   parseInt(process.env.INITIAL_AGENTS ?? '8'),
    };
  });
}
