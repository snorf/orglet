---
phase: 09-baseline-generator-parity-ownerid-narrowing
plan: 06
subsystem: baseline-generator
tags: [base2-02, base2-03, full-mode, feature-gated, provenance, report, checkpoint]
requires: [09-03, 09-04, 09-05]
provides:
  - "pipeline.ts full mode: every documented field of the 35 objects in memory with the step-B rules (skip unsupported types and outside references, gating, forced nullable, sdk-only read-only, picklists without values)"
  - "pipeline.ts: GenerateOptions.collectConflicts, report.skipped/forcedNullable/gating/sdkOnly/conflicts/totals, PROVENANCE.json output, sortKeysDeep"
  - "sources.ts: parseSnapshots -> inputs.snapshots from both VENDOR.md files"
  - "generate.ts --report: full-mode report as sorted JSON, writes nothing"
  - "overrides.json: 12 settled length conflicts, 5 skip entries"
  - "11 step-B tests in baseline-generator.test.ts"
affects: [09-07, 09-08, 09-09, 10]
tech-stack:
  added: []
  patterns: ["new-field rules gated on isNew = full mode && no v1 pin, so step B cannot alter step A output", "skip-and-report instead of abort for new Lookups without a modelled target", "case-insensitive system-name exclusion and a case-collision guard because columnName lower-cases"]
key-files:
  created: []
  modified:
    - scripts/gen-baseline/pipeline.ts
    - scripts/gen-baseline/sources.ts
    - scripts/gen-baseline/generate.ts
    - scripts/gen-baseline/overrides.json
    - packages/metadata/test/baseline-generator.test.ts
    - packages/metadata/test/baseline-gate.test.ts
key-decisions:
  - "A new Lookup whose Refers To neither source states is skipped and reported as `reference-target X -> (none stated)` instead of aborting; the abort stays for v1.0 fields"
  - "Checkbox is exempt from the forced-nullable rule: the engine defaults an absent Checkbox to false before the required check and v1.0 writes nillable: false on 65 of 80 Checkboxes"
  - "System field names are excluded case-insensitively and two emitted names differing only in case abort (columnName lower-cases); documented case variants of v1.0 fields are skipped via overrides"
  - "Length conflicts between the sources on new fields are settled by taking the larger value (12 overrides), so no documented value is rejected"
  - "PROVENANCE.json counts facts (one key = one fact) by provenance, lists only non-verified facts per field, and copies the two VENDOR.md pins; no timestamps"
requirements-completed: []
duration: 17min
completed: 2026-10-13
---

# Phase 9 Plan 06: Full-mode generation rules, PROVENANCE.json and the step-B report Summary

Full mode (`generate(inputs, { v1Only: false })`) now runs to completion in memory on the committed inputs: 818 documented new fields on the 35 objects, 1 864 new fields emitted (1 142 of them read-only `field_reference`-only fields, 1 022 of those on Profile), 112 skipped and reported (5 unsupported types, 107 reference targets), 132 feature-gated, 8 forced nullable, 0 unresolved conflicts after 12 reasoned overrides, while every v1.0 field is byte-for-byte what the v1-only run produces. `CLI_OPTIONS` is unchanged, nothing under `packages/metadata/standard/` changed, and the decision checkpoint (Task 2) is open for Johan.

## Performance
- **Started:** 2026-10-13T21:24:51Z — **Completed:** 2026-10-13T21:42Z — **Duration:** ~17 min
- **Tasks:** 1/2 (Task 2 is the blocking decision checkpoint) — **Files:** 6 modified

## Commits
| Hash | Type | What |
|---|---|---|
| c7d5d63 | test | RED: 11 step-B tests (suite failed in `beforeAll` at `Account.ConnectionReceivedId: Lookup without referenceTo`) |
| 1df16ee | feat | full-mode rules, `collectConflicts`, PROVENANCE.json, `parseSnapshots`, `generate.ts --report`, overrides, synthetic gate test retarget (GREEN) |

## Step-B report (final `--report` run, HEAD 1df16ee; JSON saved under the session scratch dir as `report.json`, 123 425 bytes)

