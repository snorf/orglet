---
phase: 13-roll-ups-over-formula-fields
plan: 06
subsystem: engine
tags: [rollup, formula, engine, pglite]
requires: ["13-01", "13-02", "13-04"]
provides:
  - dependency-ordered formula evaluation (FormulaRegistry.formulaFields, applyFormulaFields(.., only?))
  - RollupBinding.formulaBacked / formulas, watched sets through formula inputs, RollupRegistry.binding(field)
  - DmlEngine.computeRollups / evaluateChildren: formula roll-up recompute in the save pipeline
affects: [13-07]
tech-stack:
  patterns: ["TS-evaluated child formula values handed to SQL aggregate via unnest derived table"]
key-files:
  modified:
    - packages/engine/src/formulas.ts
    - packages/engine/src/formulas.test.ts
    - packages/engine/src/rollups.ts
    - packages/engine/src/engine.ts
    - packages/engine/src/rollups-formula.test.ts
key-decisions:
  - "Stored-field roll-ups keep the single SQL statement; only formula-backed fields load children (D-16)"
requirements-completed: [ROLL2-01]
duration: ~25min
completed: 2026-10-24
---

# Phase 13 Plan 06: Formula roll-up recompute in the engine Summary

Roll-ups over formula fields now recompute on every child DML path: formulas are evaluated in dependency order, the watched set follows formula inputs transitively, and formula-backed roll-ups load the affected parents' live children, evaluate their formulas in TypeScript and aggregate them in SQL through the plan 04 derived table.

## Tasks
1. Dependency-ordered formula evaluation + `only` subset option (e8340d9)
2. RollupRegistry watches formula inputs, `formulaBacked`/`formulas`, `binding(field)` (ac14c2f)
3. `computeRollups`/`evaluateChildren`/`sqlValue` in engine, `recomputeRollups` uses them (5fdff5f)

Verification: `npx vitest run packages/engine` 14 files, 173 passed, 5 todo (the backfill todos for 13-07). eslint clean on touched files; tsc shows no errors in touched files. `pnpm build` was not run (parallel executors, shared dist).

## Deviations from Plan

None in behaviour. Notes:
- The migrate() workaround mentioned for parallel execution was not needed: the fixture creates fresh tables, so migrate() does not backfill and the full schema (with formula roll-ups) migrates fine. 13-07 has nothing to remove.
- The plan's `rollups-formula.test.ts` registry test asserted nine roll-ups on Child__c (not ten); count adjusted in the test.
- Tasks 2 and 3 share engine.ts; the one-line `new RollupRegistry(schema, this.formulas)` change landed in the Task 3 commit rather than Task 2.
- `pnpm build` / `pnpm lint` full runs deferred to the orchestrator/13-07 because of the no-build rule while parallel executors run.

## Known Stubs
None. The five remaining `it.todo` entries are the backfill tests owned by 13-07.

## Self-Check: PASSED
Commits e8340d9, ac14c2f, 5fdff5f present; all five files modified as listed.
