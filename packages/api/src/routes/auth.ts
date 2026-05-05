import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, execute } from '../db.js';

export async function authRoutes(app: FastifyInstance) {
  // Register — strict rate limit. Account creation is heavyweight
  // (bcrypt + DB writes) and a vector for resource-exhaustion attacks.
  app.post('/auth/register', {
    config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
  }, async (req, reply) => {
    const { email, username, password } = req.body as {
      email: string; username: string; password: string;
    };

    if (!email || !username || !password) {
      return reply.code(400).send({ error: 'email, username, and password are required' });
    }

    const existing = await queryOne(
      'SELECT user_id FROM auth.users WHERE email = $1 OR username = $2',
      [email, username]
    );
    if (existing) {
      return reply.code(409).send({ error: 'Email or username already taken' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const user = await queryOne<{ user_id: string; username: string; email: string }>(
      `INSERT INTO auth.users (email, username, password_hash)
       VALUES ($1, $2, $3) RETURNING user_id, email, username`,
      [email, username, password_hash]
    );

    const token = app.jwt.sign({ user_id: user!.user_id, username: user!.username });
    return reply.code(201).send({ token, user });
  });

  // Login — also rate-limited as a brute-force protection. Tighter than
  // global so a credential-stuffing campaign can't exhaust the global
  // budget for legitimate users.
  app.post('/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const { email, password } = req.body as { email: string; password: string };

    const user = await queryOne<{
      user_id: string; username: string; email: string; password_hash: string;
    }>(
      'SELECT user_id, username, email, password_hash FROM auth.users WHERE email = $1 AND status = $2',
      [email, 'active']
    );

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const token = app.jwt.sign({ user_id: user.user_id, username: user.username });
    return { token, user: { user_id: user.user_id, username: user.username, email: user.email } };
  });

  // Get current user
  app.get('/users/me', { onRequest: [app.authenticate] }, async (req, reply) => {
    const { user_id } = req.user as { user_id: string };

    const user = await queryOne<{
      user_id: string; username: string; email: string;
      subscription_tier: string; agents_created_count: number; agents_alive_count: number;
    }>(
      `SELECT user_id, username, email, subscription_tier, agents_created_count, agents_alive_count
       FROM auth.users WHERE user_id = $1`,
      [user_id]
    );

    if (!user) return reply.code(404).send({ error: 'User not found' });

    const agents = await query<{ agent_id: string; name: string; archetype: string; status: string }>(
      `SELECT a.agent_id, a.name, a.archetype, a.status
       FROM agents.agents a
       WHERE a.created_by_user_id = $1
       ORDER BY a.created_at DESC`,
      [user_id]
    );

    return { ...user, agents };
  });
}
