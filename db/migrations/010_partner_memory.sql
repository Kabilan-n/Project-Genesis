-- ============================================================
-- Migration 010 — Partner-tagged memories + embedding column
-- ============================================================
-- Goal: agents currently fetch generic top-N memories ordered
-- by importance, so they "forget" who they've talked to.
-- This migration adds:
--   1. partner_agent_ids[]  — tag a memory with the people it concerns,
--      so the conversation prompt can pull "memories about THIS partner"
--   2. embedding VECTOR(1536) — nullable column for future semantic
--      recall. The pgvector extension is already enabled from 001_init.

ALTER TABLE memory.episodic_memories
  ADD COLUMN IF NOT EXISTS partner_agent_ids UUID[] NOT NULL DEFAULT '{}';

ALTER TABLE memory.episodic_memories
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- GIN index makes "memories about partner X" lookups fast even with
-- many memories per agent. This is the index the new query path uses.
CREATE INDEX IF NOT EXISTS idx_episodic_memories_partners
  ON memory.episodic_memories USING GIN (partner_agent_ids);

-- IVFFlat index on the embedding column. Only meaningful once
-- embeddings are populated; safe to create now (empty index is cheap).
-- Cosine distance because OpenAI / sentence-transformer models are
-- typically used with cosine similarity.
CREATE INDEX IF NOT EXISTS idx_episodic_memories_embedding
  ON memory.episodic_memories
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
