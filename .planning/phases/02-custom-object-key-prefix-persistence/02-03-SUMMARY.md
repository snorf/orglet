---
phase: 02-custom-object-key-prefix-persistence
plan: 03
subsystem: testing
tags: [api, describe, key-prefix, vitest, pglite, postgres, cli, smoke, checkpoint]

# Dependency graph
requires:
  - phase: 02-custom-object-key-prefix-persistence
    plan: 01
    provides: "@orglet/schema reconcileKeyPrefixes (mapping seed, in-place SObjectDef.keyPrefix mutation) and dropKeyPrefixes"
  - phase: 02-custom-object-key-prefix-persistence
    plan: 02
    provides: "orglet up/check/reset wiring and the exact log, check and error strings the smoke greps match"
provides:
  - "packages/api/src/api.test.ts T11: REST global and per-object describe report the persisted (mapping-seeded) prefix a0Z for Project__c and a REST-created record gets an a0Z Id; the file cleans up its _orglet rows"
  - "Recorded end-to-end evidence for PREFIX-01..04: full suite green on pglite and Docker Postgres, acme CLI smoke sequence (up/up/check/reset/reset --drop-prefixes/--key-prefixes/collision), Johan's devrandom upgrade approved"
affects: [02 verify-work, 02 phase PR, 06-bulk-persistence]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DB-backed API tests that need a non-default prefix call reconcileKeyPrefixes(pool, schema, { orgSchema, mapping }) before migrate() and dropKeyPrefixes(pool, orgSchema) before DROP SCHEMA, mirroring the order in orglet up"

key-files:
  created: []
  modified:
    - packages/api/src/api.test.ts

key-decisions:
  - "devrandom checkpoint approved 2026-10-02; both custom tables empty so the seed source was `provisional`, values identical to the old scheme"
  - "The plan's `-t \"describe\"` acceptance grep is treated as a plan-criterion flaw, not a code defect: `token` is populated by the `login` block the filter excludes; `-t \"login|describe\"` and the whole file are green"

patterns-established:
  - "Acceptance evidence for a persistence feature is recorded as literal observed output (counts, exact lines) in the SUMMARY, so /gsd:verify-work can check it without re-running the smoke"

requirements-completed: [PREFIX-01, PREFIX-02, PREFIX-03, PREFIX-04]

# Metrics
duration: 6min
completed: 2026-10-02
---

# Phase 02 Plan 03: End-to-End Verification Summary

**REST describe and record creation now prove the persisted key prefix (T11 seeds `Project__c` with `a0Z` via `reconcileKeyPrefixes`), the full suite is green on pglite and Docker Postgres, the acme CLI smoke sequence matches every D-15..D-18 string, and Johan's pre-existing devrandom org upgraded with its `a00`/`a01` values unchanged**

## Performance

- **Duration:** 6 min of execution (Tasks 1-2), then a blocking human checkpoint open from 2026-10-01T13:00Z until Johan approved on 2026-10-02
- **Started:** 2026-10-01T12:54:04Z
- **Tasks 1-2 completed:** 2026-10-01T13:00:10Z (checkpoint position committed)
- **Checkpoint resolved:** 2026-10-02 (approved)
- **Tasks:** 3 (Task 1 TDD: RED commit, then GREEN commit; Task 2 verification only; Task 3 human-verify checkpoint)
- **Files modified:** 1

## Accomplishments
- T11 in `packages/api/src/api.test.ts`: `beforeAll` calls `reconcileKeyPrefixes(pool, schema, { orgSchema, mapping: { Project__c: "a0Z" } })` before `migrate`, `afterAll` calls `dropKeyPrefixes(pool, orgSchema)` before `DROP SCHEMA`; the new `it` asserts `GET /sobjects` reports `Project__c` with `keyPrefix: "a0Z", custom: true`, `GET /sobjects/Project__c/describe` returns `keyPrefix` `a0Z`, a REST-created `Project__c` Id matches `/^a0Z[0-9A-Za-z]{15}$/`, and `Account` keeps `001`
- Full suite green on both backends in CI order (install --frozen-lockfile, build, lint, test); exactly the two Postgres-only tests are skipped on pglite, none on Postgres
- The CLI smoke against Docker Postgres in the isolated schema `smoke_phase2` reproduced every expected count and literal string from plan 02-02 (four assignments, silent second run, provisional `check`, `reset` keeps, `reset --drop-prefixes` forgets, mapping seed, collision error with exit 1 and no stack trace), and left `_orglet.key_prefixes` with no `smoke_phase2` rows and the `devrandom` schema untouched
- Johan's devrandom org (the real-world PREFIX-02 case) was upgraded under the orchestrator's supervision and approved: `a00`/`a01` unchanged, second start silent

