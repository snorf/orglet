---
phase: 14-check-report-enterprise-acceptance
plan: 02
subsystem: examples
tags: [fixture, acceptance, enterprise, check-strict]
requires: []
provides:
  - "examples/enterprise: acme-superset fixture covering every v1.1 category, warning-free under check --strict"
  - "packages/cli/src/enterprise.test.ts: category-coverage guard"
affects: [14-05, 14-06]
key-files:
  created:
    - examples/enterprise/sfdx-project.json
    - examples/enterprise/README.md
    - examples/enterprise/force-app/main/default/**
    - packages/cli/src/enterprise.test.ts
  modified: []
key-decisions:
  - "Reuse via a second packageDirectories entry (../acme/force-app); the copy fallback was not needed"
  - "Feature-gated field is Account.FirstName (first gated Account field in code-point order, Text)"
requirements-completed: [ACC2-01]
duration: 20min
completed: 2026-10-28
---

# Phase 14 Plan 02: Enterprise fixture Summary

examples/enterprise is a public, generic acme superset (second packageDirectories entry `../acme/force-app`) covering every v1.1 category, loading with zero warnings, guarded by an 11-test coverage file.

## Tasks

1. Coverage test (RED), project file, custom settings, two __mdt types with 4 records, labels, Service_Order__c / Service_Order_Line__c with lookups to Quote, Order, Location, OrderItem and the Total_Lines__c roll-up over formula Line_Total__c: 088bc80
2. Formulas for all eight globals, colon syntax, `!`, Owner traversal, feature-gated FirstName, validation rule Discount_Within_Cap, README: be9b60d

## Decisions

- Reuse path taken: second package dir. acme custom objects were not overwritten; check loads 10 custom objects (4 acme + 6 new).
- Feature-gated field: `Account.FirstName` via `Account.Gated_Check__c` = `IF(ISBLANK(FirstName), 'none', FirstName)`.
- Census line printed by check: `63 objects (10 custom), 3737 fields`, plus `custom metadata: 4 records in 2 types` and `2 custom labels`.
- Order.Quote_Name__c (`Quote.Name`) is a formula on a standard object over the standard Order -> Quote lookup.
- Nullable key prefixes are not exercised (no baseline object has a null prefix); stated in the README.

## Deviations from Plan

- Test-code fix only: the plan's helper shapes assumed `schema.get/list`; the OrgSchema interface exposes `getObject` and `objects`, so the test uses those. No production code touched.

## Verification actually run

- `pnpm build` (tsc -b): clean.
- `pnpm lint`: clean.
- `pnpm vitest run packages/cli/src`: 3 files, 51 tests passed (enterprise.test.ts: 11).
- `node packages/cli/dist/index.js check --strict --project examples/enterprise`: exit 0, no `warning:` line.
- `git status --short examples/acme conformance`: empty.
- Not run: full `pnpm test` across all packages, Postgres-backed/conformance suites (plan 14-05/06), `orglet up` against enterprise.

## Known Stubs

None. Org_Defaults__c / Country_Code__c carry no data by design (retrieve format); seeding is plan 14-05.

## Self-Check: PASSED
