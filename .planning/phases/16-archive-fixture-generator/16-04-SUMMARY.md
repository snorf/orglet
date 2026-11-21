---
phase: 16-archive-fixture-generator
plan: 04
subsystem: scripts, archive, soql, engine
tags: [fixture, bulk-2.0, export, index-rows]
requires: [16-01, 16-03]
provides:
  - "scripts/gen-archive-fixture/export.ts: describeReplicateable, exportPeriod, ObjectRun, ExportedCsv"
  - "scripts/gen-archive-fixture/indexrows.ts: buildIndexRows"
affects: [16-05]
key-files:
  created: [scripts/gen-archive-fixture/export.ts, scripts/gen-archive-fixture/indexrows.ts, packages/archive/src/export.test.ts, packages/archive/src/indexrows.test.ts]
  modified: [packages/soql/src/compile.ts, packages/engine/src/query.ts]
decisions:
  - "Query results keep formula fields at their SELECT position (SObjectShape.computedAt), so Bulk CSV headers follow the Heimdall column rule"
  - "backup_runs status vocabulary Completed/Failed is an orglet choice"
metrics:
  tasks: 2
  completed: 2026-11-07
---

# Phase 16 Plan 04: Bulk export and index rows Summary

Period export through real Bulk 2.0 query jobs (Heimdall column order, keyset SOQL, paged until empty, refused queries recorded as Failed) plus deterministic csvfiles/objects/backup_runs rows built with the shared @orglet/archive rules.

## Tasks
1. Export: e196265 (tests: BigTable__c 8+4 then 8+1 CSVs, refused ContentDocumentLink as Failed, period-2 deletions only in the deleted phase).
2. Index rows: see git log (feat(16-04) build csvfiles...), 3 tests with hand-written expected keys and epoch seconds.

## Deviations from Plan

**1. [Rule 1 - Bug] Formula fields trailed the SELECT list in query results**
- **Found during:** Task 1. The format check failed on Opportunity: its formula field `Weighted_Amount__c` was emitted after `SystemModstamp,Id` although selected before them, because computed formula values were appended after stored columns and the Bulk CSV header comes from record key order. Salesforce honours SELECT order.
- **Fix:** the SOQL compiler records each computed field's position (`SObjectShape.computedAt`); `computeFormulaFields` in the engine restores that order afterwards.
- **Files:** packages/soql/src/compile.ts, packages/engine/src/query.ts
- **Commit:** 17b7201
- **Verified:** full `pnpm vitest run` green (1098 passed, 4 skipped pre-existing), build, typecheck:scripts, lint. No dedicated regression test beyond the export header assertion on every replicateable object (Opportunity covers it).

## Verification
`pnpm vitest run` (67 files), `pnpm build`, `pnpm typecheck:scripts`, `pnpm lint` all green.

## Known Stubs
None.

## Self-Check: PASSED
