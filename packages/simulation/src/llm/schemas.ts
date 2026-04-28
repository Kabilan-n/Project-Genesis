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
});

export const DecisionSchema = z.object({
  thought:        z.string().max(500),
  action:         z.string().min(1).max(150),
  speech:         z.string().max(500).optional(),
  target:         z.string().max(150).optional(),
  trade_offer:    TradeOfferSchema.optional(),
  // Phase 3
  gossip_subject: z.string().max(150).optional(),
  gossip_claim:   z.string().max(300).optional(),
  group_name:     z.string().max(80).optional(),
  group_purpose:  z.string().max(200).optional(),
  // Phase 5
  war_target_group:    z.string().max(150).optional(),
  treaty_type:         z.enum(['non_aggression', 'resource_sharing', 'alliance', 'vassalage']).optional(),
  treaty_target_group: z.string().max(150).optional(),
  exile_target:        z.string().max(150).optional(),
  // Phase 6
  belief_name:     z.string().max(80).optional(),
  belief_tenet:    z.string().max(300).optional(),
  myth_title:      z.string().max(120).optional(),
  myth_narrative:  z.string().max(800).optional(),
  preach_target:   z.string().max(150).optional(),
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
  reason:   z.string().max(500).optional(),
  counter_offer: TradeOfferSchema.optional(),
}).refine(
  (data) => data.decision !== 'counter' || data.counter_offer !== undefined,
  { message: 'counter decision requires counter_offer' },
);

export type DecisionInput = z.infer<typeof DecisionSchema>;
export type ConversationTurnInput = z.infer<typeof ConversationTurnSchema>;
export type TradeResponseInput = z.infer<typeof TradeResponseSchema>;
