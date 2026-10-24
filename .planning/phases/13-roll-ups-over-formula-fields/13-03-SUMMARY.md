---
phase: 13-roll-ups-over-formula-fields
plan: 03
subsystem: formula
tags: [rollup, formula, admission, diagnostics]
requires: ["13-01", "13-02"]
provides:
  - "admitFormulaRollups(build): post-buildOrgSchema pass dropping roll-ups orglet cannot keep consistent"
affects: [13-08]
key-files:
  created:
    - packages/formula/src/rollup-admission.ts
  modified:
    - packages/formula/src/rollup-admission.test.ts
    - packages/formula/src/index.ts
key-decisions:
  - "Cycles are found by a simple-path DFS from each roll-up through formula and roll-up nodes, requiring at least one formula on the cycle; pure roll-up cycles stay metadata's"
  - "Removal loops to a fixpoint; schema is rebuilt with OrgSchemaImpl each round; no formula roll-up means the input BuildResult is returned as-is"
requirements-completed: [ROLL2-01]
duration: 15min
completed: 2026-10-24
---

# Phase 13 Plan 03: Formula roll-up admission Summary

`admitFormulaRollups` emits UNSUPPORTED:rollup-formula (cross-object, NOW/TODAY/TIMENOW, evaluation-time globals, naming the inner formula via "via"), UNSUPPORTED:rollup-cycle (full path per roll-up) and rollup-target (cascade with cause) through pushDiagnostic.

## Tasks
1. 5616c06: 11 admission tests (RED).
2. Implementation commit (feat(13-03)): admission pass, barrel export; all 11 tests green, formula+metadata suites 337 pass, eslint clean, no tsc errors in touched files.

## Deviations from Plan
None. `pnpm build` not run (parallel-execution rule). CLI wiring and the end-to-end UNSUPPORTED:formula ordering are plan 08.

## Self-Check: PASSED
