---
phase: 11-custom-metadata-custom-settings-labels
plan: 09
subsystem: conformance
tags: [conformance, jsforce, simple-salesforce, custom-metadata, custom-settings, phase-gate]
requires: ["11-07", "11-08"]
provides:
  - "run-all.sh runs cmdt-check-jsforce and cmdt-check-python on a second server (conformance/cmdt-check/project)"
  - "Phase 11 gate observed green: build, vitest, lint, all ten conformance legs"
affects: [conformance, schema]
key-files:
  modified:
    - conformance/run-all.sh
    - conformance/README.md
    - conformance/cmdt-check/README.md
    - packages/schema/src/ddl.ts
    - packages/api/src/custom-metadata.test.ts
key-decisions:
  - "Unique reference indexes on soft-delete objects are partial (WHERE isdeleted = false), so a deleted Hierarchy setting row releases its SetupOwnerId"
metrics:
  completed: 2026-10-21
---

# Phase 11 Plan 09: cmdt-check in the harness and the phase gate Summary

run-all.sh now starts a second orglet on `conformance/cmdt-check/project` (`CMDT_PORT` default PORT+1, `CMDT_SCHEMA` default `<ORG_SCHEMA>_cmdt`) and runs both cmdt-check legs; the gate is green on fresh schemas after one root-cause fix.

## Commits

- da6202a feat(11-09): second server and the two cmdt-check legs in run-all.sh, README rows
- 7660878 fix(11-09): deleted Hierarchy setting row releases its SetupOwnerId
- 1f810c5 docs(11-09): record the cmdt-check conformance result

## Gate results (observed)

- `pnpm build`, `pnpm lint`: clean.
- `pnpm test` on pglite: 43 files, 725 passed, 3 skipped (728).
- `pnpm test` against real Postgres (`ORGLET_DATABASE_URL`, localhost:5433): 43 files, 727 passed, 1 skipped (728). The skips are the existing environment-gated tests, not new.
- `PORT=8096 ORG_SCHEMA=p11_conf2 bash conformance/run-all.sh` (fresh schemas `p11_conf2`, `p11_conf2_cmdt`), rc 0:

```
=== summary ===
PASS jsforce-subset
PASS simple-salesforce
PASS describe-check-jsforce
PASS describe-check-python
PASS poly-check-jsforce
PASS poly-check-python
PASS rollup-check-jsforce
PASS rollup-check-python
PASS cmdt-check-jsforce
PASS cmdt-check-python
```

Leg numbers: jsforce subset 51 passed (core) and 12 passed (bulk), simple-salesforce 29/29, describe-check 32/32 each, poly-check 4/4 each, rollup-check 5/5 each, cmdt-check 8/8 each. SDKs: jsforce 9bae14e (3.10.26), simple-salesforce 1.12.10.
- Schemas created by this plan (`p11_conf`, `p11_conf_cmdt`, `p11_conf2`, `p11_conf2_cmdt`, `p11_ui`) were reset with `--drop-prefixes` afterwards.
- UI smoke (step 3b): the page itself was not opened. Its HTTP calls were exercised on the fixture server: page 200, `Support_Tier__mdt` describe has 20 fields and no `Name`, `SELECT Id, DeveloperName FROM Support_Tier__mdt` returns 3 records. No change to `index.html` was needed.

## Deviations from Plan

**1. [Rule 1 - Bug] Deleted Hierarchy setting row kept blocking its SetupOwnerId**
- **Found during:** Task 2, first conformance run (cmdt-check-python 7/8, `hierarchy-duplicate`).
- **Issue:** The jsforce leg deletes the org-default `App_Config__c` row it created; delete is a soft delete, and the unique `SetupOwnerId` index (D-18) still counted that row, so the next leg's first insert failed with DUPLICATE_VALUE. The same would hit any user who deletes and re-creates the org default. In Salesforce a deleted custom-setting row does not linger.
- **Fix:** `IndexSpec.where`; unique Lookup/MasterDetail/MetadataRelationship indexes on objects with `IsDeleted` are created as partial indexes `WHERE "isdeleted" = false`. Ordinary unique fields (Text etc.) are unchanged. Added regression assertions to the existing D-18 test in `custom-metadata.test.ts` (delete the user-level row, create it again: 201); verified the test fails without the fix. No leg assertion was changed.
- **Files:** packages/schema/src/ddl.ts, packages/api/src/custom-metadata.test.ts
- **Commit:** 7660878
- **Note:** Existing org schemas created before this change keep the old non-partial index (`CREATE INDEX IF NOT EXISTS` by name); only fresh schemas get it. Phase 11 is unreleased, so no migration was added.

## Auth gates

None.

## Known Stubs

None.

## Self-Check: PASSED