### Summary numbers
| Measure | Value |
|---|---|
| Documented new fields (sf-skills `fields` ∪ Object Reference, minus system names, v1.0 fields and override skips) | **818** |
| Generated new fields (any source) | **1 864** |
| of which `field_reference`-only, emitted read-only (rule 5) | 1 142 (Profile 1 022, User 46, ServiceAppointment 17, Product2 13, Account 10, Organization 8, DandBCompany 5, Asset 4, ServiceContract 4, ...) |
| Skipped, `field-type` (JunctionIdList) | 5: Event.AcceptedEventInviteeIds, Event.DeclinedEventInviteeIds, Event.EventWhoIds, Event.UndecidedEventInviteeIds, Task.TaskWhoIds |
| Skipped, `reference-target`, target outside objects.json | 28 (ActivityMetric/ActivityMetricRollup x10, Quote, PardotTenant, Record, RetailStore/WebStore, ProductSellingModel, BillingPolicy, TaxPolicy, UnitOfMeasure, WorkOrder family, ServiceTerritory, WorkType, SocialPersona, ...) |
| Skipped, `reference-target`, no Refers To in either source | 79 (list below) |
| Skipped total / of which documented | 112 / **96** (16 are `field_reference`-only) |
| **Skip ratio, documented: 96 / 818** | **11.7 %** |
| Skip ratio, all skipped / documented: 112 / 818 | 13.7 % |
| Forced nullable (rule 4, Checkbox exempt) | **8**: BusinessHours.TimeZoneSidKey, BusinessProcess.TableEnumOrId, CallCenter.InternalName, DandBCompany.DunsNumber, OperatingHours.TimeZone, ServiceAppointment.DueDate, ServiceAppointment.EarliestStartTime, User.Manager |
| Feature-gated (rule 3) | **132**: person-accounts 44, social 44, enabled-phrase 20, chatter 14, data-com 5, field-service 3, knowledge 2, org-feature-phrase 1 |
| Conflicts: settled by override / remaining | 12 / **0** (all `length`; DandBCompany x10, ServiceContract x2) |
| Skipped by overrides.json | 5: Account.PersonBirthdate, ExternalDataSource.IsWritable, Lead.DandBCompanyId, Profile.Permissions, Profile.PermissionsPermissionName |
| System names excluded (loader adds them) | 233, incl. the case variant `Campaign.CreatedByID` |
| Guessed facts on new fields | 557 - 89 (v1.0 run) = 468 new (numeric precision/scale defaults, humanised labels, D-05 lengths) |
| Output files in full mode | 36 (35 objects + PROVENANCE.json, 377 561 bytes; fact totals verified 3 266, sdk-only 5 971, v1.0 588, guessed 512, doc-only 40, override 12) |
| Total fields in full mode | 2 523 (v1.0: 659) |

Gated Contact/Lead Data.com fields (for the test): `Contact.JigsawContactId`, `Lead.JigsawContactId` (data-com); also gated: `Contact.IsPersonAccount` (person-accounts), `Lead.Division` (enabled-phrase). 32 of the 33 Account `ispersonaccount_fields` are generated and gated (PersonContactId and PersonIndividualId are Lookups with no Refers To and are skipped).

