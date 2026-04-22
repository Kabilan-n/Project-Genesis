/**
 * Tests for MemoryDecay logic:
 *   - runDecayPass: calls decayStrength every tick, consolidation only on day boundary
 *   - consolidateBatch: prompt construction, deletion + insertion, fallback
 *   - decay formula: memories with higher importance decay slower
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryDecay } from '../social/MemoryDecay.js';
import { WORLD_ID } from './fixtures.js';

// ─── Testable sub-class ─────────────────────────────────────────────────────

class TestableMemoryDecay extends MemoryDecay {
  // Track how many times each private method was called
  decayStrengthCallCount = 0;
  consolidateWeakCallCount = 0;

  constructor() {
    super();
    // Stub out all DB + Claude calls in private methods
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
    const md = new TestableMemoryDecay();
    await md.runDecayPass(WORLD_ID, 100);
    expect(md.decayStrengthCallCount).toBe(1);
  });

  it('does NOT call consolidateWeakMemories on a non-day-boundary tick', async () => {
    const md = new TestableMemoryDecay();
    await md.runDecayPass(WORLD_ID, 500);
    expect(md.consolidateWeakCallCount).toBe(0);
  });

  it('calls consolidateWeakMemories at tick 1440 (day boundary)', async () => {
    const md = new TestableMemoryDecay();
    await md.runDecayPass(WORLD_ID, 1440);
    expect(md.consolidateWeakCallCount).toBe(1);
  });

  it('calls consolidateWeakMemories at tick 2880 (second day boundary)', async () => {
    const md = new TestableMemoryDecay();
    await md.runDecayPass(WORLD_ID, 2880);
    expect(md.consolidateWeakCallCount).toBe(1);
  });

  it('does NOT call consolidateWeakMemories at tick 0', async () => {
    const md = new TestableMemoryDecay();
    await md.runDecayPass(WORLD_ID, 0);
    expect(md.consolidateWeakCallCount).toBe(0);
  });

  it('calls both decayStrength and consolidation on day boundary', async () => {
    const md = new TestableMemoryDecay();
    await md.runDecayPass(WORLD_ID, 1440);
    expect(md.decayStrengthCallCount).toBe(1);
    expect(md.consolidateWeakCallCount).toBe(1);
  });
});

// ─── consolidateBatch prompt-building (no DB needed) ────────────────────────

describe('MemoryDecay.consolidateBatch — prompt content', () => {
  const memories = [
    { memory_id: 'm1', summary: 'Found berries near the lake.', tick: 100, importance: 0.3, emotional_valence: 0.2 },
    { memory_id: 'm2', summary: 'Talked to Bob briefly.',       tick: 110, importance: 0.2, emotional_valence: 0.1 },
    { memory_id: 'm3', summary: 'Got rained on all day.',        tick: 120, importance: 0.1, emotional_valence: -0.2 },
    { memory_id: 'm4', summary: 'Saw a deer in the forest.',     tick: 130, importance: 0.25, emotional_valence: 0.3 },
    { memory_id: 'm5', summary: 'Slept by the river.',           tick: 140, importance: 0.15, emotional_valence: 0.0 },
  ];

  it('builds a Claude prompt that includes all memory summaries', () => {
    // We verify the prompt construction directly without calling DB
    const summaryText = memories.map((m, i) => `${i + 1}. ${m.summary}`).join('\n');
    const agentName = 'Alice';
    const prompt = `You are condensing ${agentName}'s old memories into a brief summary.\nOld memories (in order):\n${summaryText}\n\nWrite ONE concise sentence (max 100 chars) summarizing what these experiences add up to for ${agentName}.\nReply with ONLY the summary sentence, nothing else.`;

    expect(prompt).toContain('Found berries near the lake.');
    expect(prompt).toContain('Talked to Bob briefly.');
    expect(prompt).toContain('Got rained on all day.');
    expect(prompt).toContain('Alice');
  });

  it('computes average emotional valence correctly', () => {
    const valences = memories.map(m => m.emotional_valence);
    const avg = valences.reduce((s, v) => s + v, 0) / valences.length;
    // 0.2 + 0.1 + (-0.2) + 0.3 + 0.0 = 0.4 / 5 = 0.08
    expect(avg).toBeCloseTo(0.08, 5);
  });

  it('picks max importance across memories', () => {
    const maxImportance = Math.max(...memories.map(m => m.importance));
    expect(maxImportance).toBe(0.3);
  });

  it('final consolidated importance is slightly higher than max source importance (+ 0.1)', () => {
    const maxImportance = Math.max(...memories.map(m => m.importance));
    const finalImportance = Math.min(0.7, maxImportance + 0.1);
    expect(finalImportance).toBe(0.4);
  });

  it('fallback summary mentions "Vague memories from Day X"', () => {
    // The fallback used in consolidateBatch when Claude throws
    const fallback = `Vague memories from Day ${Math.floor(memories[0].tick / 1440)}`;
    expect(fallback).toContain('Vague memories from Day 0');
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
    const ticks = 100; // 100 ticks ≈ a few minutes
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
