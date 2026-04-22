-- Project Genesis - Phase 6: Belief Systems & Collective Memory
-- Adds: belief systems, agent beliefs, myths, agent myths, rituals, sacred sites

-- ============================================================
-- CULTURE SCHEMA
-- ============================================================

CREATE SCHEMA IF NOT EXISTS culture;

-- ── Belief Systems ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS culture.belief_systems (
  belief_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id              UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  name                  VARCHAR(100) NOT NULL,
  founder_id            UUID REFERENCES agents.agents(agent_id) ON DELETE SET NULL,
  core_tenet            TEXT NOT NULL,       -- foundational claim, e.g. "strength is virtue"
  secondary_tenets      JSONB NOT NULL DEFAULT '[]',
  -- Behavioral prescriptions derived from tenet text + founder traits
  prescribes_aggression BOOLEAN NOT NULL DEFAULT FALSE,
  prescribes_sharing    BOOLEAN NOT NULL DEFAULT FALSE,
  prescribes_isolation  BOOLEAN NOT NULL DEFAULT FALSE,
  prescribes_ritual     BOOLEAN NOT NULL DEFAULT TRUE,
  adherent_count        INT NOT NULL DEFAULT 0,
  colour                VARCHAR(7) NOT NULL DEFAULT '#a78bfa',  -- violet default
  founded_tick          BIGINT NOT NULL,
  founded_day           INT NOT NULL,
  is_extinct            BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_beliefs_world ON culture.belief_systems(world_id);

-- ── Agent Beliefs ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS culture.agent_beliefs (
  agent_id              UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  belief_id             UUID NOT NULL REFERENCES culture.belief_systems(belief_id) ON DELETE CASCADE,
  conviction            FLOAT NOT NULL DEFAULT 0.5 CHECK (conviction BETWEEN 0 AND 1),
  personal_interpretation TEXT,
  adopted_tick          BIGINT NOT NULL,
  adopted_day           INT NOT NULL,
  converted_from_agent_id UUID REFERENCES agents.agents(agent_id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agent_id, belief_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_beliefs_agent  ON culture.agent_beliefs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_beliefs_belief ON culture.agent_beliefs(belief_id);

-- ── Myths ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS culture.myths (
  myth_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id          UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  author_id         UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  source_event_id   UUID REFERENCES events.events(event_id) ON DELETE SET NULL,
  belief_id         UUID REFERENCES culture.belief_systems(belief_id) ON DELETE SET NULL,
  title             VARCHAR(200) NOT NULL,
  narrative         TEXT NOT NULL,      -- LLM-generated mythologized retelling
  moral_lesson      VARCHAR(200),
  spread_count      INT NOT NULL DEFAULT 0,
  believability     FLOAT NOT NULL DEFAULT 0.5 CHECK (believability BETWEEN 0 AND 1),
  created_tick      BIGINT NOT NULL,
  created_day       INT NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_myths_world  ON culture.myths(world_id, spread_count DESC);
CREATE INDEX IF NOT EXISTS idx_myths_author ON culture.myths(author_id);

-- ── Agent Myths (who knows which myths, in what version) ──────

CREATE TABLE IF NOT EXISTS culture.agent_myths (
  agent_id          UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  myth_id           UUID NOT NULL REFERENCES culture.myths(myth_id) ON DELETE CASCADE,
  local_version     TEXT,          -- agent's personal retelling (may drift from original)
  fidelity          FLOAT NOT NULL DEFAULT 1.0 CHECK (fidelity BETWEEN 0 AND 1),
  learned_from_id   UUID REFERENCES agents.agents(agent_id) ON DELETE SET NULL,
  learned_tick      BIGINT NOT NULL,
  PRIMARY KEY (agent_id, myth_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_myths_agent ON culture.agent_myths(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_myths_myth  ON culture.agent_myths(myth_id);

-- ── Rituals ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS culture.rituals (
  ritual_id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id              UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  belief_id             UUID NOT NULL REFERENCES culture.belief_systems(belief_id) ON DELETE CASCADE,
  group_id              UUID REFERENCES social.groups(group_id) ON DELETE SET NULL,
  name                  VARCHAR(100) NOT NULL,
  description           TEXT,
  trigger_type          VARCHAR(30) NOT NULL DEFAULT 'daily'
                          CHECK (trigger_type IN ('daily','weekly','on_war','on_death','manual')),
  resource_cost         JSONB NOT NULL DEFAULT '{}',   -- {food: 5, water: 2}
  esteem_gain           FLOAT NOT NULL DEFAULT 5,
  belonging_gain        FLOAT NOT NULL DEFAULT 5,
  conviction_gain       FLOAT NOT NULL DEFAULT 0.05,
  last_performed_tick   BIGINT NOT NULL DEFAULT 0,
  times_performed       INT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rituals_belief ON culture.rituals(belief_id);
CREATE INDEX IF NOT EXISTS idx_rituals_world  ON culture.rituals(world_id);

-- ── Sacred Sites ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS culture.sacred_sites (
  site_id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id                  UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  belief_id                 UUID NOT NULL REFERENCES culture.belief_systems(belief_id) ON DELETE CASCADE,
  x                         SMALLINT NOT NULL,
  y                         SMALLINT NOT NULL,
  name                      VARCHAR(100),
  reason                    TEXT,
  pilgrimage_bonus_esteem   FLOAT NOT NULL DEFAULT 15,
  pilgrimage_bonus_hp       FLOAT NOT NULL DEFAULT 5,
  visit_count               INT NOT NULL DEFAULT 0,
  created_tick              BIGINT NOT NULL,
  created_day               INT NOT NULL,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (world_id, x, y, belief_id)
);

CREATE INDEX IF NOT EXISTS idx_sacred_sites_world ON culture.sacred_sites(world_id, x, y);
CREATE INDEX IF NOT EXISTS idx_sacred_sites_belief ON culture.sacred_sites(belief_id);

-- ============================================================
-- AUGMENT EXISTING TABLES
-- ============================================================

ALTER TABLE agents.agents
  ADD COLUMN IF NOT EXISTS primary_belief_id UUID
    REFERENCES culture.belief_systems(belief_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agents_belief ON agents.agents(primary_belief_id)
  WHERE primary_belief_id IS NOT NULL;
