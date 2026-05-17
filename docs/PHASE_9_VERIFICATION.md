# Phase 9 — Verification & Long-Run Testing

Phase 9 is the only stabilization phase that an AI agent can't run to
completion inside a session — it requires real wall time (24h), real
Docker, real Anthropic spend, and human-judgment classification of
chronicle quality. This document is the index for the operator running
those tests.

## Deliverables

Four documents, each filled in by the operator while running its task:

| Task | Document | What the operator does |
|------|----------|-----------------------|
| 9.1 | [`SOAK_TEST_RESULTS.md`](./SOAK_TEST_RESULTS.md) | Run the simulation ≥24h, fill in metrics + verdict |
| 9.2 | [`STORY_QUALITY_SAMPLE.md`](./STORY_QUALITY_SAMPLE.md) | Produce 100 chronicles, sample 20, classify |
| 9.3 | [`MULTI_WORLD_ISOLATION.md`](./MULTI_WORLD_ISOLATION.md) | Run two worlds for ≥1h, verify no cross-leak |
| 9.4 | [`SMOKE_TEST.md`](./SMOKE_TEST.md) | Manual click-through of every critical path |

## Tooling that supports them

| Capability | Where |
|-----------|------|
| `/metrics` JSON endpoint | `packages/api/src/routes/metrics.ts` |
| Soak monitor script (CSV polling) | `scripts/soak-monitor.ts`, `npm run soak:monitor` |
| CI workflow (Phase 8) | `.github/workflows/ci.yml` |
| Coverage thresholds | `packages/simulation/vitest.config.ts` |
| Boot guards (Phase 6) | `packages/api/src/index.ts` (`ensureJwtSecret`, `ALLOWED_ORIGINS`) |
| Boot warnings (Phase 7.5) | `packages/simulation/src/llm/LLMFactory.ts` (dated-model alias) |

## Recommended sequence

1. **Smoke test** (9.4) — catches regressions before burning 24h.
2. **Soak test** (9.1) — runs in background. Open the monitor in one
   terminal, leave it.
3. While the soak runs, **start the 100-story collection** (9.2) — same
   simulation can serve both, or use a faster tick interval on a
   side world.
4. After the soak, **multi-world test** (9.3) — needs two simulation
   processes pointed at different `WORLD_ID`s.

## When Phase 9 is complete

When all four result docs are filled in with a verdict (PASS / PASS
WITH NOTES / FAIL) and any failures have either been fixed or filed in
`FOLLOWUPS.md`, the stabilization pass is done.

At that point: tag a release on `dev`, then merge `dev` into `main`.
