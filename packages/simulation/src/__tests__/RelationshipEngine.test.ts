/**
 * Tests for RelationshipEngine.determineType — the relationship-type state machine.
 * This is a pure function; no DB calls are needed.
 */
import { describe, it, expect } from 'vitest';
import { RelationshipEngine } from '../social/RelationshipEngine.js';

// Expose private determineType
class TestableRelationshipEngine extends RelationshipEngine {
  determineTypePublic(rel: {
    trust_score: number;
    affection_score: number;
    respect_score: number;
    fear_score: number;
    interaction_count: number;
    positive_interaction_count: number;
    negative_interaction_count: number;
  }) {
    return (this as any).determineType(rel);
  }
}

const engine = new TestableRelationshipEngine();

function rel(overrides: Partial<{
  trust_score: number;
  affection_score: number;
  respect_score: number;
  fear_score: number;
  interaction_count: number;
  positive_interaction_count: number;
  negative_interaction_count: number;
}> = {}) {
  return {
    trust_score: 30,
    affection_score: 20,
    respect_score: 20,
    fear_score: 5,
    interaction_count: 1,
    positive_interaction_count: 1,
    negative_interaction_count: 0,
    ...overrides,
  };
}

// ─── enemy ────────────────────────────────────────────────────────────────────

describe('RelationshipEngine.determineType — enemy', () => {
  it('returns "enemy" when trust < 15 and fear > 50', () => {
    expect(engine.determineTypePublic(rel({ trust_score: 10, fear_score: 60, affection_score: 10 }))).toBe('enemy');
  });

  it('returns "enemy" when trust < 15 and affection < 5', () => {
    expect(engine.determineTypePublic(rel({ trust_score: 5, affection_score: 2, fear_score: 10 }))).toBe('enemy');
  });

  it('does NOT return "enemy" when trust is 15', () => {
    const type = engine.determineTypePublic(rel({ trust_score: 15, fear_score: 60 }));
    expect(type).not.toBe('enemy');
  });
});

// ─── rival ────────────────────────────────────────────────────────────────────

describe('RelationshipEngine.determineType — rival', () => {
  it('returns "rival" when trust < 30 and respect > 50', () => {
    expect(engine.determineTypePublic(rel({ trust_score: 20, respect_score: 60, affection_score: 20 }))).toBe('rival');
  });

  it('does NOT return "rival" when trust ≥ 30', () => {
    const type = engine.determineTypePublic(rel({ trust_score: 30, respect_score: 60 }));
    expect(type).not.toBe('rival');
  });

  it('does NOT return "rival" when respect ≤ 50', () => {
    const type = engine.determineTypePublic(rel({ trust_score: 20, respect_score: 50 }));
    expect(type).not.toBe('rival');
  });
});

// ─── romantic_partner ─────────────────────────────────────────────────────────
// NOTE: close_friend check runs before romantic_partner in determineType.
// close_friend requires interactions≥15 + positive_interactions≥10.
// romantic_partner requires interactions≥10.
// So romantic_partner fires when 10≤interactions<15 (or positive_interactions<10).

describe('RelationshipEngine.determineType — romantic_partner', () => {
  it('returns "romantic_partner" when trust ≥ 85, affection ≥ 90, interactions ≥ 10 but < 15', () => {
    // interaction_count=12 means close_friend (needs ≥15) won't fire, so romantic_partner fires
    expect(engine.determineTypePublic(rel({
      trust_score: 90, affection_score: 95, interaction_count: 12, positive_interaction_count: 8,
    }))).toBe('romantic_partner');
  });

  it('does NOT return "romantic_partner" when affection is 89', () => {
    const type = engine.determineTypePublic(rel({
      trust_score: 90, affection_score: 89, interaction_count: 12,
    }));
    expect(type).not.toBe('romantic_partner');
  });

  it('close_friend fires before romantic_partner when interaction_count ≥ 15 and positive ≥ 10', () => {
    // close_friend check runs first: trust≥80 + affection≥70 + interactions≥15 + positive≥10
    const type = engine.determineTypePublic(rel({
      trust_score: 90, affection_score: 95, interaction_count: 16, positive_interaction_count: 12,
    }));
    expect(type).toBe('close_friend');
  });
});

// ─── close_friend ─────────────────────────────────────────────────────────────

