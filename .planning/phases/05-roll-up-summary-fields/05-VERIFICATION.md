---
phase: 05-roll-up-summary-fields
verified: 2026-10-09T11:10:00Z
status: passed
score: 5/5 must-haves verified
---

# Phase 5: Roll-Up Summary Fields Verification Report

**Phase Goal:** Summary fields load from metadata, recompute correctly in the app-side save pipeline across every child mutation path (including reparent and undelete), and are read-only and queryable like any other field.
**Status:** passed. **Re-verification:** No.

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Summary fields load from SFDX; parent typed correctly; lookup roll-up fails load | VERIFIED | `sfdx.ts` parses Summary; `metadata/src/rollup.ts` (`resolveRollups`, wired from `build.ts:483`, `rollupField`) throws a named error for non-master-detail, non-whitelisted lookups (D-05/D-08); degrades with `UNSUPPORTED:rollup-*` otherwise. Re-ran metadata tests: 55 passed (rollup, sfdx, build). |
| 2 | COUNT/SUM/MIN/MAX with filter operators (incl. valueField) on insert/update/filter-only update/delete/undelete/reparent; old and new parent | VERIFIED | `engine/src/rollups.ts` `affectedParents`; `engine.ts` `withRollups`/`recomputeRollups` wired in save (l.445), delete (l.715) and undelete (l.737). Re-ran `rollups.test.ts`: 41 passed, including reparent, filter-only change, per-operator counts, delete/undelete, soft-deleted exclusion. |
| 3 | Chains recurse without infinite loop; partial-success reflects committed children only | VERIFIED | `recomputeRollups` level loop plus the schema-level `UNSUPPORTED:rollup-cycle` guard. `rollup_batch` and `rollup_parent` savepoints. Tests: `grandparent_follows_...`, `refusing_grandparent_fails_the_child_and_rolls_back_the_parent`, `partial_success_batch_counts_only_committed_children`, `failed_parent_rolls_back_only_its_own_children`. |
| 4 | Read-only via REST and Bulk, describe flags, queryable in SOQL | VERIFIED | `describe.ts:111` calculated; `api.test.ts:479` asserts the flags; `bulk.test.ts` and `api.test.ts` cover rejected writes; the engine SOQL tests cover select, filter, order and aggregate. SDK gate (05-07 summary): jsforce 5/5 and simple-salesforce 5/5, with `INVALID_FIELD_FOR_INSERT_UPDATE` on write. |
| 5 | DE retrieve gives zero `UNSUPPORTED:field-type` for Summary | VERIFIED (by recorded evidence) | 05-07-SUMMARY: `orglet check` printed 0 warnings, 0 `UNSUPPORTED:field-type`, 0 `UNSUPPORTED:rollup`; 37 objects, 983 fields. I did not read the local retrieve, as instructed. See Human note. |

**Score:** 5/5

## Artifacts and Wiring

| Artifact | Status |
|----------|--------|
| `packages/metadata/src/rollup.ts` (276 lines), `build.ts`, `sfdx.ts`, `types.ts` (`FieldDef.rollup`) | VERIFIED, wired |
| `packages/schema/src/rollup.ts` (153 lines, `rollupSelectSql`, `rollupBackfillSql`, `rollupDepth`), `migrate.ts` backfill (l.134-181) | VERIFIED, wired and used by the engine |
| `packages/engine/src/rollups.ts` (114 lines), `engine.ts` (defaults 0/null at l.575) | VERIFIED, data flows from real SQL aggregates |
| `packages/api/src/describe.ts` | VERIFIED |
| `examples/acme` roll-up fields (6 Summary fields) | VERIFIED |
| `conformance/rollup-check/{jsforce.mjs,sf_rollup.py,README.md}` | VERIFIED present, results recorded |

Test evidence: I re-ran the metadata, schema-rollup and engine-rollup test files (112 passed). The orchestrator reports the full suite at 341 passed / 2 skipped, with eslint clean. 05-07 reports 343/0 on Docker Postgres 16.

## Requirements Coverage

All nine IDs appear in the PLAN frontmatter (05-01: ROLL-01, 03; 05-02: ROLL-01, 02, 03, 06, 09; 05-03: ROLL-07, 08, 09; 05-04: 03, 06, 08; 05-05: 03, 04, 05, 06; 05-06: 03, 04, 06, 08; 05-07: all) and are marked Complete in REQUIREMENTS.md. There are no orphans.

| ID | Status |
|----|--------|
| ROLL-01 | SATISFIED |
| ROLL-02 | SATISFIED |
| ROLL-03 | SATISFIED |
| ROLL-04 | SATISFIED |
| ROLL-05 | SATISFIED |
| ROLL-06 | SATISFIED |
| ROLL-07 | SATISFIED |
| ROLL-08 | SATISFIED |
| ROLL-09 | SATISFIED. Closed via Johan's checkpoint, approved with a note. |

## Known gaps judged

| Gap | Verdict |
|-----|---------|
| (a) No primary Salesforce quote for reparent and undelete triggers | Acceptable. The behaviour is implemented and tested as ROLL-04 requires. It is a sourcing note, not a functional gap. |
| (b) No re-backfill when an existing roll-up's definition changes | Acceptable. D-10 only requires backfill when a column is added. Recommend recording it as a deferred item, because a stale value is possible after a definition change. |
| (c) Date-literal filters are `UNSUPPORTED:rollup-filter` | Acceptable. The field is skipped with a warning and is never computed with the filter dropped (D-06). |
| (d) No parent row locking | Acceptable for a single-tenant tool. |
| (e) `reparentableMasterDetail` not enforced | Acceptable. It is pre-existing and outside the phase goal. |

## Anti-Patterns

None blocking. 05-07 reports Known Stubs: None.

## Notes (non-blocking)

- ROLL-09 evidence is by recorded counts and a human checkpoint. The first-start backfill line was not observed because the column already existed and the tables were empty, so DE backfill against real rows is untested. The acme-based backfill tests and the SDK gate cover the backfill itself.
- The SDK conformance legs are manual scripts and are not part of CI. This is expected until the Phase 7 conformance setup.

---
_Verified: 2026-10-09_
_Verifier: Claude (gsd-verifier)_
