/**
 * Tests for MemoryDecay logic:
 *   - runDecayPass: calls decayStrength every tick, consolidation only on day boundary
 *   - consolidateBatch: prompt construction, deletion + insertion, fallback
 *   - decay formula: memories with higher importance decay slower
 *   - injected deps: no real DB, no real LLM
 */
import { describe, it, expect, vi } from 'vitest';
import { MemoryDecay, type MemoryDecayDeps } from '../social/MemoryDecay.js';
import { WORLD_ID } from './fixtures.js';

// ─── Test deps factory ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<MemoryDecayDeps> = {}): MemoryDecayDeps {
  return {
    db: {
      execute: vi.fn().mockResolvedValue(undefined),
      query:   vi.fn().mockResolvedValue([]),
    },
    llm: {
      getRawCompletion: vi.fn().mockResolvedValue('a condensed summary'),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  };
}

class TestableMemoryDecay extends MemoryDecay {
  decayStrengthCallCount = 0;
  consolidateWeakCallCount = 0;

  constructor(deps: MemoryDecayDeps) {
    super(deps);
    (this as any).decayStrength = vi.fn().mockImplementation(() => {
      this.decayStrengthCallCount++;
      return Promise.resolve();
    });
    (this as any).consolidateWeakMemories = vi.fn().mockImplementation(() => {
      this.consolidateWeakCallCount++;
      return Promise.resolve();
    });
  }
}

// ─── runDecayPass ────────────────────────────────────────────────────────────

describe('MemoryDecay.runDecayPass', () => {
  it('calls decayStrength on every tick', async () => {
    const md = new TestableMemoryDecay(makeDeps());
    await md.runDecayPass(WORLD_ID, 100);
    expect(md.decayStrengthCallCount).toBe(1);
  });

  it('does NOT call consolidateWeakMemories on a non-day-boundary tick', async () => {
    const md = new TestableMemoryDecay(makeDeps());
    await md.runDecayPass(WORLD_ID, 500);
    expect(md.consolidateWeakCallCount).toBe(0);
  });

  it('calls consolidateWeakMemories at tick 1440 (day boundary)', async () => {
    const md = new TestableMemoryDecay(makeDeps());
    await md.runDecayPass(WORLD_ID, 1440);
    expect(md.consolidateWeakCallCount).toBe(1);
  });

  it('calls consolidateWeakMemories at tick 2880 (second day boundary)', async () => {
    const md = new TestableMemoryDecay(makeDeps());
    await md.runDecayPass(WORLD_ID, 2880);
    expect(md.consolidateWeakCallCount).toBe(1);
  });

  it('does NOT call consolidateWeakMemories at tick 0', async () => {
    const md = new TestableMemoryDecay(makeDeps());
    await md.runDecayPass(WORLD_ID, 0);
    expect(md.consolidateWeakCallCount).toBe(0);
  });

  it('calls both decayStrength and consolidation on day boundary', async () => {
    const md = new TestableMemoryDecay(makeDeps());
    await md.runDecayPass(WORLD_ID, 1440);
    expect(md.decayStrengthCallCount).toBe(1);
    expect(md.consolidateWeakCallCount).toBe(1);
  });
});

// ─── consolidateBatch behavior with injected deps ───────────────────────────

const memories = [
  { memory_id: 'm1', summary: 'Found berries near the lake.', tick: 100, importance: 0.3, emotional_valence: 0.2 },
  { memory_id: 'm2', summary: 'Talked to Bob briefly.',       tick: 110, importance: 0.2, emotional_valence: 0.1 },
  { memory_id: 'm3', summary: 'Got rained on all day.',        tick: 120, importance: 0.1, emotional_valence: -0.2 },
  { memory_id: 'm4', summary: 'Saw a deer in the forest.',     tick: 130, importance: 0.25, emotional_valence: 0.3 },
  { memory_id: 'm5', summary: 'Slept by the river.',           tick: 140, importance: 0.15, emotional_valence: 0.0 },
];

describe('MemoryDecay.consolidateBatch — happy path', () => {
  it('asks the LLM for a condensed summary, then deletes + inserts', async () => {
    const deps = makeDeps();
    const md = new MemoryDecay(deps);
    await md.consolidateBatch('agent-1', 'Alice', memories, 1440, 1);

    expect(deps.llm.getRawCompletion).toHaveBeenCalledOnce();
    const promptArg = (deps.llm.getRawCompletion as any).mock.calls[0][0];
    expect(promptArg).toContain('Alice');
    expect(promptArg).toContain('Found berries near the lake.');

    // 1 DELETE + 1 INSERT
    expect(deps.db.execute).toHaveBeenCalledTimes(2);
  });
});

