/**
 * Safe-default LLM payloads, returned when parsing/validation fails so the
 * simulation can keep ticking instead of crashing.
 *
 * The `[parse failure fallback]` markers in `thought` / `reason` are a
 * deliberate signal: they make these defaults distinguishable from
 * legitimate agent output in logs and chronicles.
 */
import type { AgentDecision } from '../types.js';
import type { ConversationTurnResponse } from './types.js';
import type { TradeResponse } from '../social/TradeEngine.js';

export const SAFE_DEFAULT_DECISION: AgentDecision = {
  thought: '[parse failure fallback]',
  action:  'do_nothing',
};

export const SAFE_DEFAULT_CONVERSATION_TURN: ConversationTurnResponse = {
  thought:   '[parse failure fallback]',
  speech:    '...',
  is_ending: true,
};

export const SAFE_DEFAULT_TRADE_RESPONSE: TradeResponse = {
  decision: 'reject',
  thought:  '[parse failure fallback]',
  reason:   'Unparseable counterparty response',
};
