---
phase: 14-check-report-enterprise-acceptance
verified: 2026-10-29T14:00:00Z
status: gaps_found
score: 3/4 success criteria verified
gaps:
  - truth: "The author's large real-org retrieve (local only) reports zero warnings for everything it references (success criterion 4 / ACC2-03)"
    status: failed
    reason: "DE retrieve leg holds (check --strict exit 0, 0 warnings). Large retrieve reports 150 warnings: standard-field 37 (vs 19 accepted exclusions), custom-metadata-record 24, formula 28, object-kind 11, reference-target 50."
    artifacts:
      - path: "conformance/README.md"
        issue: "Records the counts honestly; criterion itself unmet"
    missing:
      - "FieldDefinition values given as a bare field API name resolved through the controlling EntityDefinition field (reference-target 50)"
      - "Baseline relationshipName for 13 reference fields that lack one and CampaignMember.AccountId whose relationshipName is a label (formula 1); baseline:check guard"
      - "Standard-field round 2: 19 public-API fields on 12 objects (standard-field 37 minus 18 accepted)"
      - "Report: a formula that references a standard field outside the baseline grouped under the standard-field cause (formula 1)"
      - "Counted exclusion categories documented in conformance/README.md: platform events 11 (backlog 999.8), $Permission 15, managed package not retrieved 1, retrieve incomplete 35 (24 cmdt records without a type definition, 11 formulas on 4 fields absent from the retrieve)"
      - "Re-run on the large retrieve until zero warnings beyond the documented exclusions, then tick ACC2-03"
---

# Phase 14: Check Report & Enterprise Acceptance Verification Report

**Phase Goal:** `orglet check` reads as an actionable report on a large retrieve, and the milestone is proven against a public enterprise-shaped fixture, both SDK suites and the author's real retrieves.
**Status:** gaps_found. Re-verification: No.

## Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | check on acme prints census, verdict, per-area table, grouped cascades, deterministic order, warning: lines unchanged | VERIFIED | `packages/cli/src/report.ts`, snapshots `__snapshots__/check-acme.txt`; `pnpm vitest run packages/cli/src` = 61/61 pass (report 18, enterprise 11, main 32) |
| 2 | --summary redacted, --json, --strict semantics | VERIFIED | `main.ts` flags (lines 6-40, 77-109), `summariseCheckReport`, summary snapshot, tests pass |
| 3 | examples/enterprise passes check --strict in CI; run-all.sh green, every exclusion classified | VERIFIED | Fixture exists; CI step at `.github/workflows` line 28 and matrix over acme/enterprise; enterprise.test.ts passes; 14-07 records run-all enterprise exit 0, 11 legs, at 05ddbe9 (not re-run, per instruction). The one added jsforce exclusion (asterisk select) is classified UNSUPPORTED:soql-formula, backlog 999.12, documented in conformance/jsforce/README.md: satisfies "every exclusion still classified". |
| 4 | DE retrieve exit 0; large retrieve zero warnings, counts per area in conformance/README.md | FAILED (partial) | DE: exit 0, 0 warnings (recorded). Large: 150 warnings; counts recorded per area, no names. |

**Score:** 3/4

## Requirements Coverage

| ID | Status | Evidence |
|----|--------|----------|
| CHECK-01 | SATISFIED | report core + snapshot tests; ticked in REQUIREMENTS.md |
| CHECK-02 | SATISFIED | --summary/--json/--strict tests; ticked |
| ACC2-01 | SATISFIED | examples/enterprise, CI step, 0 warnings exit 0 |
| ACC2-02 | SATISFIED | describe/poly/rollup-check extended (38/38, 6/6, 6/6 on enterprise) per README and 14-07 |
| ACC2-03 | BLOCKED | Correctly left unticked (traceability "Partial") |

No orphaned requirement IDs: all five phase IDs appear in plans and REQUIREMENTS.md.

## Anti-Patterns
None found in the verified CLI files; working tree clean.

## Human Verification
None beyond the author's local triage and re-run of the large retrieve (required for gap closure).

## Gaps Summary
Single gap: ACC2-03 / criterion 4 large-retrieve leg. Scope: 150 warnings in five generic areas (standard-field 37 vs 19 accepted, custom-metadata-record 24, formula 28, object-kind 11, reference-target 50). The author is triaging locally; feed into `/gsd:plan-phase 14 --gaps`. The report itself and the acceptance bookkeeping are honest and correct.

