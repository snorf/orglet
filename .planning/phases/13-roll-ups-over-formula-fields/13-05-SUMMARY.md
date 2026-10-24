---
phase: 13-roll-ups-over-formula-fields
plan: 05
subsystem: schema
tags: [rollup, migrate, backfill, marker-table]
requires: ["13-04"]
provides:
  - "_orglet.rollup_backfills marker helpers (ensureRollupBackfillTable, completedRollupBackfills, markRollupBackfilled, dropRollupBackfills, rollupBackfillKey)"
  - "MigrateResult.pendingBackfills"
affects: [13-07]
key-files:
  created:
    - packages/schema/src/backfills.ts
    - packages/schema/src/backfills.test.ts
  modified:
    - packages/schema/src/migrate.ts
    - packages/schema/src/migrate.test.ts
    - packages/schema/src/index.ts
key-decisions:
  - "migrate() routes new roll-up columns that isFormulaRollup into pendingBackfills (sorted by rollupDepth) and never runs SQL for them"
  - "Marker table is created only by ensureRollupBackfillTable (engine step), so migrate's statement list is unchanged"
requirements-completed: [ROLL2-01]
duration: 10min
completed: 2026-10-24
---

# Phase 13 Plan 05: Schema side of formula roll-up backfill Summary

migrate() no longer attempts to backfill roll-ups over formula fields; it reports them in `pendingBackfills` (lower chain level first), and a per-org `_orglet.rollup_backfills` table lets the engine step (plan 07) record completed backfills.

## Tasks
1. Marker helpers + 4 pglite tests - commit 64957c6
2. migrate pendingBackfills + fixture/tests (still exactly 8 UPDATEs, silent second run) - commit ecfe4e7

## Deviations from Plan
None in behaviour. The "no pending backfill" test is placed after the "creates one table per object" test because it reuses the shared org schema and would otherwise pre-create the tables.

## Verification
`npx vitest run packages/schema` passed (all files, run before the test reorder; migrate.test.ts re-run green afterwards); eslint on packages/schema/src clean. `pnpm build` not run (parallel executors share dist/). A pre-existing tsc error exists in migrate.test.ts (generateId keyPrefix string|null), not from this plan.

## Self-Check: PASSED