### Per object
| object | v1.0 | documented new | generated new | sdk-only | skip type | skip ref | skipped documented | skip ratio | gated | forced | fields total |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Account | 57 | 61 | 64 | 10 | 0 | 7 | 7 | 11.5% | 44 | 0 | 121 |
| Asset | 26 | 41 | 42 | 4 | 0 | 5 | 3 | 7.3% | 14 | 0 | 68 |
| BusinessHours | 3 | 17 | 16 | 0 | 0 | 1 | 1 | 5.9% | 0 | 1 | 19 |
| BusinessProcess | 1 | 4 | 4 | 0 | 0 | 0 | 0 | 0.0% | 0 | 1 | 5 |
| CallCenter | 1 | 4 | 4 | 0 | 0 | 0 | 0 | 0.0% | 0 | 1 | 5 |
| Campaign | 38 | 28 | 24 | 0 | 0 | 4 | 4 | 14.3% | 0 | 0 | 62 |
| CampaignMember | 27 | 5 | 4 | 0 | 0 | 1 | 1 | 20.0% | 1 | 0 | 31 |
| Case | 41 | 13 | 8 | 1 | 0 | 6 | 6 | 46.2% | 3 | 0 | 49 |
| Contact | 59 | 25 | 20 | 1 | 0 | 6 | 6 | 24.0% | 2 | 0 | 79 |
| Contract | 42 | 14 | 12 | 1 | 0 | 4 | 3 | 21.4% | 0 | 0 | 54 |
| DandBCompany | 1 | 107 | 112 | 5 | 0 | 0 | 0 | 0.0% | 0 | 1 | 113 |
| Entitlement | 1 | 21 | 12 | 1 | 0 | 12 | 10 | 47.6% | 0 | 0 | 13 |
| Event | 37 | 19 | 15 | 0 | 4 | 0 | 4 | 21.1% | 1 | 0 | 52 |
| ExternalDataSource | 1 | 12 | 10 | 0 | 0 | 4 | 2 | 16.7% | 0 | 0 | 11 |
| Group | 7 | 3 | 2 | 0 | 0 | 1 | 1 | 33.3% | 0 | 0 | 9 |
| IdeaTheme | 1 | 8 | 7 | 0 | 0 | 1 | 1 | 12.5% | 0 | 0 | 8 |
| Individual | 3 | 24 | 24 | 0 | 0 | 0 | 0 | 0.0% | 0 | 0 | 27 |
| Lead | 54 | 21 | 14 | 1 | 0 | 8 | 8 | 38.1% | 2 | 0 | 68 |
| OperatingHours | 1 | 4 | 6 | 2 | 0 | 0 | 0 | 0.0% | 0 | 1 | 7 |
| Opportunity | 37 | 15 | 8 | 1 | 0 | 9 | 8 | 53.3% | 0 | 0 | 45 |
| OpportunityHistory | 0 | 9 | 10 | 1 | 0 | 0 | 0 | 0.0% | 0 | 0 | 10 |
| OpportunityLineItem | 16 | 10 | 8 | 0 | 0 | 2 | 2 | 20.0% | 0 | 0 | 24 |
| Organization | 39 | 52 | 51 | 8 | 0 | 9 | 9 | 17.3% | 0 | 0 | 90 |
| Pricebook2 | 7 | 2 | 3 | 1 | 0 | 1 | 0 | 0.0% | 0 | 0 | 10 |
| PricebookEntry | 8 | 3 | 3 | 1 | 0 | 1 | 1 | 33.3% | 0 | 0 | 11 |
| Product2 | 17 | 21 | 29 | 13 | 0 | 7 | 5 | 23.8% | 2 | 0 | 46 |
| Profile | 12 | 1 | 1023 | 1022 | 0 | 0 | 0 | 0.0% | 0 | 0 | 1035 |
| RecordType | 8 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0% | 0 | 0 | 8 |
| ServiceAppointment | 1 | 42 | 55 | 17 | 0 | 8 | 4 | 9.5% | 2 | 2 | 56 |
| ServiceContract | 1 | 43 | 42 | 4 | 0 | 5 | 5 | 11.6% | 0 | 0 | 43 |
| SocialPost | 1 | 57 | 56 | 1 | 0 | 2 | 2 | 3.5% | 44 | 0 | 57 |
| Task | 35 | 5 | 3 | 1 | 1 | 3 | 3 | 60.0% | 0 | 0 | 38 |
| User | 62 | 118 | 164 | 46 | 0 | 0 | 0 | 0.0% | 16 | 1 | 226 |
| UserLicense | 2 | 7 | 7 | 0 | 0 | 0 | 0 | 0.0% | 1 | 0 | 9 |
| UserRole | 12 | 2 | 2 | 0 | 0 | 0 | 0 | 0.0% | 0 | 0 | 14 |
| **Total** | 659 | 818 | 1864 | 1142 | 5 | 107 | 96 | 11.7% | 132 | 8 | 2523 |

**5 highest skip ratios:** Task 3/5 (60.0 %), Opportunity 8/15 (53.3 %), Entitlement 10/21 (47.6 %), Case 6/13 (46.2 %), Lead 8/21 (38.1 %). All are driven by Lookups without a Refers To line in either source (Opportunity.PricebookId, SyncedQuoteID, PartnerAccountId, Connection*Id; Entitlement.AccountId, AssetId, BusinessHoursId, ServiceContractId, SlaProcessId, ContractLineItemId; Case.Connection*Id, FeedItemId, QuestionId, CommunityId; Lead.PartnerAccountId, ActionCadence*Id, ScoreIntelligenceId).

