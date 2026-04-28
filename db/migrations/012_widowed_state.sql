-- ============================================================
-- Migration 012 — Add `widowed` to relationship_type
-- ============================================================
-- relationship_type is a VARCHAR(30) with a CHECK constraint
-- (set in 001_init.sql), not a Postgres enum, so we drop and
-- recreate the constraint rather than ALTER TYPE ADD VALUE.
--
-- Numbered 012 because 010/011 are already occupied. See
-- 011_romantic_candidacy.sql for context.

ALTER TABLE social.relationships
  DROP CONSTRAINT IF EXISTS relationships_relationship_type_check;

ALTER TABLE social.relationships
  ADD CONSTRAINT relationships_relationship_type_check
  CHECK (relationship_type IN (
    'stranger',
    'acquaintance',
    'friend',
    'close_friend',
    'romantic_partner',
    'rival',
    'enemy',
    'family',
    'widowed'
  ));
