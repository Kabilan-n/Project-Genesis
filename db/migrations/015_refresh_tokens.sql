-- ============================================================
-- Migration 015 — Refresh tokens
-- ============================================================
-- The classic two-token JWT pattern:
--   access  token: 15 min, sent via Authorization: Bearer
--   refresh token: 30 days, stored in HttpOnly Secure cookie
--
-- Each refresh issues a NEW refresh token and revokes the old one
-- (token rotation). If a revoked refresh token is presented, that
-- is treated as theft — we revoke every refresh token belonging to
-- the user and force a re-login.
--
-- Tokens are stored hashed (sha256) so a DB leak doesn't immediately
-- yield session-take-over: the attacker would still need the
-- pre-image. The plaintext is only ever in the cookie + transit.
--
-- Numbered 015 because the plan's 013 slot is occupied by
-- consolidation_state and 014 by idempotency_records.

CREATE TABLE IF NOT EXISTS auth.refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  /** If this token was used to mint a new one, link them — useful for
      audit + theft detection chains. */
  rotated_to UUID REFERENCES auth.refresh_tokens(id),
  /** Why the token was revoked: 'rotated' | 'logout' | 'theft_detected' | 'admin'. */
  revoke_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  /** Diagnostic only — not used for auth decisions. */
  user_agent TEXT,
  ip_address TEXT
);

-- Active-tokens-per-user lookup (one row per active session).
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active
  ON auth.refresh_tokens (user_id)
  WHERE revoked_at IS NULL;

-- Cleanup index for expired/revoked tokens.
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_cleanup
  ON auth.refresh_tokens (expires_at);
