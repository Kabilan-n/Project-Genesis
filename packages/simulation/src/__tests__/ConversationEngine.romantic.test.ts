/**
 * Tests for the romantic-candidacy gate in ConversationEngine.
 *
 * The check itself (`shouldFlagRomanticCandidacy`) is a pure function of two
 * agents' traits. The DB write that flips `is_romantic_candidate = TRUE` is
 * exercised separately when the simulation runs against a real database.
 *
 * The codebase has no `openness` Big-Five trait; we proxy with `curiosity`,
 * matching ConversationEngine.shouldFlagRomanticCandidacy.
 */
import { describe, it, expect } from 'vitest';
import { ConversationEngine } from '../social/ConversationEngine.js';
import { makeAgent, makeAgentB, makeTraits } from './fixtures.js';

const engine = new ConversationEngine();

describe('ConversationEngine.shouldFlagRomanticCandidacy', () => {
  it('flags when both agents have curiosity ≥ 50', () => {
    const a = makeAgent({  traits: makeTraits({ curiosity: 60 }) });
    const b = makeAgentB({ traits: makeTraits({ curiosity: 80 }) });
    expect(engine.shouldFlagRomanticCandidacy(a, b)).toBe(true);
  });

  it('does NOT flag when one agent has low curiosity (openness proxy)', () => {
    const a = makeAgent({  traits: makeTraits({ curiosity: 70 }) });
    const b = makeAgentB({ traits: makeTraits({ curiosity: 30 }) });
    expect(engine.shouldFlagRomanticCandidacy(a, b)).toBe(false);
  });

  it('does NOT flag when both agents have curiosity below 50', () => {
    const a = makeAgent({  traits: makeTraits({ curiosity: 20 }) });
    const b = makeAgentB({ traits: makeTraits({ curiosity: 25 }) });
    expect(engine.shouldFlagRomanticCandidacy(a, b)).toBe(false);
  });

  it('is symmetric: swapping initiator and target gives the same answer', () => {
    const a = makeAgent({  traits: makeTraits({ curiosity: 75 }) });
    const b = makeAgentB({ traits: makeTraits({ curiosity: 55 }) });
    expect(engine.shouldFlagRomanticCandidacy(a, b)).toBe(true);
    expect(engine.shouldFlagRomanticCandidacy(b, a)).toBe(true);
  });

  it('treats curiosity = 50 as the inclusive boundary', () => {
    const a = makeAgent({  traits: makeTraits({ curiosity: 50 }) });
    const b = makeAgentB({ traits: makeTraits({ curiosity: 50 }) });
    expect(engine.shouldFlagRomanticCandidacy(a, b)).toBe(true);
  });
});
