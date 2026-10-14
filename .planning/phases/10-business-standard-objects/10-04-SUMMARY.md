---
phase: 10-business-standard-objects
plan: 04
subsystem: baseline-generator, metadata
tags: [base2-06, baseline, generated-objects, overrides, upgrade]
requires: ["10-01", "10-02", "10-03"]
provides:
  - "18 generated business objects (53 in total) with de-describe key prefixes, labels, name fields, Supported-Calls flags"
  - "pinned source snapshots for 53 objects (sf-skills 4bbae5c, Object Reference sha256 6b9d3731)"
  - "NEW_TABLES upgrade contract: a populated v1.0 database upgrades with no warnings and exactly 18 CREATE TABLE"
affects: [10-05, 10-06]
key-files:
  created:
    - packages/metadata/standard/objects/ (18 new object files)
    - scripts/gen-baseline/source/sf-skills/ (18 new files)
  modified:
    - scripts/gen-baseline/objects.json
    - scripts/gen-baseline/overrides.json
    - scripts/gen-baseline/calls.ts
    - scripts/gen-baseline/snapshot-lists.ts
    - scripts/gen-baseline/source/object-reference/ (35 existing gain supportedCalls, 18 new)
    - packages/metadata/standard/PROVENANCE.json
    - packages/metadata/standard/objects/{Asset,Case,Contract,Entitlement}.json
    - packages/metadata/src/build.test.ts
    - packages/metadata/test/{baseline-generator,documented-fields,object-reference-snapshot}.test.ts
    - packages/engine/src/upgrade.test.ts
key-decisions:
  - "Entitlement lookup lands on the documented spelling LocationID, OrderItem lookup on RelatedOrderItemID (see deviations)"
  - "OpportunitySplit.Split is generated as an AutoNumber name field ({00000000}) because both sources mark it Autonumber/idLookup"
requirements-completed: []
duration: ~35min
completed: 2026-10-14
---

# Phase 10 Plan 04: Land the 18 business objects Summary

The 18 business objects (Quote, QuoteLineItem, Order, OrderItem, AccountContactRelation, AccountTeamMember, OpportunityTeamMember, OpportunityContactRole, OpportunitySplit, ContractLineItem, CaseContactRole, CaseMilestone, EmailMessage, ContentDocument, ContentVersion, FeedItem, Location, Address) are now generated baseline objects from the pinned inputs plus reasoned hand facts. BASE2-06 and BASE2-07 are deliberately NOT ticked (plan 10-06 does that).

## Commits

| Task | Commit | What |
|---|---|---|
| 1 | 6a4dbd1 | objects.json 53 entries, both sources refreshed at the unchanged pins, reviewed-list additions, snapshot test tightened |
| 2 | 110e0bf | overrides.json hand facts, regenerated objects and PROVENANCE.json, generator tests, existing-test updates, NEW_TABLES upgrade contract |
| 3 | 67995a5 | BUSINESS table and five `business:` loader tests (additions only) |

Red window (as the plan predicted): 6a4dbd1 .. 110e0bf. In that window `pnpm baseline:check`, baseline-generator, baseline-gate and documented-fields tests fail because objects.json lists 18 objects with no overrides entry; 110e0bf is green on the full suite.

## Pins held (Task 1 step 4, all run)

- sf-skills diff: 18 new `.json` plus `VENDOR.md` only (Synced date moved 2026-10-13 to 2026-10-14, file hashes listed); `Account.json` diff empty; `Revision: 4bbae5c421e51b40e4169afa72c4496372a602a7` and `Missing upstream: BusinessProcess` present once each.
- Object Reference: `sha256: 6b9d3731...dbef5` and `Last-Modified: Fri, 09 Oct 2026 22:12:36 GMT` present once each; the cached PDF hash was verified before use, no download happened.
- The node comparison confirmed the 35 existing extraction files differ only by the added `supportedCalls` key (exit 0). 52 sf-skills files, 53 Object Reference files.
- WARNING for future runs: `scripts/sync-sfdocs.sh` without a SHA fetches `main`, and `baseline:snapshot` without `--pdf` downloads the current PDF; either rewrites all 35 existing source files and moves the pins in PROVENANCE.json.

## Key prefix table as written (all source `de-describe`, ref "author's own DE describe, 2026-10-14; also ...")

Quote 0Q0, QuoteLineItem 0QL, Order 801, OrderItem 802, AccountContactRelation 07k, AccountTeamMember 01M, OpportunityTeamMember 00q, OpportunityContactRole 00K, OpportunitySplit 049 (D-02 did not fire), ContractLineItem 811, CaseContactRole 03j, CaseMilestone 555, EmailMessage 02s, ContentDocument 069, ContentVersion 068, FeedItem 0D5, Location 131, Address 130. Labels and plural labels are the DE values from 10-03 (four plurals differ from the research proposals).

## Numbers

