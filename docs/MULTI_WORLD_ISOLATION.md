# Multi-World Isolation Test (Phase 9 / Task 9.3)

Verifies that world boundaries are respected end-to-end: nothing from
world A appears in world B's queries, WebSocket stream, or agent
memories. This is a Phase B blocker if it fails — multi-world support
ships unsafe without it.

## Setup

The codebase already plumbs `world_id` through every table (see
`001_init.sql` onward), so creating a second world is just inserting a
second `worlds.worlds` row + a second map. There's no orchestration
for running two simulations at once — that's part of what this test
proves out.

### Step 1: seed two worlds

```bash
npm run db:migrate

# Seed world A
unset WORLD_ID
npm run db:seed                     # writes .genesis-world-id
cp .genesis-world-id .genesis-world-A
WORLD_A=$(cat .genesis-world-A)

# Seed world B
unset WORLD_ID
npm run db:seed
cp .genesis-world-id .genesis-world-B
WORLD_B=$(cat .genesis-world-B)
```

### Step 2: run two simulation processes

The tick lock (`Phase 3 / Task 3.1`) is per-world, so two processes
pointed at different `WORLD_ID`s won't collide.

```bash
# Terminal 1
WORLD_ID=$WORLD_A npm run --workspace=@genesis/simulation dev

# Terminal 2
WORLD_ID=$WORLD_B npm run --workspace=@genesis/simulation dev

# Terminal 3
npm run --workspace=@genesis/api dev
```

Run for ≥1 hour wall time.

## Checks

### A. Agent isolation

```sql
-- Should return 0 rows: every agent should belong to exactly one world.
SELECT a.agent_id, a.world_id, e.world_id AS event_world
FROM agents.agents a
JOIN events.events e ON a.agent_id = ANY(e.participant_agent_ids)
WHERE a.world_id <> e.world_id;
```

Result: `<rowcount>`

### B. Conversation isolation

```sql
-- Should return 0 rows: a conversation can't span two worlds.
SELECT conversation_id, world_id,
       (SELECT world_id FROM agents.agents WHERE agent_id = initiator_agent_id) AS init_world,
       (SELECT world_id FROM agents.agents WHERE agent_id = target_agent_id) AS target_world
FROM social.conversations
WHERE world_id <> (SELECT world_id FROM agents.agents WHERE agent_id = initiator_agent_id)
   OR world_id <> (SELECT world_id FROM agents.agents WHERE agent_id = target_agent_id);
```

Result: `<rowcount>`

### C. Memory isolation

```sql
-- Should return 0 rows: partner_agent_ids must all live in the same world
-- as the memory owner.
SELECT m.memory_id, m.agent_id, p.agent_id AS partner_id,
       (SELECT world_id FROM agents.agents WHERE agent_id = m.agent_id) AS owner_world,
       (SELECT world_id FROM agents.agents WHERE agent_id = p.agent_id) AS partner_world
FROM memory.episodic_memories m,
     LATERAL unnest(m.partner_agent_ids) AS p(agent_id)
WHERE (SELECT world_id FROM agents.agents WHERE agent_id = m.agent_id)
   <> (SELECT world_id FROM agents.agents WHERE agent_id = p.agent_id);
```

Result: `<rowcount>`

### D. WebSocket fan-out

The current API broadcasts every Redis pub/sub message to every connected
client (`packages/api/src/index.ts` — `subscriber.on('message', ...)`).
**This means events from world A reach a client connected for world B.**

Open the viewer for each world in separate browser tabs:
- Tab 1: `localhost:3000/viewer?worldId=$WORLD_A`
- Tab 2: `localhost:3000/viewer?worldId=$WORLD_B`

Trigger a distinctive event in world A (e.g. force a war via DB insert).
Within ~5s, check tab B's event feed.

| Check | Result |
|-------|--------|
| Tab B's event feed shows the war from world A? | ☐ yes / ☐ no |

If **yes**, the API needs a per-world filter on the fan-out path. File
that as a Phase B blocker.

### E. Reputation / gossip isolation

```sql
-- Reputation rows should be scoped to (agent_id, world_id) and the
-- agent's world should match.
SELECT r.agent_id, r.world_id, a.world_id AS agent_world
FROM social.reputation r
JOIN agents.agents a ON a.agent_id = r.agent_id
WHERE r.world_id <> a.world_id;
```

Result: `<rowcount>`

## Acceptance

- [ ] A returns 0 rows
- [ ] B returns 0 rows
- [ ] C returns 0 rows
- [ ] D: tab B does NOT show world A events (or is filed as a known
      Phase B blocker)
- [ ] E returns 0 rows

## Verdict

- [ ] **PASS** — zero cross-contamination across all checks.
- [ ] **FAIL** — see issues filed; multi-world is a Phase B blocker.
