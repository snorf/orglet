---
phase: 11-custom-metadata-custom-settings-labels
plan: 07
subsystem: api, engine
tags: [custom-metadata, custom-settings, describe, dml-refusal, bulk]
requires: ["11-04", "11-05", "11-06"]
provides:
  - "Describe flags for __mdt (D-15) and data-driven customSetting (D-17)"
  - "DML refusal for __mdt in every path, import mode included (D-13), Bulk ingest refusal (D-14), /updated and /deleted guards"
  - "SetupOwnerId org default on Hierarchy insert (D-18)"
  - "packages/api/src/custom-metadata.test.ts (13 Fastify-inject tests on the cmdt-check fixture)"
affects: [11-09]
key-files:
  created: [packages/api/src/custom-metadata.test.ts]
  modified:
    - packages/engine/src/engine.ts
    - packages/api/src/describe.ts
    - packages/api/src/routes/bulk.ts
    - packages/api/src/routes/sobjects.ts
key-decisions:
  - "refuse() ignores import-mode bypass for customMetadata objects (D-13)"
  - "MetadataRelationship to Entity/FieldDefinition describes as reference, length 255, soapType xsd:string (orglet choice)"
requirements-completed: [CMDT-01, CMDT-04, CSET-01]
duration: 20min
completed: 2026-10-20
---

# Phase 11 Plan 07: Client-visible surface Summary

Describe, DML refusal and read paths for custom metadata, plus custom-setting SetupOwnerId behaviour, proven over HTTP on the cmdt-check fixture.

## Tasks
1. Describe flags, import-mode refusal, SetupOwnerId default, HTTP tests: 334bbbf
2. Bulk ingest refusal, /updated and /deleted guards: 72f6463

## Verification
- `pnpm vitest run packages/api packages/engine`: 19 files, 275 passed, 1 skipped (pglite). `pnpm build` clean; eslint on packages/api and engine.ts clean (scoped, because of the parallel executor's files).
- `api.test.ts`, `bulk.test.ts` unchanged and green.
- custom-metadata.test.ts: 13/13 on real Postgres (3 of 3 runs).

## Deviations from Plan
- Field and global key-set assertions use "contains all contract keys" (the `missingKeys` pattern from api.test.ts), not strict equality: the contract is a minimum set and describe emits extra keys (aiPredictionField, polymorphicForeignKey, searchPrefilterable).
- The test setup also calls `prepareBulk` / `dropBulkJobs` (needed for the Bulk assertions) and uses permissive auth with a token request.
- TDD RED commits were not made separately (tests written after the implementation, committed together as in earlier plans); test file is wholly committed with Task 1 although its Bulk and /updated tests need Task 2's code.

## Known issue (resolved by the orchestrator in 13bc0c2)
On embedded pglite the two DUPLICATE_VALUE tests were intermittently a 500 ("Received unexpected parseComplete message from backend") after a unique violation, about 2 runs in 3 when run in a loop, and the same loop on `examples/acme` failed too, so this was a pre-existing test-infrastructure gap exposed by this plan. Root cause is electric-sql/pglite#958 (ReadyForQuery sent before the client's Sync). `test/db.ts` now filters the premature messages per connection; the upstream fix (pglite PR #1144) is unreleased and upgrading to pglite 0.5.10 / pglite-socket 0.2.13 did not help.

## Known Stubs
None.

## Self-Check: PASSED
