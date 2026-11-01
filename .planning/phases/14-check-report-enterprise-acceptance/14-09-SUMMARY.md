---
phase: 14-check-report-enterprise-acceptance
plan: 09
subsystem: baseline-generator
tags: [baseline, relationshipName, formula, gap-closure]
requires: []
provides:
  - relationshipNameProblems guard in baseline:gen and baseline:check
  - identifier-shaped relationshipName on all single-target baseline lookups
affects: [packages/metadata/standard, scripts/gen-baseline]
key-files:
  modified:
    - scripts/gen-baseline/pipeline.ts
    - scripts/gen-baseline/generate.ts
    - scripts/gen-baseline/overrides.json
    - packages/metadata/test/baseline-generator.test.ts
    - packages/metadata/standard/PROVENANCE.json
    - packages/cli/src/main.test.ts
key-decisions:
  - "Name rule (field name minus Id) applied to all 14 fields because the Object Reference could not be read"
requirements-completed: [ACC2-03 (relationshipName part only; criterion still open until 14-12)]
duration: 15min
completed: 2026-10-30
---

# Phase 14 Plan 09: baseline relationshipName Summary

Generator guard plus 14 relationshipName overrides, so `Account.Name` on CampaignMember and the 13 latent single-target lookups are traversable.

## Commits
- 4f83b8a: guard (`relationshipNameProblems`), wired into gen and check, unit tests
- 7303394: overrides, regenerated baseline, check-level traversal test

## RED state recorded (Task 1)
Before the overrides the committed-baseline test failed on exactly the 14 fields below.

## Per-field table
Source for every row: name rule (09-06 checkpoint, Phase 10 D-19). The online Object Reference page is a JavaScript shell (curl returned 22 KB with no field content), so no relationship name could be read from it; "not stated" for all, fetch attempted 2026-10-30. No planned name was changed.

| Field | relationshipName | Source |
|---|---|---|
| CampaignMember.AccountId | Account | name rule (sf-skills value "Related Record ID" was the label) |
| Entitlement.AccountId | Account | name rule |
| Entitlement.AssetId | Asset | name rule |
| Entitlement.BusinessHoursId | BusinessHours | name rule |
| Entitlement.ServiceContractId | ServiceContract | name rule |
| ServiceContract.AccountId | Account | name rule |
| ServiceContract.ContactId | Contact | name rule |
| ServiceContract.Pricebook2Id | Pricebook2 | name rule |
| Account.PersonContactId | PersonContact | name rule |
| Account.PersonIndividualId | PersonIndividual | name rule |
| Lead.PartnerAccountId | PartnerAccount | name rule (Quote precedent) |
| Opportunity.PartnerAccountId | PartnerAccount | name rule (Quote precedent) |
| Product2.RecordTypeId | RecordType | name rule |
| BusinessHours.BusinessHoursId | BusinessHours | name rule |

## Verification
- `pnpm baseline:gen`, `pnpm baseline:check`, `pnpm typecheck:scripts`, `pnpm lint` clean
- `pnpm vitest run packages/metadata`: 235 passed (11 files); `packages/cli/src/main.test.ts`: 33 passed
- Not run: `pnpm build` and the other-backend gate (14-12 owns the full gate)

## Deviations from Plan
None. The Object Reference lookup step could not extract content (documented above); the plan's fallback (name rule) was used.

## Known Stubs
None.

## Self-Check: PASSED
Commits 4f83b8a and 7303394 exist; changed files verified by git status before commit.