### The 79 Lookups skipped as "(none stated)"
Account.ConnectionReceivedId, Account.ConnectionSentId, Account.PersonContactId, Account.PersonIndividualId, Asset.BindingInstanceTargetId, Asset.CurrentQuantityUnitId, Asset.LocationId, BusinessHours.BusinessHoursId, Campaign.CampaignImageId, Campaign.ParentCampaign, CampaignMember.LeadOrContactId, Case.AssetWarrantyID, Case.CommunityId, Case.ConnectionReceivedId, Case.ConnectionSentId, Case.FeedItemId, Case.QuestionId, Contact.ActionCadenceAssigneeId, Contact.ActionCadenceId, Contact.ConnectionReceivedId, Contact.ConnectionSentId, Contract.SourceOpportunityId, Entitlement.AccountId, Entitlement.AssetId, Entitlement.AssetWarrantyID, Entitlement.AssetWarrantyId, Entitlement.BusinessHoursId, Entitlement.ContractLineItemId, Entitlement.LocationID, Entitlement.LocationId, Entitlement.ServiceContractId, Entitlement.SlaProcessId, Entitlement.SvcApptBookingWindows, Entitlement.SvcApptBookingWindowsId, ExternalDataSource.LargeIconId, ExternalDataSource.SmallIconId, Group.QueueRoutingConfigId, IdeaTheme.CommunityId, Lead.ActionCadenceAssigneeId, Lead.ActionCadenceId, Lead.ConnectionReceivedId, Lead.ConnectionSentId, Lead.PartnerAccountId, Lead.ScoreIntelligenceId, Opportunity.ConnectionReceivedId, Opportunity.ConnectionSentId, Opportunity.PartnerAccountId, Opportunity.PricebookId, Opportunity.SyncedQuoteID, Opportunity.SyncedQuoteId, Opportunity.Territory2Id, OpportunityLineItem.ConnectionReceivedId, OpportunityLineItem.ConnectionSentId, Organization.SelfService*Id x6, Organization.WebToCase*Id x3, Pricebook2.CostBookId, Product2.BasedOnId, Product2.ConnectionReceivedId, Product2.ConnectionSentId, Product2.RecordTypeId, ServiceAppointment.AppointmentCategoryId, ServiceAppointment.AppointmentInvitationId, ServiceAppointment.EngagementChannelTypeId, ServiceAppointment.ReceiptOrderId, ServiceContract.AccountId, ServiceContract.ContactId, ServiceContract.ParentServiceContractId, ServiceContract.Pricebook2Id, ServiceContract.RootServiceContractId, Task.ActionCadenceStepTrackerId, Task.ConnectionReceivedId, Task.ConnectionSentId.

About 15 of these name a modelled object (Entitlement.AccountId/AssetId/BusinessHoursId/ServiceContractId, ServiceContract.AccountId/ContactId/Pricebook2Id/ParentServiceContractId/RootServiceContractId, Product2.RecordTypeId, Account.PersonContactId -> Contact, CampaignMember.LeadOrContactId -> Lead/Contact, Contract.SourceOpportunityId, Opportunity.PartnerAccountId, Lead.PartnerAccountId). Restoring them needs an overrides `set: { referenceTo }` with a reason; the target is not stated by either source, so this plan did not add them (it is a policy question for the checkpoint, not an extraction slip).

## What was built

### Full-mode rules (scripts/gen-baseline/pipeline.ts)
Applied only when `isNew = !v1Only && !fieldPins` (a v1.0 field is never touched; the step-B test deep-equals every v1.0 field against the v1-only run), in this order after derived + pins + overrides `set` and the 09-05 MasterDetail guard:
1. unsupported type (TYPE_MAP `skip`) -> `report.unsupportedTypes` (`UNSUPPORTED:field-type ...`) and `report.skipped.fieldType` (`Obj.Field (token)`); 
2. Lookup/MasterDetail with no `referenceTo` -> `skipped.referenceTarget` `Obj.Field -> (none stated)`; any target outside objects.json -> `Obj.Field -> A, B` (whole field skipped, never a narrowed target list);
3. `field_reference`-only (`sf.type` undefined and no PDF entry) -> `createable: false`, `updateable: false` unless the override sets them, `report.sdkOnly`;
4. Picklist/MultiselectPicklist -> `picklistValues`, `restrictedPicklist`, `standardValueSet` dropped unless set by override (Pitfall B4);
5. gating ids = PDF `gating` ∪ `matchGating(sf-skills description)` ∪ `person-accounts` when in `ispersonaccount_fields`; `overrides.featureGated` wins; gated -> `featureGated: true`, `nillable` deleted, an override `set.nillable: false` on a gated field is a GeneratorError (D-09); every heuristic hit lands in `report.gating` (D-08 review list);
6. required-looking (`nillable: false`, createable, not defaultedOnCreate, **not Checkbox**) -> `nillable` deleted, `report.forcedNullable`; `set: { nillable: false }` restores it.
System names (`Id`, `IsDeleted`, `Created*`, `LastModified*`, `SystemModstamp`, `OwnerId`) are excluded from the inventory case-insensitively (`report.excludedSystem`) because `columnName` lower-cases; after the loop, two emitted names that differ only in case abort with a message pointing at overrides.json. `collectConflicts: true` collects unresolved conflicts into `report.conflicts` (`unresolved` list + `byFact` counts) instead of throwing. `report.totals` = `{ documentedNew, generatedNew, sdkOnlyCandidates, skippedDocumented, skippedSdkOnly }`.

