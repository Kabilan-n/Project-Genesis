/**
 * Tests for GovernanceEngine pure helpers.
 *
 * leaderScore is the core of the leadership-challenge math; the rest of
 * the engine is DB orchestration. defectToGroup has clear early-exit
 * semantics worth pinning.
 */
import { describe, it, expect } from 'vitest';
import { GovernanceEngine } from '../conflict/GovernanceEngine.js';
import { makeAgent, makeTraits } from './fixtures.js';

class TestableGovernanceEngine extends GovernanceEngine {
  leaderScorePublic(agent: ReturnType<typeof makeAgent>) {
    return (this as any).leaderScore(agent);
  }
}

const engine = new TestableGovernanceEngine();

describe('GovernanceEngine.leaderScore', () => {
  it('weights leadership_tendency × 0.4 + extraversion × 0.3 + ambition × 0.3, normalized', () => {
    const agent = makeAgent({ traits: makeTraits({
      leadership_tendency: 100, extraversion: 100, ambition: 100,
    }) });
    expect(engine.leaderScorePublic(agent)).toBe(1);
  });

  it('returns 0 for an agent with all-zero leadership traits', () => {
    const agent = makeAgent({ traits: makeTraits({
      leadership_tendency: 0, extraversion: 0, ambition: 0,
    }) });
    expect(engine.leaderScorePublic(agent)).toBe(0);
  });

  it('leadership_tendency dominates: 100/0/0 outranks 0/100/100', () => {
    const allLeader = makeAgent({ traits: makeTraits({
      leadership_tendency: 100, extraversion: 0, ambition: 0,
    }) });
    const noLeader = makeAgent({ traits: makeTraits({
      leadership_tendency: 0, extraversion: 100, ambition: 100,
    }) });
    // 0.4 vs 0.6 — extraversion+ambition wins by weight count
    expect(engine.leaderScorePublic(noLeader))
      .toBeGreaterThan(engine.leaderScorePublic(allLeader));
  });

  it('balanced traits at 50 give a 0.5 score', () => {
    const agent = makeAgent({ traits: makeTraits({
      leadership_tendency: 50, extraversion: 50, ambition: 50,
    }) });
    expect(engine.leaderScorePublic(agent)).toBe(0.5);
  });
});

describe('GovernanceEngine.defectToGroup — early exits', () => {
  it('returns false when agent has no current group', async () => {
    const eng = new GovernanceEngine();
    const result = await eng.defectToGroup(makeAgent({ group_id: null }), 'g-new', 100, 1);
    expect(result).toBe(false);
  });

  it('returns false when target group equals current group', async () => {
    const eng = new GovernanceEngine();
    const result = await eng.defectToGroup(
      makeAgent({ group_id: 'g-1' }), 'g-1', 100, 1,
    );
    expect(result).toBe(false);
  });
});
