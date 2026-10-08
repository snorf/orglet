---
phase: 03-thin-standard-object-baselines
plan: 01
subsystem: metadata
tags: [salesforce, standard-objects, baseline-json, key-prefix, vitest]

requires:
  - phase: 02-custom-object-key-prefix-persistence
    provides: planKeyPrefixes collision check against every standard prefix
provides:
  - 14 thin standard-object baseline JSON files with explicit object flags
  - Fact-table, reference-target, acme-check and standard-prefix tests
  - BASE-03 wording corrected in REQUIREMENTS and ROADMAP (D-04)
affects: [03-02 flag enforcement, 03-03 seed rows, 03-04 describe checks]

tech-stack:
  added: []
  patterns:
    - "Thin object = strict-minimum baseline JSON with all five flags stated explicitly, no generic thin switch"

key-files:
  created:
    - packages/metadata/standard/objects/BusinessHours.json
    - packages/metadata/standard/objects/BusinessProcess.json
    - packages/metadata/standard/objects/CallCenter.json
    - packages/metadata/standard/objects/DandBCompany.json
    - packages/metadata/standard/objects/Entitlement.json
    - packages/metadata/standard/objects/ExternalDataSource.json
    - packages/metadata/standard/objects/IdeaTheme.json
    - packages/metadata/standard/objects/Individual.json
    - packages/metadata/standard/objects/OperatingHours.json
    - packages/metadata/standard/objects/OpportunityHistory.json
    - packages/metadata/standard/objects/ServiceAppointment.json
    - packages/metadata/standard/objects/ServiceContract.json
    - packages/metadata/standard/objects/SocialPost.json
    - packages/metadata/standard/objects/UserLicense.json
  modified:
    - packages/metadata/src/build.test.ts
    - packages/cli/src/main.test.ts
    - packages/schema/src/prefixes.test.ts
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md

key-decisions:
  - "Thin objects carry only name field, system fields, OwnerId when owned, plus D-07 seed fields and Individual compound fields"
  - "OpportunityHistory has no name field and an empty fields[] (D-02); the name-field invariant test lists it explicitly in NO_NAME_FIELD"
  - "BusinessHours and BusinessProcess are create/update only, no delete (D-04); REQUIREMENTS and ROADMAP corrected"

requirements-completed: [BASE-01, BASE-03, BASE-05]

duration: 8min
completed: 2026-10-08
---

# Phase 3 Plan 01: Thin Standard-Object Baselines Summary

**14 thin standard objects added as baseline JSON with documented prefixes, name fields and explicit DML flags, removing all 14 `UNSUPPORTED:reference-target` warnings for acme.**

## Accomplishments

- 14 JSON files auto-discovered by `loadBaseline()` (no loader change); 35 baseline objects in total.
- The 18 existing baseline lookups that point at these objects became checked references.
- `orglet check --project examples/acme` previously printed exactly the 14 reference-target warnings and nothing else; it now prints no warning line.
- Phase 2's prefix collision check now sees the 14 new standard prefixes; none start with `a`.
- BASE-03 wording corrected (BusinessHours and BusinessProcess: no delete).

## Commits

- `test(03-01)` add failing thin standard-object fact-table tests (RED; 8 tests failed)
- 3e9453e `feat(03-01)` add the 14 thin standard-object baselines (GREEN)
- ca2bd1f `test(03-01)` guard acme warnings and standard-prefix interplay; fix BASE-03 wording

The Task 2 tests (T3, T12) guard behaviour Task 1 already produced, so they pass on first run; the RED step for them is Task 1's commit.

## The 14 objects and their sources

Flags for all 14: Object Reference v68/v56.

| Object | Prefix | Name field | Owned | create/update/delete/undelete | Prefix/name/owner source |
|---|---|---|---|---|---|
| BusinessHours | 01m | Name | no | T/T/F/F | public sources (research Fact Table) |
| BusinessProcess | 019 | Name | no | T/T/F/F | public sources (research Fact Table) |
| CallCenter | 04v | Name | no | T/F/F/F | public sources (research Fact Table) |
| DandBCompany | 06E | Name | no | T/T/T/T | author's own DE describe, 2026-10-08 |
| Entitlement | 550 | Name | no | T/T/T/T | author's own DE describe, 2026-10-08 |
| ExternalDataSource | 0XC | DeveloperName | no | F/F/F/F | author's own DE describe, 2026-10-08 |
| IdeaTheme | 0Bg | Title | no | T/T/T/T | author's own DE describe, 2026-10-08 |
| Individual | 0PK | Name (compound) | yes | T/T/T/T | public sources (research Fact Table) |
| OperatingHours | 0OH | Name | yes | T/T/T/T | author's own DE describe, 2026-10-08 |
| OpportunityHistory | 008 | none | no | F/F/F/F | public sources (research Fact Table) |
| ServiceAppointment | 08p | AppointmentNumber | yes | T/T/T/T | public sources (research Fact Table) |
| ServiceContract | 810 | Name | yes | T/T/T/T | author's own DE describe, 2026-10-08 |
| SocialPost | 0ST | Name | yes | T/T/T/T | public sources (research Fact Table) |
| UserLicense | 100 | Name (+ MasterLabel) | no | F/F/F/F | author's own DE describe, 2026-10-08 |

All 14 confirmed; nothing UNVERIFIED.

## Known divergence (accepted)

System fields are added uniformly by `systemFields()`, so some objects show fields the real object lacks: BusinessHours, BusinessProcess, CallCenter and UserLicense show an `IsDeleted`; UserLicense also shows `CreatedById` and `LastModifiedById`; OpportunityHistory also shows `LastModifiedDate` and `LastModifiedById`.

## Deviations from Plan

None. Plan executed as written.

## Verification

- `pnpm vitest run packages/metadata packages/cli`: 30 passed. `packages/schema/src/prefixes.test.ts`: 31 passed, 1 skipped (Postgres-only concurrency test, pre-existing).
- `migrate.test.ts` and `engine.test.ts` green with the 14 new tables.
- `pnpm build`, `pnpm lint` clean; full `pnpm test` on pglite: 15 files, 166 passed, 2 skipped (both Postgres-only, pre-existing).

## Known Stubs

None.

## Self-Check: PASSED

14 JSON files present (35 in directory); commits 3e9453e and ca2bd1f exist.
