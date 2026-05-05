# Project Genesis

> An autonomous AI civilization simulator — a living world where Claude-powered agents survive, form relationships, build societies, and evolve without human intervention.

---

## What Is This?

Project Genesis is a **multi-agent simulation** where AI agents live inside a procedurally-generated world. Each agent has needs (food, water, rest), traits (optimism, empathy, aggression…), memories, and social relationships. Every few seconds, agents independently perceive their environment, reason about what to do, and act — using Claude as their "brain."

Over time, agents form friendships, trade resources, found groups, spread gossip, wage wars, write laws, mint currency, build structures, and develop belief systems — all emergent, not scripted.

You observe through a real-time web UI. You cannot interfere.

---

## Features

| Layer | What it does |
|-------|-------------|
| **Survival** | Need decay (food/water/rest), HP damage, agent death |
| **Social** | Multi-turn Claude conversations, relationship engine (trust/fear/affection), trade negotiations |
| **Memory** | Importance-weighted decay, daily consolidation via LLM, **per-partner narrative memory** so agents recall past conversations about specific people (not just generic top-N) |
| **Knowledge** | Gossip propagation, reputation scoring, knowledge sharing |
| **Groups** | Form/join/leave factions, group leadership, defection |
| **Conflict** | Wars, skirmishes, raids, peace treaties |
| **Governance** | Leadership challenges, exile, law proposals/votes/enactment |
| **Economy** | Currencies, wallets, marketplace transactions |
| **Culture** | Belief systems, rituals, sacred sites, myths, pilgrimages |
| **Civilisation** | Construction, technology research, chronicles |
| **Observer** | World snapshots, heatmaps, agent biographies, weather |
| **Generations** | Reproduction records, trait drift events, family trees |
| **Fog of war** | Cumulative per-world exploration — only tiles walked by a living agent are revealed to observers |
| **Accounts** | User registration / login (JWT), per-user agent ownership, subscription tier field |
| **Onboarding wizard** | 12 scenario-based "soul questions" that accumulate 19 trait modifiers and derive a custom archetype for each user-created agent |

### Stabilization (Phases 0–5 complete)

Project Genesis is undergoing a phased stabilization pass tracked in
`GENESIS_REMEDIATION_PLAN.md` (local-only, gitignored). The first six phases
have shipped to `dev`; everything below is in production:

| Layer | Hardening |
|-------|-----------|
| **Correctness** | Recalibrated need-decay rates, reachable `romantic_partner` state with monogamy + post-pairing transitions + `widowed`, dependency-injected MemoryDecay with retry + idempotent consolidation runs, Zod-validated LLM payloads (no more silent regex fallback), unified `PromptBuilder` with verbose/compact modes |
| **Resilience** | Per-world Redis tick lock, Postgres transaction + advisory-lock helpers, opossum circuit breaker on Anthropic calls, structured Pino logging with redaction, request timeouts (server + client), WebSocket heartbeat + exponential-backoff reconnect, `@fastify/rate-limit` on auth and onboarding |
| **Frontend** | `react-error-boundary` at app + per-panel level, `useAsyncData` hook + `LoadingSpinner` / `InlineError` / `EmptyState` primitives, single-shot batch onboarding endpoint backed by sessionStorage draft store |
| **Tests** | 156 → **306 passing** unit tests across 25 files; coverage thresholds (70/70/60/70) configured for `npm run test:coverage` |
| **Migrations** | `011_romantic_candidacy.sql`, `012_widowed_state.sql`, `013_consolidation_state.sql` |

See [`CHANGELOG.md`](./CHANGELOG.md) for the full per-phase breakdown and
[`FOLLOWUPS.md`](./FOLLOWUPS.md) for tracked deferrals.

---

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Simulation engine | TypeScript + Node.js |
| AI / LLM | Anthropic Claude (Haiku by default) — also OpenAI, Ollama, HuggingFace |
| Database | PostgreSQL 16 + pgvector |
| Cache / pub-sub | Redis |
| API server | Fastify (REST + WebSocket) |
| Observer UI | Next.js 14 App Router + Tailwind CSS + Canvas |
| Build system | Turborepo (npm workspaces) |

