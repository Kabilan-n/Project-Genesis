/**
 * Tests for LawEngine.
 *
 * checkForViolations is the cleanest pure-data path; the rest is DB
 * orchestration. Vote-tally → quorum → enact transitions are also
 * decision logic worth pinning, but they happen inside runLawTick which
 * is DB-heavy. We test the violation classifier directly.
 */
import { describe, it, expect } from 'vitest';
import { LawEngine } from '../civilisation/LawEngine.js';
import { makeAgent } from './fixtures.js';

describe('LawEngine.checkForViolations', () => {
  it('returns [] for an agent with no group_id', async () => {
    const eng = new LawEngine();
    const result = await eng.checkForViolations(makeAgent({ group_id: null }), 'raid');
    expect(result).toEqual([]);
  });
});

describe('LawEngine — quorum and enactment math (pure)', () => {
  // Mirror the runLawTick decision rule so behaviour is documented.
  function decideOutcome(
    memberCount: number,
    votesFor: number,
    votesAgainst: number,
  ): 'active' | 'repealed' {
    const QUORUM_FRACTION = 0.5;
    const total = votesFor + votesAgainst;
    const quorum = total >= Math.ceil(memberCount * QUORUM_FRACTION);
    return quorum && votesFor > votesAgainst ? 'active' : 'repealed';
  }

  it('passes when votes meet quorum and majority is in favour', () => {
    expect(decideOutcome(10, 4, 1)).toBe('active');
  });

  it('repeals when there is no quorum even if all votes are in favour', () => {
    expect(decideOutcome(10, 2, 0)).toBe('repealed');
  });

  it('repeals on a tied vote (votes_for must STRICTLY exceed votes_against)', () => {
    expect(decideOutcome(10, 3, 3)).toBe('repealed');
  });

  it('passes on the smallest possible quorum + majority', () => {
    // member_count=2 → quorum=1; one vote in favour reaches quorum
    expect(decideOutcome(2, 1, 0)).toBe('active');
  });

  it('passes for a unanimous group of 4', () => {
    expect(decideOutcome(4, 4, 0)).toBe('active');
  });
});
