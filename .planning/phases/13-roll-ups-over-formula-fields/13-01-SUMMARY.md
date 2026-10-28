---
phase: 13-roll-ups-over-formula-fields
plan: 01
subsystem: metadata, formula, test-scaffolds
tags: [rollup, formula, volatileReasons, wave-0]
requires: []
provides:
  - "buildOrgSchema keeps COUNT/SUM/MIN/MAX roll-ups over formula fields (shape and return type only)"
  - "FormulaDependencies.volatileReasons"
  - "Probes: formula-on-formula cycle, unnest array binding"
  - "it.todo scaffolds for admission, engine recompute/backfill and marker-table tests"
affects: [13-02, 13-03, 13-04, 13-05, 13-06, 13-07, 13-08]
tech-stack:
  added: []
  patterns: ["metadata judges shape; @orglet/formula admitFormulaRollups judges formulas (D-07)"]
key-files:
  created:
    - packages/formula/src/rollup-admission.test.ts
    - packages/engine/src/rollups-formula.test.ts
    - packages/schema/src/backfills.test.ts
  modified:
    - packages/metadata/src/rollup.ts
    - packages/metadata/src/build.test.ts
    - packages/formula/src/compile.ts
    - packages/formula/src/dependencies.test.ts
    - packages/schema/src/pglite-compat.test.ts
key-decisions:
  - "volatileReasons uses canonical display names ($User, TODAY()), sorted and unique, present only when volatile"
requirements-completed: [ROLL2-01]
duration: 15min
completed: 2026-10-24
---

# Phase 13 Plan 01: Formula roll-up gates and Wave 0 scaffolds Summary

Metadata no longer drops roll-ups over formula fields, formula dependencies report why they are volatile, and the Phase 13 test scaffolds and probes are in place.

## Probe outcomes
- **Formula-on-formula cycle compiles: YES.** Two formula fields reading each other each compile; `compileFormula` does not follow a formula field into its own formula, so each lists the other as a read in `dependencies.fields`. Plans 02/03 must detect cycles themselves.
- **`+0000` datetime offset accepted: YES.** `unnest($4::timestamptz[])` took `2026-01-02T03:04:05.000+0000` and NULL elements on the running backend (pglite); no fallback to `Z` was needed. The `round(x,2)` then `sum` check gives `0.99` as expected.

## Tasks
1. f6aeb7b: removed the formula gate in `tryResolve`, `familyOf` accepts formulas (roll-ups still unfilterable); rewrote old rejection tests, added formula roll-up and filter tests.
2. 2805843: `volatileReasons` at all four volatile sites; cycle probe test.
3. e0a28e8: unnest array-binding test; three scaffold files (11 + 15 + 4 todos).

## Deviations from Plan
None in code. Environment note: default shell node is v18; commands were run with Node 22 (`~/.nvm/versions/node/v22.23.3/bin`) because `pnpm` is not on PATH, using `npx vitest` / `npx eslint`.

## Issues
`pnpm build` was not run (parallel-execution rule). `tsc -p tsconfig.test.json --noEmit` reports errors only in untouched files (vendored sigha, `engine.test.ts`, `null-prefix.test.ts`, `diagnostics.test.ts`); none in files changed here. Not fixed (out of scope).

Warning from the plan stands: formula roll-ups are not yet admitted or backfilled; do not run `orglet up` on a shared database until plan 08.

## Verification
metadata (232 tests), formula (83 tests), pglite-compat pass; scaffolds report 30 todo; eslint clean on changed packages.

## Self-Check: PASSED
