/**
 * Zod schemas for LLM-produced JSON.
 *
 * The simulation forwards every parsed LLM payload through these schemas so
 * that malformed output is detected explicitly (and surfaced as a metrics
 * counter) instead of being silently coerced into a "safe default".
 *
 * `action` is intentionally a string, not an enum: the codebase uses
 * verb-arg strings like "move north", "talk Bob hello", "offer_trade Bob".
 * AgentEngine.executeAction's switch already handles unknown verbs by
 * falling through to `idle`, so we validate shape, not vocabulary.
 */
import { z } from 'zod';

const ItemQuantitySchema = z.object({
  // Open record so we don't have to mirror every economic resource here.
}).catchall(z.number().nonnegative());

const TradeOfferSchema = z.object({
  offered_items:   ItemQuantitySchema,
  requested_items: ItemQuantitySchema,
}).nullish();

/**
 * Optional string field as the LLM produces it: it may be omitted entirely,
 * be `null`, or be an empty string. All three are equivalent to "unset"
 * downstream. `z.string().optional()` alone accepts `undefined` but NOT
 * `null`, and Claude/OpenAI routinely emit explicit nulls for fields they
 * chose not to fill — so without this, every decision with a `null` field
 * gets rejected as a parse failure.
 *
 *   z.string().max(N).nullish() → string | null | undefined
 */
const optStr = (max: number) => z.string().max(max).nullish();

export const DecisionSchema = z.object({
  thought:        z.string().max(500),
  action:         z.string().min(1).max(150),
  speech:         optStr(500),
  target:         optStr(150),
  trade_offer:    TradeOfferSchema,
  // Phase 3
  gossip_subject: optStr(150),
  gossip_claim:   optStr(300),
  group_name:     optStr(80),
  group_purpose:  optStr(200),
  // Phase 5
  war_target_group:    optStr(150),
  treaty_type:         z.enum(['non_aggression', 'resource_sharing', 'alliance', 'vassalage']).nullish(),
  treaty_target_group: optStr(150),
  exile_target:        optStr(150),
  // Phase 6
  belief_name:     optStr(80),
  belief_tenet:    optStr(300),
  myth_title:      optStr(120),
  myth_narrative:  optStr(800),
  preach_target:   optStr(150),
});
// Default Zod object behavior strips unknown keys, which is what we want:
// new fields land safely; the schema is the contract.

export const ConversationTurnSchema = z.object({
  thought:   z.string().max(500),
  speech:    z.string().max(500),
  is_ending: z.boolean(),
});

export const TradeResponseSchema = z.object({
  decision: z.enum(['accept', 'reject', 'counter']),
  thought:  z.string().max(500),
  reason:   optStr(500),
  counter_offer: TradeOfferSchema,
}).refine(
  (data) => data.decision !== 'counter' || (data.counter_offer != null),
  { message: 'counter decision requires counter_offer' },
);

export type DecisionInput = z.infer<typeof DecisionSchema>;
export type ConversationTurnInput = z.infer<typeof ConversationTurnSchema>;
export type TradeResponseInput = z.infer<typeof TradeResponseSchema>;