- PROVENANCE `skipped.referenceTarget`: 94 before, 143 after. Distinct unmodelled target names among those entries (excluding "(none stated)"): 22 before, 39 after by my count (the plan quoted 23 before; I did not reconcile the one-off difference, it is probably a different counting rule).
- Documented skip ratio: 122/1410 = 0.0865 (bound SKIP_RATIO_MAX = 0.103 unchanged; comment updated).
- forcedNullable: 9 before, 10 after; the new entry is Contract.SourceQuoteId (a v1.0 object, as D-18 requires).
- Generator report: `conflicts.unresolved` = [], 12 unsupported-type entries of which 7 belong to the 18 (ContentVersion.VersionData, EmailMessage.BccIds/CcIds/ContentDocumentIds/ToIds, FeedItem.ContentData, Location.Location); the other 5 are the existing v1 Event/Task junction fields.

## Polymorphic subsets (counts 19/10/20 matched the research dry run, no stop needed)

- FeedItem.ParentId (19 of 163): Account, Asset, Campaign, Case, Contact, ContentDocument, Contract, Event, Lead, Location, OperatingHours, Opportunity, Order, OrderItem, Product2, ServiceAppointment, SocialPost, Task, User
- EmailMessage.RelatedToId (10 of 106): Account, Asset, Campaign, Case, Contract, Location, Opportunity, Order, Product2, ServiceAppointment
- ContentVersion.FirstPublishLocationId (20 of 169): Account, Asset, Campaign, Case, Contact, Contract, EmailMessage, Event, Lead, Location, OperatingHours, Opportunity, Order, OrderItem, Organization, Product2, ServiceAppointment, SocialPost, Task, User

## Statements the plan asked for

- relationshipName is guessed from the field name for the 48 hand lookups where no source states one, and the two `*ById` lookups (ContentDocument.ArchivedById, FeedItem.LastEditById) point at User; both are research-recommended extensions of the 09-06 name rule, and every such override carries a reason.
- ContentVersion.ContentDocumentId nillable is a documented exception to D-18 (override written, accepted at the D-04 checkpoint), justified by the Object Reference "omit ContentDocumentId to create a document". An insert without it stores null and orglet's describe reports `nillable: true` where the DE reports `false`; backlog 999.10 removes the override.
- ContentVersion.updateable stays true (Object Reference Supported Calls wins over the REST guide tip); deletable stays false.

## Deviations from Plan

**1. [Rule 3 - Blocking] `merge` Supported Call unknown.** `baseline:snapshot` aborted with "unknown Supported Call(s) merge" for Account, Contact, Individual and Lead. Added `merge` to `KNOWN_SUPPORTED_CALLS` in `scripts/gen-baseline/calls.ts` (it maps to no object flag, `flagsFromCalls` ignores it). Included in commit 6a4dbd1.

**2. [Rule 1 - Bug in plan data] Case-duplicate skips go on the field_reference-only spelling.** The plan named `OrderItem.RelatedOrderItemID` as the one to skip, but in the pinned sources `RelatedOrderItemID` is the documented spelling (sf-skills `fields` and the Object Reference) and `RelatedOrderItemId` is field_reference-only. I followed the plan's stated principle (skip the field_reference-only spelling): skipped `RelatedOrderItemId`, `VersionDataUrl`, `PhotoUrl`; the name-rule lookup for OrderItem is therefore on `RelatedOrderItemID`.

**3. [Rule 1 - same cause] Entitlement lookup spelling.** The documented spelling is `Entitlement.LocationID` (not `LocationId`); the D-19 lookup is set on `LocationID`. Asset.LocationId, Entitlement.ContractLineItemId and Case.FeedItemId are as planned. The report showed no `Entitlement.LocationId` candidate.

**4. [Rule 2 - plan allowance] Two extra name-rule lookups** found in the report as `-> (none stated)` and matching `<Prefix><ModelledObject>Id`: Location.FulfillingBusinessHoursId (BusinessHours) and Location.PropertyOwnerAccountId (Account). Total hand lookups are 48 (46 plan + 2), not 46.

**5. [Rule 1] OpportunitySplit.Split written as AutoNumber.** 10-03 said only "name field Split"; both sources mark Split Autonumber/idLookup, so it uses the same AutoNumber override as OrderNumber (`{00000000}`).

**6. [Rule 1] Snapshot sanity test regex.** `object-reference-snapshot.test.ts` required extraction `type` tokens to match `^[a-z]+$`; the new objects print `base64` and `dynamic picklist`. Relaxed to `^[a-z0-9]+( [a-z]+)?$`. Nothing else in that test was loosened.

**7. Key prefix sources.** Plan table suggested `doc` for Quote, ContentVersion and ContentDocument; per the execution notes all 18 use `de-describe`, with the doc reference kept in the `ref` text. The BUSINESS test therefore expects `keyPrefixSource: "de-describe"` for all 18.