## Test results (Task 2 A, CI order: install --frozen-lockfile -> build -> lint -> test)

- pglite (`pnpm test`): 15 files passed, 153 passed | 2 skipped (155), 0 failed. Skipped = exactly the two Postgres-only tests: pglite-compat "runs two open transactions..." and prefixes "concurrent: two reconciles...".
- Docker Postgres (`ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test`): 15 files passed, 155 passed (155), 0 skipped, 0 failed.
- `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm lint`: exit 0.
- `pnpm vitest run packages/api/src/api.test.ts`: 17 passed on pglite and on Postgres.
- Note on the plan's acceptance criterion `-t "describe"`: it yields 2 failed | 15 skipped both before and after the change, because `token` is populated by the `login` block that the filter excludes (pre-existing file design). `-t "login|describe"` gives 7 passed, 0 failed; the whole file 0 failed. This is a plan-criterion issue, not a code defect.

## Smoke results (Task 2 B/C, schema `smoke_phase2`, port 8099, sleep 8 s per `up`)

Observed, in the plan's step order:

0. `reset --drop-prefixes` (clean slate): `dropped schema "smoke_phase2"` / `dropped 0 key prefix assignment(s) for schema "smoke_phase2"`
1. first `up`: 4 lines, `a00 BigTable__c`, `a01 Milestone__c`, `a02 Project__c`, `a03 UpsertTable__c`; 0 with a ` from ` suffix; banner present
2. second `up`: 0 `assigned` lines; banner present (D-16 silent)
3. `check --project examples/acme`: `25 objects (4 custom), 852 fields`, four `  <Name>  a0N  (provisional)` lines, closing sentence verbatim
4. plain `reset`: `dropped schema "smoke_phase2"` (no prefix line)
5. `up` after plain `reset`: 0 `assigned` lines
6. `reset --drop-prefixes`: `dropped 4 key prefix assignment(s) for schema "smoke_phase2"`
7. `up` after drop: 4 `assigned` lines again
9. `up --key-prefixes { "Project__c": "a0Z" }`: `assigned key prefix a0Z to Project__c from --key-prefixes` (1 line) plus `a00`/`a01`/`a03` for the other three
11. `up --key-prefixes { "Project__c": "001" }`: `exit=1`; stdout empty; last two stderr lines:
    ```
    error: key prefix 001 for Project__c (from --key-prefixes) collides with standard object Account (001)
    fix the conflicting --key-prefixes entry or the records that carry the prefix; stale assignments can be removed with: orglet reset --drop-prefixes   (this also drops the org's records)
    ```
    `grep -c '^error:'` = 1, `grep -c '    at '` = 0; 14 `warning: UNSUPPORTED:reference-target` lines from acme precede them (expected)
12. final `reset --drop-prefixes`: dropped 0 (the colliding run wrote nothing)

C. `_orglet.key_prefixes` rows by `org_schema` after the sequence: none for `smoke_phase2`; org schemas present: `devrandom` only (23 tables, untouched); no `p0202smoke` leftovers existed before the smoke either.

## Checkpoint outcome

Resolved 2026-10-02, **APPROVED** by Johan after the orchestrator ran the restart on his behalf.

