---
phase: 05-roll-up-summary-fields
plan: 01
subsystem: metadata
tags: [salesforce, rollup, sfdx, xml, typescript]

requires:
  - phase: 03-thin-standard-object-baselines
    provides: buildOrgSchema baseline merge and UNSUPPORTED warning pattern
provides:
  - RollupDef / RollupFilterDef / RollupOperation contracts and FieldDef.rollup
  - SFDX reader parses Summary fields (SourceField.summary* and SourceFilterItem)
  - tokenizeFilterValue and splitRollupRef helpers (internal to @orglet/metadata)
affects: [05-02 roll-up resolver, 05-03 engine recompute, describe, schema migrate]

tech-stack:
  added: []
  patterns:
    - "SourceField.type widens to FieldType | Summary; FieldType itself is untouched so exhaustive switches stay intact"
    - "Interim skipSummaries in build.ts keeps UNSUPPORTED:field-type until the resolver lands"

key-files:
  created:
    - packages/metadata/src/rollup.ts
    - packages/metadata/src/rollup.test.ts
  modified:
    - packages/metadata/src/types.ts
    - packages/metadata/src/sfdx.ts
    - packages/metadata/src/sfdx.test.ts
    - packages/metadata/src/build.ts
    - packages/metadata/src/index.ts

key-decisions:
  - "No Summary member in FieldType; a resolved roll-up is an ordinary typed FieldDef carrying rollup"
  - "summaryOperation stored raw on SourceField, normalised by the resolver in 05-02"
  - "Blank filter value (empty, absent, whitespace) means [] (match blank)"

patterns-established:
  - "readFilterItems unwraps the always-array value element from xml.ts"

requirements-completed: [ROLL-01, ROLL-03]

duration: 5 min
completed: 2026-10-09
---

# Phase 5 Plan 01: Roll-up metadata contracts and Summary parsing Summary

**Summary fields now parse from SFDX into SourceField with array-safe filter items, plus a quote-aware filter value tokenizer; buildOrgSchema still reports them as UNSUPPORTED:field-type until 05-02.**

## Performance

- **Duration:** 5 min
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- RollupDef contracts and `FieldDef.rollup` defined for later plans.
- `<value>True</value>`, `<value/>` and a missing `<value>` all parse correctly; `<valueField>` is kept.
- `tokenizeFilterValue` / `splitRollupRef` implemented and tested.

## Task Commits

1. **Task 1: contracts, Summary parsing, interim skip** - `45a5c21` (feat)
2. **Task 2: tokenizer and reference splitter** - `6994606` (feat)

## Deviations from Plan

None - plan executed exactly as written. Tests were written together with the implementation in each task commit rather than as separate RED commits.

## Issues Encountered

None. `pnpm build`, `pnpm lint` and the full `pnpm vitest run` (254 passed, 2 skipped, pre-existing) were green before each commit.

## Next Phase Readiness

Ready for 05-02 (resolver in build.ts). ROLL-01 and ROLL-03 are only partly delivered here (parse and value encoding); resolution and computation come in later plans.

## Self-Check: PASSED
