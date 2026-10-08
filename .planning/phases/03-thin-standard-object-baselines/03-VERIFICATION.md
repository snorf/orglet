---
phase: 03-thin-standard-object-baselines
verified: 2026-10-08T20:35:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 3: Thin Standard-Object Baselines Verification Report

**Phase Goal:** The 14 standard objects a Developer Edition references but the baseline lacks exist as correctly-described, reference-checkable baseline objects with documented DML restrictions.
**Status:** passed
**Re-verification:** No, initial verification

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | 14 objects exist with key prefix, name field, system fields | VERIFIED | All 14 JSON files under packages/metadata/standard/objects carry keyPrefix and explicit flags (no `thin` switch). Exactly one nameField each (ExternalDataSource DeveloperName, IdeaTheme Title, ServiceAppointment AppointmentNumber, rest Name), none for OpportunityHistory (D-02). Fields are the strict minimum plus D-07 extras (BusinessHours IsActive/IsDefault, UserLicense MasterLabel, Individual FirstName/LastName). |
| 2 | Invalid lookup Id gives INVALID_CROSS_REFERENCE_KEY | VERIFIED | `orglet check` on the baseline and acme gives zero reference-target warnings, so the lookups are resolvable and checked; the engine and api tests (reference check) are green. |
| 3 | DML respects flags with the right code | VERIFIED | `refuse()` in engine.ts is called from insert, update, upsert, delete and undelete. It uses `Errors.invalidTypeForOperation` (INVALID_TYPE_FOR_OPERATION) with the message "entity type X does not support op". Import mode bypasses it (D-08). `invalidOperation` remains only for the recycle-bin case (engine.ts:202). Flags match the Fact Table and D-03a: ExternalDataSource, OpportunityHistory and UserLicense read-only; CallCenter create-only; BusinessHours and BusinessProcess create/update only. |
| 4 | describe() works for both SDKs | VERIFIED (SDK runs from 03-04 evidence) | `idEnabled: true` in describe.ts:194. contract.json and objects.txt are the single source, read by jsforce.mjs, sf_describe.py and api.test.ts. The summary records 14/14 for both SDKs. I did not start a server, so I did not re-run the live scripts; the vitest contract test covers the same contract. |
| 5 | DE retrieve gives zero reference-target warnings | VERIFIED | Ran `orglet check --project ~/Development.nosync/devrandom-metadata` and got 0 reference-target lines. The only warning is the phase-5 Summary `UNSUPPORTED:field-type`. `check --project examples/acme` prints no warning. |

**Score:** 5/5

## Other CONTEXT checks

- Seed rows: bootstrap tests are green, covering seeding, a second bootstrap leaving the same rows and Ids, and recreation plus profile relink (D-05/D-06/D-07a).
- Migrate: 23503 is wrapped in an error naming fk, table, column and target, inside the transaction so it rolls back. `NOT VALID` is absent. Both thin upgrade tests are green.
- UNSUPPORTED misuse: none found in bootstrap, describe or the JSON files.
- REQUIREMENTS.md BASE-03 and ROADMAP criterion 3 both say BusinessHours and BusinessProcess are create/update only, no delete.
- README has a "Thin standard objects" section.

## Requirements Coverage

| Requirement | Plans | Status |
|-------------|-------|--------|
| BASE-01 | 03-01 | SATISFIED |
| BASE-02 | 03-01, 03-04 | SATISFIED |
| BASE-03 | 03-01, 03-02, 03-03 | SATISFIED |
| BASE-04 | 03-03, 03-04 | SATISFIED |
| BASE-05 | 03-01, 03-04 | SATISFIED |

No orphaned requirements.

## Behavioral Spot-Checks

| Check | Result |
|-------|--------|
| `pnpm vitest run packages/metadata cli engine schema api` (pglite) | 12 files, 149 passed, 2 skipped (both Postgres-only), 0 failed |
| `tsc -b` and `pnpm lint` | clean |

## Anti-Patterns

None blocking. The known divergence (IsDeleted/audit fields on five objects) is documented and accepted.

## Human Verification

None required. The live SDK scripts and the devrandom upgrade were covered by 03-04 with Johan's approval.

---
_Verified: 2026-10-08_
_Verifier: Claude (gsd-verifier)_
