---
phase: 06-bulk-api-2-0-persistence
plan: 06
subsystem: api
tags: [bulk-api, postgres, persistence, tests, docs, restart-smoke]
requires: [06-02, 06-03, 06-04, 06-05]
provides:
  - HTTP-level proof of Bulk persistence (restart, scoping, reset, state machine, reconcile, retention)
  - README Bulk API 2.0 section (persistence, retention, limits)
  - Observed real-process restart reconcile on Docker Postgres
affects: []
tech-stack:
  added: []
  patterns: [two-server restart tests against one database, scratch org schema for destructive smoke runs]
key-files:
  created: []
  modified: [packages/api/src/bulk-persistence.test.ts, README.md]
key-decisions:
  - "Restart smoke confined to the scratch org schema bulk_smoke on the Docker Postgres"
requirements-completed: [BULK-01, BULK-02, BULK-03, BULK-04]
duration: n/a
completed: 2026-10-10
---

# Phase 6 Plan 06: Bulk persistence proof and docs Summary

Bulk API 2.0 persistence is proven over HTTP by vitest (pglite and Postgres 16), documented in the README, and a real `orglet up` kill -9 / restart cycle on Docker Postgres reconciled a mid-flight job to Failed.

## Commits
- 7d38fc2 test(06-06): restart, scoping, reset, state machine, reconcile, retention (packages/api/src/bulk-persistence.test.ts)
- 12267e4 docs(06-06): README Bulk API 2.0 section before `## Layout`
- 0f3af6e docs(06-06): checkpoint position in STATE

## Gate results (Task 3)
- pglite: `pnpm build && pnpm lint && pnpm test` exit 0, 25 files, 423 passed, 3 skipped.
- Real Postgres 16 (`ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test`): exit 0, 25 files, 425 passed, 1 skipped.

## Task 4: restart smoke (checkpoint:human-verify)
Johan's reply: "run it". Steps 1-7 of the plan's how-to-verify were run verbatim against `--org-schema bulk_smoke` only, port 18080 (free). Deviations in method only: server log written to the session scratchpad instead of /tmp, CSV sent with `--data-binary` and LF-separated body. First server PID 34594 (kill -9), second PID 35565 (plain kill); neither is running.

Step 5: `UPDATE 1` (row in `_orglet.bulk_ingest_jobs` for bulk_smoke set to InProgress), then `kill -9`.

Step 6, log line after restart:
```
bulk: marked 1 job(s) left in progress by a previous run as Failed
```
Job info (job id 75000VXfu3Wa9TAADZ):
```
..."state":"Failed",...,"errorMessage":"ServerRestarted : The server restarted while this job was in progress. Records already processed are listed in successfulResults and failedResults; records not yet processed are listed in unprocessedrecords."}
```
`unprocessedrecords` body:
```
Name
Smoke 1
Smoke 2
```
Step 7, reset output:
```
dropped schema "bulk_smoke"
dropped 1 bulk job(s) for schema "bulk_smoke"
```
Every step matched the expected result. No other schema was touched. An unrelated, pre-existing `orglet up --org-schema devrandom --port 8180` process was visible in `ps` and was left alone.

## Deviations from Plan
None - plan executed as written.

## Known Stubs
None.

## Self-Check: PASSED
