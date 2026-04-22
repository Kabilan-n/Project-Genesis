import { execute, query, queryOne } from '../db.js';
import { LLMFactory } from '../llm/LLMFactory.js';
import type { LLMClient } from '../llm/types.js';

const DECAY_RATE = 0.0008;          // strength lost per tick for average memory
const CONSOLIDATION_THRESHOLD = 0.15; // below this + low importance → eligible for consolidation
const CONSOLIDATION_BATCH = 5;      // consolidate groups of 5 weak memories into 1 summary

/**
 * MemoryDecay runs each world tick to:
 * 1. Decay current_strength of all memories proportional to age and inverse of importance
 * 2. Once per day, consolidate clusters of weak memories into compact summaries
 */
export class MemoryDecay {
  private llm: LLMClient;

  constructor() {
    this.llm = LLMFactory.fromEnv();
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
   * Bulk-update current_strength for all living agents in this world.
   * Memories with high importance decay slower; recent memories decay slower.
   */
  private async decayStrength(worldId: string, currentTick: number): Promise<void> {
    await execute(
      `UPDATE memory.episodic_memories m
       SET current_strength = GREATEST(0,
         current_strength - ($1 * (1 - importance * 0.7))
       )
       FROM agents.agents a
       WHERE m.agent_id = a.agent_id
         AND a.world_id = $2
         AND a.status = 'alive'
         AND ($3 - m.tick) > 100`,  // only decay memories older than 100 ticks
      [DECAY_RATE, worldId, currentTick]
    );
  }

  /**
   * For each agent in this world, find clusters of weak, low-importance memories
   * and replace them with a single condensed summary memory.
   */
  private async consolidateWeakMemories(worldId: string, currentTick: number): Promise<void> {
    // Get all living agents in this world
    const agents = await query<{ agent_id: string; name: string }>(
      `SELECT agent_id, name FROM agents.agents
       WHERE world_id = $1 AND status = 'alive'`,
      [worldId]
    );

    for (const agent of agents) {
      await this.consolidateForAgent(agent.agent_id, agent.name, currentTick);
    }
  }

  private async consolidateForAgent(
    agentId: string,
    agentName: string,
    currentTick: number
  ): Promise<void> {
    // Find weak memories eligible for consolidation
    const weakMemories = await query<{
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
      [agentId, CONSOLIDATION_THRESHOLD, CONSOLIDATION_BATCH * 3]
    );

    if (weakMemories.length < CONSOLIDATION_BATCH) return;

    // Process in batches of CONSOLIDATION_BATCH
    for (let i = 0; i + CONSOLIDATION_BATCH <= weakMemories.length; i += CONSOLIDATION_BATCH) {
      const batch = weakMemories.slice(i, i + CONSOLIDATION_BATCH);
      await this.consolidateBatch(agentId, agentName, batch, currentTick);
    }
  }

  private async consolidateBatch(
    agentId: string,
    agentName: string,
    memories: Array<{ memory_id: string; summary: string; tick: number; importance: number; emotional_valence: number }>,
    currentTick: number
  ): Promise<void> {
    const summaryText = memories.map((m, i) => `${i + 1}. ${m.summary}`).join('\n');
    const avgValence = memories.reduce((s, m) => s + m.emotional_valence, 0) / memories.length;
    const maxImportance = Math.max(...memories.map(m => m.importance));

    // Use Claude to produce a condensed summary
    const prompt = `You are condensing ${agentName}'s old memories into a brief summary.
Old memories (in order):
${summaryText}

Write ONE concise sentence (max 100 chars) summarizing what these experiences add up to for ${agentName}.
Reply with ONLY the summary sentence, nothing else.`;

    let consolidatedSummary: string;
    try {
      const raw = await this.llm.getRawCompletion(prompt, 80);
      consolidatedSummary = raw.trim().slice(0, 100);
    } catch {
      // Fallback: just join
      consolidatedSummary = `Vague memories from Day ${Math.floor(memories[0].tick / 1440)}`;
    }

    // Delete old memories
    const ids = memories.map(m => m.memory_id);
    await execute(
      `DELETE FROM memory.episodic_memories WHERE memory_id = ANY($1)`,
      [ids]
    );

    // Insert consolidated memory
    await execute(
      `INSERT INTO memory.episodic_memories
         (agent_id, tick, day, summary, emotional_valence, emotional_intensity,
          importance, current_strength, tags)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        agentId,
        currentTick,
        Math.floor(currentTick / 1440),
        consolidatedSummary,
        avgValence,
        0.4,
        Math.min(0.7, maxImportance + 0.1), // slightly higher importance
        0.9,  // start fresh at high strength
        ['consolidated'],
      ]
    );
  }
}
