---
phase: 10-business-standard-objects
plan: 05
subsystem: engine, api, conformance
tags: [base2-06, base2-07, tests, describe-check, baseline-fix]
requires: ["10-04"]
provides:
  - "vitest proof of flag enforcement, required fields, lookup error codes and exact-case prefix routing for the 18 business objects"
  - "REST proof: 400 envelope for the forbidden operations, describe of all 18, SELECT FROM Order"
  - "conformance/describe-check/objects.txt lists 32 objects, asserted equal to THIN union BUSINESS"
affects: [10-06]
key-files:
  modified:
    - packages/engine/src/engine.test.ts
    - packages/engine/src/query.test.ts
    - packages/api/src/api.test.ts
    - conformance/describe-check/objects.txt
    - conformance/describe-check/README.md
    - scripts/gen-baseline/overrides.json
    - packages/metadata/standard/objects/OrderItem.json
    - packages/metadata/standard/PROVENANCE.json
key-decisions:
  - "OrderItem.QuoteLineItemId and RelatedOrderItemId are nillable (override); the sf-skills required flag contradicts its own descriptions"
requirements-completed: []
duration: ~25min
completed: 2026-10-14
---

# Phase 10 Plan 05: Behaviour of the 18 through engine, SOQL and REST Summary

The 18 business objects are now proven through the engine, SOQL and REST: every flag is enforced with the exact `INVALID_TYPE_FOR_OPERATION` refusal, documented-required fields fail with `REQUIRED_FIELD_MISSING`, lookups to them return `MALFORMED_ID` / `INVALID_CROSS_REFERENCE_KEY`, and the three key-prefix case twins route by exact case. No production code changed. BASE2-06 and BASE2-07 are deliberately NOT ticked (plan 10-06 does that).

## Commits

| Task | Commit | What |
|---|---|---|
| 1 | febc4a7 | engine.test.ts and query.test.ts additions, plus the OrderItem baseline fix (see Deviations) |
| 1 (lint) | 0f6d37d | `schema.list()` is not on the `OrgSchema` interface; test uses `[...schema.objects.values()]` |
| 2 | 903fd58 | api.test.ts BUSINESS table and tests, objects.txt 14 to 32, describe-check README |

## What the tests pin

- `BUSINESS_FLAGS` loop over all 18 and all four operations (insert, update, delete, undelete): forbidden gives the exact refusal object, allowed never contains `INVALID_TYPE_FOR_OPERATION`.
- The five documented refusals (OrderItem undelete, CaseMilestone insert and delete, ContentDocument insert, ContentVersion delete) asserted individually in the engine; the last four also over REST (400, Salesforce envelope). OrderItem undelete has no REST resource.
- `Order` without fields fails `REQUIRED_FIELD_MISSING` naming `EffectiveDate`; `OrderItem` naming `OrderId`. A valid Order inserts with an `801` Id and a non-empty `OrderNumber` (engine and REST 201).
- D-20 table over Case.FeedItemId, Asset.LocationId, Order.QuoteId, OrderItem.OrderId: `"abc"` gives `MALFORMED_ID`; unknown Id of the target type and an Account Id give `INVALID_CROSS_REFERENCE_KEY`, each with `fields: [field]`. A real FeedItem is accepted on Case.FeedItemId. No behaviour change was needed, so D-20 held as planned.
- `matchTargetByPrefix`: 01M AccountTeamMember / 01m BusinessHours, 00q OpportunityTeamMember / 00Q Lead, 00K OpportunityContactRole / 00k OpportunityLineItem.
- `SELECT Id, OrderNumber FROM Order ORDER BY OrderNumber` runs (empty and with a row, `attributes.type` "Order"); REST `SELECT Id, OrderNumber FROM Order` gives 200, `done: true`.
- REST describe (global and per object) of all 18 carries the contract key sets, system fields, owner presence, one or no name field and the flags.
- `objects.txt` has 32 non-comment lines and the api test asserts it equals THIN union BUSINESS.

## Deviations from Plan

**1. [Rule 1 - Bug in 10-04 data] OrderItem could not be inserted.** The D-20 test for OrderItem.OrderId got `REQUIRED_FIELD_MISSING` on `QuoteLineItemId` and `RelatedOrderItemId` instead of the lookup error. Root cause: sf-skills marks both fields `required: true`, and the generator (D-18) turns that into `nillable: false` for objects without v1 pins. But the sources' own descriptions say otherwise ("If this field is specified, ..." and "Required for change orders ... Order Management or Revenue Cloud"), so a plain order product (Quantity plus OrderId) was refused. Fix: `nillable: true` added to the `set` of both fields in `scripts/gen-baseline/overrides.json` with the reason, `pnpm baseline:gen` re-run; the diff is exactly the two removed `"nillable": false` lines in `OrderItem.json` and one `verified` count (225 to 223) in PROVENANCE.json. `pnpm baseline:check` passes. This is baseline data, not a production code path; no test was weakened. Other required fields of the 18 were reviewed and look genuine (Quote OpportunityId, QuoteLineItem Quantity/UnitPrice/Product2Id/PricebookEntryId/QuoteId, EmailMessage Status, ContentVersion Title, FeedItem ParentId, Address ParentId and so on); I did not verify each against a real org, which is not allowed.

**2. [Rule 1 - own test] Lint error in the first commit.** Task 1 was committed before lint ran clean (`schema.list()` is a runtime method not on the `OrgSchema` interface). Fixed in 0f6d37d. Commit febc4a7 therefore does not lint clean on its own.

contract.json, jsforce.mjs and sf_describe.py were not touched: D-02 did not fire, all 18 prefixes are real.

## Verification actually run

Node 22 via nvm. Backend stated per command.
- `pnpm vitest run packages/engine/src/engine.test.ts packages/engine/src/query.test.ts` (pglite): green after the fix.
- `pnpm vitest run packages/api` (pglite): 7 files, 124 passed, 1 skipped.
- `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:scripts`, `pnpm baseline:check`: clean.
- Full `pnpm test` on pglite: first run 1 failed + 1 error out of 632 (629 expected); I did not capture which test and could not reproduce it: two further full runs were green (629 passed, 3 skipped). Treat as one unexplained flake on pglite, not diagnosed.
- Full suite on real Postgres 16 (the already running `orglet-postgres` container, `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet`, vitest picks maxWorkers 3): 38 files, 631 passed, 1 skipped, 0 failed.
- Not run: the SDK describe-check legs (jsforce / simple-salesforce) against a running server; that is plan 10-06.

## Known Stubs

None.

## Self-Check: PASSED

Commits febc4a7, 0f6d37d, 903fd58 exist; objects.txt has 32 entries; this file exists.
