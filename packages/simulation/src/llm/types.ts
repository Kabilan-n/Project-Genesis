import type { AgentDecision } from '../types.js';
import type { TradeResponse } from '../social/TradeEngine.js';

export interface ConversationTurnResponse {
  thought: string;
  speech: string;
  is_ending: boolean;
}

/**
 * Common interface for all LLM providers.
 * All implementations must support these methods.
 */
export interface LLMClient {
  getAgentDecision(prompt: string): Promise<AgentDecision>;
  getConversationResponse(prompt: string): Promise<ConversationTurnResponse>;
  getTradeResponse(prompt: string): Promise<TradeResponse>;
  getRawCompletion(prompt: string, maxTokens?: number): Promise<string>;
}
