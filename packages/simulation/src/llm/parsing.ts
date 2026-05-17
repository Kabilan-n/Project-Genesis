/**
 * Shared parsing helpers for every LLM provider.
 *
 * Every typed LLM response (decision / conversation turn / trade) goes
 * through the same flow:
 *
 *   1. Strip code fences if any (`json` blocks are common in LLM output).
 *   2. JSON.parse the cleaned string.
 *   3. Validate with the Zod schema.
 *   4. On any failure: increment a metrics counter, log a warning with
 *      the failing parser name + a text preview, return the typed
 *      SAFE_DEFAULT_* sentinel whose `[parse failure fallback]` marker
 *      makes it identifiable in logs and chronicles.
 *
 * No regex extract-from-prose fallback — that was hiding bugs in
 * stabilization 1.4 and intentionally removed. If JSON.parse or schema
 * validation fails, the prompt or the LLM is wrong; surface the signal.
 */
import type { AgentDecision } from '../types.js';
import type { TradeResponse } from '../social/TradeEngine.js';
import type { ConversationTurnResponse } from './types.js';
import {
  DecisionSchema, ConversationTurnSchema, TradeResponseSchema,
} from './schemas.js';
import {
  SAFE_DEFAULT_DECISION, SAFE_DEFAULT_CONVERSATION_TURN, SAFE_DEFAULT_TRADE_RESPONSE,
} from './defaults.js';
import { metrics } from '../observability/metrics.js';
import { engineLogger } from '../observability/logger.js';

const log = engineLogger('llm-parsing');

export function stripCodeFences(text: string): string {
  return text.replace(/```(?:json)?\n?|\n?```/g, '').trim();
}

function logParseFailure(
  parser: 'parseDecision' | 'parseConversationTurn' | 'parseTradeResponse',
  type: 'decision' | 'conversation' | 'trade',
  provider: string,
  err: unknown,
  text: string,
): void {
  metrics.llmParseFailures.inc({ type, provider });
  log.warn(
    {
      err: err instanceof Error ? err.message : String(err),
      textPreview: text.slice(0, 500),
      parser,
      provider,
    },
    'llm_parse_failure',
  );
}

export function parseDecision(text: string, provider: string): AgentDecision {
  try {
    return DecisionSchema.parse(JSON.parse(stripCodeFences(text))) as AgentDecision;
  } catch (err) {
    logParseFailure('parseDecision', 'decision', provider, err, text);
    return SAFE_DEFAULT_DECISION;
  }
}

export function parseConversationTurn(text: string, provider: string): ConversationTurnResponse {
  try {
    return ConversationTurnSchema.parse(JSON.parse(stripCodeFences(text)));
  } catch (err) {
    logParseFailure('parseConversationTurn', 'conversation', provider, err, text);
    return SAFE_DEFAULT_CONVERSATION_TURN;
  }
}

export function parseTradeResponse(text: string, provider: string): TradeResponse {
  try {
    return TradeResponseSchema.parse(JSON.parse(stripCodeFences(text))) as TradeResponse;
  } catch (err) {
    logParseFailure('parseTradeResponse', 'trade', provider, err, text);
    return SAFE_DEFAULT_TRADE_RESPONSE;
  }
}
