import type { LLMClient } from '../llm/types.js';
import { retry } from '../util/retry.js';

const DECAY_RATE = 0.0008;          // strength lost per tick for average memory
const CONSOLIDATION_THRESHOLD = 0.15; // below this + low importance → eligible for consolidation
const CONSOLIDATION_BATCH = 5;      // consolidate groups of 5 weak memories into 1 summary

const DB_RETRY = { attempts: 3, baseDelayMs: 100, maxDelayMs: 1000 };

// Minimal logger contract — production wires Pino in Phase 4 task 4.2;
// tests inject a fake. Decoupled from any concrete logger so MemoryDecay
// has no transitive dependency on a logging framework.
export interface MemoryDecayLogger {
  info: (obj: object, msg?: string) => void;
  warn: (obj: object, msg?: string) => void;
  error: (obj: object, msg?: string) => void;
}

// DB client contract — only the methods MemoryDecay actually uses.
export interface MemoryDecayDb {
  execute: (sql: string, params?: unknown[]) => Promise<unknown>;
  query: <T = unknown>(sql: string, params?: unknown[]) => Promise<T[]>;
}

// LLM client contract — only the call MemoryDecay actually uses.
export interface MemoryDecayLLM {
  getRawCompletion: LLMClient['getRawCompletion'];
}

export interface MemoryDecayDeps {
  db: MemoryDecayDb;
  llm: MemoryDecayLLM;
  logger: MemoryDecayLogger;
}

const NOOP_LOGGER: MemoryDecayLogger = {
  info:  (obj, msg) => console.log(msg ?? '', obj),
  warn:  (obj, msg) => console.warn(msg ?? '', obj),
  error: (obj, msg) => console.error(msg ?? '', obj),
};

/**
 * MemoryDecay runs each world tick to:
 * 1. Decay current_strength of all memories proportional to age and inverse of importance
 * 2. Once per day, consolidate clusters of weak memories into compact summaries
 *
 * All I/O (DB, LLM) is injected via the constructor — no module-level imports
 * to facilitate testing and to make failure modes (LLM outage, DB blip) explicit.
 */
export class MemoryDecay {
  private readonly db: MemoryDecayDb;
  private readonly llm: MemoryDecayLLM;
  private readonly logger: MemoryDecayLogger;

  constructor(deps: MemoryDecayDeps) {
    this.db = deps.db;
    this.llm = deps.llm;
    this.logger = deps.logger ?? NOOP_LOGGER;
  }

  /**
   * Called every tick. Pass current tick number.
   * Only does full consolidation pass once per day (every 1440 ticks).
   */
  async runDecayPass(worldId: string, currentTick: number): Promise<void> {
    await this.decayStrength(worldId, currentTick);

    // Daily consolidation pass
    if (currentTick % 1440 === 0 && currentTick > 0) {
      await this.consolidateWeakMemories(worldId, currentTick);
    }
  }

  /**
   * On simulation startup: re-run any consolidation runs marked `pending`
   * for prior days. Recovers from process crashes mid-consolidation.
   */
  async resumePendingConsolidations(worldId: string, currentDay: number): Promise<void> {
    const pending = await this.db.query<{ agent_id: string; day: number }>(
      `SELECT agent_id, day FROM memory.consolidation_runs
       WHERE world_id = $1 AND status = 'pending' AND day < $2`,
      [worldId, currentDay],
    );

    if (pending.length === 0) return;
    this.logger.info({ worldId, count: pending.length }, 'consolidation_resume_pending');

    for (const row of pending) {
      const agent = await this.db.query<{ name: string }>(
        `SELECT name FROM agents.agents WHERE agent_id = $1`,
        [row.agent_id],
      );
      const name = agent[0]?.name ?? 'Unknown';
      const tick = row.day * 1440;
      await this.consolidateForAgent(worldId, row.agent_id, name, tick, row.day);
    }
  }

  /**
   * Bulk-update current_strength for all living agents in this world.
   * Memories with high importance decay slower; recent memories decay slower.
   */
  private async decayStrength(worldId: string, currentTick: number): Promise<void> {
    await retry(
      () => this.db.execute(
        `UPDATE memory.episodic_memories m
         SET current_strength = GREATEST(0,
           current_strength - ($1 * (1 - importance * 0.7))
         )
         FROM agents.agents a
         WHERE m.agent_id = a.agent_id
           AND a.world_id = $2
           AND a.status = 'alive'
           AND ($3 - m.tick) > 100`,
        [DECAY_RATE, worldId, currentTick],
      ),
      { ...DB_RETRY, onRetry: (err, attempt) =>
        this.logger.warn({ err: String(err), attempt, worldId }, 'decay_strength_retry') },
    );
  }

  /**
   * For each agent in this world, find clusters of weak, low-importance memories
   * and replace them with a single condensed summary memory.
   */
  private async consolidateWeakMemories(worldId: string, currentTick: number): Promise<void> {
    const day = Math.floor(currentTick / 1440);

    const agents = await this.db.query<{ agent_id: string; name: string }>(
      `SELECT agent_id, name FROM agents.agents
       WHERE world_id = $1 AND status = 'alive'`,
      [worldId],
    );

    for (const agent of agents) {
      try {
        await this.consolidateForAgent(worldId, agent.agent_id, agent.name, currentTick, day);
      } catch (err) {
        // One agent's failure should not stop other agents' consolidation.
        this.logger.error(
          { err: String(err), agentId: agent.agent_id, day },
          'consolidation_agent_failed',
        );
      }
    }
  }

