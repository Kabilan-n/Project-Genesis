# Integration tests

Tests in this directory boot real Postgres + Redis containers via
[Testcontainers](https://testcontainers.com/) and exercise engines end-to-end
against actual SQL. They sit out of the default `npm test` run because they
need Docker and take seconds, not milliseconds.

## Running

```sh
npm run test:integration
```

(The script will be added once Testcontainers is wired in — see the deferral
note in `FOLLOWUPS.md`. Until then, this directory is the placeholder agreed
during Phase 2 task 2.14.)

## Planned suites

Per `GENESIS_REMEDIATION_PLAN.md` task 2.14:

- `agent-lifecycle.test.ts` — spawn agent, run 100 ticks, verify needs decay
  and memories persisted.
- `conversation-flow.test.ts` — two agents converse → relationship updated →
  trade attempted.
- `reproduction.test.ts` — force conditions for reproduction, verify child
  agent created with inherited traits.
- `migration-idempotency.test.ts` — run migrations twice, verify no errors.
- `world-isolation.test.ts` — two worlds, no cross-world data bleed.

## Why deferred

Docker daemon was not running during Phase 2; rather than add a dev
dependency we could not verify, we kept the dir + README to make the
expansion mechanical when Docker is back.
