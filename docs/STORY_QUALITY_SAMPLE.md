# Story Quality Sample (Phase 9 / Task 9.2)

After the simulation has produced **100 chronicle entries**, randomly
sample 20 and classify each. If fewer than 60% land as "interesting",
that's a behavioural-quality issue — filed in the issue tracker, NOT in
the stabilization plan (out of scope here).

## How to collect 100 chronicles

`ChronicleEngine.generateChronicle` writes one chronicle every 10 in-game
days when ≥5 significant events occurred. Default tick interval is 5s,
1440 ticks/day → ~2 hours per chronicle. 100 chronicles ≈ 200 hours of
sim time, BUT you can speed this up:

- Lower `SIMULATION_TICK_INTERVAL_MS=100` in `.env` → ~30 minutes
  per chronicle.
- Lower `ERA_LENGTH_DAYS` in `ChronicleEngine.ts` (the constant at the
  top) to e.g. 2 days → 24 minutes per chronicle at default tick rate.

Pull them with:

```sql
SELECT chronicle_id, era_name, era_start_day, era_end_day, narrative
FROM civilisation.chronicles
ORDER BY generated_tick DESC
LIMIT 100;
```

Save to `docs/sample-chronicles.csv` for the sampling step.

## Sampling

Pick 20 chronicles uniformly at random (e.g. `shuf -n 20` on the CSV).
Read each one, classify, fill in the table below.

## Classification

- **interesting**: the chronicle has a clear narrative beat — a war
  resolved, a belief founded, a leader rising, a famine — that a reader
  would remember. Specific names + concrete events.
- **boring**: technically correct but unmemorable. "Day X-Y: the agents
  continued to gather food and rest."
- **nonsensical**: contradicts itself, contradicts the underlying events,
  hallucinates entities that don't exist, or is incoherent prose.

| # | Chronicle ID | Era name | Classification | Notes |
|---|--------------|----------|----------------|-------|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |
| 7 | | | | |
| 8 | | | | |
| 9 | | | | |
| 10 | | | | |
| 11 | | | | |
| 12 | | | | |
| 13 | | | | |
| 14 | | | | |
| 15 | | | | |
| 16 | | | | |
| 17 | | | | |
| 18 | | | | |
| 19 | | | | |
| 20 | | | | |

## Summary

| Classification | Count | % |
|----------------|------:|--:|
| interesting | | |
| boring | | |
| nonsensical | | |
| **total** | 20 | 100 |

## Verdict

- [ ] **PASS** — interesting ≥ 60% (12+/20)
- [ ] **PASS with concerns** — interesting between 50–59%
- [ ] **FAIL** — interesting < 50%, OR nonsensical ≥ 20% (4+/20). File
  behavioural issues against `ChronicleEngine` / prompt template.

## Observations

Free-form notes about what worked and what didn't.
