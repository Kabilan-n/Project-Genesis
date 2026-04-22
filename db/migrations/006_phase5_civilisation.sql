-- Project Genesis - Phase 5 Civilisation Layer
-- Adds: laws/enforcement, formal economy (currency+markets), construction,
--       technology tree, historical chronicle

-- ============================================================
-- CIVILISATION SCHEMA
-- ============================================================

CREATE SCHEMA IF NOT EXISTS civilisation;

-- ── Laws ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS civilisation.laws (
  law_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id        UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  group_id        UUID NOT NULL REFERENCES social.groups(group_id) ON DELETE CASCADE,
  name            VARCHAR(100) NOT NULL,
  description     TEXT NOT NULL,
  law_type        VARCHAR(30) NOT NULL
                    CHECK (law_type IN ('resource','behavior','territory','trade','belief')),
  penalty_type    VARCHAR(30) NOT NULL DEFAULT 'relationship'
                    CHECK (penalty_type IN ('relationship','exile','resource_fine','public_shame')),
  penalty_value   FLOAT NOT NULL DEFAULT 10,   -- magnitude of penalty
  votes_for       INT NOT NULL DEFAULT 0,
  votes_against   INT NOT NULL DEFAULT 0,
  status          VARCHAR(20) NOT NULL DEFAULT 'proposed'
                    CHECK (status IN ('proposed','active','repealed')),
  proposed_by     UUID REFERENCES agents.agents(agent_id) ON DELETE SET NULL,
  proposed_tick   BIGINT NOT NULL,
  enacted_tick    BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_laws_group ON civilisation.laws(group_id, status);
CREATE INDEX IF NOT EXISTS idx_laws_world ON civilisation.laws(world_id);

-- ── Law Violations ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS civilisation.law_violations (
  violation_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id        UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  law_id          UUID NOT NULL REFERENCES civilisation.laws(law_id) ON DELETE CASCADE,
  violator_id     UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  reporter_id     UUID REFERENCES agents.agents(agent_id) ON DELETE SET NULL,
  penalty_applied VARCHAR(30) NOT NULL,
  tick            BIGINT NOT NULL,
  day             INT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_violations_violator ON civilisation.law_violations(violator_id);
CREATE INDEX IF NOT EXISTS idx_violations_law      ON civilisation.law_violations(law_id);

-- ── Currency ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS civilisation.currencies (
  currency_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id        UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  group_id        UUID REFERENCES social.groups(group_id) ON DELETE SET NULL,  -- NULL = world currency
  name            VARCHAR(50) NOT NULL,
  symbol          VARCHAR(10) NOT NULL DEFAULT 'G',
  total_supply    BIGINT NOT NULL DEFAULT 0,
  created_tick    BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (world_id, name)
);

CREATE INDEX IF NOT EXISTS idx_currencies_world ON civilisation.currencies(world_id);

-- ── Agent Wallets ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS civilisation.wallets (
  agent_id        UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  currency_id     UUID NOT NULL REFERENCES civilisation.currencies(currency_id) ON DELETE CASCADE,
  balance         BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  total_earned    BIGINT NOT NULL DEFAULT 0,
  total_spent     BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, currency_id)
);

CREATE INDEX IF NOT EXISTS idx_wallets_agent    ON civilisation.wallets(agent_id);
CREATE INDEX IF NOT EXISTS idx_wallets_currency ON civilisation.wallets(currency_id);

-- ── Markets ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS civilisation.markets (
  market_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id        UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  group_id        UUID REFERENCES social.groups(group_id) ON DELETE SET NULL,
  x               SMALLINT NOT NULL,
  y               SMALLINT NOT NULL,
  name            VARCHAR(100) NOT NULL DEFAULT 'Market',
  is_open         BOOLEAN NOT NULL DEFAULT TRUE,
  transaction_count INT NOT NULL DEFAULT 0,
  created_tick    BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_markets_world ON civilisation.markets(world_id, x, y);

-- ── Market Listings ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS civilisation.market_listings (
  listing_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_id       UUID NOT NULL REFERENCES civilisation.markets(market_id) ON DELETE CASCADE,
  seller_id       UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  resource_type   VARCHAR(50) NOT NULL,
  quantity        INT NOT NULL CHECK (quantity > 0),
  price_per_unit  INT NOT NULL CHECK (price_per_unit > 0),  -- in base currency units
  currency_id     UUID NOT NULL REFERENCES civilisation.currencies(currency_id) ON DELETE CASCADE,
  listed_tick     BIGINT NOT NULL,
  expires_tick    BIGINT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listings_market   ON civilisation.market_listings(market_id, is_active);
CREATE INDEX IF NOT EXISTS idx_listings_resource ON civilisation.market_listings(resource_type, is_active);

-- ── Market Transactions ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS civilisation.market_transactions (
  tx_id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id        UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  market_id       UUID NOT NULL REFERENCES civilisation.markets(market_id) ON DELETE CASCADE,
  listing_id      UUID REFERENCES civilisation.market_listings(listing_id) ON DELETE SET NULL,
  buyer_id        UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  seller_id       UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  resource_type   VARCHAR(50) NOT NULL,
  quantity        INT NOT NULL,
  price_per_unit  INT NOT NULL,
  total_price     INT NOT NULL,
  tick            BIGINT NOT NULL,
  day             INT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_market ON civilisation.market_transactions(market_id, tick DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_buyer  ON civilisation.market_transactions(buyer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_seller ON civilisation.market_transactions(seller_id);

-- ── Price History (for discovery + UI graphs) ─────────────────

CREATE TABLE IF NOT EXISTS civilisation.price_history (
  world_id        UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  resource_type   VARCHAR(50) NOT NULL,
  day             INT NOT NULL,
  avg_price       FLOAT NOT NULL,
  min_price       INT NOT NULL,
  max_price       INT NOT NULL,
  volume          INT NOT NULL DEFAULT 0,
  PRIMARY KEY (world_id, resource_type, day)
);

-- ── Structures (Construction) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS civilisation.structures (
  structure_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id        UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  group_id        UUID REFERENCES social.groups(group_id) ON DELETE SET NULL,
  builder_id      UUID REFERENCES agents.agents(agent_id) ON DELETE SET NULL,
  x               SMALLINT NOT NULL,
  y               SMALLINT NOT NULL,
  structure_type  VARCHAR(30) NOT NULL
                    CHECK (structure_type IN ('shelter','farm','storage','watchtower','market_stall','temple','forge','library')),
  name            VARCHAR(100),
  hp              FLOAT NOT NULL DEFAULT 100 CHECK (hp BETWEEN 0 AND 100),
  capacity        INT,             -- storage capacity or farm yield boost
  bonus_json      JSONB NOT NULL DEFAULT '{}',  -- {food_yield_bonus: 0.2, rest_bonus: 10}
  build_progress  FLOAT NOT NULL DEFAULT 0 CHECK (build_progress BETWEEN 0 AND 1),
  is_complete     BOOLEAN NOT NULL DEFAULT FALSE,
  built_tick      BIGINT NOT NULL,
  built_day       INT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (world_id, x, y, structure_type)
);

CREATE INDEX IF NOT EXISTS idx_structures_world  ON civilisation.structures(world_id, x, y);
CREATE INDEX IF NOT EXISTS idx_structures_group  ON civilisation.structures(group_id);
CREATE INDEX IF NOT EXISTS idx_structures_type   ON civilisation.structures(world_id, structure_type);

-- ── Technologies ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS civilisation.technologies (
  tech_id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id        UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  group_id        UUID REFERENCES social.groups(group_id) ON DELETE SET NULL,
  name            VARCHAR(100) NOT NULL,
  description     TEXT,
  tech_tier       SMALLINT NOT NULL DEFAULT 1 CHECK (tech_tier BETWEEN 1 AND 5),
  -- skill prerequisites (must all be met by at least one group member)
  required_skills JSONB NOT NULL DEFAULT '[]',  -- [{skill: 'farming', min_level: 30}, ...]
  -- unlocks
  unlocks_actions VARCHAR[] NOT NULL DEFAULT '{}',  -- new action verbs unlocked
  unlocks_bonus   JSONB NOT NULL DEFAULT '{}',      -- {resource_yield: 1.5, build_speed: 1.2}
  discovered_by   UUID REFERENCES agents.agents(agent_id) ON DELETE SET NULL,
  discovered_tick BIGINT NOT NULL,
  discovered_day  INT NOT NULL,
  is_lost         BOOLEAN NOT NULL DEFAULT FALSE,  -- can be lost if discoverer dies and knowledge not shared
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (world_id, group_id, name)
);

CREATE INDEX IF NOT EXISTS idx_technologies_world ON civilisation.technologies(world_id);
CREATE INDEX IF NOT EXISTS idx_technologies_group ON civilisation.technologies(group_id);

-- ── Group Technologies (which groups have which techs) ────────

CREATE TABLE IF NOT EXISTS civilisation.group_technologies (
  group_id        UUID NOT NULL REFERENCES social.groups(group_id) ON DELETE CASCADE,
  tech_id         UUID NOT NULL REFERENCES civilisation.technologies(tech_id) ON DELETE CASCADE,
  adopted_tick    BIGINT NOT NULL,
  PRIMARY KEY (group_id, tech_id)
);

-- ── Historical Chronicle ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS civilisation.chronicles (
  chronicle_id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id        UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  era_start_day   INT NOT NULL,
  era_end_day     INT NOT NULL,
  era_name        VARCHAR(100),        -- e.g. "The Age of Wandering"
  narrative       TEXT NOT NULL,       -- LLM-generated historical account
  key_events      JSONB NOT NULL DEFAULT '[]',  -- [{event_id, title, day}]
  generated_tick  BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chronicles_world ON civilisation.chronicles(world_id, era_start_day DESC);

-- ============================================================
-- AUGMENT EXISTING TABLES
-- ============================================================

-- Add construction skill and farming skill to agent_skills default set
-- (No schema change needed — skills are stored in agent_skills as rows)

-- Add structure bonus to map tiles (fast lookup for which tile has a structure)
ALTER TABLE worlds.map_tiles
  ADD COLUMN IF NOT EXISTS has_structure BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS structure_id  UUID REFERENCES civilisation.structures(structure_id) ON DELETE SET NULL;

-- Track agent's known technologies as an array for fast lookup in prompts
ALTER TABLE agents.agents
  ADD COLUMN IF NOT EXISTS known_tech_ids UUID[] NOT NULL DEFAULT '{}';

-- World: track chronicle generation
ALTER TABLE worlds.worlds
  ADD COLUMN IF NOT EXISTS last_chronicle_day INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tiles_structure ON worlds.map_tiles(structure_id) WHERE structure_id IS NOT NULL;
