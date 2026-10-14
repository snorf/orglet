---
phase: 10-business-standard-objects
plan: 03
subsystem: baseline-generator
tags: [base2-06, checkpoint, key-prefix, de-describe, labels, name-fields]
requires: []
provides:
  - "D-04 checkpoint answers for the 18 business objects: key prefixes, labels, name fields, AutoNumber display format, length conflicts, ContentDocumentId override"
affects: [10-04, 10-05, 10-06]
tech-stack:
  added: []
  patterns: []
key-files:
  created:
    - .planning/phases/10-business-standard-objects/10-03-SUMMARY.md
  modified:
    - .planning/ROADMAP.md
key-decisions:
  - "OpportunitySplit prefix 049 confirmed from Johan's own DE describe; D-02 does not fire"
  - "All 18 key prefixes confirmed by DE describe and agree with the community lists; no conflicts"
  - "Four labelPlural values and the OpportunitySplit name field are corrected from DE; the rest of the proposals are accepted"
  - "ContentVersion.ContentDocumentId nullable override accepted; the DE describe shows nillable: false, so this is a recorded describe divergence until backlog 999.10 lands"
requirements-completed: []
duration: checkpoint
completed: 2026-10-14
---

# Phase 10 Plan 03: D-04 key-prefix, label and name-field checkpoint Summary

Johan ran `sf sobject describe` for all 18 objects against his own Developer Edition (Level 1 data, Phase 3 D-03a precedent) and the answers below are his readings. orglet never contacted an org. Every prefix agrees with the community lists, so Plan 10-04 records them as `source: "de-describe"`, `ref: "author's own DE describe, 2026-10-14"` and there is nothing to raise under "Conflicts".

## Checkpoint answers

Checkpoint date: 2026-10-14
Prefix OpportunitySplit: 049 (de-describe)
Prefix AccountTeamMember: 01M (de-describe)
Prefix FeedItem: 0D5 (de-describe)
Prefix EmailMessage: 02s (de-describe)
Prefix corrections: none
AutoNumber displayFormat: {00000000} (de-describe)
Quote.Name length: 255
QuoteLineItem.Description length: 255
ContentVersion.ContentDocumentId nullable override: accepted
OpportunitySplit name field: Split

All 18 prefixes verified (de-describe, 2026-10-14): Quote 0Q0, QuoteLineItem 0QL, Order 801, OrderItem 802, AccountContactRelation 07k, AccountTeamMember 01M, OpportunityTeamMember 00q, OpportunityContactRole 00K, OpportunitySplit 049, ContractLineItem 811, CaseContactRole 03j, CaseMilestone 555, EmailMessage 02s, ContentDocument 069, ContentVersion 068, FeedItem 0D5, Location 131, Address 130.

OwnerId absent in DE describe (hasOwner false): OpportunitySplit, AccountContactRelation, FeedItem, EmailMessage.

AutoNumber displayFormat evidence: the Order Number field detail page in Johan's DE shows `Display Format {00000000}`. The same format is applied to OrderItemNumber, LineNumber, LineItemNumber and Address.Name (one DE reading, proposal matched).

Length evidence: Quote `Name` Text(255) and Quote Line Item `Description` Text(255) in the DE field lists, so the 09-06 larger-value rule and the DE agree.

## Labels and name fields

| Object | label | labelPlural | name field | source |
|---|---|---|---|---|
| Quote | Quote | Quotes | Name | de-describe |
| QuoteLineItem | Quote Line Item | Quote Line Items | LineNumber (AutoNumber) | de-describe |
| Order | Order | Orders | OrderNumber (AutoNumber) | de-describe |
| OrderItem | Order Product | Order Products | OrderItemNumber (AutoNumber) | de-describe |
| AccountContactRelation | Account Contact Relationship | Account Contact Relationships | none | proposal accepted |
| AccountTeamMember | Account Team Member | Account Teams | none | de-describe |
| OpportunityTeamMember | Opportunity Team Member | Opportunity Team | Name (read-only) | de-describe |
| OpportunityContactRole | Opportunity Contact Role | Opportunity Contact Role | none | de-describe |
| OpportunitySplit | Opportunity Split | Opportunity Splits | Split | de-describe |
| ContractLineItem | Contract Line Item | Contract Line Items | LineItemNumber (AutoNumber) | de-describe |
| CaseContactRole | Case Contact Role | Case Contact Role | none | de-describe |
| CaseMilestone | Case Milestone | Case Milestones | none | de-describe |
| EmailMessage | Email Message | Email Messages | Name (read-only) | de-describe |
| ContentDocument | Content Document | Content Documents | Title | de-describe |
| ContentVersion | Content Version | Content Versions | Title | de-describe |
| FeedItem | Feed Item | Feed Items | none | de-describe |
| Location | Location | Locations | Name | de-describe |
| Address | Address | Addresses | Name (AutoNumber) | de-describe |

Corrections against the research proposals: AccountTeamMember labelPlural "Account Teams" (not "Account Team Members"), OpportunityTeamMember labelPlural "Opportunity Team" (not "Opportunity Team Members"), OpportunityContactRole labelPlural "Opportunity Contact Role" (singular, as the DE shows), CaseContactRole labelPlural "Case Contact Role" (singular), OpportunitySplit name field `Split` (research FEATURES said none; the DE marks `Split` as nameField). AccountContactRelation's prefix came from a second describe call that did not print the label, so its label stays the proposal.

## Conflicts

None. Every DE prefix equals the FishOfPrey value, and where a second community list exists it agrees too.

## ContentVersion.ContentDocumentId decision

Johan's DE describe of `ContentVersion.ContentDocumentId`: `createable: true`, `updateable: false`, `nillable: false`, `referenceTo: ContentDocument`. In a real org the field is required in describe but may be omitted on insert because the platform creates the ContentDocument automatically. orglet does not do that in Phase 10, so the override is accepted: an insert without ContentDocumentId stores null, and orglet's describe reports `nillable: true` where the DE reports `false`. This is a documented exception to D-18 and a recorded describe divergence.

Johan's direction: file upload is a central capability and must be done properly later, not left as the override. Backlog item 999.10 (ROADMAP.md) captures the full fix: automatic ContentDocument creation on ContentVersion insert (then the override is dropped and describe returns to `nillable: false`), `VersionData` as a blob field with the `/sobjects/ContentVersion/{id}/VersionData` download endpoint, and ContentDocumentLink. Until then BASE2-06 keeps omitting `VersionData` as planned.

## Deviations from plan

None. No code or data changed (`git status --porcelain -- scripts packages` is empty). ROADMAP.md gained backlog item 999.10 at Johan's request during the checkpoint.

## Self-Check: PASSED

- Checkpoint date line present
- Prefix OpportunitySplit line has an allowed value
- Length, AutoNumber, override and name-field lines present
- Label table has 18 object rows
