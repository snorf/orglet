---
phase: 12-sigha-resync-formula-globals
plan: 06
subsystem: formula
tags: [formula, user-role, custom-settings, setup]
requires:
  - phase: 12-05
    provides: label/customMetadata reference kinds, registry dependency tracking
provides:
  - "$UserRole.<field> and $Setup.<Hierarchy>.<field> compile and evaluate"
  - FormulaRegistry.settingsUsed and gated per-transaction loading in DmlEngine.loadGlobals
  - Explicit UNSUPPORTED:formula-global reasons for List settings and $Permission
key-files:
  created:
    - packages/engine/src/formula-globals.test.ts
  modified:
    - packages/formula/src/compile.ts
    - packages/formula/src/evaluate.ts
    - packages/formula/src/globals.test.ts
    - packages/formula/src/formula.test.ts
    - packages/engine/src/formulas.ts
    - packages/engine/src/engine.ts
key-decisions:
  - "Hierarchy $Setup merges per field user -> profile -> organization; no read-time fallback to the field defaultValue (D-16)"
  - "$UserRole and $Setup queries are issued only when a compiled formula uses them"
requirements-completed: [FORM-05]
completed: 2026-10-23
---

# Phase 12 Plan 06: $UserRole and Hierarchy $Setup Summary

`$UserRole` and Hierarchy custom-setting `$Setup` references now evaluate at runtime with per-field user/profile/organization merging, loaded only for schemas whose formulas need them; List settings and `$Permission` fail with a stated reason.

## Commits

- feat(12-06): compile and evaluate $UserRole and Hierarchy $Setup
- feat(12-06): load $UserRole and merged Hierarchy settings only when formulas need them

## Notes

- FORM-05 complete. FORM-03 stays open for 12-07 (`$Api`); the `$UserRole` half is done.
- In the engine test, `UserRole` insert required `OpportunityAccessForAccountOwner`; supplied in the test data. All DML went through `engine.insert/update`, no store workaround needed.
- Verification: `pnpm lint`, `pnpm build` green; full `pnpm test`: 48 files, 786 passed, 3 skipped (pre-existing).

## Deviations from Plan

None. Process note: tests and implementation were written before the first run, so RED was not observed separately. Two lint-only unnecessary type assertions were auto-fixed.

## Self-Check: PASSED
