---
phase: 10-business-standard-objects
plan: 02
subsystem: metadata, cli
tags: [check, diagnostics, baseline]
requires: []
provides:
  - InfoDiagnostic and BuildResult.info
  - Baseline.skippedReferenceTargets
  - "info: N standard objects not modelled and unreferenced: ..." line in orglet check
affects: [orglet check, orglet up warnings]
key-files:
  modified:
    - packages/metadata/src/diagnostics.ts
    - packages/metadata/src/build.ts
    - packages/metadata/src/index.ts
    - packages/metadata/src/build.test.ts
    - packages/cli/src/main.ts
    - packages/cli/src/main.test.ts
key-decisions:
  - "Informational items live only in BuildResult.info; warnings and diagnostics stay 1:1"
metrics:
  completed: 2026-10-14
  tasks: 2
  files: 6
requirements-completed: [BASE2-08]
---

# Phase 10 Plan 02: Referenced versus unreferenced unmodelled standard objects Summary

`orglet check` keeps the UNSUPPORTED:standard-object and UNSUPPORTED:reference-target warnings for unmodelled standard objects that something references, and moves unreferenced ones (plus generator-skipped lookup targets nothing uses) to one `info:` line that `--strict` ignores.

## Commits

- d7241b8: metadata classification (InfoDiagnostic, BuildResult.info, PROVENANCE.json read, D-07 downgrade)
- 64e8971: the info line in `check()` and the USAGE text

## Interpretations (flagged)

1. D-08 "printed always" is implemented as "printed always except under --quiet": independent of `--strict` and of whether warnings exist, but sent through the quiet-gated `log()`. The existing tests "prints nothing with --quiet" and "--quiet does not hide warnings ..." require `logs` to be empty under `--quiet` (research C9).
2. Formula and validation-rule references are classified through the lookup they traverse (a formula reaches another object only through a field with `referenceTo`). There is no separate formula scan; a test proves the formula case classifies identically to the plain lookup.

## Deviations from Plan

None in behaviour. TDD was not run as a separate RED commit: tests and code were written together and committed per task.

## Verification actually run

- `pnpm vitest run packages/metadata packages/schema/src/migrate.test.ts packages/engine/src/formulas.test.ts`: 12 files, 187 tests passed (after task 1; this included plan 10-01's metadata test files as they existed in the tree at that moment).
- `pnpm vitest run packages/cli`: 13 tests passed.
- `pnpm lint` and `pnpm typecheck`: clean after both tasks.
- Not run: the full workspace suite and the Postgres-backed packages beyond migrate.test.ts.

## Known Stubs

None.

## Self-Check: PASSED
