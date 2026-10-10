---
phase: 06-bulk-api-2-0-persistence
verified: 2026-10-10T21:05:00Z
status: passed
score: 4/4 must-haves verified
---

# Phase 6: Bulk API 2.0 persistence Verification Report

**Goal:** Bulk ingest/query jobs, data and results persist in Postgres and survive restart, with state machine, retention and query restrictions preserved.
**Status:** passed. Re-verification: No.

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Jobs, CSV data, results persist in Postgres and are readable after restart | VERIFIED | bulk/schema.ts + bulk/store.ts (Postgres-backed; routes use `store.*`); bulk-persistence.test.ts (11 tests incl. restart) passes |
| 2 | State machine kept; client may only set UploadComplete/Aborted; InProgress reconciled to Failed on boot | VERIFIED | routes/bulk.ts:281-287 (ingest), :416 (query: Aborted only); `reconcileBulkJobs` schema.ts:104 (UploadComplete+InProgress to Failed, D-16); called at boot via cli/main.ts:135 |
| 3 | successful/failed/unprocessed CSV from persisted results; 7-day purge | VERIFIED | routes/bulk.ts:313-338 (sf__Id/sf__Created, sf__Id/sf__Error, original header for unprocessed); schema.ts:115 `created_date < now() - interval '7 days'` in every state; routes purge before each /jobs route (line 210) |
| 4 | Bulk query rejects TYPEOF, GROUP BY, OFFSET, aggregates, compound fields, child subqueries; rules separate from REST | VERIFIED | bulk/soql-rules.ts (own module, 31 tests); routes/bulk.ts:348 returns 400 FEATURE_NOT_ENABLED before any row is created |

## Decision checks

| Decision | Result |
|----------|--------|
| D-08 single state writer | `grep "SET state" packages/api/src`: only bulk/schema.ts:94 (non-test); the other hits are test fixtures in bulk-persistence.test.ts that force stuck states. OK |
| D-11 no retention override | The 7-day window is a literal in schema.ts; no env/config read in bulk/ or routes/bulk.ts. OK |
| D-17 no UNSUPPORTED prefix on query rejection | soql-rules.test.ts asserts no marker; `UNSUPPORTED:bulk-subquery` has zero hits in packages/, CLAUDE.md, .planning/codebase. OK |
| D-19 per-chunk atomicity | routes/bulk.ts:157 `ctx.engine.transaction(...)`; DML joins via `{transaction: tx}` (engine.ts:50, 234); result rows and counters commit together. OK |
| D-20 Sforce-Locator | routes/bulk.ts:407-408 sets Sforce-NumberOfRecords and Sforce-Locator (`null` on last page) on every query results response. OK |

## Requirements Coverage

| Req | Plans | Status |
|-----|-------|--------|
| BULK-01 | 06-03, 06-04, 06-05, 06-06 | SATISFIED |
| BULK-02 | 06-03, 06-04, 06-05 | SATISFIED |
| BULK-03 | 06-01, 06-04, 06-06 | SATISFIED |
| BULK-04 | 06-03, 06-04, 06-06 | SATISFIED |
| BULK-05 | 06-02, 06-05 | SATISFIED |

All five IDs are claimed by plans and marked Complete in REQUIREMENTS.md. No orphaned requirements.

## Behavioral spot-checks

Re-ran `pnpm vitest run packages/api/src/bulk packages/api/src/bulk-persistence.test.ts`: 5 files, 91 passed, 1 skipped. The skip is a pglite-only concurrency test, covered on Docker Postgres per the orchestrator's earlier full run (423 passed on pglite, 425 on Docker).

## Anti-patterns

None blocking. `UNSUPPORTED:bulk-relationship-column` (routes/bulk.ts:152) is intentional and kept in the docs.

## Notes (non-blocking)

- The ingest result endpoints do not set Sforce-Locator. This matches D-20, which scopes the header to query results.
- The unprocessedrecords endpoint is computed as input rows minus rows with results, which is consistent with the persisted data.

_Verifier: Claude (gsd-verifier)_
