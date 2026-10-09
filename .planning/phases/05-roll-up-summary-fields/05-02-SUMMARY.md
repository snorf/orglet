---
phase: 05-roll-up-summary-fields
plan: 02
subsystem: metadata
tags: [salesforce, rollup, metadata, typescript, vitest]

requires:
  - phase: 05-roll-up-summary-fields (plan 01)
    provides: RollupDef contracts, SourceField.summary* parsing, tokenizeFilterValue / splitRollupRef
provides:
  - resolveRollups in packages/metadata/src/rollup.ts (references, D-05 whitelist, D-08 hard failure, type resolution, filter table, fixpoint for chains, cycle guard)
  - buildOrgSchema resolves Summary fields into stored, read-only FieldDefs carrying `rollup` (ROLL-01)
  - UNSUPPORTED:rollup-target / rollup-type / rollup-filter / rollup-cycle warning areas (D-06, D-07)
  - DE-shaped in-repo proxy test (MAX over CreatedDate, picklist equals filter, master-detail) with zero warnings
affects: [05-03 engine recompute, 05-04 schema DDL and migrate backfill, 05-05 describe, 05-07 DE check]

tech-stack:
  added: []
  patterns:
    - "Resolution pass runs after both merge loops and before the dangling-reference pass; resolved roll-ups are pushed onto SObjectDef.fields so later roll-ups can summarise them"
    - "Every drop warning is `UNSUPPORTED:<area> <Parent>.<Field>: <detail>; field skipped`; the resolver returns an Outcome union and build.ts owns the FieldDef factory"
    - "Filter validation classifies fields into type families (number, date, datetime, boolean, text); formulas and roll-ups have no family and are rejected"

key-files:
  created: []
  modified:
    - packages/metadata/src/rollup.ts
    - packages/metadata/src/build.ts
    - packages/metadata/src/build.test.ts

key-decisions:
  - "Filter table implemented fully in Task 1 (plan allowed it), so Task 2 is a test-only commit that locks the table down"
  - "A filter on a resolved or pending roll-up field on the child is rollup-filter, never rollup-target; every valueField problem (unknown, other object, family mismatch) is rollup-filter while an unknown filter `field` stays rollup-target"
  - "Tests and implementation committed together per task because the execution environment forbids committing on red; RED was still run and observed (11 failures) before implementing"

patterns-established:
  - "resolveRollups(objects, pending, warnings, makeField): metadata package keeps the resolver pure over SObjectDef maps; build.ts injects the FieldDef factory"

requirements-completed: [ROLL-01, ROLL-02]  # plan frontmatter also lists ROLL-03, ROLL-06, ROLL-09: load halves only, marked by 05-03+/05-07 when computed and DE-checked

duration: 8 min
completed: 2026-10-09
---

# Phase 5 Plan 02: Roll-up resolution in buildOrgSchema Summary

**Summary fields now resolve into typed, read-only stored FieldDefs (COUNT -> Number(18,0); SUM/MIN/MAX -> the child type with precision raised to 18; MIN/MAX also Date/DateTime incl. CreatedDate), with the D-05 lookup whitelist, the D-08 hard failure for plain lookups, a full filter validation table, and a fixpoint loop for roll-ups over roll-ups.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-10-09T07:18:43Z
- **Completed:** 2026-10-09T07:26:30Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- `resolveRollups` replaces 05-01's interim `skipSummaries`: no Summary field produces `UNSUPPORTED:field-type` any more (`grep "roll-up summary fields are not resolved yet" packages/*/src` is empty).
- Check order per pending roll-up: references (rollup-target) -> relationship rule (throw) -> operation / summarized type (rollup-type) -> filters (rollup-filter) -> chain wait; a stalled round emits rollup-cycle for the rest.
- Roll-ups on standard objects resolve over `Opportunity.AccountId`, `OpportunityLineItem.OpportunityId`, `CampaignMember.CampaignId`; a whitelisted child missing from the baseline degrades to rollup-target instead of failing.
- DE-shaped proxy (`Backup__c.Last_Run__c`, MAX over `Backup_Run__c.CreatedDate`, one picklist `equals` filter, master-detail) loads with `warnings: []`; acme still loads with zero warnings; `orglet check` on acme still prints no warning.
- 17 in-memory tests added to `build.test.ts` (11 resolution, 6 filter), 54 metadata tests green, full suite 278 passed / 2 skipped (pre-existing).

## Task Commits

1. **Task 1: resolveRollups wired into buildOrgSchema** - `610fb48` (feat)
2. **Task 2: filter validation table tests and DE-shaped proxy** - `ae15fdd` (test)

_TDD note: RED was run and observed (11 failing tests) before Task 1's implementation; test and implementation were committed together because the environment requires green lint + tests for every commit._

