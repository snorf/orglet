---
phase: 13-roll-ups-over-formula-fields
plan: 04
subsystem: schema
tags: [rollup, formula, sql, unnest]
requires: ["13-01"]
provides:
  - "rollupSelectSql/rollupBackfillSql optional VirtualChildren parameter (derived table over unnest)"
  - "isFormulaRollup(schema, field)"
  - "VirtualRows, VirtualChildren types"
affects: [13-05, 13-06, 13-07, 13-08]
key-files:
  modified:
    - packages/schema/src/rollup.ts
    - packages/schema/src/rollup.test.ts
    - packages/schema/src/index.ts
key-decisions:
  - "Formula inputs are aliased under their column name inside the derived table, so aggregate() and filterSql() are untouched"
requirements-completed: [ROLL2-01]
duration: 10min
completed: 2026-10-24
---

# Phase 13 Plan 04: Roll-up SQL over formula values Summary

The roll-up SQL builder now aggregates over formula values evaluated in TypeScript: the child relation becomes `(SELECT c0.*, round(v.col, scale) AS col FROM child c0 JOIN unnest(ids, vals...) AS v("_orglet_id", ...) ON v."_orglet_id" = c0."id") c`, while roll-ups over stored columns produce byte-identical SQL.

## Tasks
1. Derived-table SQL, `scaled()` rounding (D-05), `isFormulaRollup`, exports and tests (see commit below).

## Deviations from Plan
None in behaviour. The tests passed on first run, so no separate RED commit was made (tests and implementation are in one commit).

## Verification
`npx vitest run packages/schema`: 101 passed, 2 skipped, 4 todo (pre-existing scaffolds). The pglite test confirms three 0.3333 values at scale 2 sum to 0.99. eslint clean on the three files; tsc reports nothing in the touched files. `pnpm build` was not run (parallel-execution rule).

## Commits
- feat(13-04): roll-up SQL over evaluated formula values via unnest derived table

## Self-Check: PASSED
