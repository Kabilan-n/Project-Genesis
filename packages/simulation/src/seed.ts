/**
 * World seed script — creates initial world + 8 agents
 * Usage: WORLD_ID=xxx tsx src/seed.ts  (or let it create a new world)
 */
import 'dotenv/config';
import { v4 as uuidv4 } from 'uuid';
import { getPool, query, execute, queryOne } from './db.js';
import { MapGenerator } from './world/MapGenerator.js';

const WORLD_SIZE = parseInt(process.env.WORLD_SIZE ?? '50');

const AGENT_NAMES = [
  'River', 'Sage', 'Ember', 'Stone', 'Wren', 'Asher', 'Fern', 'Cael'
];

const ARCHETYPES = [
  'The Hopeful Explorer', 'The Cautious Observer', 'The Bold Leader',
  'The Thoughtful Caregiver', 'The Spontaneous Achiever', 'The Resilient Survivor',
  'The Curious Wanderer', 'The Steadfast Guardian'
];

function randomTrait(base = 50, variance = 25): number {
  return Math.max(0, Math.min(100, Math.round(base + (Math.random() - 0.5) * variance * 2)));
}

async function seed() {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Create world
    const worldId = uuidv4();
    await client.query(
      `INSERT INTO worlds.worlds (world_id, name, status, config)
       VALUES ($1, $2, 'active', $3)`,
      [worldId, 'Genesis World Alpha', JSON.stringify({
        map_size: WORLD_SIZE,
        time_scale: 1,
        scarcity_level: 'moderate',
        max_agents: 100
      })]
    );
    console.log(`[Seed] Created world: ${worldId}`);

    // Generate map
    const generator = new MapGenerator();
    const { tiles, resourceNodes } = generator.generate(worldId, WORLD_SIZE);

    // Insert tiles in batches
    const BATCH = 500;
    for (let i = 0; i < tiles.length; i += BATCH) {
      const batch = tiles.slice(i, i + BATCH);
      const values = batch.map((t, idx) => {
        const base = idx * 5;
        return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5})`;
      }).join(',');
      const params = batch.flatMap(t => [worldId, t.x, t.y, t.terrain, t.is_passable]);
      await client.query(
        `INSERT INTO worlds.map_tiles (world_id, x, y, terrain, is_passable) VALUES ${values}`,
        params
      );
    }
    console.log(`[Seed] Inserted ${tiles.length} map tiles`);

    // Insert resource nodes
    for (const node of resourceNodes) {
      await client.query(
        `INSERT INTO worlds.resource_nodes
           (node_id, world_id, x, y, resource_type, current_amount, max_capacity, extraction_rate, regen_rate)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [uuidv4(), worldId, node.x, node.y, node.resource_type,
         node.current_amount, node.max_capacity, node.extraction_rate, node.regen_rate]
      );
    }
    console.log(`[Seed] Placed ${resourceNodes.length} resource nodes`);

    // Find passable spawn points (center area)
    const passableTiles = tiles.filter(t =>
      t.is_passable &&
      t.x > 10 && t.x < WORLD_SIZE - 10 &&
      t.y > 10 && t.y < WORLD_SIZE - 10
    );
    const shuffled = [...passableTiles].sort(() => Math.random() - 0.5);

    // Spawn 8 agents
    for (let i = 0; i < AGENT_NAMES.length; i++) {
      const name = AGENT_NAMES[i];
      const archetype = ARCHETYPES[i];
      const agentId = uuidv4();
      const spawnTile = shuffled[i] ?? { x: 25, y: 25 };

      await client.query(
        `INSERT INTO agents.agents
           (agent_id, world_id, name, archetype, status, birth_tick, generation)
         VALUES ($1,$2,$3,$4,'alive',0,0)`,
        [agentId, worldId, name, archetype]
      );

      // Randomized traits
      await client.query(
        `INSERT INTO agents.agent_traits (
           agent_id,
           optimism, resilience, impulsivity,
           extraversion, empathy, trust_default,
           curiosity, analytical, creativity,
           fairness, loyalty, authority_respect,
           ambition, aggression, self_preservation,
           fear_of_rejection, scarcity_anxiety, status_obsession,
           leadership_tendency
         ) VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
         )`,
        [
          agentId,
          randomTrait(), randomTrait(), randomTrait(),
          randomTrait(), randomTrait(), randomTrait(),
          randomTrait(), randomTrait(), randomTrait(),
          randomTrait(), randomTrait(), randomTrait(),
          randomTrait(), randomTrait(40, 20), randomTrait(),
          randomTrait(30, 25), randomTrait(30, 25), randomTrait(30, 25),
          randomTrait(),
        ]
      );

      // Initial state — with good starting needs
      await client.query(
        `INSERT INTO agents.agent_state
           (agent_id, hp, position_x, position_y,
            need_food, need_water, need_rest, need_belonging, need_esteem, need_actualization,
            current_activity, mental_state, is_awake)
         VALUES ($1,100,$2,$3,80,80,100,50,50,30,'idle','content',true)`,
        [agentId, spawnTile.x, spawnTile.y]
      );

      // Starting inventory
      await client.query(
        `INSERT INTO economy.inventory (agent_id, resource_type, amount, acquired_method)
         VALUES ($1,'food',20,'initial'), ($1,'water',15,'initial')`,
        [agentId]
      );

      // Starting skills
      await client.query(
        `INSERT INTO agents.agent_skills (agent_id, skill_name, level, xp)
         VALUES ($1,'foraging',1,0), ($1,'basic_crafting',1,0)`,
        [agentId]
      );

      console.log(`[Seed] Spawned ${name} (${archetype}) at (${spawnTile.x},${spawnTile.y})`);
    }

    await client.query('COMMIT');
    console.log(`\n[Seed] ✓ World ready! WORLD_ID=${worldId}`);

    // Write the world id to .genesis-world-id at the repo root. The
    // simulation env loader and /config endpoint fall back to this
    // file when WORLD_ID isn't set, so the operator doesn't have to
    // copy/paste it into .env on a fresh install. The file is
    // gitignored.
    try {
      const { writeFileSync } = await import('fs');
      const { join } = await import('path');
      // packages/simulation/src → repo root is ../../..
      const target = join(__dirname, '..', '..', '..', '.genesis-world-id');
      writeFileSync(target, worldId + '\n', 'utf8');
      console.log(`[Seed] Wrote ${target}`);
    } catch (err) {
      console.warn('[Seed] Could not write .genesis-world-id:', err);
      console.log(`[Seed] Set in your .env manually: WORLD_ID=${worldId}`);
    }

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error('[Seed] Failed:', err);
  process.exit(1);
});
