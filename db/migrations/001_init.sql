-- Project Genesis - Phase 1 Database Schema
-- PostgreSQL 16 with pgvector extension

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ============================================================
-- AUTH SCHEMA
-- ============================================================
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS worlds;
CREATE SCHEMA IF NOT EXISTS agents;
CREATE SCHEMA IF NOT EXISTS social;
CREATE SCHEMA IF NOT EXISTS economy;
CREATE SCHEMA IF NOT EXISTS events;
CREATE SCHEMA IF NOT EXISTS memory;

-- Users
CREATE TABLE auth.users (
  user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL UNIQUE,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'deleted', 'pending_verification')),
  subscription_tier VARCHAR(20) NOT NULL DEFAULT 'free'
    CHECK (subscription_tier IN ('free', 'basic', 'premium', 'enterprise')),
  settings JSONB NOT NULL DEFAULT '{}',
  agents_created_count INT NOT NULL DEFAULT 0,
  agents_alive_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sessions
CREATE TABLE auth.sessions (
  session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(user_id) ON DELETE CASCADE,
  refresh_token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Onboarding sessions (transient agent creation state)
CREATE TABLE auth.onboarding_sessions (
  session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(user_id) ON DELETE CASCADE,
  world_id UUID, -- set after world is chosen
  mode VARCHAR(20) NOT NULL DEFAULT 'discover'
    CHECK (mode IN ('discover', 'design', 'random')),
  answers JSONB NOT NULL DEFAULT '[]',
  accumulated_traits JSONB NOT NULL DEFAULT '{}',
  name VARCHAR(100),
  appearance JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- WORLDS SCHEMA
-- ============================================================

CREATE TABLE worlds.worlds (
  world_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'initializing'
    CHECK (status IN ('active', 'paused', 'archived', 'initializing')),
  config JSONB NOT NULL DEFAULT '{
    "map_size": 50,
    "time_scale": 1,
    "scarcity_level": "moderate",
    "max_agents": 100
  }',
  current_tick BIGINT NOT NULL DEFAULT 0,
  current_day INT NOT NULL GENERATED ALWAYS AS (current_tick / 1440) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE worlds.map_tiles (
  world_id UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  x SMALLINT NOT NULL,
  y SMALLINT NOT NULL,
  terrain VARCHAR(30) NOT NULL DEFAULT 'grassland'
    CHECK (terrain IN ('water', 'forest', 'mountain', 'grassland', 'desert', 'swamp')),
  is_passable BOOLEAN NOT NULL DEFAULT TRUE,
  resources JSONB NOT NULL DEFAULT '{}',
  claimed_by_agent_id UUID,
  region_id UUID,
  PRIMARY KEY (world_id, x, y)
);

CREATE TABLE worlds.resource_nodes (
  node_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  x SMALLINT NOT NULL,
  y SMALLINT NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  current_amount FLOAT NOT NULL DEFAULT 100,
  max_capacity FLOAT NOT NULL DEFAULT 100,
  extraction_rate FLOAT NOT NULL DEFAULT 5.0,
  regen_rate FLOAT NOT NULL DEFAULT 0.5,
  is_depleted BOOLEAN NOT NULL DEFAULT FALSE,
  last_extracted_tick BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_resource_nodes_world ON worlds.resource_nodes(world_id);
CREATE INDEX idx_resource_nodes_location ON worlds.resource_nodes(world_id, x, y);

-- ============================================================
-- AGENTS SCHEMA
-- ============================================================

CREATE TABLE agents.agents (
  agent_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES auth.users(user_id),
  created_by_reproduction BOOLEAN NOT NULL DEFAULT FALSE,
  parent_agent_ids UUID[] NOT NULL DEFAULT '{}',
  name VARCHAR(100) NOT NULL,
  archetype VARCHAR(100),
  appearance JSONB NOT NULL DEFAULT '{}',
  status VARCHAR(20) NOT NULL DEFAULT 'alive'
    CHECK (status IN ('alive', 'dead', 'archived')),
  birth_tick BIGINT NOT NULL DEFAULT 0,
  death_tick BIGINT,
  generation INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agents_world ON agents.agents(world_id);
CREATE INDEX idx_agents_status ON agents.agents(world_id, status);

CREATE TABLE agents.agent_traits (
  agent_id UUID PRIMARY KEY REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  -- Temperament
  optimism SMALLINT NOT NULL DEFAULT 50 CHECK (optimism BETWEEN 0 AND 100),
  resilience SMALLINT NOT NULL DEFAULT 50 CHECK (resilience BETWEEN 0 AND 100),
  impulsivity SMALLINT NOT NULL DEFAULT 50 CHECK (impulsivity BETWEEN 0 AND 100),
  -- Social
  extraversion SMALLINT NOT NULL DEFAULT 50 CHECK (extraversion BETWEEN 0 AND 100),
  empathy SMALLINT NOT NULL DEFAULT 50 CHECK (empathy BETWEEN 0 AND 100),
  trust_default SMALLINT NOT NULL DEFAULT 50 CHECK (trust_default BETWEEN 0 AND 100),
  -- Cognitive
  curiosity SMALLINT NOT NULL DEFAULT 50 CHECK (curiosity BETWEEN 0 AND 100),
  analytical SMALLINT NOT NULL DEFAULT 50 CHECK (analytical BETWEEN 0 AND 100),
  creativity SMALLINT NOT NULL DEFAULT 50 CHECK (creativity BETWEEN 0 AND 100),
  -- Moral
  fairness SMALLINT NOT NULL DEFAULT 50 CHECK (fairness BETWEEN 0 AND 100),
  loyalty SMALLINT NOT NULL DEFAULT 50 CHECK (loyalty BETWEEN 0 AND 100),
  authority_respect SMALLINT NOT NULL DEFAULT 50 CHECK (authority_respect BETWEEN 0 AND 100),
  -- Survival
  ambition SMALLINT NOT NULL DEFAULT 50 CHECK (ambition BETWEEN 0 AND 100),
  aggression SMALLINT NOT NULL DEFAULT 50 CHECK (aggression BETWEEN 0 AND 100),
  self_preservation SMALLINT NOT NULL DEFAULT 50 CHECK (self_preservation BETWEEN 0 AND 100),
  -- Insecurities
  fear_of_rejection SMALLINT NOT NULL DEFAULT 30 CHECK (fear_of_rejection BETWEEN 0 AND 100),
  scarcity_anxiety SMALLINT NOT NULL DEFAULT 30 CHECK (scarcity_anxiety BETWEEN 0 AND 100),
  status_obsession SMALLINT NOT NULL DEFAULT 30 CHECK (status_obsession BETWEEN 0 AND 100),
  -- Computed
  leadership_tendency SMALLINT NOT NULL DEFAULT 50 CHECK (leadership_tendency BETWEEN 0 AND 100),
  -- History of trait changes
  trait_history JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE agents.agent_state (
  agent_id UUID PRIMARY KEY REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  hp FLOAT NOT NULL DEFAULT 100 CHECK (hp >= 0 AND hp <= 100),
  position_x SMALLINT NOT NULL DEFAULT 25,
  position_y SMALLINT NOT NULL DEFAULT 25,
  -- Physiological needs (0-100, 100=fully satisfied)
  need_food FLOAT NOT NULL DEFAULT 80,
  need_water FLOAT NOT NULL DEFAULT 80,
  need_rest FLOAT NOT NULL DEFAULT 100,
  -- Higher needs (0-100)
  need_belonging FLOAT NOT NULL DEFAULT 50,
  need_esteem FLOAT NOT NULL DEFAULT 50,
  need_actualization FLOAT NOT NULL DEFAULT 30,
  -- Cognitive state
  current_activity VARCHAR(50) NOT NULL DEFAULT 'idle',
  mental_state VARCHAR(30) NOT NULL DEFAULT 'content'
    CHECK (mental_state IN ('alert', 'tired', 'stressed', 'desperate', 'flow', 'depressed', 'manic', 'content')),
  current_goal TEXT,
  is_awake BOOLEAN NOT NULL DEFAULT TRUE,
  last_updated_tick BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE agents.agent_skills (
  agent_id UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  skill_name VARCHAR(50) NOT NULL,
  level SMALLINT NOT NULL DEFAULT 1 CHECK (level BETWEEN 0 AND 100),
  xp FLOAT NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, skill_name)
);

-- ============================================================
-- SOCIAL SCHEMA
-- ============================================================

CREATE TABLE social.relationships (
  agent_id UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  other_agent_id UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  trust_score SMALLINT NOT NULL DEFAULT 10 CHECK (trust_score BETWEEN 0 AND 100),
  affection_score SMALLINT NOT NULL DEFAULT 10 CHECK (affection_score BETWEEN 0 AND 100),
  respect_score SMALLINT NOT NULL DEFAULT 10 CHECK (respect_score BETWEEN 0 AND 100),
  fear_score SMALLINT NOT NULL DEFAULT 0 CHECK (fear_score BETWEEN 0 AND 100),
  relationship_type VARCHAR(30) NOT NULL DEFAULT 'stranger'
    CHECK (relationship_type IN ('stranger', 'acquaintance', 'friend', 'close_friend', 'romantic_partner', 'rival', 'enemy', 'family')),
  beliefs JSONB NOT NULL DEFAULT '{}',
  history JSONB NOT NULL DEFAULT '[]',
  last_interaction_tick BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, other_agent_id)
);

-- ============================================================
-- ECONOMY SCHEMA
-- ============================================================

CREATE TABLE economy.inventory (
  agent_id UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  resource_type VARCHAR(50) NOT NULL,
  amount FLOAT NOT NULL DEFAULT 0,
  quality FLOAT NOT NULL DEFAULT 1.0 CHECK (quality BETWEEN 0 AND 1),
  expires_tick BIGINT,
  acquired_method VARCHAR(30) NOT NULL DEFAULT 'gathered'
    CHECK (acquired_method IN ('gathered', 'crafted', 'traded', 'stolen', 'given', 'initial')),
  PRIMARY KEY (agent_id, resource_type)
);

-- ============================================================
-- MEMORY SCHEMA
-- ============================================================

CREATE TABLE memory.episodic_memories (
  memory_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  tick BIGINT NOT NULL,
  day INT NOT NULL,
  summary VARCHAR(500) NOT NULL,
  full_content TEXT,
  emotional_valence FLOAT NOT NULL DEFAULT 0 CHECK (emotional_valence BETWEEN -1 AND 1),
  emotional_intensity FLOAT NOT NULL DEFAULT 0.5 CHECK (emotional_intensity BETWEEN 0 AND 1),
  importance FLOAT NOT NULL DEFAULT 0.5 CHECK (importance BETWEEN 0 AND 1),
  current_strength FLOAT NOT NULL DEFAULT 1.0 CHECK (current_strength BETWEEN 0 AND 1),
  tags VARCHAR(50)[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_episodic_memories_agent ON memory.episodic_memories(agent_id);
CREATE INDEX idx_episodic_memories_importance ON memory.episodic_memories(agent_id, importance DESC);

-- ============================================================
-- EVENTS SCHEMA
-- ============================================================

CREATE TABLE events.events (
  event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  tick BIGINT NOT NULL,
  day INT NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  significance VARCHAR(20) NOT NULL DEFAULT 'minor'
    CHECK (significance IN ('trivial', 'minor', 'moderate', 'major', 'historic')),
  title VARCHAR(200) NOT NULL,
  summary TEXT,
  participant_agent_ids UUID[] NOT NULL DEFAULT '{}',
  location_x SMALLINT,
  location_y SMALLINT,
  consequences JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_world ON events.events(world_id);
CREATE INDEX idx_events_tick ON events.events(world_id, tick DESC);
CREATE INDEX idx_events_significance ON events.events(world_id, significance);

-- ============================================================
-- HELPFUL VIEWS
-- ============================================================

CREATE VIEW agents.alive_agents AS
  SELECT a.*, s.hp, s.position_x, s.position_y, s.need_food, s.need_water,
         s.need_rest, s.mental_state, s.current_activity, s.current_goal, s.is_awake
  FROM agents.agents a
  JOIN agents.agent_state s ON a.agent_id = s.agent_id
  WHERE a.status = 'alive';
