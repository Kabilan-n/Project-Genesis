/**
 * Tests for BeliefEngine pure helpers.
 *
 * BeliefEngine is the largest engine in the simulation; most methods are
 * heavy DB orchestration plus LLM calls. This file covers the prescription
 * derivation logic (pure, decisive) and the colour picker. The full
 * lifecycle (foundBelief → preach → ritual → myth) is integration-testable.
 */
import { describe, it, expect, vi } from 'vitest';
import { BeliefEngine } from '../cultural/BeliefEngine.js';
import { makeAgent, makeTraits } from './fixtures.js';

class TestableBeliefEngine extends BeliefEngine {
  derivePrescriptionsPublic(coreTenet: string, founder: ReturnType<typeof makeAgent>) {
    return (this as any).derivePrescriptions(coreTenet, founder);
  }
  pickColourPublic(worldId: string) {
    return (this as any).pickColour(worldId);
  }
}

const engine = new TestableBeliefEngine();

describe('BeliefEngine.derivePrescriptions — keyword-driven', () => {
  it('flags aggression when tenet contains "war" or similar', () => {
    const p = engine.derivePrescriptionsPublic(
      'Strength through war and conquest', makeAgent(),
    );
    expect(p.aggression).toBe(true);
  });

  it('flags sharing when tenet mentions "communal" / "share"', () => {
    const p = engine.derivePrescriptionsPublic(
      'We share everything in common', makeAgent(),
    );
    expect(p.sharing).toBe(true);
  });

  it('flags isolation when tenet mentions "alone" / "chosen"', () => {
    const p = engine.derivePrescriptionsPublic(
      'The chosen walk alone', makeAgent(),
    );
    expect(p.isolation).toBe(true);
  });

  it('always prescribes ritual', () => {
    const p = engine.derivePrescriptionsPublic('Anything goes here', makeAgent());
    expect(p.ritual).toBe(true);
  });

  it('keyword check is case-insensitive', () => {
    const p = engine.derivePrescriptionsPublic('STRENGTH IS DOMINANCE', makeAgent());
    expect(p.aggression).toBe(true);
  });
});

describe('BeliefEngine.derivePrescriptions — trait fallback', () => {
  it('flags aggression when founder has aggression > 70 even if tenet is benign', () => {
    const p = engine.derivePrescriptionsPublic(
      'Walk gently with all beings',
      makeAgent({ traits: makeTraits({ aggression: 85 }) }),
    );
    expect(p.aggression).toBe(true);
  });

  it('flags sharing when founder has empathy > 70', () => {
    const p = engine.derivePrescriptionsPublic(
      'Quiet contemplation',
      makeAgent({ traits: makeTraits({ empathy: 85 }) }),
    );
    expect(p.sharing).toBe(true);
  });

  it('flags isolation when founder has trust_default < 30', () => {
    const p = engine.derivePrescriptionsPublic(
      'Open hearts, open hands',
      makeAgent({ traits: makeTraits({ trust_default: 20 }) }),
    );
    expect(p.isolation).toBe(true);
  });

  it('a balanced founder with neutral tenet gets no prescription flags except ritual', () => {
    const p = engine.derivePrescriptionsPublic(
      'Tend to your craft',
      makeAgent({ traits: makeTraits({
        aggression: 50, empathy: 50, trust_default: 50,
      }) }),
    );
    expect(p.aggression).toBe(false);
    expect(p.sharing).toBe(false);
    expect(p.isolation).toBe(false);
    expect(p.ritual).toBe(true);
  });
});

describe('BeliefEngine.pickColour', () => {
  it('returns the first unused colour from the palette', async () => {
    const querySpy = vi.spyOn(await import('../db.js'), 'query')
      .mockResolvedValueOnce([{ colour: '#a78bfa' }] as any);
    const result = await engine.pickColourPublic('world-1');
    expect(result).toBe('#f472b6'); // 2nd palette colour
    querySpy.mockRestore();
  });

  it('falls back to a random palette colour when all are taken', async () => {
    const allColours = [
      '#a78bfa', '#f472b6', '#fb923c', '#facc15',
      '#34d399', '#60a5fa', '#e879f9', '#4ade80',
    ].map((c) => ({ colour: c }));
    const querySpy = vi.spyOn(await import('../db.js'), 'query')
      .mockResolvedValueOnce(allColours as any);
    const result = await engine.pickColourPublic('world-1');
    expect(allColours.map((c) => c.colour)).toContain(result);
    querySpy.mockRestore();
  });
});
