# Changelog

All notable changes to Project Genesis will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `FOLLOWUPS.md` and `CHANGELOG.md` to track stabilization work and discovered
  issues out-of-band from the main spec.
- `docs/baseline/baseline-tests.txt` capturing pre-stabilization test output.

### Changed
- Stabilization workflow updated in `GENESIS_REMEDIATION_PLAN.md`: branch off
  `dev`, one branch per feature/feature-set, phase-level checkpointing.

### Baseline
- Pre-stabilization unit-test count: **156 passing** across 8 files in ~1.39s
  on `dev` at commit `3900abe7` (vitest 4.1.4, Node on Windows 11).
- Test files: PromptBuilder (23), MapGenerator (16), ClaudeClient (22),
  RelationshipEngine (24), MemoryDecay (17), TradeEngine (12),
  ConversationEngine (17), AgentEngine (25).
- No flaky tests observed in the baseline run.
- Migration + seed verification and `npm run dev` boot test deferred (Docker
  was not running at capture time); see `FOLLOWUPS.md`.
