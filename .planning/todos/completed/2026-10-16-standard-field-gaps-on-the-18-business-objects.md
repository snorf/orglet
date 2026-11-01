---
created: 2026-10-16T00:00:00.000Z
title: Standard-field gaps on the 18 business objects seen in a large real-org retrieve
area: metadata
files:
  - scripts/gen-baseline/overrides.json
  - scripts/gen-baseline/source/sf-skills
  - packages/metadata/standard/objects
---

## Problem

`orglet check` on a large real-org retrieve (Phase 10, 2026-10-15) reports `UNSUPPORTED:standard-field`
for standard fields on the Phase 10 objects that neither pinned source documents, so the generator
never emits them. Seen: Order.AccountNumber, Order.ContractName, Order.ContractEndDate,
OrderItem.ProductCode, OrderItem.QuantityUnitOfMeasureId, QuoteLineItem.ProductCode,
QuoteLineItem.QuantityUnitOfMeasureId, CaseMilestone.MilestoneId, CaseMilestone.SlaProcessId,
ContentDocument.ParentId, ContentDocument.ContentAssetId, ContentDocument.DeletedById,
ContentDocument.DeletedDate, ContractLineItem.StatusIndicator, EmailMessage.MessageSize,
Location.LogoId, OpportunitySplit.SplitTypeId (Location.Location is the deliberate geolocation
omission). Related, on v1.0 objects: Opportunity.SyncedQuoteId (sf-skills SDK list only, skipped as
"(none stated)"; a validation rule traversing `SyncedQuote.Status` fails on it) and
OpportunityLineItem.QuoteLineItemId (in neither source).

## Solution

Per field: find a public source (Object Reference section text, SDK describe-derived list with the
D-21 evidence rule, or the author's own DE describe recorded as `de-describe` with a ref) and add a
reasoned `overrides.json` entry; Opportunity.SyncedQuoteId -> `referenceTo: [Quote]`,
relationshipName `SyncedQuote`, same additive pattern as the D-19 lookups. Fields with no public
source stay `UNSUPPORTED:standard-field`.

## Resolution

Closed 2026-10-29 in Phase 14 plan 03 (commit db57aed plus the closing commit of this plan).

- Added to the baseline: 1 field, Opportunity.SyncedQuoteId as a lookup to Quote (relationshipName SyncedQuote), same additive pattern as the D-19 lookups.
- Accepted exclusions, counted per reason in conformance/README.md: 8 reference target outside the baseline, 1 field type not modelled (geolocation compound), 10 with no public source and absent from the author's own Developer Edition describe (`de-describe`, 2026-10-29).
- No public Object Reference section text added any further field.
