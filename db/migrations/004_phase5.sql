-- Project Genesis - Phase 5: Governance & Conflict
-- Adds: wars, skirmishes, treaties, leadership events, exile state

-- ============================================================
-- CONFLICT SCHEMA
-- ============================================================

CREATE SCHEMA IF NOT EXISTS conflict;

-- ── Wars ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conflict.wars (
  war_id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id            UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  aggressor_group_id  UUID NOT NULL REFERENCES social.groups(group_id) ON DELETE CASCADE,
  defender_group_id   UUID NOT NULL REFERENCES social.groups(group_id) ON DELETE CASCADE,
  status              VARCHAR(20) NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'ceasefire', 'ended')),
  declared_tick       BIGINT NOT NULL,
  declared_day        INT NOT NULL,
  ended_tick          BIGINT,
  ended_day           INT,
  outcome             VARCHAR(30),   -- 'aggressor_victory','defender_victory','draw','treaty'
  casualties_aggressor INT NOT NULL DEFAULT 0,
  casualties_defender  INT NOT NULL DEFAULT 0,
  resources_looted    JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wars_world   ON conflict.wars(world_id, status);
CREATE INDEX IF NOT EXISTS idx_wars_groups  ON conflict.wars(aggressor_group_id, defender_group_id);

-- ── Skirmishes ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conflict.skirmishes (
  skirmish_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id              UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  war_id                UUID REFERENCES conflict.wars(war_id) ON DELETE SET NULL,
  attacker_id           UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  defender_id           UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  attacker_group_id     UUID REFERENCES social.groups(group_id) ON DELETE SET NULL,
  defender_group_id     UUID REFERENCES social.groups(group_id) ON DELETE SET NULL,
  location_x            SMALLINT NOT NULL,
  location_y            SMALLINT NOT NULL,
  tick                  BIGINT NOT NULL,
  day                   INT NOT NULL,
  outcome               VARCHAR(20) NOT NULL
                          CHECK (outcome IN ('attacker_won','defender_won','fled','interrupted')),
  hp_damage_attacker    FLOAT NOT NULL DEFAULT 0,
  hp_damage_defender    FLOAT NOT NULL DEFAULT 0,
  attacker_power        FLOAT NOT NULL DEFAULT 0,   -- computed combat score for this skirmish
  defender_power        FLOAT NOT NULL DEFAULT 0,
  resources_stolen      JSONB NOT NULL DEFAULT '{}',
  event_id              UUID REFERENCES events.events(event_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skirmishes_world    ON conflict.skirmishes(world_id, tick DESC);
CREATE INDEX IF NOT EXISTS idx_skirmishes_attacker ON conflict.skirmishes(attacker_id);
CREATE INDEX IF NOT EXISTS idx_skirmishes_defender ON conflict.skirmishes(defender_id);
CREATE INDEX IF NOT EXISTS idx_skirmishes_war      ON conflict.skirmishes(war_id);

-- ── Treaties ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conflict.treaties (
  treaty_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id            UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  group_a_id          UUID NOT NULL REFERENCES social.groups(group_id) ON DELETE CASCADE,
  group_b_id          UUID NOT NULL REFERENCES social.groups(group_id) ON DELETE CASCADE,
  treaty_type         VARCHAR(30) NOT NULL
                        CHECK (treaty_type IN ('non_aggression','resource_sharing','alliance','vassalage')),
  terms               JSONB NOT NULL DEFAULT '{}',
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','active','broken','expired')),
  proposed_tick       BIGINT NOT NULL,
  proposed_day        INT NOT NULL,
  ratified_tick       BIGINT,
  ratified_day        INT,
  expires_tick        BIGINT,         -- NULL = indefinite
  broken_by_group_id  UUID REFERENCES social.groups(group_id) ON DELETE SET NULL,
  proposer_group_id   UUID NOT NULL REFERENCES social.groups(group_id) ON DELETE CASCADE,
  event_id            UUID REFERENCES events.events(event_id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_treaties_world  ON conflict.treaties(world_id, status);
CREATE INDEX IF NOT EXISTS idx_treaties_groups ON conflict.treaties(group_a_id, group_b_id);

-- ── Leadership Events ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conflict.leadership_events (
  leadership_event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id            UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  group_id            UUID NOT NULL REFERENCES social.groups(group_id) ON DELETE CASCADE,
  challenger_id       UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  incumbent_id        UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  mechanism           VARCHAR(20) NOT NULL
                        CHECK (mechanism IN ('vote','intimidation','demonstration')),
  outcome             VARCHAR(20) NOT NULL
                        CHECK (outcome IN ('challenger_wins','incumbent_wins','split')),
  votes_challenger    INT NOT NULL DEFAULT 0,
  votes_incumbent     INT NOT NULL DEFAULT 0,
  tick                BIGINT NOT NULL,
  day                 INT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leadership_group ON conflict.leadership_events(group_id, tick DESC);

-- ============================================================
-- AUGMENT EXISTING TABLES
-- ============================================================

-- Agents: exile state
ALTER TABLE agents.agents
  ADD COLUMN IF NOT EXISTS is_exiled    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS exiled_from  UUID REFERENCES social.groups(group_id) ON DELETE SET NULL;

-- Groups: war tracking
ALTER TABLE social.groups
  ADD COLUMN IF NOT EXISTS at_war_with  UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS war_score    INT NOT NULL DEFAULT 0;

-- Index for war lookup
CREATE INDEX IF NOT EXISTS idx_agents_exiled ON agents.agents(is_exiled) WHERE is_exiled = TRUE;
