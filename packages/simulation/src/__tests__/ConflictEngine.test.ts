/**
 * Tests for ConflictEngine pure combat logic.
 *
 * combatPower and resolveSkirmish are deterministic enough (modulo a single
 * Math.random() variance) that we can pin them with a seeded random for
 * confident assertions.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ConflictEngine } from '../conflict/ConflictEngine.js';
import { makeAgent, makeAgentB, makeState, makeTraits } from './fixtures.js';

class TestableConflictEngine extends ConflictEngine {
  combatPowerPublic(agent: ReturnType<typeof makeAgent>) {
    return (this as any).combatPower(agent);
  }
  resolveSkirmishPublic(a: ReturnType<typeof makeAgent>, b: ReturnType<typeof makeAgent>) {
    return (this as any).resolveSkirmish(a, b);
  }
}

const engine = new TestableConflictEngine();

describe('ConflictEngine.combatPower', () => {
  it('combines aggression × 0.4 + hp × 0.3 + combat skill × 0.3', () => {
    const agent = makeAgent({
      traits: makeTraits({ aggression: 80 }),
      state: makeState({ hp: 60 }),
      skills: [{ skill_name: 'combat', level: 50, xp: 0 }],
    });
    // 80*0.4 + 60*0.3 + 50*0.3 = 32 + 18 + 15 = 65
    expect(engine.combatPowerPublic(agent)).toBe(65);
  });

  it('treats missing combat skill as level 0', () => {
    const agent = makeAgent({
      traits: makeTraits({ aggression: 50 }),
      state: makeState({ hp: 100 }),
      skills: [],
    });
    // 50*0.4 + 100*0.3 + 0 = 50
    expect(engine.combatPowerPublic(agent)).toBe(50);
  });

  it('an agent at 0 HP still has aggression-based power', () => {
    const agent = makeAgent({
      traits: makeTraits({ aggression: 100 }),
      state: makeState({ hp: 0 }),
      skills: [],
    });
    expect(engine.combatPowerPublic(agent)).toBe(40);
  });
});

describe('ConflictEngine.resolveSkirmish', () => {
  let randomSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    randomSpy?.mockRestore();
  });

  it('returns attacker_won when attacker has overwhelming power and defender does not flee', () => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5); // no variance, no flee
    const attacker = makeAgent({
      traits: makeTraits({ aggression: 100 }),
      state: makeState({ hp: 100 }),
      skills: [{ skill_name: 'combat', level: 100, xp: 0 }],
    });
    const defender = makeAgentB({
      traits: makeTraits({ aggression: 10 }),
      state: makeState({ hp: 50 }),
      skills: [],
    });
    const result = engine.resolveSkirmishPublic(attacker, defender);
    expect(result.outcome).toBe('attacker_won');
  });

  it('returns defender_won when defender outmatches attacker', () => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const attacker = makeAgent({
      traits: makeTraits({ aggression: 10 }),
      state: makeState({ hp: 30 }),
      skills: [],
    });
    const defender = makeAgentB({
      traits: makeTraits({ aggression: 100 }),
      state: makeState({ hp: 100 }),
      skills: [{ skill_name: 'combat', level: 80, xp: 0 }],
    });
    const result = engine.resolveSkirmishPublic(attacker, defender);
    // defender hp >= 30 so no flee path
    expect(result.outcome).toBe('defender_won');
  });

  it('low-HP defender has a chance to flee', () => {
    // Math.random sequence consumed: variance × 2, then flee check.
    // With 0.5 returned every time, 0.5 < 0.5 is false — no flee.
    // We need flee = Math.random() < 0.5 to be true.
    let calls = 0;
    randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
      calls++;
      // Two variance calls return 0.5 (no variance), flee check returns 0.1 (< 0.5)
      return calls <= 2 ? 0.5 : 0.1;
    });
    const attacker = makeAgent({
      traits: makeTraits({ aggression: 80 }),
      state: makeState({ hp: 100 }),
      skills: [],
    });
    const defender = makeAgentB({
      traits: makeTraits({ aggression: 50 }),
      state: makeState({ hp: 20 }), // < 30 → flee-eligible
      skills: [],
    });
    const result = engine.resolveSkirmishPublic(attacker, defender);
    expect(result.outcome).toBe('fled');
  });

  it('attacker takes less damage when winning', () => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const attacker = makeAgent({
      traits: makeTraits({ aggression: 100 }),
      state: makeState({ hp: 100 }),
      skills: [{ skill_name: 'combat', level: 100, xp: 0 }],
    });
    const defender = makeAgentB({
      traits: makeTraits({ aggression: 10 }),
      state: makeState({ hp: 100 }),
      skills: [],
    });
    const result = engine.resolveSkirmishPublic(attacker, defender);
    expect(result.hp_damage_attacker).toBeLessThan(result.hp_damage_defender);
  });

  it('rounds power and damage to one decimal place', () => {
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const result = engine.resolveSkirmishPublic(makeAgent(), makeAgentB());
    expect(result.attacker_power.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
    expect(result.hp_damage_attacker.toString()).toMatch(/^\d+(\.\d{1,2})?$/);
  });
});
