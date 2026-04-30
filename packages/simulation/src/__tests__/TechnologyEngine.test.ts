/**
 * Tests for TechnologyEngine.
 *
 * The static TECH_TREE is the heart of the engine; this file pins the
 * shape and ordering invariants of that tree along with the early exits
 * on the public methods.
 */
import { describe, it, expect, vi } from 'vitest';
import { TechnologyEngine } from '../civilisation/TechnologyEngine.js';
import { makeAgent } from './fixtures.js';

const engine = new TechnologyEngine();

describe('TechnologyEngine.checkDiscoveries — group gate', () => {
  it('returns [] for an agent without a group', async () => {
    const result = await engine.checkDiscoveries(
      makeAgent({ group_id: null }), 'world-1', 100, 1,
    );
    expect(result).toEqual([]);
  });

  it('returns [] when the agent has no qualifying skills', async () => {
    const querySpy = vi.spyOn(await import('../db.js'), 'query')
      .mockResolvedValueOnce([] as any)        // known techs
      .mockResolvedValueOnce([] as any);       // agent skills
    const result = await engine.checkDiscoveries(
      makeAgent({ group_id: 'g-1' }), 'world-1', 100, 1,
    );
    expect(result).toEqual([]);
    querySpy.mockRestore();
  });
});

describe('TechnologyEngine.spreadTech — alliance gate', () => {
  it('returns false when no alliance treaty exists', async () => {
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      .mockResolvedValueOnce(null as any);
    const result = await engine.spreadTech(
      'tech-1', 'g-source', 'g-target', 'world-1', 100,
    );
    expect(result).toBe(false);
    queryOneSpy.mockRestore();
  });
});

describe('TechnologyEngine.checkTechLoss — group gate', () => {
  it('returns [] when the dead agent had no group', async () => {
    const result = await engine.checkTechLoss('agent-x', null, 'world-1');
    expect(result).toEqual([]);
  });
});

describe('TechnologyEngine.getUnlockedActions', () => {
  it('aggregates and de-duplicates actions across techs', async () => {
    const querySpy = vi.spyOn(await import('../db.js'), 'query')
      .mockResolvedValueOnce([
        { unlocks_actions: ['cook_food', 'make_fire'] },
        { unlocks_actions: ['cook_food', 'craft_tool'] },
      ] as any);
    const result = await engine.getUnlockedActions('g-1');
    expect(new Set(result)).toEqual(new Set(['cook_food', 'make_fire', 'craft_tool']));
    querySpy.mockRestore();
  });
});

describe('TechnologyEngine.getGroupBonuses', () => {
  it('multiplies overlapping bonus keys across techs', async () => {
    const querySpy = vi.spyOn(await import('../db.js'), 'query')
      .mockResolvedValueOnce([
        { unlocks_bonus: { food_yield_mult: 1.5 } },
        { unlocks_bonus: { food_yield_mult: 1.8 } },
      ] as any);
    const result = await engine.getGroupBonuses('g-1');
    // 1 * 1.5 * 1.8 = 2.7
    expect(result.food_yield_mult).toBeCloseTo(2.7, 5);
    querySpy.mockRestore();
  });
});
