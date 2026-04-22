import Anthropic from '@anthropic-ai/sdk';
import type { AgentDecision } from '../types.js';
import type { TradeResponse } from '../social/TradeEngine.js';

const MODEL = process.env.LLM_MODEL ?? 'claude-haiku-4-5-20251001';

export interface ConversationTurnResponse {
  thought: string;
  speech: string;
  is_ending: boolean;
}

export class ClaudeClient {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async getAgentDecision(prompt: string): Promise<AgentDecision> {
    try {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return this.parseDecision(text);
    } catch (err) {
      console.error('[ClaudeClient] Error calling API:', err);
      return { thought: 'I feel confused.', action: 'do_nothing' };
    }
  }

  async getConversationResponse(prompt: string): Promise<ConversationTurnResponse> {
    try {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 250,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return this.parseConversationTurn(text);
    } catch (err) {
      console.error('[ClaudeClient] Conversation error:', err);
      return { thought: 'I am unsure how to respond.', speech: '...', is_ending: true };
    }
  }

  async getTradeResponse(prompt: string): Promise<TradeResponse> {
    try {
      const response = await this.client.messages.create({
        model: MODEL,
        max_tokens: 250,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return this.parseTradeResponse(text);
    } catch (err) {
      console.error('[ClaudeClient] Trade error:', err);
      return { decision: 'reject', thought: 'Something feels off.', reason: 'Uncertain' };
    }
  }

  /** Get a plain text completion (used by MemoryDecay consolidation). */
  async getRawCompletion(prompt: string, maxTokens = 100): Promise<string> {
    const response = await this.client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return response.content[0].type === 'text' ? response.content[0].text : '';
  }

  // ── Parsers ──────────────────────────────────────────────

  private parseDecision(text: string): AgentDecision {
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      if (typeof parsed.thought === 'string' && typeof parsed.action === 'string') {
        return {
          thought: parsed.thought,
          action: parsed.action,
          speech: typeof parsed.speech === 'string' ? parsed.speech : undefined,
          target: typeof parsed.target === 'string' ? parsed.target : undefined,
          trade_offer: parsed.trade_offer ?? undefined,
          gossip_subject: typeof parsed.gossip_subject === 'string' ? parsed.gossip_subject : undefined,
          gossip_claim: typeof parsed.gossip_claim === 'string' ? parsed.gossip_claim as any : undefined,
          group_name: typeof parsed.group_name === 'string' ? parsed.group_name : undefined,
          group_purpose: typeof parsed.group_purpose === 'string' ? parsed.group_purpose : undefined,
        };
      }
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch { /* fall through */ }
      }
    }
    return { thought: 'I am not sure what to do.', action: 'do_nothing' };
  }

  private parseConversationTurn(text: string): ConversationTurnResponse {
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      return {
        thought:    typeof parsed.thought    === 'string'  ? parsed.thought    : 'thinking...',
        speech:     typeof parsed.speech     === 'string'  ? parsed.speech     : '...',
        is_ending:  typeof parsed.is_ending  === 'boolean' ? parsed.is_ending  : false,
      };
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const p = JSON.parse(match[0]);
          return {
            thought:   p.thought   ?? 'thinking...',
            speech:    p.speech    ?? text.slice(0, 150),
            is_ending: p.is_ending ?? false,
          };
        } catch { /* fall through */ }
      }
    }
    return { thought: 'Unsure.', speech: text.slice(0, 150).trim(), is_ending: true };
  }

  private parseTradeResponse(text: string): TradeResponse {
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      const decision = ['accept', 'reject', 'counter'].includes(parsed.decision)
        ? parsed.decision as TradeResponse['decision']
        : 'reject';
      return {
        decision,
        thought: parsed.thought ?? 'Considering the offer...',
        counter_offer: parsed.counter_offer ?? undefined,
        reason: parsed.reason ?? undefined,
      };
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch { /* fall through */ }
      }
    }
    // Default: reject if we can't parse
    return { decision: 'reject', thought: 'Something felt off.', reason: 'Unclear offer' };
  }
}
