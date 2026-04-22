"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorldEngine = void 0;
const db_js_1 = require("../db.js");
class WorldEngine {
    worldId;
    constructor(worldId) {
        this.worldId = worldId;
    }
    async advanceTick() {
        const result = await (0, db_js_1.queryOne)(`UPDATE worlds.worlds SET current_tick = current_tick + 1, updated_at = NOW()
       WHERE world_id = $1 RETURNING current_tick`, [this.worldId]);
        return result?.current_tick ?? 0;
    }
    async getCurrentTick() {
        const row = await (0, db_js_1.queryOne)('SELECT current_tick FROM worlds.worlds WHERE world_id = $1', [this.worldId]);
        return row?.current_tick ?? 0;
    }
    async regenerateResources() {
        // Regen resources each tick
        await (0, db_js_1.execute)(`UPDATE worlds.resource_nodes
       SET current_amount = LEAST(max_capacity, current_amount + regen_rate),
           is_depleted = (current_amount + regen_rate < 5)
       WHERE world_id = $1 AND regen_rate > 0`, [this.worldId]);
    }
    async getResourceNodesNear(x, y, radius) {
        return (0, db_js_1.query)(`SELECT * FROM worlds.resource_nodes
       WHERE world_id = $1
         AND ABS(x - $2) <= $3 AND ABS(y - $3) <= $3
         AND NOT is_depleted
       ORDER BY ABS(x - $2) + ABS(y - $4) ASC
       LIMIT 20`, [this.worldId, x, radius, y]);
    }
    async extractResource(nodeId, amount) {
        const node = await (0, db_js_1.queryOne)('SELECT * FROM worlds.resource_nodes WHERE node_id = $1', [nodeId]);
        if (!node || node.is_depleted)
            return 0;
        const extracted = Math.min(amount, node.current_amount);
        const newAmount = node.current_amount - extracted;
        await (0, db_js_1.execute)(`UPDATE worlds.resource_nodes
       SET current_amount = $1, is_depleted = $2, last_extracted_tick = $3
       WHERE node_id = $4`, [newAmount, newAmount < 5, await this.getCurrentTick(), nodeId]);
        return extracted;
    }
    async logEvent(event) {
        const result = await (0, db_js_1.queryOne)(`INSERT INTO events.events
         (world_id, tick, day, event_type, significance, title, summary,
          participant_agent_ids, location_x, location_y, consequences)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING event_id`, [
            event.world_id,
            event.tick,
            event.day,
            event.event_type,
            event.significance,
            event.title,
            event.summary ?? null,
            event.participant_agent_ids,
            event.location_x ?? null,
            event.location_y ?? null,
            JSON.stringify(event.consequences),
        ]);
        return result?.event_id ?? '';
    }
    async getActiveAgentIds() {
        const rows = await (0, db_js_1.query)(`SELECT agent_id FROM agents.agents WHERE world_id = $1 AND status = 'alive'`, [this.worldId]);
        return rows.map(r => r.agent_id);
    }
}
exports.WorldEngine = WorldEngine;
