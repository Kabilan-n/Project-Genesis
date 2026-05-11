import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { query, queryOne } from '../db.js';
import {
  issueRefreshToken,
  validateRefreshToken,
  revokeRefreshToken,
  revokeAllUserRefreshTokens,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  REFRESH_COOKIE_NAME,
} from '../auth/refreshTokens.js';

interface AuthedUser {
  user_id: string;
  username: string;
  email: string;
}

/**
 * Set the refresh cookie on a reply. HttpOnly + Secure + SameSite=Lax so
 * it can't be read by JS, only travels over TLS, and won't be sent on
 * naive cross-site requests.
 */
function setRefreshCookie(reply: FastifyReply, token: string) {
  const inProd = process.env.NODE_ENV === 'production';
  reply.setCookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: inProd,
    sameSite: 'lax',
    path: '/auth',
    maxAge: REFRESH_TOKEN_TTL_SECONDS,
  });
}

function clearRefreshCookie(reply: FastifyReply) {
  reply.clearCookie(REFRESH_COOKIE_NAME, { path: '/auth' });
}

function signAccess(app: FastifyInstance, user: { user_id: string; username: string }): string {
  return app.jwt.sign(
    { user_id: user.user_id, username: user.username },
    { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
  );
}

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
    const user = await queryOne<AuthedUser>(
      `INSERT INTO auth.users (email, username, password_hash)
       VALUES ($1, $2, $3) RETURNING user_id, email, username`,
      [email, username, password_hash]
    );

    const token = signAccess(app, user!);
    const { token: refreshToken } = await issueRefreshToken(user!.user_id, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    setRefreshCookie(reply, refreshToken);
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

    const token = signAccess(app, user);
    const { token: refreshToken } = await issueRefreshToken(user.user_id, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    setRefreshCookie(reply, refreshToken);
    return { token, user: { user_id: user.user_id, username: user.username, email: user.email } };
  });

  /**
   * Refresh — exchange the cookie-borne refresh token for a NEW
   * access + refresh pair. The presented refresh token is revoked
   * (rotation). If a revoked token is presented, every refresh
   * token for the user is revoked and 401 is returned (theft detected).
   */
  app.post('/auth/refresh', {
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const presented = (req as any).cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
    if (!presented) {
      return reply.code(401).send({ error: 'missing_refresh_cookie' });
    }

    const check = await validateRefreshToken(presented);
    if (!check.ok) {
      if (check.reason === 'theft') {
        // Look up the user the revoked token belonged to so we can
        // burn every other session.
        const stale = await queryOne<{ user_id: string }>(
          `SELECT user_id FROM auth.refresh_tokens WHERE token_hash = $1`,
          [require('crypto').createHash('sha256').update(presented).digest('hex')],
        );
        if (stale) {
          await revokeAllUserRefreshTokens(stale.user_id, 'theft_detected');
        }
        clearRefreshCookie(reply);
        return reply.code(401).send({ error: 'session_revoked' });
      }
      clearRefreshCookie(reply);
      return reply.code(401).send({ error: check.reason });
    }

    const user = await queryOne<AuthedUser>(
      `SELECT user_id, username, email FROM auth.users WHERE user_id = $1 AND status = 'active'`,
      [check.row.user_id],
    );
    if (!user) {
      clearRefreshCookie(reply);
      return reply.code(401).send({ error: 'user_inactive' });
    }

    // Rotate: issue new pair, revoke the presented one with a pointer
    // to the replacement for audit.
    const { token: newRefresh, id: newId } = await issueRefreshToken(user.user_id, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    await revokeRefreshToken(check.row.id, 'rotated', newId);
    setRefreshCookie(reply, newRefresh);

    return { token: signAccess(app, user), user };
  });

  /**
   * Logout — revoke the presented refresh token and clear the cookie.
   * Idempotent: no cookie = success.
   */
  app.post('/auth/logout', async (req: FastifyRequest, reply: FastifyReply) => {
    const presented = (req as any).cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
    if (presented) {
      const check = await validateRefreshToken(presented);
      if (check.ok) {
        await revokeRefreshToken(check.row.id, 'logout');
      }
    }
    clearRefreshCookie(reply);
    return { ok: true };
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
