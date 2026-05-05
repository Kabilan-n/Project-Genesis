import Anthropic from '@anthropic-ai/sdk';
import CircuitBreaker from 'opossum';
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
import { BREAKER_OPTIONS, attachBreakerEvents } from '../breaker.js';
import { engineLogger } from '../../observability/logger.js';

const log = engineLogger('AnthropicClient');

type CompletionFn = (args: { prompt: string; maxTokens: number }) => Promise<string>;

export class AnthropicClient implements LLMClient {
  private client: Anthropic;
  private completionBreaker: CircuitBreaker<Parameters<CompletionFn>, string>;

  constructor(private model: string, apiKey?: string) {
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
    });

    // One breaker covers every Anthropic call. Provider-specific so a
    // Claude outage doesn't open the breaker for an OpenAI fallback.
    const completion: CompletionFn = async ({ prompt, maxTokens }) => {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      });
      return response.content[0].type === 'text' ? response.content[0].text : '';
    };
    this.completionBreaker = new CircuitBreaker(completion, BREAKER_OPTIONS);
    attachBreakerEvents(this.completionBreaker, { label: 'anthropic' });
  }

  /**
   * Run a completion via the circuit breaker. On breaker-open or any
   * provider error, returns null so callers can apply their own typed
   * fallback. The breaker counts the rejection toward its window.
   */
  private async safeCompletion(prompt: string, maxTokens: number): Promise<string | null> {
    try {
      return await this.completionBreaker.fire({ prompt, maxTokens });
    } catch {
      return null;
    }
  }

  async getAgentDecision(prompt: string): Promise<AgentDecision> {
    const text = await this.safeCompletion(prompt, 300);
    if (text === null) {
      metrics.llmCallErrors.inc({ kind: 'decision' });
      return SAFE_DEFAULT_DECISION;
    }
    return this.parseDecision(text);
  }

  async getConversationResponse(prompt: string): Promise<ConversationTurnResponse> {
    const text = await this.safeCompletion(prompt, 250);
    if (text === null) {
      metrics.llmCallErrors.inc({ kind: 'conversation' });
      return SAFE_DEFAULT_CONVERSATION_TURN;
    }
    return this.parseConversationTurn(text);
  }

  async getTradeResponse(prompt: string): Promise<TradeResponse> {
    const text = await this.safeCompletion(prompt, 250);
    if (text === null) {
      metrics.llmCallErrors.inc({ kind: 'trade' });
      return SAFE_DEFAULT_TRADE_RESPONSE;
    }
    return this.parseTradeResponse(text);
  }

  async getRawCompletion(prompt: string, maxTokens = 100): Promise<string> {
    // Raw completion does NOT use the breaker because its callers (e.g.,
    // MemoryDecay.consolidateBatch) already have their own try/catch +
    // deterministic fallback. Adding a breaker here would double-count
    // failures.
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
      log.warn({
        err: err instanceof Error ? err.message : String(err),
        textPreview: text.slice(0, 500),
        parser: 'parseDecision',
      }, 'llm_parse_failure');
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
      log.warn({
        err: err instanceof Error ? err.message : String(err),
        textPreview: text.slice(0, 500),
        parser: 'parseConversationTurn',
      }, 'llm_parse_failure');
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
      log.warn({
        err: err instanceof Error ? err.message : String(err),
        textPreview: text.slice(0, 500),
        parser: 'parseTradeResponse',
      }, 'llm_parse_failure');
      return SAFE_DEFAULT_TRADE_RESPONSE;
    }
  }
}

function stripCodeFences(text: string): string {
  return text.replace(/```(?:json)?\n?|\n?```/g, '').trim();
}
