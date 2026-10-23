---
phase: 12-sigha-resync-formula-globals
plan: 05
subsystem: formula
tags: [formula, label, custom-metadata, registry]
requires:
  - phase: 12-04
    provides: CompiledFormula.dependencies and registry global tracking
provides:
  - "$Label and $CustomMetadata resolved at compile time"
  - CompiledFormula.warnings (CompileWarning) and the UNSUPPORTED:custom-metadata-record diagnostic
  - FormulaRegistry / DmlEngine customMetadata plan input, wired in orglet check and up
key-files:
  created:
    - packages/formula/src/globals.test.ts
  modified:
    - packages/formula/src/compile.ts
    - packages/formula/src/evaluate.ts
    - packages/formula/src/index.ts
    - packages/engine/src/formulas.ts
    - packages/engine/src/formulas.test.ts
    - packages/engine/src/engine.ts
    - packages/cli/src/main.ts
key-decisions:
  - "Master label value only, case-insensitive, namespaced $Label.ns.Name is a compile error; custom metadata record key is DeveloperName, case-insensitive; exactly 4 path segments, LongTextArea fields rejected; unknown record evaluates blank with one aggregated warning per formula"
requirements-completed: [FORM-04]
completed: 2026-10-23
---

# Phase 12 Plan 05: $Label and $CustomMetadata Summary

Formulas and validation rules read `$Label.X` and `$CustomMetadata.Type__mdt.Record.Field__c` as compile-time constants from loaded metadata; a missing record compiles, evaluates blank and yields one `UNSUPPORTED:custom-metadata-record` warning per formula.

## Commits

- ad934a6 feat(12-05): resolve $Label and $CustomMetadata at formula compile time
- e162942 feat(12-05): hand custom-metadata plan to the formula registry

## Notes

- Both globals are added to `dependencies.globals` and are not volatile. Label and customMetadata references are skipped when computing `parentPaths`.
- `warnings == diagnostics.map(formatDiagnostic)` still holds (compile warnings go through `pushDiagnostic`).
- `orglet check --strict` on conformance/cmdt-check exits 1 both before and after this plan (unchanged).
- Verification: `pnpm lint`, `pnpm build` green; full `pnpm test`: 47 files, 768 passed, 3 skipped (pre-existing).

## Deviations from Plan

None. Process note: tests and implementation were written before the first run, so RED was not observed separately. One test-helper bug (default parameter swallowing `undefined`) was fixed in the test itself.

## Self-Check: PASSED
