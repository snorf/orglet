---
phase: 05-roll-up-summary-fields
plan: 04
subsystem: api
tags: [salesforce, rollup, fixture, describe, bulk, vitest]

requires:
  - phase: 05-roll-up-summary-fields (plans 02, 03)
    provides: resolved read-only roll-up FieldDefs; stored columns via migrate
provides:
  - examples/acme two-level roll-up chain (Account <- Project__c <- Milestone__c) with six Summary fields
  - Project__c.Milestone_Limit validation rule over a roll-up (parent-rule fixture for 05-05/05-06)
  - describe reports roll-ups as calculated: true (createable/updateable false, calculatedFormula null)
  - REST and Bulk write rejection of roll-up values proven (INVALID_FIELD_FOR_INSERT_UPDATE)
affects: [05-05 engine recompute, 05-06 SOQL/REST surface, 05-07 DE check]

tech-stack:
  added: []
  patterns:
    - "Fixture extended in examples/acme after a blast-radius grep; no pre-existing test edited"

key-files:
  created:
    - examples/acme/force-app/main/default/objects/Project__c/fields/Milestone_Count__c.field-meta.xml
    - examples/acme/force-app/main/default/objects/Project__c/fields/Open_Milestones__c.field-meta.xml
    - examples/acme/force-app/main/default/objects/Project__c/fields/Next_Due_Date__c.field-meta.xml
    - examples/acme/force-app/main/default/objects/Project__c/validationRules/Milestone_Limit.validationRule-meta.xml
    - examples/acme/force-app/main/default/objects/Account/fields/Total_Budget__c.field-meta.xml
    - examples/acme/force-app/main/default/objects/Account/fields/Open_Project_Milestones__c.field-meta.xml
    - examples/acme/force-app/main/default/objects/Account/fields/Last_Active_Project_Created__c.field-meta.xml
  modified:
    - examples/acme/force-app/main/default/objects/Milestone__c/fields/Project__c.field-meta.xml
    - packages/metadata/src/build.test.ts
    - packages/api/src/describe.ts
    - packages/api/src/api.test.ts
    - packages/api/src/bulk.test.ts

key-decisions:
  - "Fixture lives in examples/acme (blast-radius gate passed); no examples/acme-rollups needed"
  - "No route code for read-only enforcement: coerceRecord already rejects non-createable/non-updateable fields for REST and Bulk"
  - "ROLL-07 marked complete; ROLL-08 (SOQL surface, 05-06) and ROLL-09 (local DE retrieve, 05-07) withheld"

patterns-established:
  - "Describe: calculated = formula or roll-up; calculatedFormula stays null for roll-ups"

requirements-completed: [ROLL-07]  # plan frontmatter also lists ROLL-08, ROLL-09: withheld, see Requirements

duration: 8 min
completed: 2026-10-09
---

# Phase 5 Plan 04: acme roll-up fixture and read-only describe surface Summary

**acme now carries a realistic Account <- Project__c <- Milestone__c roll-up chain (COUNT, filtered COUNT, MIN Date, filtered SUM Currency, SUM over a roll-up, DE-shaped MAX over CreatedDate) plus a parent rule over a roll-up; describe flags roll-ups as calculated and REST/Bulk reject client values.**

## Accomplishments
- Six Summary fields and `Milestone_Limit` (`AND(NOT(ISBLANK(Milestone_Count__c)), Milestone_Count__c > 5)`) added; `Milestone__c.Project__c` is now `reparentableMasterDetail: true`. acme still loads with zero warnings and `orglet check --project examples/acme` prints no `warning:` line.
- `describe.ts`: `calculated: f.formula !== undefined || f.rollup !== undefined`.
- Tests: acme roll-up resolution (build.test.ts), describe flags and REST create/update rejection (api.test.ts), Bulk ingest failedResults (bulk.test.ts). Full suite 300 passed / 2 skipped (pre-existing); lint and build green.

## Blast-radius gate

Files referencing `examples/acme`: packages/cli/src/main.test.ts, packages/schema/src/migrate.test.ts, prefixes.test.ts, packages/soql/src/compile.test.ts, packages/formula/src/formula.test.ts, packages/api/src/bulk.test.ts, api.test.ts, packages/engine/src/engine.test.ts, query.test.ts, packages/metadata/src/build.test.ts, conformance/jsforce/seed.mjs.

The assertion grep (`toEqual([`, `toHaveLength`, `warnings).toEqual`, `reparentable`, ...) found only: `warnings` toEqual `[]` (still true), `CREATE TABLE` count by `schema.objects.size` / 14 thin objects (object count unchanged), `changing` DDL filter on a second run (unaffected), `account.validationRules` toEqual (Account rules unchanged; the new rule is on Project__c), and describe/field-contract checks over keys, not field lists. No assertion needed editing, so the gate passed and acme was extended in place.

## Task Commits

1. **Task 1: acme roll-up fixtures, rule and build assertion** - `33822e6` (feat)
2. **Task 2: describe calculated flag and REST/Bulk rejection tests** - `1941d5a` (feat)

_TDD note: tests and implementation committed together per task because every commit must be green (same as 05-01..05-03); no RED commit._

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

None. The roll-up columns are NULL until the engine recompute (05-05); the `ISBLANK` guard in `Milestone_Limit` keeps the rule inert meanwhile, as planned.

## Requirements

- **ROLL-07** marked complete: describe flags and REST/Bulk rejection proven by tests.
- **ROLL-08** withheld: storage is in place, SOQL select/filter/sort of roll-ups is exercised in 05-06.
- **ROLL-09** withheld: acme's DE-shaped field loads clean (proxy), the real DE retrieve check is Johan's local step in 05-07.

## Next Phase Readiness

05-05 can use `Account.Total_Budget__c`, `Open_Project_Milestones__c`, `Last_Active_Project_Created__c`, `Project__c.Milestone_Count__c`, `Open_Milestones__c`, `Next_Due_Date__c`, the `Milestone_Limit` rule and a legal reparent of Milestone__c between Projects.

## Self-Check: PASSED

Files present (7 fixtures, edits), commits present: 33822e6, 1941d5a.
