---
phase: 14-check-report-enterprise-acceptance
plan: 10
subsystem: cli
tags: [check-report, root-cause, standard-field]
requires: []
provides:
  - implied standard-field root cause in the check report (rule 5)
affects: [packages/cli/src/report.ts]
tech-stack:
  added: []
  patterns: [inferred root cause not backed by a warning line]
key-files:
  created: []
  modified: [packages/cli/src/report.ts, packages/cli/src/report.test.ts]
key-decisions:
  - "Implied root spelled by the code-point-smallest casing seen, so the report stays input-order independent"
requirements-completed: [ACC2-03, CHECK-01]
duration: 15min
completed: 2026-10-30
---

# Phase 14 Plan 10: Implied standard-field root Summary

A formula that names a standard field outside the baseline (no field file in the retrieve, so no warning to group under) is now grouped under an implied `standard-field` root in the check report.

## Rule (5) as implemented

In `groupByRoot`, after rules (2) and (3): a diagnostic with `missing` whose object is a modelled non-custom object, whose field matches `/^[A-Za-z][A-Za-z0-9_]*$/` without `__`, and for which no `fieldCandidates` entry resolves via `getField`, gets a memoised implied root per object.field. `RootCauseGroup.implied?: true` marks it (additive JSON key). `formatGroups` prints:

`  UNSUPPORTED:standard-field OpportunityLineItem.QuoteLineItemId is not in the baseline; referenced by formulas, no field file in the retrieve  [implied, 2 dependents]`

No `warning:` line, `--summary`, `version` or `main.ts` change. Real-pipeline warning line unchanged: `UNSUPPORTED:formula formula field OpportunityLineItem.Quote_Line__c skipped: Field QuoteLineItemId does not exist. Check spelling.`

## Verification

- `report.test.ts`: 24 tests pass (19 before, 5 new incl. real-project test, plus the summary-names loop extended and the new fixture feeding the invariant/order tests).
- `pnpm lint` clean. `git diff -- packages/cli/src/__snapshots__` empty (acme snapshots byte-identical).
- `pnpm vitest run packages/cli/src`: report and main pass; one failure in `enterprise.test.ts` (FieldDefinition bare-name test) belongs to plan 14-08, whose uncommitted work was in the shared tree at the time. Not caused by this plan.
- `pnpm build`/`typecheck` not run separately (parallel tree, other agents mid-edit).

## Deviations from Plan

None in behaviour. A debug `console.log` was committed briefly and removed in a follow-up commit.

## Commits

- 746e6fd feat: rule (5), implied flag, marker, unit tests
- e89b8d4 test: real-pipeline test
- 41c7244 test: drop debug output

## Self-Check: PASSED
