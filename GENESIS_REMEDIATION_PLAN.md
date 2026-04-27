# Project Genesis — Remediation & Stabilization Plan

> **Purpose of this document**
> This file is the authoritative implementation spec for stabilizing Project Genesis before any new features are added. It is written for Claude Code (or any AI coding agent) to execute task-by-task. Each task includes acceptance criteria, edge cases, and verification steps.
>
> **Operating principles for the executing agent:**
> 1. **Base branch is `dev`** (not `main`). Before starting any phase, ensure `dev` is clean — commit and push any in-flight work first.
> 2. **One branch per feature (or tightly-related feature set)**, named `stabilization/<phase>-<slug>` (e.g. `stabilization/1-decay-rate`, `stabilization/1-romantic-state`, `stabilization/4-resilience` if grouping circuit-breaker + logging + timeouts). A single task that stands alone gets its own branch; closely related tasks within a phase may share one branch when separating them would create artificial churn. Use judgment, but err on the side of smaller, more reviewable branches.
> 3. **Checkpointing is at the phase level.** A phase is "done" only after every feature branch belonging to it has been implemented, tested, reviewed, and merged into `dev`. Do not proceed to the next phase until all branches from the current phase are merged.
> 4. Within a phase, do tasks in the order listed. Commit messages: `phase <N> / task <N.M>: <summary>`.
> 5. After each task, run the full test suite and ensure it passes before moving to the next task.
> 6. If a task reveals additional bugs, document them in `FOLLOWUPS.md` rather than expanding scope.
> 7. Every code change must include or update tests. No exceptions.
> 8. Preserve existing behavior unless this spec explicitly says to change it.
> 9. When in doubt, prefer the more conservative interpretation and add a `// TODO(genesis-stabilization)` comment for human review.
>
> **Resumption protocol (so future runs don't re-litigate workflow):**
> - Read this header first; the workflow above is authoritative — do not re-ask the user about branching, scope-per-session, or checkpoint cadence.
> - Check `CHANGELOG.md` `[Unreleased]` and the **Phase Progress Tracker** below to determine which phase is next.
> - If on `dev` with a dirty tree at session start: commit + push the in-flight work to `dev` first, then create the next phase branch.
> - Default session scope: complete one full phase per session unless the user says otherwise.
>
> **Phase Progress Tracker** (update at end of every session):
>
> | Phase | Status | Branches | Merged into `dev` |
> |-------|--------|----------|-------------------|
> | 0 — Preflight & Branch Setup | ready for review | `stabilization/0-preflight` | — |
> | 1 — Critical Correctness Bugs | not started | — | — |
> | 2 — Test Coverage Gaps | not started | — | — |
> | 3 — Concurrency & Transactional Integrity | not started | — | — |
> | 4 — Resilience & Error Handling | not started | — | — |
> | 5 — Frontend Robustness | not started | — | — |
> | 6 — Security Hardening | not started | — | — |
> | 7 — Code Hygiene & Dead Code | not started | — | — |
> | 8 — Developer Experience | not started | — | — |
> | 9 — Verification & Long-Run Testing | not started | — | — |
>
> **Scope of this plan:**
> Bug fixes, correctness issues, reliability hardening, test coverage gaps, and hygiene improvements that exist in the current codebase. This document explicitly excludes new features, scaling work, and platform expansion — those belong to a later roadmap.

---

## Table of Contents

1. [Phase 0 — Preflight & Branch Setup](#phase-0--preflight--branch-setup)
2. [Phase 1 — Critical Correctness Bugs](#phase-1--critical-correctness-bugs)
3. [Phase 2 — Test Coverage Gaps](#phase-2--test-coverage-gaps)
4. [Phase 3 — Concurrency & Transactional Integrity](#phase-3--concurrency--transactional-integrity)
5. [Phase 4 — Resilience & Error Handling](#phase-4--resilience--error-handling)
6. [Phase 5 — Frontend Robustness](#phase-5--frontend-robustness)
7. [Phase 6 — Security Hardening](#phase-6--security-hardening)
8. [Phase 7 — Code Hygiene & Dead Code](#phase-7--code-hygiene--dead-code)
9. [Phase 8 — Developer Experience](#phase-8--developer-experience)
10. [Phase 9 — Verification & Long-Run Testing](#phase-9--verification--long-run-testing)
11. [Appendix A — File Reference Map](#appendix-a--file-reference-map)
12. [Appendix B — Standard Patterns](#appendix-b--standard-patterns)

---

## Phase 0 — Preflight & Branch Setup

### Task 0.1 — Create stabilization branch and tracking issue

**Goal:** Establish a clean branching strategy and a tracking document for follow-ups.

**Steps:**
1. Create a new branch from `main`: `git checkout -b stabilization/main`
2. Create a `FOLLOWUPS.md` at the repo root with the headings: `## Discovered Bugs`, `## Open Questions`, `## Deferred Improvements`.
3. Create a `CHANGELOG.md` at the repo root following [Keep a Changelog](https://keepachangelog.com/) format, with an `## [Unreleased]` section.
4. Commit: `chore: initialize stabilization tracking`

**Acceptance criteria:**
- Branch `stabilization/main` exists.
- `FOLLOWUPS.md` and `CHANGELOG.md` exist at repo root.
- No code changes in this commit.

---

### Task 0.2 — Run baseline test suite and capture state

**Goal:** Establish a known-good baseline before any changes.

**Steps:**
1. From `packages/simulation`, run `npm test` and save full output to `/tmp/baseline-tests.txt`.
2. Run `npm run db:migrate && npm run db:seed` in a clean Docker environment, capture output.
3. Note the test count, duration, and any flaky tests.
4. In `CHANGELOG.md` under `[Unreleased]`, add: `### Baseline\n- Pre-stabilization test count: 152 passing in ~1.2s`.

**Acceptance criteria:**
- Baseline output captured in `/tmp/baseline-tests.txt`.
- `npm run dev` boots successfully against fresh Docker containers.

---

## Phase 1 — Critical Correctness Bugs

These bugs make the simulation produce incorrect or unreachable states. Fix in order; do not parallelize.

### Task 1.1 — Fix the food/water/rest decay rate scaling bug

**Severity:** ⚠️ Critical. Currently breaks the entire simulation premise.

**Location:** `packages/simulation/src/agent/AgentEngine.ts` — the `updateNeeds()` method.

**Current behavior:**
The decay constants are defined as `DECAY.food = 3/1440` (intended: 3 units per 1440-tick day). However, `updateNeeds()` multiplies by 100 per tick: `agent.need_food -= DECAY.food * 100`. This causes ~0.208 units/tick → ~300 units/day, clamped to 100. Agents drain a full bar within roughly 480 ticks (1/3 of a day) and die before any meaningful social interaction occurs.

**Required behavior:**
A full bar should drain over **2 in-game days** under awake conditions. Sleep should reduce decay to 50%. Critical thresholds and HP damage should remain logically related.

**Implementation:**

1. **Remove the `* 100` multiplier.** Awake decay per tick = `DECAY.food` directly.
2. **Recalibrate the constants** so a full bar (100) drains over 2880 ticks (2 days) when awake:
   - `DECAY.food = 100 / 2880` (≈ 0.0347 per tick awake)
   - `DECAY.water = 100 / 2160` (≈ 0.0463 per tick awake — water more urgent than food)
   - `DECAY.rest = 100 / 1440` (≈ 0.0694 per tick awake — rest most urgent)
3. **Sleep modifier:** When `agent.is_sleeping === true`:
   - `food` and `water` decay at 50% rate.
   - `rest` recovers at +0.15 per tick (recovers from 0 to 100 in ~667 ticks ≈ 11 game-hours).
4. **Critical thresholds:** Keep `< 5` triggers HP damage at `1 HP per tick`. Document this in a code comment.
5. **Recovery threshold:** When all needs > 60 AND HP < 100, recover HP at `+0.5 per tick`.
6. **Clamping:** All needs and HP must clamp to `[0, 100]` after every update.

**Edge cases to handle:**

| Case | Expected Behavior |
|------|-------------------|
| Agent sleeps with food=0 | Food stays at 0 (already floored), HP damage continues |
| Agent newly spawned with all needs at 100 | Should survive at least 1.5 in-game days idle |
| Agent eats while food=99 | Capped at 100, no overflow |
| `is_sleeping` toggled mid-tick | Use the value at start of `updateNeeds()`; do not re-check mid-method |
| Multiple needs critical simultaneously | HP damage stacks (1 per critical need per tick) — explicitly document |
| Tick is `0` | No decay applied on the very first tick |

**Tests to add/update:**

Update `AgentEngine.test.ts`:
- `food drains from 100 to 0 over ~2880 awake ticks` — verify within ±5% tolerance
- `water drains from 100 to 0 over ~2160 awake ticks`
- `rest drains from 100 to 0 over ~1440 awake ticks`
- `sleeping halves food/water decay rate`
- `sleeping recovers rest at expected rate`
- `multiple critical needs cause stacked HP damage`
- `recovery only applies when ALL needs > 60`
- `tick 0 produces no decay`

**Acceptance criteria:**
- All new tests pass.
- A 24-hour simulation run (use a fast-forward script) shows agents surviving and engaging in social behavior, not mass starvation.
- The previous test that asserted "food === 0 after 1440 awake ticks" is **removed**, not adjusted.

**Branch:** `stabilization/decay-rate-fix`

---

### Task 1.2 — Fix unreachable `romantic_partner` relationship state

**Severity:** ⚠️ Critical. Blocks reproduction and generations features entirely.

**Location:** `packages/simulation/src/social/RelationshipEngine.ts` — the `determineType()` method.

**Current behavior:**
The check order in `determineType()` evaluates `close_friend` (requires `interaction_count >= 6`) before `romantic_partner`. Since any romance-eligible pair has had many interactions, they always become `close_friend` and never advance to `romantic_partner`. This blocks reproduction, which depends on the romantic state.

**Required behavior:**
Romantic partnership should be reachable when both agents have high mutual trust, high affection, and at least one of them has signaled romantic interest. Once paired, they remain partners until a breakup event.

**Implementation:**

1. **Reorder type determination in `determineType()`** to evaluate in this priority:
   1. `enemy` (existing logic)
   2. `rival` (existing logic)
   3. `romantic_partner` — see new conditions below
   4. `close_friend` (existing logic)
   5. `friend` (existing logic)
   6. `acquaintance` (existing logic)
   7. `stranger` (default)

2. **New `romantic_partner` conditions** (all must be true):
   - `trust >= 80`
   - `affection >= 85`
   - `interaction_count >= 4` (lowered from prior implicit assumption)
   - `is_romantic_candidate === true` — see new field below
   - Neither agent is currently in another `romantic_partner` relationship (monogamy enforcement)

3. **Add `is_romantic_candidate` field to relationships table:**
   - Migration `010_romantic_candidacy.sql`:
     ```sql
     ALTER TABLE relationships ADD COLUMN is_romantic_candidate BOOLEAN NOT NULL DEFAULT FALSE;
     ALTER TABLE relationships ADD COLUMN romantic_started_tick INTEGER NULL;
     CREATE INDEX idx_relationships_romantic ON relationships(world_id, is_romantic_candidate)
       WHERE is_romantic_candidate = TRUE;
     ```

4. **Set the candidacy flag** in `ConversationEngine.computeOutcome()`:
   - When a conversation is classified as `bonding` AND the existing relationship has `affection >= 70` AND both agents have `traits.openness >= 50`, set `is_romantic_candidate = true` for that relationship pair.
   - This is symmetric: setting it for A→B also sets it for B→A.

5. **Monogamy check helper:** Add `RelationshipEngine.hasExistingPartner(agentId): Promise<boolean>` that returns true if the agent is already in any `romantic_partner` relationship.

**Edge cases to handle:**

| Case | Expected Behavior |
|------|-------------------|
| Both agents already partnered to others | `romantic_partner` blocked, falls through to `close_friend` |
| One agent partnered, other not | `romantic_partner` blocked for both, falls through |
| Trust drops below 80 after partnering | Status remains `romantic_partner` (use `romantic_started_tick` to detect this) until trust < 50, then becomes `friend` (a "fading" state) |
| Affection drops below 30 after partnering | Becomes `enemy` if fear > 50, else `acquaintance` (modeling a breakup) |
| Agent dies while partnered | The surviving agent's relationship is updated to a new `widowed` type — see migration 011 below |
| Three-way romance attempt | Strictly first-to-pair wins; subsequent attempts blocked |

6. **Add `widowed` relationship type** in migration `011_widowed_state.sql`:
   ```sql
   ALTER TYPE relationship_type ADD VALUE IF NOT EXISTS 'widowed';
   ```

**Tests to add/update:**

Update `RelationshipEngine.test.ts`:
- `romantic_partner reachable when all conditions met`
- `romantic_partner blocked when either agent already partnered`
- `close_friend takes priority when is_romantic_candidate is false`
- `widowed state set when partner dies`
- `breakup transition when affection drops below 30`

Add new test file `ConversationEngine.romantic.test.ts`:
- `bonding conversation with high affection + openness sets candidacy`
- `bonding conversation with low openness does not set candidacy`
- `candidacy is symmetric across the pair`

**Acceptance criteria:**
- All new tests pass.
- A long-running simulation produces at least one `romantic_partner` pairing within 50,000 ticks under default parameters.
- A pairing produces at least one reproduction event when other reproduction conditions are met.

**Branch:** `stabilization/romantic-state-reachability`

---

### Task 1.3 — Fix `MemoryDecay.consolidateBatch` hidden DB dependency

**Severity:** 🟠 High. Causes silent failures in production when Claude is unreachable.

**Location:** `packages/simulation/src/social/MemoryDecay.ts`.

**Current behavior:**
`consolidateBatch` imports `execute` from `'../db.js'` at module load time. This makes mocking impossible in tests AND means the function has no graceful failure path when the DB or Claude is unavailable.

**Required behavior:**
- Dependencies are injected, not module-imported.
- LLM failures don't crash the consolidation loop; they fall back to a deterministic summary.
- DB failures are caught and retried with exponential backoff up to 3 times.

**Implementation:**

1. **Refactor `MemoryDecay` to accept its dependencies in the constructor:**
   ```typescript
   export interface MemoryDecayDeps {
     db: { execute: (sql: string, params?: unknown[]) => Promise<unknown> };
     llm: LLMClient;
     logger: Logger;
   }

   export class MemoryDecay {
     constructor(private readonly deps: MemoryDecayDeps) {}
     // methods use this.deps.db, this.deps.llm
   }
   ```

2. **Update all call sites** (`AgentEngine`, simulation orchestrator) to pass dependencies.

3. **Wrap LLM call in `consolidateBatch` with a try/catch:**
   - On LLM failure, fall back to: `"Vague memories from Day ${day}: ${memorySummaries.length} events"`.
   - Log the failure with `this.deps.logger.warn({ err, agentId, day }, 'consolidation_llm_failed')`.

4. **Wrap DB calls with retry logic** (use a small helper from `packages/simulation/src/util/retry.ts`):
   ```typescript
   await retry(
     () => this.deps.db.execute(sql, params),
     { attempts: 3, baseDelayMs: 100, maxDelayMs: 1000 }
   );
   ```

5. **Track consolidation state** in a new table:
   - Migration `012_consolidation_state.sql`:
     ```sql
     CREATE TABLE memory_consolidation_runs (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       world_id UUID NOT NULL REFERENCES worlds(id),
       agent_id UUID NOT NULL REFERENCES agents(id),
       day INTEGER NOT NULL,
       status TEXT NOT NULL CHECK (status IN ('pending', 'success', 'failed')),
       error_message TEXT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       completed_at TIMESTAMPTZ,
       UNIQUE (agent_id, day)
     );
     CREATE INDEX idx_consolidation_pending ON memory_consolidation_runs(world_id, status)
       WHERE status = 'pending';
     ```

6. **Idempotency:** On simulation startup, query for any `pending` consolidations whose day < current day and re-run them.

**Edge cases to handle:**

| Case | Expected Behavior |
|------|-------------------|
| Claude returns malformed JSON | Use deterministic fallback, log warning, mark as success (not failed) since we have a fallback |
| DB connection lost mid-batch | Retry up to 3x; if all fail, mark agent's day as `failed` and continue with other agents |
| Agent has zero memories | Skip silently; insert `success` row with note "no memories" |
| Simulation restarts during consolidation | On startup, re-process all `pending` consolidation runs |
| Same agent/day attempted twice | UNIQUE constraint prevents duplicate; second attempt is idempotent no-op |
| Day boundary occurs while consolidation is running | Queue next day's consolidation; do not interrupt current one |

**Tests to add/update:**

Update `MemoryDecay.test.ts`:
- All existing tests should now use injected deps (no module mocking needed)
- `consolidateBatch falls back to deterministic summary when LLM throws`
- `consolidateBatch retries DB on transient failure`
- `consolidateBatch is idempotent when called twice for same agent/day`
- `pending consolidations are re-run on startup`

**Acceptance criteria:**
- No module-level imports of `db.js` in `MemoryDecay.ts`.
- All tests pass without any real DB or HTTP calls.
- A simulation run survives a 30-second simulated Claude outage without losing data.

**Branch:** `stabilization/memory-decay-di`

---

### Task 1.4 — Replace LLM JSON regex fallback with Zod schema validation

**Severity:** 🟠 High. Silent data corruption risk.

**Location:** `packages/simulation/src/llm/providers/AnthropicClient.ts` and the parser methods (`parseDecision`, `parseConversationTurn`, `parseTradeResponse`).

**Current behavior:**
Parsers attempt JSON.parse, fall back to a regex-based extractor, and on total failure return a "safe default" silently. This means malformed LLM output produces no telemetry — the simulation just gets a no-op decision.

**Required behavior:**
- Every parsed object is validated against a Zod schema.
- Validation failures are logged with the original text (truncated to 500 chars).
- A failure-rate metric is exposed.
- Repeated failures trigger a circuit breaker (covered in Task 4.1).

**Implementation:**

1. **Add Zod as a dependency:** `npm install zod` in `packages/simulation`.

2. **Create `packages/simulation/src/llm/schemas.ts`:**
   ```typescript
   import { z } from 'zod';

   export const DecisionSchema = z.object({
     action: z.enum([
       'move', 'rest', 'eat', 'drink', 'speak', 'trade',
       'attack', 'work', 'build', 'research', 'pray', 'idle'
     ]),
     target: z.string().optional(),
     speech: z.string().max(500).optional(),
     direction: z.enum(['north', 'south', 'east', 'west']).optional(),
     trade_offer: z.object({
       offered_items: z.array(z.object({
         item: z.string(),
         quantity: z.number().int().positive()
       })),
       requested_items: z.array(z.object({
         item: z.string(),
         quantity: z.number().int().positive()
       }))
     }).optional(),
     reasoning: z.string().max(300).optional()
   });

   export const ConversationTurnSchema = z.object({
     thought: z.string().max(300),
     speech: z.string().max(500),
     is_ending: z.boolean()
   });

   export const TradeResponseSchema = z.object({
     decision: z.enum(['accept', 'reject', 'counter']),
     thought: z.string().max(300).optional(),
     counter_offer: z.object({
       offered_items: z.array(z.object({ item: z.string(), quantity: z.number().int().positive() })),
       requested_items: z.array(z.object({ item: z.string(), quantity: z.number().int().positive() }))
     }).optional()
   }).refine(
     (data) => data.decision !== 'counter' || data.counter_offer !== undefined,
     { message: 'counter decision requires counter_offer' }
   );

   export type Decision = z.infer<typeof DecisionSchema>;
   export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;
   export type TradeResponse = z.infer<typeof TradeResponseSchema>;
   ```

3. **Update each parser** to use the new schemas:
   ```typescript
   parseDecision(text: string): Decision {
     const cleaned = stripCodeFences(text);
     try {
       const parsed = JSON.parse(cleaned);
       return DecisionSchema.parse(parsed);
     } catch (err) {
       this.logger.warn({
         err: err instanceof Error ? err.message : String(err),
         textPreview: text.slice(0, 500),
         parser: 'parseDecision'
       }, 'llm_parse_failure');
       this.metrics.parseFailures.inc({ type: 'decision' });
       return SAFE_DEFAULT_DECISION;
     }
   }
   ```

4. **Define safe defaults explicitly** in `packages/simulation/src/llm/defaults.ts`:
   ```typescript
   export const SAFE_DEFAULT_DECISION: Decision = {
     action: 'idle',
     reasoning: '[parse failure fallback]'
   };
   ```

5. **Remove the regex fallback entirely.** If JSON.parse fails after fence stripping, go straight to the safe default. The regex was hiding bugs, not fixing them.

6. **Expose a metrics counter** via a simple in-memory `MetricsRegistry` in `packages/simulation/src/observability/metrics.ts`. Will be wired to Prometheus later (out of scope for this task).

**Edge cases to handle:**

| Case | Expected Behavior |
|------|-------------------|
| LLM returns valid JSON but extra fields | Zod's `.parse` rejects by default; use `.passthrough()` only if extra fields are intentional. Strict mode is preferred. |
| LLM returns JSON wrapped in ```` ```json ```` fences | `stripCodeFences()` handles it before validation |
| LLM returns prose followed by JSON | No regex fallback — log as parse failure, use safe default |
| LLM returns `null` or `undefined` | Treated as parse failure, safe default |
| LLM returns valid structure but speech > 500 chars | Zod fails; log and truncate is NOT acceptable — use safe default to maintain signal that something is wrong |
| Multiple JSON blocks in output | First block only is parsed; others ignored |

**Tests to add/update:**

Update `ClaudeClient.test.ts` (rename to `AnthropicClient.test.ts`):
- All existing parser tests should pass with schema validation
- `rejects malformed structure with telemetry`
- `rejects fields exceeding length limits`
- `rejects unknown action verbs`
- `accepts valid trade_offer with nested structure`
- `metrics counter increments on parse failure`

**Acceptance criteria:**
- No regex fallback exists in parser code (`grep -r 'regex' packages/simulation/src/llm/` returns nothing relevant).
- All parser tests pass with Zod validation.
- A simulation run logs parse failure telemetry rather than silently no-op'ing.

**Branch:** `stabilization/zod-llm-validation`

---

### Task 1.5 — Consolidate `PromptBuilder` and `PromptBuilderOptimised`

**Severity:** 🟡 Medium. Maintenance trap; one will drift.

**Location:** `packages/simulation/src/llm/PromptBuilder.ts` and `PromptBuilderOptimised.ts`.

**Current behavior:**
Two parallel implementations exist. Tests cover only the main one. Adding a new field requires editing both files.

**Required behavior:**
A single `PromptBuilder` class with a `mode: 'verbose' | 'compact'` parameter. All section logic is shared; only formatting differs.

**Implementation:**

1. **Create a unified `PromptBuilder`** that takes a `PromptMode` enum at construction time.
2. **Extract section builders** into private methods that accept a mode parameter and return strings.
3. **Use a formatter helper** to switch between verbose (`=== HEADER ===\n...`) and compact (`hdr:value\n`) styles.
4. **Delete `PromptBuilderOptimised.ts`** entirely.
5. **Update all callers** to pass mode based on `OPTIMIZE_PROMPTS` env var (handled by an env config module — see Task 6.3).

**Edge cases to handle:**

| Case | Expected Behavior |
|------|-------------------|
| Mode env var is missing | Default to `verbose` |
| Mode env var has invalid value | Log warning, default to `verbose` |
| Compact mode with empty memory list | Omit the section entirely (saves tokens) |
| Verbose mode with empty memory list | Include "(none)" placeholder |

**Tests to add/update:**

Existing `PromptBuilder.test.ts`:
- All tests should be parameterized over `[verbose, compact]` modes
- New: `compact mode produces fewer tokens than verbose for identical input`
- New: `verbose mode includes section headers; compact uses key:value`

**Acceptance criteria:**
- Only one `PromptBuilder` file exists.
- All 24 PromptBuilder tests still pass, plus new mode-comparison tests.
- Token count for compact mode is at least 60% lower than verbose for the same agent state.

**Branch:** `stabilization/unified-prompt-builder`

---

## Phase 2 — Test Coverage Gaps

The Phase 3+ engines (`GossipEngine`, `GroupEngine`, `KnowledgeEngine`, `BeliefEngine`, `ConflictEngine`, `GovernanceEngine`, `LawEngine`, `EconomyEngine`, `ConstructionEngine`, `TechnologyEngine`, `ChronicleEngine`, `ObserverEngine`) currently have **zero tests**. This phase adds at least skeleton coverage for each.

### Task 2.1 — Establish testing convention for engines

**Goal:** Document and enforce a consistent testing pattern.

**Steps:**

1. Create `packages/simulation/src/__tests__/CONVENTIONS.md` describing:
   - Use sub-classing to expose private methods.
   - Use `vi.fn()` for all I/O.
   - Use shared fixtures from `fixtures.ts`.
   - One test file per engine, named `<EngineName>.test.ts`.
   - Test file structure: `describe(EngineName)` → `describe(method)` → `it(condition)`.

2. Add a coverage threshold to `vitest.config.ts`:
   ```typescript
   test: {
     coverage: {
       thresholds: {
         lines: 70,
         functions: 70,
         branches: 60,
         statements: 70
       }
     }
   }
   ```

**Acceptance criteria:**
- Document exists.
- CI fails if coverage drops below threshold (after Phase 8 sets up CI).

**Branch:** `stabilization/test-conventions`

---

### Task 2.2 through 2.13 — Add test coverage per engine

**Goal:** Each Phase 3+ engine has a dedicated test file with at least the critical paths covered.

**Each engine task follows this template:**

For engine `XEngine` in `packages/simulation/src/<category>/XEngine.ts`:

1. Read the source file to identify:
   - Public methods
   - State machine transitions
   - Computation functions (pure logic)
   - I/O dependencies

2. Create `packages/simulation/src/__tests__/XEngine.test.ts` covering:
   - Each public method's happy path
   - Each state transition (start → end) with explicit conditions
   - Boundary conditions (off-by-one, empty input, null input)
   - Each branch in conditional logic

3. Use mocks for any DB or LLM dependency.

**Specific engines to cover (one task per engine):**

| Task ID | Engine | Critical scenarios |
|---------|--------|---------------------|
| 2.2 | `GossipEngine` | propagation rules, decay over distance, reputation deltas, edge: lone agent (no neighbors) |
| 2.3 | `GroupEngine` | join/leave/form/disband transitions, leadership challenges, edge: group size 0 → disband |
| 2.4 | `KnowledgeEngine` | sharing rules, fact decay, contradiction handling |
| 2.5 | `BeliefEngine` | belief adoption, ritual triggers, sacred site assignment, edge: belief with zero followers |
| 2.6 | `ConflictEngine` | war declaration, skirmish resolution, treaty acceptance, casualty math |
| 2.7 | `GovernanceEngine` | leadership challenge math, exile thresholds, succession on leader death |
| 2.8 | `LawEngine` | proposal → vote → enactment flow, violation detection, edge: tied vote |
| 2.9 | `EconomyEngine` | currency mint, wallet balance, marketplace settlement, edge: insufficient funds |
| 2.10 | `ConstructionEngine` | structure placement validation, resource consumption, partial completion on builder death |
| 2.11 | `TechnologyEngine` | research progress, dependency tree, edge: prerequisite missing |
| 2.12 | `ChronicleEngine` | event aggregation, narrative generation triggers |
| 2.13 | `ObserverEngine` | snapshot integrity, heatmap aggregation, biography prompt construction |

**Acceptance criteria per engine:**
- Test file exists at the expected path.
- All public methods have at least one test.
- All state transitions documented in the engine have a corresponding test.
- Coverage of the engine file is ≥ 70% lines.
- All tests pass without any real DB/Redis/HTTP calls.

**Branches:** `stabilization/test-coverage-<engine-name>` (one per engine).

---

### Task 2.14 — Add integration tests using Testcontainers

**Goal:** Catch issues that unit tests miss by running against real Postgres + Redis.

**Implementation:**

1. Add `@testcontainers/postgresql` and `@testcontainers/redis` as dev dependencies.
2. Create `packages/simulation/src/__tests__/integration/` directory.
3. Add `integration/setup.ts` that spins up Postgres 16 + Redis containers, runs migrations.
4. Add the following integration tests:
   - `integration/agent-lifecycle.test.ts` — spawn agent, run 100 ticks, verify needs decay, verify memories created.
   - `integration/conversation-flow.test.ts` — two agents have conversation, verify relationship updated, verify trade attempted.
   - `integration/reproduction.test.ts` — force conditions for reproduction, verify child agent created with inherited traits.
   - `integration/migration-idempotency.test.ts` — run migrations twice, verify no errors.
   - `integration/world-isolation.test.ts` — create two worlds, verify events from one don't leak into other.
5. Add `npm run test:integration` script.
6. Mark integration tests with a `@integration` tag so they can be excluded from default `npm test`.

**Acceptance criteria:**
- All integration tests pass on a local machine with Docker available.
- `npm test` excludes integration tests by default (fast).
- `npm run test:integration` runs them.

**Branch:** `stabilization/integration-tests`

---

## Phase 3 — Concurrency & Transactional Integrity

### Task 3.1 — Add tick lock to prevent overlapping simulation runs

**Severity:** 🟠 High. Race conditions corrupt agent state.

**Problem:** The simulation tick runs every 5 seconds via `setInterval`. If a tick takes longer than 5 seconds (likely with LLM calls), the next tick fires while the previous is still in progress. Two ticks updating the same agent simultaneously cause:
- Lost writes (one tick's update overwrites the other)
- Phantom moves (agent moves twice)
- Duplicate memory entries
- Non-deterministic relationship deltas

**Implementation:**

1. **Use Redis for the tick lock** in `packages/simulation/src/world/SimulationLoop.ts`:
   ```typescript
   const LOCK_KEY = (worldId: string) => `tick-lock:${worldId}`;
   const LOCK_TTL_SECONDS = 30;

   async function acquireTickLock(redis: Redis, worldId: string): Promise<boolean> {
     const result = await redis.set(LOCK_KEY(worldId), '1', 'NX', 'EX', LOCK_TTL_SECONDS);
     return result === 'OK';
   }

   async function releaseTickLock(redis: Redis, worldId: string): Promise<void> {
     await redis.del(LOCK_KEY(worldId));
   }
   ```

2. **Wrap each tick in lock acquisition:**
   ```typescript
   async function runTick(worldId: string) {
     const acquired = await acquireTickLock(redis, worldId);
     if (!acquired) {
       logger.warn({ worldId }, 'tick_skipped_lock_held');
       metrics.ticksSkipped.inc({ worldId });
       return;
     }
     try {
       await this.executeTick(worldId);
     } finally {
       await releaseTickLock(redis, worldId);
     }
   }
   ```

3. **Lock TTL** is 30 seconds. If a tick exceeds 30s, the lock auto-releases and the next tick runs — with a warning logged.

4. **Per-world locking, not global.** Multiple worlds can tick simultaneously; same world cannot.

**Edge cases to handle:**

| Case | Expected Behavior |
|------|-------------------|
| Process dies mid-tick | Lock auto-expires after 30s, next tick proceeds |
| Redis is unreachable | Tick is skipped (do not run unlocked); log error; alert if sustained |
| Tick takes 31 seconds | Lock expires, next tick may overlap; log warning + metric |
| Multiple Node processes (future) | Per-world lock prevents two processes from ticking same world |

**Tests:**

Add `packages/simulation/src/__tests__/SimulationLoop.test.ts`:
- `tick acquires and releases lock`
- `tick is skipped when lock is held`
- `lock auto-releases after TTL`
- `Redis failure causes tick skip with logged error`

**Acceptance criteria:**
- Tests pass.
- A 1-hour simulation under load shows zero overlapping ticks (verified via metrics).

**Branch:** `stabilization/tick-lock`

---

### Task 3.2 — Wrap multi-table operations in Postgres transactions

**Severity:** 🟠 High. Data integrity bugs on partial failures.

**Problem:** Operations that touch multiple tables (trade execution, reproduction, war resolution) can leave inconsistent state if one query fails. Examples:
- Trade: items deducted from offerer but not added to receiver.
- Reproduction: child agent inserted but family_tree not updated.
- War: casualties recorded but reputation not updated.

**Implementation:**

1. **Add a transaction helper** in `packages/simulation/src/db.ts`:
   ```typescript
   export async function withTransaction<T>(
     fn: (tx: TransactionClient) => Promise<T>
   ): Promise<T> {
     const client = await pool.connect();
     try {
       await client.query('BEGIN');
       const result = await fn(client);
       await client.query('COMMIT');
       return result;
     } catch (err) {
       await client.query('ROLLBACK');
       throw err;
     } finally {
       client.release();
     }
   }
   ```

2. **Identify all multi-table operations** by grep for engines that call `execute` more than once in a method. At minimum, wrap:
   - `TradeEngine.executeTrade` — inventory updates, trade record, relationship delta
   - `EconomyEngine.settle` — wallet debit, wallet credit, transaction record
   - `ConflictEngine.resolveWar` — casualties, reputation, treaty, chronicle
   - `AgentEngine.reproduce` — child insert, family_tree, parent state, world population
   - `GovernanceEngine.exile` — agent state change, group membership removal, event
   - `LawEngine.enact` — law insert, all agent notifications, history record

3. **Pass transaction client through call chain.** Methods that participate in a transaction must accept an optional `tx?: TransactionClient` parameter.

**Edge cases to handle:**

| Case | Expected Behavior |
|------|-------------------|
| Inner query fails | Full rollback, no partial state |
| Connection lost mid-transaction | Postgres auto-rolls back; caller sees error |
| Nested transaction call | Use savepoints or refactor to single transaction; **never** open second transaction inside |
| Long-running transaction | Set statement timeout at session level (10s) to prevent locking |
| Deadlock between two transactions | Catch deadlock error, retry once with jitter |

**Tests:**

For each engine modified, add a test like:
- `executeTrade rolls back inventory updates if trade record insert fails`

**Acceptance criteria:**
- All multi-table operations identified are wrapped in transactions.
- A fault injection test (force a query to fail mid-transaction) verifies rollback.

**Branch:** `stabilization/transactional-integrity`

---

### Task 3.3 — Add Postgres advisory locks for cross-process critical sections

**Goal:** Prepare for future multi-process deployment without rework.

**Implementation:**

1. Add a helper `withAdvisoryLock(lockKey: bigint, fn: () => Promise<T>)` in `packages/simulation/src/db.ts` that uses `pg_advisory_lock` and `pg_advisory_unlock`.
2. Use it for operations that must be globally serialized:
   - World seed (prevent two seeds creating duplicates).
   - Migration runner.

**Acceptance criteria:**
- Helper exists with tests.
- Used in `db:seed` script.

**Branch:** `stabilization/advisory-locks`

---

## Phase 4 — Resilience & Error Handling

### Task 4.1 — Add circuit breakers to LLM calls

**Severity:** 🟠 High. Without this, an LLM provider outage causes a stampede of failing requests.

**Implementation:**

1. **Install `opossum`:** `npm install opossum`.

2. **Wrap each LLM provider client** with a circuit breaker:
   ```typescript
   import CircuitBreaker from 'opossum';

   const breakerOptions = {
     timeout: 15000,
     errorThresholdPercentage: 50,
     resetTimeout: 30000,
     volumeThreshold: 5
   };

   const breaker = new CircuitBreaker(
     (prompt: string) => this.callLLM(prompt),
     breakerOptions
   );

   breaker.fallback(() => SAFE_DEFAULT_DECISION);
   breaker.on('open', () => this.logger.error('llm_circuit_opened'));
   breaker.on('halfOpen', () => this.logger.info('llm_circuit_halfopen'));
   breaker.on('close', () => this.logger.info('llm_circuit_closed'));
   ```

3. **Open state behavior:** All LLM calls return safe defaults immediately. Simulation continues running but agents take "idle" actions.

4. **Half-open state:** A single test request is allowed; if it succeeds, breaker closes.

5. **Per-provider breakers.** Anthropic, OpenAI, Ollama each get their own.

**Edge cases to handle:**

| Case | Expected Behavior |
|------|-------------------|
| Provider returns 429 (rate limited) | Counts as failure; after threshold, breaker opens for 30s |
| Provider returns 500 errors | Counts as failure |
| Provider returns valid response with bad JSON | Counts as failure (per Task 1.4) |
| Provider is slow but eventually succeeds | If under timeout (15s), counts as success |
| First request after reset succeeds | Circuit stays closed |
| First request after reset fails | Circuit re-opens for another 30s |

**Tests:**

Add `packages/simulation/src/__tests__/CircuitBreaker.test.ts`:
- `breaker opens after error threshold`
- `breaker returns fallback when open`
- `breaker enters half-open after reset timeout`
- `breaker closes after successful test request`

**Acceptance criteria:**
- All LLM calls go through a circuit breaker.
- A simulation continues running through a 5-minute simulated outage without crashing.

**Branch:** `stabilization/circuit-breakers`

---

### Task 4.2 — Replace `console.log` with structured logging via Pino

**Implementation:**

1. **Install `pino`:** `npm install pino pino-pretty` (pino-pretty for dev).

2. **Create a logger module** at `packages/simulation/src/observability/logger.ts`:
   ```typescript
   import pino from 'pino';

   export const logger = pino({
     level: process.env.LOG_LEVEL ?? 'info',
     transport: process.env.NODE_ENV === 'development'
       ? { target: 'pino-pretty', options: { colorize: true } }
       : undefined,
     redact: ['*.password', '*.token', '*.api_key', '*.apiKey']
   });
   ```

3. **Add child loggers** for each engine: `const log = logger.child({ engine: 'AgentEngine' })`.

4. **Replace every `console.log/warn/error/info`** in `packages/simulation/` and `packages/api/` with the structured logger.

5. **Standard fields** to include in tick-level logs: `worldId`, `tick`, `agentId` (where applicable), `operation`, `durationMs`, `error`.

**Acceptance criteria:**
- `grep -r 'console\.' packages/simulation/src packages/api/src` returns nothing (except in test files where suppression is acceptable).
- Production logs are valid JSON, one event per line.

**Branch:** `stabilization/structured-logging`

---

### Task 4.3 — Add request timeouts on the API layer

**Problem:** Slow LLM-backed endpoints (e.g., biography generation) can hang the UI indefinitely.

**Implementation:**

1. **Server-side:** Configure Fastify with a connection timeout of 60s and per-route timeouts:
   ```typescript
   const server = Fastify({
     connectionTimeout: 60_000,
     keepAliveTimeout: 5_000
   });

   // Per-route override for slow endpoints
   server.route({
     method: 'GET',
     url: '/agents/:id/biography',
     handler: biographyHandler,
     config: { timeout: 90_000 }
   });
   ```

2. **Client-side (frontend `apiFetch`):** Use `AbortController` with a default 30s timeout, configurable per call:
   ```typescript
   export async function apiFetch(
     url: string,
     options: RequestInit & { timeoutMs?: number } = {}
   ): Promise<Response> {
     const controller = new AbortController();
     const timeoutId = setTimeout(
       () => controller.abort(),
       options.timeoutMs ?? 30_000
     );
     try {
       return await fetch(url, { ...options, signal: controller.signal });
     } finally {
       clearTimeout(timeoutId);
     }
   }
   ```

**Edge cases to handle:**

| Case | Expected Behavior |
|------|-------------------|
| Request times out | Throw `TimeoutError`; UI shows "request took too long, try again" |
| User cancels (navigates away) | Existing AbortController still cleans up correctly |
| Long-running endpoint with explicit timeout | Use the per-call override |
| Streaming responses (SSE/WebSocket) | Timeout does NOT apply; use heartbeats |

**Acceptance criteria:**
- All API routes have a timeout.
- All `apiFetch` calls have a default timeout.
- A simulated slow endpoint (5s sleep) returns timeout error within configured window.

**Branch:** `stabilization/request-timeouts`

---

### Task 4.4 — Fix WebSocket lifecycle (heartbeat, reconnect, cleanup)

**Problems:**
- Connections leak (no cleanup on unmount).
- No reconnection on transient network failures.
- No detection of dead connections (no heartbeat).

**Implementation:**

1. **Server-side heartbeat:** Send a `ping` frame every 30s. Close connection if no `pong` within 10s.

2. **Client-side heartbeat:** Same pattern from the client side.

3. **Reconnection logic in `useWebSocket.ts`:**
   - On `close` event (other than explicit unmount): wait `min(2^attempt * 1000, 30_000)` ms, reconnect.
   - Reset attempt counter on successful connection.
   - Stop after 10 consecutive failures (alert user "lost connection, please refresh").

4. **Cleanup in `useEffect`:**
   ```typescript
   useEffect(() => {
     const ws = new WebSocket(url);
     // ... handlers
     return () => {
       ws.close(1000, 'component_unmount');
     };
   }, [url]);
   ```

5. **Authoritative source for connection state:** A single `connectionState: 'connecting' | 'open' | 'reconnecting' | 'closed' | 'failed'` in the Zustand store.

**Edge cases to handle:**

| Case | Expected Behavior |
|------|-------------------|
| Network drops, comes back in 5s | Auto-reconnect, no user action needed |
| Network drops, doesn't come back | After 10 attempts, show "refresh" UI |
| User closes tab during reconnect | All timers cleared, no memory leak |
| Server sends ping with no client pong | Server closes connection; client detects via close event and reconnects |
| Component unmounts during reconnection | Reconnection cancelled |

**Tests:**

Add `packages/web/src/lib/__tests__/useWebSocket.test.ts` (use `mock-socket` or similar):
- `reconnects on unexpected close`
- `does not reconnect on explicit unmount`
- `gives up after 10 attempts`
- `heartbeat detects dead connection`

**Acceptance criteria:**
- A 1-hour run with intermittent network drops shows the UI auto-recovering.
- No console errors about "WebSocket already in CLOSING state".

**Branch:** `stabilization/websocket-lifecycle`

---

### Task 4.5 — Add rate limiting on API endpoints

**Severity:** 🔴 Critical for cost control.

**Problem:** A single bad actor can drain Anthropic budget by spamming agent creation or task posting.

**Implementation:**

1. **Install `@fastify/rate-limit`:** `npm install @fastify/rate-limit`.

2. **Global rate limit:** 100 requests/minute per IP.

3. **Stricter limits for expensive endpoints:**
   ```typescript
   await server.register(rateLimit, {
     max: 100,
     timeWindow: '1 minute'
   });

   // Per-route stricter limits
   server.post('/auth/register', {
     config: { rateLimit: { max: 5, timeWindow: '1 hour' } }
   }, registerHandler);

   server.post('/onboarding/sessions', {
     config: { rateLimit: { max: 3, timeWindow: '1 hour' } }
   }, onboardingHandler);
   ```

4. **Per-user rate limits** (require auth) for LLM-backed endpoints:
   - Biography generation: 10/hour
   - Conversation initiation: 60/hour

5. **Bypass for trusted IPs** (admin/health checks): allowlist via env var.

**Edge cases to handle:**

| Case | Expected Behavior |
|------|-------------------|
| Burst of legitimate traffic from CDN | Use forwarded IP via `X-Forwarded-For` (when behind proxy) |
| User exceeds limit | 429 response with `Retry-After` header |
| Health check endpoint | Excluded from rate limiting |
| WebSocket connections | Use connection-count limit, not request rate |

**Acceptance criteria:**
- Spam test: 200 requests in 1 minute returns 429 after the 100th.
- Legitimate UI usage stays well below limits.

**Branch:** `stabilization/rate-limiting`

---

## Phase 5 — Frontend Robustness

### Task 5.1 — Add React error boundaries

**Implementation:**

1. **Install** the recommended `react-error-boundary` package.

2. **Create app-level boundary** in `packages/web/src/app/layout.tsx`:
   ```tsx
   <ErrorBoundary
     FallbackComponent={AppErrorFallback}
     onError={(error, info) => logErrorToService(error, info)}
   >
     {children}
   </ErrorBoundary>
   ```

3. **Per-panel boundaries** for each major panel: `WorldMap`, `AgentProfile`, `EventFeed`, `CivilisationPanel`. A crash in one panel should not blank the whole viewer.

4. **Fallback UI** — minimal, friendly: "This panel hit an error. [Reload] [Report]".

**Acceptance criteria:**
- Forcing a render error in a child component shows the fallback, not a white screen.

**Branch:** `stabilization/error-boundaries`

---

### Task 5.2 — Add loading and error states to every async UI

**Goal:** Every component that fetches data must have explicit `loading`, `error`, and `empty` states.

**Implementation:**

1. **Audit** every component using `apiFetch`. List them in `packages/web/AUDIT.md`.

2. For each component:
   - Add a loading skeleton (shimmer or spinner appropriate to the area).
   - Add an error UI with a retry button.
   - Add an empty state (when fetch succeeds but returns nothing).

3. **Standardize via a custom hook** `useAsyncData<T>(fetcher, deps)`:
   ```typescript
   const { data, loading, error, refetch } = useAsyncData(
     () => apiFetch('/agents/' + agentId),
     [agentId]
   );
   ```

**Acceptance criteria:**
- Every list/detail view has all three states implemented.
- Manual test by throttling to "Slow 3G" in DevTools verifies loading states render.

**Branch:** `stabilization/ui-async-states`

---

### Task 5.3 — Replace 12-step onboarding with a single-page wizard

**Problem:** Per-question API round-trips make the onboarding flow fragile. A network drop loses progress.

**Implementation:**

1. **Add a new endpoint** `POST /onboarding/sessions/:id/complete-batch` that accepts all 12 answers + identity in one request:
   ```typescript
   {
     answers: Array<{ question_number: number; answer_index: number }>,
     name: string,
     appearance: string
   }
   ```

2. **Frontend stores answers locally** (Zustand + sessionStorage) until user clicks "Create Agent". Then submits all at once.

3. **Keep the per-question endpoints** for backward compatibility (mark deprecated).

4. **Validate atomicity:** if the batch request fails, the user retries without losing answers.

**Edge cases to handle:**

| Case | Expected Behavior |
|------|-------------------|
| User refreshes mid-onboarding | Answers restored from sessionStorage |
| User closes tab and returns | Answers persisted up to 24 hours |
| User clears browser data | Lost — restart wizard |
| Batch request fails | Show error, keep all answers, allow retry |
| Two tabs open | Last submit wins; warn user |

**Acceptance criteria:**
- A user can complete onboarding offline (after page load) and submit when reconnected.
- Network drop after question 8 doesn't lose answers 1-8.

**Branch:** `stabilization/onboarding-batch`

---

## Phase 6 — Security Hardening

### Task 6.1 — Reject default JWT secret in production

**Problem:** `JWT_SECRET=genesis-jwt-secret-change-in-production` is the default. If anyone deploys without changing it, session forgery is trivial.

**Implementation:**

1. **At server startup**, check:
   ```typescript
   if (process.env.NODE_ENV === 'production' &&
       (process.env.JWT_SECRET === 'genesis-jwt-secret-change-in-production' ||
        !process.env.JWT_SECRET ||
        process.env.JWT_SECRET.length < 32)) {
     console.error('FATAL: JWT_SECRET must be set to a strong secret (32+ chars) in production');
     process.exit(1);
   }
   ```

2. **Enforce secret strength:** must be 32+ characters, ideally entropy-checked.

3. **Provide a helper:** `npm run generate:jwt-secret` outputs `crypto.randomBytes(48).toString('base64')`.

**Acceptance criteria:**
- Server refuses to start in production mode with weak/default secret.
- Helper script generates strong secrets.

**Branch:** `stabilization/jwt-secret-enforcement`

---

### Task 6.2 — Implement JWT refresh token pattern

**Problem:** 7-day JWTs with no refresh = users logged out weekly with no recourse.

**Implementation:**

1. **Two-token model:**
   - Access token: 15-minute expiry, sent via `Authorization: Bearer <token>`.
   - Refresh token: 30-day expiry, stored in HttpOnly secure cookie.

2. **New endpoints:**
   - `POST /auth/refresh` — accepts refresh cookie, returns new access token.
   - `POST /auth/logout` — invalidates refresh token (add to denylist).

3. **Refresh token storage:**
   - Migration `013_refresh_tokens.sql`:
     ```sql
     CREATE TABLE refresh_tokens (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
       token_hash TEXT NOT NULL UNIQUE,
       expires_at TIMESTAMPTZ NOT NULL,
       revoked_at TIMESTAMPTZ,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       last_used_at TIMESTAMPTZ
     );
     CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id) WHERE revoked_at IS NULL;
     ```

4. **Token rotation:** Each refresh issues a new refresh token, old one revoked. Detects token theft (if a revoked token is presented, revoke ALL tokens for that user and force re-login).

5. **Client-side:** On 401 response, automatically attempt refresh; on success, retry original request; on failure, redirect to login.

**Edge cases to handle:**

| Case | Expected Behavior |
|------|-------------------|
| User logs in from second device | Both devices get separate refresh tokens, both valid |
| User clicks "logout everywhere" | All refresh tokens for user revoked |
| Refresh token used after expiry | 401, force re-login |
| Same refresh token presented twice | Detect rotation conflict, revoke all user tokens, force re-login |
| Clock skew between client and server | 30s tolerance window |

**Acceptance criteria:**
- User stays logged in across access-token expiries without manual action.
- Logout invalidates the refresh token.
- Token theft simulation triggers full revocation.

**Branch:** `stabilization/jwt-refresh-tokens`

---

### Task 6.3 — Sanitize user input that flows into LLM prompts

**Problem:** Agent `name` and `appearance` are user-controlled and end up in prompts. A malicious user could inject prompt-control sequences.

**Implementation:**

1. **Allowlist approach for `name`:** alphanumeric + spaces + hyphens + apostrophes, max 40 chars.

2. **Sanitize `appearance`:** strip newlines, code fences, common injection markers. Max 200 chars.

3. **Validation function** in `packages/simulation/src/util/sanitize.ts`:
   ```typescript
   export function sanitizeAgentName(input: string): string {
     return input
       .replace(/[^a-zA-Z0-9 \-']/g, '')
       .trim()
       .slice(0, 40);
   }

   export function sanitizeAppearance(input: string): string {
     return input
       .replace(/[\n\r]/g, ' ')
       .replace(/```/g, '')
       .replace(/<\|.*?\|>/g, '') // common LLM control tokens
       .replace(/\[INST\]|\[\/INST\]/gi, '')
       .trim()
       .slice(0, 200);
   }
   ```

4. **Apply at the API boundary** (in onboarding handlers), not at prompt-building time.

5. **Reject (rather than silently sanitize) if input changes more than 20%** — likely an injection attempt.

**Edge cases to handle:**

| Case | Expected Behavior |
|------|-------------------|
| Name with only emojis | Rejected with message "name must contain letters" |
| Name with SQL injection attempt | Sanitized to harmless string |
| Appearance with prompt-injection payload | Sanitized; if heavy modification, rejected |
| Unicode normalization attacks | Use NFKC normalization before validation |
| Right-to-left text | Allowed but stripped of bidi control chars |

**Acceptance criteria:**
- Penetration test (try classic LLM injection payloads) shows all attempts neutralized.
- Legitimate names like "O'Brien", "Anne-Marie" pass.

**Branch:** `stabilization/input-sanitization`

---

### Task 6.4 — Add idempotency keys to mutating endpoints

**Implementation:**

1. **Accept `Idempotency-Key` header** on all POST/PUT/DELETE endpoints.

2. **If absent**, behavior unchanged (best-effort).

3. **If present**, store `(user_id, idempotency_key, response_hash, status_code)` for 24h. Repeat requests with same key return cached response.

4. Migration `014_idempotency.sql`:
   ```sql
   CREATE TABLE idempotency_records (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id UUID REFERENCES users(id) ON DELETE CASCADE,
     idempotency_key TEXT NOT NULL,
     request_hash TEXT NOT NULL,
     response_status INTEGER NOT NULL,
     response_body JSONB NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (user_id, idempotency_key)
   );
   CREATE INDEX idx_idempotency_cleanup ON idempotency_records(created_at);
   ```

5. **Daily cleanup job** removes records older than 24h.

**Edge cases to handle:**

| Case | Expected Behavior |
|------|-------------------|
| Same key, different request body | Return error 409 (idempotency conflict) |
| Same key, same body, prior success | Return cached response |
| Same key, prior request still in flight | Return 409 with retry-after |
| Anonymous user (no user_id) | Use IP + key combination |

**Acceptance criteria:**
- Double-clicking "register" creates one user, not two.
- Tests verify idempotency for register, agent creation, trade.

**Branch:** `stabilization/idempotency`

---

### Task 6.5 — Add `helmet` and CORS hardening

**Implementation:**

1. **Install `@fastify/helmet`:** sets standard security headers.

2. **CORS config:** strict allowlist of origins (configurable via env `ALLOWED_ORIGINS`).

3. **CSP** (Content Security Policy) for the Next.js app: deny inline scripts/styles except via nonces.

4. **Disable** `X-Powered-By` header.

**Acceptance criteria:**
- `securityheaders.com` rates the API at A or better.

**Branch:** `stabilization/security-headers`

---

## Phase 7 — Code Hygiene & Dead Code

### Task 7.1 — Delete deprecated `ClaudeClient.ts`

**Steps:**
1. Verify no imports remain: `grep -r "ClaudeClient" packages/`.
2. Delete `packages/simulation/src/llm/ClaudeClient.ts`.
3. Delete its test file.
4. Update `MIGRATION_GUIDE.md` to remove the "deprecated" reference.

**Branch:** `stabilization/delete-claude-client`

---

### Task 7.2 — Resolve duplicate `db/` directories

**Steps:**
1. Audit both `db/` (root) and `packages/simulation/src/db/migrations/`.
2. Pick `packages/simulation/src/db/migrations/` as canonical.
3. Move any unique content from root `db/` there.
4. Delete root `db/`.
5. Update `start.sh` and `package.json` scripts.

**Branch:** `stabilization/dedupe-db-folders`

---

### Task 7.3 — Add `LICENSE`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`

**Steps:**
1. Add MIT `LICENSE` file (full text, current year, "Kabilan N").
2. Add `CONTRIBUTING.md` describing branch naming, PR process, test requirements.
3. Add `CODE_OF_CONDUCT.md` (use Contributor Covenant 2.1).
4. Add `.github/ISSUE_TEMPLATE/` with templates for bug, feature, question.
5. Add `.github/PULL_REQUEST_TEMPLATE.md`.

**Branch:** `stabilization/community-files`

---

### Task 7.4 — Move PDF design doc out of source tree

**Steps:**
1. Convert `Project_Genesis_Design_Document.pdf` to markdown if possible (otherwise host externally).
2. Either delete the PDF and add `docs/DESIGN.md`, or move PDF to a separate `docs-archive` repo.
3. Update README to link to the new location.

**Branch:** `stabilization/remove-binary-docs`

---

### Task 7.5 — Use model alias instead of dated version string

**Steps:**
1. Change default in `.env.example` from `claude-haiku-4-5-20251001` to `claude-haiku-4-5` (alias if available; otherwise document the fixed version is intentional).
2. Add a config validator that warns if a dated version is used: "Dated versions deprecate; consider using the alias for automatic patch updates."

**Branch:** `stabilization/model-alias`

---

### Task 7.6 — Document the `start.sh` script or delete it

**Steps:**
1. Read `start.sh`.
2. If it duplicates `npm run dev`, delete it.
3. If it does something extra (e.g., starts Docker, runs migrations, then dev), document it in README and add to `package.json` scripts as `npm run start:full`.

**Branch:** `stabilization/start-script-clarity`

---

## Phase 8 — Developer Experience

### Task 8.1 — Set up GitHub Actions CI

**Implementation:**

1. **Add `.github/workflows/ci.yml`:**
   - On push and PR.
   - Steps: checkout, setup Node 24, install pnpm (after migration in Task 8.2), `pnpm install`, lint, typecheck, test, integration test (with Postgres+Redis services).
   - Coverage reported as PR comment.

2. **Add `.github/workflows/deploy-preview.yml`:**
   - On PR open/update.
   - Deploys to a preview environment (Render, Railway, or Vercel for the web layer).
   - Comments preview URL on PR.

**Acceptance criteria:**
- Every PR runs lint+test+integration in CI.
- Coverage badge in README updates automatically.

**Branch:** `stabilization/ci-setup`

---

### Task 8.2 — Migrate from npm to pnpm

**Steps:**
1. Generate `pnpm-workspace.yaml` from existing workspace config.
2. Run `pnpm import` to convert `package-lock.json` to `pnpm-lock.yaml`.
3. Delete `package-lock.json`.
4. Update CI to use pnpm.
5. Update README install instructions.

**Branch:** `stabilization/pnpm-migration`

---

### Task 8.3 — Replace flat SQL migrations with Drizzle ORM

**Implementation:**

1. **Install Drizzle:** `pnpm add drizzle-orm pg && pnpm add -D drizzle-kit`.
2. **Define schema** in `packages/simulation/src/db/schema/` (one file per domain).
3. **Generate migrations** via `drizzle-kit generate`. Verify they match existing 001-014 SQL files.
4. **Replace runner** with Drizzle's migration runner.
5. **Add rollback support:** generate `down.sql` for each migration.
6. **Type-safe queries:** gradually migrate `db.execute(sql, params)` calls to Drizzle query builder. This is a long migration; aim for engines first (Phase 1 fixes have priority).

**Acceptance criteria:**
- Drizzle schema fully describes the database.
- New schema changes go through `drizzle-kit generate`.
- Existing flat SQL migrations remain runnable for installations that already applied them.

**Branch:** `stabilization/drizzle-orm`

---

### Task 8.4 — Auto-generate `WORLD_ID` for fresh installs

**Problem:** README requires user to copy/paste WORLD_ID after seeding. Half of testers miss this.

**Implementation:**

1. **Modify `db:seed`** to write WORLD_ID to a `.genesis-world-id` file at repo root (gitignored).
2. **Modify `.env` loader** to fall back to this file if `WORLD_ID` is not set in env.
3. **Frontend reads** `WORLD_ID` from `/config` endpoint instead of build-time env, so it always reflects current state.

**Acceptance criteria:**
- Fresh install: `npm run dev` after seed works without any manual env editing.

**Branch:** `stabilization/world-id-autoconfig`

---

### Task 8.5 — Strict TypeScript everywhere

**Steps:**
1. In every `tsconfig.json`, set:
   ```json
   {
     "compilerOptions": {
       "strict": true,
       "noUncheckedIndexedAccess": true,
       "exactOptionalPropertyTypes": true,
       "noImplicitOverride": true,
       "noFallthroughCasesInSwitch": true
     }
   }
   ```
2. Fix all resulting errors.

**Branch:** `stabilization/strict-typescript`

---

## Phase 9 — Verification & Long-Run Testing

### Task 9.1 — 24-hour soak test

**Goal:** Verify simulation stability over time.

**Steps:**
1. Run the simulation for 24 wall-clock hours with default settings (8 agents, 50×50 world).
2. Monitor:
   - Memory usage (should not grow unboundedly)
   - DB row counts (should grow at expected rates)
   - LLM API costs (should match estimates from earlier discussion)
   - Tick duration distribution (p50, p95, p99)
   - Number of tick lock skips (should be near-zero in healthy state)
3. Document findings in `docs/SOAK_TEST_RESULTS.md`.

**Acceptance criteria:**
- Process does not crash.
- No unbounded memory growth.
- Tick p99 latency under 5 seconds.

---

### Task 9.2 — Generate 100 stories

**Goal:** Verify simulation produces interesting emergent behavior.

**Steps:**
1. Run simulation until 100 distinct chronicle entries are generated.
2. Sample 20 entries; manually classify as: interesting / boring / nonsensical.
3. If <60% are interesting, this is a *behavioral* issue (not in scope of stabilization, but flag for follow-up).

**Acceptance criteria:**
- 100 chronicle entries produced.
- Sample report committed to `docs/STORY_QUALITY_SAMPLE.md`.

---

### Task 9.3 — Multi-world isolation test

**Goal:** Verify world boundaries are respected (preparation for multi-world Phase B work later).

**Steps:**
1. Spawn two worlds with the current single-world architecture (will require manual world creation).
2. Run both for 1 hour.
3. Verify no cross-world data leakage:
   - No agents from world A in world B's queries.
   - No events from world A appearing in world B's WebSocket stream.
   - No memories shared across worlds.

**Acceptance criteria:**
- Zero cross-contamination.
- Any failure here documented as a Phase B blocker.

---

### Task 9.4 — Final smoke test checklist

Run this manual checklist before declaring stabilization complete:

- [ ] Fresh `git clone` → `docker compose up -d` → `npm install` → `npm run db:migrate` → `npm run db:seed` → `npm run dev` → working observer at localhost:3000.
- [ ] Register a new account; receives JWT + refresh cookie.
- [ ] Complete onboarding wizard end-to-end; agent appears on map.
- [ ] WebSocket events stream to UI in real-time.
- [ ] Force a network drop (kill localhost connection); UI reconnects within 30s.
- [ ] Two browser tabs show the same world state simultaneously.
- [ ] Force-stop and restart the API server; UI resumes within 30s.
- [ ] Force an LLM provider failure (use bad API key); simulation continues with safe defaults.
- [ ] All tests pass: unit, integration, e2e.
- [ ] No console errors in browser during 30 minutes of normal use.
- [ ] No unhandled promise rejections in server logs.

---

## Appendix A — File Reference Map

This map helps the executing agent locate files quickly.

```
packages/simulation/src/
├── agent/
│   └── AgentEngine.ts                    # Tasks 1.1, 3.2
├── world/
│   ├── WorldEngine.ts
│   ├── MapGenerator.ts
│   └── SimulationLoop.ts                  # Task 3.1
├── social/
│   ├── ConversationEngine.ts             # Task 1.2
│   ├── RelationshipEngine.ts             # Task 1.2
│   ├── TradeEngine.ts                    # Task 3.2
│   └── MemoryDecay.ts                    # Task 1.3
├── cultural/
│   ├── GossipEngine.ts                   # Task 2.2
│   ├── GroupEngine.ts                    # Task 2.3
│   ├── KnowledgeEngine.ts                # Task 2.4
│   └── BeliefEngine.ts                   # Task 2.5
├── conflict/
│   ├── ConflictEngine.ts                 # Task 2.6, 3.2
│   ├── GovernanceEngine.ts               # Task 2.7, 3.2
│   └── LawEngine.ts                      # Task 2.8, 3.2
├── economy/
│   └── EconomyEngine.ts                  # Task 2.9, 3.2
├── civilisation/
│   ├── ConstructionEngine.ts             # Task 2.10
│   ├── TechnologyEngine.ts               # Task 2.11
│   └── ChronicleEngine.ts                # Task 2.12
├── observer/
│   └── ObserverEngine.ts                 # Task 2.13
├── llm/
│   ├── LLMFactory.ts
│   ├── PromptBuilder.ts                  # Task 1.5 (consolidate)
│   ├── PromptBuilderOptimised.ts         # Task 1.5 (delete)
│   ├── schemas.ts                        # Task 1.4 (NEW)
│   ├── defaults.ts                       # Task 1.4 (NEW)
│   └── providers/
│       ├── AnthropicClient.ts            # Tasks 1.4, 4.1
│       ├── OpenAIClient.ts               # Task 4.1
│       ├── OllamaClient.ts               # Task 4.1
│       └── HuggingFaceClient.ts          # Task 4.1
├── observability/
│   ├── logger.ts                         # Task 4.2 (NEW)
│   └── metrics.ts                        # Task 1.4 (NEW)
├── util/
│   ├── retry.ts                          # Task 1.3 (NEW)
│   └── sanitize.ts                       # Task 6.3 (NEW)
└── db/
    ├── schema/                           # Task 8.3 (NEW with Drizzle)
    └── migrations/
        ├── 001_init.sql
        ├── ...
        ├── 010_romantic_candidacy.sql    # Task 1.2 (NEW)
        ├── 011_widowed_state.sql         # Task 1.2 (NEW)
        ├── 012_consolidation_state.sql   # Task 1.3 (NEW)
        ├── 013_refresh_tokens.sql        # Task 6.2 (NEW)
        └── 014_idempotency.sql           # Task 6.4 (NEW)

packages/api/src/
├── index.ts                              # Tasks 4.3, 4.5, 6.1, 6.5
└── routes/
    ├── auth.ts                           # Tasks 6.1, 6.2
    ├── onboarding.ts                     # Tasks 5.3, 6.3
    ├── worlds.ts
    └── ...

packages/web/src/
├── app/
│   ├── layout.tsx                        # Task 5.1
│   ├── viewer/
│   ├── login/
│   └── register/
├── components/                           # Task 5.2 (per-component audit)
└── lib/
    ├── auth.ts                           # Task 4.3
    ├── store.ts
    └── useWebSocket.ts                   # Task 4.4
```

---

## Appendix B — Standard Patterns

### B.1 Logger usage

```typescript
import { logger } from '@/observability/logger';

const log = logger.child({ engine: 'AgentEngine' });

log.info({ agentId, tick }, 'agent_decision_start');
log.warn({ err, agentId }, 'llm_parse_failure');
log.error({ err }, 'fatal_error');
```

Never log raw user input without sanitization. Never log API keys (the redaction config handles common keys, but be careful with custom field names).

### B.2 Error class pattern

Define a base error class and extend for specific cases:

```typescript
export class GenesisError extends Error {
  constructor(message: string, public readonly code: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'GenesisError';
  }
}

export class LLMParseError extends GenesisError {
  constructor(message: string, public readonly rawText: string, cause?: unknown) {
    super(message, 'LLM_PARSE_ERROR', cause);
    this.name = 'LLMParseError';
  }
}
```

### B.3 Test fixture override pattern

```typescript
// fixtures.ts
export function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-1',
    name: 'Alice',
    // ... defaults
    ...overrides
  };
}

// in test:
const agent = makeAgent({ need_food: 5, hp: 30 }); // critical state
```

### B.4 Async operation with timeout

```typescript
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message = 'operation_timeout'
): Promise<T> {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}
```

### B.5 Database transaction pattern

```typescript
import { withTransaction } from '@/db';

await withTransaction(async (tx) => {
  await tx.query('UPDATE agents SET hp = hp - $1 WHERE id = $2', [damage, agentId]);
  await tx.query('INSERT INTO events (...) VALUES (...)', [...]);
  // If either fails, both are rolled back.
});
```

### B.6 Migration template

```sql
-- Migration: NNN_short_description.sql
-- Description: One-line summary of what this migration does.
-- Author: [name]
-- Date: YYYY-MM-DD

BEGIN;

-- Forward migration
ALTER TABLE foo ADD COLUMN bar TEXT;

-- Always include a verification query at the end (commented for now):
-- SELECT COUNT(*) FROM foo WHERE bar IS NOT NULL; -- should be 0 right after migration

COMMIT;
```

Companion `down/NNN_short_description.sql`:

```sql
BEGIN;
ALTER TABLE foo DROP COLUMN bar;
COMMIT;
```

---

## Final Notes for the Executing Agent

1. **Order matters.** Phases 0 → 1 → 2 → ... → 9. Do not skip ahead.
2. **One PR per task.** Small, reviewable, revertible.
3. **If a task is blocked,** document in `FOLLOWUPS.md` and move on; do not silently skip.
4. **Update `CHANGELOG.md`** under `[Unreleased]` for every PR.
5. **Each PR description must include:**
   - Task ID this addresses
   - Summary of changes
   - Test additions/modifications
   - Manual verification steps performed
   - Any deviations from this spec (with justification)
6. **Run all tests locally** before opening any PR.
7. **Do not modify this document** during execution. If the spec is wrong, document it in `FOLLOWUPS.md` for human review.

When all phases are complete, the simulation should run reliably for days, agents should produce interesting emergent behavior, and the codebase should be ready for the next phase: platform features.

---

**End of Stabilization Spec — v1.0**
