---
phase: 03-thin-standard-object-baselines
plan: 04
subsystem: testing
tags: [conformance, jsforce, simple-salesforce, describe, postgres, pglite, cli, smoke, checkpoint]

requires:
  - phase: 03-thin-standard-object-baselines
    provides: 14 thin objects (03-01), seed rows and DML guard (03-02), describe contract and contract.json/objects.txt (03-03)
provides:
  - conformance/describe-check/jsforce.mjs and sf_describe.py (real SDK describe checks over the 14 thin objects)
  - conformance/describe-check/README.md (how to run them)
  - Recorded end-to-end evidence for BASE-01..05: suite green on both backends, DE retrieve check, CLI smoke, both SDKs 14/14, Johan's devrandom upgrade approved
affects: [03 verify-work, 03 phase PR, 04-formula-field-types]

key-files:
  created:
    - conformance/describe-check/jsforce.mjs
    - conformance/describe-check/sf_describe.py
    - conformance/describe-check/README.md
  modified:
    - .gitignore

key-decisions:
  - "devrandom upgrade approved 2026-10-08: 14 tables added, seed rows created once, FKs added without dangling-data errors, second start silent"
  - "The plan's up_once helper leaving a stray server on 8099 under zsh is a plan-harness artifact, not an orglet defect"

requirements-completed: [BASE-02, BASE-04, BASE-05]

duration: n/a (Tasks 1-2 executed 2026-10-08, then a blocking human checkpoint resolved the same day)
completed: 2026-10-08
---

# Phase 3 Plan 04: End-to-End Verification Summary

**Real jsforce and simple-salesforce describe checks pass 14/14 against the thin objects, the full suite is green on pglite and Docker Postgres, the Developer Edition retrieve checks clean with zero `UNSUPPORTED:reference-target`, and Johan's pre-existing devrandom org upgraded with 14 tables, one seed row each for BusinessHours and UserLicense, and a silent second start.**

## Accomplishments

- `conformance/describe-check/jsforce.mjs` and `sf_describe.py` run each SDK's own describe path (global and per object) against a running orglet and assert the key sets pinned in `contract.json` for every entry in `objects.txt`; `.venv` is gitignored.
- Whole suite green on both backends; the Developer Edition retrieve no longer reports any unresolved reference target.
- Three smokes (M1 SDKs, M2 check, M3 isolated-schema CLI up) and the real-org upgrade (M4) all matched their expected strings.

## Test results (Task 2, observed)

- pglite (`pnpm test`): 16 files, 183 passed, 2 skipped (the two Postgres-only tests), 0 failed.
- Docker Postgres 16: 16 files, 185 passed, 0 skipped, 0 failed.

### M2: `check` on the Developer Edition retrieve

- Exit 0; 0 `UNSUPPORTED:reference-target` lines; exactly 1 `UNSUPPORTED:field-type` (the `Summary` roll-up field `ObjectBackup__c.Last_Backup_Run__c`, phase 5); closing line `37 objects (2 custom), 982 fields`.

### M3: CLI smoke in isolated schema `smoke_phase3`

- First `up`: 39 changes applied; `BusinessHours` = `01m00VXU3fLWzdhAHD|Default|t`; `UserLicense` = `10000VXU3fLXzdhAHD|Salesforce|Salesforce`; the System Administrator profile linked to that license; the 3 foreign keys (`fk_case_businesshoursid`, `fk_profile_userlicenseid`, `fk_contact_individualid`) present.
- Second `up`: 0 changes, same ids (seed rows created once).
- Cleanup: `dropped 4 key prefix assignment(s)`, schema gone, port free.

### M1: SDK describe checks (both 14/14)

| Object | keyPrefix | nameField | fields | childRelationships |
|--------|-----------|-----------|--------|--------------------|
| BusinessHours | 01m | Name | 10 | 1 |
| BusinessProcess | 019 | Name | 8 | 1 |
| CallCenter | 04v | Name | 8 | 1 |
| DandBCompany | 06E | Name | 8 | 2 |
| Entitlement | 550 | Name | 8 | 1 |
| ExternalDataSource | 0XC | DeveloperName | 8 | 1 |
| IdeaTheme | 0Bg | Title | 8 | 1 |
| Individual | 0PK | Name | 11 | 3 |
| OperatingHours | 0OH | Name | 9 | 1 |
| OpportunityHistory | 008 | - (none) | 7 | 2 |
| ServiceAppointment | 08p | AppointmentNumber | 9 | 1 |
| ServiceContract | 810 | Name | 9 | 1 |
| SocialPost | 0ST | Name | 9 | 1 |
| UserLicense | 100 | Name | 9 | 1 |

