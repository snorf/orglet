---
phase: 16-archive-fixture-generator
plan: 03
subsystem: scripts, archive
tags: [fixture, seed, pglite, import-mode]
requires: [16-01, 16-02]
provides:
  - "scripts/gen-archive-fixture/seed.ts: buildSeed, FIXTURE_CLOCK, FIXTURE_PERIODS, KEY_PREFIX_MAPPING, createIdAllocator"
  - "scripts/gen-archive-fixture/org.ts: bootFixtureOrg, applyInserts, applyUpdates, applyDeletes"
affects: [16-04, 16-05]
key-files:
  created: [scripts/gen-archive-fixture/seed.ts, scripts/gen-archive-fixture/org.ts, packages/archive/src/seed.test.ts]
  modified: [tsconfig.scripts.json]
decisions:
  - "Roll-ups are written as supplied by the seed (import mode stores them), computed inside buildSeed from the seed rows"
  - "tsconfig.scripts.json maps @orglet/sigha to its built declarations, because sigha is not strict-index clean (CI builds before typecheck:scripts)"
metrics:
  tasks: 3
  completed: 2026-11-07
---

# Phase 16 Plan 03: Seed and fixture org Summary

Deterministic two-period acme seed (fixed Ids, stamps, blob bytes, roll-ups computed from the rows) plus a pglite boot that applies it through DmlEngine in import mode, with 10 tests on the seeding invariants.

## Spike findings

Run 2026-11-07 on pglite with the boot sequence from the plan (spike file deleted afterwards).

1. Command form: `pnpm exec tsx --tsconfig tsconfig.test.json scripts/gen-archive-fixture/<file>.ts`. Resolves `@orglet/schema`, `@orglet/engine`, `@orglet/api`, `@orglet/metadata` and `../../test/db.js`.
2. Roll-up values in import mode: accepted and stored as supplied (Account Total_Budget__c, Open_Project_Milestones__c, Last_Active_Project_Created__c; Project Milestone_Count__c, Open_Milestones__c, Next_Due_Date__c). Inserting a Project afterwards did not overwrite the Account roll-ups. No SQL fallback needed. Note: Project__c (master-detail) has no OwnerId field, so OwnerId is only added where the field exists.
3. BigTable__c: without Name, stored "00000001"; supplied Name "00000042" accepted and stored as given.
4. Stamp-only import-mode update of BigTable__c succeeds and stores the supplied LastModifiedDate and SystemModstamp.
5. `POST /services/oauth2/token` changes no User row column.
6. ContentVersion and ContentDocument inserts with supplied Id, Checksum, sizes, FileExtension, FileType, VersionNumber, IsLatest, IsMajorVersion, PathOnClient, Title, VersionData (base64 stored as the raw bytes), ContentDocumentId, LatestPublishedVersionId, OwnerId are all stored as given. No blocker.

## Tasks
1. Spike (no commit; spike file deleted, findings above).
2. Seed module: 81cd8e5 (also tsconfig.scripts.json).
3. Boot/apply code and tests: c62396e.

## Deviations from Plan

**1. [Rule 3 - Blocking] tsconfig.scripts.json could not typecheck seed.ts**
- Importing `@orglet/engine` from scripts pulled vendored `packages/sigha/src` into the strict scripts program (noUncheckedIndexedAccess errors in builtins.ts).
- Fix: added a `paths` override mapping `@orglet/sigha` to `packages/sigha/dist/index.d.ts`. CI already runs `pnpm build` before `pnpm typecheck:scripts`.
- Commit: 81cd8e5.

**2. Project__c and Milestone__c carry no OwnerId** (master-detail children); the seed sets OwnerId only on objects that have it, and applyInserts only adds it where the field exists.

## Verification
`pnpm vitest run packages/archive` (48 tests), `pnpm typecheck:scripts`, `pnpm lint` all green.

## Known Stubs
None.

## Self-Check: PASSED
