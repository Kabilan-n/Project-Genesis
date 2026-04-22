"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.worldRoutes = worldRoutes;
const db_js_1 = require("../db.js");
async function worldRoutes(app) {
    // List worlds
    app.get('/worlds', async () => {
        return (0, db_js_1.query)(`SELECT world_id, name, status, config, current_tick, current_day, created_at
       FROM worlds.worlds WHERE status != 'archived' ORDER BY created_at DESC`);
    });
    // Get world details + stats
    app.get('/worlds/:id', async (req, reply) => {
        const { id } = req.params;
        const world = await (0, db_js_1.queryOne)(`SELECT world_id, name, status, config, current_tick, current_day, created_at
       FROM worlds.worlds WHERE world_id = $1`, [id]);
        if (!world)
            return reply.code(404).send({ error: 'World not found' });
        const stats = await (0, db_js_1.queryOne)(`SELECT
         COUNT(*) FILTER (WHERE a.status = 'alive') as alive,
         COUNT(*) FILTER (WHERE a.status = 'dead') as dead,
         AVG(s.hp) FILTER (WHERE a.status = 'alive') as avg_hp,
         AVG(s.need_food) FILTER (WHERE a.status = 'alive') as avg_food,
         AVG(s.need_water) FILTER (WHERE a.status = 'alive') as avg_water
       FROM agents.agents a
       LEFT JOIN agents.agent_state s ON a.agent_id = s.agent_id
       WHERE a.world_id = $1`, [id]);
        return {
            ...world,
            statistics: {
                alive_agents: parseInt(stats?.alive ?? '0'),
                dead_agents: parseInt(stats?.dead ?? '0'),
                avg_hp: Math.round(parseFloat(stats?.avg_hp ?? '0')),
                avg_food: Math.round(parseFloat(stats?.avg_food ?? '0')),
                avg_water: Math.round(parseFloat(stats?.avg_water ?? '0')),
            },
        };
    });
    // Get map tiles (returns all tiles for rendering)
    app.get('/worlds/:id/map', async (req, reply) => {
        const { id } = req.params;
        const world = await (0, db_js_1.queryOne)('SELECT config FROM worlds.worlds WHERE world_id = $1', [id]);
        if (!world)
            return reply.code(404).send({ error: 'World not found' });
        const tiles = await (0, db_js_1.query)(`SELECT x, y, terrain, is_passable FROM worlds.map_tiles WHERE world_id = $1 ORDER BY y, x`, [id]);
        const resources = await (0, db_js_1.query)(`SELECT x, y, resource_type, current_amount, is_depleted
       FROM worlds.resource_nodes WHERE world_id = $1`, [id]);
        return {
            size: world.config?.map_size ?? 50,
            tiles,
            resource_nodes: resources,
        };
    });
    // Get world events (paginated)
    app.get('/worlds/:id/events', async (req) => {
        const { id } = req.params;
        const { limit = '50', offset = '0', significance } = req.query;
        const params = [id, parseInt(limit), parseInt(offset)];
        let sigFilter = '';
        if (significance) {
            sigFilter = ' AND significance = $4';
            params.push(significance);
        }
        return (0, db_js_1.query)(`SELECT event_id, tick, day, event_type, significance, title, summary,
              participant_agent_ids, location_x, location_y, created_at
       FROM events.events
       WHERE world_id = $1 ${sigFilter}
       ORDER BY tick DESC
       LIMIT $2 OFFSET $3`, params);
    });
    // Get live agents for a world
    app.get('/worlds/:id/agents', async (req, reply) => {
        const { id } = req.params;
        return (0, db_js_1.query)(`SELECT a.agent_id, a.name, a.archetype, a.generation,
              s.hp, s.position_x, s.position_y, s.mental_state, s.current_activity,
              s.need_food, s.need_water, s.need_rest
       FROM agents.agents a
       JOIN agents.agent_state s ON a.agent_id = s.agent_id
       WHERE a.world_id = $1 AND a.status = 'alive'`, [id]);
    });
}
