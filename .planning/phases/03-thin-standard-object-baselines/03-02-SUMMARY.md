---
phase: 03-thin-standard-object-baselines
plan: 02
subsystem: engine, schema
tags: [salesforce, dml, object-flags, import-mode, bootstrap, migrate, foreign-keys, vitest]

requires:
  - phase: 03-thin-standard-object-baselines
    provides: 14 thin standard-object baseline JSON files with explicit object flags (03-01)
provides:
  - Errors.invalidTypeForOperation (StatusCode INVALID_TYPE_FOR_OPERATION)
  - DmlEngine.refuse() object-flag guard for insert/update/upsert/delete/undelete, bypassed in import mode
  - bootstrapOrg seeds default BusinessHours and the Salesforce UserLicense, links the admin profile
  - migrate() wraps a dangling-data FK failure (23503) into an error naming table, column and target
affects: [03-03 API exposure of flag errors and seed rows, 03-04 describe checks, orglet up on existing orgs]

tech-stack:
  added: []
  patterns:
    - "Object-level flag guard as one private method, mirroring coerce.ts's field-level import-mode bypass"
    - "Seed rows via Store (raw insert), never via DmlEngine, so read-only objects can get rows"

key-files:
  created:
    - packages/engine/src/bootstrap.test.ts
  modified:
    - packages/engine/src/errors.ts
    - packages/engine/src/engine.ts
    - packages/engine/src/engine.test.ts
    - packages/engine/src/bootstrap.ts
    - packages/schema/src/migrate.ts
    - packages/schema/src/migrate.test.ts

key-decisions:
  - "Object-flag violations return INVALID_TYPE_FOR_OPERATION instead of INVALID_OPERATION (D-09); the REST status stays 400"
  - "upsert requires createable and updateable; undelete requires undeletable (both were unguarded)"
  - "Import mode bypasses object flags (D-08)"
  - "migrate() fails with a clear message on dangling FK data; no NOT VALID, no force path"

requirements-completed: [BASE-02, BASE-03]

duration: 12min
completed: 2026-10-08
---

# Phase 3 Plan 02: Object-Flag Enforcement, Seed Rows and Upgrade FKs Summary

**Every DML call that a thin object's flags forbid now fails with `INVALID_TYPE_FOR_OPERATION` (upsert and undelete included), and import mode bypasses that check. `bootstrapOrg` seeds the default BusinessHours and the Salesforce UserLicense once. When an upgrade adds a foreign key and finds a dangling Id, `migrate()` stops with an error that names the table and column.**

## Accomplishments

- **D-09:** `Errors.invalidTypeForOperation` returns the documented StatusCode `INVALID_TYPE_FOR_OPERATION`. It replaces `INVALID_OPERATION` for object-flag violations. The message is still `entity type <Name> does not support <operation>`, and the REST status stays 400 because the error is a per-record SaveError. `Errors.invalidOperation` is kept for "The record is not in the recycle bin".
- One `private refuse(obj, operation, count)` guard is the first statement after `this.object(sobject)` in all five DML methods. upsert needs `createable && updateable`, and undelete needs `undeletable`; neither had a check before. Each call returns a fresh error object per record.
- **D-08:** `importMode` skips `refuse()`. The importer can now insert UserLicense, OpportunityHistory, ExternalDataSource and CallCenter rows with their supplied Ids, update a CallCenter row, and delete and undelete a BusinessHours row. The normal-mode engine still rejects the same calls.
- **BASE-02:** no code change was needed. Tests confirm that lookups to the thin objects (`Case.BusinessHoursId`, `Contact.IndividualId`) reject unknown Ids and Ids with the wrong prefix with `INVALID_CROSS_REFERENCE_KEY`, and accept real target rows. The compound `Individual.Name` also works.
- **D-05/D-06/D-07a:** `bootstrapOrg` creates the following rows, but only when they are missing:
  - one BusinessHours row: `Default`, IsDefault, IsActive
  - one UserLicense row: `Name` and `MasterLabel` both `Salesforce`

  It also sets `Profile.UserLicenseId` on the admin profile, but only while that field is NULL (`WHERE "userlicenseid" IS NULL`). A second run changes nothing. If any default BusinessHours already exists (an imported one too), no new one is created. An existing profile link is never rewritten.