- Johan stopped the old devrandom server (started before this phase), rebuilt with Node 22 and ran `node packages/cli/dist/index.js up --project ~/Development.nosync/devrandom-metadata --port 8180 --org-schema devrandom`.
- Startup printed exactly two assignment lines: `assigned key prefix a00 to ObjectBackup__c` and `assigned key prefix a01 to ObjectBackupRun__c`, then `schema "devrandom": 0 change(s) applied` and the normal `orglet is up on http://localhost:8180` banner. No `error:` line. The 15 pre-existing `warning: UNSUPPORTED:*` lines (one Summary field, 14 reference targets, phases 3 and 5) preceded them as expected.
- The lines carried NO ` from existing records` suffix. Investigation: `SELECT count(*), count(DISTINCT left(id,3))` on `devrandom.objectbackup__c` and `devrandom.objectbackuprun__c` both returned 0 rows. Both custom tables in the devrandom org are empty, so D-08 correctly fell through to tier 3 (provisional alphabetical), and `_orglet.key_prefixes` holds `devrandom | ObjectBackup__c | a00 | provisional` and `devrandom | ObjectBackupRun__c | a01 | provisional`. The values equal the old alphabetical scheme, so PREFIX-02 holds for this org; the "existing records" tier is evidenced by T4/T5 in `packages/schema/src/prefixes.test.ts` and not by devrandom. This is NOT a defect.
- Global describe on the running server (OAuth password grant, `GET /services/data/v59.0/sobjects`) returned `ObjectBackup__c` keyPrefix `a00` and `ObjectBackupRun__c` keyPrefix `a01`.
- `node packages/cli/dist/index.js check --project ~/Development.nosync/devrandom-metadata` printed `23 objects (2 custom), 861 fields`, then `  ObjectBackup__c  a00  (provisional)`, `  ObjectBackupRun__c  a01  (provisional)`, then the closing sentence `custom-object key prefixes are provisional here; \`orglet up\` assigns them once and reads them from the database thereafter`.
- Restart (orchestrator, on Johan's request): server stopped, started again with the same command. Second start printed 0 `assigned key prefix` lines, `schema "devrandom": 0 change(s) applied`, banner present; the two `_orglet.key_prefixes` rows were unchanged. The devrandom server is now running again on port 8180 (PID 90215) and was left alone by this continuation.

Deviation from the plan's expected text: the plan's step 3 anticipated ` from existing records` suffixes because 02-CONTEXT.md described devrandom as having records. The org had none, so the observed output is the correct behaviour for an empty org, and the plan's expectation (not the code) was wrong.

## Task Commits

1. **Task 1: Assert the persisted prefix through REST describe and record creation (T11)** - `2f76388` (test, RED) + `b7c58b6` (feat, GREEN)
2. **Task 2: Full suite on both backends and the CLI smoke sequence against Docker Postgres** - no commit (verification only)
3. **Task 3: Johan verifies the devrandom upgrade** - no commit (human checkpoint, approved); checkpoint position was recorded in `0e1d1f7` (docs, STATE.md)

## Files Created/Modified
- `packages/api/src/api.test.ts` - imports `dropKeyPrefixes`/`reconcileKeyPrefixes`, reconcile-with-mapping in `beforeAll` before `migrate`, `dropKeyPrefixes` in `afterAll` before `DROP SCHEMA`, new T11 `it` inside `describe("describe")`. No `a02` literal existed in the file, so nothing else changed.

## Decisions Made
- devrandom checkpoint approved 2026-10-02; both custom tables empty so the seed source was `provisional`, values identical to the old scheme.
- The `-t "describe"` acceptance grep is recorded as a plan-criterion flaw (the filter excludes the `login` block that sets `token`); the test file's design was left as is.

## Deviations from Plan
None in code. Two plan-expectation mismatches, both documented above and neither a defect: the `-t "describe"` filter criterion, and the checkpoint's anticipated ` from existing records` suffix for an org that turned out to have no records.

## Issues Encountered
None.

## Known Stubs
None. The plan modified a test file only.

## User Setup Required
None.

## Next Phase Readiness
- Phase 02 is complete end to end: PREFIX-01..04 have unit, integration, CLI-smoke and real-org evidence. Ready for `/gsd:verify-work` and the phase PR (push and PR are confirmed with Johan separately).
- Phase 6 (Bulk persistence) can reuse `ensureInternalSchema` and the `_orglet` sibling-schema pattern; the devrandom org already carries `_orglet.key_prefixes` rows, so phase 6's table creation must stay `IF NOT EXISTS` and must not touch that table.
- Open observation for a later cleanup (not this phase): `packages/api/src/api.test.ts` relies on `describe("login")` running first to populate `token`, which makes `-t` filtering of later blocks impossible.

---
*Phase: 02-custom-object-key-prefix-persistence*
*Completed: 2026-10-02*

## Self-Check: PASSED

`packages/api/src/api.test.ts` exists with the reconcile-with-mapping call; commits 2f76388, b7c58b6 and 0e1d1f7 are in git history.
