# Changelog

All notable changes to Project Genesis will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `FOLLOWUPS.md` and `CHANGELOG.md` to track stabilization work and discovered
  issues out-of-band from the main spec.
- `docs/baseline/baseline-tests.txt` capturing pre-stabilization test output.
- `is_romantic_candidate` + `romantic_started_tick` columns on
  `social.relationships` (migration 011).
- `widowed` value added to the `relationship_type` CHECK constraint
  (migration 012).
- `memory.consolidation_runs` table tracking pending/success/failed memory
  consolidation per `(agent, day)`, with idempotent UNIQUE constraint
  (migration 013).
- `packages/simulation/src/util/retry.ts` — exponential-backoff retry helper.
- `packages/simulation/src/llm/schemas.ts` — Zod schemas for decision /
  conversation / trade payloads.
- `packages/simulation/src/llm/defaults.ts` — `SAFE_DEFAULT_*` sentinels.
- `packages/simulation/src/observability/metrics.ts` — minimal in-process
  metrics registry (parse failures, call errors).
- `RelationshipEngine.hasExistingPartner` and `markWidowed` methods.
- `MemoryDecay.resumePendingConsolidations` called once on startup.
- `ConversationEngine.shouldFlagRomanticCandidacy` candidacy-gate check.
- `PromptBuilder.resolvePromptMode` env helper.

### Changed
- Stabilization workflow updated in `GENESIS_REMEDIATION_PLAN.md`: branch off
  `dev`, one branch per feature/feature-set, phase-level checkpointing.
- **AgentEngine.updateNeeds:** decay rates recalibrated; food drains in 2
  in-game days, water in 1.5, rest in 1. Sleep halves food/water decay,
  recovers rest at +0.15/tick. HP damage simplified to 1/tick per critical
  (<5) need; HP recovery to +0.5/tick when all needs strictly above 60.
  Tick 0 (spawn) skips decay.
- **RelationshipEngine.determineType:** romantic_partner now evaluated
  before close_friend, gated on `is_romantic_candidate`. Post-pairing
  transitions added (fade to friend, breakup to acquaintance/enemy).
  Monogamy enforced via `hasExistingPartner` orchestration.
- **MemoryDecay** rewritten for dependency injection (db / llm / logger);
  no module-level imports, retry-wrapped DB writes, deterministic LLM
  fallback summary, structured logging.
- **AnthropicClient parsers** rewritten to use Zod schemas; regex
  extract-from-prose fallback removed; safe defaults are now identifiable
  by the `[parse failure fallback]` marker; metrics increment on failure.
- **PromptBuilder** consolidated: single class with `mode: 'verbose' |
  'compact'`. `PromptBuilderOptimised.ts` deleted. All three callers
  (AgentEngine, ConversationEngine, TradeEngine) updated.

### Removed
- `packages/simulation/src/llm/PromptBuilderOptimised.ts`
  (merged into `PromptBuilder.ts`).
- Regex-extract-from-prose JSON fallback in `AnthropicClient` parsers.

### Dependencies
- `zod@^4.3.6` added to `packages/simulation`.

### Baseline
- Pre-stabilization unit-test count: **156 passing** across 8 files in ~1.39s
  on `dev` at commit `3900abe7` (vitest 4.1.4, Node on Windows 11).
- Test files: PromptBuilder (23), MapGenerator (16), ClaudeClient (22),
  RelationshipEngine (24), MemoryDecay (17), TradeEngine (12),
  ConversationEngine (17), AgentEngine (25).
- No flaky tests observed in the baseline run.
- Migration + seed verification and `npm run dev` boot test deferred (Docker
  was not running at capture time); see `FOLLOWUPS.md`.

### Phase 1 — completion summary
- **End-of-Phase-1 unit-test count: 198 passing** across 11 files in ~0.95s
  (+42 tests from the 156 baseline).
- All five Phase 1 tasks (1.1–1.5) implemented, tested, and merged.

### Phase 5 — completion summary
- Web `react-error-boundary` wrapping: app-level boundary in `layout.tsx`
  (via a client `AppBoundary`) and per-panel boundaries on `WorldMap`,
  `AgentProfile`, `EventFeed`, `CivilisationPanel`. New `AppErrorFallback`
  + `PanelErrorFallback` UIs.
- New `lib/useAsyncData.ts` hook + `components/AsyncStates.tsx` primitives
  (LoadingSpinner, InlineError, EmptyState) for consistent four-state
  rendering. `ChroniclePanel` migrated as the worked reference. Audit of
  all async UI lives in `packages/web/AUDIT.md`.
- New `POST /onboarding/sessions/:id/complete-batch` endpoint accepts
  every answer + identity in one shot; the existing per-question
  endpoints remain live for backward compat.
