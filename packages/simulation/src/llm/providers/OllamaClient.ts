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
import { BREAKER_OPTIONS, attachBreakerEvents } from '../breaker.js';

const PROVIDER = 'ollama';

type CompletionFn = (args: { prompt: string; maxTokens: number }) => Promise<string>;

export class OllamaClient implements LLMClient {
  private completionBreaker: CircuitBreaker<Parameters<CompletionFn>, string>;

  constructor(private model: string, private baseUrl: string) {
    const completion: CompletionFn = ({ prompt, maxTokens }) => this.call(prompt, maxTokens);
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

  async getRawCompletion(prompt: string, maxTokens = 100): Promise<string> {
    return this.call(prompt, maxTokens);
  }

  private async call(prompt: string, maxTokens: number): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        options: { num_predict: maxTokens },
      }),
    });
    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json() as { response: string };
    return data.response;
  }
}
