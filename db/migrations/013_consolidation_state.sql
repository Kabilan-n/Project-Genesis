-- ============================================================
-- Migration 013 — Memory consolidation run tracking
-- ============================================================
-- Records each (agent, day) consolidation pass so the simulation
-- can resume on restart and so failures can be observed instead
-- of silently lost.
--
-- Status flow:
--   pending  → claimed by an in-flight pass
--   success  → batch completed (including LLM-fallback path)
--   failed   → batch was abandoned after retries exhausted
--
-- The UNIQUE (agent_id, day) constraint makes the consolidation
-- run idempotent: a second attempt for the same pair is a no-op.

CREATE TABLE IF NOT EXISTS memory.consolidation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  agent_id UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  day INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (agent_id, day)
);

CREATE INDEX IF NOT EXISTS idx_consolidation_pending
  ON memory.consolidation_runs (world_id, status)
  WHERE status = 'pending';
