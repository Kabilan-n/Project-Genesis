-- Project Genesis - Generations Layer
-- Adds: childhood state, reproduction records, family tree, trait inheritance log

-- ── Childhood State ───────────────────────────────────────────────────────────
-- Tracks agents who are currently in childhood (not yet adults)

ALTER TABLE agents.agents
  ADD COLUMN IF NOT EXISTS is_adult BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS maturity_tick BIGINT;   -- tick when childhood ends

-- ── Reproduction Records ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS agents.reproduction_records (
  record_id       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id        UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  parent_a_id     UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  parent_b_id     UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  child_id        UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  tick            BIGINT NOT NULL,
  day             INT NOT NULL,
  -- Trait inheritance breakdown stored for UI / research
  inheritance_log JSONB NOT NULL DEFAULT '{}',  -- {trait_name: {parent_a, parent_b, mutation, final}}
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repro_world   ON agents.reproduction_records(world_id, tick DESC);
CREATE INDEX IF NOT EXISTS idx_repro_parent  ON agents.reproduction_records(parent_a_id, parent_b_id);
CREATE INDEX IF NOT EXISTS idx_repro_child   ON agents.reproduction_records(child_id);

-- ── Trait Drift Log ──────────────────────────────────────────────────────────
-- Records significant trait changes due to experiences (trauma, success, etc.)

CREATE TABLE IF NOT EXISTS agents.trait_drift_events (
  drift_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  world_id        UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  agent_id        UUID NOT NULL REFERENCES agents.agents(agent_id) ON DELETE CASCADE,
  tick            BIGINT NOT NULL,
  day             INT NOT NULL,
  trigger_type    VARCHAR(40) NOT NULL,   -- 'trauma','success','prolonged_scarcity','bonding','isolation'
  source_event_id UUID REFERENCES events.events(event_id) ON DELETE SET NULL,
  changes         JSONB NOT NULL DEFAULT '{}',  -- {trait_name: delta}
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trait_drift_agent ON agents.trait_drift_events(agent_id, tick DESC);
CREATE INDEX IF NOT EXISTS idx_trait_drift_world ON agents.trait_drift_events(world_id, tick DESC);
