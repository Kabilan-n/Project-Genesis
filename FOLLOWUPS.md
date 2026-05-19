# Follow-ups

Bugs, questions, and deferred work discovered during the Genesis stabilization
effort. Items here are not in scope of the current phase — they exist so the
executing agent can stay focused without losing signal.

When closing an item, leave a one-line note pointing at the PR or commit that
resolved it; do not delete the entry.

## Discovered Bugs

- ~~Plan references missing npm scripts.~~ **Resolved (Phase 7 audit,
  2026-05-03):** the root `package.json` does define `db:migrate` and
  `db:seed`. The Phase 0 observation looked at
  `packages/simulation/package.json` only.
- ~~Root `package.json` duplicates `packages/simulation/package.json`.~~
  **Resolved (Phase 7 audit, 2026-05-03):** the two are distinct now —
  root is `project-genesis` with workspaces + db scripts; the simulation
  file is `@genesis/simulation` with its build/test scripts.

## Open Questions

- **Phase 1.2 — `openness` trait does not exist in this schema.** The
  plan's candidacy gate requires "both agents have `traits.openness >= 50`",
  but `agents.agent_traits` has no `openness`. We proxied with `curiosity`
  (closest Big-Five-aligned trait). **Still open**: confirm with the
  design owner whether to (a) keep the proxy, (b) add a real `openness`
  column, or (c) average curiosity + creativity. Requires a product
  decision, not a code change.
- ~~Phase 1.2 — migration numbering shifted by 1.~~ **Closed
  informational (followups cleanup):** the final mapping is stable
  across all merged phases. 011 = romantic_candidacy (1.2), 012 =
  widowed_state (1.2), 013 = consolidation_state (1.3), 014 =
  idempotency (6.4), 015 = refresh_tokens (6.2). Any future migration
  picks up at 016.

## Deferred Improvements

### Resolved

- ~~Phase 1 / Task 1.4 — non-Anthropic providers still use regex
  fallback.~~ **Resolved (followups cleanup):** `OpenAIClient`,
  `OllamaClient`, and `HuggingFaceClient` rewritten to use the shared
  `llm/parsing.ts` helpers — Zod schemas, safe defaults, metrics tagged
  by `provider`. No regex extraction-from-prose left in any provider.
- ~~Phase 1 / Task 1.4 — `ADDING_PROVIDERS.md` shows the regex pattern.~~
  **Resolved (followups cleanup):** guide rewritten to demonstrate the
  shared-parser + breaker + safe-default template.
- ~~Phase 4 / Task 4.1 — non-Anthropic providers do not yet have a
  circuit breaker.~~ **Resolved (followups cleanup):** each provider
  now constructs its own per-provider opossum `CircuitBreaker` using
  `BREAKER_OPTIONS` and `attachBreakerEvents` (label set to the
  provider name). `safeCompletion` short-circuits to `null` on
  rejection so the typed endpoints can substitute `SAFE_DEFAULT_*`
  sentinels.
- ~~Phase 4 / Task 4.2 — `console.*` sweep — providers section.~~
  **Resolved (followups cleanup):** `OpenAIClient`, `OllamaClient`,
  `HuggingFaceClient` no longer emit `console.*`. Parsing failures
  log via the structured logger inside `llm/parsing.ts`; call errors
  bump `metrics.llmCallErrors` instead of `console.error`.
- ~~Phase 6 / Task 6.4 — idempotency record cleanup not yet scheduled.~~
  **Resolved (followups cleanup):** the simulation's daily-pass block
  now deletes `auth.idempotency_records` older than 24h and logs the
  count when non-zero (`idempotency_records_pruned` event). Backed by
  `idx_idempotency_cleanup`.
- ~~Phase 6 — refresh-token client UX on `failed` auth.~~ **Resolved
  (followups cleanup):** new `lib/useAuthRedirect.ts` watches the
  Zustand auth token and pushes to `/login?next=<path>` when the token
  clears while the user is inside `/viewer` or `/onboarding`. Mounted
  once in the root `AppBoundary` component so a refresh-token rejection
  no longer leaves the user on a now-unauthenticated protected page.
- ~~Phase 7 / Task 7.3 — community files deferred.~~ **Resolved on its
  own branch (`stabilization/phase-7-3-community`):** LICENSE,
  CONTRIBUTING.md, CODE_OF_CONDUCT.md (linking to Contributor Covenant
  2.1), PR template, and three issue templates.

### Still open (need external resources or major rewrites)

- **Phase 0 / Task 0.2 — migration + seed verification deferred.**
  Docker wasn't running at baseline capture time, so the
  `migrate && seed` and `npm run dev` boot-against-clean-DB checks
  haven't been executed. Re-run when Docker is available.
- **DX — API should warn when migrations look stale.** The
  docker-compose init mount only runs migrations on first volume
  creation, so a `git pull` that adds migrations leaves the DB
  out of date until the operator runs `npm run db:migrate`. Add a
  startup check that compares the count of migration files vs a
  `schema_migrations` tracking table (or queries for the latest
  expected table) and logs a fatal warning if missing.
- **Phase 2 / Task 2.14 — Testcontainers integration suite deferred.**
  Docker still unavailable; the directory exists with a README but
  `@testcontainers/postgresql` + `@testcontainers/redis` aren't
  installed yet. Pick up alongside Phase 9's actual soak run.
- **Phase 2 — engine tests are smoke level, not coverage-target
  level.** Per-engine files cover early-exit guards, pure helpers,
  and decision math. Heavy DB orchestration paths intentionally
  left to the integration suite above. If `npm run test:coverage`
  fails the 70/70/60/70 thresholds after Phase 9 wires CI, lower
  thresholds OR add the integration tests.
- **Phase 4 / Task 4.2 — `seed.ts` still uses `console.*`.** One-shot
  CLI script where the operator reads the terminal output directly;
  migrating to structured JSON logs makes the UX worse. Leave as-is
  unless the script becomes long-running.
- **Phase 5 / Task 5.2 — useAsyncData migration incomplete.** 11
  components in `packages/web/AUDIT.md` still use ad-hoc
  `useState + useEffect`. Migrate incrementally; track in AUDIT.md.
- **Phase 5 / Task 5.3 — wizard UI rewrite still pending.** Endpoint +
  Zustand draft store exist; the 12-step wizard pages still POST per
  question. Replace handlers with `useOnboardingDraft.setAnswer` and
  call `useOnboardingDraft.submit()` on the final step.
- **Phase 6 — security headers verification.** `securityheaders.com`
  scan needs a public deployment. Helmet defaults should clear A;
  revisit during Phase 9's soak.
- **Phase 8 / Task 8.2 — pnpm migration deferred.** Disruptive
  workspace reshuffle; no immediate pain. Wait for a felt need.
- **Phase 8 / Task 8.3 — Drizzle ORM migration deferred.** Multi-week
  scope the plan itself describes as "long". `withTransaction` already
  gives atomic multi-table writes; defer until type-safe queries become
  a felt need.
- **Phase 8 / Task 8.5 — `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes`.**
  `noImplicitOverride` and `noFallthroughCasesInSwitch` are on across
  `@genesis/simulation` and `@genesis/api`. The remaining two surface
  ~43 type errors mostly on array accesses the runtime already guards.
  Enable + fix in a follow-up pass when an actual bug surfaces from
  the lack of these guards.
- **Phase 9 — operator runs not yet executed.** Scaffolding (templates +
  `/metrics` endpoint + soak monitor script) is merged. The actual
  24-hour soak, 100-chronicle sampling, multi-world isolation check,
  and final smoke checklist still need to be run by the operator and
  the four `docs/*.md` templates filled in.
