-- Project Genesis - Phase 2: Social Layer Schema
-- Adds: conversations, trades, memory decay support

-- ============================================================
-- SOCIAL: Full conversation transcripts
-- ============================================================

CREATE TABLE social.conversations (
  conversation_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  tick BIGINT NOT NULL,
  day INT NOT NULL,
  initiator_agent_id UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  target_agent_id UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  location_x SMALLINT,
  location_y SMALLINT,
  topic VARCHAR(200),
  -- Array of {speaker_id, speaker_name, message, thought, turn_number}
  turns JSONB NOT NULL DEFAULT '[]',
  -- Overall tone of the conversation
  outcome VARCHAR(20) NOT NULL DEFAULT 'neutral'
    CHECK (outcome IN ('friendly', 'hostile', 'neutral', 'reconciliation', 'conflict', 'bonding')),
  -- Relationship delta applied after conversation: {agent_id: {trust, affection, respect, fear}}
  relationship_changes JSONB NOT NULL DEFAULT '{}',
  -- Link back to events table for feed visibility
  event_id UUID REFERENCES events.events(event_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_conversations_world     ON social.conversations(world_id, tick DESC);
CREATE INDEX idx_conversations_initiator ON social.conversations(initiator_agent_id);
CREATE INDEX idx_conversations_target    ON social.conversations(target_agent_id);

-- ============================================================
-- ECONOMY: Trade records
-- ============================================================

CREATE TABLE economy.trades (
  trade_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  tick BIGINT NOT NULL,
  day INT NOT NULL,
  offerer_agent_id UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  receiver_agent_id UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  -- What the offerer puts on the table: {resource_type: amount}
  offered_items JSONB NOT NULL DEFAULT '{}',
  -- What the offerer wants in return: {resource_type: amount}
  requested_items JSONB NOT NULL DEFAULT '{}',
  -- Counter-offer from receiver (null if straight accept/reject)
  counter_offer JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'rejected', 'countered', 'expired')),
  outcome_reason TEXT,
  event_id UUID REFERENCES events.events(event_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trades_world    ON economy.trades(world_id, tick DESC);
CREATE INDEX idx_trades_offerer  ON economy.trades(offerer_agent_id);
CREATE INDEX idx_trades_receiver ON economy.trades(receiver_agent_id);

-- ============================================================
-- MEMORY: Add decay index (current_strength already exists in 001)
-- ============================================================

-- Index for decay queries (find old weak memories efficiently)
CREATE INDEX IF NOT EXISTS idx_episodic_memories_decay
  ON memory.episodic_memories(agent_id, current_strength ASC, importance ASC);

-- ============================================================
-- SOCIAL: Track interaction count for relationship upgrades
-- ============================================================

ALTER TABLE social.relationships
  ADD COLUMN IF NOT EXISTS interaction_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS positive_interaction_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS negative_interaction_count INT NOT NULL DEFAULT 0;
