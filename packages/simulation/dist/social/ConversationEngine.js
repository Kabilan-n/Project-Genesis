"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationEngine = void 0;
const db_js_1 = require("../db.js");
const LLMFactory_js_1 = require("../llm/LLMFactory.js");
const PromptBuilder_js_1 = require("../llm/PromptBuilder.js");
const KnowledgeEngine_js_1 = require("../cultural/KnowledgeEngine.js");
const MAX_TURNS = 4; // 2 exchanges (A→B→A→B)
class ConversationEngine {
    llm;
    promptBuilder;
    knowledgeEngine;
    constructor() {
        this.llm = LLMFactory_js_1.LLMFactory.fromEnv();
        this.promptBuilder = new PromptBuilder_js_1.PromptBuilder();
        this.knowledgeEngine = new KnowledgeEngine_js_1.KnowledgeEngine();
    }
    /**
     * Run a full multi-turn conversation between two agents.
     * Returns the completed Conversation record.
     */
    async runConversation(initiator, target, openingMessage, tick, day) {
        const turns = [];
        // Turn 1: initiator's opening (already decided by AgentEngine)
        turns.push({
            turn_number: 1,
            speaker_id: initiator.agent_id,
            speaker_name: initiator.name,
            message: openingMessage,
            thought: 'Starting the conversation',
            is_ending: false,
        });
        let lastSpeaker = initiator;
        let lastListener = target;
        let lastMessage = openingMessage;
        let conversationEnded = false;
        // Run up to MAX_TURNS total (turn 1 is already done)
        for (let t = 2; t <= MAX_TURNS && !conversationEnded; t++) {
            // Swap speakers
            [lastSpeaker, lastListener] = [lastListener, lastSpeaker];
            const listenerRel = await this.getRelationshipBetween(lastSpeaker.agent_id, lastListener.agent_id);
            const recentMemories = await this.getRecentMemories(lastSpeaker.agent_id);
            const prompt = this.promptBuilder.buildConversationTurnPrompt(lastSpeaker, lastListener, turns, lastMessage, listenerRel, recentMemories, tick, day, t === MAX_TURNS // force_end on last turn
            );
            const response = await this.llm.getConversationResponse(prompt);
            turns.push({
                turn_number: t,
                speaker_id: lastSpeaker.agent_id,
                speaker_name: lastSpeaker.name,
                message: response.speech ?? '...',
                thought: response.thought,
                is_ending: response.is_ending ?? (t === MAX_TURNS),
            });
            lastMessage = response.speech ?? '';
            conversationEnded = response.is_ending ?? false;
        }
        // Compute outcome and relationship deltas
        const outcome = this.computeOutcome(turns);
        const relationshipChanges = this.computeRelationshipChanges(initiator, target, turns, outcome);
        const conversation = {
            world_id: initiator.world_id,
            tick,
            day,
            initiator_agent_id: initiator.agent_id,
            target_agent_id: target.agent_id,
            location_x: initiator.state.position_x,
            location_y: initiator.state.position_y,
            topic: this.extractTopic(turns),
            turns,
            outcome,
            relationship_changes: relationshipChanges,
        };
        const persisted = await this.persist(conversation);
        // Phase 3: propagate knowledge and attempt skill teaching on positive outcomes
        if (persisted.outcome === 'bonding' || persisted.outcome === 'friendly') {
            await Promise.all([
                this.knowledgeEngine.propagateKnowledge(initiator, target, persisted),
                this.knowledgeEngine.attemptSkillTeaching(initiator, target, persisted),
            ]);
        }
        return persisted;
    }
    computeOutcome(turns) {
        const transcript = turns.map(t => t.message + ' ' + t.thought).join(' ').toLowerCase();
        const positiveScore = ((transcript.match(/\b(friend|trust|help|thank|care|love|together|glad|happy|share|gift)\b/g) ?? []).length);
        const negativeScore = ((transcript.match(/\b(enemy|hate|fear|angry|attack|leave|alone|danger|threat|warn)\b/g) ?? []).length);
        if (positiveScore >= 3 && negativeScore === 0)
            return 'bonding';
        if (positiveScore >= 2)
            return 'friendly';
        if (negativeScore >= 3)
            return 'hostile';
        if (negativeScore >= 2)
            return 'conflict';
        return 'neutral';
    }
    computeRelationshipChanges(initiator, target, turns, outcome) {
        const baseDeltas = {
            bonding: { trust: 10, affection: 12, respect: 5, fear: -3 },
            friendly: { trust: 5, affection: 6, respect: 3, fear: -1 },
            neutral: { trust: 1, affection: 1, respect: 1, fear: 0 },
            reconciliation: { trust: 8, affection: 4, respect: 4, fear: -5 },
            conflict: { trust: -5, affection: -4, respect: -2, fear: 3 },
            hostile: { trust: -8, affection: -6, respect: -3, fear: 6 },
        };
        const delta = baseDeltas[outcome];
        // Personality modifiers: empathetic initiators give/receive more affection
        const empathyMod = (initiator.traits.empathy - 50) / 50; // -1 to +1
        const adjustedAffection = Math.round((delta.affection ?? 0) * (1 + empathyMod * 0.3));
        const initiatorDelta = { ...delta, affection: adjustedAffection };
        const targetDelta = { ...delta, affection: adjustedAffection };
        return {
            [initiator.agent_id]: initiatorDelta,
            [target.agent_id]: targetDelta,
        };
    }
    extractTopic(turns) {
        if (turns.length === 0)
            return 'general';
        const firstMessage = turns[0].message.slice(0, 50);
        return firstMessage;
    }
    async getRelationshipBetween(agentId, otherId) {
        return (0, db_js_1.queryOne)(`SELECT r.*, a.name as other_agent_name
       FROM social.relationships r
       JOIN agents.agents a ON a.agent_id = r.other_agent_id
       WHERE r.agent_id = $1 AND r.other_agent_id = $2`, [agentId, otherId]);
    }
    async getRecentMemories(agentId) {
        const rows = await (0, db_js_1.query)(`SELECT summary FROM memory.episodic_memories
       WHERE agent_id = $1
       ORDER BY importance DESC, tick DESC
       LIMIT 3`, [agentId]);
        return rows.map(r => r.summary);
    }
    async persist(conv) {
        const row = await (0, db_js_1.queryOne)(`INSERT INTO social.conversations
         (world_id, tick, day, initiator_agent_id, target_agent_id,
          location_x, location_y, topic, turns, outcome, relationship_changes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb)
       RETURNING conversation_id`, [
            conv.world_id, conv.tick, conv.day,
            conv.initiator_agent_id, conv.target_agent_id,
            conv.location_x, conv.location_y,
            conv.topic,
            JSON.stringify(conv.turns),
            conv.outcome,
            JSON.stringify(conv.relationship_changes),
        ]);
        return { ...conv, conversation_id: row.conversation_id };
    }
}
exports.ConversationEngine = ConversationEngine;
