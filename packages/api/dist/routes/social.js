"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.socialRoutes = socialRoutes;
const db_js_1 = require("../db.js");
async function socialRoutes(app) {
    // ── Conversations ─────────────────────────────────────────
    // Full conversation transcript by ID
    app.get('/conversations/:id', async (req, reply) => {
        const { id } = req.params;
        const conv = await (0, db_js_1.queryOne)(`SELECT c.*,
              ia.name as initiator_name, ia.archetype as initiator_archetype,
              ta.name as target_name,    ta.archetype as target_archetype
       FROM social.conversations c
       JOIN agents.agents ia ON ia.agent_id = c.initiator_agent_id
       JOIN agents.agents ta ON ta.agent_id = c.target_agent_id
       WHERE c.conversation_id = $1`, [id]);
        if (!conv)
            return reply.code(404).send({ error: 'Conversation not found' });
        return conv;
    });
    // All conversations for a world (recent first)
    app.get('/worlds/:id/conversations', async (req) => {
        const { id } = req.params;
        const { limit = '20', offset = '0' } = req.query;
        return (0, db_js_1.query)(`SELECT c.conversation_id, c.tick, c.day, c.topic, c.outcome, c.created_at,
              c.initiator_agent_id, c.target_agent_id,
              ia.name as initiator_name, ta.name as target_name,
              jsonb_array_length(c.turns) as turn_count
       FROM social.conversations c
       JOIN agents.agents ia ON ia.agent_id = c.initiator_agent_id
       JOIN agents.agents ta ON ta.agent_id = c.target_agent_id
       WHERE c.world_id = $1
       ORDER BY c.tick DESC
       LIMIT $2 OFFSET $3`, [id, parseInt(limit), parseInt(offset)]);
    });
    // Conversations an agent was involved in
    app.get('/agents/:id/conversations', async (req) => {
        const { id } = req.params;
        const { limit = '10' } = req.query;
        return (0, db_js_1.query)(`SELECT c.conversation_id, c.tick, c.day, c.topic, c.outcome, c.created_at,
              c.initiator_agent_id, c.target_agent_id,
              ia.name as initiator_name, ta.name as target_name,
              jsonb_array_length(c.turns) as turn_count
       FROM social.conversations c
       JOIN agents.agents ia ON ia.agent_id = c.initiator_agent_id
       JOIN agents.agents ta ON ta.agent_id = c.target_agent_id
       WHERE c.initiator_agent_id = $1 OR c.target_agent_id = $1
       ORDER BY c.tick DESC
       LIMIT $2`, [id, parseInt(limit)]);
    });
    // ── Trades ────────────────────────────────────────────────
    // Full trade record by ID
    app.get('/trades/:id', async (req, reply) => {
        const { id } = req.params;
        const trade = await (0, db_js_1.queryOne)(`SELECT t.*,
              oa.name as offerer_name, ra.name as receiver_name
       FROM economy.trades t
       JOIN agents.agents oa ON oa.agent_id = t.offerer_agent_id
       JOIN agents.agents ra ON ra.agent_id = t.receiver_agent_id
       WHERE t.trade_id = $1`, [id]);
        if (!trade)
            return reply.code(404).send({ error: 'Trade not found' });
        return trade;
    });
    // All trades for a world
    app.get('/worlds/:id/trades', async (req) => {
        const { id } = req.params;
        const { limit = '20', offset = '0' } = req.query;
        return (0, db_js_1.query)(`SELECT t.trade_id, t.tick, t.day, t.status, t.outcome_reason, t.created_at,
              t.offered_items, t.requested_items,
              oa.name as offerer_name, ra.name as receiver_name
       FROM economy.trades t
       JOIN agents.agents oa ON oa.agent_id = t.offerer_agent_id
       JOIN agents.agents ra ON ra.agent_id = t.receiver_agent_id
       WHERE t.world_id = $1
       ORDER BY t.tick DESC
       LIMIT $2 OFFSET $3`, [id, parseInt(limit), parseInt(offset)]);
    });
    // Trades an agent was involved in
    app.get('/agents/:id/trades', async (req) => {
        const { id } = req.params;
        const { limit = '10' } = req.query;
        return (0, db_js_1.query)(`SELECT t.trade_id, t.tick, t.day, t.status, t.offered_items, t.requested_items,
              oa.name as offerer_name, ra.name as receiver_name
       FROM economy.trades t
       JOIN agents.agents oa ON oa.agent_id = t.offerer_agent_id
       JOIN agents.agents ra ON ra.agent_id = t.receiver_agent_id
       WHERE t.offerer_agent_id = $1 OR t.receiver_agent_id = $1
       ORDER BY t.tick DESC
       LIMIT $2`, [id, parseInt(limit)]);
    });
    // ── Phase 3: Groups ───────────────────────────────────────
    // All active groups in a world
    app.get('/worlds/:id/groups', async (req) => {
        const { id } = req.params;
        return (0, db_js_1.query)(`SELECT g.*,
              fa.name as founder_name,
              la.name as leader_name
       FROM social.groups g
       JOIN agents.agents fa ON fa.agent_id = g.founder_id
       LEFT JOIN agents.agents la ON la.agent_id = g.leader_id
       WHERE g.world_id = $1 AND g.status = 'active'
       ORDER BY g.member_count DESC`, [id]);
    });
    // Single group detail + members
    app.get('/groups/:id', async (req, reply) => {
        const { id } = req.params;
        const group = await (0, db_js_1.queryOne)(`SELECT g.*,
              fa.name as founder_name,
              la.name as leader_name
       FROM social.groups g
       JOIN agents.agents fa ON fa.agent_id = g.founder_id
       LEFT JOIN agents.agents la ON la.agent_id = g.leader_id
       WHERE g.group_id = $1`, [id]);
        if (!group)
            return reply.code(404).send({ error: 'Group not found' });
        const members = await (0, db_js_1.query)(`SELECT gm.role, gm.joined_tick, gm.joined_day, gm.contribution_score,
              a.agent_id, a.name, a.archetype,
              s.hp, s.mental_state, s.position_x, s.position_y
       FROM social.group_members gm
       JOIN agents.agents a ON a.agent_id = gm.agent_id
       JOIN agents.agent_state s ON s.agent_id = gm.agent_id
       WHERE gm.group_id = $1
       ORDER BY gm.contribution_score DESC`, [id]);
        return { ...group, members };
    });
    // Groups an agent belongs to (or has belonged to)
    app.get('/agents/:id/group', async (req, reply) => {
        const { id } = req.params;
        const row = await (0, db_js_1.queryOne)(`SELECT g.*,
              fa.name as founder_name
       FROM social.groups g
       JOIN agents.agents a ON a.group_id = g.group_id
       JOIN agents.agents fa ON fa.agent_id = g.founder_id
       WHERE a.agent_id = $1 AND g.status = 'active'`, [id]);
        if (!row)
            return reply.code(404).send({ error: 'Agent is not in a group' });
        return row;
    });
    // ── Phase 3: Reputation ───────────────────────────────────
    // Agent's reputation in their world
    app.get('/agents/:id/reputation', async (req, reply) => {
        const { id } = req.params;
        const agent = await (0, db_js_1.queryOne)(`SELECT world_id FROM agents.agents WHERE agent_id = $1`, [id]);
        if (!agent)
            return reply.code(404).send({ error: 'Agent not found' });
        const rep = await (0, db_js_1.queryOne)(`SELECT * FROM social.reputation WHERE agent_id = $1 AND world_id = $2`, [id, agent.world_id]);
        // Return neutral defaults if no reputation record yet
        return rep ?? {
            agent_id: id,
            world_id: agent.world_id,
            trustworthiness: 50,
            generosity: 50,
            skill_renown: 10,
            danger_level: 0,
            total_reports: 0,
            positive_reports: 0,
            negative_reports: 0,
        };
    });
    // World reputation leaderboard
    app.get('/worlds/:id/reputation', async (req) => {
        const { id } = req.params;
        return (0, db_js_1.query)(`SELECT r.*, a.name, a.archetype
       FROM social.reputation r
       JOIN agents.agents a ON a.agent_id = r.agent_id
       WHERE r.world_id = $1 AND r.total_reports > 0
       ORDER BY (r.trustworthiness + r.skill_renown + r.generosity) DESC
       LIMIT 20`, [id]);
    });
    // ── Phase 3: Gossip ───────────────────────────────────────
    // Recent gossip events in a world
    app.get('/worlds/:id/gossip', async (req) => {
        const { id } = req.params;
        const { limit = '20', offset = '0' } = req.query;
        return (0, db_js_1.query)(`SELECT ge.*,
              ga.name as gossiper_name,
              la.name as listener_name,
              sa.name as subject_name
       FROM social.gossip_events ge
       JOIN agents.agents ga ON ga.agent_id = ge.gossiper_id
       JOIN agents.agents la ON la.agent_id = ge.listener_id
       JOIN agents.agents sa ON sa.agent_id = ge.subject_id
       WHERE ge.world_id = $1
       ORDER BY ge.tick DESC
       LIMIT $2 OFFSET $3`, [id, parseInt(limit), parseInt(offset)]);
    });
    // Gossip about a specific agent (as subject)
    app.get('/agents/:id/gossip', async (req) => {
        const { id } = req.params;
        const { limit = '10' } = req.query;
        return (0, db_js_1.query)(`SELECT ge.*,
              ga.name as gossiper_name,
              la.name as listener_name
       FROM social.gossip_events ge
       JOIN agents.agents ga ON ga.agent_id = ge.gossiper_id
       JOIN agents.agents la ON la.agent_id = ge.listener_id
       WHERE ge.subject_id = $1
       ORDER BY ge.tick DESC
       LIMIT $2`, [id, parseInt(limit)]);
    });
    // ── Phase 3: Knowledge ────────────────────────────────────
    // An agent's knowledge facts
    app.get('/agents/:id/knowledge', async (req) => {
        const { id } = req.params;
        return (0, db_js_1.query)(`SELECT k.*,
              sa.name as source_agent_name
       FROM memory.agent_knowledge k
       LEFT JOIN agents.agents sa ON sa.agent_id = k.source_agent_id
       WHERE k.agent_id = $1
       ORDER BY k.confidence DESC, k.times_shared DESC`, [id]);
    });
    // Skill teaching events for a world
    app.get('/worlds/:id/teachings', async (req) => {
        const { id } = req.params;
        const { limit = '20', offset = '0' } = req.query;
        return (0, db_js_1.query)(`SELECT st.*,
              ta.name as teacher_name,
              sa.name as student_name
       FROM agents.skill_teachings st
       JOIN agents.agents ta ON ta.agent_id = st.teacher_id
       JOIN agents.agents sa ON sa.agent_id = st.student_id
       WHERE st.world_id = $1
       ORDER BY st.tick DESC
       LIMIT $2 OFFSET $3`, [id, parseInt(limit), parseInt(offset)]);
    });
}
