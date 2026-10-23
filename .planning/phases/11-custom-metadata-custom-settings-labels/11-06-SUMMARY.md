---
phase: 11-custom-metadata-custom-settings-labels
plan: 06
subsystem: engine
tags: [custom-metadata, seed, ids, sync]
requires: ["11-03", "11-04"]
provides:
  - planCustomMetadataSeed (pure), seedCustomMetadata (single-transaction sync), customMetadataSummary
affects: [11-07, 11-08, 11-09]
key-files:
  created: [packages/engine/src/seed.ts]
  modified: [packages/engine/src/seed.test.ts, packages/engine/src/index.ts]
key-decisions:
  - "Seed bypasses DmlEngine and writes through Store inside one withTransaction; stamps move only on a real change"
requirements-completed: [CMDT-02, CMDT-03]
duration: 20min
completed: 2026-10-20
---

# Phase 11 Plan 06: Custom metadata seed Summary

Pure seed plan (typed coercion, derived Ids, mdt and Entity/FieldDefinition resolution, aggregated warnings) plus an idempotent per-type full sync and the D-04 summary line.

## Verification
- `pnpm vitest run packages/engine/src/seed.test.ts`: 17 pass (16 former todos plus one in-memory build case), on pglite.
- `pnpm build` clean; eslint clean on the three files.
- Fixture plan yields exactly the six seed-plan warnings of the README; Gold Id equals the golden `m00dI6W8ONPwAT6Q0N` derivation.

## Deviations from Plan
- Both tasks were committed as one commit (a8c02b5) because seed.ts and seed.test.ts were written together; the RED-first step with stubs was skipped. Behaviour is fully covered by the tests.
- Added one extra test (in-memory build). No other changes.

## Notes for 11-07/11-09
- Tests read rows with direct SQL, so the missing `isdeleted` guard from 11-05 did not matter. `__mdt` tables have no IsDeleted column (sync uses plain DELETE).
- Full-repo `pnpm lint` not run (other executor's files in flight); scoped eslint was clean.

## Known Stubs
None.

## Commits
- a8c02b5: feat(11-06): plan and sync custom metadata records

## Self-Check: PASSED
