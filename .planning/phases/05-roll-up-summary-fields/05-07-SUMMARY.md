---
phase: 05-roll-up-summary-fields
plan: 07
subsystem: conformance
tags: [salesforce, rollup, jsforce, simple-salesforce, conformance, postgres, pglite]

requires:
  - phase: 05-roll-up-summary-fields (plans 01-06)
    provides: roll-up metadata, SQL builder and migrate backfill, acme roll-ups, save/delete/undelete recompute, SOQL over roll-up columns
provides:
  - conformance/rollup-check (jsforce and simple-salesforce legs, README), five checks each against a live orglet
  - Phase gate evidence: suite green on pglite and Docker Postgres 16, both SDK legs 5/5, DE retrieve loads with zero warnings
affects: [phase 7 conformance setup, verify-work for phase 5]

tech-stack:
  added: []
  patterns:
    - "rollup-check copies the poly-check layout: run-tagged records, one PASS/FAIL line per check, teardown in finally, throwaway org schema removed with orglet reset --drop-prefixes"

key-files:
  created:
    - conformance/rollup-check/jsforce.mjs
    - conformance/rollup-check/sf_rollup.py
    - conformance/rollup-check/README.md
  modified:
    - .gitignore
    - .planning/REQUIREMENTS.md

key-decisions:
  - "The SDK legs reuse conformance/describe-check/.venv for simple-salesforce; no new venv was created"
  - "ROLL-09 closed by Johan's Task 3 checkpoint: approved with a note (column already present, first-start line not observed, tables empty)"

patterns-established:
  - "Phase gate scripts assert describe flags, recompute, SOQL filter/sort, rejected write and delete recompute through both SDKs"

requirements-completed: [ROLL-09]  # ROLL-01..ROLL-08 were marked by earlier plans

duration: 10 min
completed: 2026-10-09
---

# Phase 5 Plan 07: Roll-up SDK gate, both backends and DE check Summary

**jsforce and simple-salesforce both see roll-ups as calculated, read-only fields that recompute live on insert and delete and can be filtered and sorted in SOQL (5/5 each against a live acme org); the suite is green on pglite and Docker Postgres 16 and Johan's DE retrieve loads with zero warnings. Task 3 (devrandom upgrade) approved by Johan with a note.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-10-09T08:04:00Z (approx.)
- **Completed (Tasks 1-2):** 2026-10-09T08:14:00Z
- **Tasks:** 3 of 3 (Task 3 was the blocking human checkpoint, approved with a note)
- **Files:** 3 created, 2 modified

## Task Commits

1. **Task 1: rollup-check scripts and README** - `318147f` (test)
2. **Task 2: gate run, REQUIREMENTS notes** - `0526b12` (docs)

## Backend test runs

- pglite (`pnpm build && pnpm lint && pnpm test`): build and lint green; `Test Files 20 passed (20)`, `Tests 341 passed | 2 skipped (343)` (the two skips are the pre-existing Postgres-only prefix tests).
- Docker Postgres 16 (`ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test`): `Test Files 20 passed (20)`, `Tests 343 passed (343)` (the Postgres-only tests run, so no skips).

## Live server

Pre-check `SELECT count(*) FROM information_schema.schemata WHERE schema_name = 'rollup_check'` printed `0`. Server: `orglet up --project examples/acme --org-schema rollup_check --port 8083 --quiet` (log empty).

### jsforce leg (`BASE_URL=http://localhost:8083 node conformance/rollup-check/jsforce.mjs`, exit 0)

```
PASS describe-flags {"Milestone_Count__c":{"calculated":true,"createable":false,"updateable":false},"Total_Budget__c":{"calculated":true,"createable":false,"updateable":false}}
PASS recompute-insert {"Milestone_Count__c":2,"Open_Milestones__c":1,"Total_Budget__c":120}
PASS soql-filter-sort {"ids":["a0200VXXQSvaz2YA5Q"],"expected":["a0200VXXQSvaz2YA5Q"]}
PASS write-rejected {"errorCode":"INVALID_FIELD_FOR_INSERT_UPDATE","Milestone_Count__c":2}
PASS recompute-delete {"Milestone_Count__c":1,"Open_Milestones__c":0}
jsforce: 5/5 passed
exit=0
```

### simple-salesforce leg (`conformance/describe-check/.venv/bin/python conformance/rollup-check/sf_rollup.py`, exit 0)

```
PASS describe-flags {"Milestone_Count__c":{"calculated":true,"createable":false,"updateable":false},"Total_Budget__c":{"calculated":true,"createable":false,"updateable":false}}
PASS recompute-insert {"Milestone_Count__c":2,"Open_Milestones__c":1,"Total_Budget__c":120}
PASS soql-filter-sort {"ids":["a0200VXXQT6iz2YA5Q"],"expected":["a0200VXXQT6iz2YA5Q"]}
PASS write-rejected {"errorCode":"INVALID_FIELD_FOR_INSERT_UPDATE","Milestone_Count__c":2}
PASS recompute-delete {"Milestone_Count__c":1,"Open_Milestones__c":0}
simple-salesforce: 5/5 passed
exit=0
```

