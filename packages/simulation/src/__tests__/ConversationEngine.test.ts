/**
 * Tests for ConversationEngine pure-logic methods:
 *   - computeOutcome   (keyword-based scoring)
 *   - computeRelationshipChanges (delta computation)
 *   - extractTopic (topic from first turn)
 *
 * DB/Claude calls are NOT triggered — we test only the private pure functions.
 */
import { describe, it, expect, vi } from 'vitest';
import { ConversationEngine } from '../social/ConversationEngine.js';
import {
  makeAgent, makeAgentB, makeConversationTurn, makeTraits,
  AGENT_ID_A, AGENT_ID_B,
} from './fixtures.js';
import type { ConversationTurn } from '../types.js';

// ─── Expose private methods ─────────────────────────────────────────────────

class TestableConversationEngine extends ConversationEngine {
  computeOutcomePublic(turns: ConversationTurn[]) {
    return (this as any).computeOutcome(turns);
  }

  computeRelationshipChangesPublic(
    initiator: ReturnType<typeof makeAgent>,
    target: ReturnType<typeof makeAgentB>,
    turns: ConversationTurn[],
    outcome: ReturnType<TestableConversationEngine['computeOutcomePublic']>
  ) {
    return (this as any).computeRelationshipChanges(initiator, target, turns, outcome);
  }

  extractTopicPublic(turns: ConversationTurn[]) {
    return (this as any).extractTopic(turns);
  }
}

const engine = new TestableConversationEngine();

// ─── computeOutcome ──────────────────────────────────────────────────────────

describe('ConversationEngine.computeOutcome', () => {
  it('returns "bonding" for ≥3 positive words and 0 negative', () => {
    const turns = [
      makeConversationTurn(AGENT_ID_A, 'Alice', 'I want to be your friend and help you.', 1),
      makeConversationTurn(AGENT_ID_B, 'Bob', 'I trust you and I am glad we share this together.', 2),
    ];
    const outcome = engine.computeOutcomePublic(turns);
    expect(outcome).toBe('bonding');
  });

  it('returns "friendly" for exactly 2 positive words and 0 negative words', () => {
    // "glad" = 1, "help" = 2 — total 2 positive, 0 negative → friendly (not bonding which needs ≥3)
    const turns = [
      makeConversationTurn(AGENT_ID_A, 'Alice', 'I am glad to see you.', 1),
      makeConversationTurn(AGENT_ID_B, 'Bob', 'Good to help out.', 2),
    ];
    const outcome = engine.computeOutcomePublic(turns);
    expect(outcome).toBe('friendly');
  });

  it('returns "hostile" for ≥3 negative words and 0 positive', () => {
    const turns = [
      makeConversationTurn(AGENT_ID_A, 'Alice', 'You are my enemy and a threat. I feel angry.', 1),
      makeConversationTurn(AGENT_ID_B, 'Bob', 'I warn you, danger is coming.', 2),
    ];
    const outcome = engine.computeOutcomePublic(turns);
    expect(outcome).toBe('hostile');
  });

  it('returns "conflict" for ≥2 negative words', () => {
    const turns = [
      makeConversationTurn(AGENT_ID_A, 'Alice', 'I hate this place, it is a danger.', 1),
      makeConversationTurn(AGENT_ID_B, 'Bob', 'I warned you.', 2),
    ];
    const outcome = engine.computeOutcomePublic(turns);
    expect(outcome).toBe('conflict');
  });

  it('returns "neutral" for ordinary conversation', () => {
    const turns = [
      makeConversationTurn(AGENT_ID_A, 'Alice', 'What are you doing here?', 1),
      makeConversationTurn(AGENT_ID_B, 'Bob', 'Just passing through the area.', 2),
    ];
    const outcome = engine.computeOutcomePublic(turns);
    expect(outcome).toBe('neutral');
  });

  it('returns "neutral" for empty turns array', () => {
    const outcome = engine.computeOutcomePublic([]);
    expect(outcome).toBe('neutral');
  });

  it('counts words in thought field as well as message', () => {
    const turn: ConversationTurn = {
      turn_number: 1,
      speaker_id: AGENT_ID_A,
      speaker_name: 'Alice',
      message: 'Hello.',
      thought: 'I consider them a friend and I care about them. I love being together.',
      is_ending: false,
    };
    const outcome = engine.computeOutcomePublic([turn]);
    expect(outcome).toBe('bonding');
  });
});