describe('MemoryDecay.consolidateBatch — LLM failure fallback', () => {
  it('falls back to a deterministic summary when the LLM throws', async () => {
    const deps = makeDeps({
      llm: { getRawCompletion: vi.fn().mockRejectedValue(new Error('llm down')) },
    });
    const md = new MemoryDecay(deps);
    await md.consolidateBatch('agent-1', 'Alice', memories, 1440, 1);

    // INSERT call is the second db.execute; its 4th param is the summary text.
    const inserts = (deps.db.execute as any).mock.calls.filter(
      (c: any[]) => /INSERT INTO memory\.episodic_memories/.test(c[0]),
    );
    expect(inserts).toHaveLength(1);
    const summary = inserts[0][1][3] as string;
    expect(summary).toContain('Vague memories from Day 1');
    expect(summary).toContain('5 events');

    // Logged the LLM failure
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'agent-1' }),
      'consolidation_llm_failed',
    );
  });
});

describe('MemoryDecay.consolidateBatch — DB retry on transient failure', () => {
  it('retries the DELETE up to 3 times before giving up', async () => {
    let attempts = 0;
    const deleteFn = vi.fn().mockImplementation(async (sql: string) => {
      if (/DELETE FROM memory\.episodic_memories/.test(sql)) {
        attempts++;
        if (attempts < 3) throw new Error('transient db blip');
      }
      return undefined;
    });

    const deps = makeDeps({
      db: { execute: deleteFn, query: vi.fn().mockResolvedValue([]) },
    });
    const md = new MemoryDecay(deps);
    await md.consolidateBatch('agent-1', 'Alice', memories, 1440, 1);

    // 3 DELETE attempts (2 fail + 1 success) + 1 INSERT
    expect(deleteFn).toHaveBeenCalledTimes(4);
  });
});

// ─── Idempotency on resume ──────────────────────────────────────────────────

describe('MemoryDecay.resumePendingConsolidations', () => {
  it('is a no-op when there are no pending runs', async () => {
    const deps = makeDeps();
    const md = new MemoryDecay(deps);
    await md.resumePendingConsolidations(WORLD_ID, 5);

    // One SELECT to look for pending runs, nothing else.
    expect(deps.db.query).toHaveBeenCalledTimes(1);
    expect(deps.logger.info).not.toHaveBeenCalled();
  });

  it('iterates each pending row and logs the resume count', async () => {
    const queryFn = vi.fn()
      // 1st call: pending list
      .mockResolvedValueOnce([
        { agent_id: 'a1', day: 1 },
        { agent_id: 'a2', day: 1 },
      ])
      // For each agent: name lookup + claim attempt + weak memories query
      .mockResolvedValue([{ name: 'Alice' }]);
    const deps = makeDeps({ db: { execute: vi.fn().mockResolvedValue(undefined), query: queryFn } });
    const md = new MemoryDecay(deps);
    await md.resumePendingConsolidations(WORLD_ID, 5);

    expect(deps.logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ count: 2 }),
      'consolidation_resume_pending',
    );
  });
});

// ─── Decay formula tests (pure math) ─────────────────────────────────────────

describe('MemoryDecay — decay formula math', () => {
  /**
   * Formula: strength -= DECAY_RATE * (1 - importance * 0.7)
   * DECAY_RATE = 0.0008
   */
  const DECAY_RATE = 0.0008;

  it('high-importance memory decays slower than low-importance', () => {
    const decayForImportance = (importance: number) =>
      DECAY_RATE * (1 - importance * 0.7);

    const highImportanceDecay = decayForImportance(0.9);
    const lowImportanceDecay  = decayForImportance(0.1);

    expect(highImportanceDecay).toBeLessThan(lowImportanceDecay);
  });

  it('importance=1 gives minimum decay rate (30% of base)', () => {
    const decayAtMaxImportance = DECAY_RATE * (1 - 1.0 * 0.7);
    expect(decayAtMaxImportance).toBeCloseTo(0.0008 * 0.3);
  });

  it('importance=0 gives maximum decay rate (100% of base)', () => {
    const decayAtZeroImportance = DECAY_RATE * (1 - 0 * 0.7);
    expect(decayAtZeroImportance).toBe(DECAY_RATE);
  });

  it('after many ticks a low-importance memory strength approaches zero', () => {
    let strength = 1.0;
    const importance = 0.1;
    const decayPerTick = DECAY_RATE * (1 - importance * 0.7);
    const ticks = 1000;
    for (let i = 0; i < ticks; i++) {
      strength = Math.max(0, strength - decayPerTick);
    }
    expect(strength).toBeLessThan(0.5);
  });

  it('after many ticks a high-importance memory retains most of its strength', () => {
    let strength = 1.0;
    const importance = 0.9;
    const decayPerTick = DECAY_RATE * (1 - importance * 0.7);
    const ticks = 100;
    for (let i = 0; i < ticks; i++) {
      strength = Math.max(0, strength - decayPerTick);
    }
    expect(strength).toBeGreaterThan(0.95);
  });

  it('strength never goes below zero', () => {
    let strength = 0.001;
    const decay = DECAY_RATE * (1 - 0);
    for (let i = 0; i < 100; i++) {
      strength = Math.max(0, strength - decay);
    }
    expect(strength).toBeGreaterThanOrEqual(0);
  });
});