  /**
   * Consolidate weak memories for one agent. Idempotent across calls for the
   * same (agent, day) — backed by the UNIQUE constraint on consolidation_runs.
   */
  private async consolidateForAgent(
    worldId: string,
    agentId: string,
    agentName: string,
    currentTick: number,
    day: number,
  ): Promise<void> {
    // Claim this run. ON CONFLICT DO NOTHING means a parallel run or a
    // restart-replay attempt is a silent no-op.
    const claimed = await this.db.query<{ id: string }>(
      `INSERT INTO memory.consolidation_runs (world_id, agent_id, day, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (agent_id, day) DO NOTHING
       RETURNING id`,
      [worldId, agentId, day],
    );

    if (claimed.length === 0) {
      // Already handled (success or in-progress on another worker).
      return;
    }
    const runId = claimed[0].id;

    try {
      const weakMemories = await this.db.query<{
        memory_id: string;
        summary: string;
        tick: number;
        importance: number;
        emotional_valence: number;
      }>(
        `SELECT memory_id, summary, tick, importance, emotional_valence
         FROM memory.episodic_memories
         WHERE agent_id = $1
           AND current_strength < $2
           AND importance < 0.5
         ORDER BY tick ASC
         LIMIT $3`,
        [agentId, CONSOLIDATION_THRESHOLD, CONSOLIDATION_BATCH * 3],
      );

      if (weakMemories.length < CONSOLIDATION_BATCH) {
        await this.markRunComplete(runId, 'no memories to consolidate');
        return;
      }

      for (let i = 0; i + CONSOLIDATION_BATCH <= weakMemories.length; i += CONSOLIDATION_BATCH) {
        const batch = weakMemories.slice(i, i + CONSOLIDATION_BATCH);
        await this.consolidateBatch(agentId, agentName, batch, currentTick, day);
      }

      await this.markRunComplete(runId);
    } catch (err) {
      await this.markRunFailed(runId, err);
      throw err;
    }
  }

  private async markRunComplete(runId: string, note?: string): Promise<void> {
    await this.db.execute(
      `UPDATE memory.consolidation_runs
       SET status = 'success', completed_at = NOW(), error_message = $2
       WHERE id = $1`,
      [runId, note ?? null],
    );
  }

  private async markRunFailed(runId: string, err: unknown): Promise<void> {
    await this.db.execute(
      `UPDATE memory.consolidation_runs
       SET status = 'failed', completed_at = NOW(), error_message = $2
       WHERE id = $1`,
      [runId, String(err).slice(0, 500)],
    );
  }

  async consolidateBatch(
    agentId: string,
    agentName: string,
    memories: Array<{ memory_id: string; summary: string; tick: number; importance: number; emotional_valence: number }>,
    currentTick: number,
    day: number,
  ): Promise<void> {
    const summaryText = memories.map((m, i) => `${i + 1}. ${m.summary}`).join('\n');
    const avgValence = memories.reduce((s, m) => s + m.emotional_valence, 0) / memories.length;
    const maxImportance = Math.max(...memories.map(m => m.importance));

    const prompt = `You are condensing ${agentName}'s old memories into a brief summary.
Old memories (in order):
${summaryText}

Write ONE concise sentence (max 100 chars) summarizing what these experiences add up to for ${agentName}.
Reply with ONLY the summary sentence, nothing else.`;

    let consolidatedSummary: string;
    try {
      const raw = await this.llm.getRawCompletion(prompt, 80);
      consolidatedSummary = raw.trim().slice(0, 100);
    } catch (err) {
      // LLM failures are expected (provider outage, parse error) — fall back
      // to a deterministic summary so consolidation still progresses.
      this.logger.warn(
        { err: String(err), agentId, day, batchSize: memories.length },
        'consolidation_llm_failed',
      );
      consolidatedSummary = `Vague memories from Day ${day}: ${memories.length} events`;
    }

    const ids = memories.map(m => m.memory_id);

    await retry(
      () => this.db.execute(
        `DELETE FROM memory.episodic_memories WHERE memory_id = ANY($1)`,
        [ids],
      ),
      { ...DB_RETRY, onRetry: (err, attempt) =>
        this.logger.warn({ err: String(err), attempt, agentId }, 'consolidation_delete_retry') },
    );

    await retry(
      () => this.db.execute(
        `INSERT INTO memory.episodic_memories
           (agent_id, tick, day, summary, emotional_valence, emotional_intensity,
            importance, current_strength, tags)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          agentId,
          currentTick,
          day,
          consolidatedSummary,
          avgValence,
          0.4,
          Math.min(0.7, maxImportance + 0.1),
          0.9,
          ['consolidated'],
        ],
      ),
      { ...DB_RETRY, onRetry: (err, attempt) =>
        this.logger.warn({ err: String(err), attempt, agentId }, 'consolidation_insert_retry') },
    );
  }
}