// ─── computeRelationshipChanges ──────────────────────────────────────────────

describe('ConversationEngine.computeRelationshipChanges', () => {
  const turns = [makeConversationTurn(AGENT_ID_A, 'Alice', 'Hello!', 1)];

  it('produces entries for both agents', () => {
    const initiator = makeAgent();
    const target = makeAgentB();
    const changes = engine.computeRelationshipChangesPublic(initiator, target, turns, 'neutral');
    expect(Object.keys(changes)).toContain(AGENT_ID_A);
    expect(Object.keys(changes)).toContain(AGENT_ID_B);
  });

  it('bonding outcome produces positive trust delta', () => {
    const changes = engine.computeRelationshipChangesPublic(
      makeAgent(), makeAgentB(), turns, 'bonding'
    );
    expect(changes[AGENT_ID_A].trust).toBeGreaterThan(0);
  });

  it('hostile outcome produces negative trust delta', () => {
    const changes = engine.computeRelationshipChangesPublic(
      makeAgent(), makeAgentB(), turns, 'hostile'
    );
    expect(changes[AGENT_ID_A].trust).toBeLessThan(0);
  });

  it('hostile outcome produces positive fear delta', () => {
    const changes = engine.computeRelationshipChangesPublic(
      makeAgent(), makeAgentB(), turns, 'hostile'
    );
    expect(changes[AGENT_ID_A].fear).toBeGreaterThan(0);
  });

  it('bonding outcome has larger trust delta than friendly', () => {
    const bonding = engine.computeRelationshipChangesPublic(
      makeAgent(), makeAgentB(), turns, 'bonding'
    );
    const friendly = engine.computeRelationshipChangesPublic(
      makeAgent(), makeAgentB(), turns, 'friendly'
    );
    expect(bonding[AGENT_ID_A].trust!).toBeGreaterThan(friendly[AGENT_ID_A].trust!);
  });

  it('high empathy (≥50) boosts affection on positive outcome', () => {
    const highEmpathy = makeAgent({ traits: makeTraits({ empathy: 90 }) });
    const lowEmpathy  = makeAgent({ traits: makeTraits({ empathy: 10 }) });
    const target = makeAgentB();

    const highChanges = engine.computeRelationshipChangesPublic(highEmpathy, target, turns, 'bonding');
    const lowChanges  = engine.computeRelationshipChangesPublic(lowEmpathy,  target, turns, 'bonding');

    expect(highChanges[AGENT_ID_A].affection!).toBeGreaterThan(
      lowChanges[AGENT_ID_A].affection!
    );
  });

  it('reconciliation outcome reduces fear', () => {
    const changes = engine.computeRelationshipChangesPublic(
      makeAgent(), makeAgentB(), turns, 'reconciliation'
    );
    expect(changes[AGENT_ID_A].fear).toBeLessThan(0);
  });
});

// ─── extractTopic ────────────────────────────────────────────────────────────

describe('ConversationEngine.extractTopic', () => {
  it('returns first turn message up to 50 chars', () => {
    const turns = [makeConversationTurn(AGENT_ID_A, 'Alice', 'Shall we trade food for wood?', 1)];
    const topic = engine.extractTopicPublic(turns);
    expect(topic).toBe('Shall we trade food for wood?');
  });

  it('truncates long first messages to 50 chars', () => {
    const longMsg = 'a'.repeat(100);
    const turns = [makeConversationTurn(AGENT_ID_A, 'Alice', longMsg, 1)];
    const topic = engine.extractTopicPublic(turns);
    expect(topic.length).toBe(50);
  });

  it('returns "general" for empty turns array', () => {
    const topic = engine.extractTopicPublic([]);
    expect(topic).toBe('general');
  });
});
