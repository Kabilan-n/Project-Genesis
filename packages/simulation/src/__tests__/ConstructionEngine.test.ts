/**
 * Tests for ConstructionEngine.
 *
 * Public helpers (getBuildCosts, getBuildableTypes) and the early-exit
 * branches of startConstruction / advanceConstruction / damageStructure
 * are the testable surface without DB.
 */
import { describe, it, expect, vi } from 'vitest';
import { ConstructionEngine } from '../civilisation/ConstructionEngine.js';
import { makeAgent } from './fixtures.js';

const engine = new ConstructionEngine();

describe('ConstructionEngine.getBuildableTypes', () => {
  it('lists all eight structure types', () => {
    const types = engine.getBuildableTypes();
    expect(types).toEqual(expect.arrayContaining([
      'shelter', 'farm', 'storage', 'watchtower',
      'market_stall', 'temple', 'forge', 'library',
    ]));
    expect(types).toHaveLength(8);
  });
});

describe('ConstructionEngine.getBuildCosts', () => {
  it('returns the wood/stone cost for shelter', () => {
    const costs = engine.getBuildCosts('shelter');
    expect(costs).toEqual({ wood: 20, stone: 10 });
  });

  it('returns the highest stone cost for temple (50)', () => {
    expect(engine.getBuildCosts('temple').stone).toBe(50);
  });

  it('returns an empty object for an unknown structure type', () => {
    expect(engine.getBuildCosts('not_a_thing' as any)).toEqual({});
  });
});

describe('ConstructionEngine.startConstruction — placement guards', () => {
  it('returns null when target tile is not passable', async () => {
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      .mockResolvedValueOnce({ is_passable: false, structure_id: null } as any);
    const result = await new ConstructionEngine().startConstruction(
      makeAgent(), 'shelter', 5, 5, 'Hut', 'world-1', 100, 1,
    );
    expect(result).toBeNull();
    queryOneSpy.mockRestore();
  });

  it('returns null when tile already has a structure', async () => {
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      .mockResolvedValueOnce({ is_passable: true, structure_id: 'existing' } as any);
    const result = await new ConstructionEngine().startConstruction(
      makeAgent(), 'shelter', 5, 5, 'Hut', 'world-1', 100, 1,
    );
    expect(result).toBeNull();
    queryOneSpy.mockRestore();
  });

  it('returns null when farm builder lacks the farming skill threshold (level 20)', async () => {
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      // 1st: tile check passes
      .mockResolvedValueOnce({ is_passable: true, structure_id: null } as any)
      // 2nd: skill check returns level 10 (< 20)
      .mockResolvedValueOnce({ level: 10 } as any);
    const result = await new ConstructionEngine().startConstruction(
      makeAgent(), 'farm', 5, 5, 'Plot', 'world-1', 100, 1,
    );
    expect(result).toBeNull();
    queryOneSpy.mockRestore();
  });
});

describe('ConstructionEngine.advanceConstruction — completion math', () => {
  it('returns progress=0 / completed=false when structure is not found', async () => {
    const queryOneSpy = vi.spyOn(await import('../db.js'), 'queryOne')
      .mockResolvedValueOnce(null as any);
    const result = await new ConstructionEngine().advanceConstruction(
      makeAgent(), 'no-such-structure', 'world-1', 100,
    );
    expect(result).toEqual({ progress: 0, completed: false });
    queryOneSpy.mockRestore();
  });
});
