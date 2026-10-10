---
phase: 06-bulk-api-2-0-persistence
plan: 03
subsystem: api
tags: [bulk-api, postgres, persistence, retention, reconciliation]
requires: [06-01, 06-02]
provides:
  - packages/api/src/bulk/schema.ts (DDL, setJobState, reconcile, purge, prepareBulk, dropBulkJobs)
  - TRANSITIONS / CLIENT_SETTABLE / DELETABLE / allowedFrom in jobs.ts
affects: [06-04, 06-05, 06-06]
tech-stack:
  added: []
  patterns: [compare-and-set state writer driven by one transition table, to_regclass-guarded drop]
key-files:
  created: [packages/api/src/bulk/schema.ts, packages/api/src/bulk/schema.test.ts]
  modified: [packages/api/src/bulk/jobs.ts, packages/api/src/index.ts, packages/cli/src/main.ts]
key-decisions:
  - "setJobState is the only writer of state; reconcile is a guarded transition to Failed from UploadComplete/InProgress"
  - "Retention basis created_date for every state, hard-coded 7 days"
requirements-completed: [BULK-01, BULK-02, BULK-04]
duration: 15min
completed: 2026-10-10
---

# Phase 6 Plan 03: Bulk job storage Summary

Four `_orglet.bulk_*` tables, one guarded state writer, boot reconciliation, 7-day purge and per-org drop, wired into `orglet up` and `orglet reset`. Routes are untouched (06-04/06-05).

## Commits
- c5cb236 feat(06-03): storage module, transition table, SQL-level tests
- 99c269b feat(06-03): barrel exports and up/reset wiring

## Decisions
- Transitions: ingest Open -> [UploadComplete, Aborted]; UploadComplete -> [InProgress, Aborted, Failed]; InProgress -> [JobComplete, Failed]. Query: UploadComplete -> [InProgress, Aborted, Failed]; InProgress -> [JobComplete, Failed, Aborted]. Client-settable: UploadComplete, Aborted.
- DELETABLE: ingest [UploadComplete, JobComplete, Aborted, Failed]; query [JobComplete, Aborted, Failed].
- Restart messages (locked): ingest "ServerRestarted : The server restarted while this job was in progress. Records already processed are listed in successfulResults and failedResults; records not yet processed are listed in unprocessedrecords."; query "ServerRestarted : The server restarted while this job was in progress. No results were saved; create a new query job to run the query again."
- Retention: `created_date` older than 7 days, any state. Source: Limits Quick Reference "Batch and job lifespan", Bulk API 2.0 column: "Jobs in a terminal state ... that are older than seven days are deleted. Jobs in a non-terminal state that are older than seven days are periodically cleaned up." No override (D-11).
- TOAST ceiling (1 GB per CSV value, buffered in memory) documented in the schema.ts header.

## Deviations from Plan
- TDD RED/GREEN not committed separately: tests and implementation were written together and committed in one `feat` commit (tests were run green before commit; no separate failing-state run).

## Verification
`pnpm vitest run packages/api/src/bulk/schema.test.ts packages/api/src/bulk.test.ts packages/cli`: pass on pglite (7 schema tests, 1 skipped by design: Postgres-only concurrency test; not run against real Postgres). `pnpm build` clean. Scoped eslint clean. `grep "SET state" packages/api/src` lists only schema.ts. Full `pnpm lint` not run.

## Known Stubs
None.

## Self-Check: PASSED
