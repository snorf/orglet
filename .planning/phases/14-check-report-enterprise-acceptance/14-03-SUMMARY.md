---
phase: 14-check-report-enterprise-acceptance
plan: 03
subsystem: metadata
tags: [baseline, standard-fields, overrides, acceptance, class-C]
requires: []
provides:
  - "Opportunity.SyncedQuoteId modelled as lookup to Quote (relationship SyncedQuote)"
  - "Accepted standard-field exclusions recorded as counts in conformance/README.md"
affects: [14-04, 14-07]
key-files:
  created: []
  modified:
    - scripts/gen-baseline/overrides.json
    - packages/metadata/standard/objects/Opportunity.json
    - packages/metadata/standard/PROVENANCE.json
    - packages/metadata/src/build.test.ts
    - packages/cli/src/main.test.ts
    - conformance/README.md
key-decisions:
  - "All ten class-C fields stay exclusions: no public source and absent from the author's own DE describe (de-describe, 2026-10-29)"
requirements-completed: []
duration: n/a (split across a checkpoint)
completed: 2026-10-29
---

# Phase 14 Plan 03: Standard-field gaps Summary

Opportunity.SyncedQuoteId is now a baseline lookup to Quote, so validation rules traversing SyncedQuote.Status compile without warning; the 19 other gap fields are accepted exclusions counted per reason in conformance/README.md.

## Tasks

1. SyncedQuoteId override, regenerated baseline, build.test.ts and main.test.ts tests: db57aed
2. Checkpoint (human-action): the author ran describe against his own Developer Edition (sanity check: status 0, 53 Order fields). Result "absent" for all ten class-C fields. Recorded as `de-describe`, 2026-10-29.
3. No baseline change (nothing to add, so no regeneration), README exclusion section, todo closed with Resolution: 6096179

## Classification

| Class | Fields | Count |
|---|---|---|
| A: modelled (locked decision) | Opportunity.SyncedQuoteId | 1 |
| Exclusion: reference target outside baseline | ContentDocument.ParentId, OrderItem.QuantityUnitOfMeasureId, QuoteLineItem.QuantityUnitOfMeasureId, ContentDocument.ContentAssetId, Location.LogoId, OpportunitySplit.SplitTypeId, CaseMilestone.MilestoneId, CaseMilestone.SlaProcessId | 8 |
| Exclusion: field type not modelled | Location.Location (geolocation compound) | 1 |
| class-C: no public source, absent from DE describe | Order.AccountNumber, Order.ContractName, Order.ContractEndDate, OrderItem.ProductCode, QuoteLineItem.ProductCode, ContentDocument.DeletedById, ContentDocument.DeletedDate, ContractLineItem.StatusIndicator, EmailMessage.MessageSize, OpportunityLineItem.QuoteLineItemId | 10 |

README counts: 8 / 1 / 10 (re-verified against PROVENANCE.json skipped lists and overrides.json; matches). CaseMilestone.MilestoneId/SlaProcessId were not DE-checked, since their targets are not modelled.

## Deviations from Plan

None. The plan's Task 3 branch "no new fields" applied, so no regeneration was needed. Online Object Reference lookups for class-C fields are the Task 1 executor's work and found nothing.

## Verification run

- `pnpm baseline:check` clean
- `pnpm lint` clean
- `pnpm build` clean
- `pnpm vitest run packages/metadata packages/cli/src/main.test.ts`: 12 files, 255 tests passed (pglite)

Not run: the Postgres 16 run of `pnpm vitest run packages/metadata` (ORGLET_DATABASE_URL), `pnpm typecheck:scripts`, and the full `pnpm test` (gated in 14-04 Task 2 and 14-07 Task 1).

## Notes

ACC2-03 is not marked complete: this plan only removes the known standard-field blocker. The requirement closes in 14-07 when the author's real-retrieve acceptance run is done.

## Known Stubs

None.

## Self-Check: PASSED
db57aed and 6096179 exist; todo exists only under .planning/todos/completed/.
