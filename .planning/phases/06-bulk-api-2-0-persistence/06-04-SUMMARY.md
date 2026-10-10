---
phase: 06-bulk-api-2-0-persistence
plan: 04
subsystem: api
tags: [bulk-api, postgres, persistence, transactions, retention]
requires: [06-01, 06-03]
provides:
  - BulkStore (packages/api/src/bulk/store.ts): ingest CRUD, appendCsv, writeIngestChunk, readIngestInput/Results, deleteJob, purgeExpired, setState
  - Ingest routes on BulkStore with per-chunk engine transactions and per-request purge preHandler
affects: [06-05, 06-06]
tech-stack:
  added: []
  patterns: [one engine transaction per 200-record chunk holding DML + results + counters, route-level purge preHandler]
key-files:
  created: [packages/api/src/bulk/store.ts, packages/api/src/bulk/store.test.ts, packages/api/src/bulk-persistence.test.ts]
  modified: [packages/api/src/bulk/jobs.ts, packages/api/src/routes/bulk.ts, packages/api/src/bulk.test.ts]
key-decisions:
  - "A thrown error inside processing rolls back its chunk and moves the job InProgress -> Failed with `InternalServerError : <message>`; the PATCH answers 200 with the Failed job"
  - "DELETABLE.ingest now includes UploadComplete (per the guide)"
requirements-completed: [BULK-01, BULK-02, BULK-03, BULK-04]
duration: 25min
completed: 2026-10-10
---

# Phase 6 Plan 04: Ingest jobs on Postgres Summary

Ingest jobs, their CSV and per-record results now live in `_orglet` tables behind `BulkStore`; each 200-record chunk commits DML, result rows and counters in one `engine.transaction()`, and every `/jobs/*` route purges expired jobs first.

## Commits
- ef01e71 feat(06-04): BulkStore, trimmed IngestJob, six DB-level store tests
- d9af0ca feat(06-04): ingest routes on BulkStore, purge preHandler, three new bulk.test.ts cases
- b0f4b76 test(06-04): bulk-persistence.test.ts (per-chunk atomicity, result CSV, TAB/CRLF)

## Decisions
- InternalServerError handling: any exception during processing rolls the failing chunk back, logs via `req.log.error`, sets the job to Failed with `InternalServerError : <message>` (counters keep earlier chunks) and the PATCH returns 200 with that state.
- DELETABLE.ingest change (from 06-03): UploadComplete is now deletable, per the guide.
- `unprocessedrecords` is every input row without a result row, in input order (aborted jobs list all rows; a Failed job lists the rolled-back remainder).
- Query jobs stay in the in-memory `JobStore.query` map, but their routes already carry the purge preHandler.

## Deviations from Plan
- TDD RED was not committed separately for Task 1 (test and implementation committed together; tests were written first and run green before commit). Tasks 2 and 3 were verified after implementation.
- Removed the now-unused `parseCsv` import from routes/bulk.ts (lint).

## Verification
`pnpm vitest run packages/api packages/engine packages/cli`: 188 passed, 1 skipped (Postgres-only concurrency test, by design; run on pglite). `pnpm build` and `pnpm lint` clean. `grep "SET state" packages/api/src` lists only bulk/schema.ts. Not run against a real Postgres container.

## Known Stubs
None.

## Self-Check: PASSED
