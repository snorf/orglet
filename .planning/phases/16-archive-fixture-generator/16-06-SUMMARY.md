---
phase: 16-archive-fixture-generator
plan: 06
subsystem: archive, examples
tags: [fixture, archive, test, verification]
requires: [16-05]
provides:
  - "packages/archive/src/fixture.test.ts: determinism, committed-equality, MD5, index load and story tests"
  - "Phase 16 gate: fixture verified and approved by Johan"
affects: [17, 18, 20, 21]
key-files:
  created: [packages/archive/src/fixture.test.ts]
  modified: []
decisions:
  - "No generator fixes were needed; hand-written expectations matched the committed fixture"
requirements-completed: [FIX-01]
metrics:
  tasks: 2
  completed: 2026-11-21
---

# Phase 16 Plan 06: Fixture proof and review Summary

A fixture test proves the acme-archive fixture is deterministic, equal to the committed tree, MD5-consistent, loadable through the index and tells the intended story; Johan reviewed and approved the fixture, including a manual Postgres 16 load.

## Tasks
1. Fixture test (determinism, committed equality, MD5, index load, story) and phase gate: c0eb12f
2. Human review of README, size and optional Postgres 16 load: approved by Johan 2026-11-21 (no commit)

## Verification
- `pnpm vitest run packages/archive`: 9 files / 64 tests passed
- `pnpm build`, `pnpm lint`, `pnpm typecheck:scripts` ok
- `pnpm test`: 69 files, 1112 passed, 4 pre-existing skips
- `pnpm archive-fixture:check`: "checked 35 files", exit 0 (re-run at close-out); `git status --porcelain examples/acme-archive` empty after `archive-fixture:gen`
- Fixture: 232 KB, 35 files (index.sql, README.md, 4 blobs under Period=0/files, 29 CSVs); Period=202601 has 16 CSVs, Period=202602 has 13
- Task 2: Johan ran index.sql against the dev Postgres 16 container in a scratch schema (`fixture_check`) with no errors. It created csvfiles, objects and backup_runs, and the schema was then dropped (CASCADE reported those 3 tables).

## Deviations from Plan
None - plan executed exactly as written. No README or seed changes requested.

## Known Stubs
None.

## Self-Check: PASSED