- **FK policy:** if `ADD CONSTRAINT` fails with SQLSTATE 23503, `migrate()` throws this error (verbatim template) and the whole migration rolls back:

  ```
  cannot add foreign key <fk.name>: <org>.<table>.<column> holds values with no matching row in <org>.<referencesTable>; clear or correct those values (for example lookups loaded with --import whose target records were not imported) and run again
  ```

  The Postgres error is kept as `cause`. Any other error is rethrown unchanged. There is no `NOT VALID` and no force path.

## Task Commits

1. Task 1, object flags (T4, T5, T7, T8)
   - RED: `b87f2e6` test(03-02): add failing object-flag, import-bypass and thin reference tests (3 failed / 17 passed)
   - GREEN: `6263e01` feat(03-02): enforce object flags with INVALID_TYPE_FOR_OPERATION, bypassed in import mode
2. Task 2, seed rows (T9)
   - RED: `87b6c3d` test(03-02): add failing bootstrap seed-row tests (3 failed / 1 passed; the idempotency test passes trivially on zero rows)
   - GREEN: `2ddd93d` feat(03-02): seed default BusinessHours and Salesforce UserLicense at bootstrap
3. Task 3, upgrade FKs (T13)
   - RED: `4ac89b6` test(03-02): add thin upgrade and dangling-FK migrate tests (dangling test failed with Postgres's bare `insert or update on table "case" viol…`; upgrade test passed and pins existing behaviour)
   - GREEN: `950da70` feat(03-02): name table and column when an upgrade's foreign key meets dangling data

## Verification (observed, pglite)

- `pnpm vitest run packages/engine/src/engine.test.ts -t "object flags"`: 4 passed | 16 skipped (20)
- `pnpm vitest run packages/engine/src/engine.test.ts -t thin`: 5 passed | 15 skipped (20). This includes the 2 T4 tests; the substring `thin` also matches 3 other test names. 0 failed.
- `pnpm vitest run packages/engine/src/engine.test.ts`: 20 passed (20)
- `pnpm vitest run packages/engine/src/bootstrap.test.ts`: 4 passed (4)
- `pnpm vitest run packages/schema/src/migrate.test.ts -t thin`: 2 passed | 4 skipped (6); whole file: 6 passed (6)
- `pnpm vitest run packages/engine packages/api packages/schema`: 9 files, 111 passed | 2 skipped
- `pnpm build` and `pnpm lint` exit 0
- Full `pnpm test`: 16 files, 178 passed | 2 skipped (180). The 2 skipped tests are the pre-existing Postgres-only ones.
- All `grep` acceptance criteria from the plan hold. One example: `this.refuse(obj, "...")` appears 5 times, and both `does not support` and `invalidOperation(` appear once each in engine.ts.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in test data] Contact.IndividualId literal had an invalid case-safe suffix**
- **Found during:** Task 1 RED
- **Issue:** The plan's literal `"0PK000000000001AAA"` has the wrong 3-character checksum, because `P` and `K` are uppercase. The Id coercer rejected it with `MALFORMED_ID`, so the reference check never ran.
- **Fix:** Use `toCaseSafeId("0PK000000000001")`. The assertion is unchanged (`INVALID_CROSS_REFERENCE_KEY` on `IndividualId`).
- **Files modified:** packages/engine/src/engine.test.ts
- **Commit:** b87f2e6

**2. [Rule 3 - Lint] `expect.stringMatching(...)` inside object literals tripped `no-unsafe-assignment`**
- **Fix:** Added `as unknown` casts in bootstrap.test.ts (4 places). The test semantics are unchanged.
- **Commit:** 87b6c3d

## Pitfall 5 note (import mode and UserLicense)

When a Profile is loaded with `--import`, it keeps the `UserLicenseId` it was imported with. Bootstrap only links profiles whose value is NULL. An org that imported Profiles without their UserLicense rows must therefore import those rows too (D-08 now allows that). Otherwise the next migrate stops at `fk_profile_userlicenseid` with the new error.

## Known Stubs

None.

## Self-Check: PASSED

- packages/engine/src/bootstrap.test.ts exists.
- Commits b87f2e6, 6263e01, 87b6c3d, 2ddd93d, 4ac89b6, 950da70 are present in `git log`.
