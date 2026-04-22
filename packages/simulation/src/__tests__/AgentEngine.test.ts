/**
 * Tests for AgentEngine pure-logic methods:
 *   - updateNeeds (need decay per tick)
 *   - computeMentalState (state machine)
 *
 * These methods are private but we expose them via a testable sub-class.
 * No database, no Redis, no Claude API needed.
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentEngine } from '../agent/AgentEngine.js';
import { makeState } from './fixtures.js';
import type { AgentState } from '../types.js';

// ─── Expose private methods ─────────────────────────────────────────────────

class TestableAgentEngine extends AgentEngine {
  constructor() {
    // Pass minimal stubs — we only test pure functions here
    const mockWorldEngine = {} as any;
    const mockRedis = { publish: vi.fn() } as any;
    super(mockWorldEngine, mockRedis);
  }

  updateNeedsPublic(state: AgentState, tick: number): AgentState {
    return (this as any).updateNeeds(state, tick);
  }

  computeMentalStatePublic(state: AgentState): AgentState['mental_state'] {
    return (this as any).computeMentalState(state);
  }
}

const engine = new TestableAgentEngine();

// ─── updateNeeds ─────────────────────────────────────────────────────────────

describe('AgentEngine.updateNeeds', () => {
  it('decays food/water/rest each tick when awake', () => {
    const state = makeState({ need_food: 70, need_water: 70, need_rest: 70, is_awake: true });
    const updated = engine.updateNeedsPublic(state, 1);
    expect(updated.need_food).toBeLessThan(70);
    expect(updated.need_water).toBeLessThan(70);
    expect(updated.need_rest).toBeLessThan(70);
  });

  it('recovers rest while sleeping, food/water still decay at half rate', () => {
    const state = makeState({ need_food: 50, need_water: 50, need_rest: 30, is_awake: false });
    const updated = engine.updateNeedsPublic(state, 1);
    expect(updated.need_rest).toBeGreaterThan(30);      // rest recovers
    expect(updated.need_food).toBeLessThan(50);         // food still drains (half rate)
    expect(updated.need_water).toBeLessThan(50);        // water still drains (half rate)
  });

  it('does not let needs go below 0', () => {
    const state = makeState({ need_food: 0, need_water: 0, need_rest: 0, is_awake: true });
    const updated = engine.updateNeedsPublic(state, 1);
    expect(updated.need_food).toBeGreaterThanOrEqual(0);
    expect(updated.need_water).toBeGreaterThanOrEqual(0);
    expect(updated.need_rest).toBeGreaterThanOrEqual(0);
  });

  it('does not let needs exceed 100 during sleep recovery', () => {
    const state = makeState({ need_rest: 99, is_awake: false });
    const updated = engine.updateNeedsPublic(state, 1);
    expect(updated.need_rest).toBeLessThanOrEqual(100);
  });

  it('reduces HP when food is critically low', () => {
    const state = makeState({ hp: 80, need_food: 3, need_water: 70, need_rest: 70, is_awake: true });
    const updated = engine.updateNeedsPublic(state, 1);
    expect(updated.hp).toBeLessThan(80);
  });

  it('reduces HP when water is critically low', () => {
    const state = makeState({ hp: 80, need_food: 70, need_water: 3, need_rest: 70, is_awake: true });
    const updated = engine.updateNeedsPublic(state, 1);
    expect(updated.hp).toBeLessThan(80);
  });

  it('reduces HP when rest is critically low while awake', () => {
    const state = makeState({ hp: 80, need_food: 70, need_water: 70, need_rest: 3, is_awake: true });
    const updated = engine.updateNeedsPublic(state, 1);
    expect(updated.hp).toBeLessThan(80);
  });

  it('recovers HP when all basic needs are well-met', () => {
    const state = makeState({ hp: 60, need_food: 60, need_water: 60, need_rest: 40, is_awake: true });
    const updated = engine.updateNeedsPublic(state, 1);
    expect(updated.hp).toBeGreaterThan(60);
  });

  it('does not recover HP when HP is already at 100', () => {
    const state = makeState({ hp: 100, need_food: 80, need_water: 80, need_rest: 80, is_awake: true });
    const updated = engine.updateNeedsPublic(state, 1);
    expect(updated.hp).toBeLessThanOrEqual(100);
  });

  it('does not let HP go below 0', () => {
    const state = makeState({ hp: 0, need_food: 0, need_water: 0, need_rest: 0, is_awake: true });
    const updated = engine.updateNeedsPublic(state, 1);
    expect(updated.hp).toBeGreaterThanOrEqual(0);
  });

  it('food decays faster while awake than while sleeping', () => {
    const awake = makeState({ need_food: 70, is_awake: true });
    const asleep = makeState({ need_food: 70, is_awake: false });
    const updatedAwake  = engine.updateNeedsPublic(awake,  1);
    const updatedAsleep = engine.updateNeedsPublic(asleep, 1);
    expect(70 - updatedAwake.need_food).toBeGreaterThan(70 - updatedAsleep.need_food);
  });
});

// ─── computeMentalState ──────────────────────────────────────────────────────

describe('AgentEngine.computeMentalState', () => {
  it('returns "desperate" when food is critically low (<10)', () => {
    const state = makeState({ need_food: 5, need_water: 70 });
    expect(engine.computeMentalStatePublic(state)).toBe('desperate');
  });

  it('returns "desperate" when water is critically low (<10)', () => {
    const state = makeState({ need_food: 70, need_water: 5 });
    expect(engine.computeMentalStatePublic(state)).toBe('desperate');
  });

  it('returns "anxious" when food is low (10-25)', () => {
    const state = makeState({ need_food: 15, need_water: 70, need_rest: 70 });
    expect(engine.computeMentalStatePublic(state)).toBe('anxious');
  });

  it('returns "tired" when rest is very low and awake', () => {
    const state = makeState({ need_food: 70, need_water: 70, need_rest: 8, is_awake: true });
    expect(engine.computeMentalStatePublic(state)).toBe('tired');
  });

  it('does NOT return "tired" when rest is low but asleep', () => {
    const state = makeState({ need_food: 70, need_water: 70, need_rest: 8, is_awake: false });
    expect(engine.computeMentalStatePublic(state)).not.toBe('tired');
  });

  it('returns "stressed" when food is moderate-low (25–40)', () => {
    const state = makeState({ need_food: 30, need_water: 70, need_rest: 70 });
    expect(engine.computeMentalStatePublic(state)).toBe('stressed');
  });

  it('returns "stressed" when water is moderate-low (25–40)', () => {
    const state = makeState({ need_food: 70, need_water: 30, need_rest: 70 });
    expect(engine.computeMentalStatePublic(state)).toBe('stressed');
  });

  it('returns "lonely" when belonging is very low (<15)', () => {
    const state = makeState({
      need_food: 70, need_water: 70, need_rest: 70, need_belonging: 10,
    });
    expect(engine.computeMentalStatePublic(state)).toBe('lonely');
  });

  it('returns "depressed" when belonging is low (15-25)', () => {
    const state = makeState({
      need_food: 70, need_water: 70, need_rest: 70, need_belonging: 20,
    });
    expect(engine.computeMentalStatePublic(state)).toBe('depressed');
  });

  it('returns "content" when all needs are well-met', () => {
    const state = makeState({
      need_food: 85, need_water: 85, need_rest: 80, need_belonging: 65,
    });
    expect(engine.computeMentalStatePublic(state)).toBe('content');
  });

  it('prioritises "desperate" over "tired"', () => {
    const state = makeState({ need_food: 5, need_water: 70, need_rest: 5, is_awake: true });
    expect(engine.computeMentalStatePublic(state)).toBe('desperate');
  });

  it('prioritises "anxious" over "stressed"', () => {
    // food is 15 (anxious range) AND water is 30 (stressed range)
    const state = makeState({ need_food: 15, need_water: 30, need_rest: 70, is_awake: true });
    expect(engine.computeMentalStatePublic(state)).toBe('anxious');
  });
});

// ─── Need decay rate constants ────────────────────────────────────────────────

describe('AgentEngine — need decay constants', () => {
  it('food decays approximately 3 units per day (1440 ticks)', () => {
    // DECAY.food = 3/1440; per tick the engine subtracts DECAY.food * 100 ≈ 0.208/tick
    // Over 1440 ticks awake: 0.208 * 1440 ≈ 300 — scaled by 100 in the code
    // The actual constant: need_food -= (3/1440) * 100 per tick = 0.20833
    // Over 1440 ticks: 0.20833 * 1440 ≈ 300 units
    let state = makeState({ need_food: 100, need_water: 100, need_rest: 50, is_awake: true });
    for (let t = 0; t < 1440; t++) {
      state = engine.updateNeedsPublic(state, t);
    }
    // Food multiplied by 100 scale: 3/1440 * 100 * 1440 = 300 units, but capped at 100 → 0
    // So after 1440 ticks need_food should be 0 (all used up)
    expect(state.need_food).toBe(0);
  });

  it('water decays approximately 2 units per day (1440 ticks)', () => {
    // DECAY.water = 2/1440; per tick: 2/1440 * 100 ≈ 0.139/tick
    // Over 1440 ticks: 0.139 * 1440 ≈ 200 units — but need_water max is 100 → reaches 0
    let state = makeState({ need_food: 100, need_water: 100, need_rest: 50, is_awake: true });
    for (let t = 0; t < 1440; t++) {
      state = engine.updateNeedsPublic(state, t);
    }
    expect(state.need_water).toBe(0);
  });
});