- New `lib/onboardingDraft.ts` Zustand slice persisted to sessionStorage
  with a 24h TTL — the wizard can recover drafts across refreshes.
- 306 simulation tests still passing (Phase 5 is frontend/API only,
  no new simulation unit tests).

### Phase 4 — completion summary
- **End-of-Phase-4 simulation unit-test count: 306 passing** across 25 files
  (+4 from end of Phase 3, all from CircuitBreaker.test.ts). API/Web changes
  in this phase are runtime concerns without unit-test fixtures.
- New: `llm/breaker.ts` with `BREAKER_OPTIONS` and `attachBreakerEvents`;
  Anthropic LLM calls now flow through an opossum circuit breaker (15s
  timeout, 50% error threshold, 30s reset, 5-call volume threshold).
  `metrics.llmCircuitOpens` and `metrics.llmCircuitRejected` track state.
- New: `observability/logger.ts` (Pino) with redact rules covering
  password / token / api_key / apiKey / secret. `engineLogger(name)`
  produces a child logger per engine.
- `console.*` migrated to structured logs in `index.ts`, `breaker.ts`,
  `SimulationLoop.ts`, `AgentEngine`, `db.ts`, `MemoryDecay`,
  `ChronicleEngine`, `ConstructionEngine`, `ObserverEngine`,
  `PromptBuilder`, `AnthropicClient`. `seed.ts`, the deprecated
  `ClaudeClient.ts`, and the un-migrated providers deliberately retained;
  see `FOLLOWUPS.md`.
- API: Fastify `connectionTimeout=60s`, `keepAliveTimeout=5s`.
- Web: `apiFetch` now AbortController-bound with a default 30s timeout
  (overridable via `timeoutMs`); throws a typed `ApiTimeoutError`.
- WebSocket lifecycle hardened: client-side exponential-backoff
  reconnection (cap 30s, max 10 attempts → `failed` state), 30s heartbeat
  with 10s pong timeout, explicit unmount close + timer cleanup.
  Server-side: per-connection 30s heartbeat with 45s stale-limit cutoff.
- `connectionState` ('connecting' | 'open' | 'reconnecting' | 'closed' |
  'failed') added to the Zustand store as the single authoritative source.
- API rate limiting via `@fastify/rate-limit`: global 100/min/IP (health
  and /ws allowlisted), per-route overrides on `/auth/register` (5/h),
  `/auth/login` (10/min), and `/onboarding/sessions` (3/h/user).

### Phase 3 — completion summary
- **End-of-Phase-3 unit-test count: 302 passing** across 24 files
  (+16 from end of Phase 2).
- New: `world/SimulationLoop.ts` with per-world Redis tick lock
  (`SET NX EX`), TTL 30s, ticks_skipped counter labelled by reason.
- New: `withTransaction(fn)` and `withAdvisoryLock(key, fn)` helpers
  in `db.ts` plus `TransactionClient` interface for tx-scoped queries.
- Trade settlement, exile, and raid resolution wrapped in transactions
  so partial-failure paths roll back instead of leaving inconsistent
  inventory / group / casualty state.
- LLM calls deliberately stay outside transactions.

### Phase 2 — completion summary
- **End-of-Phase-2 unit-test count: 286 passing** across 22 files
  (+88 from end of Phase 1).
- New: `__tests__/CONVENTIONS.md` documenting the testing pattern.
- New: coverage thresholds in `vitest.config.ts` (lines/functions/statements
  70, branches 60). Affect `npm run test:coverage` only — Phase 8 wires CI.
- New: dedicated test file for each of the 12 phase-3+ engines that
  previously had zero tests (GossipEngine, GroupEngine, KnowledgeEngine,
  BeliefEngine, ConflictEngine, GovernanceEngine, LawEngine, EconomyEngine,
  ConstructionEngine, TechnologyEngine, ChronicleEngine, ObserverEngine).
- Tests are smoke level — pure helpers, early-exit guards, classification
  tables. Heavy multi-step DB orchestrations are deferred to the
  integration suite.
- Task 2.14 (Testcontainers integration) deferred — Docker unavailable.
  Directory + README scaffolded; gap logged in `FOLLOWUPS.md`.

### Baseline
- Pre-stabilization unit-test count: **156 passing** across 8 files in ~1.39s
  on `dev` at commit `3900abe7` (vitest 4.1.4, Node on Windows 11).
- Test files: PromptBuilder (23), MapGenerator (16), ClaudeClient (22),
  RelationshipEngine (24), MemoryDecay (17), TradeEngine (12),
  ConversationEngine (17), AgentEngine (25).
- No flaky tests observed in the baseline run.
- Migration + seed verification and `npm run dev` boot test deferred (Docker
  was not running at capture time); see `FOLLOWUPS.md`.
