# Follow-ups

Bugs, questions, and deferred work discovered during the Genesis stabilization
effort. Items here are not in scope of the current phase — they exist so the
executing agent can stay focused without losing signal.

When closing an item, leave a one-line note pointing at the PR or commit that
resolved it; do not delete the entry.

## Discovered Bugs

- **Plan references missing npm scripts.** `GENESIS_REMEDIATION_PLAN.md` Task 0.2
  asks for `npm run db:migrate && npm run db:seed`, but `package.json` only
  defines `seed` (no `db:migrate`, no `db:seed`). Resolve when Phase 8 (DX) /
  Phase 7 (hygiene) adds proper migration tooling, or sooner if a Phase 1
  migration needs to run.
- **Root `package.json` duplicates `packages/simulation/package.json`.** The
  root file declares `"name": "@genesis/simulation"` and the same scripts —
  there's no workspace orchestration at the root. Likely the result of a copy.
  Phase 8 task 8.2 (pnpm migration) is the natural place to fix this.

## Open Questions

- **Phase 1.2 — `openness` trait does not exist in this schema.** The plan's
  candidacy gate requires "both agents have `traits.openness >= 50`", but the
  trait list in `agents.agent_traits` (and `fixtures.makeTraits`) has no
  `openness`. We proxied with `curiosity` (closest Big-Five-aligned trait).
  Confirm with design owner whether to (a) keep the proxy, (b) add a real
  `openness` column, or (c) average curiosity + creativity.
- **Phase 1.2 — migration numbering shifted by 1.** Plan reserves 010 for
  romantic candidacy and 011 for widowed state, but `010_partner_memory.sql`
  was already in flight (committed `3900abe7`). Final mapping after Phase 6:
  011 = romantic_candidacy (1.2), 012 = widowed_state (1.2),
  013 = consolidation_state (1.3), 014 = idempotency (6.4),
  015 = refresh_tokens (6.2).

## Deferred Improvements

- **Phase 0 / Task 0.2 — migration + seed verification deferred.** Docker
  daemon was not running at baseline-capture time, so `migrate && seed` and
  `npm run dev` boot-against-clean-DB checks were not executed. Re-run when
  Docker is available; the unit-test baseline (156 passing) is captured.
- **Phase 2 / Task 2.14 — Testcontainers integration suite deferred.** Docker
  was unavailable during Phase 2, so the planned `agent-lifecycle`,
  `conversation-flow`, `reproduction`, `migration-idempotency`, and
  `world-isolation` integration tests are not yet written. The directory
  `packages/simulation/src/__tests__/integration/` exists with a README
  describing what to build; the `@testcontainers/postgresql` and
  `@testcontainers/redis` dev deps are NOT installed yet. Pick this up
  before Phase 9's 24-hour soak test.
- **Phase 2 — engine tests are smoke level, not coverage-target level.** The
  per-engine test files added under task 2.2–2.13 cover early-exit guards,
  pure helpers, and decision math for each of the 12 phase-3+ engines. Heavy
  DB orchestration paths (multi-step trade settlement, full conversion flow,
  full conflict resolution) are intentionally left to the integration suite
  above. Coverage thresholds in `vitest.config.ts` may need to be lowered
  if `npm run test:coverage` reports below 70 lines until the integration
  tests land.
- **Phase 1 / Task 1.4 — non-Anthropic providers still use regex fallback.**
  `OpenAIClient`, `OllamaClient`, `HuggingFaceClient`, and the deprecated
  `ClaudeClient.ts` all extract JSON-from-prose with `text.match(/\{[\s\S]*\}/)`
  and ad-hoc field validation. The plan's task 1.4 was scoped to
  AnthropicClient. Apply the same Zod-via-`schemas.ts` rewrite to the other
  providers when Phase 4 task 4.1 (circuit breakers) touches them, or sooner
  if a new provider is wired in. `ClaudeClient.ts` itself is removed by
  Phase 7 task 7.1.
- **Phase 1 / Task 1.4 — `ADDING_PROVIDERS.md` shows the regex pattern.**
  The provider-authoring guide demonstrates the now-deprecated parser style.
  Update when other providers are migrated to Zod.
- **Phase 4 / Task 4.1 — non-Anthropic providers do not yet have a circuit
  breaker.** Same deferral pattern as Phase 1.4's Zod migration: only
  `AnthropicClient` was wrapped this round. Apply `BREAKER_OPTIONS` +
  `attachBreakerEvents` to `OpenAIClient`, `OllamaClient`,
  `HuggingFaceClient` when they next get touched.
- **Phase 4 / Task 4.2 — `console.*` sweep is mostly complete; three files
  intentionally remain.** Migrated: `index.ts`, `breaker.ts`,
  `SimulationLoop.ts`, `AgentEngine`, `db.ts`, `MemoryDecay`,
  `ChronicleEngine`, `ConstructionEngine`, `ObserverEngine`,
  `PromptBuilder`, `AnthropicClient`. Skipped:
    - `seed.ts` — one-shot user-facing CLI script; the console output is
      the operator's UX. Migrate when Phase 8 / Task 8.4 reworks
      `WORLD_ID` autoconfig (operator flow changes anyway).
    - `OpenAIClient` / `OllamaClient` / `HuggingFaceClient` — tied to the
      Phase 4.1 follow-up that wraps these providers in circuit breakers.
    - `ClaudeClient.ts` — deprecated; deleted by Phase 7 / Task 7.1.
- **Phase 5 / Task 5.2 — useAsyncData migration incomplete.** The hook
  + AsyncStates primitives + `packages/web/AUDIT.md` are in place;
  ChroniclePanel is the worked reference. The remaining 11 components
  (AgentProfile, BeliefPanel, ChatThreadModal, CivilisationPanel,
  ConversationHistory, FamilyTree, LawPanel, WarPanel, SettingsModal,
  viewer/page.tsx top-level fetches) still use ad-hoc useState +
  useEffect. Migrate incrementally; track in AUDIT.md.
- **Phase 5 / Task 5.3 — wizard UI rewrite still pending.** The
  `/onboarding/sessions/:id/complete-batch` endpoint exists and the
  frontend `useOnboardingDraft` Zustand slice persists answers to
  sessionStorage, but the actual 12-step wizard pages still POST per
  question. Replace those handlers with `useOnboardingDraft.setAnswer`
  and submit via `useOnboardingDraft.submit()` on the final step.
  Per-question endpoints stay live for backward compat.
- **Phase 6 / Task 6.4 — idempotency record cleanup not yet scheduled.**
  `auth.idempotency_records` rows older than 24h are overwritten naturally
  on key reuse, but unused keys accumulate. Add a daily DELETE pass when
  Phase 8 wires the simulation loop's daily callbacks, or rely on a
  Postgres cron / table-pruning extension. Index `idx_idempotency_cleanup`
  is in place for the eventual sweep.
- **Phase 6 — security headers verification not run.** Plan's 6.5 acceptance
  asks for an A-or-better rating from securityheaders.com. The helmet
  defaults applied should clear that bar, but the actual run requires a
  publicly-reachable deployment; revisit during Phase 9's soak test.
- **Phase 6 — refresh-token client UX on `failed` auth.** apiFetch silently
  clears the auth store on a refresh-rejected 401. The UI doesn't yet route
  to /login automatically when that happens — currently the next render
  just sees `token = null`. Wire a global watcher (Zustand subscribe) in
  layout.tsx that pushes to /login when the token flips to null inside the
  /viewer subtree.
