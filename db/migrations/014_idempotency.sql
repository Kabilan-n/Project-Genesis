-- ============================================================
-- Migration 014 — Idempotency records
-- ============================================================
-- Stores cached responses for mutating endpoints so a client can
-- safely retry a POST/PUT/DELETE by replaying the same
-- `Idempotency-Key` header — the server replies with the original
-- response instead of duplicating side effects.
--
-- Lifecycle:
--   1. Client sends Idempotency-Key with a mutating request.
--   2. Server hashes (user_id, key) and inserts a pending row.
--   3. After the handler completes, the row is updated with the
--      response status + body + request body hash.
--   4. Subsequent requests with the same (user_id, key):
--        - same request_hash  → return cached response_body
--        - different request_hash → 409 (idempotency conflict)
--   5. A daily cleanup drops rows older than 24h via the index.
--
-- Anonymous callers get a per-IP scope via user_id IS NULL +
-- a hash that includes the IP at the application layer.

CREATE TABLE IF NOT EXISTS auth.idempotency_records (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES auth.users(user_id) ON DELETE CASCADE,
  -- Bound to the IP for anonymous keys; ignored for authenticated keys.
  caller_ip TEXT,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, caller_ip, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_cleanup
  ON auth.idempotency_records (created_at);
