"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onboardingRoutes = onboardingRoutes;
const uuid_1 = require("uuid");
const db_js_1 = require("../db.js");
// 12 soul questions with trait modifiers per answer
const SOUL_QUESTIONS = [
    {
        id: 1,
        title: 'First Instincts',
        text: 'You wake up in an unfamiliar place. You see others in the distance. What\'s your first instinct?',
        options: [
            { label: 'Walk toward them', traits: { extraversion: 20, trust_default: 15 } },
            { label: 'Watch from a distance', traits: { curiosity: 10, self_preservation: 10 } },
            { label: 'Explore alone first', traits: { curiosity: 20, extraversion: -10 } },
            { label: 'Find shelter quickly', traits: { self_preservation: 20, scarcity_anxiety: 5 } },
        ],
    },
    {
        id: 2,
        title: 'Resource Scarcity',
        text: 'You have enough food for three days. A stranger approaches, clearly starving.',
        options: [
            { label: 'Share half freely', traits: { empathy: 25, self_preservation: -15 } },
            { label: 'Share a little', traits: { empathy: 10, fairness: 10 } },
            { label: 'Offer to trade', traits: { analytical: 15, ambition: 10 } },
            { label: 'Refuse — you need it', traits: { self_preservation: 20, scarcity_anxiety: 20 } },
        ],
    },
    {
        id: 3,
        title: 'Leadership Moment',
        text: 'A group of people are arguing about which path to take. No one has stepped up.',
        options: [
            { label: 'Step up and decide', traits: { ambition: 20, extraversion: 15, leadership_tendency: 20 } },
            { label: 'Propose a vote', traits: { fairness: 20, empathy: 10 } },
            { label: 'Suggest the safest path', traits: { self_preservation: 15, analytical: 10 } },
            { label: 'Stay quiet and follow', traits: { authority_respect: 20, extraversion: -15 } },
        ],
    },
    {
        id: 4,
        title: 'Discovery',
        text: 'You find a strange tool you\'ve never seen before.',
        options: [
            { label: 'Experiment immediately', traits: { curiosity: 25, impulsivity: 15 } },
            { label: 'Study it carefully first', traits: { analytical: 20, curiosity: 10 } },
            { label: 'Ask others about it', traits: { extraversion: 15, trust_default: 10 } },
            { label: 'Leave it — could be dangerous', traits: { self_preservation: 20, scarcity_anxiety: 10 } },
        ],
    },
    {
        id: 5,
        title: 'Conflict',
        text: 'Someone takes something from you without asking.',
        options: [
            { label: 'Confront them directly', traits: { aggression: 20, ambition: 10 } },
            { label: 'Ask why they took it', traits: { empathy: 15, curiosity: 10 } },
            { label: 'Tell others what happened', traits: { loyalty: 15, fairness: 15 } },
            { label: 'Let it go — not worth it', traits: { resilience: 15, self_preservation: 10 } },
        ],
    },
    {
        id: 6,
        title: 'Moral Dilemma',
        text: 'Your closest friend has stolen food from the community. Only you know.',
        options: [
            { label: 'Report them', traits: { fairness: 20, authority_respect: 15, loyalty: -15 } },
            { label: 'Keep the secret', traits: { loyalty: 25, fear_of_rejection: 10 } },
            { label: 'Confront them privately', traits: { empathy: 20, fairness: 10 } },
            { label: 'Help return it secretly', traits: { loyalty: 15, fairness: 15, creativity: 10 } },
        ],
    },
    {
        id: 7,
        title: 'Opportunity',
        text: 'You find a hidden cache of valuable resources. No one saw you find it.',
        options: [
            { label: 'Keep it all — finders keepers', traits: { ambition: 20, self_preservation: 10 } },
            { label: 'Share with your group', traits: { fairness: 20, loyalty: 15 } },
            { label: 'Keep most, share a bit', traits: { analytical: 15, ambition: 10 } },
            { label: 'Tell everyone immediately', traits: { trust_default: 20, extraversion: 10 } },
        ],
    },
    {
        id: 8,
        title: 'Adversity',
        text: 'You fail at something important in front of others.',
        options: [
            { label: 'Laugh it off and try again', traits: { resilience: 25, optimism: 15 } },
            { label: 'Analyze what went wrong', traits: { analytical: 20, resilience: 10 } },
            { label: 'Feel embarrassed but push on', traits: { fear_of_rejection: 15, resilience: 10 } },
            { label: 'Avoid that thing in future', traits: { self_preservation: 15, scarcity_anxiety: 10 } },
        ],
    },
    {
        id: 9,
        title: 'Free Time',
        text: 'You have a rare day with no responsibilities. How do you spend it?',
        options: [
            { label: 'Explore somewhere new', traits: { curiosity: 20, extraversion: 10 } },
            { label: 'Spend it with people you like', traits: { extraversion: 20, empathy: 10 } },
            { label: 'Work on a personal project', traits: { creativity: 20, ambition: 15 } },
            { label: 'Rest and recover alone', traits: { resilience: 15, extraversion: -15 } },
        ],
    },
    {
        id: 10,
        title: 'Loss',
        text: 'Someone you cared about has left your community permanently.',
        options: [
            { label: 'Grieve openly with others', traits: { extraversion: 10, empathy: 15 } },
            { label: 'Grieve privately', traits: { extraversion: -10, resilience: 10 } },
            { label: 'Focus on what remains', traits: { resilience: 20, optimism: 10 } },
            { label: 'Struggle to let go', traits: { fear_of_rejection: 15, loyalty: 15 } },
        ],
    },
    {
        id: 11,
        title: 'The Deep Fear',
        text: 'Every person carries a fear deeper than death. What keeps your agent awake?',
        options: [
            { label: 'Being completely alone', traits: { fear_of_rejection: 30, extraversion: 15 } },
            { label: 'Being seen as worthless', traits: { status_obsession: 30, ambition: 15 } },
            { label: 'Having secrets exposed', traits: { fear_of_rejection: 20, scarcity_anxiety: 15 } },
            { label: 'Losing control of everything', traits: { scarcity_anxiety: 30, self_preservation: 15 } },
        ],
    },
    {
        id: 12,
        title: 'Legacy',
        text: 'If this world remembered you for one thing, what would you want it to be?',
        options: [
            { label: 'You built something that lasted', traits: { ambition: 20, creativity: 15, analytical: 10 } },
            { label: 'You helped people survive', traits: { empathy: 25, loyalty: 15 } },
            { label: 'You discovered something new', traits: { curiosity: 25, creativity: 15 } },
            { label: 'You kept the peace', traits: { fairness: 20, authority_respect: 10, empathy: 10 } },
        ],
    },
];
function calculateArchetype(traits) {
    const get = (k) => traits[k] ?? 50;
    // First word: approach to life
    let firstWord = 'Thoughtful';
    if (get('optimism') > 60)
        firstWord = 'Hopeful';
    else if (get('optimism') < 40)
        firstWord = 'Cautious';
    else if (get('impulsivity') > 60)
        firstWord = 'Spontaneous';
    // Second word: social role
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
async function onboardingRoutes(app) {
    // Start session
    app.post('/onboarding/sessions', { onRequest: [app.authenticate] }, async (req, reply) => {
        const { user_id } = req.user;
        const { mode = 'discover', world_id } = req.body;
        const sessionId = (0, uuid_1.v4)();
        await (0, db_js_1.execute)(`INSERT INTO auth.onboarding_sessions (session_id, user_id, world_id, mode)
       VALUES ($1,$2,$3,$4)`, [sessionId, user_id, world_id ?? null, mode]);
        return { session_id: sessionId, total_questions: SOUL_QUESTIONS.length };
    });
    // Get question N
    app.get('/onboarding/sessions/:id/questions/:n', { onRequest: [app.authenticate] }, async (req, reply) => {
        const { n } = req.params;
        const questionIdx = parseInt(n) - 1;
        const question = SOUL_QUESTIONS[questionIdx];
        if (!question)
            return reply.code(404).send({ error: 'Question not found' });
        return {
            question_number: parseInt(n),
            total: SOUL_QUESTIONS.length,
            ...question,
            options: question.options.map(o => ({ label: o.label })), // hide trait values
        };
    });
    // Submit answer
    app.post('/onboarding/sessions/:id/answers', { onRequest: [app.authenticate] }, async (req, reply) => {
        const { id } = req.params;
        const { question_number, answer_index } = req.body;
        const session = await (0, db_js_1.queryOne)('SELECT session_id, answers, accumulated_traits FROM auth.onboarding_sessions WHERE session_id = $1', [id]);
        if (!session)
            return reply.code(404).send({ error: 'Session not found' });
        const question = SOUL_QUESTIONS[question_number - 1];
        if (!question)
            return reply.code(400).send({ error: 'Invalid question number' });
        const option = question.options[answer_index];
        if (!option)
            return reply.code(400).send({ error: 'Invalid answer index' });
        // Accumulate traits
        const traits = { ...(session.accumulated_traits ?? {}) };
        for (const [trait, value] of Object.entries(option.traits)) {
            traits[trait] = (traits[trait] ?? 50) + value;
        }
        // Clamp all trait values
        for (const key of Object.keys(traits)) {
            traits[key] = Math.max(0, Math.min(100, traits[key]));
        }
        const answers = [...(session.answers ?? []), { question_number, answer_index }];
        await (0, db_js_1.execute)(`UPDATE auth.onboarding_sessions
       SET answers = $1, accumulated_traits = $2
       WHERE session_id = $3`, [JSON.stringify(answers), JSON.stringify(traits), id]);
        return {
            questions_answered: answers.length,
            remaining: SOUL_QUESTIONS.length - answers.length,
        };
    });
    // Set identity (name + appearance)
    app.post('/onboarding/sessions/:id/identity', { onRequest: [app.authenticate] }, async (req, reply) => {
        const { id } = req.params;
        const { name, appearance = {} } = req.body;
        if (!name || name.length < 2) {
            return reply.code(400).send({ error: 'Name must be at least 2 characters' });
        }
        await (0, db_js_1.execute)(`UPDATE auth.onboarding_sessions SET name = $1, appearance = $2 WHERE session_id = $3`, [name.trim(), JSON.stringify(appearance), id]);
        return { ok: true };
    });
    // Complete — create the agent
    app.post('/onboarding/sessions/:id/complete', { onRequest: [app.authenticate] }, async (req, reply) => {
        const { id } = req.params;
        const { user_id } = req.user;
        const session = await (0, db_js_1.queryOne)('SELECT * FROM auth.onboarding_sessions WHERE session_id = $1 AND status = $2', [id, 'in_progress']);
        if (!session)
            return reply.code(404).send({ error: 'Session not found or already completed' });
        if (!session.name)
            return reply.code(400).send({ error: 'Must set identity before completing' });
        // Get world_id — use provided or pick first active world
        let worldId = session.world_id;
        if (!worldId) {
            const world = await (0, db_js_1.queryOne)(`SELECT world_id FROM worlds.worlds WHERE status = 'active' LIMIT 1`);
            if (!world)
                return reply.code(400).send({ error: 'No active world available' });
            worldId = world.world_id;
        }
        const traits = session.accumulated_traits ?? {};
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
       ORDER BY RANDOM()
       LIMIT 1`, [worldId]);
        const spawnX = spawnTile?.x ?? 25;
        const spawnY = spawnTile?.y ?? 25;
        // Get current tick
        const world = await (0, db_js_1.queryOne)('SELECT current_tick FROM worlds.worlds WHERE world_id = $1', [worldId]);
        const birthTick = world?.current_tick ?? 0;
        // Insert agent
        await (0, db_js_1.execute)(`INSERT INTO agents.agents (agent_id, world_id, created_by_user_id, name, archetype, birth_tick)
       VALUES ($1,$2,$3,$4,$5,$6)`, [agentId, worldId, user_id, session.name, archetype, birthTick]);
        // Insert traits (defaults + answers accumulated)
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
        // Mark session complete + update user counts
        await (0, db_js_1.execute)(`UPDATE auth.onboarding_sessions SET status = 'completed' WHERE session_id = $1`, [id]);
        await (0, db_js_1.execute)(`UPDATE auth.users
       SET agents_created_count = agents_created_count + 1,
           agents_alive_count = agents_alive_count + 1
       WHERE user_id = $1`, [user_id]);
        return {
            agent_id: agentId,
            name: session.name,
            archetype,
            world_id: worldId,
            spawn_position: { x: spawnX, y: spawnY },
        };
    });
}
