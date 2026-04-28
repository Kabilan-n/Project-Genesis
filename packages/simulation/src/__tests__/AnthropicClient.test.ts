/**
 * Tests for AnthropicClient's private parser methods.
 *
 * Post-stabilization (phase 1 / task 1.4):
 *   - All payloads are validated with Zod schemas.
 *   - The regex-extract-from-prose fallback was removed; malformed JSON
 *     goes straight to a SAFE_DEFAULT_* sentinel and increments a metric.
 *   - SAFE_DEFAULT_* objects are identifiable by their
 *     `[parse failure fallback]` marker.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AnthropicClient } from '../llm/providers/AnthropicClient.js';
import { metrics } from '../observability/metrics.js';

class TestableAnthropicClient extends AnthropicClient {
  parseDecisionPublic(text: string) {
    return (this as any).parseDecision(text);
  }
  parseConversationPublic(text: string) {
    return (this as any).parseConversationTurn(text);
  }
  parseTradePublic(text: string) {
    return (this as any).parseTradeResponse(text);
  }
}

const client = new TestableAnthropicClient('claude-haiku-4-5-20251001');

beforeEach(() => {
  metrics.llmParseFailures.reset();
  metrics.llmCallErrors.reset();
});

// ─── parseDecision ──────────────────────────────────────────────────────────

describe('AnthropicClient.parseDecision', () => {
  it('parses a clean JSON decision', () => {
    const text = JSON.stringify({
      thought: 'I need food urgently.',
      action: 'gather food',
    });
    const result = client.parseDecisionPublic(text);
    expect(result.thought).toBe('I need food urgently.');
    expect(result.action).toBe('gather food');
  });

  it('strips markdown code fences', () => {
    const text = '```json\n{"thought":"ok","action":"rest"}\n```';
    const result = client.parseDecisionPublic(text);
    expect(result.thought).toBe('ok');
    expect(result.action).toBe('rest');
  });

  it('returns SAFE_DEFAULT_DECISION when JSON is embedded in prose (no regex fallback)', () => {
    const text = 'Sure! Here is my decision: {"thought":"looking around","action":"do_nothing"}';
    const result = client.parseDecisionPublic(text);
    expect(result.thought).toBe('[parse failure fallback]');
    expect(result.action).toBe('do_nothing');
    expect(metrics.llmParseFailures.get({ type: 'decision' })).toBe(1);
  });

  it('returns SAFE_DEFAULT_DECISION when text is unparseable', () => {
    const result = client.parseDecisionPublic('I have no idea what to do!!');
    expect(result.thought).toBe('[parse failure fallback]');
    expect(result.action).toBe('do_nothing');
    expect(metrics.llmParseFailures.get({ type: 'decision' })).toBe(1);
  });

  it('preserves optional speech field', () => {
    const text = JSON.stringify({ thought: 'hi', action: 'talk Bob', speech: 'Hello Bob!' });
    const result = client.parseDecisionPublic(text);
    expect(result.speech).toBe('Hello Bob!');
  });

  it('preserves optional target field', () => {
    const text = JSON.stringify({ thought: 'i see water', action: 'gather water', target: 'water' });
    const result = client.parseDecisionPublic(text);
    expect(result.target).toBe('water');
  });

  it('preserves nested trade_offer structure', () => {
    const offer = { offered_items: { food: 10 }, requested_items: { water: 5 } };
    const text = JSON.stringify({
      thought: 'lets trade',
      action: 'offer_trade Bob',
      trade_offer: offer,
    });
    const result = client.parseDecisionPublic(text);
    expect(result.trade_offer).toEqual(offer);
  });

  it('handles missing optional fields gracefully', () => {
    const text = JSON.stringify({ thought: 'moving north', action: 'move north' });
    const result = client.parseDecisionPublic(text);
    expect(result.speech).toBeUndefined();
    expect(result.target).toBeUndefined();
    expect(result.trade_offer).toBeUndefined();
  });

  it('rejects when required field `thought` is missing', () => {
    const text = JSON.stringify({ action: 'rest' });
    const result = client.parseDecisionPublic(text);
    expect(result.thought).toBe('[parse failure fallback]');
    expect(metrics.llmParseFailures.get({ type: 'decision' })).toBe(1);
  });

  it('rejects when speech exceeds length limit (500 chars)', () => {
    const text = JSON.stringify({
      thought: 'long-winded',
      action: 'talk Bob',
      speech: 'x'.repeat(501),
    });
    const result = client.parseDecisionPublic(text);
    expect(result.thought).toBe('[parse failure fallback]');
    expect(metrics.llmParseFailures.get({ type: 'decision' })).toBe(1);
  });

  it('rejects null payload as parse failure', () => {
    const result = client.parseDecisionPublic('null');
    expect(result.thought).toBe('[parse failure fallback]');
    expect(metrics.llmParseFailures.get({ type: 'decision' })).toBe(1);
  });

  it('strips unknown extra fields silently (default Zod object behavior)', () => {
    const text = JSON.stringify({
      thought: 'hi',
      action: 'rest',
      banana: 'should be ignored',
    });
    const result = client.parseDecisionPublic(text);
    expect(result.action).toBe('rest');
    expect((result as any).banana).toBeUndefined();
    // No metric increment — strip-unknowns is success, not failure.
    expect(metrics.llmParseFailures.get({ type: 'decision' })).toBe(0);
  });
});

// ─── parseConversationTurn ──────────────────────────────────────────────────

describe('AnthropicClient.parseConversationTurn', () => {
  it('parses a standard conversation response', () => {
    const text = JSON.stringify({
      thought: 'This seems friendly.',
      speech: 'Nice to meet you!',
      is_ending: false,
    });
    const result = client.parseConversationPublic(text);
    expect(result.thought).toBe('This seems friendly.');
    expect(result.speech).toBe('Nice to meet you!');
    expect(result.is_ending).toBe(false);
  });

  it('parses is_ending: true', () => {
    const text = JSON.stringify({
      thought: 'Time to leave.',
      speech: 'Goodbye!',
      is_ending: true,
    });
    const result = client.parseConversationPublic(text);
    expect(result.is_ending).toBe(true);
  });

  it('strips code fences', () => {
    const text = '```json\n{"thought":"hmm","speech":"ok","is_ending":false}\n```';
    const result = client.parseConversationPublic(text);
    expect(result.speech).toBe('ok');
  });

  it('returns SAFE_DEFAULT_CONVERSATION_TURN for unparseable text', () => {
    const result = client.parseConversationPublic('uhhh...');
    expect(result.thought).toBe('[parse failure fallback]');
    expect(result.is_ending).toBe(true);
    expect(metrics.llmParseFailures.get({ type: 'conversation' })).toBe(1);
  });

  it('rejects when required is_ending field is missing', () => {
    const text = JSON.stringify({ thought: 'thinking', speech: 'Hello there' });
    const result = client.parseConversationPublic(text);
    expect(result.thought).toBe('[parse failure fallback]');
    expect(metrics.llmParseFailures.get({ type: 'conversation' })).toBe(1);
  });

  it('rejects when required thought is missing', () => {
    const text = JSON.stringify({ speech: 'Sure!', is_ending: false });
    const result = client.parseConversationPublic(text);
    expect(result.thought).toBe('[parse failure fallback]');
    expect(metrics.llmParseFailures.get({ type: 'conversation' })).toBe(1);
  });

  it('returns SAFE_DEFAULT when JSON is embedded in prose (no regex fallback)', () => {
    const text = 'Response: {"thought":"wondering","speech":"I see","is_ending":false} - done';
    const result = client.parseConversationPublic(text);
    expect(result.thought).toBe('[parse failure fallback]');
    expect(metrics.llmParseFailures.get({ type: 'conversation' })).toBe(1);
  });
});

// ─── parseTradeResponse ─────────────────────────────────────────────────────

describe('AnthropicClient.parseTradeResponse', () => {
  it('parses an accept decision', () => {
    const text = JSON.stringify({
      thought: 'Good deal.',
      decision: 'accept',
      reason: 'I need food.',
    });
    const result = client.parseTradePublic(text);
    expect(result.decision).toBe('accept');
    expect(result.reason).toBe('I need food.');
  });

  it('parses a reject decision', () => {
    const text = JSON.stringify({
      thought: 'Not worth it.',
      decision: 'reject',
      reason: 'I do not need more food.',
    });
    const result = client.parseTradePublic(text);
    expect(result.decision).toBe('reject');
  });

  it('parses a counter decision with counter_offer', () => {
    const counter = {
      offered_items: { food: 8 },
      requested_items: { water: 4 },
    };
    const text = JSON.stringify({
      thought: 'I want a better deal.',
      decision: 'counter',
      reason: 'Reduce the ask.',
      counter_offer: counter,
    });
    const result = client.parseTradePublic(text);
    expect(result.decision).toBe('counter');
    expect(result.counter_offer).toEqual(counter);
  });

  it('rejects counter decision without counter_offer', () => {
    const text = JSON.stringify({
      thought: 'I want a better deal.',
      decision: 'counter',
      // counter_offer missing — refine() rejects this
    });
    const result = client.parseTradePublic(text);
    expect(result.decision).toBe('reject');                  // safe default
    expect(result.thought).toBe('[parse failure fallback]');
    expect(metrics.llmParseFailures.get({ type: 'trade' })).toBe(1);
  });

  it('rejects unknown decision verb', () => {
    const text = JSON.stringify({
      thought: 'hmm',
      decision: 'maybe',
      reason: 'not sure',
    });
    const result = client.parseTradePublic(text);
    expect(result.decision).toBe('reject');                  // safe default
    expect(result.thought).toBe('[parse failure fallback]');
    expect(metrics.llmParseFailures.get({ type: 'trade' })).toBe(1);
  });

  it('returns SAFE_DEFAULT_TRADE_RESPONSE for unparseable text', () => {
    const result = client.parseTradePublic('No JSON here at all');
    expect(result.decision).toBe('reject');
    expect(result.thought).toBe('[parse failure fallback]');
    expect(metrics.llmParseFailures.get({ type: 'trade' })).toBe(1);
  });

  it('strips code fences before parsing', () => {
    const text = '```json\n{"thought":"fine","decision":"accept","reason":"ok"}\n```';
    const result = client.parseTradePublic(text);
    expect(result.decision).toBe('accept');
  });

  it('rejects when required thought field is missing', () => {
    const text = JSON.stringify({ decision: 'accept', reason: 'fair' });
    const result = client.parseTradePublic(text);
    expect(result.thought).toBe('[parse failure fallback]');
    expect(metrics.llmParseFailures.get({ type: 'trade' })).toBe(1);
  });
});

// ─── metrics counter behavior ───────────────────────────────────────────────

describe('AnthropicClient — parse failure metrics', () => {
  it('separates parse failures by type', () => {
    client.parseDecisionPublic('not json');
    client.parseConversationPublic('not json');
    client.parseTradePublic('not json');
    expect(metrics.llmParseFailures.get({ type: 'decision' })).toBe(1);
    expect(metrics.llmParseFailures.get({ type: 'conversation' })).toBe(1);
    expect(metrics.llmParseFailures.get({ type: 'trade' })).toBe(1);
    expect(metrics.llmParseFailures.total()).toBe(3);
  });

  it('does not increment on a successful parse', () => {
    client.parseDecisionPublic(JSON.stringify({ thought: 'x', action: 'rest' }));
    expect(metrics.llmParseFailures.total()).toBe(0);
  });
});
