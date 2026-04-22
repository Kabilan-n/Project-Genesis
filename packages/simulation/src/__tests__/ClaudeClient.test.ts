/**
 * Tests for AnthropicClient's private parser methods.
 * We expose them by sub-classing — no real API calls required.
 */
import { describe, it, expect } from 'vitest';
import { AnthropicClient } from '../llm/providers/AnthropicClient.js';

// Expose private parsers for testing via type-cast
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

// ─── parseDecision ──────────────────────────────────────────────────────────

describe('ClaudeClient.parseDecision', () => {
  it('parses a clean JSON decision', () => {
    const text = JSON.stringify({
      thought: 'I need food urgently.',
      action: 'gather food',
      speech: undefined,
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

  it('falls back to regex extraction when JSON is embedded in prose', () => {
    const text = 'Sure! Here is my decision: {"thought":"looking around","action":"do_nothing"}';
    const result = client.parseDecisionPublic(text);
    expect(result.action).toBe('do_nothing');
  });

  it('returns safe default when text is unparseable', () => {
    const result = client.parseDecisionPublic('I have no idea what to do!!');
    expect(result.thought).toBeTruthy();
    expect(result.action).toBe('do_nothing');
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

  it('preserves trade_offer when present', () => {
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
});

// ─── parseConversationTurn ──────────────────────────────────────────────────

describe('ClaudeClient.parseConversationTurn', () => {
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

  it('returns safe defaults for unparseable text', () => {
    const result = client.parseConversationPublic('uhhh...');
    expect(result.thought).toBeTruthy();
    expect(result.speech).toBeTruthy();
    expect(typeof result.is_ending).toBe('boolean');
  });

  it('defaults is_ending to false when field missing', () => {
    const text = JSON.stringify({ thought: 'thinking', speech: 'Hello there' });
    const result = client.parseConversationPublic(text);
    expect(result.is_ending).toBe(false);
  });

  it('defaults thought to placeholder when missing', () => {
    const text = JSON.stringify({ speech: 'Sure!', is_ending: false });
    const result = client.parseConversationPublic(text);
    expect(result.thought).toBeTruthy();
  });

  it('falls back to regex extraction when JSON is embedded in prose', () => {
    const text = 'Response: {"thought":"wondering","speech":"I see","is_ending":false} - done';
    const result = client.parseConversationPublic(text);
    expect(result.speech).toBe('I see');
  });
});

// ─── parseTradeResponse ─────────────────────────────────────────────────────

describe('ClaudeClient.parseTradeResponse', () => {
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

  it('normalises invalid decision to reject', () => {
    const text = JSON.stringify({
      thought: 'hmm',
      decision: 'maybe',
      reason: 'not sure',
    });
    const result = client.parseTradePublic(text);
    expect(result.decision).toBe('reject');
  });

  it('returns safe default for unparseable text', () => {
    const result = client.parseTradePublic('No JSON here at all');
    expect(result.decision).toBe('reject');
    expect(result.thought).toBeTruthy();
  });

  it('strips code fences before parsing', () => {
    const text = '```json\n{"thought":"fine","decision":"accept","reason":"ok"}\n```';
    const result = client.parseTradePublic(text);
    expect(result.decision).toBe('accept');
  });

  it('uses default thought when field missing', () => {
    const text = JSON.stringify({ decision: 'accept', reason: 'fair' });
    const result = client.parseTradePublic(text);
    expect(result.thought).toBeTruthy();
  });
});