jsforce: `14/14 passed`; simple-salesforce: `14/14 passed`; identical rows from both SDKs.

## Checkpoint outcome

Resolved 2026-10-08, **APPROVED**. The orchestrator ran it on Johan's behalf.

- The devrandom server from phase 2 (PID 90215, started 2026-10-02) was stopped; `pnpm build` with Node 22; started with `node packages/cli/dist/index.js up --project ~/Development.nosync/devrandom-metadata --port 8180 --org-schema devrandom`.
- First start: `schema "devrandom": 14 change(s) applied` (the 14 new tables; the new foreign keys do not count in the CLI's change counter), `orglet is up on http://localhost:8180`, `objects 37 (2 custom)`. 0 `UNSUPPORTED:reference-target` lines, 1 `UNSUPPORTED:field-type` (Summary, phase 5), 0 `error:` / `cannot add foreign key` lines, 0 `assigned key prefix` lines (phase 2 rows already persisted).
- Database after first start: `devrandom.businesshours` = `01m00VXU4AoIbsrAXC|Default|t` (one row); `devrandom.userlicense` = `10000VXU4AoKbsrAXC|Salesforce|Salesforce` (one row); `devrandom.profile` System Administrator `userlicenseid` = `10000VXU4AoKbsrAXC`; `pg_constraint` count for `fk_case_businesshoursid`, `fk_profile_userlicenseid`, `fk_contact_individualid` = 3; all 14 thin tables present in `information_schema.tables`.
- REST on the running server (OAuth password grant): `GET /services/data/v59.0/sobjects/UserLicense/describe` returned `keyPrefix 100`, `createable false`, `idEnabled true`, nameField `['Name']`; `POST /services/data/v59.0/sobjects/UserLicense` with `{"Name":"x","MasterLabel":"x"}` returned HTTP 400, body `[{"message":"entity type UserLicense does not support insert","errorCode":"INVALID_TYPE_FOR_OPERATION"}]`.
- Second start (server stopped and started with the same command): `schema "devrandom": 0 change(s) applied`, banner, 0 error lines, 0 assigned lines; BusinessHours count 1 with id `01m00VXU4AoIbsrAXC`, UserLicense count 1 with id `10000VXU4AoKbsrAXC`, profile still linked. The devrandom server is now running on 8180 (PID 90076) and was left alone.

## Task Commits

1. **Task 1: describe-check scripts, README, venv gitignore** - `0607d59` (feat)
2. **Task 2: suite on both backends, M2, M3, M1** - no commit (verification only); checkpoint position recorded in `8f57f9b` and `eddd542` (docs, STATE.md)
3. **Task 3: Johan's devrandom upgrade** - no commit (human checkpoint, approved)

## Files Created/Modified

- `conformance/describe-check/jsforce.mjs` - jsforce describe check over `objects.txt` against `contract.json`
- `conformance/describe-check/sf_describe.py` - simple-salesforce equivalent
- `conformance/describe-check/README.md` - run instructions
- `.gitignore` - ignores the Python venv

## Deviations from Plan

None in code. One plan-harness note: the plan's `up_once` helper, run under zsh, left the first server alive on port 8099, so the helper's second start hit `EADDRINUSE`. The stray server was killed and the second start re-run cleanly (M3 second `up`: 0 changes). This is a harness artifact, not an orglet defect.

## Issues Encountered

None beyond the harness note above.

## Known Stubs

None. The plan added scripts and docs only.

## User Setup Required

None.

## Next Phase Readiness

- Phase 3 is complete end to end: BASE-01..05 have unit, integration, SDK, CLI-smoke and real-org evidence. Ready for `/gsd:verify-work` and the phase PR (push and PR are confirmed with Johan separately).
- The `Summary` field type remains the single `UNSUPPORTED:field-type` in the Developer Edition retrieve; it belongs to phase 5.

---
*Phase: 03-thin-standard-object-baselines*
*Completed: 2026-10-08*

## Self-Check: PASSED

conformance/describe-check/jsforce.mjs, sf_describe.py and README.md exist; commits 0607d59, 8f57f9b and eddd542 are in git history.
