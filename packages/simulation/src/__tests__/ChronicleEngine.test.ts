/**
 * Tests for ChronicleEngine.
 *
 * shouldGenerate is the testable trigger; the actual chronicle generation
 * is an LLM-fueled DB-write pipeline best left to integration tests.
 */
import { describe, it, expect, vi } from 'vitest';
import { ChronicleEngine } from '../civilisation/ChronicleEngine.js';

const engine = new ChronicleEngine();

describe('ChronicleEngine.shouldGenerate', () => {
  it('returns false when world is not found', async () => {
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      .mockResolvedValueOnce(null as any);
    expect(await engine.shouldGenerate('world-x', 50)).toBe(false);
    queryOneSpy.mockRestore();
  });

  it('returns true when current day reaches the next era boundary', async () => {
    // Era length is 10 days. last_chronicle_day=10 → next at day 20.
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      .mockResolvedValueOnce({ last_chronicle_day: 10 } as any);
    expect(await engine.shouldGenerate('world-1', 20)).toBe(true);
    queryOneSpy.mockRestore();
  });

  it('returns false when current day has not yet reached the boundary', async () => {
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      .mockResolvedValueOnce({ last_chronicle_day: 10 } as any);
    expect(await engine.shouldGenerate('world-1', 19)).toBe(false);
    queryOneSpy.mockRestore();
  });

  it('returns true when current day is well past the boundary', async () => {
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      .mockResolvedValueOnce({ last_chronicle_day: 0 } as any);
    expect(await engine.shouldGenerate('world-1', 100)).toBe(true);
    queryOneSpy.mockRestore();
  });
});

describe('ChronicleEngine.generateChronicle — early exits', () => {
  it('returns null when world is not found', async () => {
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      .mockResolvedValueOnce(null as any);
    expect(await engine.generateChronicle('world-x', 100, 144000)).toBeNull();
    queryOneSpy.mockRestore();
  });
});