## Gap Triage (2026-10-29, author's local large-retrieve run)

Triaged by the author against the local retrieve with name-free counts only (data-classification rule: no object, field, type or record names from the real org enter the repo). Each row is either an orglet gap (fix) or a property of the retrieve or of Salesforce that orglet documents as a counted exclusion.

| Area | Count | Finding | Disposition |
|------|-------|---------|-------------|
| reference-target | 50 | Every warning is `Type__mdt.Field__c: FieldDefinition target X__c is not modelled`. All 29 target fields exist as files in the retrieve. The stored values are bare field API names (50 of 50, 0 qualified); every FieldDefinition field in the retrieve carries `<metadataRelationshipControllingField>` (2 field names, 4 field files). orglet (`packages/engine/src/seed.ts`) requires `Object.Field` and ignores the controlling field (Phase 11 D-08/D-11). | **orglet gap**: resolve a bare FieldDefinition value against the entity named by the controlling EntityDefinition field on the same record. |
| formula | 1 | `Field Account.Name does not exist` on a CampaignMember formula (1 of 1 CampaignMember formulas traversing `Account.`). Baseline `CampaignMember.AccountId` has relationshipName "Related Record ID" (a label), so `resolveRelationship` fails. Baseline scan: 13 further reference fields have no relationshipName at all (Entitlement AccountId/AssetId/BusinessHoursId/ServiceContractId; ServiceContract AccountId/ContactId/Pricebook2Id; Account PersonContactId/PersonIndividualId; Lead.PartnerAccountId; Opportunity.PartnerAccountId; Product2.RecordTypeId; BusinessHours.BusinessHoursId). | **orglet gap**: relationshipName overrides for the 14 fields plus a `baseline:check` guard that every single-target reference field has an identifier-shaped relationshipName. |
| formula | 1 | Formula referencing `QuoteLineItemId` on a baseline object, an accepted standard-field exclusion. Reported under formula instead of standard-field. | **orglet gap (report)**: group a formula whose missing field is a baseline-excluded standard field under the standard-field cause. |
| standard-field | 37 | 18 of the 19 accepted exclusions, plus 19 new public-API fields on Asset, Campaign, Entitlement, Event, Lead, Opportunity, OpportunityLineItem, PricebookEntry, Product2, ServiceContract, SocialPost, User. | **orglet gap**: standard-field round 2 via `scripts/gen-baseline/overrides.json` from the Object Reference, or accepted exclusions with counts, same procedure as 14-03. |
| formula | 15 | `$Permission` global (documented formula-global gap). | Counted exclusion. |
| formula | 1 | Field in a managed-package namespace that the retrieve does not include. | Counted exclusion: managed package not retrieved. |
| formula | 11 | `Field X__c does not exist` for 4 distinct plain custom fields, none present as a file in the retrieve. | Counted exclusion: retrieve incomplete (fix belongs in the backup job's package.xml, not in orglet). |
| custom-metadata-record | 24 | 25 types have records, 22 have an object definition in the retrieve; the 24 records belong to the 3 types without a definition. (Types are plain, not managed.) | Counted exclusion: retrieve incomplete. |
| object-kind | 11 | All platform events (`__e`). | Counted exclusion: backlog 999.8. |

Totals from the report: standard-field 37, reference-target 50, formula 28, custom-metadata-record 24, object-kind 11 = 150. orglet gaps: 50 + 1 + 1 + 37 = 89; counted exclusions: 61. The formula sub-rows above sum to 29 against the reported 28, so one occurrence is double-listed between the plain-missing-field row and the managed-package row; settle the split from the local report at gap closure. Note the retrieve has no `sfdx-project.json`; orglet falls back to the root directory (`readPackageDirectories`), which worked and needs no change.

Expected after gap closure: 0 warnings beyond the documented exclusions (platform events 11, $Permission 15, managed package 1, retrieve incomplete 35, standard-field accepted N), which is the ACC2-03 bar as refined for this org.

_Verifier: Claude (gsd-verifier); triage appended by the orchestrator from the author's name-free counts. Committed with the triage._
