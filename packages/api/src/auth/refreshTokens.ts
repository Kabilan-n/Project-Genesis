/**
 * Refresh-token helpers — the second leg of the two-token JWT pattern.
 *
 * - Access tokens are signed JWTs sent via `Authorization: Bearer`. They
 *   expire fast (15 min) so a stolen access token has a short blast radius.
 * - Refresh tokens are opaque random bytes stored in an HttpOnly Secure
 *   cookie. Their hash lives in auth.refresh_tokens. They are used only
 *   on POST /auth/refresh to mint a new access + refresh pair (rotation).
 *
 * Theft detection:
 *   If a refresh token that has already been revoked is presented, we
 *   assume the original was stolen. We revoke EVERY refresh token for
 *   that user and force them to log in again.
 */
import { randomBytes, createHash } from 'crypto';
import { execute, query, queryOne } from '../db.js';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;            // 15 min
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const REFRESH_COOKIE_NAME = 'genesis_refresh';

export function generateRefreshToken(): string {
  // 32 random bytes → 64 hex chars. Plenty of entropy for an opaque token.
  return randomBytes(32).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function issueRefreshToken(
  userId: string,
  meta: { userAgent?: string; ipAddress?: string } = {},
): Promise<{ token: string; expiresAt: Date; id: string }> {
  const token = generateRefreshToken();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

  const row = await queryOne<{ id: string }>(
    `INSERT INTO auth.refresh_tokens
       (user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [userId, hashRefreshToken(token), expiresAt, meta.userAgent ?? null, meta.ipAddress ?? null],
  );

  return { token, expiresAt, id: row!.id };
}

export interface RefreshLookup {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  rotated_to: string | null;
}

export async function findRefreshToken(token: string): Promise<RefreshLookup | null> {
  return queryOne<RefreshLookup>(
    `SELECT id, user_id, token_hash, expires_at, revoked_at, rotated_to
     FROM auth.refresh_tokens
     WHERE token_hash = $1`,
    [hashRefreshToken(token)],
  );
}

export async function revokeRefreshToken(
  id: string,
  reason: 'rotated' | 'logout' | 'theft_detected' | 'admin',
  rotatedTo?: string,
): Promise<void> {
  await execute(
    `UPDATE auth.refresh_tokens
     SET revoked_at = NOW(), revoke_reason = $2, rotated_to = $3
     WHERE id = $1 AND revoked_at IS NULL`,
    [id, reason, rotatedTo ?? null],
  );
}

export async function revokeAllUserRefreshTokens(
  userId: string,
  reason: 'theft_detected' | 'admin',
): Promise<void> {
  await execute(
    `UPDATE auth.refresh_tokens
     SET revoked_at = NOW(), revoke_reason = $2
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, reason],
  );
}

/**
 * Validate a refresh token and classify the result. The caller decides
 * what to do with each outcome.
 */
export type ValidationResult =
  | { ok: true; row: RefreshLookup }
  | { ok: false; reason: 'not_found' | 'expired' | 'revoked' | 'theft' };

export async function validateRefreshToken(token: string): Promise<ValidationResult> {
  const row = await findRefreshToken(token);
  if (!row) return { ok: false, reason: 'not_found' };

  if (row.revoked_at) {
    // Reuse of a revoked token → assume theft. Caller will revoke all
    // tokens for this user.
    return { ok: false, reason: 'theft' };
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, row };
}
