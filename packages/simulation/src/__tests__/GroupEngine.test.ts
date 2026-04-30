/**
 * Tests for GroupEngine pure helpers.
 *
 * The lifecycle methods (formGroup / joinGroup / leaveGroup) are heavy DB
 * orchestrations; their semantics are best covered by integration tests.
 * This file exercises the pure derivation helpers.
 */
import { describe, it, expect, vi } from 'vitest';
import { GroupEngine } from '../cultural/GroupEngine.js';
import { makeAgent, makeTraits } from './fixtures.js';

class TestableGroupEngine extends GroupEngine {
  deriveGroupValuesPublic(founder: ReturnType<typeof makeAgent>) {
    return (this as any).deriveGroupValues(founder);
  }
  pickColourPublic(worldId: string) {
    return (this as any).pickColour(worldId);
  }
}

const engine = new TestableGroupEngine();

describe('GroupEngine.deriveGroupValues', () => {
  it('returns a value-shape with cooperation/ambition/aggression/curiosity/loyalty', () => {
    const values = engine.deriveGroupValuesPublic(makeAgent());
    expect(values).toHaveProperty('cooperation');
    expect(values).toHaveProperty('ambition');
    expect(values).toHaveProperty('aggression');
    expect(values).toHaveProperty('curiosity');
    expect(values).toHaveProperty('loyalty');
  });

  it('cooperation is the rounded mean of empathy and fairness', () => {
    const agent = makeAgent({ traits: makeTraits({ empathy: 80, fairness: 60 }) });
    const values = engine.deriveGroupValuesPublic(agent);
    expect(values.cooperation).toBe(70);
  });

  it('low-empathy + low-fairness founder produces a low-cooperation group', () => {
    const agent = makeAgent({ traits: makeTraits({ empathy: 10, fairness: 20 }) });
    const values = engine.deriveGroupValuesPublic(agent);
    expect(values.cooperation).toBe(15);
  });

  it('mirrors single traits directly (rounded) for ambition / aggression / curiosity / loyalty', () => {
    const agent = makeAgent({ traits: makeTraits({
      ambition: 73, aggression: 22, curiosity: 51, loyalty: 88,
    }) });
    const values = engine.deriveGroupValuesPublic(agent);
    expect(values.ambition).toBe(73);
    expect(values.aggression).toBe(22);
    expect(values.curiosity).toBe(51);
    expect(values.loyalty).toBe(88);
  });
});

describe('GroupEngine.pickColour', () => {
  it('picks the first unused colour when one is available', async () => {
    const eng = new TestableGroupEngine();
    // Stub the internal query call by replacing the helper that wraps it.
    // pickColour calls `query` directly; we patch via prototype access.
    const { query: _ } = await import('../db.js');
    const querySpy = vi.spyOn(await import('../db.js'), 'query')
      .mockResolvedValueOnce([{ colour: '#6366f1' }] as any);
    const colour = await eng.pickColourPublic('world-1');
    expect(colour).toBe('#ec4899'); // first unused from the palette
    querySpy.mockRestore();
  });

  it('falls back to a random palette colour when all are used', async () => {
    const allColours = [
      '#6366f1', '#ec4899', '#f59e0b', '#10b981',
      '#3b82f6', '#ef4444', '#8b5cf6', '#06b6d4',
    ].map((c) => ({ colour: c }));
    const querySpy = vi.spyOn(await import('../db.js'), 'query')
      .mockResolvedValueOnce(allColours as any);
    const colour = await new TestableGroupEngine().pickColourPublic('world-1');
    expect(allColours.map((c) => c.colour)).toContain(colour);
    querySpy.mockRestore();
  });
});

describe('GroupEngine.leaveGroup — early exit', () => {
  it('is a no-op when agent has no group_id', async () => {
    const executeSpy = vi.spyOn(await import('../db.js'), 'execute')
      .mockResolvedValue(undefined as any);
    await new GroupEngine().leaveGroup(makeAgent({ group_id: null }), 100);
    expect(executeSpy).not.toHaveBeenCalled();
    executeSpy.mockRestore();
  });
});
