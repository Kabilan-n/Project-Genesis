"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = authRoutes;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const db_js_1 = require("../db.js");
async function authRoutes(app) {
    // Register
    app.post('/auth/register', async (req, reply) => {
        const { email, username, password } = req.body;
        if (!email || !username || !password) {
            return reply.code(400).send({ error: 'email, username, and password are required' });
        }
        const existing = await (0, db_js_1.queryOne)('SELECT user_id FROM auth.users WHERE email = $1 OR username = $2', [email, username]);
        if (existing) {
            return reply.code(409).send({ error: 'Email or username already taken' });
        }
        const password_hash = await bcryptjs_1.default.hash(password, 10);
        const user = await (0, db_js_1.queryOne)(`INSERT INTO auth.users (email, username, password_hash)
       VALUES ($1, $2, $3) RETURNING user_id, email, username`, [email, username, password_hash]);
        const token = app.jwt.sign({ user_id: user.user_id, username: user.username });
        return reply.code(201).send({ token, user });
    });
    // Login
    app.post('/auth/login', async (req, reply) => {
        const { email, password } = req.body;
        const user = await (0, db_js_1.queryOne)('SELECT user_id, username, email, password_hash FROM auth.users WHERE email = $1 AND status = $2', [email, 'active']);
        if (!user || !(await bcryptjs_1.default.compare(password, user.password_hash))) {
            return reply.code(401).send({ error: 'Invalid credentials' });
        }
        const token = app.jwt.sign({ user_id: user.user_id, username: user.username });
        return { token, user: { user_id: user.user_id, username: user.username, email: user.email } };
    });
    // Get current user
    app.get('/users/me', { onRequest: [app.authenticate] }, async (req, reply) => {
        const { user_id } = req.user;
        const user = await (0, db_js_1.queryOne)(`SELECT user_id, username, email, subscription_tier, agents_created_count, agents_alive_count
       FROM auth.users WHERE user_id = $1`, [user_id]);
        if (!user)
            return reply.code(404).send({ error: 'User not found' });
        const agents = await (0, db_js_1.query)(`SELECT a.agent_id, a.name, a.archetype, a.status
       FROM agents.agents a
       WHERE a.created_by_user_id = $1
       ORDER BY a.created_at DESC`, [user_id]);
        return { ...user, agents };
    });
}
