"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TradeEngine = void 0;
const db_js_1 = require("../db.js");
const LLMFactory_js_1 = require("../llm/LLMFactory.js");
const PromptBuilder_js_1 = require("../llm/PromptBuilder.js");
const RelationshipEngine_js_1 = require("./RelationshipEngine.js");
class TradeEngine {
    llm;
    promptBuilder;
    relEngine;
    constructor() {
        this.llm = LLMFactory_js_1.LLMFactory.fromEnv();
        this.promptBuilder = new PromptBuilder_js_1.PromptBuilder();
        this.relEngine = new RelationshipEngine_js_1.RelationshipEngine();
    }
    /**
     * Execute a trade offer from offerer to receiver.
     * Receiver decides via Claude whether to accept/reject/counter.
     * Returns the completed TradeRecord.
     */
    async executeTrade(offerer, receiver, offer, tick, day) {
        // Check offerer actually has what they're offering
        const validatedOffer = await this.validateInventory(offerer.agent_id, offer.offered_items);
        if (!validatedOffer) {
            return this.createRecord(offerer, receiver, offer, tick, day, 'rejected', 'Offerer lacks items');
        }
        // Get receiver's inventory for context
        const receiverInventory = await this.getInventory(receiver.agent_id);
        const receiverRel = await this.getRelationship(receiver.agent_id, offerer.agent_id);
        // Build trade decision prompt for receiver
        const prompt = this.promptBuilder.buildTradeDecisionPrompt(receiver, offerer, offer, receiverInventory, receiverRel, tick, day);
        const response = await this.llm.getTradeResponse(prompt);
        let trade = {
            world_id: offerer.world_id,
            tick,
            day,
            offerer_agent_id: offerer.agent_id,
            receiver_agent_id: receiver.agent_id,
            offered_items: offer.offered_items,
            requested_items: offer.requested_items,
            status: 'pending',
        };
        if (response.decision === 'accept') {
            // Check receiver has what was requested
            const receiverHasItems = await this.validateInventory(receiver.agent_id, offer.requested_items);
            if (!receiverHasItems) {
                trade.status = 'rejected';
                trade.outcome_reason = 'Receiver lacks requested items';
            }
            else {
                await this.transferItems(offerer.agent_id, receiver.agent_id, offer.offered_items);
                await this.transferItems(receiver.agent_id, offerer.agent_id, offer.requested_items);
                trade.status = 'accepted';
                trade.outcome_reason = response.reason;
            }
        }
        else if (response.decision === 'counter' && response.counter_offer) {
            trade.status = 'countered';
            trade.counter_offer = response.counter_offer.offered_items;
            trade.outcome_reason = response.reason;
            // Simple: accept counter if offerer has the counter items
            const counterValid = await this.validateInventory(offerer.agent_id, response.counter_offer.offered_items);
            if (counterValid) {
                const offererHasRequested = await this.validateInventory(receiver.agent_id, response.counter_offer.requested_items);
                if (offererHasRequested) {
                    await this.transferItems(receiver.agent_id, offerer.agent_id, response.counter_offer.offered_items);
                    await this.transferItems(offerer.agent_id, receiver.agent_id, response.counter_offer.requested_items);
                    trade.status = 'accepted';
                    trade.outcome_reason = `Counter accepted: ${response.reason}`;
                }
            }
        }
        else {
            trade.status = 'rejected';
            trade.outcome_reason = response.reason;
        }
        const persisted = await this.persist(trade);
        await this.relEngine.applyTradeChanges(persisted);
        return persisted;
    }
    async validateInventory(agentId, items) {
        for (const [resourceType, amount] of Object.entries(items)) {
            if (amount <= 0)
                continue;
            const inv = await (0, db_js_1.queryOne)(`SELECT amount FROM economy.inventory
         WHERE agent_id = $1 AND resource_type = $2`, [agentId, resourceType]);
            if (!inv || inv.amount < amount)
                return false;
        }
        return true;
    }
    async transferItems(fromAgentId, toAgentId, items) {
        for (const [resourceType, amount] of Object.entries(items)) {
            if (amount <= 0)
                continue;
            // Deduct from sender
            await (0, db_js_1.execute)(`UPDATE economy.inventory
         SET amount = amount - $1
         WHERE agent_id = $2 AND resource_type = $3`, [amount, fromAgentId, resourceType]);
            // Add to receiver
            await (0, db_js_1.execute)(`INSERT INTO economy.inventory (agent_id, resource_type, amount, acquired_method)
         VALUES ($1, $2, $3, 'traded')
         ON CONFLICT (agent_id, resource_type)
         DO UPDATE SET amount = economy.inventory.amount + $3`, [toAgentId, resourceType, amount]);
        }
    }
    async getInventory(agentId) {
        return (0, db_js_1.query)(`SELECT resource_type, amount FROM economy.inventory
       WHERE agent_id = $1 AND amount > 0`, [agentId]);
    }
    async getRelationship(agentId, otherId) {
        return (0, db_js_1.queryOne)(`SELECT trust_score, relationship_type FROM social.relationships
       WHERE agent_id = $1 AND other_agent_id = $2`, [agentId, otherId]);
    }
    createRecord(offerer, receiver, offer, tick, day, status, reason) {
        return {
            world_id: offerer.world_id,
            tick,
            day,
            offerer_agent_id: offerer.agent_id,
            receiver_agent_id: receiver.agent_id,
            offered_items: offer.offered_items,
            requested_items: offer.requested_items,
            status,
            outcome_reason: reason,
        };
    }
    async persist(trade) {
        const row = await (0, db_js_1.queryOne)(`INSERT INTO economy.trades
         (world_id, tick, day, offerer_agent_id, receiver_agent_id,
          offered_items, requested_items, counter_offer, status, outcome_reason)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10)
       RETURNING trade_id`, [
            trade.world_id, trade.tick, trade.day,
            trade.offerer_agent_id, trade.receiver_agent_id,
            JSON.stringify(trade.offered_items),
            JSON.stringify(trade.requested_items),
            trade.counter_offer ? JSON.stringify(trade.counter_offer) : null,
            trade.status,
            trade.outcome_reason ?? null,
        ]);
        return { ...trade, trade_id: row.trade_id };
    }
}
exports.TradeEngine = TradeEngine;