### Teardown

The recorded PID (19542) matched `up --project examples/acme --org-schema rollup_check --port 8083`, was killed, and `ps` confirmed it stopped. Then:

```
$ ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet node packages/cli/dist/index.js reset --org-schema rollup_check --drop-prefixes
dropped schema "rollup_check"
dropped 4 key prefix assignment(s) for schema "rollup_check"
reset exit=0
```

Afterwards: schema count for `rollup_check` = `0`, `_orglet.key_prefixes` rows for `rollup_check` = `0`, and `devrandom` is still present (the default `org` schema did not exist in this database). No hand-written DROP was issued.

## DE retrieve check (ROLL-09, local only, lines and counts)

`node packages/cli/dist/index.js check --project ~/Development.nosync/devrandom-metadata`: exit 0, `warning:` lines 0 (stdout and stderr), `UNSUPPORTED:field-type` lines 0, `UNSUPPORTED:rollup` lines 0. First stdout line: `37 objects (2 custom), 983 fields`. The remaining stdout lines only list the two custom objects (`ObjectBackup__c`, `ObjectBackupRun__c`) with provisional key prefixes.

## Task 3 outcome

Johan's reply (2026-10-09, verbatim, Swedish): "Jag kan ha startat den tidigare när vi höll på och meckade så du kan approva med notering, om det är ett problem så löser vi det då".

Recorded as **approved with a note**:

- Johan's start of the devrandom server (`up --project ~/Development.nosync/devrandom-metadata --org-schema devrandom --port 8180`, without `--quiet`) printed `schema "devrandom": 0 change(s) applied`, no `error:` line and no `warning:` line, then the normal banner (37 objects, 2 custom).
- Read-only check afterwards: `information_schema.columns` shows `devrandom.objectbackup__c.last_backup_run__c` present with type `timestamp with time zone` (MAX over `ObjectBackupRun__c.CreatedDate`). Both `objectbackup__c` and `objectbackuprun__c` hold 0 rows, so the backfill had nothing to write and the step-4 query returned no rows.
- The expected `N >= 1` first-start line was not observed: the column had already been added by an earlier start. A node server was already listening on 8180 (PID 90076) when the checkpoint was reached; Johan may have started it during the day after a plan had rebuilt `dist/` (05-03 landed the backfill at ~07:40Z), which would have applied the column then. Not verifiable after the fact (Postgres does not timestamp columns).
- This start therefore served as the step-5 "second start": silent, 0 changes, no warnings. The acme-based backfill tests (05-03) and the SDK gate (Task 2) stand as the backfill evidence. Johan: "if it is a problem we solve it then".

ROLL-09 marked complete.

## Decisions

Repeating the planning-time decisions recorded in 05-03, 05-05 and 05-06:

- SELECT-first correlated subqueries (`rollupSelectSql`) instead of `UPDATE ... LEFT JOIN`; the same expression serves the engine recompute and the migrate backfill.
- Batch savepoint plus bounded replay loop for D-03 failure attribution (a refusing parent fails exactly the children pointing at it), with a per-parent `SAVEPOINT rollup_parent` around the parent UPDATE and after-hooks.
- The roll-up SQL builder lives in `@orglet/schema` (`packages/schema/src/rollup.ts`); the backfill runs as the last step of the migrate transaction, bottom-up by chain depth.
- No `LastModifiedDate`/`LastModifiedById`/`SystemModstamp` stamp on a recomputed parent.
- `notEqual` and `notContain` filters include NULL values.
- Text filters are case-insensitive; `ILIKE` input escapes `\`, `%`, `_`.
- `valueField` filters compare against another field of the child (`col <op> other`, `lower(a) = lower(b)` for text).
- Date-literal filters are skipped with a warning (`UNSUPPORTED:rollup-filter`).
- An unchanged parent is skipped entirely (no hooks, rules or UPDATE).
- No ChangeBus events are published for roll-up recomputes.
- Delete cascades pass a skip set so a parent being deleted is never recomputed; undelete recompute uses an empty skip set.

## Known gaps

- (a) Reparent and undelete recompute triggers have no primary Salesforce quote (ROADMAP research flag; Help article 000391766 is only about manual recalculation). Implemented as ROLL-04 requires; sourcing gap for verify-work.
- (b) Changing the operation or filter of an existing roll-up column does not re-backfill (deferred `orglet rollup --recompute`).
- (c) Date-literal filters are `UNSUPPORTED:rollup-filter`.
- (d) No parent row locking under concurrent writers (single-tenant tool).
- (e) The engine does not enforce `reparentableMasterDetail` (pre-existing).

## Deviations from Plan

None - plan executed exactly as written. Both SDK legs and the DE check passed on the first run, so no source fix was needed. Note: the `--quiet` flag used for the automated run hides the `schema "...": N change(s) applied` line that Johan's Task 3 step 3 expects; his command omits `--quiet`.

## Known Stubs

None.

## Self-Check: PASSED

Files verified present, commits `318147f` and `0526b12` verified in `git log`.
