# Phase 3: Thin Standard-Object Baselines - Research

**Researched:** 2026-10-08
**Domain:** Salesforce standard-object metadata (public Object Reference), baseline JSON authoring, DML object-flag enforcement, bootstrap seeding, describe fidelity for jsforce / simple-salesforce
**Confidence:** MEDIUM overall. HIGH on codebase facts, flags and error code; MEDIUM on prefixes; LOW on five name-field / owner facts that no public source settles (listed as checkpoints).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Field surface per thin object**
- **D-01:** Strict minimum per object: `Id`, the documented name-equivalent field, the system fields (`CreatedDate`, `CreatedById`, `LastModifiedDate`, `LastModifiedById`, `SystemModstamp`, `IsDeleted` as the existing `systemFields()` helper produces them) and `OwnerId` only where the Object Reference documents the object as owned. No documented lookups (`Entitlement.AccountId`, `ServiceContract.AccountId`, ...) and no business fields. Full parity is HEAD-06 in v2.
- **D-02:** The name-equivalent field follows the Object Reference exactly: `nameField: true` on the field the reference designates (`Name`, `MasterLabel`, `DeveloperName`, `AppointmentNumber`, ...). An object the reference gives no name-equivalent field (OpportunityHistory is the known case) gets none, describe reflects that, and the built-in object browser falls back to `Id`. No synthetic `Name` fields.
- **D-03:** Every key prefix, name-equivalent field and `Supported Calls` set is verified in research against at least two independent public sources (the Object Reference plus one other). Anything that cannot be confirmed (today: IdeaTheme's prefix `0Bg` is single-source; the name fields of DandBCompany, Entitlement, ServiceContract, SocialPost, IdeaTheme are unconfirmed) is raised to Johan as a checkpoint before the JSON is written. Nothing is guessed. Johan may answer such a checkpoint from his own org's describe if he chooses; orglet itself never contacts Salesforce.
- **D-04:** Flags are written explicitly per object in each JSON (`createable`, `updateable`, `deletable`, `undeletable` where relevant), in the style of the existing baselines. No generic `thin: true` switch that defaults flags to false (the research's proposal); the Object Reference's `Supported Calls` is the source of truth per object. Where it contradicts the "the rest full CRUD" summary in REQUIREMENTS/ROADMAP (research indicates BusinessHours and BusinessProcess have no `delete()`), the Object Reference wins and the REQUIREMENTS/ROADMAP wording is corrected in this phase.

**Seed rows at bootstrap**
- **D-05:** `bootstrapOrg` seeds one `BusinessHours` row (`Name` "Default", `IsDefault` true, `IsActive` true) and one `UserLicense` row (`MasterLabel` "Salesforce") and points the System Administrator `Profile.UserLicenseId` at it. This mirrors a real org, where both always exist, and is the only way a read-only object ever gets rows in normal mode.
- **D-06:** Seeding is idempotent per `up`: a row is created only if missing (BusinessHours by `IsDefault`, UserLicense by `MasterLabel`), existing rows are never modified, and `Profile.UserLicenseId` is set only when it is null. Same pattern as Organization/User today. Johan's devrandom org therefore gains the two rows on its next `up`.
- **D-07:** The seed rows are the one explicit exception to D-01: BusinessHours carries `IsDefault` and `IsActive`, UserLicense carries `MasterLabel` (its name field anyway), and the existing `Profile.UserLicenseId` lookup becomes a real, checked reference to UserLicense.

**Write protection and import mode**
- **D-08:** Object-level flags are bypassed in import mode (`orglet up --import`), exactly as field-level flags, lookup checks, rules and hooks already are. This is the only way to migrate OpportunityHistory, UserLicense, ExternalDataSource or CallCenter rows from a real org. Normal mode keeps rejecting, as `DmlEngine.insert/update/delete` do today.
- **D-09:** The error code for a normal-mode DML that violates an object flag is verified by research against Salesforce documentation. Today the engine returns `invalidOperation` ("entity type X does not support insert"); keep it only if it matches the documented code for that operation, otherwise switch to the documented one (candidates seen in the wild: `INVALID_TYPE_FOR_OPERATION`, `CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY`). No invented codes; add to `Errors` in `packages/engine/src/errors.ts` if new.

**Describe verification through the SDKs (BASE-04)**
- **D-10:** A vitest asserts, for all 14 objects, the describe properties the SDKs read in both global describe and per-object describe: `keyPrefix`, `name`, `nameField` on exactly one field or on none per D-02, `urls` (`sobject`, `describe`, `rowTemplate`), `fields[]` with the system fields present, `childRelationships[]` (which, after this phase, lists the baseline and custom lookups that point at the object).
- **D-11:** A reusable script under `conformance/` (working name `conformance/describe-check`, one entry per SDK: a Node script for `jsforce`, a Python script for `simple-salesforce`, sharing an object list) runs `describe()` for a list of objects against a running orglet and fails on any error or missing property. The phase's last plan runs it for the 14 objects and records the output. The full conformance suites are not re-run here (phase 7).

### Claude's Discretion
- JSON file layout details beyond the existing baseline conventions (field order, labels, `length` values for text fields).
- How `bootstrapOrg` discovers the existing default BusinessHours / UserLicense rows (query pattern) and where the seed constants live.
- Whether the import-mode bypass is implemented as one check in `DmlEngine` or per operation; test placement in `engine.test.ts`.
- The exact name and interface of the describe-check script, and whether `conformance/*/README.md` gain a short section for it now or in phase 7.
- Whether to update `.planning/codebase/` documents (ARCHITECTURE/STRUCTURE) for the 14 new files.

### Deferred Ideas (OUT OF SCOPE)
- Full field sets for the 14 objects (HEAD-06, v2).
- Documented lookups on the thin objects (Entitlement.AccountId, ServiceContract.AccountId, SocialPost.ParentId, ServiceAppointment.ParentRecordId): revisit with HEAD-06 or when phase 4 needs a polymorphic fixture.
- A generic `thin` flag in `StandardObjectJson` (research proposal): not needed with explicit flags; reconsider only if many more thin objects arrive.
- Running the describe-check script in CI: conformance stays manual until phase 7 decides.
- (Reviewed todo, not folded) "Reword ROADMAP phase 7 to validate against the DE retrieve, not the org".
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BASE-01 | 14 objects exist with documented prefix, Id, name-equivalent field, system fields | §Fact Table (prefix, name field, owner, system fields per object); §Architecture Pattern 1 (JSON template, `loadBaseline` auto-discovery, `systemFields()` behaviour) |
| BASE-02 | Lookups to the 14 are reference-checked (`INVALID_CROSS_REFERENCE_KEY`) | §Codebase Q2 (18 existing baseline lookups become checked, list), `checkReferences` needs no change; §Pitfall 1 (existing-data FK upgrade) |
| BASE-03 | createable/updateable/deletable exactly as documented; violations rejected with the Salesforce code | §Fact Table flags (14/14 confirmed across two Object Reference editions); §D-09 answer (`INVALID_TYPE_FOR_OPERATION`); §Pattern 3 (engine change incl. missing `upsert`/`undelete` guards); §REQUIREMENTS wording fix |
| BASE-04 | Describe for a thin object contains what jsforce and simple-salesforce read | §Codebase Q6 (SDK source: both treat describe as pass-through; exact key sets from jsforce typings; one missing key `idEnabled`); §Pattern 6 (describe-check script) |
| BASE-05 | DE retrieve loads with zero `UNSUPPORTED:reference-target` warnings | §Codebase Q8 (all 14 warnings come from the baseline itself; acme and the DE retrieve both print exactly the same 14; existing test at `build.test.ts:157` must be rewritten) |
</phase_requirements>

## Summary

The phase is mostly data entry plus three small code changes, and the risk sits in the data, not the code. Fourteen JSON files dropped into `packages/metadata/standard/objects/` are auto-loaded by `loadBaseline()`; every one of the 14 `UNSUPPORTED:reference-target` warnings that `check` prints today (identical for `examples/acme` and for Johan's DE retrieve) disappears the moment the objects exist, because the dangling references live in the existing baseline JSON (Case, Account, Lead, Contact, User, Profile, Opportunity, Event, Product2, RecordType), not in the DE retrieve. The DE retrieve itself has exactly one custom `referenceTo`, to `ObjectBackup__c`, none of the 14.

Verification against public sources was possible far beyond what the milestone research reached. The full Object Reference PDF (v68.0, Oct 2 2026) and the Winter '23 edition are publicly downloadable (`resources.docs.salesforce.com`), so `Supported Calls` and field property tables were read directly rather than via the 403-blocked HTML pages. The jsforce repo (already cloned in `conformance/jsforce/.cache/jsforce`) contains `src/types/standard-schema.ts`, generated from a real schema, which independently confirms owner and audit fields for 10 of the 14 objects. Result: key prefixes 13/14 confirmed (IdeaTheme `0Bg` single-source), flags 14/14 confirmed (two editions of the one public source; BusinessHours and BusinessProcess really have no `delete()`), name fields only partly: the Object Reference marks a name field explicitly (`Namefield`) in just 5 places in the whole 6,400-page document, so for most objects "the field the reference designates" has to be inferred from `idLookup` plus naming, and five objects stay unresolved (checkpoint list below). One finding contradicts a locked decision's premise: the reference lists `UserLicense.Name` (idLookup) as well as `MasterLabel`, while D-05/D-07 call `MasterLabel` its name field.

D-09: the documented StatusCode for "sObject type invalid for this operation" is `INVALID_TYPE_FOR_OPERATION` (SOAP API Developer Guide, StatusCode table); `INVALID_OPERATION`, which the engine emits today, is documented only for "record locked by an approval process". Recommend switching. Also found while reading the engine: `upsert()` and `undelete()` have no object-flag check at all, so a read-only object could still be written through upsert; BASE-03 needs those closed too.

**Primary recommendation:** Run one human checkpoint with Johan (5 questions, copy-paste `sf sobject describe` commands in §Checkpoint) before writing any JSON; then author the 14 files from the Fact Table, add `Errors.invalidTypeForOperation` + object-flag guards (import-mode bypass, plus `upsert`/`undelete`), extend `bootstrapOrg` with the two seed rows, and write the tests in §Validation Architecture.

## Fact Table (D-03): the 14 objects

**Sources used (all public):**
- **OR68** = Object Reference for the Salesforce Platform, Version 68.0 Winter '27, last updated 2026-10-02, https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/object_reference.pdf (page numbers below are the PDF's own).
- **OR56** = same document, Version 56.0 Winter '23, https://resources.docs.salesforce.com/240/latest/en-us/sfdc/pdf/object_reference.pdf. Same publisher, so it proves stability across releases, not independence.
- **JFS** = jsforce `src/types/standard-schema.ts` @ commit 9bae14e (repo cloned at `conformance/jsforce/.cache/jsforce`; https://github.com/jsforce/jsforce/blob/main/src/types/standard-schema.ts). Generated from a real schema by the jsforce maintainers; lists fields per standard object. Absent for DandBCompany, IdeaTheme, OperatingHours, ServiceAppointment.
- **FOP** = Fish of Prey "Obscure Salesforce object key prefixes", http://www.fishofprey.com/2011/09/obscure-salesforce-object-key-prefixes.html (updated for Spring '21; the milestone research's source).
- **AEG** = Aegis Softworks prefix list, https://aegissoftworks.com/tools/sfid_prefix_list.php. **APX** = https://www.apexhours.com/salesforce-object-key-prefix/ (same data on https://dineshyadav.com/salesforce-objects-key-prefix/, treated as one source). **SYN** = https://gist.github.com/Synchro/2c6186203c15dc2bd14bd2c7f6396583 (derived from FOP, not independent).
- **SAD** = public describe dump "SObject Describe - ServiceAppointment", https://gist.github.com/jverce/62e8aed7b56aab8e3a3bcd6eaba7f612 (a third-party's published output; used only to corroborate ServiceAppointment, never to copy fields).
- **SOAP68** = SOAP API Developer Guide v68.0, https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/apex_api.pdf (definition of `nameField`, StatusCode table).

No Salesforce documentation page publishes a prefix table; prefixes can only be cross-checked between community lists and, for ServiceAppointment, a real describe.

### Prefix and flags (all objects)

`create/update/delete/undelete` map from `Supported Calls` (`create()`, `update()`, `delete()`, `undelete()`). `search` maps to the `searchable` flag (`search()` listed or not).

| Object | Prefix | Prefix sources | Status | create / update / delete / undelete | `searchable` | Calls evidence (OR68 page; OR56 identical) | Status |
|---|---|---|---|---|---|---|---|
| BusinessHours | `01m` | FOP, AEG, SYN | CONFIRMED | T / T / **F** / **F** | T | p.1029: create, describeLayout, describeSObjects, getDeleted, getUpdated, query, retrieve, search, update, upsert | CONFIRMED |
| BusinessProcess | `019` | FOP, AEG, SYN | CONFIRMED | T / T / **F** / **F** | F | p.1033: create, describeSObjects, getDeleted, getUpdated, query, retrieve, update, upsert | CONFIRMED |
| CallCenter | `04v` | FOP, AEG, SYN | CONFIRMED | T / **F** / **F** / **F** | F | p.1082: create, describeSObjects, getDeleted, getUpdated, query, retrieve | CONFIRMED |
| DandBCompany | `06E` | FOP, AEG, SYN | CONFIRMED | T / T / T / T | T | p.1727: create, delete, describeLayout, describeSObjects, getDeleted, getUpdated, query, retrieve, search, undelete, update, upsert | CONFIRMED |
| Entitlement | `550` | FOP, AEG, APX | CONFIRMED | T / T / T / T | T | p.2159: create, delete, describeLayout, getDeleted, getUpdated, query, retrieve, search, undelete, update, upsert | CONFIRMED |
| ExternalDataSource | `0XC` | FOP, AEG, APX | CONFIRMED | **F / F / F / F** | F | p.2607: describeSObjects, query, retrieve | CONFIRMED |
| IdeaTheme | `0Bg` | FOP only (AEG, APX, SYN do not list it) | **SINGLE-SOURCE** | T / T / T / T | T | p.3065: create, delete, describeLayout, query, retrieve, search, undelete, update, (list is truncated at a trailing comma in both editions; `upsert()` unknowable but irrelevant to the four flags) | CONFIRMED for the four flags |
| Individual | `0PK` | FOP, APX, AEG | CONFIRMED | T / T / T / T | T | p.3084: create, delete, describeLayout, describeSObjects, getDeleted, getUpdated, merge, query, retrieve, search, undelete, update, upsert | CONFIRMED |
| OperatingHours | `0OH` | FOP, APX | CONFIRMED | T / T / T / T | T | p.3777: create, delete, describeLayout, describeSObjects, getDeleted, getUpdated, query, retrieve, search, undelete, update, upsert | CONFIRMED |
| OpportunityHistory | `008` | FOP, AEG, SYN | CONFIRMED | **F / F / F / F** | F | p.3807: describeSObjects, getDeleted, getUpdated, query, retrieve. OR56 adds "You can also enable delete() in API version 42.0 and later" (org-setting opt-in, not default; the v68 text no longer says it); keep `deletable:false` per D-04 | CONFIRMED |
| ServiceAppointment | `08p` | FOP + **SAD (`keyPrefix: "08p"` in a real describe)** | CONFIRMED | T / T / T / T | T | p.5072: create, delete, describeLayout, describeSObjects, getDeleted, getUpdated, query, retrieve, search, undelete, update, upsert; SAD: createable/updateable/deletable/undeletable all `true` | CONFIRMED (3 sources) |
| ServiceContract | `810` | FOP, AEG, APX | CONFIRMED | T / T / T / T | T | p.5093: same full list as ServiceAppointment | CONFIRMED |
| SocialPost | `0ST` | FOP, AEG, APX | CONFIRMED | T / T / T / T | T | p.5359: same full list | CONFIRMED |
| UserLicense | `100` | FOP, AEG, APX | CONFIRMED | **F / F / F / F** | F | p.5911: describeSObjects, query, retrieve | CONFIRMED |

Case-sensitivity check run against the 21 existing baseline prefixes: no exact duplicate, no case-insensitive clash except the pre-existing Profile `00e` / UserRole `00E`; none of the 14 starts with `a`/`A`, so custom `a00..azz` assignments (Phase 2) cannot collide. Note `01m`/`01M` and `04v`/`04V` are different entities in Salesforce (case-sensitive 15-char prefixes); prefix comparison in orglet is exact-string (`Map`, `===`), which is correct.

### Name field, ownership and system fields

"Reference designates" is thin evidence: OR68 contains the property `Namefield` only 5 times (ContentNote.Title, ContentWorkspacePermission.Name, IdeaTheme.Title, MessagingTemplate.Name, OrderOwnerSharingRule.Name). Elsewhere the best signal is `idLookup` on a `Name`-like field plus SOAP68's definition ("the name field for standard objects (such as AccountName ...); limited to one per object, except FirstName/LastName; if a compound name is present, nameField is set to true for it"). Statuses: **CONFIRMED** = two independent public sources agree, **CONVENTION** = field and `idLookup` confirmed, `nameField` flag inferred by the SOAP68 rule, **SINGLE-SOURCE**, **UNCONFIRMED**.

| Object | Name-equivalent field (proposal) | Evidence | Status | Owned (`hasOwner`) | Owner evidence | Notes |
|---|---|---|---|---|---|---|
| BusinessHours | `Name` (Text, idLookup, required) | OR68 p.1030 `Name: Create, Filter, Group, idLookup, Sort, Update`; JFS has `Name` | CONVENTION | false | OR68 no OwnerId; JFS none | JFS: no `IsDeleted` |
| BusinessProcess | `Name` (Text 80, idLookup, required) | OR68 p.1034 `Name ... idLookup`, "Limit: 80 characters"; JFS has `Name` | CONVENTION | false | OR68 / JFS none | JFS: no `IsDeleted` |
| CallCenter | `Name` (Text, idLookup, required, **createable true / updateable false**) | OR68 `Name: Create, Filter, Group, idLookup, Sort` (no Update); JFS has `Name` | CONVENTION | false | OR68 / JFS none | JFS: no `IsDeleted`. Field-level `updateable:false` mirrors the object having no `update()` |
| DandBCompany | `Name` (Text, required, **not** idLookup) | OR68 p.1727+ `Name: Create, Filter, Group, Sort, Update` (no `Nillable`, no idLookup). JFS: object absent | **UNCONFIRMED** (flag) | false | OR68 lists no OwnerId in 108 fields; JFS absent | single source for ownership |
| Entitlement | `Name` (Text, required, not idLookup; Filter/Create/Update only: not groupable, not sortable) | OR68 p.2160 `Name: Create, Filter, Update`; JFS has `Name` | **UNCONFIRMED** (flag) | false | OR68 no OwnerId; JFS no OwnerId | JFS has `IsDeleted` |
| ExternalDataSource | **either `DeveloperName` or `MasterLabel`**; the reference has no `Name` field | OR68 p.2608-2609: both `string`, `Filter, Group, Sort`, neither idLookup nor Namefield; JFS has `DeveloperName`, `MasterLabel`, no `Name` | **UNCONFIRMED** (which one) | false | OR68 / JFS none | milestone FEATURES.md guessed `DeveloperName` (LOW) |
| IdeaTheme | `Title` (Text, required, idLookup, **Namefield**) | OR68 p.3066 `Title: Create, Filter, Group, idLookup, Namefield, Sort, Update`. JFS: object absent | **SINGLE-SOURCE** (explicit, one doc) | false | OR68 lists no OwnerId; JFS absent | No `Name` field exists, so a synthetic one would be wrong (D-02) |
| Individual | `Name` (type `Name`, compound, read-only, nameField) plus `FirstName`, `LastName` (required) with `compoundFieldName: "Name"` | OR68 p.3084+ `Name: Filter, Group, Sort`, `LastName` required, `FirstName` nillable; JFS has `Name`, `FirstName`, `LastName`; SOAP68 compound-name rule. Follows `User.json` / `Lead.json` precedent | CONFIRMED (by rule + two docs) | **true** | OR68 `OwnerId`; JFS `OwnerId` | needs the two component fields, otherwise `Name` has nothing to compute from; see Open Question 3 |
| OperatingHours | `Name` (Text, idLookup, required) | OR68 p.3777 `Name ... idLookup`. JFS absent | **SINGLE-SOURCE** | **true** (v68) | OR68 lists `OwnerId`; **OR56 does not** (field added later); JFS absent | ownership CONFLICT across editions; checkpoint |
| OpportunityHistory | **none** | OR68 p.3807: 10 fields, no `Name`; JFS: 12 fields, no `Name` | CONFIRMED (none) | false | OR68 / JFS none | JFS: has `IsDeleted`, `CreatedById`, `CreatedDate`, `SystemModstamp`; **lacks `LastModifiedDate`/`LastModifiedById`** |
| ServiceAppointment | `AppointmentNumber` (AutoNumber, read-only, idLookup, nameField) | OR68 p.5072+ `AppointmentNumber: Autonumber, Defaulted on create, Filter, idLookup, Sort`; **SAD: `nameField: true`, `autoNumber: true`, `idLookup: true`, `createable: false`, `nillable: false`, length 255** | CONFIRMED | **true** | OR68 `OwnerId`; SAD `OwnerId` `createable/updateable true` | format string not documented; use `{00000000}` like `Case.CaseNumber` (discretion). SAD has `IsDeleted` |
| ServiceContract | `Name` (Text, required, not idLookup) | OR68 p.5093+ `Name: Create, Filter, Group, Sort, Update`; JFS has `Name`; also `ContractNumber` (Autonumber, no idLookup, not a candidate) | **UNCONFIRMED** (flag) | **true** | OR68 `OwnerId`; JFS `OwnerId` | JFS has `IsDeleted`. Skip `ContractNumber` (D-01) |
| SocialPost | `Name` (Text, idLookup, required) | OR68 p.5359+ `Name: Create, Filter, Group, idLookup, Sort, Update`; JFS has `Name` | CONVENTION | **true** | OR68 `OwnerId`; JFS `OwnerId` | JFS has `IsDeleted` |
| UserLicense | **`Name` (idLookup, "internal name") per the reference; D-05/D-07 say `MasterLabel`** | OR68 p.5913 `Name: Filter, Group, idLookup, Sort`; `MasterLabel: Filter, Group, Sort` ("The user license label", API 32+); JFS has both | **CONFLICT with D-05/D-07** | false | OR68 none; JFS none | JFS lacks `IsDeleted`, `CreatedById`, `LastModifiedById` (has `CreatedDate`, `LastModifiedDate`, `SystemModstamp`) |

### System-field divergence (accepted, document it)

`systemFields(hasOwner)` always emits `Id, IsDeleted, CreatedDate, CreatedById, LastModifiedDate, LastModifiedById, SystemModstamp` (+ `OwnerId`), and the SOQL compiler, `Store.loadByIds/findByField/childrenOf/setDeleted` and the DDL (`SYSTEM_NOT_NULL`) all hard-code the `isdeleted` and audit columns (`store.ts:32,41,49,86,95`, `soql/compile.ts:197,348,509`, `columns.ts:92`). So the engine cannot omit them per object, and D-01 already locks `systemFields()` as is. Consequence: describe for BusinessHours, BusinessProcess, CallCenter and UserLicense shows an `IsDeleted` that the real object lacks, UserLicense additionally shows `CreatedById`/`LastModifiedById`, and OpportunityHistory shows `LastModifiedDate`/`LastModifiedById`. All are extra fields (never missing ones), so no SDK breaks. Record it in the SUMMARY as a known divergence; do not build per-object omission (OR68 p.12 itself says "Not all standard objects have all audit fields").

### Status summary

| Fact class | CONFIRMED | CONVENTION | SINGLE-SOURCE | UNCONFIRMED / CONFLICT |
|---|---|---|---|---|
| Key prefix (14) | 13 | 0 | 1 (IdeaTheme `0Bg`) | 0 |
| Flags / Supported Calls (14) | 14 (two editions of the one public source; ServiceAppointment also by describe) | 0 | 0 | 0 |
| Name field (14) | 3 (OpportunityHistory none, Individual, ServiceAppointment) | 4 (BusinessHours, BusinessProcess, CallCenter, SocialPost) | 2 (IdeaTheme `Title`, OperatingHours `Name`) | 5 (DandBCompany, Entitlement, ServiceContract: `nameField` flag; ExternalDataSource: which field; UserLicense: `Name` vs `MasterLabel`) |
| Ownership (14) | 11 (BusinessHours, BusinessProcess, CallCenter, Entitlement, ExternalDataSource, Individual, OpportunityHistory, ServiceAppointment, ServiceContract, SocialPost, UserLicense) | 0 | 2 (DandBCompany, IdeaTheme: unowned per OR only) | 1 (OperatingHours: OR68 owned, OR56 unowned) |

### Checkpoint to raise with Johan before the JSON is written (D-03)

Five questions. Johan may answer from his own org (his choice; orglet never connects). He can run, per object, a read-only command in his org and paste the small result:

```bash
sf sobject describe --sobject IdeaTheme --json | jq '{keyPrefix, createable, updateable, deletable, undeletable, searchable, nameFields: [.result.fields[]|select(.nameField)|.name], owned: ([.result.fields[].name]|index("OwnerId")!=null)}'
```
(For `sf` output the describe sits under `.result`; drop `.result` for a raw REST describe.)

1. **IdeaTheme prefix `0Bg`** (single-source) and name field `Title` (single doc).
2. **nameField flag** on `Name` for DandBCompany, Entitlement, ServiceContract (field exists, flag not explicit anywhere).
3. **ExternalDataSource**: `DeveloperName` or `MasterLabel`?
4. **UserLicense**: `Name` (reference) or `MasterLabel` (D-05/D-07) as the name field; if `Name`, the JSON carries `Name` (nameField, idLookup) and `MasterLabel`, and the seed row sets both to "Salesforce" while D-06 still keys idempotency on `MasterLabel`.
5. **OperatingHours** `OwnerId` (OR68 yes, OR56 no) and `Name` as name field.

If Johan declines a question, the safe defaults are: `0Bg` is kept but flagged `UNVERIFIED` in the JSON-adjacent SUMMARY; `Name` for the three `Name`-without-idLookup objects; **no safe default for ExternalDataSource** (raise it again rather than guess); UserLicense follows the reference (`Name`) because D-02 says the reference wins; OperatingHours owned (current edition).

### Required wording fix (D-04)

`REQUIREMENTS.md` BASE-03 currently reads "(ExternalDataSource, OpportunityHistory and UserLicense read-only; CallCenter create-only; the rest full CRUD)". Replace with: "(ExternalDataSource, OpportunityHistory and UserLicense read-only; CallCenter create-only; BusinessHours and BusinessProcess create/update only, no delete; the rest full CRUD)". Apply the same correction wherever ROADMAP.md Phase 3 repeats the sentence (grep for `full CRUD`).

## Standard Stack

No new dependencies. Everything is already in the workspace.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@orglet/metadata` | workspace | `StandardObjectJson` baseline files, `loadBaseline`, `buildOrgSchema` | Existing; the 14 files need no loader change |
| `@orglet/engine` | workspace | `DmlEngine` guards, `Errors`, `bootstrapOrg` | Existing |
| vitest | 3.2.7 (installed) | all new tests; `vi.spyOn(console, ...)` for the CLI test | Project test runner |
| `@electric-sql/pglite` + `pglite-socket` | 0.5.8 / 0.2.11 | embedded DB through `openTestDb()` | Phase 1 decision |

### Supporting (conformance only, outside the workspace and CI)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| jsforce | 3.10.26 (`conformance/jsforce/.cache/jsforce`, gitignored, built by `run.sh`) | Node leg of describe-check | Manual run, Node 22 required (`nvm use 22`; the default node here fails to load undici) |
| simple-salesforce | 1.12.10 (listed in the old `conformance/python/.venv`) | Python leg of describe-check | Manual run; see Environment Availability: the venv is x86_64 and unusable on this arm64 machine |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Explicit per-object flags in JSON | generic `thin` switch | Rejected by D-04 |
| `INVALID_OPERATION` (today) | `INVALID_TYPE_FOR_OPERATION` | See D-09 answer: the latter is the documented match |

**Installation:** none. **Version verification:** vitest 3.2.7 ran green on 2026-10-08 (`packages/metadata`, `packages/cli`: 24 tests; `engine.test.ts`: 14 tests on pglite, 1.9 s).

## Architecture Patterns

### Recommended change set
```
packages/metadata/standard/objects/   +14 JSON files (BusinessHours.json ... UserLicense.json)
packages/metadata/src/build.test.ts   CHANGE: 3 existing tests (see Pitfall 2) + new table-driven test
packages/engine/src/errors.ts         +Errors.invalidTypeForOperation
packages/engine/src/engine.ts         object-flag guards: import-mode bypass, +upsert, +undelete
packages/engine/src/bootstrap.ts      +2 seed rows, +Profile.UserLicenseId link, header comment
packages/engine/src/engine.test.ts    +flag/ref/import tests ; (or new bootstrap.test.ts)
packages/api/src/describe.ts          optional: +idEnabled (see Q6)
packages/api/src/api.test.ts          +describe shape for 14, +REST write-protection
packages/cli/src/main.test.ts         +zero reference-target warnings on acme
packages/schema/src/prefixes.test.ts  +standard-prefix interplay
conformance/describe-check/           NEW: objects.txt, jsforce.mjs, sf_describe.py, README.md
.planning/REQUIREMENTS.md, ROADMAP.md wording fix (D-04)
```

### Pattern 1: Thin object JSON (template, `StandardObjectJson`)
**What:** Allowed keys, verified in `packages/metadata/src/types.ts:210-223`: object `name, label, labelPlural, keyPrefix, createable?, updateable?, deletable?, undeletable?, queryable?, searchable?, hasOwner, fields[]`; each flag defaults to `true` in `fromStandardObject` (`build.ts:197-215`). `Id`, `IsDeleted` and the audit fields (plus `OwnerId` when `hasOwner`) are added by `systemFields(hasOwner)` and must NOT be repeated in `fields` (the existing test "adds system fields once" fails on duplicates). Checkbox fields force `nillable:false`, `defaultedOnCreate`, default `false`; `AutoNumber` becomes read-only.
**Example (BusinessHours, with D-07 seed fields):**
```json
{
  "name": "BusinessHours",
  "label": "Business Hours",
  "labelPlural": "Business Hours",
  "keyPrefix": "01m",
  "hasOwner": false,
  "deletable": false,
  "undeletable": false,
  "fields": [
    { "name": "Name", "label": "Name", "type": "Text", "length": 80, "nillable": false, "idLookup": true, "nameField": true },
    { "name": "IsActive", "label": "Active", "type": "Checkbox" },
    { "name": "IsDefault", "label": "Default Business Hours", "type": "Checkbox" }
  ]
}
```
Per-object field lists (D-01 strict minimum + D-07):
- BusinessHours: as above. BusinessProcess: `Name` (80). CallCenter: `Name` with `"updateable": false`; object `"updateable": false`.
- DandBCompany: `Name` (required, no idLookup). Entitlement: `Name` (required, `"groupable": false, "sortable": false`).
- ExternalDataSource: the checkpointed field only, `"nillable": false`, **no** createable/updateable concerns (object flags are all false). IdeaTheme: `Title` (idLookup, nameField, required).
- Individual: `Name` (`"type": "Name"`, `createable/updateable: false`, nameField), `FirstName` (Text 40), `LastName` (Text 80, required), both `"compoundFieldName": "Name"`, `hasOwner: true`. Copy the shape of `User.json` lines 12-14.
- OperatingHours: `Name`. OpportunityHistory: **empty `fields: []`** (loader copes; system fields only). ServiceAppointment: `AppointmentNumber` (`AutoNumber`, `displayFormat "{00000000}"`, nameField, idLookup, `defaultedOnCreate`; copy `Case.json` line 10), `hasOwner: true`.
- ServiceContract: `Name`, `hasOwner: true`. SocialPost: `Name` (idLookup), `hasOwner: true`. UserLicense: per checkpoint (`Name` and/or `MasterLabel`, required), all four flags false.
- `searchable: false` for BusinessProcess, CallCenter, ExternalDataSource, OpportunityHistory, UserLicense (no `search()` in Supported Calls); `queryable` stays true for all 14.
- Labels/lengths are discretion; use the labels from the Fact Table order and 80 for `Name` unless a table above says otherwise (255 for IdeaTheme `Title` and DandBCompany `Name` is equally fine; the reference gives none).

### Pattern 2: Existing lookups become checked references (verified by script over the baseline JSON)
These 18 existing fields already declare `referenceTo` to the 14, so they turn into FK columns (single-target only, `ddl.ts:46-50`), `checkReferences` targets and `childRelationships` entries; no code change needed:

| Target | Referencing baseline fields |
|---|---|
| BusinessHours | Case.BusinessHoursId |
| BusinessProcess | RecordType.BusinessProcessId |
| CallCenter | User.CallCenterId |
| DandBCompany | Account.DandbCompanyId, Lead.DandbCompanyId |
| Entitlement | Case.EntitlementId |
| ExternalDataSource | Product2.ExternalDataSourceId |
| IdeaTheme | User.WorkspaceId |
| Individual | Contact.IndividualId, Lead.IndividualId, User.IndividualId |
| OperatingHours | Account.OperatingHoursId |
| OpportunityHistory | Opportunity.LastAmountChangedHistoryId, Opportunity.LastCloseDateChangedHistoryId |
| ServiceAppointment | Event.ServiceAppointmentId (createable false) |
| ServiceContract | Case.ServiceContractId |
| SocialPost | Case.SourceId |
| UserLicense | Profile.UserLicenseId (only one with `childRelationshipName`: "Profiles") |

Johan's DE retrieve: the only `<referenceTo>` in all of `~/Development.nosync/devrandom-metadata` is `ObjectBackup__c`; none of the 14. So BASE-05 and the 14 warnings are entirely a baseline matter.

Only `Profile.UserLicenseId` has a `childRelationshipName`; the others describe as `relationshipName: null` in `childRelationships` (pre-existing behaviour for every baseline lookup; real Salesforce names them, e.g. `Cases`). Optional, low value: add `childRelationshipName` to these 18 fields. Not needed for BASE-04.

### Pattern 3: Object-flag guards (D-08, D-09, plus the two missing guards)
**Current code (verified):** `engine.ts:95,105,158` check `!obj.createable|updateable|deletable` and return `Errors.invalidOperation("entity type X does not support insert|update|delete")` for every input. `upsert()` (`engine.ts:112`) and `undelete()` (`:166`) have **no** object-flag check: `upsert` on UserLicense would reach `saveBatch(... "insert")` and write; `undelete` ignores `undeletable`. `importMode` is `this.importMode` (readonly, set in the constructor, `:66,77`).
**Minimal change (one private helper, four call sites):**
```typescript
// packages/engine/src/errors.ts (add to Errors)
invalidTypeForOperation: (message: string) => saveError("INVALID_TYPE_FOR_OPERATION", message),

// packages/engine/src/engine.ts
/** Normal mode only: import mode bypasses object-level flags like it does field-level ones (coerce.ts). */
private refuse(obj: SObjectDef, operation: "insert" | "update" | "delete" | "undelete"): SaveError | undefined {
  if (this.importMode) return undefined;
  const allowed = { insert: obj.createable, update: obj.updateable, delete: obj.deletable, undelete: obj.undeletable }[operation];
  return allowed ? undefined : Errors.invalidTypeForOperation(`entity type ${obj.name} does not support ${operation}`);
}
// insert:  const refused = this.refuse(obj, "insert");  if (refused) return inputs.map(() => failure([refused]));
// upsert:  refused when !(createable && updateable) (upsert needs both; CallCenter lists neither update nor upsert)
// undelete: refuse(obj, "undelete")
```
Keep `Errors.invalidOperation` for the "not in the recycle bin" case (`engine.ts:173`); out of scope. Do not mutate shared `SaveError` objects across results if any caller mutates them (create one per result: `inputs.map(() => failure([Errors.invalidTypeForOperation(...)]))`).
**Where it surfaces:** REST `POST/PATCH/DELETE /sobjects/...`, collections, composite and Bulk 2.0 all call these engine methods; `statusFor` (`routes/sobjects.ts:16`) maps unknown codes to HTTP 400, which stays.

### Pattern 4: Seed rows in `bootstrapOrg` (D-05..D-07)
**Verified structure (`bootstrap.ts`):** one `withTransaction`; first-run branch builds `system = { IsDeleted:false, CreatedDate: now, CreatedById: userId, LastModifiedDate: now, LastModifiedById: userId, SystemModstamp: now }` inside the `else` (so it is not in scope for the existing-org branch; the RecordType loop re-lists the fields inline with `session.userId`). User row is inserted first; all FKs are `DEFERRABLE INITIALLY DEFERRED` (`ddl.ts:96`), so insert order among seed rows is free. Column names are lower-cased field names (`columnName`).
**Recommended shape:** after `session` is known (both branches) and before the RecordType loop:
```typescript
const SEED_BUSINESS_HOURS = "Default";
const SEED_USER_LICENSE = "Salesforce";
// stamp built from session.userId once, reused by every seed insert
const stamp = { IsDeleted: false, CreatedDate: now, CreatedById: session.userId, LastModifiedDate: now, LastModifiedById: session.userId, SystemModstamp: now };

const bh = await client.query<{ id: string }>(`SELECT "id" FROM ${store.table(businessHours)} WHERE "isdefault" = true AND "isdeleted" = false LIMIT 1`);
if (!bh.rows[0]) await store.insert(client, businessHours, { Id: generateId(businessHours.keyPrefix), Name: SEED_BUSINESS_HOURS, IsDefault: true, IsActive: true, ...stamp });

let licenseId = (await client.query<{ id: string }>(`SELECT "id" FROM ${store.table(userLicense)} WHERE "masterlabel" = $1 AND "isdeleted" = false LIMIT 1`, [SEED_USER_LICENSE])).rows[0]?.id;
if (!licenseId) { licenseId = generateId(userLicense.keyPrefix); await store.insert(client, userLicense, { Id: licenseId, MasterLabel: SEED_USER_LICENSE, /* + Name if checkpoint says so */ ...stamp }); }
const linked = await client.query(`SELECT "userlicenseid" FROM ${store.table(profile)} WHERE "id" = $1`, [session.profileId]);
if (linked.rows[0] && linked.rows[0].userlicenseid === null) await store.update(client, profile, session.profileId, { UserLicenseId: licenseId });
```
`need(schema, "BusinessHours")` / `need(schema, "UserLicense")` like the existing four. For a brand-new org the Profile insert can instead carry `UserLicenseId`, but a single post-step covers both branches and the upgrade case, so prefer it. Update the file header comment ("Seeds the rows every org needs ...") and, per `CONVENTIONS.md`, keep new constants module-level `UPPER_SNAKE_CASE`. `store.update` skips `undefined`, writes no audit stamps (fine for a first link). Note `Profile.UserLicenseId` is `nillable:false` in the JSON but the Store does not enforce it, which is why today's profile row has NULL.
**D-06 detail:** "BusinessHours by `IsDefault`" means skip seeding if any default exists (e.g. an imported one), never "update the existing one". A second `up` finds both rows and links, so zero writes.

### Pattern 5: `migrate()` on an existing org (acme / devrandom upgrade path; verified in `migrate.ts:109-155`)
Step 1 creates the 14 new tables; step 2 (after all tables exist) adds every missing FK with a plain `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY ... DEFERRABLE INITIALLY DEFERRED` (existing names skipped via `constraints.has`). `Profile.userlicenseid` already exists as a nullable column (`notNull` only for `SYSTEM_NOT_NULL` and checkbox/master-detail), the Profile row has NULL, so that FK is valid. The other 17 new FKs are validated against existing rows at creation: see Pitfall 1.

### Pattern 6: describe-check (D-11), layout and interface
Reuse the two existing mechanisms rather than inventing auth:
- jsforce: `run.sh` passes a bearer token (`TOKEN` from `POST /services/oauth2/token`, password grant, `username=admin@orglet.local&password=x`, any password accepted unless `--users`), harness uses `conn._establish({accessToken, instanceUrl})`. `seed.mjs` reads env `BASE_URL`, `TOKEN`, `API_VERSION` (default `v62.0`); the README starts orglet on port 8081.
- simple-salesforce: `run.py` hard-codes `BASE_URL = "http://localhost:8180"`, `USERNAME = "admin@orglet.local"`, `API_VERSION = "59.0"`, logs in with `SalesforceLogin(... scratch_url=BASE_URL)` over a tiny `HttpRewriteSession` that rewrites `https://` to `http://` (simple_salesforce always builds https URLs). `run.py` has an `if __name__ == "__main__"` guard but its class is not importable cleanly; copy the 6 lines.

Recommended files (all under `conformance/describe-check/`):
```
objects.txt          # one sObject name per line, '#' comments; the 14 names. Shared contract.
jsforce.mjs          # node jsforce.mjs [Object ...]   env BASE_URL (default http://localhost:8081), TOKEN (required), API_VERSION (default 59.0)
sf_describe.py       # python sf_describe.py [Object ...] env BASE_URL (default http://localhost:8081), USERNAME (admin@orglet.local), API_VERSION (59.0)
README.md            # how to start orglet, get the token, create the venv, expected output; states the property contract
```
- `jsforce.mjs` loads jsforce from the already-built cache: `createRequire(import.meta.url)("../jsforce/.cache/jsforce")` (verified loadable under Node 22: exports `Connection`); fail with a clear message telling the user to run `conformance/jsforce/run.sh` once if the cache is missing. It calls `conn.describeGlobal()` and `conn.sobject(name).describe()` and `conn.describe$(name)`.
- `sf_describe.py` calls `sf.describe()` (global) and `getattr(sf, name).describe()`.
- Both: exit 1 if any object throws, is missing from the global list, or lacks a required property; print one `PASS|FAIL <object> <detail>` line per object; arguments override the file list.

**Property contract (the exact set D-10's vitest and both scripts assert).** Both SDKs return the describe body unmodified (verified in source: jsforce `Connection.describe()` = `request(.../sobjects/<type>/describe)` cast to `DescribeSObjectResult`; `describeGlobal()` = `request(.../sobjects)`; the only runtime reads are `result.sobjects[].name` in the describeGlobal listener (`connection.ts` ~L463) and `describe$(type).fields[].name` in `retrieve` (`~L939`); simple-salesforce `Salesforce.describe()` / `SFType.describe()` return `parse_result_to_json(...)`). So "what the SDKs read" is, in practice, the keys of jsforce's published types (`src/types/common.ts`: `DescribeGlobalSObjectResult`, `DescribeSObjectResult`, `Field`, `ChildRelationship`). Assert:
- global `sobjects[]` entry: every key of `DescribeGlobalSObjectResult`: `activateable, createable, custom, customSetting, deepCloneable, deletable, deprecatedAndHidden, feedEnabled, hasSubtypes, idEnabled, isInterface, isSubtype, keyPrefix, label, labelPlural, layoutable, mergeable, mruEnabled, name, queryable, replicateable, retrieveable, searchable, triggerable, undeletable, updateable, urls`. **Gap found: orglet's `objectSummary` emits all of these except `idEnabled`** (pre-existing for every object). Recommend adding `idEnabled: true` to `objectSummary` in `describe.ts` (one line) so the contract test can assert the full key set; otherwise the test must exempt it and say why.
- per-object describe additionally: `actionOverrides, childRelationships, compactLayoutable, fields, listviewable, lookupLayoutable, namedLayoutInfos, networkScopeFieldName, recordTypeInfos, searchLayoutable, supportedScopes` (all present today).
- `fields[]`: every key of jsforce `Field` (all present today); `Id, IsDeleted, CreatedDate, CreatedById, LastModifiedDate, LastModifiedById, SystemModstamp` present once each; `OwnerId` present iff the fact table says owned; `nameField === true` on exactly one field, or on none for OpportunityHistory (and on `Name`/`FirstName`+`LastName` handled as the compound case: only `Name`).
- `childRelationships[]`: each entry has `childSObject, field, cascadeDelete, restrictedDelete, relationshipName, deprecatedAndHidden, junctionIdListNames, junctionReferenceTo`; for the 14 it contains the referencing fields from Pattern 2 (e.g. BusinessHours -> `{Case, BusinessHoursId}`).
- `urls`: `sobject`, `describe`, `rowTemplate` (present; also `compactLayouts, approvalLayouts, quickActions, layouts`).
- flags: `createable/updateable/deletable/undeletable/searchable` equal the Fact Table values in both global and per-object describe.

### Anti-Patterns to Avoid
- **Repeating system fields in the JSON** (duplicate-field test fails; `Id`/`IsDeleted` come from `systemFields`).
- **Synthetic `Name` fields** on IdeaTheme, ExternalDataSource, OpportunityHistory (D-02).
- **A `thin` shortcut flag** (D-04).
- **Writing seed rows through `DmlEngine`** (the engine would reject UserLicense; seeding goes through `Store` inside `bootstrapOrg`'s transaction like the existing rows).
- **Per-object omission of `IsDeleted`/audit fields**: the store and SOQL hard-code them.
- **Inventing a StatusCode**: add only `INVALID_TYPE_FOR_OPERATION`, which is in the documented enum.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Registering the 14 objects | A loader, registry or generator script | Drop JSON files in `standard/objects/` | `loadBaseline()` globs `*.json` sorted; flags default via `??` |
| Reference checking | New checks for the 14 | Existing `checkReferences` + FK from `planTable` | Works for any object present in the schema |
| Name/audit fields | Hand-written `CreatedDate` etc. | `systemFields(hasOwner)` | Single source; tests assert exactly-once |
| Compound `Individual.Name` | Computed column | `type: "Name"` + `compoundFieldName` | `applyCompoundFields` already joins `FirstName`+`LastName`; `isVirtual` skips the column |
| SDK login in describe-check | New auth | The token/`SalesforceLogin` mechanism of `seed.mjs` / `run.py` | Proven against orglet |
| Prefix collision logic | New check for the 14 | Phase 2 `planKeyPrefixes` (`standard` is built from every non-custom object) | The 14 enter it automatically |

**Key insight:** every behaviour the phase needs already exists generically; the phase supplies data, three guards and two seed rows. Resist generalising.

## Common Pitfalls

### Pitfall 1: Adding FKs fails on existing data (upgrade of acme / devrandom orgs)
**What goes wrong:** `migrate()` adds 17 new `FOREIGN KEY` constraints (Pattern 2) to existing tables. Postgres validates existing rows when a constraint is added (deferrable only delays later checks). Any row whose lookup holds a value with no target row aborts the whole migrate transaction and therefore `orglet up`. Until now these lookups were unchecked, and `up --import` loads real-org Cases/Accounts/Contacts carrying `BusinessHoursId`, `DandbCompanyId`, `IndividualId`, `EntitlementId`, ... whose targets were never imported. That is exactly the migration use case.
**Why:** `foreignKeySql` uses plain `ADD CONSTRAINT`, no `NOT VALID`.
**How to avoid (planner decision needed):** (a) read-only precheck on Johan's devrandom schema before the phase ships: `SELECT count(*) FROM <org>.<table> WHERE <col> IS NOT NULL` for each of the 17 columns (names in Pattern 2); (b) decide the policy and test it: recommended is to add FKs on tables that already hold violating rows as `NOT VALID` (new writes still checked; existing dangling values tolerated) plus an `UNSUPPORTED:schema-fk` warning naming the column, rather than failing `up`; alternative is to accept the failure and document `--force`. Add a migrate test for the chosen behaviour (Wave 0 gap in the Validation section).
**Warning signs:** `violates foreign key constraint "fk_case_businesshoursid"` at `up`.

### Pitfall 2: Three existing tests assert the old world
**What goes wrong:** (1) `build.test.ts:157-158` asserts the `UNSUPPORTED:reference-target BusinessProcess` warning exists; it fails once BusinessProcess is defined. (2) "marks exactly one name field per object" (`build.test.ts` ~L47) fails for OpportunityHistory (zero, per D-02). (3) the same test would silently pass wrong data if relaxed to `<= 1` without an allow-list.
**How to avoid:** rewrite (1) to exercise the dangling-reference mechanism with a synthetic target (build with `buildOrgSchema(baseline, {...project, objects: [... a SourceObject with a Lookup to "NoSuchObject__c" ...]})` and expect the warning for that name) plus a new BASE-05 assertion that the acme/baseline build has zero `reference-target` warnings. Change (2) to: every object has exactly one `nameField` field except an explicit `NO_NAME_FIELD = ["OpportunityHistory"]` (plus whatever the checkpoint adds), asserting that list equals the objects with none, so adding a nameless object stays a conscious act. Also `migrate.test.ts:40` counts `CREATE TABLE` statements against `schema.objects.size`; it stays green automatically.

### Pitfall 3: `upsert` and `undelete` bypass the object flags today
**What goes wrong:** BASE-03 would be met for insert/update/delete only; `PATCH /sobjects/UserLicense/Id/<x>` (upsert) or Bulk 2.0 upsert would still write a read-only object.
**How to avoid:** Pattern 3 closes both; test them explicitly (T7).

### Pitfall 4: Wrong `hasOwner` or `nameField` produces a describe that is subtly off for SDK users
**What goes wrong:** `hasOwner:true` adds a required-by-default `OwnerId`; a wrongly owned object makes inserts via REST need an owner. `nameField` on two fields (e.g. both `FirstName` and `Name` on Individual) breaks the "exactly one" invariant.
**How to avoid:** the table-driven test in T1 asserts `hasOwner` and the nameField count per object; for Individual only `Name` is nameField.

### Pitfall 5: Seed rows and import mode
**What goes wrong:** `up --import` imports the real Profile with the real `UserLicenseId` (a `100...` Id whose UserLicense row was not imported). Bootstrap only links when null (D-06), so that Profile keeps a dangling reference and a later normal-mode update of the profile is rejected by `checkReferences`.
**How to avoid:** accept (it is data the user imported), note it in the SUMMARY; do not "fix" imported rows. Import the UserLicense rows too (D-08 now permits it).

### Pitfall 6: Python leg of describe-check cannot run on this machine as is
`conformance/python/.venv` is an x86_64 Python 3.9 (`bad CPU type in executable` on this arm64 Mac), system `python3` is 3.14 without `simple_salesforce`, and `requirements.txt` pins `cryptography==43.0.3` (wheel availability on 3.14 unverified). Recreate the venv with Homebrew `python3.12` (installed) and run `pip install -r requirements.txt`; if the pin does not install, that is a Phase 7 conformance-environment problem, record it rather than widening scope. Also `podman machine` is configured but has never been started, so the Docker Postgres in the plan's manual steps needs `podman machine start` first.

### Pitfall 7: Error code change ripples into docs/tests
Nothing in the repo asserts `INVALID_OPERATION` for flag violations today (grep of `packages/**/*.test.ts` finds none), only the engine source. The README and `.planning/codebase/CONVENTIONS.md` list real `Errors` codes; if either enumerates `INVALID_OPERATION` for this case, update it.

## Code Examples

### Reference check against a thin object (what T4 asserts)
```typescript
// bad id with the right prefix -> INVALID_CROSS_REFERENCE_KEY; seeded default row -> success
const bad = await engine.insert(session, "Case", [{ Subject: "x", BusinessHoursId: "01m000000000000AAA" }]);
expect(bad[0]?.errors[0]).toMatchObject({ statusCode: "INVALID_CROSS_REFERENCE_KEY", fields: ["BusinessHoursId"] });
```
(`checkReferences` rejects both unknown ids of the right prefix and ids whose prefix matches no target once all targets are known; `engine.ts:487-510`.)

### Flag enforcement table (what T5/T6 iterate)
```typescript
const FLAGS = { UserLicense: [false, false, false], CallCenter: [true, false, false], BusinessHours: [true, true, false] /* ... all 14 */ } as const;
// For every object and operation: a violated flag => exactly one error with statusCode INVALID_TYPE_FOR_OPERATION;
// an allowed op must NOT yield that code (it may yield REQUIRED_FIELD_MISSING etc.).
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Engine returns `INVALID_OPERATION` for a flag violation | `INVALID_TYPE_FOR_OPERATION` | this phase | Matches the documented StatusCode text |
| Object flags enforced in all modes | Bypassed in import mode (D-08) | this phase | Read-only objects can be migrated |
| 14 targets unchecked, 14 warnings | Real objects, checked FKs | this phase | BASE-02/05 |

**Deprecated/outdated:** FEATURES.md's guess that ExternalDataSource's name is `DeveloperName` and that IdeaTheme/SocialPost/DandB names are unknown; superseded by the Fact Table (IdeaTheme `Title`, SocialPost `Name` idLookup). FEATURES.md's "UserLicense: MasterLabel" is contradicted by OR68 (`Name` idLookup).

## D-09 answer: documented error code for object-flag violations

| Question | Answer | Confidence |
|---|---|---|
| Documented StatusCode when "the specified sObject type is invalid for the specified operation" | **`INVALID_TYPE_FOR_OPERATION`**, SOAP API Developer Guide v68.0, StatusCode table (`apex_api.pdf`, section listing `INVALID_TYPE` "The specified sObject type is invalid." then `INVALID_TYPE_FOR_OPERATION` "The specified sObject type is invalid for the specified operation."); also on developer.salesforce.com `atlas.en-us.api.meta/api/sforce_api_calls_concepts_core_data_objects.htm` (seen in search results; the page itself 403s to fetch) | HIGH (official, two locations) |
| What `INVALID_OPERATION` is documented for | "The client application tried to modify a record that an approval process has locked." (same table). Not a match for object flags | HIGH |
| `CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY` | "You don't have permission to create, update, or activate the specified record." (permission, not object capability) | HIGH, not a match |
| REST HTTP status | The REST API Developer Guide v68 status table lists only generic meanings (400 "request couldn't be understood", 405 "method ... isn't allowed for the resource"); it does not say which applies to a non-createable sObject. orglet's per-record path (`statusFor`) returns 400 with `[{message, errorCode, fields}]`; keep 400 | LOW for the HTTP status (undocumented per object), HIGH that the errorCode is the documented one |
| Message text | Not documented; keep the current wording `entity type <Name> does not support <insert|update|delete|undelete|upsert>` | n/a |

Recommendation: change. Add `Errors.invalidTypeForOperation` (code `INVALID_TYPE_FOR_OPERATION`), use it from the Pattern 3 guard, keep `invalidOperation` for the recycle-bin message. Community reports of real orgs returning `INVALID_OPERATION` with "entity type cannot be inserted" exist (e.g. a FormAssembly help article about CampaignMember) but are anecdotal, concern a permission case, and cannot be verified without an org; the documented code wins (public documentation only is the project rule). If Johan wants certainty he can observe it in his own org per D-03, but it is not a blocker.

## Codebase answers for the planner (verified in code)

1. **`systemFields` / `fromStandardObject`**: see Pattern 1 and §System-field divergence. `Id` (readOnly, idLookup, defaultedOnCreate, non-nillable), `IsDeleted` (checkbox, read-only), `OwnerId` (only if `hasOwner`; `Lookup` to `["User","Group"]`, non-nillable, defaultedOnCreate, createable/updateable), audit three DateTimes + two User lookups (read-only, non-nillable, defaulted). Object flags `?? true`, `searchable ?? true`, `queryable ?? true`. The engine cannot work without `isdeleted`; audit stamps are written by `saveBatch` (`engine.ts:358-366`).
2. **`StandardObjectJson` keys**: Pattern 1. `Group.json`, `Profile.json`, `RecordType.json` are the templates (`RecordType`: `deletable:false, undeletable:false, hasOwner:false`). Lookups to the 14: Pattern 2.
3. **DE retrieve**: only custom `referenceTo` is `ObjectBackup__c`; none to the 14.
4. **Engine checks**: Pattern 3. `coerce.ts:129` precedent: `const writable = importMode ? ... : operation === "insert" ? field.createable : field.updateable`. Note in import mode `engine.run` also sets `session_replication_role = replica` (`engine.ts:215`), so FKs to the 14 do not block loading children first.
5. **`bootstrap.ts`**: Pattern 4. Existing tests that call it: `engine.test.ts`, `api.test.ts`, `query.test.ts`, `bulk.test.ts` (each once in `beforeAll`); none exercise idempotency, so a dedicated test is needed. `ddl.ts`: a single-target `Lookup` yields an FK (`fk_<table>_<col>`, `planTable` L46-50); `OwnerId` (two targets) and `Group`-style polymorphic lookups do not.
6. **Describe / SDKs**: Pattern 6. UI: see 10.
7. **Harnesses**: Pattern 6.
8. **Warning loop**: `build.ts` end of `buildOrgSchema` collects missing `referenceTo` targets over all objects and warns once per target. Verified by running `tsx packages/cli/src/index.ts check` today: **acme and `~/Development.nosync/devrandom-metadata` both print exactly the same 14 `UNSUPPORTED:reference-target` lines** (the DE additionally prints one `UNSUPPORTED:field-type`, the Summary field, phase 5). So BASE-05 is unit-testable with acme (T3) and manually with the DE (M2).
9. **Phase 2 interplay**: `prefixes.ts` builds the `taken` map from every non-custom object (`standard = all.filter(o => !o.custom)`, L251) and rejects a persisted/mapped prefix that equals a standard one. The 14 enter it automatically; none starts with `a`/`A` (verified), so existing `a00..a03` assignments in acme/devrandom are untouched. Tests to add: a pure `planKeyPrefixes` case with `standard` including `{BusinessHours,"01m"}` where `mapping` asks `01m` for a custom object (expects `KeyPrefixError` naming BusinessHours), a persisted `a00` alongside the 14 (no error), and a baseline-derived assertion that no standard `keyPrefix` matches `/^[aA]/`.
10. **Object browser (`packages/api/ui/index.html`)**: the record-list SOQL builder (`selectObject`, ~L165-171) does `const nameField = usable.find(f => f.nameField)` and `...(nameField ? [nameField.name] : [])`, i.e. it already tolerates no name field and falls back to `Id` plus the first 8 other non-system fields. No UI change. For OpportunityHistory `usable` may be nearly empty (all fields are system names), giving `SELECT Id, LastModifiedDate ...`; harmless.
- Nothing else in `packages/*/src` (non-test) reads `nameField` except `describe.ts:141,144` (reports it; `permissionable` excludes it), so zero name fields cannot break the engine, SOQL, or API.

## Open Questions

1. **Existing-data FK policy (Pitfall 1)**
   - Known: plain `ADD CONSTRAINT` validates existing rows; imported orgs very likely hold dangling lookups to the 14.
   - Unclear: whether devrandom currently contains any (needs a read-only SQL count by Johan or the plan's first task).
   - Recommendation: precheck, then `NOT VALID` + warning for newly added FKs over violating rows; test it.
2. **Checkpoint answers (five items above)** block writing: IdeaTheme prefix/Title, the three `Name` flags, ExternalDataSource name field, UserLicense `Name` vs `MasterLabel`, OperatingHours owner.
3. **Individual field set vs D-01**
   - Known: the reference's name-equivalent is the compound `Name`, which needs `FirstName` and `LastName` (required) to compute and to carry `nameField`; `User.json` is the precedent.
   - Unclear: D-01 says "the documented name-equivalent field" (singular).
   - Recommendation: include `Name`, `FirstName`, `LastName` (3 fields, no other business fields) and record it as the one D-01 reading; it is the minimum that keeps `Name` meaningful.
4. **`idEnabled` in describe**: add to `objectSummary` (recommended, one line) or exempt in the contract test.
5. **Optional fidelity not required by BASE-\***: `mergeable` is hard-coded to Account/Contact/Lead (Individual documents `merge()`); `triggerable`/`replicateable` are `true` for the read-only objects; `childRelationshipName` is missing on the 18 existing lookups. Leave unless Johan wants them; mention in SUMMARY as known gaps.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node (via nvm) | everything | yes | 22.23.3 (`nvm use 22`; default shell node cannot load jsforce) | none needed |
| npx vitest / tsx | tests, `check` | yes | vitest 3.2.7 | `pnpm` itself is not on PATH here (`corepack enable pnpm` per README) |
| pglite (embedded) | DB tests | yes | 0.5.8 | n/a |
| Docker / Postgres 16 | manual `up`, devrandom run, CI parity | **no, not running** | `podman machine` exists but was never started | `podman machine start`, then `pnpm db:up`; DB tests run on pglite without it |
| jsforce build | describe-check Node leg | yes | 3.10.26 @ 9bae14e in `conformance/jsforce/.cache/jsforce` | re-run `conformance/jsforce/run.sh` |
| Python venv with simple-salesforce | describe-check Python leg | **no** | old `.venv` is x86_64 py3.9 (not executable here); system python 3.14 lacks the package | new venv from `/opt/homebrew/bin/python3.12` + `requirements.txt` |
| `sf` CLI + `jq` | Johan's optional checkpoint answers | unknown (Johan's side) | n/a | Johan can use the REST describe or the Setup UI |
| Johan's DE retrieve | M2 | yes (read at `~/Development.nosync/devrandom-metadata`, Level 1, local) | n/a | acme covers the unit test |

**Missing dependencies with no fallback:** none for the code work. The manual acceptance runs (M1, M3) need the container runtime and the Python venv repaired; schedule those as the last plan's first steps.

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json`.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.7, single root `vitest.config.ts` (`@orglet/*` aliased to `src/index.ts`, `testTimeout` 30 s, `hookTimeout` 60 s) |
| Config file | `vitest.config.ts` (exists); DB seam `test/db.ts` `openTestDb()` / `usingPglite` (exists) |
| Quick run command | `npx vitest run packages/metadata packages/cli` (pure, <1 s) |
| Full suite command | `pnpm test` (pglite) and `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` after `pnpm db:up` (real Postgres) |
| Also required | `pnpm build && pnpm lint` (type-aware ESLint covers new tests; `consistent-type-imports` is an error) |

### Test files to add or change

| File | Backend | Purpose |
|------|---------|---------|
| `packages/metadata/src/build.test.ts` (CHANGE) | pure | T1 table-driven fact-table test; T2 rewrite of L157 + BASE-05 zero-warning assertion; retarget "exactly one name field" (Pitfall 2) |
| `packages/engine/src/engine.test.ts` (CHANGE) | DB | T4 reference check, T5/T6 flag enforcement per op and code, T7 upsert/undelete guards, T8 import-mode bypass |
| `packages/engine/src/bootstrap.test.ts` (NEW) | DB | T9 seeds exist, linked, idempotent, upgrade simulation, existing default untouched |
| `packages/api/src/api.test.ts` (CHANGE) | DB | T10 describe shape for 14 (global + per object, jsforce key sets), T11 REST write protection (HTTP 400 + `INVALID_TYPE_FOR_OPERATION`) |
| `packages/cli/src/main.test.ts` (CHANGE) | pure | T3 `check --project ACME` emits no `UNSUPPORTED:reference-target` (spy on `console.warn`; today it is stubbed to a no-op) |
| `packages/schema/src/prefixes.test.ts` (CHANGE) | pure + DB | T12 standard-prefix interplay |
| `packages/schema/src/migrate.test.ts` (CHANGE) | DB | T13 upgrade: migrate a schema without the 14, then with; FK added; dangling-data policy (Pitfall 1) |
| `conformance/describe-check/*` (NEW) | manual, live server | M1 |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BASE-01 | **T1:** each of the 14 loads with prefix, label, flags, `hasOwner`, exactly one nameField (or none for OpportunityHistory), system fields exactly once, expected name-field names | unit | `npx vitest run packages/metadata/src/build.test.ts -t "thin"` | add to existing file |
| BASE-01 | **T12:** none of the 14 prefixes starts with `a`/`A`; a mapped/persisted custom prefix equal to `01m` raises `KeyPrefixError` naming BusinessHours; persisted `a00` + all standard prefixes plans without error | unit | `npx vitest run packages/schema/src/prefixes.test.ts -t "standard"` | add |
| BASE-02 | **T4:** `Case.BusinessHoursId` bad id / wrong-prefix id -> `INVALID_CROSS_REFERENCE_KEY`; seeded default id accepted; `Profile.UserLicenseId` equals the seeded license | integration | `npx vitest run packages/engine/src/engine.test.ts -t "thin"` | add |
| BASE-02 | **T13:** migrating an org created without the 14 adds FK `fk_profile_userlicenseid` and the other 17; dangling-data case behaves per chosen policy | integration | `npx vitest run packages/schema/src/migrate.test.ts -t "thin"` | add |
| BASE-03 | **T5:** for each of 14 x {insert, update, delete}: violated flag -> exactly one error `INVALID_TYPE_FOR_OPERATION`; allowed op never returns that code | integration | `... engine.test.ts -t "object flags"` | add |
| BASE-03 | **T7:** `upsert` on UserLicense/CallCenter rejected; `undelete` on BusinessHours rejected (flag false) | integration | same, `-t "upsert"` | add |
| BASE-03 | **T8:** import-mode engine inserts a UserLicense, OpportunityHistory, ExternalDataSource, CallCenter row (supplied Id), updates CallCenter, deletes BusinessHours; the normal-mode engine rejects the same calls | integration | same, `-t "import mode"` | add (extends existing import-mode block) |
| BASE-03 | **T11:** `POST /sobjects/UserLicense`, `PATCH /sobjects/CallCenter/<id>`, `DELETE /sobjects/BusinessHours/<id>` -> 400, `[{errorCode:"INVALID_TYPE_FOR_OPERATION"}]` | integration | `npx vitest run packages/api/src/api.test.ts -t "write protection"` | add |
| D-05/06 | **T9:** after `bootstrapOrg`: one default BusinessHours (`Name` "Default", `IsActive`), one UserLicense (`MasterLabel` "Salesforce"), System Administrator `UserLicenseId` set; second call: counts and Ids unchanged; after nulling the link and deleting both rows: recreated and relinked; a pre-existing differently named default is not modified and no second default appears | integration | `npx vitest run packages/engine/src/bootstrap.test.ts` | NEW |
| BASE-04 | **T10:** global and per-object describe for all 14: jsforce `DescribeGlobalSObjectResult`/`DescribeSObjectResult`/`Field`/`ChildRelationship` key sets present, `keyPrefix`, `name`, one/zero `nameField`, `urls.sobject/describe/rowTemplate`, system fields, `childRelationships` contains the Pattern 2 referencers, flags equal the Fact Table | integration | `npx vitest run packages/api/src/api.test.ts -t "thin objects"` | add |
| BASE-04 | **M1:** `node conformance/describe-check/jsforce.mjs` and `python sf_describe.py` against a running orglet, 14 objects, exit 0, output recorded verbatim in SUMMARY | manual (live server) | see Pattern 6; Node 22 | NEW |
| BASE-05 | **T2:** baseline/acme build has zero `reference-target` warnings; a synthetic dangling lookup still produces exactly one | unit | `npx vitest run packages/metadata/src/build.test.ts -t "reference"` | rewrite existing L157 |
| BASE-05 | **T3:** `main(["check","--project",ACME])` writes no `UNSUPPORTED:reference-target` line | unit | `npx vitest run packages/cli/src/main.test.ts` | add |
| BASE-05 | **M2:** `node packages/cli/dist/index.js check --project ~/Development.nosync/devrandom-metadata` prints zero `UNSUPPORTED:reference-target` (one `UNSUPPORTED:field-type` for Summary remains, phase 5) | manual | `pnpm build` first | n/a |
| D-05/06 | **M3:** `orglet up` twice on an isolated org schema against Docker Postgres: seed rows appear once, second run silent; then on devrandom (human checkpoint) | manual | needs container runtime | n/a |

pglite vs Postgres: T1-T12 use only plain SQL already exercised on pglite 0.5.8 (selects, inserts, `ALTER TABLE ... ADD CONSTRAINT ... DEFERRABLE`), so all run on both backends; no `skip(usingPglite, ...)` is needed. T13's `NOT VALID` variant, if chosen, is standard Postgres and should be run once on both backends in CI before trusting it on pglite.

### Sampling Rate
- **Per task commit:** `npx vitest run packages/metadata packages/cli` plus the single touched file (<5 s each on pglite)
- **Per wave merge:** `pnpm build && pnpm lint && pnpm test`, then `pnpm db:up && ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test`
- **Phase gate:** both CI jobs (`test-pglite`, `test-postgres`) green on `gsd/phase-03-thin-standard-object-baselines`; M1, M2, M3 outputs pasted into SUMMARY; Johan's devrandom `up` as the human checkpoint (expect the two seed rows once, then silence)

### Wave 0 Gaps
- [ ] `packages/engine/src/bootstrap.test.ts` (T9): new file
- [ ] `conformance/describe-check/` (M1): new directory, a repaired Python venv, a started container runtime
- [ ] Checkpoint answers from Johan (blocking for the JSON, not for tests)
- [ ] Decision on Pitfall 1 (FK policy) before the migrate task
- [ ] No framework install, no new fixtures on disk (second schemas are built in memory with `buildOrgSchema`)

## Project Constraints (from CLAUDE.md)

- Legal: public documentation and open-source SDK source only; never diff behaviour against a real org. This research used the public Object Reference PDFs, jsforce/simple-salesforce source, public prefix lists and one third-party-published describe gist (corroboration only; do not copy fields from it). Johan answering a checkpoint from his own org is allowed by D-03; orglet and its tests never contact Salesforce.
- Data: Level 1 only. The DE retrieve is read locally and never copied into the repo or CI; the tests use `examples/acme`. WebSearch queries contained only public object names.
- Tech stack: TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`: never assign `undefined` to an optional property), Node 22, ESM with `.js` import extensions, explicit named exports in each package `index.ts` (values and types on separate lines), `import type` / inline `type` per `consistent-type-imports`, no new dependencies.
- Errors: build through the `Errors` factory with real `StatusCode` members; never hand-write error objects; `UNSUPPORTED:<area>` is only for deliberately unimplemented features, not for rejected DML. API errors go through `apiError` / `sendErrors`.
- Comments: every source file keeps its short `/** ... */` header explaining why it exists (update `bootstrap.ts`'s); inline comments only for Salesforce reasoning; code, commits and repo docs in English.
- Tests: names describe the invariant (for example `refuses_delete_on_business_hours`-style meaning, written as plain English sentences like the existing tests), co-located `*.test.ts`, DB tests use `openTestDb`, a `test_<hex>` schema and `DROP SCHEMA` in `afterAll`; CLI tests via `main()` with console spies.
- Git: repo-local identity Johan Karlsteen <johan@karlsteen.com>; the phase branch is `gsd/phase-03-thin-standard-object-baselines`; no push without Johan's confirmation. Commit trailer per the harness reminder.
- Workflow: all repo edits go through a GSD command (`/gsd:execute-phase` for this phase); verification claims need literally observed output (SUMMARY convention from phase 2).
- Conventions: conflicting patterns, pick one and flag the other: here the engine's `invalidOperation` vs the documented code is resolved in favour of the documented one.

## Sources

### Primary (HIGH confidence)
- Object Reference v68.0 (Oct 2, 2026): https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/object_reference.pdf (Supported Calls, field Properties, System Fields p.12, `nameField`/`idLookup` definitions)
- Object Reference v56.0 (Winter '23): https://resources.docs.salesforce.com/240/latest/en-us/sfdc/pdf/object_reference.pdf (flags identical for all 14)
- SOAP API Developer Guide v68.0: https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/apex_api.pdf (StatusCode table, `nameField` definition)
- REST API Developer Guide v68.0: https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_rest.pdf (status-code table)
- jsforce source @ 9bae14e (local clone `conformance/jsforce/.cache/jsforce`): `src/connection.ts`, `src/sobject.ts`, `src/types/common.ts`, `src/types/standard-schema.ts`; https://github.com/jsforce/jsforce
- simple-salesforce 1.12.10 `api.py`: https://github.com/simple-salesforce/simple-salesforce/blob/master/simple_salesforce/api.py
- Repository code read directly: `packages/metadata/src/{build,types,schema}.ts`, `packages/engine/src/{engine,bootstrap,errors,coerce,store,formulas}.ts`, `packages/schema/src/{ddl,migrate,prefixes,columns}.ts`, `packages/api/src/{describe.ts,routes/sobjects.ts,ui/index.html}`, `packages/cli/src/main.ts`, conformance scripts, existing tests

### Secondary (MEDIUM confidence)
- Fish of Prey key-prefix table (Spring '21): http://www.fishofprey.com/2011/09/obscure-salesforce-object-key-prefixes.html
- Aegis Softworks list: https://aegissoftworks.com/tools/sfid_prefix_list.php
- Apex Hours list: https://www.apexhours.com/salesforce-object-key-prefix/ (same data: https://dineshyadav.com/salesforce-objects-key-prefix/)
- Synchro gist (derived from Fish of Prey): https://gist.github.com/Synchro/2c6186203c15dc2bd14bd2c7f6396583
- Public describe, ServiceAppointment: https://gist.github.com/jverce/62e8aed7b56aab8e3a3bcd6eaba7f612

### Tertiary (LOW confidence)
- FormAssembly help article on "CampaignMember - entity type cannot be inserted" (anecdotal real-org error text): https://help.formassembly.com/help/salesforce-error-campaignmember---entity-type-cannot-be-inserted
- developer.salesforce.com HTML pages (object reference, `core_data_objects`): return 403 to automated fetch; seen only as search results.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new dependencies, versions observed running.
- Architecture / code changes: HIGH, every claim read in code and the checks run (`check` on acme and DE, vitest, loader scripts).
- Fact Table: prefixes MEDIUM (community lists, one real describe), flags HIGH (public doc, two editions), name fields MEDIUM-LOW for the five unresolved items, ownership/system fields MEDIUM (reference + jsforce schema).
- D-09: HIGH on the documented code, LOW on the REST HTTP status.
- Pitfalls: HIGH for 1-3, MEDIUM for 6 (environment).

**Research date:** 2026-10-08
**Valid until:** 2026-11-07 for the code findings (stable); Fact Table is stable across releases (flags unchanged since v56) unless Johan's checkpoint answers differ.
