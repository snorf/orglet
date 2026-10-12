---
phase: 07-conformance-re-run-milestone-acceptance
plan: 03
subsystem: testing
tags: [jsforce, conformance, jest, bulk2, harness]

requires:
  - phase: 07-conformance-re-run-milestone-acceptance
    provides: "07-01 Bulk 2.0 error separator fix and check --strict"
provides:
  - "Pinned, stamp-guarded, two-invocation jsforce harness (conformance/jsforce/run.sh)"
  - "Measured core run (51 passed / 0 failed) and a classified 17-test bulk2 run"
  - "Approved dispositions for every non-passing bulk2 test (branch B for 07-04: no code change)"
affects: [07-04, 07-06]

tech-stack:
  added: []
  patterns: ["Stamp file .orglet-built guards npm ci + tsc", "CORE_FILTER / BULK2_FILTER split into two Jest invocations"]

key-files:
  created: []
  modified: [conformance/jsforce/run.sh]

key-decisions:
  - "Empty-CSV Bulk 2.0 upload: exclude (not-implemented); no orglet code change"
  - "Jigsaw* tests excluded as not-implemented; upsert-without-Id test excluded as test-defect"
  - "bulk query test stays included; README notes its weak (un-awaited) assertions"

requirements-completed: []  # ACCEPT-02 deferred to 07-06 (final evidence task) by orchestrator decision bd0b804

duration: n/a
completed: 2026-10-12
---

# Phase 7 Plan 03: jsforce harness pin and bulk2 classification Summary

**run.sh pinned to jsforce 9bae14ea with a stamp-guarded build and two Jest invocations; core run measured at 51 passed / 0 failed, and all 17 bulk2 tests classified from a real unfiltered run.**

## Task Commits

1. **Task 1: Rewrite run.sh** - `9e1fbcc` (feat). Pinned sha `9bae14ea0f1b9dff3b0cb0862a3e5f525f25a29f`, stamp-guarded build (`.orglet-built`), CORE_FILTER run on the 4 core files, BULK2_FILTER run on `test/bulk2.test.ts` (BULK2_FILTER still empty).
2. **Task 2: Measure core and unfiltered bulk2 runs** - no repo files; log in the session scratchpad (`jsforce-07-03.log`).
3. **Task 3: Decision checkpoint** - resolved by Johan, recorded below; no files changed.

## Measured results

Run on orglet 9e1fbcc, 2026-10-12, jsforce 9bae14ea (3.10.26), fresh schema `jsconf7`, port 8092, `examples/acme` with `--seed`. run.sh exit 1 (run 2 was deliberately unfiltered).

- Run 1 (core, 4 files, CORE_FILTER): `Tests: 60 skipped, 51 passed, 111 total`; 0 failed; 4/4 suites passed.
- Run 2 (`test/bulk2.test.ts`, unfiltered): `Tests: 5 failed, 12 passed, 17 total`.

### 17-row classification

| # | Test | Result | Disposition | Basis |
|---|------|--------|-------------|-------|
| 1 | bulk insert records and return result status | PASS | include | 201 rows incl. blank trailing line failing REQUIRED_FIELD_MISSING [Name]; test passes |
| 2 | bulk update and return updated status | PASS | include | |
| 3 | bulk update with empty input and not raise client input error | FAIL | EXCLUDE not-implemented | jsforce sends PUT with 0-byte body (proxy-verified); orglet returns 201, then at UploadComplete sets the job Failed with "InvalidBatch : the uploaded CSV had no header row" (processIngestJob, packages/api/src/routes/bulk.ts ~143). Salesforce behaviour for an empty upload is undocumented (no quote found), so per D-21 no fix in this phase. |
| 4 | bulk delete and return deleted status | PASS | include | |
| 5 | bulk delete with empty input and not raise client input error | FAIL | EXCLUDE not-implemented | same as 3 |
| 6 | bulk insert from file and return inserted results (first of two with this name) | FAIL | EXCLUDE not-implemented | all 100 rows INVALID_FIELD "No such column 'JIGSAWCOMPANYID' on sobject of type Account"; Account baseline lacks the Data.com legacy Jigsaw* fields; the reported "no header row" error is masked by the finally-cleanup delete job with empty input. Other uppercase headers resolve (case-insensitive headers work). |
| 7 | bulk insert from file and return inserted results (second, same name) | FAIL | EXCLUDE not-implemented | same as 6 (one filter entry covers both) |
| 8 | bulk upsert from CSV file using backquote as a delimiter | FAIL | EXCLUDE test-defect | CSV has no Id column while the job sets externalIdFieldName 'Id'; all 10 rows REQUIRED_FIELD_MISSING [Id]; backquote delimiter parses correctly. |
| 9 | bulk query and get records | PASS | include | assertions live in an un-awaited `end` handler (weak pass; README note, not excluded) |
| 10 | invalid session conn with refresh fn | PASS | include | |
| 11 | invalid session conn without refresh fn, raise error | PASS | include | |
| 12 | Query#update and return updated status | PASS | include | |
| 13 | Query#update with unmatching query, empty array | PASS | include | |
| 14 | Query#destroy and return deleted status | PASS | include | |
| 15 | Query#destroy with unmatching query, empty array | PASS | include | |
| 16 | Query#update with bulkThreshold modified | PASS | include | |
| 17 | Query#destroy with bulkThreshold modified | PASS | include | |

## Decision (Task 3)

Johan decided at the Task 3 checkpoint (2026-10-12):

- Empty-CSV: **exclude-empty**. Tests 3 and 5 are excluded, classification `not-implemented`, reason "empty upload is marked Failed; Salesforce behaviour undocumented". No orglet code change. Deferred todo candidate: "revisit empty Bulk 2.0 upload once a documentation basis exists".
- Tests 6/7: approved - exclude, `not-implemented` (Data.com Jigsaw* fields absent from the Account baseline; deprecated in Salesforce, not planned).
- Test 8: approved - exclude, `test-defect` (upsert on Id without an Id column cannot succeed on any server).
- Test 9: approved - stays included; README notes the weak assertion.

### Handoff to 07-04

Branch B (no code change). The final BULK2_FILTER must exclude exactly the names of tests 3, 5, 6/7 and 8. Expected bulk2 result after filtering is 12 passed / 0 failed / 5 excluded; this is an expectation to be MEASURED in 07-04, not assumed.

## Deviations from Plan

None - plan executed as written; the Task 3 checkpoint was resolved by Johan.

## Requirements

ACCEPT-02: deferred to 07-06 (stays Pending until the final evidence task, per orchestrator decision bd0b804).

## Known Stubs

None.

## Self-Check: PASSED
