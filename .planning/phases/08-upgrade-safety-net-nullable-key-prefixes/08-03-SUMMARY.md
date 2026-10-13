---
phase: 08-upgrade-safety-net-nullable-key-prefixes
plan: 03
subsystem: engine, soql, api
tags: [key-prefix, nullable, import-mode, polymorphic]
requires: ["08-02"]
provides:
  - "Engine write path handles keyPrefix null (no Id minting, import-mode Ids, matchLookupTarget)"
  - "SOQL polymorphic joins/TYPEOF exclude null-prefix targets"
  - "Describe test for keyPrefix null"
affects: []
tech-stack:
  added: []
  patterns: ["narrow keyPrefix at the call site, never invent or assert"]
key-files:
  created:
    - packages/engine/src/null-prefix.test.ts
    - packages/api/src/describe.test.ts
  modified:
    - packages/engine/src/engine.ts
    - packages/engine/src/parents.ts
    - packages/engine/src/bootstrap.ts
    - packages/soql/src/compile.ts
    - packages/soql/src/compile.test.ts
key-decisions:
  - "Insert without Id on a null-prefix object yields REQUIRED_FIELD_MISSING on Id (import mode); outside import mode the object-flag check refuses first"
  - "bootstrap throws a clear error if a seed object has a null prefix"
requirements-completed: [BASE2-05]
duration: 15min
completed: 2026-10-13
---

# Phase 8 Plan 03: Nullable key prefixes in engine, SOQL and API Summary

A null-prefix standard object now loads, describes with `keyPrefix: null`, refuses creates, accepts import-mode Ids, works as a single-target lookup target and is never a polymorphic candidate; `pnpm build`, `pnpm lint` and `pnpm test` are green again.

## Tasks
1. Engine null branches, `matchLookupTarget` in checkReferences and loadParents (`declared` count), bootstrap `prefixOf`, DB-backed `null-prefix.test.ts` (6 tests) - af02013
2. SOQL `polyTargets` filter, compile tests, `describe.test.ts` - see second commit on branch

## Verification
- `pnpm build`, `pnpm lint` clean; `pnpm test` 462 passed, 3 skipped (pre-existing Postgres-only skips), on pglite.
- Optional real-Postgres leg of null-prefix.test.ts not run.

## Deviations from Plan
None. No additional `string | null` sites beyond those listed in the plan. The stale "Unknown target object (e.g. Group)" comment in checkReferences is intentionally untouched (Phase 9 audit, D-22).

## Known Stubs
None.

## Self-Check: PASSED
