-- Fog of war: track which tiles have been explored per world.
-- Exploration is cumulative across all agents in a world — any tile
-- witnessed by any living agent becomes permanently revealed to observers.

CREATE TABLE IF NOT EXISTS worlds.explored_tiles (
  world_id  UUID NOT NULL REFERENCES worlds.worlds(world_id) ON DELETE CASCADE,
  x         INTEGER NOT NULL,
  y         INTEGER NOT NULL,
  first_seen_tick INTEGER NOT NULL,
  first_seen_agent_id UUID REFERENCES agents.agents(agent_id) ON DELETE SET NULL,
  PRIMARY KEY (world_id, x, y)
);

CREATE INDEX IF NOT EXISTS idx_explored_tiles_world ON worlds.explored_tiles(world_id);
