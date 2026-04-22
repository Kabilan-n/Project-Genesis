/**
 * Tests for MapGenerator:
 *   - Terrain assignment and passability
 *   - Resource node placement
 *   - Grid structure and bounds
 */
import { describe, it, expect } from 'vitest';
import { MapGenerator } from '../world/MapGenerator.js';
import { WORLD_ID } from './fixtures.js';

const gen = new MapGenerator();

describe('MapGenerator.generate', () => {
  it('generates exactly size² tiles', () => {
    const { tiles } = gen.generate(WORLD_ID, 10);
    expect(tiles).toHaveLength(100);
  });

  it('generates tiles covering full x/y grid', () => {
    const { tiles } = gen.generate(WORLD_ID, 8);
    const xs = new Set(tiles.map(t => t.x));
    const ys = new Set(tiles.map(t => t.y));
    expect(xs.size).toBe(8);
    expect(ys.size).toBe(8);
    for (let i = 0; i < 8; i++) {
      expect(xs.has(i)).toBe(true);
      expect(ys.has(i)).toBe(true);
    }
  });

  it('assigns world_id to every tile', () => {
    const { tiles } = gen.generate(WORLD_ID, 6);
    expect(tiles.every(t => t.world_id === WORLD_ID)).toBe(true);
  });

  it('produces only valid terrain types', () => {
    const valid = new Set(['water', 'swamp', 'grassland', 'forest', 'mountain']);
    const { tiles } = gen.generate(WORLD_ID, 15);
    for (const t of tiles) {
      expect(valid.has(t.terrain)).toBe(true);
    }
  });

  it('water and mountain tiles are not passable', () => {
    const { tiles } = gen.generate(WORLD_ID, 50);
    for (const t of tiles) {
      if (t.terrain === 'water' || t.terrain === 'mountain') {
        expect(t.is_passable).toBe(false);
      }
    }
  });

  it('non-water, non-mountain tiles are passable', () => {
    const { tiles } = gen.generate(WORLD_ID, 50);
    for (const t of tiles) {
      if (t.terrain !== 'water' && t.terrain !== 'mountain') {
        expect(t.is_passable).toBe(true);
      }
    }
  });

  it('edges of the map tend to be water (edge tile test)', () => {
    // The generator pushes edge tiles toward water via distFromEdge adjustment
    const { tiles } = gen.generate(WORLD_ID, 50);
    const edgeTiles = tiles.filter(t =>
      t.x === 0 || t.y === 0 || t.x === 49 || t.y === 49
    );
    const waterCount = edgeTiles.filter(t => t.terrain === 'water').length;
    // Most edge tiles should be water
    expect(waterCount).toBeGreaterThan(edgeTiles.length * 0.5);
  });

  it('generates multiple terrain types for large maps', () => {
    const { tiles } = gen.generate(WORLD_ID, 50);
    const terrains = new Set(tiles.map(t => t.terrain));
    // A 50x50 map should have at least 3 distinct terrain types
    expect(terrains.size).toBeGreaterThanOrEqual(3);
  });
});

describe('MapGenerator resource nodes', () => {
  it('places resource nodes only on passable tiles', () => {
    const { tiles, resourceNodes } = gen.generate(WORLD_ID, 50);
    const passableSet = new Set(
      tiles.filter(t => t.is_passable).map(t => `${t.x},${t.y}`)
    );
    for (const node of resourceNodes) {
      expect(passableSet.has(`${node.x},${node.y}`)).toBe(true);
    }
  });

  it('includes food, water, wood, stone resource types', () => {
    const { resourceNodes } = gen.generate(WORLD_ID, 50);
    const types = new Set(resourceNodes.map(n => n.resource_type));
    expect(types.has('food')).toBe(true);
    expect(types.has('water')).toBe(true);
    expect(types.has('wood')).toBe(true);
    expect(types.has('stone')).toBe(true);
  });

  it('every node starts at full capacity', () => {
    const { resourceNodes } = gen.generate(WORLD_ID, 50);
    for (const node of resourceNodes) {
      expect(node.current_amount).toBe(node.max_capacity);
    }
  });

  it('all nodes have positive extraction rates', () => {
    const { resourceNodes } = gen.generate(WORLD_ID, 50);
    for (const node of resourceNodes) {
      expect(node.extraction_rate).toBeGreaterThan(0);
    }
  });

  it('water nodes have highest regen rate', () => {
    const { resourceNodes } = gen.generate(WORLD_ID, 50);
    const water = resourceNodes.filter(n => n.resource_type === 'water');
    const food  = resourceNodes.filter(n => n.resource_type === 'food');
    if (water.length > 0 && food.length > 0) {
      const avgWaterRegen = water.reduce((s, n) => s + n.regen_rate, 0) / water.length;
      const avgFoodRegen  = food.reduce((s, n) => s + n.regen_rate, 0) / food.length;
      expect(avgWaterRegen).toBeGreaterThan(avgFoodRegen);
    }
  });

  it('stone nodes have zero regen rate', () => {
    const { resourceNodes } = gen.generate(WORLD_ID, 50);
    const stone = resourceNodes.filter(n => n.resource_type === 'stone');
    for (const node of stone) {
      expect(node.regen_rate).toBe(0);
    }
  });

  it('total node count is reasonable for 50x50 map', () => {
    const { resourceNodes } = gen.generate(WORLD_ID, 50);
    // Config: food×12 + water×8 + wood×10 + stone×6 = 36 nodes max
    expect(resourceNodes.length).toBeGreaterThan(10);
    expect(resourceNodes.length).toBeLessThanOrEqual(36);
  });

  it('generates some resource nodes for small maps too', () => {
    const { resourceNodes } = gen.generate(WORLD_ID, 15);
    expect(resourceNodes.length).toBeGreaterThan(0);
  });
});
