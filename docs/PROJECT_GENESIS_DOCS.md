# Project Genesis — Complete Technical Documentation

**Version:** Phases 1 – 6 + Generations + Fog of War + Accounts & Onboarding + Chat Thread UI  
**Last updated:** 2026-04-25  
**Stack:** TypeScript · Node.js · PostgreSQL 16 · Redis · Claude Haiku (Anthropic / OpenAI / Ollama / HuggingFace) · Next.js 14

> The sections below (1–13) document Phases 1–3 in detail. For a summary of the layers added after Phase 3 — the full civilisation stack, the observer + generations layers, fog of war, and the account / onboarding system — see **§14 "What's been added since Phase 3"** at the bottom of this document.

---

## Table of Contents

1. [Project Overview](#1-project-overview)  
2. [Architecture & Monorepo Structure](#2-architecture--monorepo-structure)  
3. [Database Schema](#3-database-schema)  
4. [Simulation Package](#4-simulation-package)  
   - 4.1 [types.ts](#41-typests)  
   - 4.2 [db.ts](#42-dbts)  
   - 4.3 [WorldEngine](#43-worldengine)  
   - 4.4 [MapGenerator](#44-mapgenerator)  
   - 4.5 [AgentEngine](#45-agentengine)  
   - 4.6 [ClaudeClient](#46-claudeclient)  
   - 4.7 [PromptBuilder](#47-promptbuilder)  
   - 4.8 [ConversationEngine](#48-conversationengine)  
   - 4.9 [RelationshipEngine](#49-relationshipengine)  
   - 4.10 [TradeEngine](#410-tradeengine)  
   - 4.11 [MemoryDecay](#411-memorydecay)  
   - 4.12 [KnowledgeEngine (Phase 3)](#412-knowledgeengine-phase-3)  
   - 4.13 [GossipEngine (Phase 3)](#413-gossipengine-phase-3)  
   - 4.14 [GroupEngine (Phase 3)](#414-groupengine-phase-3)  
   - 4.15 [seed.ts](#415-seedts)  
   - 4.16 [index.ts (Simulation Runner)](#416-indexts-simulation-runner)  
5. [API Package](#5-api-package)  
   - 5.1 [index.ts (Fastify App)](#51-indexts-fastify-app)  
   - 5.2 [Auth Routes](#52-auth-routes)  
   - 5.3 [Onboarding Routes](#53-onboarding-routes)  
   - 5.4 [World Routes](#54-world-routes)  
   - 5.5 [Agent Routes](#55-agent-routes)  
   - 5.6 [Social Routes](#56-social-routes)  
6. [Web Package (Observer UI)](#6-web-package-observer-ui)  
   - 6.1 [WorldMap Component](#61-worldmap-component)  
   - 6.2 [AgentProfile Component](#62-agentprofile-component)  
   - 6.3 [EventFeed Component](#63-eventfeed-component)  
   - 6.4 [ConversationModal Component](#64-conversationmodal-component)  
   - 6.5 [Zustand Store](#65-zustand-store)  
   - 6.6 [WebSocket Hook](#66-websocket-hook)  
7. [Phase 1: Individual Survival Loop](#7-phase-1-individual-survival-loop)  
8. [Phase 2: Social Layer](#8-phase-2-social-layer)  
9. [Phase 3: Cultural & Knowledge Layer](#9-phase-3-cultural--knowledge-layer)  
10. [Data Flow & Event Pipeline](#10-data-flow--event-pipeline)  
11. [Configuration & Environment Variables](#11-configuration--environment-variables)  
12. [How to Run](#12-how-to-run)  
13. [Design Decisions & Trade-offs](#13-design-decisions--trade-offs)  
14. [What's been added since Phase 3](#14-whats-been-added-since-phase-3)
    - 14.1 [Phase 5 — Conflict, Governance & Civilisation](#141-phase-5--conflict-governance--civilisation)
    - 14.2 [Phase 6 — Belief, Culture & Observer](#142-phase-6--belief-culture--observer)
    - 14.3 [Generations layer](#143-generations-layer)
    - 14.4 [Fog of war (migration 009)](#144-fog-of-war-migration-009)
    - 14.5 [Accounts & the 12-question onboarding wizard](#145-accounts--the-12-question-onboarding-wizard)
    - 14.6 [Web app: routing & auth](#146-web-app-routing--auth)
    - 14.7 [Updated mental-state matrix](#147-updated-mental-state-matrix)
    - 14.8 [LLM abstraction layer](#148-llm-abstraction-layer)
    - 14.9 [Full simulation tick order (current)](#149-full-simulation-tick-order-current)
    - 14.10 [UI: Conversation history & relationship tracking](#1410-ui-conversation-history--relationship-tracking)

---

## 1. Project Overview

Project Genesis is an **autonomous AI civilization simulator**. A set of Claude-powered agents are spawned in a 50×50 tiled world and left to survive, form relationships, trade, and remember on their own. A human observer watches in real-time through a browser UI but **cannot interfere** — there are no controls, only observation.

### Core Loop (per agent per tick)

```
PERCEIVE → UPDATE NEEDS → DECIDE (Claude API) → EXECUTE ACTION → RECORD MEMORY → PUBLISH UPDATE
```

Each tick is one simulation minute. A full day is 1440 ticks.

### What makes it interesting

- Agents are LLM-driven, not scripted — every decision is a genuine Claude API call based on the agent's personality, needs, relationships, and memories.
- Needs decay and HP changes create genuine survival pressure. Agents can die.
- Phase 2 adds rich social behaviour: multi-turn conversations, evolving relationships, trade negotiation, and memory consolidation.

---

## 2. Architecture & Monorepo Structure

```
d:\Agent-world\
├── package.json                  # npm workspaces root ("project-genesis")
├── turbo.json                    # Turborepo build orchestration
├── docker-compose.yml            # PostgreSQL 16 + pgvector + Redis
├── .env.example                  # All required environment variables
├── db/
│   ├── migrations/
│   │   ├── 001_init.sql          # Phase 1 schema (all core tables)
│   │   └── 002_phase2.sql        # Phase 2 schema (conversations, trades, counters)
│   └── migrate.js                # Migration runner (plain pg)
├── docs/
│   └── PROJECT_GENESIS_DOCS.md   # This file
├── packages/
│   ├── simulation/               # World engine + Agent engine (Node.js process)
│   │   └── src/
│   │       ├── index.ts          # Simulation runner (main tick loop)
│   │       ├── seed.ts           # World + agent seeding script
│   │       ├── db.ts             # PostgreSQL helpers (query/queryOne/execute)
│   │       ├── types.ts          # All shared TypeScript interfaces
│   │       ├── world/
│   │       │   ├── WorldEngine.ts    # Tick advancement, resource extraction, event logging
│   │       │   └── MapGenerator.ts   # Procedural 50×50 terrain + resource placement
│   │       ├── agent/
│   │       │   └── AgentEngine.ts    # Full per-agent decision cycle
│   │       ├── llm/
│   │       │   ├── ClaudeClient.ts   # Anthropic SDK wrapper + response parsers
│   │       │   └── PromptBuilder.ts  # All LLM prompt construction
│   │       ├── social/               # Phase 2 — social layer
│   │       │   ├── ConversationEngine.ts
│   │       │   ├── RelationshipEngine.ts
│   │       │   ├── TradeEngine.ts
│   │       │   └── MemoryDecay.ts
│   │       └── cultural/             # Phase 3 — cultural layer
│   │           ├── KnowledgeEngine.ts
│   │           ├── GossipEngine.ts
│   │           └── GroupEngine.ts
│   ├── api/                      # Fastify REST + WebSocket API
│   │   └── src/
│   │       ├── index.ts          # Fastify app, Redis sub, WebSocket fan-out
│   │       ├── db.ts             # PostgreSQL pool (shared with simulation)
│   │       └── routes/
│   │           ├── auth.ts       # POST /auth/register, POST /auth/login
│   │           ├── onboarding.ts # POST /onboarding/* (agent creation wizard)
│   │           ├── worlds.ts     # GET /worlds, GET /worlds/:id, GET /worlds/:id/map
│   │           ├── agents.ts     # GET /agents/:id, relationships, conversations
│   │           └── social.ts     # GET /conversations/:id, /trades/:id, etc.
│   └── web/                      # Next.js 14 App Router observer UI
│       └── src/
│           ├── app/              # Next.js pages (layout, page)
│           ├── components/
│           │   ├── WorldMap.tsx          # Canvas 2D map + agent rendering
│           │   ├── AgentProfile.tsx      # 3-tab agent detail panel
│           │   ├── EventFeed.tsx         # Live event stream sidebar
│           │   └── ConversationModal.tsx # Chat-bubble conversation viewer
│           └── lib/
│               ├── store.ts      # Zustand global store
│               └── useWorldSocket.ts  # WebSocket hook
```

**Why a monorepo?**  
Shared TypeScript types between simulation and API, parallel builds via Turborepo, single `npm install` at root.

---

## 3. Database Schema

### PostgreSQL Schemas

| Schema | Tables | Purpose |
|--------|--------|---------|
| `auth` | `users`, `sessions` | User accounts, JWT sessions |
| `worlds` | `worlds`, `map_tiles`, `resource_nodes` | World state, terrain grid, resource deposits |
| `agents` | `agents`, `agent_traits`, `agent_state`, `agent_skills`, `skill_teachings` | Agent identity, personality, live status, skill transfer events |
| `economy` | `inventory`, `trades` | Items held by agents, trade records |
| `social` | `relationships`, `conversations`, `groups`, `group_members`, `reputation`, `gossip_events` | Relationships, conversations, tribes, world-level reputation |
| `memory` | `episodic_memories`, `agent_knowledge` | Agent memory with decay, accumulated world facts |
| `events` | `events` | World event log |

**Migration files:**
- `db/migrations/001_init.sql` — Phase 1 schema (core tables)
- `db/migrations/002_phase2.sql` — Phase 2 schema (conversations, trades)
- `db/migrations/003_phase3.sql` — Phase 3 schema (knowledge, groups, gossip, reputation)

### Key Table Details

#### `agents.agent_state`
Holds mutable per-tick state for each agent:
- `hp NUMERIC(5,2)` — health points (0–100)
- `position_x, position_y SMALLINT` — map coordinates
- `need_food, need_water, need_rest, need_belonging, need_esteem NUMERIC(5,2)` — need scores (0–100)
- `mental_state VARCHAR(20)` — one of: alert, tired, stressed, desperate, flow, depressed, manic, content
- `is_awake BOOLEAN` — sleeping agents don't decay rest
- `current_goal TEXT` — filled from agent's last `thought` field

#### `social.relationships`
Directional edge between two agents:
- `trust_score, affection_score, respect_score, fear_score SMALLINT(0-100)`
- `relationship_type VARCHAR(20)` — stranger → acquaintance → friend → close_friend / rival / enemy
- `interaction_count, positive_interaction_count, negative_interaction_count INT`
- Unique constraint: `(agent_id, other_agent_id)`

#### `social.conversations`
Full conversation transcript:
- `turns JSONB` — array of `{turn_number, speaker_id, speaker_name, message, thought, is_ending}`
- `outcome VARCHAR(20)` — friendly | hostile | neutral | reconciliation | conflict | bonding
- `relationship_changes JSONB` — per-agent delta applied after conversation

#### `memory.episodic_memories`
- `importance NUMERIC(3,2)` — 0.0–1.0, set at creation
- `current_strength NUMERIC(4,3)` — 0.0–1.0, decays over time
- `emotional_valence NUMERIC(3,2)` — -1 to +1
- `tags TEXT[]` — e.g., `['consolidated']`

#### `memory.agent_knowledge` (Phase 3)
Accumulated world facts per agent:
- `fact_key VARCHAR(100)` — e.g., `'water_source_at_12_8'` (unique per agent)
- `fact_value TEXT` — human-readable description e.g., `'x=12,y=8 has water node with ~200 units'`
- `confidence FLOAT` — 0–1; 1.0 = directly observed, < 1.0 = heard from someone
- `source_agent_id UUID` — who the agent learned this from (NULL if self-discovered)
- `times_shared INT` — how many times this fact has been passed on to others

#### `social.groups` (Phase 3)
Tribe/group records:
- `name VARCHAR(100)`, `purpose TEXT`
- `founder_id, leader_id UUID` — FK to agents
- `status VARCHAR(20)` — `'active'`, `'disbanded'`, `'merging'`
- `territory_x, territory_y SMALLINT`, `territory_radius SMALLINT DEFAULT 5` — claimed map region
- `shared_values JSONB` — derived from founder's traits: `{cooperation, ambition, aggression, curiosity, loyalty}`
- `colour VARCHAR(7)` — hex colour for UI rendering (auto-assigned from a palette of 8)
- `member_count INT` — denormalised count, kept in sync on join/leave

#### `social.group_members` (Phase 3)
- `role VARCHAR(30)` — founder / leader / elder / member / recruit
- `contribution_score FLOAT` — increases on positive group actions, decays daily if inactive
- `joined_tick, joined_day` — when the agent joined

#### `social.reputation` (Phase 3)
World-level reputation per agent (composite primary key `agent_id + world_id`):
- `trustworthiness, generosity, skill_renown, danger_level FLOAT` — all 0–100, neutral at 50 (except danger: 0)
- `total_reports, positive_reports, negative_reports INT` — gossip event counters

#### `social.gossip_events` (Phase 3)
Record of each gossip action:
- `gossiper_id, listener_id, subject_id UUID` — the three involved agents
- `claim VARCHAR(30)` — one of: `trustworthy, dangerous, skilled, generous, deceptive, weak, heroic, cruel`
- `believed BOOLEAN` — whether the listener accepted the claim
- `trust_change_subject FLOAT` — the actual delta applied to listener's view of subject

#### `agents.skill_teachings` (Phase 3)
Record of each skill transfer event during a bonding conversation:
- `teacher_id, student_id UUID`
- `xp_transferred FLOAT`, `teacher_level INT`, `student_level_before INT`, `student_level_after INT`
- `conversation_id UUID` — FK to the conversation that triggered the teaching

---

## 4. Simulation Package

### 4.1 `types.ts`

Central TypeScript interface file. Everything in the system uses these types. Key interfaces:

| Interface | Description |
|-----------|-------------|
| `Agent` | Full agent including traits, state, skills, inventory, `group_id` |
| `AgentTraits` | 19 personality dimensions (0–100 each) |
| `AgentState` | Mutable per-tick values: hp, needs, position, mental state |
| `AgentDecision` | LLM output: `{thought, action, speech?, target?, trade_offer?, gossip_subject?, gossip_claim?, group_name?, group_purpose?}` |
| `Conversation` | Full multi-turn conversation record |
| `ConversationTurn` | Single turn: speaker, message, thought, is_ending |
| `TradeOffer` | `{offered_items, requested_items}` — maps of resource→amount |
| `TradeRecord` | Persisted trade with status, outcome, counter_offer |
| `RelationshipDelta` | `{trust?, affection?, respect?, fear?}` — score changes |
| `PerceptionContext` | What the agent can see: nearby agents, resources, tile, directions |
| `WorldEvent` | Logged event with significance, participants, consequences |
| `AgentKnowledge` | A fact the agent knows: `{fact_key, fact_value, confidence, source_agent_id, times_shared}` |
| `GossipClaim` | Union type: `'trustworthy' \| 'dangerous' \| 'skilled' \| 'generous' \| 'deceptive' \| 'weak' \| 'heroic' \| 'cruel'` |
| `Reputation` | World-level reputation scores for an agent: trustworthiness, generosity, skill_renown, danger_level |
| `GossipEvent` | A single gossip interaction: gossiper, listener, subject, claim, whether believed |
| `Group` | A tribe/group: name, purpose, founder, territory, shared_values, colour, member_count |
| `GroupMember` | Agent's membership record: role, joined_tick, contribution_score |
| `SkillTeaching` | A skill XP transfer event from teacher to student |

---

### 4.2 `db.ts`

Thin wrapper around `pg.Pool` with three helper functions:

```typescript
query<T>(sql, params): Promise<T[]>        // Returns array of rows
queryOne<T>(sql, params): Promise<T|null>  // Returns first row or null
execute(sql, params): Promise<void>        // No return value (INSERT/UPDATE/DELETE)
```

The connection string comes from `DATABASE_URL` env var. Pool is shared across all modules via module-level singleton.

---

### 4.3 `WorldEngine`

**File:** `src/world/WorldEngine.ts`

Manages world-level state. Does not hold any in-memory world state — all reads/writes go to PostgreSQL.

| Method | Description |
|--------|-------------|
| `advanceTick()` | `UPDATE worlds.worlds SET current_tick = current_tick + 1` → returns new tick |
| `getCurrentTick()` | Read-only query |
| `regenerateResources()` | Bulk `UPDATE resource_nodes SET current_amount += regen_rate` per tick |
| `getResourceNodesNear(x, y, radius)` | Spatial query using `ABS(x-$2) <= radius` (Manhattan) |
| `extractResource(nodeId, amount)` | Deducts from node, marks depleted if < 5 |
| `logEvent(event)` | INSERT into `events.events`, returns UUID |
| `getActiveAgentIds()` | Returns all alive agent IDs for the tick loop |

**Design note:** The `regenerateResources` is a single bulk UPDATE, not per-node. This is O(1) SQL instead of O(nodes).

---

### 4.4 `MapGenerator`

**File:** `src/world/MapGenerator.ts`

Generates a procedural 50×50 map deterministically from sine-wave noise. Called once at world creation by `seed.ts`.

**Terrain algorithm:**
1. Build a 2D noise grid using overlapping sine waves (fast, no external libs)
2. Adjust value toward 0 near edges to force water border
3. Map noise value → terrain: `<0.15=water, <0.25=swamp, <0.45=grassland, <0.65=forest, <0.80=grassland, else=mountain`
4. Passability: `water` and `mountain` are impassable; everything else is passable

**Resource placement:**
- Config-driven: food×12 (forest/grassland), water×8 (swamp/grassland), wood×10 (forest), stone×6 (mountain/grassland)
- Candidates are filtered by terrain preference, then shuffled and picked
- Every node starts at `current_amount = max_capacity`

---

### 4.5 `AgentEngine`

**File:** `src/agent/AgentEngine.ts`

The heart of Phase 1. Runs the complete PERCEIVE → DECIDE → EXECUTE cycle for one agent per tick.

#### Constructor
Takes `WorldEngine` and `ioredis.Redis` instances. Instantiates `ClaudeClient`, `PromptBuilder`, `ConversationEngine`, `RelationshipEngine`, `TradeEngine`, `GossipEngine`, `GroupEngine`, `KnowledgeEngine`.

#### `runAgentTick(agentId, tick, day)`

1. **Load agent** — JOIN query across agents, agent_state, agent_traits, agent_skills, inventory (includes `group_id`)
2. **`updateNeeds(state, tick)`** — Decays needs and computes HP change (pure function)
3. **Death check** — if HP ≤ 0, call `killAgent()` and return
4. **`perceive(agent, state)`** — Queries nearby agents (radius 6), visible resources (radius 6), current tile, passable directions
5. **Load memories** — Top 5 by importance + recency
6. **Load relationships** — All known relationships for the agent
7. **Phase 3 context** — Parallel fetch of: knowledge facts (top 10), current group record, reputation summary, nearby groups within radius 10
8. **Build prompt + call Claude** — `PromptBuilder.buildDecisionPrompt()` with all Phase 3 context → `ClaudeClient.getAgentDecision()`
9. **`executeAction()`** — Dispatch on action verb: move, gather, eat, drink, rest, talk, offer_trade, gossip, form_group, join_group, leave_group, do_nothing
10. **Save state** — `UPDATE agents.agent_state`
11. **Record memory** — INSERT into `memory.episodic_memories`
12. **Publish to Redis** — `agent:state_changed` event for WebSocket fan-out

#### Need Decay Constants (per tick = 1 sim-minute)

| Need | Decay Rate (per tick) | Source |
|------|-----------------------|--------|
| food | `3/1440 × 100 ≈ 0.208/tick` | 3 units/day spec |
| water | `2/1440 × 100 ≈ 0.139/tick` | 2 units/day spec |
| rest | `~0.417/tick` (awake) | 6h sleep/day spec |

#### HP Damage/Recovery

| Condition | Rate |
|-----------|------|
| food < 5 (starvation) | `−10/1440 × 100 = −0.694/tick` |
| water < 5 (dehydration) | `−15/1440 × 100 = −1.042/tick` |
| rest < 5 (exhaustion, awake) | `−5/1440 × 100 = −0.347/tick` |
| all needs > threshold | `+5/1440 × 100 = +0.347/tick` |

#### `computeMentalState(state)` — State Machine

```
food < 20 OR water < 20  → "desperate"
rest < 20 AND awake       → "tired"
food < 40 OR water < 40   → "stressed"
belonging < 25            → "depressed"
else                      → "content"
```

#### Action Execution Details

- **move:** Validates target tile is passable, clamps to world bounds, publishes `agent:moved` to Redis
- **gather:** Queries resource node at current position, extracts up to `extraction_rate`, adds to inventory
- **eat/drink:** Reads from inventory, converts to need score gain (`food: ×5, water: ×8`)
- **rest:** Sets `is_awake = false`, adds 5 to rest need
- **talk** (Phase 2): Finds target by name in nearby agents, runs `ConversationEngine.runConversation()`, applies relationship changes, logs world event, links conversation_id to event
- **offer_trade** (Phase 2): Finds target by name, runs `TradeEngine.executeTrade()`, logs trade event
- **gossip** (Phase 3): Resolves listener (must be nearby) and subject (any alive agent by name). Calls `GossipEngine.processGossip()`. Logs a `gossip` world event with the claim and whether it was believed. +1 to `need_belonging`.
- **form_group** (Phase 3): Calls `GroupEngine.formGroup()` with name + purpose from `decision.group_name/purpose`. Logs a `group_formed` event. Publishes `group:formed` to Redis. +10 `need_belonging`.
- **join_group** (Phase 3): Calls `GroupEngine.joinGroup()` by group name. Logs a `group_joined` event. Publishes `group:member_joined` to Redis. +8 `need_belonging`.
- **leave_group** (Phase 3): Calls `GroupEngine.leaveGroup()` if agent is in a group. Logs a `group_left` event. −5 `need_belonging`.

---

### 4.6 `ClaudeClient`

**File:** `src/llm/ClaudeClient.ts`

Wraps Anthropic SDK. Uses `claude-haiku-4-5-20251001` by default (configurable via `LLM_MODEL` env).

| Method | Max tokens | Returns |
|--------|-----------|---------|
| `getAgentDecision(prompt)` | 300 | `AgentDecision` |
| `getConversationResponse(prompt)` | 250 | `ConversationTurnResponse` |
| `getTradeResponse(prompt)` | 250 | `TradeResponse` |
| `getRawCompletion(prompt, maxTokens)` | configurable | `string` |

**Parser strategy (all three parsers):**
1. Strip ` ```json ` code fences
2. Try `JSON.parse(cleaned)`
3. On failure: regex-extract first `{...}` block and try again
4. On final failure: return safe default (e.g., `{thought: '...', action: 'do_nothing'}`)

All API errors are caught and return safe defaults — the agent keeps running even if Claude is unavailable.

---

### 4.7 `PromptBuilder`

**File:** `src/llm/PromptBuilder.ts`

Constructs all three prompt types. No I/O — pure string construction.

#### `buildDecisionPrompt(agent, relationships, memories, perception, tick, day, knowledgeFacts?, agentGroup?, reputationSummary?, nearbyGroups?)`

All Phase 3 parameters are optional (default to empty/null) for backward compatibility.

Sections:
- **IDENTITY:** Name, archetype, age in ticks, reputation summary (if any)
- **PERSONALITY:** Trait-driven natural language sentences (optimism, empathy, aggression, etc.)
- **CURRENT STATE:** HP with label, mental state, need values with labels (satisfied/ok/feeling it/urgent/CRITICAL)
- **SKILLS & INVENTORY**
- **YOUR GROUP** (Phase 3): Current group name + purpose + member count, list of nearby groups the agent could join
- **WHAT YOU KNOW** (Phase 3): Top knowledge facts with confidence labels (certain / fairly sure / heard)
- **PEOPLE NEARBY:** Each agent with relationship type + trust score
- **RECENT MEMORIES:** Up to 5 memories
- **WHERE YOU ARE:** Position, terrain, time of day, passable directions
- **NEARBY RESOURCES:** Resource nodes with amounts and distances
- **DECIDE:** Full available action list (now includes gossip, form_group, join_group, leave_group), JSON output requirement

Time of day labels: pre-dawn (0–359), morning (360–719), midday (720–899), afternoon (900–1079), evening (1080–1259), night (1260+).

**Phase 3 JSON output fields added:**
```json
{
  "gossip_subject": "name of person being gossiped about",
  "gossip_claim": "one of the 8 claim values",
  "group_name": "name for form_group or join_group",
  "group_purpose": "purpose when forming a group"
}
```

#### `buildConversationTurnPrompt(speaker, listener, turns, lastMessage, rel, memories, tick, day, forceEnd)`

Sections: WHO YOU ARE, RELATIONSHIP WITH [LISTENER], RECENT MEMORIES, CONVERSATION SO FAR, LISTENER JUST SAID.
Forces JSON: `{thought, speech, is_ending}`.

#### `buildTradeDecisionPrompt(receiver, offerer, offer, inventory, relationship, tick, day)`

Sections: PERSONALITY, YOUR INVENTORY, TRADE OFFER FROM [OFFERER].
Forces JSON: `{thought, decision: accept|reject|counter, reason, counter_offer?}`.

---

### 4.8 `ConversationEngine`

**File:** `src/social/ConversationEngine.ts`

Runs multi-turn Claude dialogues between two agents.

#### `runConversation(initiator, target, openingMessage, tick, day)`

1. Turn 1 is the initiator's opening message (already decided by `AgentEngine`)
2. Alternates speakers for turns 2–4 (`MAX_TURNS = 4`)
3. Each turn: loads relationship + memories for the current speaker, builds prompt via `PromptBuilder`, calls Claude
4. On `t === MAX_TURNS`: sets `forceEnd = true` in prompt
5. Computes outcome + relationship deltas
6. Persists to `social.conversations`, returns with `conversation_id`
7. **(Phase 3)** If outcome is `bonding` or `friendly`: runs `KnowledgeEngine.propagateKnowledge()` and `KnowledgeEngine.attemptSkillTeaching()` in parallel

#### `computeOutcome(turns)` — Keyword Scoring

Scans all messages + thoughts for:
- **Positive words:** friend, trust, help, thank, care, love, together, glad, happy, share, gift
- **Negative words:** enemy, hate, fear, angry, attack, leave, alone, danger, threat, warn

| Score | Outcome |
|-------|---------|
| positive ≥ 3, negative = 0 | bonding |
| positive ≥ 2 | friendly |
| negative ≥ 3 | hostile |
| negative ≥ 2 | conflict |
| else | neutral |

#### `computeRelationshipChanges(initiator, target, turns, outcome)` — Base Deltas

| Outcome | trust | affection | respect | fear |
|---------|-------|-----------|---------|------|
| bonding | +10 | +12 | +5 | −3 |
| friendly | +5 | +6 | +3 | −1 |
| neutral | +1 | +1 | +1 | 0 |
| reconciliation | +8 | +4 | +4 | −5 |
| conflict | −5 | −4 | −2 | +3 |
| hostile | −8 | −6 | −3 | +6 |

Affection is modulated by the initiator's `empathy` trait: `affection × (1 + (empathy−50)/50 × 0.3)`. An agent with empathy=90 gets ~24% more affection change than one with empathy=10.

---

### 4.9 `RelationshipEngine`

**File:** `src/social/RelationshipEngine.ts`

Applies score deltas to both sides of a relationship and upgrades the relationship type.

#### `applyConversationChanges(conv)` 

- Calls `upsertRelationship` for each agent in `relationship_changes`
- On bonding/friendly: `need_belonging += 5/2`
- On hostile/conflict: `need_belonging -= 3`

#### `applyTradeChanges(trade)`

| Trade status | trust | respect | affection | fear |
|-------------|-------|---------|-----------|------|
| accepted | +8 | +5 | +3 | −1 |
| rejected | −3 | −1 | 0 | 0 |
| countered | +2 | +3 | +1 | 0 |

On accepted: `need_esteem += 3` for both parties.

#### `upsertRelationship(agentId, otherId, delta, outcome)`

Uses PostgreSQL `INSERT ... ON CONFLICT DO UPDATE` to upsert both score values and interaction counters atomically. Clamps all values to 0–100 in SQL.

#### `determineType(rel)` — Relationship Type State Machine

Evaluated in priority order:

```
trust < 15 AND (fear > 50 OR affection < 5)  → enemy
trust < 30 AND respect > 50                  → rival
trust ≥ 80 AND affection ≥ 70 AND count ≥ 6 → close_friend
trust ≥ 85 AND affection ≥ 90               → romantic_partner
trust ≥ 60 AND affection ≥ 50 AND count ≥ 3 → friend
count ≥ 2 AND trust ≥ 25                    → acquaintance
else                                          → stranger
```

**Note:** `close_friend` is checked before `romantic_partner`. So with ≥6 interactions, `close_friend` fires even if romantic thresholds are met.

---

### 4.10 `TradeEngine`

**File:** `src/social/TradeEngine.ts`

Orchestrates a full trade negotiation in a single tick.

#### `executeTrade(offerer, receiver, offer, tick, day)`

1. **Validate offerer inventory** — if offerer lacks any offered item, return `rejected` immediately (no Claude call)
2. **Get receiver inventory + relationship** for prompt context
3. **Call Claude** via `getTradeResponse()` — receiver decides: accept / reject / counter
4. **Accept path:** validate receiver has requested items, `transferItems()` both ways, status = `accepted`
5. **Counter path:** validate offerer has counter items AND receiver has counter-requested items; if both valid, `transferItems()` both ways, status = `accepted` (counter auto-resolved in same tick)
6. **Reject path:** status = `rejected`, no transfers
7. **Persist** to `economy.trades`, then `relEngine.applyTradeChanges()`

#### `transferItems(fromId, toId, items)`

For each resource type: `UPDATE inventory SET amount = amount - N` on sender, `INSERT ... ON CONFLICT DO UPDATE SET amount = amount + N` on receiver.

---

### 4.11 `MemoryDecay`

**File:** `src/social/MemoryDecay.ts`

Manages memory fading and consolidation over time.

#### `runDecayPass(worldId, currentTick)`

Called every tick from the simulation runner:
1. **Always:** `decayStrength()` — bulk SQL UPDATE
2. **Once per day** (when `currentTick % 1440 === 0` and `> 0`): `consolidateWeakMemories()`

#### `decayStrength(worldId, currentTick)`

```sql
UPDATE memory.episodic_memories SET
  current_strength = GREATEST(0, current_strength - (0.0008 * (1 - importance * 0.7)))
WHERE agent_id IN (alive agents in world)
  AND (currentTick - tick) > 100  -- only memories older than 100 ticks
```

**Decay formula:** `strength -= 0.0008 × (1 − importance × 0.7)`
- `importance=0`: loses 0.0008/tick (100% decay rate)
- `importance=1`: loses 0.00024/tick (30% decay rate)
- A memory at importance=0 reaches 0 in ~1250 ticks (~21 hours)
- A memory at importance=0.9 survives much longer

#### Daily Consolidation

For each alive agent, finds up to 15 memories with `current_strength < 0.15 AND importance < 0.5`, groups into batches of 5, and for each batch:
1. Builds a Claude prompt listing the 5 memory summaries
2. Asks for a single condensed sentence (max 100 chars)
3. Deletes the 5 old memories
4. Inserts one new consolidated memory with:
   - `importance = min(0.7, maxSourceImportance + 0.1)` (slightly elevated)
   - `current_strength = 0.9` (starts fresh)
   - `tags = ['consolidated']`
   - `emotional_valence = average of batch`
5. Fallback: if Claude fails, uses `"Vague memories from Day N"`

---

### 4.12 `KnowledgeEngine` (Phase 3)

**File:** `src/cultural/KnowledgeEngine.ts`

Handles two forms of cultural transmission: skill XP transfer and world-fact propagation.

#### Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| `XP_TRANSFER_RATIO` | 0.15 | Teacher gives 15% of skill level gap as XP |
| `KNOWLEDGE_CONFIDENCE_DECAY` | 0.02 | Secondhand facts lose 2% confidence |
| `MAX_FACTS_PER_AGENT` | 50 | Oldest low-confidence facts pruned beyond this |

#### `attemptSkillTeaching(agentA, agentB, conversation)`

Called after any bonding/friendly conversation. For each shared skill where one agent's level exceeds the other's by **≥5**:
1. `xpTransfer = levelGap × 0.15`
2. `UPDATE agent_skills SET xp = xp + xpTransfer` on the student
3. Level-up check: if `xp >= level × 100`, increment level and reset XP
4. Inserts a record into `agents.skill_teachings`
5. Checks both directions (A teaches B, B teaches A)

#### `propagateKnowledge(agentA, agentB, conversation)`

Also called after bonding/friendly conversations. For each agent, finds up to 3 of their highest-confidence facts not already known by the other agent:
- Receiver gets the fact at `confidence - 0.02` (secondhand penalty, minimum 0.1)
- Sharer's `times_shared` counter increments

#### `recordDiscovery(agentId, worldId, factKey, factValue, tick)`

Called when an agent directly observes something (e.g., finds a resource). Sets `confidence = 1.0`. Prunes oldest low-confidence facts if agent exceeds `MAX_FACTS_PER_AGENT`.

#### `getKnowledge(agentId)`

Returns top 10 facts by confidence for injection into the decision prompt.

#### `upsertKnowledge()` — Upsert Strategy

Uses `INSERT ... ON CONFLICT (agent_id, fact_key) DO UPDATE SET confidence = GREATEST(existing, new)`. Agents never lose confidence they already have on a fact.

---

### 4.13 `GossipEngine` (Phase 3)

**File:** `src/cultural/GossipEngine.ts`

Models word-of-mouth reputation spreading between agents.

#### Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| `BASE_TRUST_SHIFT` | 6 | Base trust delta per gossip event |
| `TRUST_CREDIBILITY_MULTIPLIER` | 0.015 | Per trust point above 50 for gossiper |
| `SCEPTICISM_REDUCTION` | 0.008 | Per trust_default point below 50 for listener |

#### `processGossip(gossiper, listener, subject, claim, tick, day)`

1. Looks up gossiper's trust score in listener's relationship table (or uses listener's `trust_default` if no relationship)
2. **Credibility formula:** `base = 0.5 + (gossiperTrust − 50) × 0.015 − (50 − listenerScepticism) × 0.008`, clamped 0.2–0.9
3. Probabilistic belief: `believed = Math.random() < credibility`
4. If believed:
   - Positive claims (trustworthy, skilled, generous, heroic): `trust += BASE_TRUST_SHIFT × credibility`, small affection gain, fear reduction
   - Negative claims (dangerous, deceptive, weak, cruel): `trust -= BASE_TRUST_SHIFT × credibility`, fear gain (extra for `dangerous`/`cruel`)
   - Updates subject's `social.reputation` record on the relevant dimension
5. Persists `social.gossip_events` record

#### Claim → Reputation Dimension Mapping

| Claim | Dimension |
|-------|-----------|
| trustworthy, heroic, deceptive | trustworthiness |
| skilled, weak | skill_renown |
| generous | generosity |
| dangerous, cruel | danger_level |

#### `getReputationSummary(agentId, worldId)`

Returns a short natural language description for prompt injection:
- `'widely trusted'` (trustworthiness ≥ 70)
- `'considered untrustworthy'` (trustworthiness ≤ 30)
- `'respected for skill'` (skill_renown ≥ 60)
- `'feared by many'` (danger_level ≥ 60)
- `'known for generosity'` (generosity ≥ 70)
- `'Unknown to most'` (total_reports = 0)

#### `boostReputation(agentId, worldId, dimension, amount, tick)`

Called externally on notable positive actions (e.g., accepted a trade). Uses `INSERT ... ON CONFLICT DO UPDATE` on the reputation table.

---

### 4.14 `GroupEngine` (Phase 3)

**File:** `src/cultural/GroupEngine.ts`

Manages tribe/group lifecycle: formation, joining, leaving, per-tick bonuses, daily cohesion checks.

#### Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| `GROUP_BELONGING_BONUS` | 0.02/tick | Added to `need_belonging` for all members each tick |
| `INACTIVITY_CONTRIBUTION_DECAY` | 0.001/tick (×1440/day) | Daily decay to contribution scores |
| `DISBAND_THRESHOLD` | −10 | Average contribution below this → group disbands |
| `SUGGESTED_MAX_MEMBERS` | 15 | Noted in prompts, no hard enforcement |

#### `formGroup(founder, name, purpose, tick, day)`

1. If founder is already in a group, `leaveGroup()` first
2. Picks a colour not already used in the world (from 8-colour palette)
3. Derives `shared_values` from founder's traits: `{cooperation: (empathy+fairness)/2, ambition, aggression, curiosity, loyalty}`
4. Claims territory at founder's current position with radius 5
5. Inserts group record; inserts founder as `'founder'` role with `contribution_score = 10`
6. Sets `agents.agents.group_id = newGroupId`

#### `joinGroup(agent, groupName, tick, day)`

Case-insensitive name lookup within the agent's world. Leaves current group first if any. Inserts member as `'recruit'` with `contribution_score = 0`. Increments `member_count`.

#### `leaveGroup(agent, tick)`

Removes the member record, clears `agents.agents.group_id`, decrements `member_count`. Auto-disbands if `member_count` reaches 0.

#### `runGroupTick(worldId, tick)`

Called every tick from the simulation runner:
1. **Belonging bonus:** Bulk `UPDATE agent_state SET need_belonging = LEAST(100, need_belonging + 0.02)` for all members of active groups in the world
2. **Daily check** (when `tick % 1440 === 0`): calls `dailyCohesionCheck()`

#### `dailyCohesionCheck(worldId, tick)`

For each active group in the world:
1. Decays all member contribution scores by `INACTIVITY_CONTRIBUTION_DECAY × 1440` (= 1.44 points/day)
2. Computes average contribution score
3. If average < `DISBAND_THRESHOLD` (−10): calls `disbandGroup()`

#### `disbandGroup(groupId, tick)`

Clears `group_id` from all member agents, sets group `status = 'disbanded'`.

#### `deriveGroupValues(founder)`

```typescript
{
  cooperation: (empathy + fairness) / 2,
  ambition,
  aggression,
  curiosity,
  loyalty,
}
```

---

### 4.15 `seed.ts`

One-time setup script. Run with `npm run seed` from the simulation package.

1. Generates a 50×50 map via `MapGenerator`, bulk-inserts all 2500 tiles + resource nodes
2. Creates 8 agents with randomised traits (all traits seeded with gaussian noise around 50)
3. Spawns each agent at a random passable starting position
4. Sets `worlds.worlds.status = 'active'`

---

### 4.16 `index.ts` (Simulation Runner)

The main process. Runs continuously until stopped.

```
Repeat:
  tick = await worldEngine.advanceTick()
  await worldEngine.regenerateResources()
  agentIds = await worldEngine.getActiveAgentIds()
  publish world:tick to Redis
  for each agentId (sequential):
    await agentEngine.runAgentTick(agentId, tick, day)
  await memoryDecay.runDecayPass(WORLD_ID, tick)       // Phase 2
  await groupEngine.runGroupTick(WORLD_ID, tick)        // Phase 3
  wait TICK_INTERVAL ms (default: 5000ms = 5s real-time per tick)
```

`WORLD_ID` comes from `WORLD_ID` env var. `TICK_INTERVAL` from env or defaults to 5000ms.

---

## 5. API Package

### 5.1 `index.ts` (Fastify App)

Plugins registered: `@fastify/cors` (origin: true), `@fastify/jwt` (secret from `JWT_SECRET`), `@fastify/websocket`.

**Auth decorator:** `app.decorate('authenticate', ...)` — middleware that calls `request.jwtVerify()`.

**WebSocket fan-out:**
```
Redis subscriber (genesis:events channel)
  → message received
    → send to all connected wsClients
```

Every simulation event published via Redis is immediately broadcast to all browser tabs.

### 5.2 Auth Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Hash password with bcrypt, insert user, return JWT |
| POST | `/auth/login` | Verify password, return JWT + refresh token |
| GET | `/users/me` | Returns current user profile (requires auth) |

### 5.3 Onboarding Routes

12-question soul questionnaire that builds agent traits:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/onboarding/sessions` | Create session, return session_id |
| GET | `/onboarding/sessions/:id/questions/:n` | Get question N |
| POST | `/onboarding/sessions/:id/answers` | Submit answer, accumulate trait points |
| POST | `/onboarding/sessions/:id/identity` | Set agent name + appearance |
| POST | `/onboarding/sessions/:id/complete` | Compute traits, pick archetype, spawn agent |

**Archetype computation:**
- First word: Hopeful (optimism > 60) / Cautious (optimism < 40) / Thoughtful (analytical > 60) / Spontaneous (impulsivity > 60)
- Second word: Leader / Caregiver / Explorer / Achiever / Observer — based on highest scoring combination

### 5.4 World Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/worlds` | List all worlds with current tick/agent count |
| GET | `/worlds/:id` | Full world info + live stats |
| GET | `/worlds/:id/map` | All 2500 tiles as JSON array |
| GET | `/worlds/:id/events` | Paginated event history (default limit 50) |

### 5.5 Agent Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/agents/:id` | Full agent profile: traits, state, skills, inventory, recent memories |
| GET | `/agents/:id/relationships` | All relationships with other_agent names and scores |
| GET | `/agents/:id/conversations` | Summary list of conversations the agent took part in (no `turns` payload, just `turn_count`). Default `limit=10`. |
| GET | `/agents/:id/conversations/with/:partnerId` | Merged transcript of every conversation between two specific agents. Returns rows including the full `turns` JSONB, ordered oldest-first. Default `limit=200`. Powers the WhatsApp-style chat thread modal. |
| GET | `/agents/:id/trades` | Trade history |
| GET | `/agents/:id/group` | Current active group (404 if not in one) |
| GET | `/agents/:id/reputation` | Reputation scores; returns neutral defaults if no reports yet |
| GET | `/agents/:id/gossip` | Gossip events where this agent was the subject |
| GET | `/agents/:id/knowledge` | All knowledge facts, ordered by confidence |

### 5.6 Social Routes

Phase 2 + Phase 3:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/conversations/:id` | Full conversation with all turns |
| GET | `/worlds/:id/conversations` | World-level conversation history |
| GET | `/trades/:id` | Full trade record |
| GET | `/worlds/:id/trades` | World-level trade history |
| GET | `/worlds/:id/groups` | All active groups with founder/leader names |
| GET | `/groups/:id` | Group detail + full member list (role, HP, contribution score) |
| GET | `/worlds/:id/reputation` | World reputation leaderboard (top 20 by composite score) |
| GET | `/worlds/:id/gossip` | Recent gossip events with gossiper/listener/subject names |
| GET | `/worlds/:id/teachings` | Skill teaching events with teacher/student names |

---

## 6. Web Package (Observer UI)

Built with Next.js 14 App Router, Tailwind CSS, Zustand for state, Canvas 2D for the map.

### 6.1 `WorldMap` Component

Renders the 50×50 world on an HTML Canvas. On mount, fetches all tiles from `GET /worlds/:id/map`. 

**Terrain colors:**
- water: #1e3a5f, grassland: #2d5a27, forest: #1a3a1a, swamp: #2d4a2d, mountain: #4a4a4a, desert: #6b5a2a

**Agent rendering:**
- Each agent is a circle colored by mental state (alert=green, content=blue, tired=yellow, stressed=orange, desperate=red, depressed=purple)
- HP bar rendered below each agent (green/yellow/red)
- **(Phase 3)** If agent has a `group_colour`, a coloured ring is drawn around the agent circle
- **(Phase 3)** Selected agents show a white selection ring (offset outward if the agent has a group ring)
- Click on agent → sets `selectedAgentId` in Zustand store

**(Phase 3) Group territory rendering:**
- For each active group with `territory_x/y` set, draws a faint circle at the territory centre
- Circle radius = `territory_radius × TILE_SIZE` pixels
- Filled with `group_colour` at 6% opacity, outlined at 35% opacity
- Group name label displayed above the territory circle

**Live updates:** Subscribes to Zustand `agents` and `groups` maps; re-renders canvas on any change.

### 6.2 `AgentProfile` Component

3-tab panel rendered in the right sidebar when an agent is selected.

**Auto-refresh:** Parallel fetch of `/agents/:id`, `/agents/:id/relationships`, `/agents/:id/conversations`, `/agents/:id/reputation` on mount and every 8 seconds. If agent has a `group_id`, also fetches `/groups/:id`.

**Status tab:**
- Current goal (italicised quote)
- `NeedBar` for food, water, rest, belonging, esteem — color: green (≥2× critical), yellow (≥critical), red (<critical)
- `TraitDot` for 5 key traits (5-dot scale)
- Inventory list
- Skills list
- **(Phase 3)** Reputation bars for trustworthiness, generosity, skill renown, danger level — shown only if `total_reports > 0`
- Last 5 memories (colored by `emotional_valence`)

**Relations tab:**
- Cards for each relationship
- Score mini-bars for trust, affection, respect, fear
- Relationship type colored by severity (stranger=gray, friend=green, enemy=red, etc.)

**(Phase 3) Group tab:**
- Coloured header card showing group name, purpose, member count, formed day
- Member list sorted by contribution score: shows role, HP, mental state, contribution score (positive=blue, negative=red)
- Tab indicator dot uses group colour

**History tab:**
- List of conversations, clickable to open `ConversationModal`
- Each row shows: participants, outcome dot, turn count, day

### 6.3 `EventFeed` Component

Sidebar showing the live event stream. Subscribes to Zustand `events` array (populated by WebSocket). Shows last 200 events.

**Event significance colors:**
- trivial: gray, minor: blue, moderate: yellow, major: orange, historic: red

**Clickable conversations:** Events with `event_type === 'conversation'` and `consequences.conversation_id` show a `↗` indicator and open `ConversationModal` on click.

**Event type icons:** ★ birth, † death, ◉ conversation, ◎ speech, ⇌ trade, ⚔ conflict, ◈ discovery.

### 6.4 `ConversationModal` Component

Full-screen overlay (click outside to close). Fetches `GET /conversations/:id` on mount.

**Features:**
- Chat-bubble layout: initiator on left (gray bubble), target on right (blue bubble)
- Outcome badge with color coding (bonding=green, hostile=red, etc.)
- "Show thoughts" toggle to reveal internal `thought` field per turn
- Topic displayed in footer

### 6.5 Zustand Store

**File:** `src/lib/store.ts`

```typescript
interface GenesisStore {
  worldId: string;
  agents: Map<string, AgentSummary>;   // agent_id → summary
  groups: Map<string, GroupSummary>;   // group_id → summary (Phase 3)
  events: WorldEvent[];                // last 200
  stats: WorldStats | null;
  selectedAgentId: string | null;
  // Actions:
  setWorldId, updateAgent, addEvent, setStats, setSelectedAgent, setAgents,
  setGroups, upsertGroup  // Phase 3
}
```

`AgentSummary` was extended in Phase 3 with `group_id`, `group_name`, `group_colour` fields.

`GroupSummary` holds: `group_id, name, colour, member_count, territory_x, territory_y, territory_radius`.

Both `agents` and `groups` are `Map`s for O(1) lookup. `events` is capped at 200.

### 6.6 WebSocket Hook

**File:** `src/lib/useWorldSocket.ts`

Connects to `ws://[API_URL]/ws`. Parses incoming JSON messages and dispatches to the Zustand store:

| Message type | Store action |
|-------------|-------------|
| `world:tick` | `setStats(stats)` |
| `agent:moved` | `updateAgent({agent_id, position_x, position_y})` |
| `agent:state_changed` | `updateAgent({hp, mental_state, activity, ...})` |
| `agent:born` | `setAgents([...agents, newAgent])` |
| `agent:died` | `addEvent(death event)` |
| `event:significant` | `addEvent(event)` |
| `group:formed` (Phase 3) | `upsertGroup(newGroup)` + `addEvent(group_formed event)` |
| `group:member_joined` (Phase 3) | `updateAgent({group_id, group_colour, group_name})` |

Auto-reconnects on disconnect with 3-second delay.

---

## 7. Phase 1: Individual Survival Loop

Phase 1 establishes the core agent survival loop without social interaction.

**What agents can do in Phase 1:**
- `move [direction]` — navigate the map
- `gather [resource]` — collect food/water/wood/stone
- `eat [amount]` — consume food from inventory
- `drink [amount]` — consume water from inventory
- `rest` — recover energy
- `do_nothing` — observe

**What the observer sees:**
- Live map with agent positions updating in real-time
- Event feed showing gathering, resting, moving events
- Agent profile with need bars and HP

**Key Phase 1 constraint:** Agents who fail to manage their needs (food, water, rest) will die. The simulation has real consequences.

---

## 8. Phase 2: Social Layer

Phase 2 adds the entire social dimension: communication, relationship evolution, trade, and memory management.

**New agent actions:**
- `talk [agent_name] [message]` — triggers a 2–4 turn Claude conversation
- `offer_trade [agent_name]` — triggers trade negotiation (requires `trade_offer` in decision JSON)

**New observer features:**
- Clickable conversation events in the Event Feed → opens transcript modal
- Agent Profile Relations tab with evolving relationship scores
- Agent Profile History tab with conversation list
- Full conversation transcript with "show thoughts" toggle

**Memory system:**
- Memories are now first-class citizens with strength that fades over time
- Daily consolidation compresses 5 weak memories into 1 summary using Claude
- Important memories (conversations, desperate moments) survive longer

**Relationship lifecycle:**
```
stranger (interaction=0)
  → acquaintance (count≥2, trust≥25)
    → friend (count≥3, trust≥60, affection≥50)
      → close_friend (count≥6, trust≥80, affection≥70)
      OR romantic_partner (trust≥85, affection≥90, count<6)
  OR rival (trust<30, respect>50)
  OR enemy (trust<15, fear>50 or affection<5)
```

---

## 9. Phase 3: Cultural & Knowledge Layer

Phase 3 adds three interconnected systems that simulate cultural emergence: collective knowledge, reputation gossip, and tribal grouping.

### New Agent Actions

| Action | Syntax | Description |
|--------|--------|-------------|
| `gossip` | `gossip [listener] [subject] [claim]` | Share an opinion about a third agent with someone nearby |
| `form_group` | `form_group [name] [purpose]` | Found a new tribe at current position |
| `join_group` | `join_group [group_name]` | Join a named group visible nearby |
| `leave_group` | `leave_group` | Depart from current group |

### Knowledge System

Agents accumulate `AgentKnowledge` facts about the world. Facts have a `confidence` value (1.0 = directly witnessed, lower = heard secondhand). During **bonding or friendly conversations**, agents share their 3 highest-confidence facts with each other at reduced confidence (`confidence - 0.02`). This creates a realistic "telephone game" effect where information degrades as it passes through the network.

Facts are pruned when an agent exceeds 50 — oldest, lowest-confidence facts are removed first.

### Skill Teaching

When two agents have a bonding/friendly conversation and one agent's skill level exceeds the other's by **5 or more levels**, the more skilled agent automatically transfers `levelGap × 0.15` XP to the student. If the student accumulates `level × 100` XP, they level up. Teaching events are recorded in `agents.skill_teachings` and linked to the triggering conversation.

### Gossip & Reputation

The `gossip` action uses a **credibility formula** to determine whether the listener believes the claim:

```
credibility = 0.5
  + (gossiperTrust − 50) × 0.015   // more trusted gossiper = more believable
  − (50 − listenerScepticism) × 0.008  // more sceptical listener = harder to convince
```

Clamped to 0.2–0.9. If believed, shifts the listener's trust/fear of the subject, and updates the subject's world-level `Reputation` record. Reputation dimensions (trustworthiness, generosity, skill_renown, danger_level) are mapped per claim type.

### Group Dynamics

Groups have a **territory** (map region), **shared values** (derived from founder's traits), and a **colour** (for UI rendering). Group membership provides a passive `+0.02 need_belonging` per tick.

Each member has a `contribution_score` that increases when they do things for the group (trade with members, act near territory). Scores decay daily (`-1.44/day` at baseline). A group whose average contribution falls below **-10** automatically disbands. Groups with **0 members** also disband immediately.

### What the Observer Sees in Phase 3

- **WorldMap:** Coloured territory circles around active groups; coloured rings on grouped agents
- **AgentProfile Group tab:** Group name, purpose, member list with roles and contribution scores
- **AgentProfile Status tab:** Reputation bars (only shown after first gossip reports)
- **EventFeed:** `group_formed`, `group_joined`, `group_left`, `gossip` events
- **REST API:** `/worlds/:id/groups`, `/groups/:id`, `/worlds/:id/reputation`, `/worlds/:id/gossip`, `/worlds/:id/teachings`

---

## 10. Data Flow & Event Pipeline

```
Simulation Process
│
├─ AgentEngine.runAgentTick()
│   └─ redis.publish('genesis:events', JSON)
│
API Process
├─ Redis subscriber listens on 'genesis:events'
│   └─ fans out to all connected WebSocket clients
│
Browser
├─ useWorldSocket() receives message
│   └─ dispatches to Zustand store
│       └─ React components re-render
│
Components also poll REST API:
├─ AgentProfile: every 8s polls /agents/:id, /relationships, /conversations,
│                              /reputation, /groups/:id (Phase 3)
├─ WorldMap: initial load of /worlds/:id/map + /worlds/:id/groups (Phase 3)
└─ EventFeed: filled by WebSocket (no polling)
```

**Why Redis pub/sub and not direct WebSocket?**
The simulation and API are separate processes. Redis decouples them — the simulation publishes events without knowing how many API instances are listening.

---

## 11. Configuration & Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | — | PostgreSQL connection string |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (required) |
| `JWT_SECRET` | `genesis-secret` | JWT signing secret |
| `API_PORT` | `3001` | Fastify listen port |
| `LLM_MODEL` | `claude-haiku-4-5-20251001` | Claude model ID |
| `WORLD_SIZE` | `50` | Map dimensions (N×N) |
| `TICK_INTERVAL` | `5000` | Milliseconds between ticks |
| `NEXT_PUBLIC_WORLD_ID` | — | UUID of the world to display |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | API base URL (browser-visible) |

---

## 12. How to Run

### Prerequisites
- Docker Desktop running
- Node.js 20+
- Anthropic API key

### Steps

```bash
# 1. Install dependencies
cd d:/Agent-world
npm install

# 2. Copy and configure environment
cp .env.example .env
# Edit .env: set ANTHROPIC_API_KEY, DATABASE_URL, REDIS_URL, NEXT_PUBLIC_WORLD_ID

# 3. Start PostgreSQL + Redis
docker compose up -d

# 4. Run database migrations (includes Phase 1, 2, and 3 schemas)
npm run db:migrate

# 5. Seed the world (generates map + 8 agents)
npm run db:seed

# 6. Start all services (simulation + API + web in parallel)
npm run dev

# Or individually:
# cd packages/simulation && npm run dev
# cd packages/api && npm run dev
# cd packages/web && npm run dev
```

### Running Tests

```bash
cd packages/simulation
npm test              # Run all tests once
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

---

## 13. Design Decisions & Trade-offs

### Why Claude Haiku (not Sonnet/Opus)?

Haiku is ~20× cheaper than Opus and sufficient for the agent decision loop. An agent takes a decision every 5 seconds; at scale with 10 agents that's 2 API calls/second. Haiku's latency (~0.5s) fits the budget. Sonnet/Opus would add cost and latency without proportional benefit for simple action selection.

### Why sequential agent ticks (not parallel)?

Running agents sequentially avoids race conditions when two agents try to gather the same resource node or initiate a conversation with each other simultaneously. The simplicity trade-off is acceptable for Phase 1 (8 agents × 5s tick = all agents done in ~40s worst case with Claude calls).

### Why keyword-based outcome detection (not another LLM call)?

Adding a third Claude call (outcome classification) per conversation would triple the cost and latency of every conversation. The keyword approach is fast, deterministic, and sufficiently accurate for rough mood categorisation. Edge cases (sarcasm) are acceptable noise.

### Why is `close_friend` checked before `romantic_partner`?

The code order in `determineType` was a deliberate choice: long-term friends (many interactions) are more common than romantic partners. If both thresholds are met, the more "achieved" state (close friend, earned through time) takes precedence. A future `romantic_partner` pathway could require an explicit "confession" conversation event.

### Why cap events at 200 in the frontend store?

The EventFeed renders the entire list on every update. At 200 entries with 10 agents ticking every 5 seconds, that's ~2-4 new events every 5 seconds. 200 entries × 5s avg render time is negligible. Storing 10,000 entries would cause React to re-render a huge list every tick.

### Why upsert relationships instead of update-then-insert?

PostgreSQL `INSERT ... ON CONFLICT DO UPDATE` is atomic and avoids the race condition of `SELECT → INSERT/UPDATE` patterns in the middle of an active tick loop. Using subqueries within the VALUES clause to read current scores is verbose but correct.

### Why store conversation turns in JSONB rather than a separate table?

Conversations are read as a unit (the full transcript is always needed together, never per-turn). JSONB avoids a multi-row JOIN on every read. The downside is no per-turn indexing, but turn-level queries are not needed.

### Why is `agents.agents.group_id` a denormalised column rather than always joining `group_members`?

The most common access pattern is "is this agent in a group?" — checked on every tick to fetch group context. A FK column on `agents` makes this O(1) instead of requiring a JOIN on `group_members` for every agent every tick. The trade-off is that `group_id` must be kept in sync on join/leave, which the `GroupEngine` handles explicitly. The `group_members` table remains authoritative for role/contribution data.

### Why auto-resolve counter-offers in the same tick?

A two-tick counter-offer cycle (offer → counter → accept/reject) would require persisting `pending` trade records and re-querying them every tick for each agent. This adds complexity with minimal behavioural benefit — the responding agent doesn't have new information between ticks. Auto-resolution keeps the trade engine stateless within a single tick.

### Why does knowledge confidence use `GREATEST(existing, new)` on upsert?

An agent should never become *less* confident about a fact they already know well. If they learn something directly (confidence=1.0) and later hear the same fact secondhand (confidence=0.8), their certainty should stay at 1.0. This prevents information "poisoning" via low-confidence gossip degrading firsthand knowledge.

### Why use a fixed palette of 8 group colours rather than random colours?

Random colours create visual noise and can produce colours too close to terrain colours or each other. The fixed palette is designed for contrast against the dark map background and against each other, making group territories distinguishable at a glance. When all 8 colours are in use, a random one is selected from the palette (acceptable collision; uncommon in practice with ≤15 agents).

### Why is the gossip credibility formula clamped to 0.2–0.9?

The floor of 0.2 ensures gossip always has *some* chance of being believed — even if you distrust the gossiper completely, you might still internalise what you hear. The ceiling of 0.9 ensures no single gossip event is a certainty — even from the most trusted source. This prevents runaway reputation destruction or inflation from a single well-connected agent.

---

## 14. What's been added since Phase 3

The detailed walk-through above stops at Phase 3. Everything in this section was added after — the simulation now runs a much richer stack of daily/tick engines, an observer layer, generations, fog of war, and a user-account system.

### 14.1 Phase 5 — Conflict, Governance & Civilisation

New engines in [packages/simulation/src/conflict/](../packages/simulation/src/conflict/) and [packages/simulation/src/civilisation/](../packages/simulation/src/civilisation/):

| Engine | Responsibility |
|--------|---------------|
| `ConflictEngine` | Wars between groups (declare, raid, skirmish), casualty tracking, ceasefire + treaty generation. `checkWarTermination` runs every tick. |
| `GovernanceEngine` | Leadership challenges, exile votes, succession when a leader dies. |
| `LawEngine` | Proposed laws → votes → enactment. `runLawTick` runs every tick to promote passed proposals. |
| `EconomyEngine` | Multi-currency wallets, marketplace listings, price history. `runMarketTick` runs once per in-game day to expire listings and snapshot prices. |
| `ConstructionEngine` | Agents pool resources to build structures (shelters, workshops, temples…). |
| `TechnologyEngine` | Research tree; discoveries spread via gossip / teaching. |
| `ChronicleEngine` | Once per era (or on demand), an LLM summarises the period into a "chronicle" entry — `ChronicleEngine.shouldGenerate` + `generateChronicle` at each new day. |

Migration **`004_phase5.sql`** adds war / skirmish / treaty tables. Migration **`006_phase5_civilisation.sql`** adds laws, currencies, wallets, marketplace, technologies, structures, chronicles.

### 14.2 Phase 6 — Belief, Culture & Observer

- **`BeliefEngine`** ([packages/simulation/src/cultural/BeliefEngine.ts](../packages/simulation/src/cultural/BeliefEngine.ts)) — passive conviction decay every tick, plus `on_war` rituals. Daily extinction check removes beliefs with no living adherents. Sacred sites, myths, and pilgrimages are part of this layer.
- **`ObserverEngine`** ([packages/simulation/src/observer/ObserverEngine.ts](../packages/simulation/src/observer/ObserverEngine.ts)) — every tick, records world-state snapshots, updates activity heatmaps, advances weather (which feeds back into `worldEngine.regenerateResources` via a `weather_mult`), and generates LLM-written biographies for long-lived agents.

Migrations **`005_phase6.sql`** (beliefs, myths, rituals, sacred sites) and **`007_phase6_observer.sql`** (snapshots, heatmaps, biographies).

### 14.3 Generations layer

Migration **`008_generations.sql`** — adds:

- `agents.agents.is_adult BOOLEAN` + `maturity_tick BIGINT` — childhood tracking
- `agents.reproduction_records` — two parents + child + full `inheritance_log` JSONB showing the trait-by-trait breakdown of what each parent contributed and any mutation
- `agents.trait_drift_events` — recorded when traumatic/bonding/scarcity events shift an adult's traits over time

The observer UI exposes this via a **Family Tree** tab on the agent profile and via `/agents/:id/family` + `/agents/:id/trait-drift` API routes.

### 14.4 Fog of war (migration 009)

Migration **`009_fog_of_war.sql`** adds a single table:

```sql
CREATE TABLE worlds.explored_tiles (
  world_id  UUID NOT NULL,
  x         INTEGER NOT NULL,
  y         INTEGER NOT NULL,
  first_seen_tick INTEGER NOT NULL,
  first_seen_agent_id UUID,
  PRIMARY KEY (world_id, x, y)
);
```

**Implementation flow:**

1. `AgentEngine.runAgentTick` calls `markTilesExplored(agent, state, tick)` every tick.
2. `markTilesExplored` iterates every tile in the 6-tile perception radius around the agent and bulk-inserts `(world_id, x, y, first_seen_tick, first_seen_agent_id)` with `ON CONFLICT (world_id, x, y) DO NOTHING` — so only the *first* sighting is recorded, and the data remains even if the agent later dies.
3. `/worlds/:id/map` returns the full explored set on page load.
4. `/worlds/:id/explored?since=<tick>` is polled every 5 s by [viewer/page.tsx](../packages/web/src/app/viewer/page.tsx); only newly-stamped tiles come back. The client merges into its local `explored_tiles` with a dedup `Set<"x,y">`, which avoids re-downloading the full reveal set.
5. `WorldMap.tsx` renders unexplored tiles as solid dark squares over the terrain.

The design is **cumulative and world-wide**: exploration belongs to the world, not the individual. This is appropriate for Genesis because observers watch the world, not a particular agent.

### 14.5 Accounts & the 12-question onboarding wizard

**Schema** (in `001_init.sql`, augmented as the system evolved):

- `auth.users` — `user_id`, `email`, `username`, `password_hash`, `status`, `subscription_tier`, `agents_created_count`, `agents_alive_count`, `settings JSONB`
- `auth.sessions` — refresh-token records
- `auth.onboarding_sessions` — transient agent-creation state: `answers JSONB`, `accumulated_traits JSONB`, `name`, `appearance JSONB`, `mode ∈ {discover, design, random}`, `status ∈ {in_progress, completed, abandoned}`

**API** ([packages/api/src/routes/auth.ts](../packages/api/src/routes/auth.ts), [packages/api/src/routes/onboarding.ts](../packages/api/src/routes/onboarding.ts)):

| Route | Purpose |
|-------|---------|
| `POST /auth/register` | bcrypt-hash password, insert user, return JWT |
| `POST /auth/login` | verify password, return JWT |
| `GET /users/me` | current user + their agents (protected) |
| `POST /onboarding/sessions` | start a wizard session (protected) |
| `GET /onboarding/sessions/:id/questions/:n` | fetch question `n` (options returned without trait values) |
| `POST /onboarding/sessions/:id/answers` | `{question_number, answer_index}` → accumulate traits |
| `POST /onboarding/sessions/:id/identity` | set `name` + `appearance` |
| `POST /onboarding/sessions/:id/complete` | spawn agent, seed state + inventory + starter skill, return `{agent_id, name, archetype, world_id, spawn_position}` |

**The 12 questions** (see `SOUL_QUESTIONS` in `onboarding.ts`):

1. First Instincts — approach to strangers
2. Resource Scarcity — generosity under threat
3. Leadership Moment — stepping up vs. deferring
4. Discovery — curiosity style
5. Conflict — direct vs. indirect response
6. Moral Dilemma — loyalty vs. fairness
7. Opportunity — self-interest vs. community
8. Adversity — resilience profile
9. Free Time — extraversion + creativity
10. Loss — grief style
11. The Deep Fear — fear_of_rejection / scarcity_anxiety / status_obsession
12. Legacy — long-term motivation

Each option carries a `{trait: delta}` map. Traits accumulate from a neutral `50` baseline (defaulted for traits with no `50` natural mid-point — e.g., the three deep-fear traits start at `30`). All values are clamped to `[0, 100]`.

**Archetype derivation** (`calculateArchetype` in `onboarding.ts`):

- First word (mood): `Hopeful` / `Cautious` / `Spontaneous` / `Thoughtful` — based on `optimism` and `impulsivity`
- Second word (role): max of `Leader / Caregiver / Explorer / Achiever / Observer` — composite scores over ambition, empathy, curiosity, extraversion, etc.

Result examples: *"The Hopeful Caregiver"*, *"The Cautious Observer"*, *"The Spontaneous Explorer"*.

### 14.6 Web app: routing & auth

[packages/web/src/app/](../packages/web/src/app/) now has:

- **`/`** — [page.tsx](../packages/web/src/app/page.tsx): marketing landing page with feature cards (Survival / Discovery / Emergence) and Login/Register CTAs
- **`/login`**, **`/register`** — auth forms that persist JWT via Zustand's `persist` middleware in [lib/auth.ts](../packages/web/src/lib/auth.ts)
- **`/viewer`** — the full simulation UI (was the root page prior to the auth layer). Redirects unauthenticated users to `/login`.

**New components:**
- [ConversationHistory.tsx](../packages/web/src/components/ConversationHistory.tsx) — scrollable view of all past conversations between two agents, with outcome badges and optional thought display. Accessed from the **Relations** tab in the Agent Profile by clicking any relationship.

All authenticated fetches go through `apiFetch(path, init)` which attaches `Authorization: Bearer <token>`.

### 14.7 Updated mental-state matrix

`AgentEngine.computeMentalState` was expanded beyond the Phase 1 set. The current rules (top-down, first match wins):

| State | Condition |
|-------|-----------|
| `desperate` | `need_food < 10 OR need_water < 10 OR hp < 20` |
| `tired` | `need_rest < 10 AND is_awake` |
| `anxious` | `need_food < 25 OR need_water < 25` |
| `stressed` | `need_food < 40 OR need_water < 40` |
| `tired` | `need_rest < 25 AND is_awake` (softer trigger) |
| `lonely` | `need_belonging < 15` |
| `depressed` | `need_belonging < 25` |
| `content` | `need_food > 80 AND need_water > 80 AND need_rest > 70 AND need_belonging > 60` |
| `hopeful` | `need_belonging > 70 AND need_esteem > 60` |
| `alert` | default |

### 14.8 LLM abstraction layer

Claude is no longer the only option. `LLMFactory.fromEnv()` in [packages/simulation/src/llm/LLMFactory.ts](../packages/simulation/src/llm/LLMFactory.ts) selects a provider from `LLM_PROVIDER`. All providers implement the same `LLMClient` interface in [llm/types.ts](../packages/simulation/src/llm/types.ts):

- `AnthropicClient` (default)
- `OpenAIClient` (requires optional `openai` package)
- `OllamaClient` (local models)
- `HuggingFaceClient` (inference endpoints)

**Token Optimization:** Two `PromptBuilder` variants are available:
- **Optimised** (default, `OPTIMIZE_PROMPTS=true`) — ~150–250 tokens per decision. Uses terse `key:value` format, omits empty sections, caps memories/nearby agents/knowledge at 3 each. Great for cost reduction.
- **Verbose** (`OPTIMIZE_PROMPTS=false`) — ~600–800 tokens per decision. Full prose headers and all context. Better for debugging or lower token sensitivity.

### 14.9 Full simulation tick order (current)

From [packages/simulation/src/index.ts](../packages/simulation/src/index.ts), in order each tick:

1. `worldEngine.advanceTick()` + compute `day` + `isNewDay`
2. `worldEngine.regenerateResources()` (with weather multiplier)
3. Get alive agent IDs
4. Publish `world:tick` event to Redis
5. **For each agent**: `agentEngine.runAgentTick(id, tick, day)` — runs PERCEIVE → UPDATE → DECIDE (LLM) → EXECUTE → RECORD → PUBLISH **and stamps the fog-of-war reveal**
6. `memoryDecay.runDecayPass(worldId, tick)` — Phase 2
7. `groupEngine.runGroupTick(worldId, tick)` — Phase 3: belonging bonus + cohesion check
8. `conflictEngine.checkWarTermination(worldId, tick)` — Phase 5
9. `lawEngine.runLawTick(worldId, tick)` — Phase 5
10. `beliefEngine.runBeliefTick(worldId, tick)` — Phase 6: conviction decay + on-war rituals
11. `observerEngine.runObserverTick(worldId, tick, day)` — Phase 6: snapshots / heatmaps / weather / interventions
12. **Once per in-game day**: `economyEngine.runMarketTick`, `beliefEngine.checkBeliefExtinction`, `chronicleEngine.generateChronicle` (if a new era has completed)

The loop sleeps so the overall cadence is `SIMULATION_TICK_INTERVAL_MS` (default 5000 ms).

### 14.10 UI: WhatsApp-style chat thread (current)

The earlier two-pane "ConversationHistory" view (left list / right transcript) has been replaced by a single merged thread modal that mirrors a chat application. The change addresses two complaints from real observation: (a) every recurring conversation between the same two agents created a duplicate row in the History tab, and (b) opening one row only ever showed a single transcript, hiding the long-arc relationship.

**Components**

- [packages/web/src/components/ChatThreadModal.tsx](../packages/web/src/components/ChatThreadModal.tsx) — the new modal. Receives `agentId`, `agentName`, `partnerId`, `partnerName`, `onClose`. Calls `GET /agents/:agentId/conversations/with/:partnerId?limit=200` (oldest first), flattens every `turns` array, tags each turn with its parent `day / tick / outcome / conversation_id`, then renders.
- [packages/web/src/components/AgentProfile.tsx](../packages/web/src/components/AgentProfile.tsx) — the **History** tab now groups conversations by partner and shows one row per partner: avatar initial, partner name, last topic snippet, day badge, ± outcome counts (bonding/friendly vs hostile/conflict), and a total-conversations pill. Clicking the row opens `ChatThreadModal` for that partner.

**Visual layout**

- **Header** — partner avatar + name, total messages and conversation count, and a `show / hide thoughts` toggle.
- **Body** — vertical scroll, auto-scrolls to bottom on load.
  - Inserts a `Day X · outcome` separator chip between conversations (so individual back-and-forths remain visually distinct inside the same thread). Outcome chips are colour-coded: bonding=green, friendly=blue, neutral=gray, reconciliation=teal, conflict=orange, hostile=red.
  - The selected agent's messages appear on the **right** in a blue bubble (rounded except bottom-right). The partner's messages appear on the **left** in gray (rounded except bottom-left).
  - When *show thoughts* is enabled, each bubble shows the speaker's internal `thought` ("💭 …") in italic gray underneath, aligned with the bubble.
- **Empty state** — if the API returns no conversations between the pair, the body shows "No conversations with {partnerName} yet".

**Backend**

A dedicated endpoint was added in [packages/api/src/routes/social.ts](../packages/api/src/routes/social.ts):

```sql
SELECT c.conversation_id, c.tick, c.day, c.topic, c.outcome, c.created_at,
       c.initiator_agent_id, c.target_agent_id, c.turns,
       ia.name AS initiator_name, ta.name AS target_name
FROM social.conversations c
JOIN agents.agents ia ON ia.agent_id = c.initiator_agent_id
JOIN agents.agents ta ON ta.agent_id = c.target_agent_id
WHERE (c.initiator_agent_id = $1 AND c.target_agent_id = $2)
   OR (c.initiator_agent_id = $2 AND c.target_agent_id = $1)
ORDER BY c.tick ASC
LIMIT $3
```

The general `/agents/:id/conversations` endpoint deliberately omits the (potentially large) `turns` JSONB and only returns `turn_count`. The new `/conversations/with/:partnerId` endpoint is the one place where `turns` is shipped, and only for the two-agent slice — keeping payloads small while making the merged thread possible in a single round-trip.

**Type augmentation note**

Building the API package now requires a `src/types/fastify.d.ts` declaration that augments `FastifyInstance` with the `authenticate` decorator and types `request.user` for the JWT plugin. See [packages/api/src/types/fastify.d.ts](../packages/api/src/types/fastify.d.ts).

