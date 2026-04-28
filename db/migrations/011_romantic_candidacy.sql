-- ============================================================
-- Migration 011 — Romantic candidacy on relationships
-- ============================================================
-- Adds the candidacy flag and a started-tick stamp so the
-- relationship-type state machine can transition to
-- `romantic_partner` deliberately (rather than via accidental
-- score thresholds), and so we can detect post-pairing fade
-- without losing the original pairing tick.
--
-- Numbered 011 because 010 was already taken by partner-tagged
-- memories (010_partner_memory.sql); the upstream remediation
-- spec assumed a free 010 slot.

ALTER TABLE social.relationships
  ADD COLUMN IF NOT EXISTS is_romantic_candidate BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS romantic_started_tick BIGINT;

CREATE INDEX IF NOT EXISTS idx_relationships_romantic
  ON social.relationships (agent_id, other_agent_id)
  WHERE is_romantic_candidate = TRUE;
