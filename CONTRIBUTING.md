# Contributing to Project Genesis

Thanks for considering a contribution. This document covers branch naming,
the PR process, and the testing bar.

## Branches

The active integration branch is `dev`. Day-to-day work targets `dev`,
not `main`.

- Feature branches: `feature/<short-slug>`
- Bug fixes: `fix/<short-slug>`
- Stabilization work: `stabilization/phase-<N>-<slug>` (one branch per phase).

`main` receives only release-tagged merges from `dev`.

## Local setup

See `README.md` for the full quick-start. Short version:

```bash
git clone <repo>
cp .env.example .env
npm install
npm run docker:up
npm run db:migrate
npm run db:seed
npm run dev
```

## The testing bar

Every code change must include or update tests.

- New engine method → new test in `packages/simulation/src/__tests__/<Engine>.test.ts`.
- Bug fix → a regression test.
- Refactor that touches behaviour → updated tests.

Conventions: `packages/simulation/src/__tests__/CONVENTIONS.md`.

## PR process

1. Branch off `dev`.
2. Make focused commits — one conceptual change per commit.
3. Run the suite locally:
   ```bash
   cd packages/simulation && npm test
   npx tsc --noEmit
   ```
4. Open a PR against `dev` using `.github/PULL_REQUEST_TEMPLATE.md`.
5. CI must be green before merge (once Phase 8 lands the workflow).

## Commit messages

- First line is a one-sentence summary in imperative mood (max ~70 chars).
- Blank line, then a body explaining the *why* — the *what* should be
  obvious from the diff.
- Stabilization commits use `phase <N> / task <N.M>: <summary>`.

## Code style

- TypeScript strict mode everywhere; avoid `any` unless justified in a comment.
- Lowercase event names in structured logs (`agent_died`, not `AgentDied`).
- Engine files own their own logger via `engineLogger('EngineName')`.
- Database writes touching multiple tables go through `withTransaction`.
- LLM calls never hold a transaction open.

## Reporting issues

Use the templates under `.github/ISSUE_TEMPLATE/`.

## Conduct

We follow the Contributor Covenant 2.1. See `CODE_OF_CONDUCT.md`.
