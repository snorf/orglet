---
phase: 08-upgrade-safety-net-nullable-key-prefixes
plan: 06
subsystem: formula, engine
tags: [diagnostics, warnings, unsupported]
requires: ["08-05"]
provides:
  - "FormulaCompileError.missing ({ object, field }) and MissingField type"
  - "FormulaRegistry.diagnostics, DmlEngine.diagnostics, QueryPage.diagnostics beside unchanged warnings"
affects: []
key-files:
  created:
    - packages/engine/src/formulas.test.ts
  modified:
    - packages/formula/src/compile.ts
    - packages/formula/src/index.ts
    - packages/formula/src/formula.test.ts
    - packages/engine/src/formulas.ts
    - packages/engine/src/engine.ts
    - packages/engine/src/query.ts
    - packages/engine/src/query.test.ts
key-decisions:
  - "missing is set only for unresolved leaf fields and unknown relationships; polymorphic traversal leaves it undefined"
requirements-completed: [BASE2-05]
duration: 10min
completed: 2026-10-13
---

# Phase 8 Plan 06: Diagnostics in formula and engine Summary

Missing field references now travel as data on FormulaCompileError, and FormulaRegistry and runQuery emit FormulaFailure/Diagnostic records beside byte-identical warning strings; cli/main.ts and the API query route are untouched.

## Tasks
1. FormulaCompileError.missing - 63a7770
2. FormulaRegistry/DmlEngine/runQuery diagnostics - see git log (feat(08-06) engine)

## Deviations from Plan
None - plan executed as written.

## Verification
`pnpm build`, `pnpm lint`, `pnpm test` green (490 passed, 3 skipped Postgres-only). No existing assertion modified. `orglet check --project examples/acme` printed no warning lines for the acme example (not exercising the format; the format is covered by the registry test).

## Known Stubs
None.

## Self-Check: PASSED
