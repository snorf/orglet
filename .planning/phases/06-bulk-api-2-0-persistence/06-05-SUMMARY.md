---
phase: 06-bulk-api-2-0-persistence
plan: 05
subsystem: api
tags: [bulk-api, postgres, persistence, soql, paging]
requires: [06-02, 06-04]
provides:
  - Query half of BulkStore (createQueryJob, findQueryJob, listQueryJobs, writeQueryResults, readQueryPage)
  - Query job routes on Postgres with the Bulk SOQL AST rule check; in-memory JobStore removed
affects: [06-06]
tech-stack:
  added: []
  patterns: [results and JobComplete transition in one transaction, offset paging with LIMIT max+1 lookahead]
key-files:
  created: []
  modified: [packages/api/src/bulk/jobs.ts, packages/api/src/bulk/store.ts, packages/api/src/bulk/store.test.ts, packages/api/src/routes/bulk.ts, packages/api/src/bulk.test.ts, CLAUDE.md, .planning/codebase/CONVENTIONS.md]
key-decisions:
  - "Bulk query rejection wording is orglet's own; Salesforce documents the construct list but no error shape"
  - "WHERE semi-joins are now accepted (the old regex rejected them)"
  - "Query abort allowed from UploadComplete/InProgress only; delete from JobComplete/Aborted/Failed"
requirements-completed: [BULK-01, BULK-02, BULK-05]
duration: 20min
completed: 2026-10-10
---

# Phase 6 Plan 05: Query jobs on Postgres Summary

Bulk API 2.0 query jobs are persisted (UploadComplete -> InProgress -> JobComplete with rows written atomically), page by offset with accurate `Sforce-Locator`/`Sforce-NumberOfRecords` on every page, and are gated by the AST-based Bulk SOQL rules instead of the regex.

## Commits
- 7330aae feat(06-05): query half of BulkStore, trimmed QueryJob, four store tests
- f71bd7a feat(06-05): query handlers on the store, rule wiring, D-20 tests, convention cleanup

## Decisions
- D-17 wording (`Bulk API 2.0 query jobs do not support <construct>`) is undocumented by Salesforce; no `UNSUPPORTED:` prefix, and `UNSUPPORTED:bulk-subquery` was removed from CLAUDE.md and CONVENTIONS.md.
- Semi-join acceptance change: `WHERE Id IN (SELECT ...)` now creates a job; only select-list child subqueries are rejected.
- Query abort sets Aborted only from UploadComplete/InProgress (JobComplete -> `Aborting already Completed Job not allowed`); delete only from JobComplete/Aborted/Failed.
- A thrown error while running or persisting the query marks the job Failed (`InternalServerError : ...`) and answers 200 with that job.

## Deviations from Plan
None. Task 1 and Task 2 were committed implementation-with-tests (no separate RED commit), as in 06-03/06-04. Task 1 was verified with vitest only, Task 2 with build and lint.

## Verification
`pnpm vitest run packages/api packages/engine packages/cli`: 208 passed, 1 skipped (Postgres-only concurrency test, by design; run on pglite). `pnpm build` and `pnpm lint` clean. Greps for `JobStore`, the old regexes and `bulk-subquery` in src, CLAUDE.md and CONVENTIONS.md return nothing. `packages/soql` untouched. Not run against a real Postgres container.

## Known Stubs
None.

## Self-Check: PASSED