### PROVENANCE.json (full mode only, `files.get("PROVENANCE.json")`)
`{ pins: { sfSkills: <40-hex sha>, objectReference: { url, lastModified, sha256 } }, counts: { Obj: { fields, verified, sdkOnly, docOnly, guessed, v1, override, featureGated, skippedFieldType, skippedReferenceTarget } }, objects: { Obj: { keyPrefix: <source>, fields: { Field: { fact: provenance } } } }, skipped: { fieldType, referenceTarget }, forcedNullable, gating }`. Counts are per fact (one JSON key = one fact); per field only non-verified facts are listed (`v1.0` for pinned keys, `override` for override-set keys, else the derived tag; untagged type-derived facts count as verified). Keys sorted with `sortKeysDeep`, `serialise`d, no prose (tested with the SC1 regex). Pins come from `inputs.snapshots`, which `sources.ts#parseSnapshots` reads from the two VENDOR.md files (`Revision:`, `Source:`, `Last-Modified:`, `sha256:`), so the generator stays fs-free and timestamp-free.

### generate.ts
`--report` runs `generate(inputs, { v1Only: false, collectConflicts: true })` and prints `sortKeysDeep(report)` with `serialise`; one mode per invocation (`--check | --bootstrap-pins | --report`). `main()` now sets `process.exitCode` instead of calling `process.exit()`: on macOS a piped stdout is asynchronous and `exit()` truncated the report (found when diffing two runs through a pipe).

