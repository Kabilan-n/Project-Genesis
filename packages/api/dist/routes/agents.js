"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentRoutes = agentRoutes;
const uuid_1 = require("uuid");
const db_js_1 = require("../db.js");
/* ── Soul questions trait map (mirrors onboarding.ts) ── */
const SOUL_TRAITS = [
    /* Q1 */ [{ extraversion: 20, trust_default: 15 }, { curiosity: 10, self_preservation: 10 }, { curiosity: 20, extraversion: -10 }, { self_preservation: 20, scarcity_anxiety: 5 }],
    /* Q2 */ [{ empathy: 25, self_preservation: -15 }, { empathy: 10, fairness: 10 }, { analytical: 15, ambition: 10 }, { self_preservation: 20, scarcity_anxiety: 20 }],
    /* Q3 */ [{ ambition: 20, extraversion: 15, leadership_tendency: 20 }, { fairness: 20, empathy: 10 }, { self_preservation: 15, analytical: 10 }, { authority_respect: 20, extraversion: -15 }],
    /* Q4 */ [{ curiosity: 25, impulsivity: 15 }, { analytical: 20, curiosity: 10 }, { extraversion: 15, trust_default: 10 }, { self_preservation: 20, scarcity_anxiety: 10 }],
    /* Q5 */ [{ aggression: 20, ambition: 10 }, { empathy: 15, curiosity: 10 }, { loyalty: 15, fairness: 15 }, { resilience: 15, self_preservation: 10 }],
    /* Q6 */ [{ fairness: 20, authority_respect: 15, loyalty: -15 }, { loyalty: 25, fear_of_rejection: 10 }, { empathy: 20, fairness: 10 }, { loyalty: 15, fairness: 15, creativity: 10 }],
    /* Q7 */ [{ ambition: 20, self_preservation: 10 }, { fairness: 20, loyalty: 15 }, { analytical: 15, ambition: 10 }, { trust_default: 20, extraversion: 10 }],
    /* Q8 */ [{ resilience: 25, optimism: 15 }, { analytical: 20, resilience: 10 }, { fear_of_rejection: 15, resilience: 10 }, { self_preservation: 15, scarcity_anxiety: 10 }],
    /* Q9 */ [{ curiosity: 20, extraversion: 10 }, { extraversion: 20, empathy: 10 }, { creativity: 20, ambition: 15 }, { resilience: 15, extraversion: -15 }],
    /* Q10 */ [{ extraversion: 10, empathy: 15 }, { extraversion: -10, resilience: 10 }, { resilience: 20, optimism: 10 }, { fear_of_rejection: 15, loyalty: 15 }],
    /* Q11 */ [{ fear_of_rejection: 30, extraversion: 15 }, { status_obsession: 30, ambition: 15 }, { fear_of_rejection: 20, scarcity_anxiety: 15 }, { scarcity_anxiety: 30, self_preservation: 15 }],
    /* Q12 */ [{ ambition: 20, creativity: 15, analytical: 10 }, { empathy: 25, loyalty: 15 }, { curiosity: 25, creativity: 15 }, { fairness: 20, authority_respect: 10, empathy: 10 }],
];
function calculateArchetype(traits) {
    const get = (k) => traits[k] ?? 50;
    let firstWord = 'Thoughtful';
    if (get('optimism') > 60)
        firstWord = 'Hopeful';
    else if (get('optimism') < 40)
        firstWord = 'Cautious';
    else if (get('impulsivity') > 60)
        firstWord = 'Spontaneous';
    const scores = {
        Leader: get('ambition') + get('extraversion') + get('leadership_tendency'),
        Caregiver: get('empathy') + get('loyalty'),
        Explorer: get('curiosity') + get('extraversion'),
        Achiever: get('ambition') + get('resilience'),
        Observer: get('curiosity') + (100 - get('extraversion')),
    };
    const secondWord = Object.entries(scores).sort(([, a], [, b]) => b - a)[0][0];
    return `The ${firstWord} ${secondWord}`;
}
async function agentRoutes(app) {
    /* ── Create agent from soul questionnaire (no auth required) ── */
    app.post('/agents/create', async (req, reply) => {
        const { world_id, name, answers } = req.body;
        if (!name || name.trim().length < 2) {
            return reply.code(400).send({ error: 'Name must be at least 2 characters' });
        }
        if (!world_id) {
            return reply.code(400).send({ error: 'world_id is required' });
        }
        if (!answers || answers.length !== 12) {
            return reply.code(400).send({ error: 'Exactly 12 answers are required' });
        }
        // Accumulate traits from answers
        const traits = {};
        for (const ans of answers) {
            const qIdx = ans.question_number - 1;
            const traitSet = SOUL_TRAITS[qIdx]?.[ans.answer_index];
            if (!traitSet) {
                return reply.code(400).send({ error: `Invalid question ${ans.question_number} / answer ${ans.answer_index}` });
            }
            for (const [trait, value] of Object.entries(traitSet)) {
                traits[trait] = (traits[trait] ?? 50) + value;
            }
        }
        // Clamp
        for (const key of Object.keys(traits)) {
            traits[key] = Math.max(0, Math.min(100, traits[key]));
        }
        const archetype = calculateArchetype(traits);
        const agentId = (0, uuid_1.v4)();
        // Find spawn point
        const spawnTile = await (0, db_js_1.queryOne)(`SELECT x, y FROM worlds.map_tiles
       WHERE world_id = $1 AND is_passable = true
         AND NOT EXISTS (
           SELECT 1 FROM agents.agent_state s
           JOIN agents.agents a ON a.agent_id = s.agent_id
           WHERE s.position_x = map_tiles.x AND s.position_y = map_tiles.y AND a.status = 'alive'
         )
       ORDER BY RANDOM() LIMIT 1`, [world_id]);
        const spawnX = spawnTile?.x ?? 25;
        const spawnY = spawnTile?.y ?? 25;
        // Current tick
        const world = await (0, db_js_1.queryOne)('SELECT current_tick FROM worlds.worlds WHERE world_id = $1', [world_id]);
        const birthTick = world?.current_tick ?? 0;
        // Insert agent
        await (0, db_js_1.execute)(`INSERT INTO agents.agents (agent_id, world_id, name, archetype, birth_tick)
       VALUES ($1,$2,$3,$4,$5)`, [agentId, world_id, name.trim(), archetype, birthTick]);
        // Insert traits
        const t = (key, def = 50) => Math.max(0, Math.min(100, Math.round(traits[key] ?? def)));
        await (0, db_js_1.execute)(`INSERT INTO agents.agent_traits (
         agent_id, optimism, resilience, impulsivity, extraversion, empathy, trust_default,
         curiosity, analytical, creativity, fairness, loyalty, authority_respect,
         ambition, aggression, self_preservation, fear_of_rejection, scarcity_anxiety,
         status_obsession, leadership_tendency
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`, [
            agentId,
            t('optimism'), t('resilience'), t('impulsivity'),
            t('extraversion'), t('empathy'), t('trust_default'),
            t('curiosity'), t('analytical'), t('creativity'),
            t('fairness'), t('loyalty'), t('authority_respect'),
            t('ambition'), t('aggression'), t('self_preservation'),
            t('fear_of_rejection', 30), t('scarcity_anxiety', 30), t('status_obsession', 30),
            t('leadership_tendency'),
        ]);
        // Insert state
        await (0, db_js_1.execute)(`INSERT INTO agents.agent_state (agent_id, position_x, position_y)
       VALUES ($1,$2,$3)`, [agentId, spawnX, spawnY]);
        // Starting inventory
        await (0, db_js_1.execute)(`INSERT INTO economy.inventory (agent_id, resource_type, amount, acquired_method)
       VALUES ($1,'food',20,'initial'), ($1,'water',15,'initial')`, [agentId]);
        // Starting skills
        await (0, db_js_1.execute)(`INSERT INTO agents.agent_skills (agent_id, skill_name, level) VALUES ($1,'foraging',1)`, [agentId]);
        return {
            agent_id: agentId,
            name: name.trim(),
            archetype,
            world_id,
            spawn_position: { x: spawnX, y: spawnY },
        };
    });
    // Full agent profile
    app.get('/agents/:id', async (req, reply) => {
        const { id } = req.params;
        const agent = await (0, db_js_1.queryOne)(`SELECT a.agent_id, a.world_id, a.name, a.archetype, a.status,
              a.birth_tick, a.death_tick, a.generation, a.parent_agent_ids,
              s.hp, s.position_x, s.position_y,
              s.need_food, s.need_water, s.need_rest, s.need_belonging, s.need_esteem,
              s.current_activity, s.mental_state, s.current_goal, s.is_awake,
              s.last_updated_tick
       FROM agents.agents a
       LEFT JOIN agents.agent_state s ON a.agent_id = s.agent_id
       WHERE a.agent_id = $1`, [id]);
        if (!agent)
            return reply.code(404).send({ error: 'Agent not found' });
        const traits = await (0, db_js_1.queryOne)('SELECT * FROM agents.agent_traits WHERE agent_id = $1', [id]);
        const skills = await (0, db_js_1.query)('SELECT skill_name, level, xp FROM agents.agent_skills WHERE agent_id = $1', [id]);
        const inventory = await (0, db_js_1.query)('SELECT resource_type, amount, quality FROM economy.inventory WHERE agent_id = $1 AND amount > 0', [id]);
        const memories = await (0, db_js_1.query)(`SELECT memory_id, tick, day, summary, emotional_valence, emotional_intensity, importance
       FROM memory.episodic_memories
       WHERE agent_id = $1
       ORDER BY importance DESC, tick DESC
       LIMIT 10`, [id]);
        return { ...agent, traits, skills, inventory, recent_memories: memories };
    });
    // Agent relationships
    app.get('/agents/:id/relationships', async (req) => {
        const { id } = req.params;
        return (0, db_js_1.query)(`SELECT r.other_agent_id, a.name as other_name, a.archetype as other_archetype,
              r.trust_score, r.affection_score, r.respect_score, r.fear_score,
              r.relationship_type, r.last_interaction_tick
       FROM social.relationships r
       JOIN agents.agents a ON a.agent_id = r.other_agent_id
       WHERE r.agent_id = $1
       ORDER BY r.trust_score DESC`, [id]);
    });
    // Agent memory
    app.get('/agents/:id/memories', async (req) => {
        const { id } = req.params;
        const { limit = '20' } = req.query;
        return (0, db_js_1.query)(`SELECT * FROM memory.episodic_memories
       WHERE agent_id = $1
       ORDER BY importance DESC, tick DESC
       LIMIT $2`, [id, parseInt(limit)]);
    });
    // Agent life history (events involving this agent)
    app.get('/agents/:id/history', async (req) => {
        const { id } = req.params;
        return (0, db_js_1.query)(`SELECT event_id, tick, day, event_type, significance, title, summary, created_at
       FROM events.events
       WHERE $1 = ANY(participant_agent_ids)
       ORDER BY tick DESC
       LIMIT 50`, [id]);
    });
    // Current thoughts / internal state
    app.get('/agents/:id/thoughts', async (req, reply) => {
        const { id } = req.params;
        const state = await (0, db_js_1.queryOne)(`SELECT s.current_goal, s.mental_state, s.current_activity,
              s.need_food, s.need_water, s.need_rest, s.hp,
              m.summary as latest_thought
       FROM agents.agent_state s
       LEFT JOIN LATERAL (
         SELECT summary FROM memory.episodic_memories
         WHERE agent_id = $1
         ORDER BY tick DESC LIMIT 1
       ) m ON true
       WHERE s.agent_id = $1`, [id]);
        if (!state)
            return reply.code(404).send({ error: 'Agent not found' });
        return state;
    });
}
