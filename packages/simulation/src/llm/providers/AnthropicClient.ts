import Anthropic from '@anthropic-ai/sdk';
import type { AgentDecision } from '../../types.js';
import type { TradeResponse } from '../../social/TradeEngine.js';
import type { LLMClient, ConversationTurnResponse } from '../types.js';
import {
  DecisionSchema, ConversationTurnSchema, TradeResponseSchema,
} from '../schemas.js';
import {
  SAFE_DEFAULT_DECISION, SAFE_DEFAULT_CONVERSATION_TURN, SAFE_DEFAULT_TRADE_RESPONSE,
} from '../defaults.js';
import { metrics } from '../../observability/metrics.js';

export class AnthropicClient implements LLMClient {
  private client: Anthropic;

  constructor(private model: string, apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  async getAgentDecision(prompt: string): Promise<AgentDecision> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return this.parseDecision(text);
    } catch (err) {
      metrics.llmCallErrors.inc({ kind: 'decision' });
      console.error('[AnthropicClient] Error calling API:', err);
      return SAFE_DEFAULT_DECISION;
    }
  }

  async getConversationResponse(prompt: string): Promise<ConversationTurnResponse> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 250,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return this.parseConversationTurn(text);
    } catch (err) {
      metrics.llmCallErrors.inc({ kind: 'conversation' });
      console.error('[AnthropicClient] Conversation error:', err);
      return SAFE_DEFAULT_CONVERSATION_TURN;
    }
  }

  async getTradeResponse(prompt: string): Promise<TradeResponse> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 250,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return this.parseTradeResponse(text);
    } catch (err) {
      metrics.llmCallErrors.inc({ kind: 'trade' });
      console.error('[AnthropicClient] Trade error:', err);
      return SAFE_DEFAULT_TRADE_RESPONSE;
    }
  }

  async getRawCompletion(prompt: string, maxTokens = 100): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return response.content[0].type === 'text' ? response.content[0].text : '';
  }

  // ── Parsers ──────────────────────────────────────────────
  // Strict path: strip code fences, JSON.parse, then schema-validate.
  // No regex fallback — extraction-from-prose was hiding bugs, not fixing them.
  // Validation failures emit a metric and return a SAFE_DEFAULT_* sentinel
  // whose `[parse failure fallback]` marker is identifiable in logs.

  private parseDecision(text: string): AgentDecision {
    const cleaned = stripCodeFences(text);
    try {
      const parsed = JSON.parse(cleaned);
      return DecisionSchema.parse(parsed) as AgentDecision;
    } catch (err) {
      metrics.llmParseFailures.inc({ type: 'decision' });
      console.warn('[AnthropicClient] parseDecision failure:', {
        err: err instanceof Error ? err.message : String(err),
        textPreview: text.slice(0, 500),
      });
      return SAFE_DEFAULT_DECISION;
    }
  }

  private parseConversationTurn(text: string): ConversationTurnResponse {
    const cleaned = stripCodeFences(text);
    try {
      const parsed = JSON.parse(cleaned);
      return ConversationTurnSchema.parse(parsed);
    } catch (err) {
      metrics.llmParseFailures.inc({ type: 'conversation' });
      console.warn('[AnthropicClient] parseConversationTurn failure:', {
        err: err instanceof Error ? err.message : String(err),
        textPreview: text.slice(0, 500),
      });
      return SAFE_DEFAULT_CONVERSATION_TURN;
    }
  }

  private parseTradeResponse(text: string): TradeResponse {
    const cleaned = stripCodeFences(text);
    try {
      const parsed = JSON.parse(cleaned);
      return TradeResponseSchema.parse(parsed) as TradeResponse;
    } catch (err) {
      metrics.llmParseFailures.inc({ type: 'trade' });
      console.warn('[AnthropicClient] parseTradeResponse failure:', {
        err: err instanceof Error ? err.message : String(err),
        textPreview: text.slice(0, 500),
      });
      return SAFE_DEFAULT_TRADE_RESPONSE;
    }
  }
}

function stripCodeFences(text: string): string {
  return text.replace(/```(?:json)?\n?|\n?```/g, '').trim();
}