### overrides.json (+17 entries, 36 field entries total)
- 12 `set: { length }` for genuine source disagreements on new fields, each reason naming both values: DandBCompany.{Country 80, MailingCountry 80, MailingState 80, State 80} (field_reference 80 vs PDF 40/20), DandBCompany.{SecondSic, ThirdSic, FourthSic, FifthSic, SixthSic} 8 (4 vs 8), DandBCompany.URL 255 (255 vs 104), ServiceContract.{BillingCountry 80, BillingState 80}. Rule: the larger value, so no documented value is rejected.
- 5 `skip`: Profile.Permissions and Profile.PermissionsPermissionName (placeholders for the Permissions<Name> family, per 09-03), Account.PersonBirthdate and ExternalDataSource.IsWritable (`field_reference` case variants of the documented PersonBirthDate / isWritable), Lead.DandBCompanyId (the sources' spelling of the v1.0 field `DandbCompanyId`).
No extractor change and no PDF re-snapshot: none of the 12 conflicts was an extraction slip, so the 09-03 pin (sha256 `6b9d3731...`, Last-Modified 2026-10-09) is untouched and **no re-pin is raised**.

## Verification (HEAD 1df16ee)
- `pnpm vitest run packages/metadata`: 9 files, 157 passed (18 in baseline-generator.test.ts: 7 step-A + 11 step-B; 17 in baseline-gate.test.ts). `pnpm test`: 36 files, 561 passed, 3 skipped (pre-existing Phase 12 `it.fails`; pglite, no Docker).
- `pnpm typecheck:scripts`, `pnpm lint`: clean. `pnpm baseline:check`: "checked 35 object files", exit 0. `git diff --stat -- packages/metadata/standard`: empty.
- `--report` twice (file and pipe): byte-identical, 123 425 bytes.
- Acceptance greps: `matchGating` 2, `ispersonaccount` 1, `PROVENANCE.json` 4, `collectConflicts` 3 in pipeline.ts; `--report` 4 in generate.ts; `UNSUPPORTED:standard-field-type` 0 in scripts/gen-baseline; `ownerTargets` in pipeline.ts: the OBJECT_KEY_ORDER entry plus the pre-existing (09-04) `validateOverrides` reason check, nothing emitted.

## Deviations from Plan
1. **[Rule 2 - Missing handling] New Lookups without a stated target are skipped, not aborted.** 79 of them exist (most `field_reference`-only, some in `fields` with an empty `refers_to`, e.g. Opportunity.PricebookId, Entitlement.AccountId). The 09-04 abort would have made full mode unreachable; the plan's rule 2 covers only targets outside the list. They are reported as `Obj.Field -> (none stated)` under `skipped.referenceTarget`; the abort still protects v1.0 fields. Policy question for the checkpoint.
2. **[Rule 2 - Correctness] Case-insensitive system exclusion and a case-collision guard.** `columnName` lower-cases, so `Campaign.CreatedByID` (both sources) is the system column and `Account.PersonBirthdate`/`PersonBirthDate`, `ExternalDataSource.IsWritable`/`isWritable`, `Lead.DandBCompanyId`/`DandbCompanyId` would each collide in DDL. The generator now aborts on an emitted case collision; the three documented-vs-variant cases are settled by `skip` overrides with reasons, the system variant is excluded and listed in `report.excludedSystem`.
3. **Checkbox exempt from forced-nullable.** Rule 4 as written would have forced 98 of 106 required-looking fields nullable, all `User.UserPreferences*`/`UserPermissions*` Checkboxes. `DmlEngine.defaults()` sets an absent Checkbox to `false` before `checkRequired`, so `nillable: false` on a Checkbox never yields `REQUIRED_FIELD_MISSING`, and v1.0 writes it on 65 of 80 Checkboxes. The remaining 8 are listed above.
4. **`report.skippedByOverride` and `report.totals.sdkOnlyCandidates/skippedDocumented/skippedSdkOnly` added** beyond the plan's report keys so the accounting closes: documented new = generated documented + skipped documented, and the skip ratio can be given on documented fields only (the plan's definition) as well as raw.
5. **`field_reference`-only fields are 1 142, not a handful.** Rule 5 is implemented as written; the number (Profile 1 022 Permissions* Checkboxes, User 46) is raised at the checkpoint because it dominates the output and the upgrade's ADD COLUMN count.
6. **09-05's synthetic MasterDetail test now targets Account, not Contact.** Its pruned object list holds only Account, so under rule 2 a Lookup to Contact would be skipped before the emit step; the refusal itself runs before the skip and is unaffected. One test fixture line and its comment changed; nothing in the assertions' meaning.
7. **[Rule 1 - Bug] `process.exit()` truncated a piped `--report` on macOS**; replaced with `process.exitCode`.
8. **typemap.ts untouched** (listed in the plan's files; no change was needed: `field_reference` type tokens all exist in TYPE_MAP).

## Notes for 09-07
- Full mode is reachable; `CLI_OPTIONS` flip + regeneration writes 35 object files and `packages/metadata/standard/PROVENANCE.json` (377 KB, mostly Profile sdk-only facts) through the existing `writeOrCheck`.
- `--check` compares only `objects/`; add `PROVENANCE.json` to the drift check when it becomes committed output.
- The diff gate (09-05) should return `[]` on the full output: v1.0 fields are byte-identical by test; verify once regenerated.
- Research Pitfall 2 (upgrade test forbids ADD COLUMN) now means ~1 860 ADD COLUMN statements, 1 022 on `profile`.

## Requirements
Frontmatter lists BASE2-02, BASE2-03, MIGR-03. None ticked here (project rule): BASE2-02/BASE2-03 become true when 09-07 lands the regenerated baseline; MIGR-03 was ticked by 09-05.

## Known Stubs
None.

## Self-Check: PASSED
Files (pipeline.ts, sources.ts, generate.ts, overrides.json, baseline-generator.test.ts, baseline-gate.test.ts, this SUMMARY) and commits c7d5d63, 1df16ee exist; `git ls-files` holds no PDF; `packages/metadata/standard` and `scripts/gen-baseline/source` are unchanged.
