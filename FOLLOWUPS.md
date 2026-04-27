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

_None yet._

## Deferred Improvements

- **Phase 0 / Task 0.2 — migration + seed verification deferred.** Docker
  daemon was not running at baseline-capture time, so `migrate && seed` and
  `npm run dev` boot-against-clean-DB checks were not executed. Re-run when
  Docker is available; the unit-test baseline (156 passing) is captured.
