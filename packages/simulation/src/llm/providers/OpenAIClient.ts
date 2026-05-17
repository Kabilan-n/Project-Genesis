import CircuitBreaker from 'opossum';
import type { AgentDecision } from '../../types.js';
import type { TradeResponse } from '../../social/TradeEngine.js';
import type { LLMClient, ConversationTurnResponse } from '../types.js';
import {
  parseDecision, parseConversationTurn, parseTradeResponse,
} from '../parsing.js';
import {
  SAFE_DEFAULT_DECISION, SAFE_DEFAULT_CONVERSATION_TURN, SAFE_DEFAULT_TRADE_RESPONSE,
} from '../defaults.js';
import { metrics } from '../../observability/metrics.js';
import { engineLogger } from '../../observability/logger.js';
import { BREAKER_OPTIONS, attachBreakerEvents } from '../breaker.js';

const log = engineLogger('OpenAIClient');
const PROVIDER = 'openai';

type CompletionFn = (args: { prompt: string; maxTokens: number }) => Promise<string>;

export class OpenAIClient implements LLMClient {
  private client: any;
  private completionBreaker: CircuitBreaker<Parameters<CompletionFn>, string>;

  constructor(private model: string, apiKey?: string) {
    // Dynamic require to avoid compile-time dependency on the openai SDK.
    let OpenAI: any;
    try {
      // eslint-disable-next-line global-require
      OpenAI = require('openai').default;
    } catch {
      throw new Error('OpenAI SDK not installed. To use OpenAI, run: npm install openai');
    }
    this.client = new OpenAI({ apiKey: apiKey || process.env.OPENAI_API_KEY });

    const completion: CompletionFn = async ({ prompt, maxTokens }) => {
      const response = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      });
      return response.choices[0]?.message?.content ?? '';
    };
    this.completionBreaker = new CircuitBreaker(completion, BREAKER_OPTIONS);
    attachBreakerEvents(this.completionBreaker, { label: PROVIDER });
  }

  private async safeCompletion(prompt: string, maxTokens: number): Promise<string | null> {
    try { return await this.completionBreaker.fire({ prompt, maxTokens }); }
    catch { return null; }
  }

  async getAgentDecision(prompt: string): Promise<AgentDecision> {
    const text = await this.safeCompletion(prompt, 300);
    if (text === null) {
      metrics.llmCallErrors.inc({ kind: 'decision', provider: PROVIDER });
      return SAFE_DEFAULT_DECISION;
    }
    return parseDecision(text, PROVIDER);
  }

  async getConversationResponse(prompt: string): Promise<ConversationTurnResponse> {
    const text = await this.safeCompletion(prompt, 250);
    if (text === null) {
      metrics.llmCallErrors.inc({ kind: 'conversation', provider: PROVIDER });
      return SAFE_DEFAULT_CONVERSATION_TURN;
    }
    return parseConversationTurn(text, PROVIDER);
  }

  async getTradeResponse(prompt: string): Promise<TradeResponse> {
    const text = await this.safeCompletion(prompt, 250);
    if (text === null) {
      metrics.llmCallErrors.inc({ kind: 'trade', provider: PROVIDER });
      return SAFE_DEFAULT_TRADE_RESPONSE;
    }
    return parseTradeResponse(text, PROVIDER);
  }

  /**
   * Raw completion intentionally does NOT use the breaker — its caller
   * (MemoryDecay.consolidateBatch) already has retry + deterministic
   * fallback. Double-counting failures would trip the breaker prematurely.
   */
  async getRawCompletion(prompt: string, maxTokens = 100): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return response.choices[0]?.message?.content ?? '';
  }
}
