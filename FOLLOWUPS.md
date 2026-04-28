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
  was already in flight (committed `3900abe7`). New migrations land as
  `011_romantic_candidacy.sql` and `012_widowed_state.sql`; downstream Phase 1
  migrations (consolidation_state, refresh_tokens, idempotency) shift up by 1.

## Deferred Improvements

- **Phase 0 / Task 0.2 — migration + seed verification deferred.** Docker
  daemon was not running at baseline-capture time, so `migrate && seed` and
  `npm run dev` boot-against-clean-DB checks were not executed. Re-run when
  Docker is available; the unit-test baseline (156 passing) is captured.