## Files Created/Modified
- `packages/metadata/src/rollup.ts` - `resolveRollups`, `PendingRollup`, `RollupColumn`, `LOOKUP_WHITELIST`, `tryResolve`, `resolveFilter`, `familyOf`, DATE/DATETIME/DATE_LITERAL regexes (05-01 helpers kept)
- `packages/metadata/src/build.ts` - `pending` collection in both merge loops, `rollupField` factory, `resolveRollups(objects, pending, warnings, rollupField)` before the dangling-reference pass; `skipSummaries` removed
- `packages/metadata/src/build.test.ts` - `describe("roll-up summary resolution")` and `describe("roll-up summary filters")` with in-memory project helpers (`sourceField`, `sourceObject`, `picklist`, `filter`, `summary`, `childFields`, `parentChild`)

## Warning strings introduced

All drop warnings have the shape `UNSUPPORTED:<area> <Parent>.<Field>: <detail>; field skipped`.

**rollup-target** (D-07; a reference does not resolve):
- `summaryForeignKey <value|(missing)> is not a Child.Field reference`
- `child object <Child> is not defined`
- `<Child>.<Fk> is not defined`
- `<Child>.<Fk> does not point at <Parent>`
- `summarized field <ref> is not a field of <Child>`
- `summarized field <ref> is not defined`
- `summarizedField is missing` (SUM/MIN/MAX without one)
- `filter field <ref> is not a field of <Child>`
- `filter field <ref> is not defined`

**rollup-type** (D-06 extension; operation or summarized type):
- `summaryOperation <op|(missing)> is not supported`
- `<Child>.<Field> is a formula field`
- `<OP> over <Child>.<Field> (<Type>) is not supported`

**rollup-filter** (D-06; the whole field is dropped, never the filter alone):
- `filter field <ref> is a roll-up summary`
- `filter operation <op> is not supported`
- `filter field <Child>.<F> (<Type>) cannot be used in a roll-up filter`
- `filter <Child>.<F> <op> is not supported on <Type>`
- `filter <Child>.<F> <op> needs exactly one value`
- `filter <Child>.<F> <op> needs a value`
- `filter <Child>.<F> has both a value and a valueField`
- `filter <Child>.<F> <op> is not supported with a valueField`
- `valueField <ref> is not a field of <Child>`
- `valueField <ref> is not defined`
- `valueField <ref> is not comparable with <Child>.<F>`
- `filter value <token> is not a valid <Type>`
- `filter value <token> is a date literal, which roll-up filters do not support yet`

**rollup-cycle** (defensive):
- `UNSUPPORTED:rollup-cycle <Parent>.<Field>: roll-up summaries summarise each other in a cycle; field skipped`

**Hard failure** (D-08, `Error` thrown from `buildOrgSchema`):
- `<Parent>.<Field>: a roll-up summary needs a master-detail relationship, but <Child>.<Fk> is a lookup (only Opportunity.AccountId, OpportunityLineItem.OpportunityId and CampaignMember.CampaignId are allowed without master-detail)`

## Decisions Made
- Filter table implemented in Task 1 (the plan explicitly allowed implementing it there); Task 2 became a test-only commit that locks the table down.
- A filter on a child field that is itself a roll-up (resolved or still pending) is `rollup-filter`; every `valueField` problem is `rollup-filter`; an unknown filter `field` is `rollup-target` (matches the plan's split between "reference does not resolve" and "shape not supported").
- Range operators are rejected on Checkbox as well as text (`is not supported on Checkbox`), since a boolean range has no meaning.
- Checkbox `equals`/`notEqual` with zero tokens (blank) is rejected with `needs exactly one value`: Checkbox is never null in orglet.

## Deviations from Plan

None - plan executed exactly as written. The `filter` test helper was briefly removed before the Task 1 commit (unused until Task 2, `no-unused-vars`) and re-added in Task 2.

## Issues Encountered

None. `pnpm lint`, `pnpm build` and the full `pnpm vitest run` were green before each commit.

## Known Stubs

None. Resolved roll-up columns are declared but not yet computed; the engine recompute (05-03), DDL/migrate backfill (05-04) and describe (05-05) are separate plans by design.

## Next Phase Readiness

Ready for 05-03 (engine recompute). Everything downstream reads `FieldDef.rollup` (`childObject`, `foreignKey`, `summarizedField`, `operation`, `filters[].{field, operation, values, valueField}`), all in canonical API-name casing. ROLL-03 and ROLL-06 are delivered on the load side only; ROLL-09 is covered by the in-repo proxy, the real DE retrieve is Johan's local check in 05-07.

## Self-Check: PASSED

Files present: rollup.ts, build.ts, build.test.ts, 05-02-SUMMARY.md. Commits present: 610fb48, ae15fdd.