No change was needed in `packages/schema/src/migrate.test.ts` (the thin-upgrade test stays green).

## Known Stubs

None.

## Verification actually run

- `pnpm baseline:check`: exit 0, "checked 54 files" (after the final commit).
- `pnpm test` (full workspace on pglite): 38 files passed, 615 tests passed, 3 skipped (the existing Postgres-only concurrency tests). Includes `packages/engine/src/upgrade.test.ts`: populated v1.0 database upgrades with `EXPECTED_WARNINGS = []`, FORBIDDEN (DROP TABLE, DROP COLUMN, ALTER COLUMN TYPE) empty, CREATE TABLE exactly the 18 NEW_TABLES and none of account/contact/case/group, rows identical on v1.0 columns, second run silent.
- `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:scripts`: clean.
- All acceptance-criteria shell/node checks of Task 2 were run and pass (53 object files, NEW_TABLES, Order/CaseMilestone/ContentDocument/ContentVersion/OrderItem flags, VersionData absent, Contract.SourceQuoteId / Case.FeedItemId / Asset.LocationId present, forcedNullable only v1 objects, 61 "neither source states Refers To" reasons).
- Not run: the suite against a real Postgres 16 (ORGLET_DATABASE_URL was not set; pglite only).

## Deviation fix (post-plan): SDK spelling for case twins

**[Rule 1 - Bug]** Deviations 2 and 3 above kept the Object Reference (PDF) capitalisation. The author's own Developer Edition describe (2026-10-14) returns the SDK spelling wherever the field exists: Entitlement `LocationId`, ContentVersion `VersionDataUrl`, AccountTeamMember and OpportunityTeamMember `PhotoUrl`, ExternalDataSource `IsWritable`. DandBCompany `URL` is spelled `URL` by both and stays. OrderItem `RelatedOrderItemId`, Quote `RecordTypeId` and Account `PersonBirthdate` are absent from the DE (order management, Quote record types and Person Accounts are not enabled), so the same convention was applied (`Id` and `Url` suffixes, `RecordTypeId` like every other object).

| Object | Before | After |
|--------|--------|-------|
| OrderItem | RelatedOrderItemID | RelatedOrderItemId |
| Entitlement | LocationID | LocationId |
| ContentVersion | VersionDataURL | VersionDataUrl |
| Quote | RecordTypeID | RecordTypeId |
| AccountTeamMember | PhotoURL | PhotoUrl |
| OpportunityTeamMember | PhotoURL | PhotoUrl |
| Account | PersonBirthDate | PersonBirthdate |
| ExternalDataSource | isWritable | IsWritable |

**What changed**
- `sourceFieldsOf` (scripts/gen-baseline/sources.ts) merges a documented name and a `field_reference` name that differ only by case into one field named as `field_reference` spells it. Documented facts win over `field_reference` facts; only the name follows the SDK list. The pairs are reported as `caseSpelling` (generator report and PROVENANCE.json).
- New `renameFrom` field override (key is the emitted name, value the PDF spelling) for names with no twin: `Quote.RecordTypeId` (from `RecordTypeID`) and `AccountTeamMember.PhotoUrl` (from `PhotoURL`). Listed as `renamedByOverride`.
- The twin `skip` entries (Account.PersonBirthdate, ContentVersion.VersionDataUrl, ExternalDataSource.IsWritable, OpportunityTeamMember.PhotoUrl, OrderItem.RelatedOrderItemId, Lead.DandBCompanyId) were removed; the Entitlement, OrderItem and Quote hand lookups were re-keyed to the new spellings.
- Baseline regenerated (8 object files plus PROVENANCE.json). Lead is byte-identical: the v1.0 field `DandbCompanyId` was already in the SDK spelling and is now also reported as a case twin.
- Tests: generator unit test on synthetic input (documented `CaseTwinID` plus `field_reference` `CaseTwinId` emits `CaseTwinId` with the documented label), loader assertions for the eight fields and their absent old spellings, and the two documented-field coverage tests now compare case-insensitively.

**Upgrade safety:** neither Account.PersonBirthDate nor ExternalDataSource.isWritable is in the v1.0 baseline (checked with `git show v1.0:...`), so the v1-vs-v2 diff gate and the allowlist are untouched. `columnName` lower-cases, so the Postgres column of every renamed field is unchanged and migrate emits no DDL for the rename. Side effects of preferring documented-then-SDK facts: OpportunityTeamMember.PhotoUrl takes the field_reference label "Url for thumbnail sized photo" and OrderItem.RelatedOrderItemId takes "Order Product ID" (both previously a humanised guess); ExternalDataSource.IsWritable takes "Writable External Objects". Review if those labels are unwanted.

## Self-Check: PASSED

Commits 6a4dbd1, 110e0bf, 67995a5 exist; the summary file and the 18 new object files exist.