describe('RelationshipEngine.determineType — close_friend', () => {
  it('returns "close_friend" when trust ≥ 80, affection ≥ 70, interactions ≥ 15, positive ≥ 10', () => {
    expect(engine.determineTypePublic(rel({
      trust_score: 80, affection_score: 70, interaction_count: 15, positive_interaction_count: 10,
    }))).toBe('close_friend');
  });

  it('does NOT return "close_friend" when interactions < 15', () => {
    const type = engine.determineTypePublic(rel({
      trust_score: 80, affection_score: 70, interaction_count: 14, positive_interaction_count: 10,
    }));
    expect(type).not.toBe('close_friend');
  });

  it('does NOT return "close_friend" when positive_interactions < 10', () => {
    const type = engine.determineTypePublic(rel({
      trust_score: 80, affection_score: 70, interaction_count: 16, positive_interaction_count: 9,
    }));
    expect(type).not.toBe('close_friend');
  });

  it('does NOT return "close_friend" when trust < 80', () => {
    const type = engine.determineTypePublic(rel({
      trust_score: 79, affection_score: 70, interaction_count: 16, positive_interaction_count: 12,
    }));
    expect(type).not.toBe('close_friend');
  });
});

// ─── friend ───────────────────────────────────────────────────────────────────

describe('RelationshipEngine.determineType — friend', () => {
  it('returns "friend" when trust ≥ 55, affection ≥ 40, interactions ≥ 8, positive ≥ 5', () => {
    expect(engine.determineTypePublic(rel({
      trust_score: 55, affection_score: 40, interaction_count: 8, positive_interaction_count: 5,
    }))).toBe('friend');
  });

  it('does NOT return "friend" when interactions < 8', () => {
    const type = engine.determineTypePublic(rel({
      trust_score: 60, affection_score: 45, interaction_count: 7, positive_interaction_count: 5,
    }));
    expect(type).not.toBe('friend');
  });

  it('does NOT return "friend" when affection < 40', () => {
    const type = engine.determineTypePublic(rel({
      trust_score: 60, affection_score: 39, interaction_count: 10, positive_interaction_count: 6,
    }));
    expect(type).not.toBe('friend');
  });

  it('does NOT return "friend" when positive_interactions < 5', () => {
    const type = engine.determineTypePublic(rel({
      trust_score: 60, affection_score: 45, interaction_count: 10, positive_interaction_count: 4,
    }));
    expect(type).not.toBe('friend');
  });
});

// ─── acquaintance ─────────────────────────────────────────────────────────────

describe('RelationshipEngine.determineType — acquaintance', () => {
  it('returns "acquaintance" when interactions ≥ 3 and trust ≥ 20', () => {
    expect(engine.determineTypePublic(rel({
      trust_score: 25, interaction_count: 3,
    }))).toBe('acquaintance');
  });

  it('does NOT return "acquaintance" when trust < 20', () => {
    const type = engine.determineTypePublic(rel({
      trust_score: 19, interaction_count: 4,
    }));
    expect(type).not.toBe('acquaintance');
  });

  it('does NOT return "acquaintance" when interactions < 3', () => {
    const type = engine.determineTypePublic(rel({
      trust_score: 40, interaction_count: 2,
    }));
    expect(type).not.toBe('acquaintance');
  });
});

// ─── stranger ─────────────────────────────────────────────────────────────────

describe('RelationshipEngine.determineType — stranger', () => {
  it('returns "stranger" for a brand-new relationship', () => {
    expect(engine.determineTypePublic(rel({
      trust_score: 10, affection_score: 10, interaction_count: 1,
    }))).toBe('stranger');
  });

  it('returns "stranger" as default', () => {
    expect(engine.determineTypePublic(rel())).toBe('stranger');
  });
});

// ─── Priority ordering ────────────────────────────────────────────────────────

describe('RelationshipEngine.determineType — priority ordering', () => {
  it('enemy takes priority over rival (both low trust, but low affection and high fear wins)', () => {
    // trust < 15, fear > 50  → enemy
    // trust < 30, respect > 50 → would be rival but enemy fires first
    const type = engine.determineTypePublic(rel({
      trust_score: 10,
      fear_score: 60,
      respect_score: 60,
      affection_score: 2,
    }));
    expect(type).toBe('enemy');
  });

  it('close_friend takes priority over romantic_partner when interactions ≥ 15 and positive ≥ 10', () => {
    // close_friend check runs first: trust≥80 + affection≥70 + interactions≥15 + positive≥10
    // Even though romantic_partner threshold (trust≥85 + affection≥90) is also met,
    // close_friend fires first due to code order
    const type = engine.determineTypePublic(rel({
      trust_score: 90,
      affection_score: 92,
      interaction_count: 16,
      positive_interaction_count: 12,
    }));
    expect(type).toBe('close_friend');
  });
});
