# 24-Hour Soak Test Results (Phase 9 / Task 9.1)

This document is filled in by the operator after running the simulation
for ≥24 wall-clock hours under default settings (8 agents, 50×50 world).
Replace the `< ... >` placeholders with the actual values from the run.

## Run metadata

| Field | Value |
|-------|-------|
| Run started | `<YYYY-MM-DD HH:MM TZ>` |
| Run ended | `<YYYY-MM-DD HH:MM TZ>` |
| Total wall time | `<HH:MM>` |
| Branch / commit | `<branch @ sha>` |
| Node version | `<output of `node --version`>` |
| LLM provider + model | `<provider / model>` |
| Simulation tick interval | `<ms>` |
| Initial agents | `<n>` |
| World size | `<50 / other>` |

## How it was run

```bash
# 1. Boot infra
npm run docker:up
npm run db:migrate
npm run db:seed       # writes .genesis-world-id

# 2. Start simulation + API + web in one terminal
npm run dev

# 3. In a second terminal, start the soak monitor
npm run soak:monitor -- \
  --api http://localhost:3001 \
  --interval 60 \
  --out docs/soak/soak-<date>.csv

# 4. Leave running ≥24h. Ctrl+C the monitor to stop.
```

## Acceptance criteria

| Criterion | Status | Notes |
|-----------|:----:|-------|
| Process did not crash | ☐ | |
| Memory did not grow unboundedly (RSS plot is bounded) | ☐ | |
| Tick p99 latency under 5 seconds | ☐ | |
| No unhandled promise rejections in logs | ☐ | |
| Tick lock skips < 1% of attempts | ☐ | |
| LLM circuit breaker did not stay open > 5 min | ☐ | |

## Observed statistics

Pull these from the final row of the CSV plus a quick query on the DB:

| Stat | Value |
|------|-------|
| Final tick | `<n>` |
| Final day | `<n>` |
| Alive agents at end | `<n>` |
| Dead agents at end | `<n>` |
| Deaths by starvation | `<n>` |
| Deaths by dehydration | `<n>` |
| Deaths by exhaustion | `<n>` |
| Conversations total | `<n>` |
| Trades total | `<n>` |
| Wars declared | `<n>` |
| Skirmishes total | `<n>` |
| Chronicles generated | `<n>` |
| Beliefs founded | `<n>` |
| Structures built | `<n>` |
| Reproduction events | `<n>` |
| Tick lock skips | `<n>` |
| Circuit-breaker open events | `<n>` |

## Tick-duration distribution

Pull p50/p95/p99 from `[Simulation] Tick … ms` lines in the logs:

| Percentile | Latency (ms) |
|------------|--------------|
| p50 | |
| p95 | |
| p99 | |

## Memory growth

Attach the CSV's `rss_mb` column plotted over time, OR record the
linear-regression slope (MB/hour). Sustained positive slope = leak suspect.

| Metric | Value |
|--------|-------|
| Initial RSS (MB) | |
| Final RSS (MB) | |
| Slope (MB/hour) | |
| Max observed RSS (MB) | |

## LLM cost

| Field | Value |
|-------|-------|
| Provider invoices captured | ☐ |
| Total Claude tokens (input) | `<n>` |
| Total Claude tokens (output) | `<n>` |
| Total cost (USD) | `<$>` |
| Cost per in-game day (USD) | `<$>` |

## Issues observed

Anything anomalous from the run — flaky tests, recoverable errors,
unexpected behaviour. Each item should be either reproduced and filed
in the issue tracker, or added to `FOLLOWUPS.md`.

1. <issue>
2. <issue>
3. ...

## Verdict

- [ ] PASS — all acceptance criteria met
- [ ] PASS WITH NOTES — acceptance met but issues filed for follow-up
- [ ] FAIL — see issues; soak must be re-run after fixes
