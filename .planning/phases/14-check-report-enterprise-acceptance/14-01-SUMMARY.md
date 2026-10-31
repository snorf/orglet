---
phase: 14-check-report-enterprise-acceptance
plan: 01
subsystem: cli
tags: [check, report, diagnostics, root-cause]
requires:
  - phase: 08
    provides: structured Diagnostic / FormulaFailure / InfoDiagnostic records
provides:
  - buildCheckReport, summariseCheckReport, formatCensus, formatVerdict, formatAreas, formatGroups (packages/cli/src/report.ts)
  - field-type diagnostic carries `object`
affects: [14-04 main.ts wiring]
tech-stack:
  added: []
  patterns: [pure report module, code-point comparator instead of localeCompare]
key-files:
  created: [packages/cli/src/report.ts, packages/cli/src/report.test.ts]
  modified: [packages/metadata/src/sfdx.ts, packages/metadata/src/sfdx.test.ts]
key-decisions:
  - "A cause cycle resolves to the member that sorts first by formatDiagnostic, so a cycle always has exactly one root and every input order agrees"
  - "Area table pads to the longest key per the stated rule; the plan's literal example had two extra spaces of padding and was not followed"
requirements-completed: [CHECK-01, CHECK-02]
duration: 15min
completed: 2026-10-28
---

# Phase 14 Plan 01: check report core Summary

Pure `orglet check` report core: root-cause grouping over structured diagnostics (cause keys, missing field, lookup target object), per-area counts, code-point ordering, summary redaction and exact-string formatters; `main.ts` untouched.

## Commits
- 6450676 feat: field-type diagnostic names its object (message template byte-identical)
- 17f1ecf test: failing report tests (RED)
- e3ffe59 feat: report core (GREEN)

## Task 1 probe (unmodelled lookup target)
Project: `objects/WorkOrder/fields/Foo__c` (Text), `Bar__c.Wo__c` Lookup to WorkOrder (relationshipName Wo), `Bar__c.F__c` formula `Wo__r.Subject`.
- Formula diagnostic `missing` = `{ "object": "Bar__c", "field": "Wo__r" }` (as expected from compile.ts:197).
- Build diagnostics contain BOTH `standard-object WorkOrder` (kind object, no field) and `reference-target WorkOrder` (no field).
Rules therefore implemented as specified.

## Root rules implemented and proven by named tests
1. `cause` key lookup, recursive to the top root (roll-up chain test)
2. `missing` field as a skipped field/roll-up, including `__r`->`__c` and `Id` suffix (ExternalLookup, cycle, standard-field Id tests)
3. `missing` relationship resolved through schema `referenceTo` (single target) to a skipped object (object test; probe-grounded)
4. `reference-target` object-only diagnostic groups under `standard-object`/`object-kind` of the same object

## Deviations from Plan
- Task 1 and Task 2 RED ordering: the sfdx test expectation was updated and the one-line source change made before running the RED step for Task 1 (tests were not run failing first). Task 2 had a real RED commit. Task 3 formatter tests were written together with Task 2's test file and implementation in one GREEN commit (not separate RED/GREEN).
- [Rule 1 - plan inconsistency] The `formatAreas` example in the plan shows widths that contradict its own rule (padEnd to longest key, count padStart, two-space gap). The rule was implemented; test expectations use the rule's output (`  info:standard-object-unmodelled  39`).

## Verification (actually run, Node 22)
- `pnpm vitest run packages/cli/src packages/metadata/src`: 8 files, 189 tests passed (includes another executor's enterprise.test.ts and main.test.ts)
- `pnpm lint`: clean; `pnpm build` (tsc -b): clean
- `git diff -- packages/cli/src/main.ts`: empty
- Not run: Postgres-backed suites, conformance suites (not touched by this plan)

## Known Stubs
None.

## Self-Check: PASSED
