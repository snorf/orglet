---
phase: 08-upgrade-safety-net-nullable-key-prefixes
plan: 05
subsystem: metadata, schema
tags: [diagnostics, warnings, unsupported]
requires: ["08-01", "08-02", "08-03"]
provides:
  - "Diagnostic/SkippedItem/FormulaFailure/DiagnosticSink types and formatDiagnostic/pushDiagnostic exported from @orglet/metadata"
  - "BuildResult, MigrateResult, ReconcileKeyPrefixesResult and SourceProject carry diagnostics beside unchanged warnings"
affects: [08-06]
tech-stack:
  added: []
  patterns: ["build the record first, derive the warning string via pushDiagnostic"]
key-files:
  created:
    - packages/metadata/src/diagnostics.ts
    - packages/metadata/src/diagnostics.test.ts
  modified:
    - packages/metadata/src/index.ts
    - packages/metadata/src/sfdx.ts
    - packages/metadata/src/build.ts
    - packages/metadata/src/rollup.ts
    - packages/metadata/src/build.test.ts
    - packages/metadata/src/sfdx.test.ts
    - packages/schema/src/migrate.ts
    - packages/schema/src/prefixes.ts
    - packages/schema/src/migrate.test.ts
key-decisions:
  - "pushDiagnostic is generic (D extends Diagnostic) so SkippedItem literals with extra props type-check"
  - "Dropped-table schema-drop diagnostic carries no object (table no longer modelled); dropped-column carries field only when still resolvable"
requirements-completed: [MIGR-02, BASE2-05]
duration: 20min
completed: 2026-10-13
---

# Phase 8 Plan 05: Structured diagnostics in metadata and schema Summary

Every UNSUPPORTED warning in sfdx.ts, build.ts, rollup.ts and migrate.ts (incl. schema-fk) is now built as a Diagnostic record and the byte-identical string is derived from it; results expose a parallel `diagnostics` list.

## Tasks
1. Diagnostic types, formatter, sink helper, 16-case byte-exact formatter test - f0b694d
2. sfdx/build/rollup emit diagnostics, new record tests - 94644fa
3. migrate/prefixes emit diagnostics, schema-fk and narrow/drop record tests - see git log (feat(08-05) schema)

## Deviations from Plan
- [Rule 3 - Blocking] `satisfies SkippedItem` on a literal passed to a `Diagnostic` parameter raised excess-property errors; made `pushDiagnostic` generic (fix landed in the task 3 commit).
- The "rollup drop" test uses the rollup-target case in build.test.ts.

## Verification
`pnpm build`, `pnpm lint`, `pnpm test` green (481 passed, 3 skipped Postgres-only, pglite). No existing assertion modified.

## Known Stubs
None.

## Self-Check: PASSED
