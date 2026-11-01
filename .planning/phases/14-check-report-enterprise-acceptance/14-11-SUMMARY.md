---
phase: 14-check-report-enterprise-acceptance
plan: 11
subsystem: baseline-generator
tags: [baseline, standard-field, gap-closure, conformance]
requires: [14-09]
provides:
  - 5 standard fields added to the baseline from public sources (round 2)
  - per-round accepted standard-field exclusion counts in conformance/README.md
affects: [packages/metadata/standard, scripts/gen-baseline, conformance/README.md]
key-files:
  modified:
    - scripts/gen-baseline/overrides.json
    - packages/metadata/standard/PROVENANCE.json
    - packages/metadata/standard/objects/Event.json
    - packages/metadata/standard/objects/Opportunity.json
    - packages/metadata/standard/objects/OpportunityLineItem.json
    - packages/metadata/standard/objects/ServiceContract.json
    - packages/metadata/src/build.test.ts
    - conformance/README.md
key-decisions:
  - "Fields in neither pinned source are modelled from the author's own Developer Edition describe (recorded as de-describe, 2026-10-31) when it states them"
  - "Lookups whose target is outside objects.json stay accepted exclusions (rule 2 honesty)"
requirements-completed: []
duration: 20min
completed: 2026-10-31
---

# Phase 14 Plan 11: standard-field round 2 Summary

5 of the 19 new standard fields from the large retrieve are now in the baseline (3 via DE describe, 2 via the name rule); the other 14 are counted per reason as accepted exclusions in conformance/README.md. ACC2-03 is deliberately not marked complete (14-12 owns it).

## Commits

- Task 1: checkpoint (human-action), answered by the author; no commit.
- Task 2: 9680ede, overrides, regenerated baseline, build.test.ts
- Task 3: 99eb6de, README per-round counts

## Classification of the 19 new fields

Classes: A = pinned source, name rule; B = pinned source, target/type outside baseline; C = in neither pinned source.

| Field | Class | Source | Outcome |
|---|---|---|---|
| Asset.CurrentQuantityUnitId | B | sf-skills (none stated), DE absent | exclusion: reference target outside baseline |
| Campaign.BusinessUnitId | C | none; DE absent | exclusion: no public source |
| Campaign.TenantId | B | pinned (PardotTenant) | exclusion: reference target outside baseline |
| Entitlement.SlaProcessId | B | pinned; DE target SlaProcess | exclusion: reference target outside baseline |
| Entitlement.StatusIndicator | C | none; DE absent | exclusion: no public source |
| Event.MeetingUrl | C | de-describe 2026-10-31 (url, 2048, read-only) | added, Url |
| Lead.IqScore | C | none; DE absent | exclusion: no public source |
| Opportunity.LastSyncTime | C | de-describe 2026-10-31 (datetime, read-only) | added, DateTime |
| OpportunityLineItem.LastSyncTime | C | de-describe 2026-10-31 (datetime, read-only) | added, DateTime |
| PricebookEntry.ProductSellingModelId | B | pinned (ProductSellingModel) | exclusion: reference target outside baseline |
| PricebookEntry.StandardPrice | C | none; DE absent | exclusion: no public source |
| Product2.BasedOnId | B | sf-skills (none stated); DE target ProductClassification | exclusion: reference target outside baseline |
| Product2.UnitOfMeasureId | B | pinned (UnitOfMeasure) | exclusion: reference target outside baseline |
| ServiceContract.ParentServiceContractId | A | pinned, name rule | added, Lookup to ServiceContract, relationshipName ParentServiceContract |
| ServiceContract.RootServiceContractId | A | pinned, name rule; Object Reference lists no Create/Update | added, read-only Lookup, relationshipName RootServiceContract |
| ServiceContract.StatusIndicator | C | none; DE absent | exclusion: no public source |
| SocialPost.OutboundSocialAccountId | B | pinned (ExternalSocialAccount) | exclusion: reference target outside baseline |
| SocialPost.PersonaId | B | pinned (SocialPersona) | exclusion: reference target outside baseline |
| User.UserSubtype | C | none; DE absent | exclusion: no public source |

Totals: 5 added, 14 exclusions (8 reference target outside baseline, 6 no public source). 5 + 14 = 19.

DE-describe source note: the describe values are the author's own Developer Edition describe metadata (Level 1), used as the "DE describe" source exactly as in 14-03, recorded as `de-describe` dated 2026-10-31. The online Object Reference was not fetched in this run (no web tool available), so class C fell straight to the DE describe step.

## Round-1 field absent from the large retrieve

OpportunityLineItem.QuoteLineItemId was the one round-1 exclusion not reported as a field-file warning (18 of 19 were). The author confirms a formula in the retrieve references it; 14-10 groups that formula under an implied standard-field root.

## Verification

- `pnpm baseline:check` clean (54 files, includes 14-09 relationshipName guard)
- `pnpm typecheck:scripts`, `pnpm lint` clean
- `pnpm vitest run packages/metadata`: 11 files, 236 tests passed (one new test, "standard-field round 2: every added field is in the default baseline with its stated type")
- `grep -c "standard-field round 2" scripts/gen-baseline/overrides.json` = 5 (entries added)
- README section holds counts only; no names (grep for round-1 names = 0)

README counts (Round 1 / Round 2 / Total): outside baseline 8/8/16; geolocation compound 1/0/1; other type 0/0/0; no public source 10/6/16.

## Deviations from Plan

None. No pipeline.ts change was needed: `keep` + `set` with label and type emitted the new fields directly, so no synthetic generator test was added.

## Known Stubs

None.

## Self-Check: PASSED