---

## Prerequisites

- **Node.js 20+**
- **Docker + Docker Compose** (for Postgres & Redis)
- **Anthropic API key** — get one at [console.anthropic.com](https://console.anthropic.com)
- (Optional) OpenAI / HuggingFace key, or Ollama for local models

---

## Quick Start

### One-command startup (Recommended)

**Linux / macOS:**
```bash
./start.sh
```

**Windows — PowerShell (most reliable):**
```powershell
# Allow scripts (first time only):
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Then run:
.\start.ps1
```

**Windows — Command Prompt:**
```cmd
start.bat
```

This script does everything:
1. 🧹 Cleans up old Node processes
2. 🐳 Starts Docker (PostgreSQL + Redis)
3. 📦 Installs dependencies
4. 📊 Runs database migrations
5. 🌍 Seeds a new world (if needed) and auto-updates `.env`
6. 🚀 Starts all services (API + Web + Simulation)

Then open **[http://localhost:3000](http://localhost:3000)** → Log in → Enter World.

### Stop everything

**Linux / macOS:**
```bash
./kill.sh
```

**Windows:**
```cmd
kill.bat
```

---

### Manual setup (if you prefer)

**1. Clone and install**

```bash
git clone <repo-url>
cd Project-Genesis
npm install
```

**2. Configure environment**

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```env
ANTHROPIC_API_KEY=sk-ant-...    # Required
LLM_PROVIDER=anthropic
LLM_MODEL=claude-haiku-4-5-20251001
OPTIMIZE_PROMPTS=true           # Token optimization (default: on)
```

**3. Start infrastructure**

```bash
docker compose up -d
```

**4. Run migrations**

```bash
npm run db:migrate
```

**5. Seed the world**

```bash
npm run db:seed
```

Copy the printed `WORLD_ID` into `.env`:

```env
WORLD_ID=<paste-here>
NEXT_PUBLIC_WORLD_ID=<paste-here>
```

**6. Start dev servers**

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) → **Create account** → **Enter World** to reach the observer at `/viewer`.

---

## Environment Variables

```env
# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://genesis:genesis_secret@localhost:5432/genesis
REDIS_URL=redis://localhost:6379

# ── LLM ───────────────────────────────────────────────────────────────────────
LLM_PROVIDER=anthropic          # anthropic | openai | ollama | huggingface
LLM_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=                 # Optional
HUGGINGFACE_API_KEY=            # Optional
OLLAMA_BASE_URL=http://localhost:11434  # If using Ollama

# ── Simulation ─────────────────────────────────────────────────────────────────
SIMULATION_TICK_INTERVAL_MS=5000   # Time between ticks (ms)
WORLD_SIZE=50                      # Map size (50 = 50×50 tiles)
INITIAL_AGENTS=8                   # Starting population
OPTIMIZE_PROMPTS=false             # true = ~150-250 tokens/decision vs ~600-800

# ── World ─────────────────────────────────────────────────────────────────────
WORLD_ID=<uuid>                    # Set after db:seed
NEXT_PUBLIC_WORLD_ID=<uuid>

# ── Server ────────────────────────────────────────────────────────────────────
NODE_ENV=development
API_PORT=3001
WEB_PORT=3000
JWT_SECRET=genesis-jwt-secret-change-in-production
JWT_EXPIRES_IN=7d
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001/ws
```

---

## LLM Provider Options

### Anthropic (Default — Recommended)

```env
LLM_PROVIDER=anthropic
LLM_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=sk-ant-...
```

Best balance of quality and cost. Claude Haiku is fast and inexpensive (~$0.80/1M tokens).

### Ollama (Local — Zero Cost)

```bash
# Install: https://ollama.ai
ollama pull llama2   # or mistral, phi, etc.
ollama serve
```

```env
LLM_PROVIDER=ollama
LLM_MODEL=llama2
OLLAMA_BASE_URL=http://localhost:11434
```

Great for development. No API costs. Quality varies by model and hardware.

### OpenAI

```bash
npm install openai   # install optional SDK
```

```env
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o
OPENAI_API_KEY=sk-...
```

### HuggingFace

```env
LLM_PROVIDER=huggingface
LLM_MODEL=meta-llama/Llama-2-7b-chat-hf
HUGGINGFACE_API_KEY=hf_...
```

---

## Token Optimisation

Token optimisation is **enabled by default** (`OPTIMIZE_PROMPTS=true`). This selects the compact mode of the unified `PromptBuilder` — ~150–250 tokens per decision prompt instead of ~600–800 — reducing API costs at scale with minimal quality loss.

Compact mode:
- Terse `key:value` lines instead of `=== HEADER ===` blocks
- Omits empty sections
- Caps memories at 3, nearby agents at 3, knowledge facts at 3
- Abbreviated JSON schema

`OPTIMIZE_PROMPTS=false` (or `verbose`) selects the prose-style mode.
Unknown values warn and fall back to verbose. The current setting is shown in
the observer UI under **Settings** (gear icon).

> Stabilization 1.5 collapsed the original `PromptBuilder` and
> `PromptBuilderOptimised` classes into a single `PromptBuilder` whose
> `mode` parameter selects rendering — same callers, half the maintenance.

---

## Repository Structure

```
Agent-world/
├── packages/
│   ├── simulation/              # Core simulation engine
│   │   └── src/
│   │       ├── agent/           # AgentEngine (PERCEIVE→DECIDE→EXECUTE)
│   │       ├── world/           # WorldEngine, MapGenerator
│   │       ├── social/          # ConversationEngine, RelationshipEngine, TradeEngine, MemoryDecay
│   │       ├── cultural/        # GossipEngine, GroupEngine, KnowledgeEngine, BeliefEngine
│   │       ├── conflict/        # ConflictEngine, GovernanceEngine, LawEngine
│   │       ├── economy/         # EconomyEngine
│   │       ├── civilisation/    # ConstructionEngine, TechnologyEngine, ChronicleEngine
│   │       ├── observer/        # ObserverEngine (snapshots, heatmap, biographies)
│   │       ├── llm/             # LLM abstraction layer
│   │       │   ├── LLMFactory.ts
│   │       │   ├── PromptBuilder.ts           # Unified verbose/compact via constructor mode
│   │       │   ├── schemas.ts                 # Zod schemas for decision/conversation/trade
│   │       │   ├── defaults.ts                # SAFE_DEFAULT_* parse-failure sentinels
│   │       │   ├── breaker.ts                 # Shared opossum CircuitBreaker config
│   │       │   └── providers/   # AnthropicClient (Zod + breaker), OpenAIClient, OllamaClient, HuggingFaceClient
│   │       ├── observability/   # logger.ts (Pino), metrics.ts (counters)
│   │       ├── util/            # retry.ts (exponential backoff)
│   │       ├── world/           # WorldEngine, MapGenerator, SimulationLoop (Redis tick lock)
│   │       ├── db.ts            # query/queryOne/execute + withTransaction + withAdvisoryLock
│   │       └── __tests__/       # 306 tests, 100% passing (CONVENTIONS.md, integration/)
│   │
│   ├── api/                     # Fastify REST + WebSocket server
│   │   └── src/
│   │       ├── index.ts         # App entry, JWT plugin, WebSocket fan-out
│   │       └── routes/          # auth, onboarding, worlds, agents, social, civilisation, settings
│   │
│   └── web/                     # Next.js 14 observer UI
│       └── src/
│           ├── app/
│           │   ├── page.tsx       # Landing / marketing page
│           │   ├── login/         # /login
│           │   ├── register/      # /register
│           │   └── viewer/        # /viewer — auth-gated simulation UI
│           ├── components/
│           │   ├── WorldMap.tsx          # Canvas map with zoom/pan + fog of war
│           │   ├── AgentProfile.tsx      # 5 tabs: status/relations/group/history/family
│           │   ├── ChatThreadModal.tsx   # WhatsApp-style merged chat thread between two agents
│           │   ├── EventFeed.tsx         # Real-time event stream
│           │   ├── StatsBar.tsx          # Top bar with world stats
│           │   ├── CivilisationPanel.tsx # Left sidebar: wars/beliefs/laws/chronicle
│           │   ├── WarPanel.tsx
│           │   ├── BeliefPanel.tsx
│           │   ├── LawPanel.tsx
│           │   ├── ChroniclePanel.tsx
│           │   ├── FamilyTree.tsx        # Ancestry / descendants tree
│           │   ├── ConversationModal.tsx # Single-conversation transcript (legacy)
│           │   ├── CreateAgentModal.tsx  # 12-question soul-wizard → spawn your agent
│           │   └── SettingsModal.tsx     # Shows current config & optimize status
│           ├── components/
│           │   ├── ErrorFallbacks.tsx    # AppErrorFallback + PanelErrorFallback
│           │   └── AsyncStates.tsx       # LoadingSpinner, InlineError, EmptyState
│           ├── app/app-boundary.tsx      # Client-only ErrorBoundary wrapper for layout.tsx
│           └── lib/
│               ├── auth.ts                # Zustand auth + apiFetch (AbortController, ApiTimeoutError)
│               ├── store.ts               # Zustand world store + connectionState
│               ├── useWebSocket.ts        # Heartbeat + exponential-backoff reconnect
│               ├── useAsyncData.ts        # Standard four-state async hook
│               └── onboardingDraft.ts     # sessionStorage-backed draft for batch onboarding
│
├── docker-compose.yml           # Postgres + Redis
├── .env                         # Configuration (see above)
├── .env.example                 # Template
├── LLM_PROVIDER_SETUP.md        # Detailed LLM provider guide
├── MIGRATION_GUIDE.md           # Provider migration guide
└── TEST_REPORT.md               # Full test coverage report
```

---

## Database Migrations

Migrations live in `packages/simulation/src/db/migrations/` and run in order:

| File | Phase | Contents |
|------|-------|---------|
| `001_init.sql` | Phase 1 | Worlds, agents, tiles, resources, memories, events, `auth.users` + `auth.onboarding_sessions` |
| `002_phase2.sql` | Phase 2 | Conversations, relationships, trades |
| `003_phase3.sql` | Phase 3/4 | Knowledge, groups, gossip, reputation |
| `004_phase5.sql` | Phase 5 | Wars, skirmishes, treaties |
| `005_phase6.sql` | Phase 6 | Belief systems, myths, rituals, sacred sites |
| `006_phase5_civilisation.sql` | Phase 5 | Laws, currencies, wallets, technologies, structures, chronicles |
| `007_phase6_observer.sql` | Phase 6 | Snapshots, heatmaps, biographies |
| `008_generations.sql` | Generations | Reproduction records, trait drift events |
| `009_fog_of_war.sql` | Fog of war | `worlds.explored_tiles` — per-tile first-seen tick + first-observer agent |
| `010_partner_memory.sql` | Partner memory | Adds `partner_agent_ids[]` (GIN-indexed) + nullable `embedding VECTOR(1536)` (ivfflat) to `memory.episodic_memories` for per-partner memory recall and future semantic retrieval |
| `011_romantic_candidacy.sql` | Stabilization 1.2 | `is_romantic_candidate` flag + `romantic_started_tick` on `social.relationships`. Unlocks the `romantic_partner` state machine. |
| `012_widowed_state.sql` | Stabilization 1.2 | Adds `widowed` to the `relationship_type` CHECK constraint so a surviving partner's relationship can transition cleanly on death. |
| `013_consolidation_state.sql` | Stabilization 1.3 | New `memory.consolidation_runs` table with `(agent_id, day)` UNIQUE so MemoryDecay's daily consolidation is idempotent and pending runs can be resumed on startup. |

---

## API Endpoints

### Auth
- `POST /auth/register` — create account, returns `{ token, user }`. Rate-limited to **5/hour/IP**.
- `POST /auth/login` — returns JWT token. Rate-limited to **10/min/IP** (brute-force protection).
- `GET /users/me` — current user + the agents they have created (requires `Authorization: Bearer <token>`)

> All endpoints share a global **100 req/min/IP** limit via `@fastify/rate-limit`.
> `/health` and `/ws` are explicitly allowlisted. Tunable via `API_RATE_LIMIT_GLOBAL_MAX`.

### Onboarding (agent creation wizard)
- `POST /onboarding/sessions` — start a session (`mode` = `discover` | `design` | `random`). Rate-limited to **3/hour/user**.
- `GET /onboarding/sessions/:id/questions/:n` — fetch question `n` of 12 (options only; trait values hidden)
- `POST /onboarding/sessions/:id/answers` — submit `{question_number, answer_index}`, accumulate traits
- `POST /onboarding/sessions/:id/identity` — set agent `name` + `appearance`
- `POST /onboarding/sessions/:id/complete` — finalise: compute archetype, spawn the agent, seed starting inventory/skills
- `POST /onboarding/sessions/:id/complete-batch` *(new in stabilization 5.3)* — submit all 12 answers + identity in one shot. Rate-limited to **5/hour**. Backed by the frontend's sessionStorage `useOnboardingDraft` store so a refresh or network drop never loses progress.

### Worlds
- `GET /worlds` — list all non-archived worlds
- `GET /worlds/:id` — world info + live population stats (alive/dead, avg hp/food/water)
- `GET /worlds/:id/map` — tiles + resource nodes + `explored_tiles` (fog-of-war reveal set)
- `GET /worlds/:id/explored?since=<tick>` — incremental fog-of-war: tiles revealed after a given tick
- `GET /worlds/:id/agents` — all alive agents
- `GET /worlds/:id/groups` — all groups
- `GET /worlds/:id/events` — recent events

### Agents
- `GET /agents/:id` — agent details
- `GET /agents/:id/memories` — agent memories
- `GET /agents/:id/relationships` — relationships
- `GET /agents/:id/conversations` — summary list of conversations the agent was in (no transcript)
- `GET /agents/:id/conversations/with/:partnerId` — full merged transcript of every conversation between two specific agents (turns included). Powers the WhatsApp-style chat thread.
- `GET /agents/:id/biography` — LLM-generated biography
- `GET /agents/:id/family` — ancestry + descendants
- `GET /agents/:id/beliefs` — agent's beliefs
- `GET /agents/:id/trait-drift` — trait drift events

### Social
- `GET /worlds/:id/conversations` — recent conversations

### Civilisation
- `GET /worlds/:id/wars` / `GET /wars/:id`
- `GET /worlds/:id/skirmishes`
- `GET /worlds/:id/treaties`
- `GET /worlds/:id/laws` / `GET /worlds/:id/violations`
- `GET /worlds/:id/currencies`
- `GET /worlds/:id/technologies`
- `GET /worlds/:id/structures`
- `GET /worlds/:id/chronicles` / `GET /chronicles/:id`
- `GET /worlds/:id/beliefs` / `GET /beliefs/:id`
- `GET /worlds/:id/myths`
- `GET /worlds/:id/sacred-sites`
- `GET /worlds/:id/rituals`
- `GET /worlds/:id/snapshots`
- `GET /worlds/:id/heatmap`
- `GET /worlds/:id/reproductions`

### Config
- `GET /config` — current simulation configuration

### WebSocket
- `ws://localhost:3001/ws` — real-time event stream.
- **Heartbeat:** server sends `pong` every 30s and closes the socket if no
  client message arrived in 45s. The client (in `useWebSocket.ts`) sends a
  `ping` every 30s and gives up on the socket if nothing comes back within
  10s. On unexpected close the client reconnects with exponential backoff
  capped at 30s, transitioning to a `failed` state after 10 attempts.

---

## Tests

```bash
cd packages/simulation
npm test            # run all tests
npm run test:watch  # watch mode
npm run test:coverage
```

**306 tests, 100% passing** across 25 test files. No real DB, Redis, or API
calls in tests — fully isolated with Vitest mocks and sub-classing. Conventions
are documented in `packages/simulation/src/__tests__/CONVENTIONS.md`.

Coverage thresholds (lines/functions/statements 70, branches 60) live in
`vitest.config.ts` and apply to `npm run test:coverage`. Phase 8 will wire CI
to enforce them on PRs.

Integration tests against real Postgres + Redis containers are scaffolded under
`packages/simulation/src/__tests__/integration/`; see the directory README for
status (waiting on Docker + `@testcontainers/*` install).

---

## NPM Scripts

From the repo root:

```bash
npm run dev          # Start API + web in dev mode (hot reload)
npm run build        # Build all packages
npm run db:migrate   # Run SQL migrations
npm run db:seed      # Seed initial world + agents
npm run test         # Run simulation tests
```

---

## Observer UI Guide

| Element | Description |
|---------|-------------|
| **World Map** (center) | Canvas rendering of the 50×50 world. Scroll to zoom, drag to pan. Agents shown as colored dots (color = mental state). Unexplored tiles are rendered dark — the fog lifts incrementally as agents walk (polled every 5s). |
| **Stats Bar** (top) | Day, tick, time-of-day, population count, current username with logout. Gear icon → Settings. ✨ icon → Create-agent wizard. |
| **Civilisation Panel** (left, collapsible) | Wars, active beliefs, laws, chronicles. Click ▶ to expand. |
| **Agent Profile** (right top) | Click any agent dot to open. 5 tabs: Status, Relations, Group, **History**, Family Tree. The History tab lists every chat partner as a single row (avatar · name · last topic · day · ± outcome counts · total). |
| **Chat Thread Modal** | Click a partner row in the History tab to open a WhatsApp-style scrollable thread. Every conversation between the two agents is merged into one chronological feed; "Day X · outcome" separators divide individual conversations. The selected agent's messages appear right-aligned in blue, the partner's left-aligned in gray. Toggle "show thoughts" in the header to see each speaker's internal thought beneath their message. |
| **Event Feed** (right bottom) | Real-time stream of agent actions, conversations, trades, conflicts. |
| **Create-Agent Modal** | 12 soul questions → name/appearance → your agent is spawned into the world with traits derived from your answers. |
| **Settings Modal** | Shows active LLM provider, model, prompt optimisation status (enabled by default), and tick interval. |

---

## Concepts

### Agent Loop (every tick)
1. **Update** — decay needs, damage HP, check death
2. **Perceive** — see nearby agents, resources, world state
3. **Decide** — Claude generates a JSON action based on a rich context prompt
4. **Execute** — move, gather, rest, talk, trade, gossip, form/join groups, and more

### Mental States
Computed every tick from need levels + HP (see `AgentEngine.computeMentalState`):

| State | Trigger |
|-------|---------|
| `desperate` | food < 10, water < 10, or HP < 20 |
| `tired` | rest < 10 while awake (or rest < 25) |
| `anxious` | food or water < 25 |
| `stressed` | food or water < 40 |
| `lonely` | belonging < 15 |
| `depressed` | belonging < 25 |
| `content` | food > 80, water > 80, rest > 70, belonging > 60 |
| `hopeful` | belonging > 70 and esteem > 60 |
| `alert` | default — nothing critical, nothing great |

### Relationship Types
`stranger → acquaintance → friend → close_friend / rival / enemy / romantic_partner`

Trust, fear, affection, and respect scores shift based on conversation outcomes, trade results, gossip, and conflict.

---

## Accounts & Onboarding

Project Genesis now ships with a full user-account layer on top of the simulation:

- **Registration & login.** Email + username + bcrypted password, JWT-signed sessions (`@fastify/jwt`). Tokens are persisted in `localStorage` via Zustand's `persist` middleware.
- **Per-user agent ownership.** `agents.agents.created_by_user_id` is populated when a user spawns their own agent. The user's `agents_created_count` and `agents_alive_count` are bumped automatically.
- **The 12 "soul questions".** A server-authoritative onboarding wizard (see [onboarding.ts](packages/api/src/routes/onboarding.ts)). Each question has four options, each option applies a set of trait modifiers (e.g., `{empathy: +25, self_preservation: -15}`). After all 12 answers, traits are clamped to `[0,100]` and an archetype is computed — e.g., *"The Hopeful Caregiver"*, *"The Cautious Observer"*. On completion the API finds a passable, unoccupied spawn tile, inserts the agent + traits + state + starting inventory (20 food, 15 water) + the `foraging:1` skill.

The same 12 questions are mirrored in [CreateAgentModal.tsx](packages/web/src/components/CreateAgentModal.tsx) so the client can render the wizard offline, but all trait accumulation happens server-side — you can't cheat your archetype.

---

## Fog of War

`worlds.explored_tiles` is a cumulative per-world reveal set. Every agent tick stamps every tile in its 6-tile perception radius. Once any living agent has witnessed a tile, it stays revealed to observers forever — even if the agent dies.

- `/worlds/:id/map` returns the full explored set on initial load.
- `/worlds/:id/explored?since=<tick>` is polled every 5s by the viewer for incremental reveal; only newly-stamped tiles come back, and the client merges them with dedup by `(x,y)`.
- Unexplored tiles are rendered as solid dark squares on the canvas.

---

## Memory Architecture

Each agent has three layers of recall, all backed by `memory.episodic_memories`:

1. **Generic recent memory** — top 3 by importance, regardless of subject. Pulled into every conversation prompt as a "what's on your mind" slot.
2. **Per-partner memory** — when a conversation ends, both participants record a memory tagged with the other agent's ID in `partner_agent_ids[]`. The summary includes day, outcome, and topic ("Day 7: had a bonding conversation with Sage about *foraging berries*"). When two agents talk again, each side's prompt includes a "what you remember about ${partner}" block, queried in O(log n) via a GIN index.
3. **Past-conversation history** — the last 3 conversations between this exact pair (day · outcome · topic snippet) are pulled from `social.conversations` and shown in a "your past conversations with ${partner}" block. This is what stops agents introducing themselves on every meeting.

The schema also has a nullable `embedding VECTOR(1536)` column on `episodic_memories` (ivfflat-indexed for cosine similarity) ready for semantic recall — when filled, agents will retrieve memories by *meaning* (e.g. "memories where I felt betrayed") rather than by tag or recency. Generation is opt-in and not yet wired to a provider.

---

## Roadmap

### In progress (stabilization)
- [x] Phase 0 — Preflight & branch setup (`914474a4`)
- [x] Phase 1 — Critical correctness bugs (`f6b1134c`)
- [x] Phase 2 — Test coverage gaps (`b733759e`)
- [x] Phase 3 — Concurrency & transactional integrity (`65611ebe`)
- [x] Phase 4 — Resilience & error handling (`37c6e3b7`)
- [x] Phase 5 — Frontend robustness (`d5987e23`)
- [ ] Phase 6 — Security hardening (JWT secret enforcement, refresh tokens, input sanitization, idempotency keys, helmet/CORS)
- [ ] Phase 7 — Code hygiene & dead code (delete `ClaudeClient.ts`, dedupe `db/` directories, LICENSE/CONTRIBUTING)
- [ ] Phase 8 — DX (GitHub Actions CI, pnpm migration, Drizzle ORM, strict TypeScript)
- [ ] Phase 9 — 24-hour soak test + 100-story behavioural sample

### Features (post-stabilization)
- [ ] Performance optimisation for larger populations (100+ agents)
- [ ] Multiple concurrent worlds
- [ ] Rich analytics dashboard (charts, trends, emergent pattern detection)
- [ ] Research tools for studying agent behavior
- [ ] **Memory embeddings** — populate `embedding` column via OpenAI / local model, swap importance-ordered recall for cosine-similarity recall against the current conversation context
- [x] User accounts (registration / login / JWT)
- [x] Fog-of-war observer layer
- [x] Interactive onboarding wizard for user-authored agents
- [x] Per-partner memory recall (no more "Hello stranger!" between agents who already bonded)
- [x] Reachable `romantic_partner` state (and `widowed`, breakup-to-enemy)
