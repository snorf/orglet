---
phase: 11-custom-metadata-custom-settings-labels
verified: 2026-10-21T09:05:00Z
status: passed
score: 5/5 must-haves verified
---

# Phase 11: Custom Metadata, Custom Settings & Labels Verification Report

**Phase Goal:** Custom metadata types with their records, custom settings and custom labels in a retrieve load as the objects and data they are, so nothing needs to be skipped.
**Status:** passed. **Re-verification:** No.

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `__mdt` describe/SOQL via jsforce and simple-salesforce, stable Ids, `"007"` text, nil null, removed record disappears | VERIFIED | `packages/engine/src/seed.ts` (D-01 hash Ids, D-03 sync, D-04 summary at :227); `seed.test.ts` (17 tests: same Ids after reset and in a second schema, hard delete, Id returns); `conformance/cmdt-check` jsforce 8/8 and simple-salesforce 8/8 recorded in its README Results table (commit 7660878) |
| 2 | DML on `__mdt` rejected; describe flags only describe/query/retrieve | VERIFIED | `engine.ts:128-129` D-13 check before the importMode return, with a comment citing the decision; `bulk.ts:249` D-14 refusal at job creation; `api/src/describe.ts:183-215` flags (`customSetting` false on `__mdt`, `layoutable`/`triggerable` etc. `!mdt`, `retrieveable` true); `custom-metadata.test.ts` |
| 3 | MetadataRelationship: mdt returns Id; entity/field definition returns qualified name; `Rel__r.QualifiedApiName` selectable; dangling warns and is null | VERIFIED | `describe.ts:46,104` (orglet choice recorded); `UNSUPPORTED:entity-definition` in `soql/src/errors.ts` with `compile.test.ts` coverage; README lists the `reference-target` and `custom-metadata-record` warnings for the dangling cases; conformance 8/8 on both SDKs |
| 4 | Custom setting `customSetting: true`, no `OwnerId`; second hierarchy row gives `DUPLICATE_VALUE`; `orglet check` states data is not part of a retrieve | VERIFIED | `describe.ts:193`; `engine.ts:457-458` SetupOwnerId default; `ddl.ts:55-60` unique index (23505 mapped to DUPLICATE_VALUE); `cli/src/main.ts:96` info line, no `UNSUPPORTED:` prefix (D-20); `cli/src/main.test.ts:175,216` |
| 5 | Custom labels on the loaded schema with name, value, language, category | VERIFIED | `metadata/src/types.ts:240,265` (`OrgSchema.labels`, case-insensitive map); the conformance fixture asserts 2 labels with categories; duplicate-fullName warning `UNSUPPORTED:custom-label` (D-22) is listed in the README |

**Score:** 5/5

## Locked decisions and constraints

- D-13: honored (`engine.ts:128-129`).
- D-15: honored (`describe.ts`).
- D-10: `INVALID_FIELD` with an `UNSUPPORTED:entity-definition` message (`soql/src/errors.ts`).
- D-20: honored (`cli/src/main.ts:96`).
- D-04: honored; the format string at `seed.ts:227` matches.
- `EXPECTED_WARNINGS: string[] = []` is unchanged (`upgrade.test.ts:25`).
- `git diff c5b3b2e..HEAD --stat -- examples/acme` is empty, and so is the diff of `packages/sigha/src`.
- The conformance fixture is a separate project with invented names, so `examples/acme` stays untouched.
- `pnpm vitest run packages` was run by the verifier: 43 files passed, 725 tests passed, 3 skipped.
  - The skips were not traced to specific tests. My `grep` for `skip` and `skipIf` markers failed on a shell glob error and was not re-run.
  - They are most likely pre-existing environment-conditional skips, and I found no evidence they belong to Phase 11.
  - I report them here rather than treating them as covered.
- The orchestrator's earlier full suite, build, lint and `run-all.sh` runs were accepted. I did not re-run the conformance harness. The recorded results exist in `conformance/cmdt-check/README.md`.

## Deviations assessment

- (a) Commit 13bc0c2 touches only `test/db.ts` (+48) and `custom-metadata.test.ts`. It is test-only, with no production code path, and the code comment documents electric-sql/pglite#958 with its versions and mechanism. Acceptable.
- (b) Commit 7660878 makes unique reference indexes on soft-delete objects partial (`WHERE "isdeleted" = false`, `ddl.ts:60`).
  - It is consistent with D-18. The unique SetupOwnerId index still produces `DUPLICATE_VALUE` for live rows, and a deleted setting row is gone for good in Salesforce, so releasing the Id is correct.
  - Caveat: schemas already migrated keep the old full unique index, because there is no migration for this. Per the task, the phase is unreleased, so this is acceptable. It is worth a note if any dev org already exists.
  - Side effect: the partial index applies to all soft-delete objects with unique references. No baseline lookup is unique, so existing indexes are unchanged (per the comment at `ddl.ts:55`).

## Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| CMDT-01 | SATISFIED | `__mdt` loads as a read-only object; describe flags; `custom-metadata.test.ts` |
| CMDT-02 | SATISFIED | `seed.ts` and `seed.test.ts` |
| CMDT-03 | SATISFIED | MetadataRelationship load, SOQL alias, dangling warnings |
| CMDT-04 | SATISFIED | cmdt-check conformance 8/8 on both SDKs |
| CSET-01 | SATISFIED | `customSetting`, SetupOwnerId, check info line |
| CSET-02 | SATISFIED | `OrgSchema.labels` |

No orphaned requirements. REQUIREMENTS.md marks all six Complete.

## Anti-patterns

None blocking. The Phase 11 code follows the `UNSUPPORTED:<area>` convention and real Salesforce StatusCodes, with English comments. The comment on `INVALID_TYPE_FOR_OPERATION` flags it as a convention in this repo, since no data-API StatusCode for `__mdt` DML is documented.

## Human Verification Required

None required. Optional: a visual check of the built-in UI page. The README notes it was not opened in a browser, but the calls it makes were exercised over HTTP.

---
_Verified: 2026-10-21_
_Verifier: Claude (gsd-verifier)_
