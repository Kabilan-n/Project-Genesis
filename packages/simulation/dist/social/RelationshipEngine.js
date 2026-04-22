"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RelationshipEngine = void 0;
const db_js_1 = require("../db.js");
/**
 * Manages relationship score evolution and type upgrades.
 * Called after conversations and trades to apply deltas.
 */
class RelationshipEngine {
    /** Apply relationship changes from a completed conversation to both sides. */
    async applyConversationChanges(conv) {
        const { initiator_agent_id, target_agent_id, relationship_changes } = conv;
        for (const [agentId, delta] of Object.entries(relationship_changes)) {
            const otherId = agentId === initiator_agent_id ? target_agent_id : initiator_agent_id;
            await this.upsertRelationship(agentId, otherId, delta, conv.outcome);
        }
        // Also update belonging needs for both agents if positive outcome
        if (conv.outcome === 'bonding' || conv.outcome === 'friendly') {
            const belongingGain = conv.outcome === 'bonding' ? 5 : 2;
            await (0, db_js_1.execute)(`UPDATE agents.agent_state
         SET need_belonging = LEAST(100, need_belonging + $1)
         WHERE agent_id = ANY($2)`, [belongingGain, [initiator_agent_id, target_agent_id]]);
        }
        else if (conv.outcome === 'hostile' || conv.outcome === 'conflict') {
            // Negative interaction hurts belonging
            await (0, db_js_1.execute)(`UPDATE agents.agent_state
         SET need_belonging = GREATEST(0, need_belonging - 3)
         WHERE agent_id = ANY($1)`, [[initiator_agent_id, target_agent_id]]);
        }
    }
    /** Apply relationship changes from a completed trade. */
    async applyTradeChanges(trade) {
        const { offerer_agent_id, receiver_agent_id, status } = trade;
        const deltas = {
            accepted: { trust: 8, respect: 5, affection: 3, fear: -1 },
            rejected: { trust: -3, respect: -1, affection: 0, fear: 0 },
            countered: { trust: 2, respect: 3, affection: 1, fear: 0 },
            pending: { trust: 0, respect: 0, affection: 0, fear: 0 },
            expired: { trust: -1, respect: 0, affection: 0, fear: 0 },
        };
        const delta = deltas[status];
        const outcome = status === 'accepted' ? 'friendly' : status === 'rejected' ? 'neutral' : 'neutral';
        await this.upsertRelationship(offerer_agent_id, receiver_agent_id, delta, outcome);
        await this.upsertRelationship(receiver_agent_id, offerer_agent_id, delta, outcome);
        // Trade acceptance boosts esteem slightly for both parties
        if (status === 'accepted') {
            await (0, db_js_1.execute)(`UPDATE agents.agent_state
         SET need_esteem = LEAST(100, need_esteem + 3)
         WHERE agent_id = ANY($1)`, [[offerer_agent_id, receiver_agent_id]]);
        }
    }
    async upsertRelationship(agentId, otherId, delta, outcome) {
        const isPositive = outcome === 'bonding' || outcome === 'friendly' || outcome === 'reconciliation';
        const isNegative = outcome === 'hostile' || outcome === 'conflict';
        await (0, db_js_1.execute)(`INSERT INTO social.relationships
         (agent_id, other_agent_id, trust_score, affection_score, respect_score, fear_score,
          relationship_type, interaction_count, positive_interaction_count, negative_interaction_count,
          last_interaction_tick)
       SELECT $1, $2,
         LEAST(100, GREATEST(0, COALESCE((SELECT trust_score    FROM social.relationships WHERE agent_id=$1 AND other_agent_id=$2), 10) + $3)),
         LEAST(100, GREATEST(0, COALESCE((SELECT affection_score FROM social.relationships WHERE agent_id=$1 AND other_agent_id=$2), 10) + $4)),
         LEAST(100, GREATEST(0, COALESCE((SELECT respect_score  FROM social.relationships WHERE agent_id=$1 AND other_agent_id=$2), 10) + $5)),
         LEAST(100, GREATEST(0, COALESCE((SELECT fear_score     FROM social.relationships WHERE agent_id=$1 AND other_agent_id=$2), 0) + $6)),
         'stranger',
         COALESCE((SELECT interaction_count          FROM social.relationships WHERE agent_id=$1 AND other_agent_id=$2), 0) + 1,
         COALESCE((SELECT positive_interaction_count FROM social.relationships WHERE agent_id=$1 AND other_agent_id=$2), 0) + $7,
         COALESCE((SELECT negative_interaction_count FROM social.relationships WHERE agent_id=$1 AND other_agent_id=$2), 0) + $8,
         0
       ON CONFLICT (agent_id, other_agent_id) DO UPDATE SET
         trust_score    = LEAST(100, GREATEST(0, social.relationships.trust_score    + $3)),
         affection_score= LEAST(100, GREATEST(0, social.relationships.affection_score+ $4)),
         respect_score  = LEAST(100, GREATEST(0, social.relationships.respect_score  + $5)),
         fear_score     = LEAST(100, GREATEST(0, social.relationships.fear_score     + $6)),
         interaction_count           = social.relationships.interaction_count + 1,
         positive_interaction_count  = social.relationships.positive_interaction_count + $7,
         negative_interaction_count  = social.relationships.negative_interaction_count + $8,
         last_interaction_tick       = EXCLUDED.last_interaction_tick`, [
            agentId, otherId,
            delta.trust ?? 0,
            delta.affection ?? 0,
            delta.respect ?? 0,
            delta.fear ?? 0,
            isPositive ? 1 : 0,
            isNegative ? 1 : 0,
        ]);
        // Now upgrade relationship type based on new scores
        await this.upgradeRelationshipType(agentId, otherId);
    }
    async upgradeRelationshipType(agentId, otherId) {
        const rel = await (0, db_js_1.queryOne)(`SELECT trust_score, affection_score, respect_score, fear_score,
              interaction_count, positive_interaction_count, negative_interaction_count,
              relationship_type
       FROM social.relationships
       WHERE agent_id = $1 AND other_agent_id = $2`, [agentId, otherId]);
        if (!rel)
            return;
        const newType = this.determineType(rel);
        if (newType !== rel.relationship_type) {
            await (0, db_js_1.execute)(`UPDATE social.relationships SET relationship_type = $1
         WHERE agent_id = $2 AND other_agent_id = $3`, [newType, agentId, otherId]);
        }
    }
    determineType(rel) {
        const { trust_score, affection_score, respect_score, fear_score, interaction_count } = rel;
        // Enemy: very low trust and high fear or hostility
        if (trust_score < 15 && (fear_score > 50 || affection_score < 5))
            return 'enemy';
        // Rival: low trust but high respect (competing)
        if (trust_score < 30 && respect_score > 50)
            return 'rival';
        // Close friend: high trust + high affection + many positive interactions
        if (trust_score >= 80 && affection_score >= 70 && interaction_count >= 6)
            return 'close_friend';
        // Romantic partner: very high affection + trust
        if (trust_score >= 85 && affection_score >= 90)
            return 'romantic_partner';
        // Friend: good trust + decent affection
        if (trust_score >= 60 && affection_score >= 50 && interaction_count >= 3)
            return 'friend';
        // Acquaintance: any meaningful interaction
        if (interaction_count >= 2 && trust_score >= 25)
            return 'acquaintance';
        return 'stranger';
    }
}
exports.RelationshipEngine = RelationshipEngine;
