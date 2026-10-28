---
phase: 13-roll-ups-over-formula-fields
plan: 02
subsystem: formula
tags: [rollup, formula, dependency-walk]
requires: ["13-01"]
provides:
  - "formulaInputs: transitive same-object stored inputs of a field, formulas walked inner-first, cycle path"
  - "dependencyOrder: Kahn ordering of compiled formulas, residual cycles in declaration order"
affects: [13-03, 13-06, 13-07]
key-files:
  created:
    - packages/formula/src/rollup-inputs.ts
    - packages/formula/src/rollup-inputs.test.ts
  modified:
    - packages/formula/src/index.ts
key-decisions:
  - "Both functions are pure over a dependency lookup; cross-object entries (path.length > 0) are ignored, admission rejects them separately"
requirements-completed: [ROLL2-01]
duration: 8min
completed: 2026-10-24
---

# Phase 13 Plan 02: Formula input walk and evaluation order Summary

Pure `formulaInputs` and `dependencyOrder` in `@orglet/formula`, terminating on formula cycles, ready for admission (03), engine (06) and backfill (07).

## Tasks
1. + 2. 2169908: both functions, 11 tests, barrel exports. Committed together because both live in the same new file and test file.

## Deviations from Plan
None. `pnpm build` not run (parallel-execution rule); tests (11 pass), eslint on packages/formula/src and tsc on touched files are clean.

## Self-Check: PASSED
