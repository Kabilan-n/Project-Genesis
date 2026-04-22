-- Project Genesis - Phase 3: Cultural & Knowledge Layer
-- Adds: agent knowledge base, skill teaching log, gossip/reputation, groups

-- ============================================================
-- KNOWLEDGE: What each agent knows
-- ============================================================

CREATE TABLE IF NOT EXISTS memory.agent_knowledge (
  knowledge_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id      UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  world_id      UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  fact_key      VARCHAR(100) NOT NULL,   -- e.g. 'water_source_at_12_8', 'food_forest_north'
  fact_value    TEXT NOT NULL,           -- e.g. 'x=12,y=8 has water node with ~200 units'
  confidence    FLOAT NOT NULL DEFAULT 1.0 CHECK (confidence BETWEEN 0 AND 1),
  source_agent_id UUID REFERENCES agents.agents(agent_id) ON DELETE SET NULL,
  learned_tick  BIGINT NOT NULL DEFAULT 0,
  times_shared  INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id, fact_key)
);

CREATE INDEX IF NOT EXISTS idx_knowledge_agent ON memory.agent_knowledge(agent_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_world ON memory.agent_knowledge(world_id);

-- ============================================================
-- KNOWLEDGE: Skill teaching events log
-- ============================================================

CREATE TABLE IF NOT EXISTS agents.skill_teachings (
  teaching_id   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id      UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  teacher_id    UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  skill_name    VARCHAR(50) NOT NULL,
  xp_transferred FLOAT NOT NULL DEFAULT 0,
  teacher_level  SMALLINT NOT NULL,
  student_level_before SMALLINT NOT NULL,
  student_level_after  SMALLINT NOT NULL,
  tick          BIGINT NOT NULL,
  day           INT NOT NULL,
  conversation_id UUID REFERENCES social.conversations(conversation_id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_teachings_teacher ON agents.skill_teachings(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teachings_student  ON agents.skill_teachings(student_id);

-- ============================================================
-- SOCIAL: Reputation — world-wide opinion of each agent
-- ============================================================

CREATE TABLE IF NOT EXISTS social.reputation (
  agent_id        UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  world_id        UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  -- Aggregate opinion scores (0-100, 50=neutral)
  trustworthiness FLOAT NOT NULL DEFAULT 50 CHECK (trustworthiness BETWEEN 0 AND 100),
  generosity      FLOAT NOT NULL DEFAULT 50 CHECK (generosity BETWEEN 0 AND 100),
  skill_renown    FLOAT NOT NULL DEFAULT 10 CHECK (skill_renown BETWEEN 0 AND 100),
  danger_level    FLOAT NOT NULL DEFAULT 0  CHECK (danger_level BETWEEN 0 AND 100),
  -- Running counts used to compute weighted averages
  total_reports   INT NOT NULL DEFAULT 0,
  positive_reports INT NOT NULL DEFAULT 0,
  negative_reports INT NOT NULL DEFAULT 0,
  last_updated_tick BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, world_id)
);

CREATE INDEX IF NOT EXISTS idx_reputation_world ON social.reputation(world_id);

-- ============================================================
-- SOCIAL: Gossip events — track what was said about whom
-- ============================================================

CREATE TABLE IF NOT EXISTS social.gossip_events (
  gossip_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id        UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  gossiper_id     UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  listener_id     UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  subject_id      UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  -- What was said ('trustworthy', 'dangerous', 'skilled', 'generous', 'deceptive', 'weak')
  claim           VARCHAR(30) NOT NULL
    CHECK (claim IN ('trustworthy','dangerous','skilled','generous','deceptive','weak','heroic','cruel')),
  -- Listener's reaction
  believed        BOOLEAN NOT NULL DEFAULT TRUE,
  trust_change_subject FLOAT NOT NULL DEFAULT 0,  -- how listener's trust of subject changed
  tick            BIGINT NOT NULL,
  day             INT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gossip_world    ON social.gossip_events(world_id, tick DESC);
CREATE INDEX IF NOT EXISTS idx_gossip_subject  ON social.gossip_events(subject_id);
CREATE INDEX IF NOT EXISTS idx_gossip_gossiper ON social.gossip_events(gossiper_id);

-- ============================================================
-- SOCIAL: Groups / Tribes
-- ============================================================

CREATE TABLE IF NOT EXISTS social.groups (
  group_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id      UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,
  purpose       TEXT,                    -- shared goal / reason for existence
  founder_id    UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  leader_id     UUID REFERENCES agents.agents(agent_id) ON DELETE SET NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disbanded', 'merging')),
  -- Home territory (optional — center of claimed region)
  territory_x   SMALLINT,
  territory_y   SMALLINT,
  territory_radius SMALLINT DEFAULT 5,
  -- Collective values (emerge over time from member traits)
  shared_values JSONB NOT NULL DEFAULT '{}',
  -- Colour for map rendering (hex string, auto-assigned)
  colour        VARCHAR(7) NOT NULL DEFAULT '#6366f1',
  formed_tick   BIGINT NOT NULL DEFAULT 0,
  formed_day    INT NOT NULL DEFAULT 0,
  disbanded_tick BIGINT,
  member_count  INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_groups_world ON social.groups(world_id);

CREATE TABLE IF NOT EXISTS social.group_members (
  group_id    UUID NOT NULL REFERENCES social.groups(group_id) ON DELETE CASCADE,
  agent_id    UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  role        VARCHAR(30) NOT NULL DEFAULT 'member'
    CHECK (role IN ('founder', 'leader', 'elder', 'member', 'recruit')),
  joined_tick BIGINT NOT NULL DEFAULT 0,
  joined_day  INT NOT NULL DEFAULT 0,
  contribution_score FLOAT NOT NULL DEFAULT 0, -- effort/resources contributed
  PRIMARY KEY (group_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_group_members_agent ON social.group_members(agent_id);

-- ============================================================
-- Add group membership to agent state view context
-- ============================================================

-- Track which group an agent currently belongs to (denormalised for fast lookup)
ALTER TABLE agents.agents
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES social.groups(group_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agents_group ON agents.agents(group_id);

-- ============================================================
-- EVENTS: New Phase 3 event types (existing events.events table covers these,
-- but add a composite index for cultural event queries)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_events_type ON events.events(world_id, event_type, tick DESC);
