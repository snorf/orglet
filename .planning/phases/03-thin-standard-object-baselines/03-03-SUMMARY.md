---
phase: 03-thin-standard-object-baselines
plan: 03
subsystem: api
tags: [salesforce, describe, jsforce, rest, conformance, readme, vitest]

requires:
  - phase: 03-thin-standard-object-baselines
    provides: 14 thin objects (03-01), INVALID_TYPE_FOR_OPERATION guard and seed rows (03-02)
provides:
  - idEnabled in sObject describe summaries
  - conformance/describe-check/contract.json and objects.txt (shared SDK key sets and object list)
  - T10 thin-object describe contract and T11 REST write-protection tests
  - README "Thin standard objects" section
affects: [03-04 describe-check scripts]

key-files:
  created:
    - conformance/describe-check/contract.json
    - conformance/describe-check/objects.txt
  modified:
    - packages/api/src/describe.ts
    - packages/api/src/api.test.ts
    - README.md

key-decisions:
  - "SDK describe key sets live once in conformance/describe-check/contract.json; vitest reads them, so CI and the manual SDK run check the same contract"
  - "idEnabled was the only jsforce-declared describe key orglet omitted; no field-level key was missing"

requirements-completed: [BASE-03, BASE-04]

duration: 10min
completed: 2026-10-08
---

# Phase 3 Plan 03: Describe contract and REST write protection Summary

**All 14 thin objects now satisfy every key jsforce's describe types declare (closing the one gap, `idEnabled`), REST writes their flags forbid return 400 `INVALID_TYPE_FOR_OPERATION`, and the SDK contract is a shared data file.**

## Accomplishments

- `objectSummary` emits `idEnabled: true`; it was the single pre-existing describe gap.
- Tests (in `api.test.ts`): objects.txt matches the fact table; global describe flags, prefixes and urls; per-object describe key sets, seven system fields once, OwnerId iff owned, exactly one (or no, for OpportunityHistory) name field; child relationships; REST POST/PATCH/upsert/DELETE refusals with the exact error body, and Entitlement POST succeeding.
- No route change was needed: `statusFor` maps the code to 400.
- README section documents objects, DML table, import bypass, seed rows, system-field divergence and the upgrade FK error.

## Commits

- 9fc1154 test(03-03): failing describe contract and write-protection tests (RED: 2 failed on `idEnabled`, 20 passed)
- c1385b5 feat(03-03): emit idEnabled; pin SDK describe contract
- fb89756 docs(03-03): document thin standard objects

## Verification (observed, pglite)

- `pnpm vitest run packages/api/src/api.test.ts`: 22 passed; `packages/api`: 2 files, 35 passed
- `pnpm build`, `pnpm lint` exit 0
- Full `pnpm test`: 16 files, 183 passed, 2 skipped (pre-existing Postgres-only)
- contract.json lengths: fieldKeys 53, globalSObjectKeys 27, sobjectDescribeKeys 11, childRelationshipKeys 8; objects.txt 14 entries

## Deviations from Plan

**1. [Rule 3 - Lint] `expect.objectContaining(...)` returned `any`, tripping `no-unsafe-return`** - added `as unknown` cast in api.test.ts (c1385b5). Semantics unchanged.

## Known Stubs

None.

## Self-Check: PASSED

contract.json, objects.txt present; commits 9fc1154, c1385b5, fb89756 exist.
