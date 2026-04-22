-- Project Genesis - Phase 6 Observer Enrichment
-- Adds: timeline snapshots, family tree, heatmap data, biography cache,
--       multi-world session support, spectator interventions

-- ============================================================
-- OBSERVER SCHEMA
-- ============================================================

CREATE SCHEMA IF NOT EXISTS observer;

-- ── World Timeline Snapshots ──────────────────────────────────
-- Periodic snapshots of world state for the timeline scrubber

CREATE TABLE IF NOT EXISTS observer.world_snapshots (
  snapshot_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id        UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  tick            BIGINT NOT NULL,
  day             INT NOT NULL,
  time_of_day     VARCHAR(20) NOT NULL,
  agent_count     INT NOT NULL,
  alive_agents    JSONB NOT NULL DEFAULT '[]',  -- [{agent_id, name, x, y, hp, group_id, belief_id}]
  group_states    JSONB NOT NULL DEFAULT '[]',  -- [{group_id, name, member_count, at_war_with}]
  active_wars     JSONB NOT NULL DEFAULT '[]',  -- [{war_id, aggressor, defender, status}]
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (world_id, tick)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_world ON observer.world_snapshots(world_id, tick DESC);

-- ── Heatmap Aggregates ────────────────────────────────────────
-- Pre-aggregated per-tile data for map overlays (updated each day)

CREATE TABLE IF NOT EXISTS observer.heatmap_data (
  world_id        UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  x               SMALLINT NOT NULL,
  y               SMALLINT NOT NULL,
  day             INT NOT NULL,
  -- Population density: total agent-ticks spent on this tile
  population_ticks   BIGINT NOT NULL DEFAULT 0,
  -- Resource pressure: how often the node was extracted from
  extraction_count   INT NOT NULL DEFAULT 0,
  -- Conflict: skirmishes that occurred here
  skirmish_count     INT NOT NULL DEFAULT 0,
  -- Culture: ritual/pilgrimage visits
  ritual_count       INT NOT NULL DEFAULT 0,
  PRIMARY KEY (world_id, x, y, day)
);

CREATE INDEX IF NOT EXISTS idx_heatmap_world_day ON observer.heatmap_data(world_id, day DESC);

-- ── Agent Biographies ─────────────────────────────────────────
-- Cached LLM-generated life stories; regenerated on request

CREATE TABLE IF NOT EXISTS observer.agent_biographies (
  biography_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id        UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  agent_id        UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  narrative       TEXT NOT NULL,     -- LLM-written biography
  generated_tick  BIGINT NOT NULL,
  word_count      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (agent_id)  -- one bio per agent, updated on re-request
);

CREATE INDEX IF NOT EXISTS idx_biographies_world ON observer.agent_biographies(world_id);
CREATE INDEX IF NOT EXISTS idx_biographies_agent ON observer.agent_biographies(agent_id);

-- ── Family Trees ──────────────────────────────────────────────
-- Agent lineage graph edges (parent → child)

CREATE TABLE IF NOT EXISTS observer.lineage (
  child_agent_id  UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  parent_agent_id UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  relationship    VARCHAR(20) NOT NULL DEFAULT 'child'
                    CHECK (relationship IN ('child','adopted','mentored')),
  PRIMARY KEY (child_agent_id, parent_agent_id)
);

CREATE INDEX IF NOT EXISTS idx_lineage_parent ON observer.lineage(parent_agent_id);
CREATE INDEX IF NOT EXISTS idx_lineage_child  ON observer.lineage(child_agent_id);

-- ── Statistics Timeseries ─────────────────────────────────────
-- Per-tick global world stats for graphs

CREATE TABLE IF NOT EXISTS observer.world_stats (
  world_id        UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  tick            BIGINT NOT NULL,
  day             INT NOT NULL,
  alive_count     INT NOT NULL DEFAULT 0,
  dead_count      INT NOT NULL DEFAULT 0,
  avg_hp          FLOAT NOT NULL DEFAULT 0,
  avg_food        FLOAT NOT NULL DEFAULT 0,
  avg_water       FLOAT NOT NULL DEFAULT 0,
  avg_belonging   FLOAT NOT NULL DEFAULT 0,
  group_count     INT NOT NULL DEFAULT 0,
  war_count       INT NOT NULL DEFAULT 0,
  belief_count    INT NOT NULL DEFAULT 0,
  structure_count INT NOT NULL DEFAULT 0,
  market_count    INT NOT NULL DEFAULT 0,
  PRIMARY KEY (world_id, tick)
);

CREATE INDEX IF NOT EXISTS idx_world_stats_day ON observer.world_stats(world_id, day DESC);

-- Keep last 10,000 ticks of stats per world (older rows auto-pruned via trigger or app logic)

-- ── Spectator Interventions ───────────────────────────────────

CREATE TABLE IF NOT EXISTS observer.interventions (
  intervention_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id        UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  user_id         UUID REFERENCES auth.users(user_id) ON DELETE SET NULL,
  intervention_type VARCHAR(30) NOT NULL
                    CHECK (intervention_type IN ('drop_resource','trigger_weather','spawn_agent','gift_tech','natural_disaster')),
  parameters      JSONB NOT NULL DEFAULT '{}',
  -- e.g. {resource_type: "food", amount: 100, x: 25, y: 25}
  -- or   {weather_type: "drought", duration_ticks: 720, radius: 10, x: 20, y: 20}
  applied_tick    BIGINT NOT NULL,
  applied_day     INT NOT NULL,
  applied         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interventions_world ON observer.interventions(world_id, applied);
CREATE INDEX IF NOT EXISTS idx_interventions_user  ON observer.interventions(user_id);

-- ── Weather Events (triggered by interventions or natural) ────

CREATE TABLE IF NOT EXISTS observer.weather_events (
  weather_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id        UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  weather_type    VARCHAR(30) NOT NULL
                    CHECK (weather_type IN ('drought','flood','storm','blight','abundance')),
  center_x        SMALLINT NOT NULL,
  center_y        SMALLINT NOT NULL,
  radius          SMALLINT NOT NULL DEFAULT 10,
  started_tick    BIGINT NOT NULL,
  ends_tick       BIGINT NOT NULL,
  severity        FLOAT NOT NULL DEFAULT 0.5 CHECK (severity BETWEEN 0 AND 1),
  -- Effect multipliers
  resource_mult   FLOAT NOT NULL DEFAULT 1.0,  -- < 1 = scarcity, > 1 = abundance
  hp_drain_rate   FLOAT NOT NULL DEFAULT 0.0,  -- extra HP drain per tick
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weather_world ON observer.weather_events(world_id, is_active);

-- ============================================================
-- MULTI-WORLD SESSION SUPPORT
-- ============================================================

-- Track which worlds a user is watching (for multi-world UI)
CREATE TABLE IF NOT EXISTS observer.watched_worlds (
  user_id         UUID NOT NULL REFERENCES auth.users(user_id) ON DELETE CASCADE,
  world_id        UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  display_order   SMALLINT NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, world_id)
);

-- ============================================================
-- AUGMENT EXISTING TABLES
-- ============================================================

-- Track weather effects on resource nodes
ALTER TABLE worlds.resource_nodes
  ADD COLUMN IF NOT EXISTS weather_mult FLOAT NOT NULL DEFAULT 1.0;

-- Track agents' generation lineage for family tree
ALTER TABLE agents.agents
  ADD COLUMN IF NOT EXISTS parent_agent_id UUID REFERENCES agents.agents(agent_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents.agents(parent_agent_id) WHERE parent_agent_id IS NOT NULL;
