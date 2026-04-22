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
| **Memory** | Importance-weighted memory decay, daily consolidation via LLM |
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

### 1. Clone and install

```bash
git clone <repo-url>
cd Agent-world
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in:

```env
ANTHROPIC_API_KEY=sk-ant-...    # Required

# Everything else has sensible defaults
LLM_PROVIDER=anthropic
LLM_MODEL=claude-haiku-4-5-20251001
```

### 3. Start infrastructure

```bash
docker compose up -d
```

### 4. Run database migrations

```bash
npm run db:migrate
```

### 5. Seed the world

```bash
npm run db:seed
```

Copy the `WORLD_ID` printed to the terminal and add it to `.env`:

```env
WORLD_ID=<paste-here>
NEXT_PUBLIC_WORLD_ID=<paste-here>
```

### 6. Start everything

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll land on the marketing page — click **Create account**, then **Enter World** to reach the observer at `/viewer`. The viewer route is auth-gated; unauthenticated users are redirected to `/login`.

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

Token optimisation is **enabled by default** (`OPTIMIZE_PROMPTS=true`). This uses compact prompts (~150–250 tokens per decision instead of ~600–800), reducing API costs at scale with minimal quality loss.

The optimised builder uses:
- Terse `key:value` syntax instead of prose headers
- Omits empty sections
- Caps memories at 3, nearby agents at 3, knowledge facts at 3
- Abbreviated JSON schema

To disable: set `OPTIMIZE_PROMPTS=false` in your `.env`.

You can verify the current setting in the observer UI under **Settings** (gear icon) in the top bar.

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
│   │       │   ├── PromptBuilder.ts           # Full prompts (~600-800 tokens)
│   │       │   ├── PromptBuilderOptimised.ts  # Compact prompts (~150-250 tokens)
│   │       │   └── providers/   # AnthropicClient, OpenAIClient, OllamaClient, HuggingFaceClient
│   │       ├── db/migrations/   # SQL migrations (001–008)
│   │       └── __tests__/       # 152 tests, 100% passing
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
│           │   ├── EventFeed.tsx         # Real-time event stream
│           │   ├── StatsBar.tsx          # Top bar with world stats
│           │   ├── CivilisationPanel.tsx # Left sidebar: wars/beliefs/laws/chronicle
│           │   ├── WarPanel.tsx
│           │   ├── BeliefPanel.tsx
│           │   ├── LawPanel.tsx
│           │   ├── ChroniclePanel.tsx
│           │   ├── FamilyTree.tsx        # Ancestry / descendants tree
│           │   ├── ConversationModal.tsx
│           │   ├── CreateAgentModal.tsx  # 12-question soul-wizard → spawn your agent
│           │   └── SettingsModal.tsx     # Shows current config & optimize status
│           └── lib/
│               ├── auth.ts       # Zustand auth store + apiFetch helper (JWT)
│               ├── store.ts      # Zustand world store
│               └── useWebSocket.ts
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

---

## API Endpoints

### Auth
- `POST /auth/register` — create account, returns `{ token, user }`
- `POST /auth/login` — returns JWT token
- `GET /users/me` — current user + the agents they have created (requires `Authorization: Bearer <token>`)

### Onboarding (agent creation wizard)
- `POST /onboarding/sessions` — start a session (`mode` = `discover` | `design` | `random`)
- `GET /onboarding/sessions/:id/questions/:n` — fetch question `n` of 12 (options only; trait values hidden)
- `POST /onboarding/sessions/:id/answers` — submit `{question_number, answer_index}`, accumulate traits
- `POST /onboarding/sessions/:id/identity` — set agent `name` + `appearance`
- `POST /onboarding/sessions/:id/complete` — finalise: compute archetype, spawn the agent, seed starting inventory/skills

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
- `GET /agents/:id/conversations` — conversation history
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
- `ws://localhost:3001/ws` — real-time event stream

---

## Tests

```bash
cd packages/simulation
npm test            # run all tests
npm run test:watch  # watch mode
npm run test:coverage
```

**152 tests, 100% passing** across 8 test files covering all core modules. No real DB, Redis, or API calls in tests — fully isolated with Vitest mocks and sub-classing.

See [TEST_REPORT.md](./TEST_REPORT.md) for the full breakdown.

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
| **Agent Profile** (right top) | Click any agent dot to open. 5 tabs: Status, Relations, Group, History, Family Tree. On **Relations** tab, click any relationship to open **Conversation History**. |
| **Conversation History** | Scrollable view of all past conversations between two agents. Left sidebar lists all conversations (sorted newest first) with outcome badges. Right panel shows full transcript with optional thoughts. Helps track relationship evolution. |
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

## Roadmap

- [ ] Performance optimisation for larger populations (100+ agents)
- [ ] Multiple concurrent worlds
- [ ] Rich analytics dashboard (charts, trends, emergent pattern detection)
- [ ] Research tools for studying agent behavior
- [x] User accounts (registration / login / JWT)
- [x] Fog-of-war observer layer
- [x] Interactive onboarding wizard for user-authored agents
