# Feature Landscape: v1.1 real-org fidelity

**Domain:** Salesforce platform emulator (orglet), subsequent milestone
**Researched:** 2026-10-12
**Scope:** only the seven new feature groups of v1.1. Existing v1.0 features are not re-researched.
**Overall confidence:** MEDIUM-HIGH. Object shapes and metadata formats are HIGH (read from the current public
PDFs). Formula-global semantics and error codes are MEDIUM/LOW because the HTML docs block non-browser clients and
several behaviours are only documented in pages I could reach through search snippets.

## Source key and how the docs were reached

`developer.salesforce.com` HTML returns HTTP 403 to WebFetch/curl, but the **public PDF builds of the guides are
downloadable** from `resources.docs.salesforce.com` and were converted with `pdftotext`. These are the primary,
quotable sources (build dates inside the PDFs: Oct 2026, API v68.0). Every claim below carries a tag.

| Tag | Source (public documentation) | Confidence |
|-----|-------------------------------|------------|
| [OR] | Object Reference PDF, 6 437 pp: https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/object_reference.pdf (per-object HTML: `https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_<name>.htm`) | HIGH |
| [MD] | Metadata API Developer Guide PDF: https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_meta.pdf | HIGH |
| [REST] | REST API Developer Guide PDF: https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_rest.pdf | HIGH |
| [TOOL] | Tooling API PDF: https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_tooling.pdf | HIGH |
| [CMTG] | Custom Metadata Types Implementation Guide, **Spring '17** (old): https://resources.docs.salesforce.com/206/latest/en-us/sfdc/pdf/custom_metadata_types_impl_guide.pdf | MEDIUM (dated) |
| [VF] | Visualforce Developer Guide global variables, e.g. https://developer.salesforce.com/docs/atlas.en-us.pages.meta/pages/pages_variables_global_api.htm (also `_setup`, `_userrole`, `_label`); reached via search snippets only | MEDIUM |
| [APEX] | Apex Developer Guide, Custom Settings: https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_customsettings.htm and `apex_methods_system_custom_settings.htm`; snippets only | MEDIUM |
| [HELP] | Help article https://help.salesforce.com/s/articleView?id=fields_about_roll_up_summary_fields.htm (JS-rendered; text via search snippet) | MEDIUM |
| [KP] | Community key-prefix lists (not Salesforce-official): https://gist.github.com/FishOfPrey/05f7a742757fce071a09, https://gist.github.com/Synchro/2c6186203c15dc2bd14bd2c7f6396583, https://www.apexhours.com/salesforce-object-key-prefix/ | MEDIUM (two agreeing lists) |
| [SIGHA] | open-source vendored `packages/sigha/src/registry/contexts.ts` (MIT); its "org-verified" comments are upstream's claim, not ours | MEDIUM |
| UNVERIFIED | no public documentation found; decide by project convention, never claim as Salesforce fact | LOW |

**Method consequence worth acting on:** the Object Reference PDF has a regular layout (`Field / Type / Properties /
Description / Relationship Name / Refers To`). A 60-line parser extracted field name, type, Create/Update/Nillable/
Defaulted flags and OwnerId targets for all 18 business objects below. The baseline-v2 generator can be built the
same way; the PDF does **not** carry key prefixes, picklist values or exact lengths (lengths only inside prose), so
those need the supplements named per feature.

---

## A. Custom metadata types (`__mdt`)

### Documented behaviour an SDK client observes

| Aspect | Documented fact | Source |
|--------|-----------------|--------|
| Naming | `Type__mdt`; fields `__c`; the record Developer Name is a separate field | [MD] "Custom Metadata Types (CustomObject)" |
| Supported calls | `describeSObjects()`, `describeLayout()`, `query()`, `retrieve()` only. No create, update, delete, upsert, undelete, getUpdated, getDeleted, search | [OR] "Custom Metadata Type__mdt" |
| DML | "DML operations aren't allowed on custom metadata in the Partner or Enterprise APIs"; Apex can only deploy records through the Metadata API | [MD] CustomObject (CMT) "Special Access Rules" |
| System fields | `DeveloperName` (string, defaulted on create, filter/group/sort), `MasterLabel` (string), `Label` (documented as picklist, always equals MasterLabel), `Language` (string, restricted picklist, default language of the developing org), `NamespacePrefix` (string, nillable), `QualifiedApiName` (string, nillable, `NamespacePrefix__DeveloperName`), `IsProtected` (boolean; the page spells it `isProtected`), `SystemModstamp` (API 56.0+) | [OR] |
| Audit fields | The Metadata API page says "Audit fields (CreatedDate, CreatedBy, LastModifiedDate, LastModifiedBy, SystemModStamp) remain uneditable", but the Object Reference field list for `__mdt` does not list them | [MD] vs [OR], contradictory: UNVERIFIED which appear in describe |
| Key prefix | Custom metadata ids start at `m00` and increment (analogous to `a00` custom objects, `e00` platform events) | [KP] apexhours; MEDIUM. The task text says `m0`; the sources say the first prefix is `m00` |
| Describe flags | createable/updateable/deletable false and queryable/retrieveable true follow from the supported-calls list. `custom: true` follows from the `__mdt` suffix table. Value of `customSetting` for an mdt is not documented | derived from [OR]; `customSetting` UNVERIFIED |
| Record source | Retrieve folder `customMetadata/`, file `<Type>.<RecordDeveloperName>.md` (SFDX source format: `.md-meta.xml`); body `<label>`, `<protected>`, `<values><field>X__c</field><value xsi:type="xsd:string">…</value></values>`; `xsi:type` carries the value type; a value "can be null" | [MD] "CustomMetadata" |
| Type definition | `<CustomObject>` with `<visibility>` Public / Protected / PackageProtected; types limited to 100 fields, 100 types per org, 10 MB, 50 000 records per transaction | [MD], [CMTG] Limits |
| SOQL | Single `FROM`, `USING SCOPE`, `WHERE` with `IN`/`NOT IN`, `=,>,>=,<,<=,!=`, `LIKE`, `AND`; `ORDER BY` only non-relationship, selected fields; metadata-relationship fields allowed in select/where and support all standard relationship queries | [CMTG] Spring '17; **dated, UNVERIFIED for v68**. Do not police this narrowing |
| Unreadable rows | Records hidden by Protected/PackageProtected rules are "unavailable to REST, SOAP, SOQL, and Setup" | [MD] CustomMetadata.protected. Irrelevant in single-tenant unpackaged orglet |
| Error for REST DML | **Not documented.** Closest in-project convention is the phase-3 flag error `INVALID_TYPE_FOR_OPERATION` | UNVERIFIED. Pick by convention, say so in the message source |

### `MetadataRelationship` field semantics

- Field type enum value `MetadataRelationship`; `<metadataRelationshipControllingField>` on a field definition names the
  entity-definition field that filters it (API 39.0+). [MD] CustomField.
- Domain is one of: another custom metadata type, `EntityDefinition` (standard or custom object that supports custom
  fields, triggers and layouts; not an activity, not `User`, not a Trialforce object), or `FieldDefinition`. [CMTG] "Custom
  Metadata Relationships".
- Stored value in the record file is the qualified API name of the target ("the qualified API names of the entity and
  the field it points to"). [MD] CustomMetadataValue.value. Exact string form for a type-to-type relationship
  (`Type.Record`?) is UNVERIFIED.
- `QualifiedApiName` on EntityDefinition is `NamespacePrefix__DeveloperName` (custom: `…__c`); "When performing SOQL queries
  with Custom Metadata Type relationship fields, use this field to obtain fully qualified namespaces." FieldDefinition
  has `QualifiedApiName` ("a unique external name for the field") and `EntityDefinition.QualifiedApiName`. [TOOL]
- SOQL: "You can query custom metadata relationships the same way you query normal relationships"; SOQL results omit
  rows pointing at objects the caller cannot access (single-tenant: not applicable). [CMTG]
- Public types cannot relate to protected types (packaging rule, ignore).

### `$CustomMetadata.Type__mdt.Record.Field__c` in formulas

- Syntax confirmed by the Trailhead module "Use Custom Metadata Types in Formulas, Default Values, and Validation Rules"
  (https://trailhead.salesforce.com/content/learn/modules/custom_metadata_types_dec/cmt_formulas) with example
  `$CustomMetadata.Support_Tier__mdt.Bronze.MasterLabel`: type, record DeveloperName, field. MEDIUM.
- Not allowed to span custom metadata relationships inside a formula; formulas referencing a record can read-lock it.
  (search snippet of the same module, MEDIUM)
- Context availability: resolves in formula fields, validation rules, default values and flow formulas, **not** in workflow
  rules, approvals, buttons or quick actions. [SIGHA] contexts.ts (upstream org-verified claim; adopt as data, label MEDIUM).
- Sigha behaviour today: the evaluator throws `UnsupportedError` for a `$CustomMetadata` reference unless the key
  (dotted path joined with `.`) is already present in `env.fields`. So orglet must **pre-resolve** referenced
  `$CustomMetadata.*` keys into the evaluation environment. [SIGHA] evaluator.ts lines ~138-148.

### Table stakes / differentiators / anti-features

| Item | Class | Complexity | Notes |
|------|-------|------------|-------|
| Load `Type__mdt` definitions from `objects/` and rows from `customMetadata/*.md-meta.xml` into a Postgres table, ids stable (`m0x` prefix + deterministic counter) | Table stake | Med | Key-prefix persistence (`_orglet.key_prefixes`) must learn a second series (`m00…`); ids must survive `orglet up` reruns |
| System fields `DeveloperName`, `MasterLabel`, `Label`, `Language`, `NamespacePrefix`, `QualifiedApiName`, `IsProtected`, `SystemModstamp` | Table stake | Low | `Label` mirrors `MasterLabel`; `Language` constant `en_US` unless metadata says otherwise (UNVERIFIED default) |
| Describe: `custom: true`, read-only flags from supported-calls list | Table stake | Low | Reuses the phase-3 DML-flag machinery (`INVALID_TYPE_FOR_OPERATION`) |
| SOQL select/where/order, incl. `Rel__r.QualifiedApiName` | Table stake | Low-Med | Existing SOQL compiler; extra narrowing of Spring '17 syntax = anti-feature |
| `MetadataRelationship` field loaded (today `UNSUPPORTED:field-type`) as a string column plus describe `type: reference`, `referenceTo: ["EntityDefinition"]` / `["FieldDefinition"]` / `["Other__mdt"]` | Table stake | Med | The describe `type`/`referenceTo` spelling for these is UNVERIFIED; derive from `Lookup` shape |
| `$CustomMetadata` formula global resolved from the table | Table stake | Med | Needs a pre-scan of referenced keys at compile time, one batched fetch per query/batch, memoised (formulas are evaluated per row after fetch) |
| Virtual `EntityDefinition` / `FieldDefinition` objects synthesised from `OrgSchema` so `Entity__r.QualifiedApiName` works | Differentiator | Med | Cheaper variant: treat `Entity__r.QualifiedApiName` as an alias of the stored string and log `UNSUPPORTED:reference-target` for anything else on those objects |
| Retrieve-time validation that each relationship value names a modelled object/field | Differentiator | Low | Report in `check` (feature G) |
| DML on `__mdt` via REST | **Anti-feature to implement**: reject | Low | Reject with the project's `INVALID_TYPE_FOR_OPERATION` convention; do not offer a "deploy" path |
| Enforcing packaging visibility (Protected / PackageProtected), 100-type / 10 MB / 50 000-row limits, caching | Anti-feature | - | Single-tenant, unpackaged. Parse `visibility`/`protected` and ignore, no warning |
| Metadata-API-style deploy of mdt records (Apex `Metadata.Operations`) | Anti-feature | - | Apex runtime is out of scope |

**Dependencies:** `@orglet/metadata` (new parser for `.md-meta.xml`, field type), `@orglet/schema` (DDL, key prefixes),
`@orglet/soql` (relationship alias), `@orglet/engine` (read-only guard), `@orglet/formula` (global resolver).

---

## B. Custom settings (list and hierarchy) and `$Setup`

| Aspect | Documented fact | Source |
|--------|-----------------|--------|
| Definition | A `CustomObject` with `customSettingsType` = `List` or `Hierarchy` ("Hierarchy … is the default"); "when this field is present, this component isn't a custom object, but a custom setting" | [MD] CustomObject `customSettingsType` |
| Visibility | `visibility` Public / Protected (replaces `customSettingsVisibility` from API 34.0) | [MD] |
| Describe flag | `DescribeSObjectResult.customSetting` exists (REST describe sample shows `"customSetting": false` for Account) | [REST] sObject Describe sample; value `true` for settings follows from the property name |
| Data lives in the DB, not in the retrieve | Metadata API carries definitions only; "Only custom settings definitions are included in packages, not data" | [APEX] custom settings page (snippet) |
| Hierarchy resolution | org default, overridden by profile, overridden by user; "lowest" level wins | [VF] `$Setup`, [APEX] |
| Field-level merge | `getInstance()` "returns a custom setting data set record for the current user, with fields … merged based on the lowest level fields that are defined in the hierarchy"; if nothing is defined the result has empty fields "except for the SetupOwnerId field which contains the user ID" | [APEX] `HierarchyCustomSetting.getInstance` (snippet). Whether a *null* user-level field counts as "defined" is UNVERIFIED |
| `SetupOwnerId` | Present on hierarchy settings; defaults to the Organization level when not populated; polymorphic to Organization, Profile, User; "there must be only one setting instance per `SetupOwnerId`" -> insert of a duplicate fails with `DUPLICATE_VALUE` on `SetupOwnerId` | [APEX] snippet + community write-up https://picchiri.altervista.org/salesforce/duplicate_value-setupownerid-custom-setting/ (LOW-MEDIUM) |
| `$Setup` syntax | `$Setup.App_Prefs__c.Show_Help_Content__c`; "global merge field type to use when referencing a custom setting of type 'hierarchy'"; list settings "aren't available on Visualforce pages using this global variable" | [VF] `pages_variables_global_setup` |
| Formula availability | "Custom settings data can be used by formula fields, validation rules, flows, Apex and the SOAP API" | [APEX] (snippet). Whether `$Setup` works for a *list* setting in formulas is UNVERIFIED; a list setting has no unambiguous row to address |
| Field-type limits | No relationship, calculated/formula, picklist or long/rich text fields (secondary source); "geolocation fields aren't supported in custom settings" | [OR] Address/Geolocation notes (HIGH for geolocation); rest from https://www.greytrix.com/blogs/salesforce/?p=1499 (LOW) |
| SOQL/DML | Data are real rows: SOQL, SOAP/REST insert/update/delete work; SOSL on settings is off by default (`enableSOSLOnCustomSettings`) and `enableAdvancedCSSecurity` can hide values from the Enterprise WSDL/SOAP | [MD] SchemaSettings |
| Key prefix | Not documented. Settings probably share the `a`-series with custom objects | UNVERIFIED |

### Table stakes / differentiators / anti-features

| Item | Class | Complexity | Notes |
|------|-------|------------|-------|
| Parse `customSettingsType`, create the table with normal custom-object DDL, describe `customSetting: true`, `hasOwner` false (no OwnerId; `SetupOwnerId` instead) | Table stake | Med | Today a retrieve with a custom setting loads it as an ordinary custom object: `customSetting` is false and OwnerId exists, so the error is silent |
| Hierarchy `SetupOwnerId` column (polymorphic: Organization 00D / Profile 00e / User 005), default = organization Id on insert, unique per setting | Table stake | Med | Reuses the phase-4 polymorphic machinery (`matchTargetByPrefix`) and `DUPLICATE_VALUE` factory |
| `$Setup.Name__c.Field__c` for **hierarchy** settings: user row, else profile row, else org row, merged **per field** | Table stake | Med | Needs the running user's Profile Id; `$User`/`$Profile` already bound. Cache per request |
| `$Setup` on a **list** setting | Anti-feature (emit `UNSUPPORTED:formula-global`) | Low | Matches the Visualforce restriction; no row key available |
| Custom-setting data load: no source in the retrieve | Gap, not a feature | - | Rows only arrive via REST/Bulk/`--import`. Say so in `check` output; do not invent seed data |
| Fixture rows for acceptance | Differentiator | Low | `examples/enterprise` ships a small seed script/JSON so `--strict` plus a formula test has data |
| Setup UI semantics (Manage button, default org value creation) | Anti-feature | - | |
| Apex `getInstance/getValues/getAll` | Anti-feature | - | Apex runtime out of scope |

**Dependencies:** metadata parser, key-prefix persistence, polymorphic lookup resolution, `$User`/`$Profile` binding,
the formula pre-resolver shared with feature A/C.

---

## C. Formula globals: `$UserRole`, `$Api`, `$Label` (plus `$Setup`, `$CustomMetadata` above)

### `$UserRole`

- "Global merge field … information about the current user's role"; fields are those of the `UserRole` object. [VF]
  `pages_variables_global_userrole` (the example is `{!$UserRole.LastModifiedById}`).
- `UserRole` fields in the Object Reference: `CaseAccessForAccountOwner`, `ContactAccessForAccountOwner`, `DeveloperName`,
  `ForecastUserId`, `IsPartner`, `MayForecastManagerShare`, `Name`, `OpportunityAccessForAccountOwner`, `ParentRoleId`,
  `PortalAccountId`, `PortalAccountOwnerId`, `PortalRole`, `PortalType`, `RollupDescription` (+ system fields). [OR] UserRole.
- Visualforce note: `CaseAccessForAccountOwner`, `ContactAccessForAccountOwner`, `OpportunityAccessForAccountOwner`,
  `PortalType` are not usable via `$UserRole` in Visualforce. Whether the same holds in formula fields is UNVERIFIED.
- [SIGHA] already classifies `$UserRole` as simulatable and available in every verified context.
- Behaviour for a user without a role: UNVERIFIED. Recommend blank fields (null), no error.

| Item | Class | Complexity | Notes |
|------|-------|------------|-------|
| Bind `$UserRole.<UserRole field>` from the running user's `UserRoleId` row, generic over the existing `UserRole` baseline object | Table stake | Low | Same code path as `$Profile`; baseline already has `UserRole` (00E). Check the baseline lists `DeveloperName`, `ParentRoleId`, `RollupDescription` |
| Restricting to the VF-excluded four | Anti-feature | - | Undocumented for formulas |

### `$Api`

- Properties: `$Api.Partner_Server_URL_xxx`, `$Api.Enterprise_Server_URL_xxx` (xxx = API version without the dot, e.g.
  `_250`, `_260`), `$Api.Session_ID`. "`$Api.Session_ID` and `GETSESSIONID()` return the same value." [VF]
  `pages_variables_global_api` (snippet, MEDIUM).
- Endpoint shape: SOAP login endpoints are `…/services/Soap/c/<ver>` (Enterprise) and `…/services/Soap/u/<ver>` (Partner);
  orglet's SOAP login already returns `{base}/services/Soap/u/<ver>/<orgId>` (`packages/api/src/routes/login.ts`), so
  the formula value can reuse that builder. The `/c/` path form is shown in [MD] examples. The org-id suffix is the
  existing orglet convention, not documented.
- Context: formula fields only in [SIGHA] (`API_GLOBAL` appended only for `formula_field`).
- Session id: the formula-field value is a basic session id; orglet has an in-memory session store, so the value is the
  caller's access token, which is **per request**, not per record. A stored (persisted) formula would be wrong
  but orglet evaluates formulas at read time, which is correct here.

| Item | Class | Complexity | Notes |
|------|-------|------------|-------|
| `Partner_Server_URL_xxx`, `Enterprise_Server_URL_xxx`, `Session_ID` from request context | Table stake | Low-Med | Needs a request-scoped value in the formula environment (read path only). Writes that evaluate formulas for validation rules should treat `$Api` as unsupported (only formula fields allow it per [SIGHA]) |
| Leaking real tokens into query results that SDKs cache | Risk, not feature | - | Session token appears in JSON of any query selecting such a field; acceptable for a local emulator, document it |

### `$Label`

- "Global merge field type to use when referencing a custom label … returned value depends on the language setting of
  the contextual user." [VF] `pages_variables_global_label`. Syntax `$Label.Name` / `$Label.Namespace.Name`.
- Retrieve format: `labels/CustomLabels.labels-meta.xml` -> `<labels><fullName>, <value>, <language>, <protected>,
  <shortDescription>`; translations live in separate translation metadata. [MD] CustomLabels.
- [SIGHA]: `$Label` is org-state, non-simulatable; same pre-resolution requirement as above.

| Item | Class | Complexity | Notes |
|------|-------|------------|-------|
| Parse `CustomLabels.labels-meta.xml`, resolve `$Label.Name` to `value` in the org default language | Table stake | Low | Single-language only |
| Per-user language / translation files (`translations/`) | Differentiator, defer | Med | Log `UNSUPPORTED:formula-global $Label translations` once |
| Namespaced labels | Anti-feature | - | Unpackaged only |

**Shared dependency (all globals):** one `GlobalResolver` that, at formula-compile time, collects the dotted keys the AST
references (`$Setup.*`, `$CustomMetadata.*`, `$Label.*`, `$Api.*`, `$UserRole.*`), and at evaluate time fills
`env.fields` once per request/batch. Without it every row re-queries. `$Permission` stays `UNSUPPORTED:formula-global`
(already decided). [SIGHA] evaluator behaviour above.

---

## D. `OwnerId` `referenceTo` per standard object (queue-ownable or not)

Targets read from the `OwnerId` field entry of each object in [OR]. "Refers To" absent means the doc names no target in
the field entry; see ServiceContract.

| Object | OwnerId `referenceTo` in [OR] | Plain `Owner.X` compiles when narrowed to |
|--------|-------------------------------|-------------------------------------------|
| Account, Contact, Opportunity, Contract, Asset, Campaign, Individual, Solution | `User` | `User` |
| Case, Lead, Task, SocialPost, Order, Location, ContactRequest, WorkOrder, ServiceAppointment, OperatingHours | `Group, User` | polymorphic (Group + User) |
| Event | `Calendar, User` | polymorphic (Calendar + User) |
| ServiceContract | Field entry says only "The ID of the user who currently owns the service contract", **no** Refers To | see below |
| ContentVersion, ContentDocument | `User` | `User` |
| Quote, QuoteLineItem, Entitlement, Product2, Pricebook2, PricebookEntry, EmailMessage, FeedItem, Address, OpportunityLineItem, CampaignMember, BusinessHours | no `OwnerId` in the field table | n/a (do not synthesise `OwnerId`; baseline loader currently adds one when `hasOwner` is true, so keep `hasOwner:false`) |

Queue ownership rule: queues are `Group` rows of type Queue; a queue can own only the entity types listed on it
(`QueueSobject`): Metadata API valid `sobjectType` values are Case, ContactRequest, Lead, ServiceContract and Task (API
48.0+) "plus custom objects"; "service contracts (if Entitlements are enabled)". [MD] Queue / QueueSobject. The same page
says the `Queue` component "supports cases, leads, service contracts (if Entitlements are enabled), and custom objects".

**Source contradictions, flagged:**
- `Order`, `Location`, `WorkOrder`, `ServiceAppointment`, `OperatingHours` document `Group, User` in [OR] although `Order` is
  not a valid `QueueSobject.sobjectType` in [MD]. Take [OR] for describe (it is what a client's describe returns);
  the queue-membership check (below) is an orglet policy, not a documented rule.
- `ServiceContract`: [MD] lists it as queue-capable, [OR] shows no Group target. Recommend `["Group","User"]`
  (MEDIUM; the Metadata API statement is explicit, the Object Reference field entry is silent, not negative).

| Item | Class | Complexity | Notes |
|------|-------|------------|-------|
| Narrow `OwnerId.referenceTo` per the table; `User`-only objects make `Owner.Name`/`Owner.Email` compile (today they are rejected as polymorphic) | Table stake | Low (data) + Med (verify no regression in TYPEOF/poly paths) | This is the main unblocker for the large org's cascaded formula failures |
| Load `queues/*.queue-meta.xml` into `Group` rows (Type=Queue) + a `QueueSobject` pseudo-table, enforce "owner is a queue not allowed for this object" on insert/update | Differentiator | Med | Error code for an invalid owner is UNVERIFIED; without a code, prefer to warn (`UNSUPPORTED:owner-queue`) rather than invent one |
| Plain `Owner.X` on `Group, User` objects (Case, Lead) | Open question | - | Salesforce documents `Owner:User.X` colon syntax for polymorphic traversal (already scheduled in sigha). Behaviour of plain `Owner.Name` on a polymorphic owner in a formula is UNVERIFIED; keep the existing compile-time rejection |
| Queue-based assignment rules, round robin, Omni-Channel routing | Anti-feature | - | |

**Dependencies:** `@orglet/metadata` standard JSON (`referenceTo` on a loader-added field: **README says the loader adds
`OwnerId`**, so the baseline schema needs an `ownerReferenceTo` knob next to `hasOwner`, currently a boolean), phase-4
polymorphic resolution, `Group` baseline object.

---

## E. Roll-up summary over formula fields

| Rule | Documented fact | Source |
|------|-----------------|--------|
| What may be summarised | "If a roll-up summary field doesn't contain cross-object field references or functions that derive values on the fly, such as NOW or TODAY, it can calculate the values of formula fields." | [HELP] `fields_about_roll_up_summary_fields` (snippet) |
| Forbidden | Formula fields with related-object merge fields (cross-object); "automatically derived fields, such as current date or current user"; formulas containing "functions that derive values on the fly, such as DATEVALUE, NOW, and TODAY" | [HELP] (snippet), echoed by https://www.apexhours.com/aggregating-validating-data/ and https://s2-labs.com/admin-tutorials/roll-up-summary-cross-object-formula-fields/ (LOW) |
| Filter-field limits | Cannot use long text area, multi-select picklist, Description, system fields like Last Activity, cross-object formula fields or lookup fields in the filter *field* column; no date-literal filters | https://www.apexhours.com/aggregating-validating-data/, https://gearset.com/blog/salesforce-roll-up-summary-field-deployment/ (MEDIUM, secondary) |
| Operations / fields | `summaryOperation` Count, Min, Max, Sum; `summarizedField` "can't be null unless … count"; `summaryForeignKey` = master-detail field on the child | [MD] CustomField |
| Return types | Documentation I could reach does not list the formula return types a roll-up accepts. By operation: SUM needs Number/Currency/Percent; MIN/MAX also Date/DateTime. Text and Checkbox formulas excluded | UNVERIFIED (training memory); orglet's v1.0 typing "per operation" already encodes this for plain fields |
| Note on DATEVALUE | DATEVALUE is not time-dependent; its presence in the official list is odd. Treat as documented but do not rely on it to reject a loaded org | [HELP] |

**Design rule that follows from the project's own premise:** a retrieve comes from an org that already passed Salesforce's
save-time validation, so the restrictions above are *authoring* rules. At load time orglet must **accept** a roll-up over
any formula that references only same-object fields and mark violations (cross-object ref, NOW/TODAY/current-user
globals) as `UNSUPPORTED:rollup-formula <reason>` instead of failing, so a documented-vs-real mismatch never blocks a real
org.

| Item | Class | Complexity | Notes |
|------|-------|------------|-------|
| Compute SUM/MIN/MAX/COUNT-with-filter over a **same-object** formula field: formulas are virtual in orglet (`isVirtual`, no column), so the v1.0 SELECT-first correlated subquery cannot aggregate them. App-side: load qualifying children, evaluate the compiled formula per child, aggregate with decimal.js, write the parent column | Table stake | **High** | Recompute triggers widen from "child summarized column changed" to "any field the formula reads changed"; reuse the formula dependency list from the compiler. Savepoint/replay logic from v1.0 (D-01/D-03) stays |
| Formula-valued roll-up as a **filter** field (criteria on a formula field) | Differentiator | Med | Same app-side evaluation, per child |
| Load-time classification of unsupported formulas (cross-object, volatile) with `UNSUPPORTED:rollup-formula` | Table stake | Low | sigha has no volatility tag; keep a small deny-list (NOW, TODAY, TIMENOW, `$User`/`$Profile`/… roots, any dotted parent path) in `@orglet/formula` |
| `migrate()` backfill of a formula-based roll-up | Differentiator | Med | Reuses D-10 one-shot backfill; the known "no re-backfill when the formula text changes" gap gets worse here, record it |
| Formula-in-SQL compilation | Anti-feature | Very high | Not needed; app-side is correct and consistent with read-time formula evaluation |

**Dependencies:** `@orglet/formula` compile output (referenced field list), `@orglet/engine` roll-up pipeline, SOQL read of
roll-up columns unchanged.

---

## F. Business standard objects

Flags below are the `Create/Update` properties and "Supported Calls" from [OR]. "Name field" is the field the Object
Reference marks `idLookup`/autonumber or documents as the record name. Key prefixes are [KP] (two lists agree) unless
marked. Feature-gated fields are marked `*` by my parser when their description cites Subscription Management, Revenue
Cloud, Industries, Field Service and similar; the README rule "skip fields that only exist when a feature is enabled"
cannot be applied mechanically, because a customer formula may reference a gated field. **Recommendation: generate all
documented fields, tag gated ones `featureGated: true`, and report unreferenced gated fields in the quiet category.**

| Object | Prefix | Name field | Calls (C/U/D/undelete/search) | Notes |
|--------|--------|-----------|-------------------------------|-------|
| Quote | `0Q0` | `Name` (225 chars, required) + auto `QuoteNumber` | C U D undelete search | No `OwnerId` in the field table [OR]. `IsSyncing` bool; `OpportunityId` create-only; `Pricebook2Id`; totals read-only (`Subtotal`, `TotalPrice`, `GrandTotal`, `Discount`, `LineItemCount`); address groups Billing/Shipping/QuoteTo/Additional with compound `…Address`; `Status` picklist, default Draft |
| QuoteLineItem | `0QL` | `LineNumber` (autonumber-like, defaulted) | C U D undelete search | `QuoteId` + `Product2Id` + `PricebookEntryId` create-only, `Quantity` and `UnitPrice` required, `OpportunityLineItemId` create-only nillable, `ListPrice`, `Subtotal`, `TotalPrice`, `Discount` |
| Order | `801` | `OrderNumber` (autonumber, max 30) | C U D undelete search | `OwnerId` Group/User; `AccountId`, `EffectiveDate` (required), `Status`+`StatusCode`, `Pricebook2Id` (defaulted, nillable only without price book), `TotalAmount` (read-only), `ContractId`, `OpportunityId`, `QuoteId` |
| OrderItem | `802` | `OrderItemNumber` (autonumber) | C U D, **no undelete, no search** | `OrderId` create-only, `Quantity`, `UnitPrice`, `PricebookEntryId`/`Product2Id` create-only nillable, `ListPrice`, `TotalPrice` read-only, `QuoteLineItemId`. "OrderItems directly deleted aren't sent to the recycle bin and can't be undeleted"; `getDeleted()` shows them until purged |
| AccountContactRelation | `07k` | none (no name field) | C U D | `AccountId`/`ContactId` create-only, `Roles` multipicklist, `IsActive`, `IsDirect` read-only, `StartDate`/`EndDate` |
| AccountTeamMember | `01M` | none | C U D | Needs account teams enabled; `AccountId`/`UserId` create-only; `TeamMemberRole`, `AccountAccessLevel`, `CaseAccessLevel`, `ContactAccessLevel`, `OpportunityAccessLevel`; `Title`, `PhotoUrl` read-only |
| OpportunityTeamMember | `00q` | `Name` (read-only, nillable) | C U D | "If you create a record and the OpportunityId and UserId combination matches an existing record, the system updates any modified fields and returns the existing record" (documented upsert-like create). Needs team selling |
| OpportunityContactRole | `00K` | none | C U D | `OpportunityId` create-only, `ContactId` create+update, `IsPrimary`, `Role`. "Allowed, though not recommended: several roles for the same contact" |
| OpportunitySplit | `049` | none | C U D | Needs opportunity splits enabled; `OpportunityId` create-only, `SplitOwnerId` create-only, `SplitPercentage` required, `SplitAmount` read-only, `SplitTypeId` (-> `OpportunitySplitType`, prefix `149`, not in the requested list, so a lookup target the generator must add or log), `SplitNote` |
| ContractLineItem | `811` | `LineItemNumber` | C U D undelete search | Needs service contracts/entitlements. `ServiceContractId` create-only, `PricebookEntryId`, `Quantity`, `UnitPrice`; `Status` read-only; `Product2Id` read-only |
| CaseContactRole | `03j` | none | C U D | Case lookup field is named **`CasesId`** in the docs (not `CaseId`); `ContactId` create+update, `Role` |
| CaseMilestone | `555` | none | **no create, no delete**; update, query, retrieve | `CaseId`, `MilestoneTypeId` read-only; only `CompletionDate` and `StartDate` updateable; `IsCompleted`, `IsViolated`, `TargetDate` and `TimeRemaining*` are computed. Entitlement-process driven |
| EmailMessage | `02s` | `Name` (read-only) | C U D undelete search | Requires Email-to-Case or Enhanced Email. `ParentId` (Case) create-only, `ActivityId` create-only, `FromAddress`, `ToAddress`, `CcAddress`, `Subject`, `TextBody`/`HtmlBody`, `Incoming`, `Status` (only New -> Read changes), `MessageDate`, `RelatedToId`. Limited to 50 custom fields. `…Ids` are junction id lists (`ToIds`, `CcIds`, `BccIds`, `ContentDocumentIds`) |
| ContentDocument | `069` | `Title` (updateable) | **no create**; delete, undelete, update, query, retrieve, search | Created implicitly by inserting a `ContentVersion` without `ContentDocumentId`; `LatestPublishedVersionId` read-only; `OwnerId` update-only; delete removes all versions [OR] |
| ContentVersion | `068` | `Title` (required) | C U (latest version, published only) **no delete**, search, upsert | `VersionData` (base64), `PathOnClient` (create-only), `ContentDocumentId` (create-only; omit to create a document), `FirstPublishLocationId` (create-only), `IsLatest`, `VersionNumber`, `Checksum`, `ContentSize`, `FileExtension`/`FileType` (derived), `IsMajorVersion`. "SOQL queries on ContentVersion return all versions". REST guide separately says ContentVersion "doesn't support updates" (a tip on the insert example) while [OR] lists `update()`: sources disagree |
| FeedItem | `0D5` | none | C U D search (no undelete) | `ParentId` polymorphic over a huge target list; `Body`, `Title`, `LinkUrl`, `Type` restricted picklist (only ContentPost, LinkPost, QuestionPost, TextPost are user-creatable, all others system-generated), `Status` Published / PendingReview, `IsClosed`, counters read-only. `ContentData` base64 create-only |
| Location | `131` | `Name` | C U D undelete search | Needs Field Service / Commerce / inventory feature; `LocationType` required and its picklist must have a value; `OwnerId` Group/User; `ParentLocationId`, `RootLocationId` (read-only), `Latitude`, `Longitude`, compound `Location`. In Apex the type is `Schema.Location` (naming collision, irrelevant for REST) |
| Address | `130` | `Name` (defaulted, not creatable) | C U D undelete search | "You can create an address only when creating a location"; `ParentId` create-only; street/city/state/country/postal/lat/long, compound `Address` |

Sources: [OR] sections Quote, QuoteLineItem, Order, OrderItem, AccountContactRelation, AccountTeamMember,
OpportunityTeamMember, OpportunityContactRole, OpportunitySplit, ContractLineItem, CaseContactRole, CaseMilestone,
EmailMessage, ContentDocument, ContentVersion, FeedItem, Location, Address. Prefixes [KP]; `ContentVersion 068`,
`ContentDocument 069`, `FeedItem 0D5`, `EmailMessage 02s`, `AccountTeamMember 01M` come from the FishOfPrey gist only plus a
secondary search hit, so double-check against `describeGlobal` docs if a second list appears. `OpportunitySplit` is
listed under `049` in the same gist.

### ContentVersion `VersionData` download

- REST: `GET /services/data/vXX.X/sobjects/{sObject}/{id}/{blobField}` "retrieves the specified blob field from an
  individual record and returns it as binary data" (sObject Blob Get). Documented objects with blob fields: Attachment,
  ContentNote, ContentVersion, Document, Folder, Note; documented example is `/sobjects/Document/{id}/body`. The response
  "isn't JSON or XML", content type of the stored file, and the resource "isn't compatible with Composite API
  requests". [REST] "Get Blob Data" and the resource list.
- Insert: multipart/form-data with a JSON `entity_content` part and a binary part whose `name` is the blob field
  (`VersionData`) and `filename`; limit 2 GB for ContentVersion (500 MB others); non-multipart base64 JSON limited to
  37.5 MB. A new `ContentVersion` without `ContentDocumentId` creates the parent `ContentDocument`. [REST] "Insert or
  Update Blob Data", [OR] ContentVersion usage.
- Query: selecting `VersionData` in SOQL returns the **URL** form (`/services/data/v…/sobjects/ContentVersion/{id}/VersionData`)
  rather than bytes in REST. This is how jsforce/simple-salesforce clients discover the download path. The doc
  statement "to download a document via the API, you must export the VersionData" is [OR]; the URL-in-query form is
  UNVERIFIED in the text I could read, but the field `VersionDataURL` (string) is documented. Treat as MEDIUM.
- SOAP/ Data Loader: base64 in the field (+37% size, 50 MB SOAP limit). [OR]

| Item | Class | Complexity | Notes |
|------|-------|------------|-------|
| Baseline v2 (field parity with [OR]) for all 18 objects, incl. DML flags from the Create/Update properties and Supported Calls (`INVALID_TYPE_FOR_OPERATION` on violation) | Table stake | Med (generator) | Per-field flags are free from the parser; prefixes, picklist values, lengths, `relationshipName`, `childRelationshipName` need a supplement table. Relationship names appear in [OR] "Relationship Name" lines |
| Lookup targets exist: Quote->Opportunity, OrderItem->Order, QuoteLineItem->Quote/PricebookEntry/Product2, ContractLineItem->ServiceContract/Asset/Location, CaseContactRole->Case, ContentDocument<->ContentVersion | Table stake | Low | Mutual `ContentDocument.LatestPublishedVersionId` <-> `ContentVersion.ContentDocumentId` is circular: needs deferred FK or a nullable first insert |
| ContentVersion insert -> auto-create `ContentDocument`; blob stored; `IsLatest`, `VersionNumber`, `ContentSize`, `Checksum`, `FileExtension` derived | Table stake | Med-High | Needs blob storage (bytea or `lo`), multipart parser on `/sobjects/ContentVersion` (jsforce uses it for `sobject.create` with `VersionData`? jsforce v3 sends base64 JSON; check the pinned conformance sha before building) |
| `GET /sobjects/ContentVersion/{id}/VersionData` binary download | Table stake | Low | Same handler can serve `Attachment/Document` later |
| ContentVersion SOQL returns the blob URL for `VersionData` | Table stake | Low | Shape-time rewrite, like `attributes.url` |
| `ContentDocumentLink` (the junction that makes a file visible on a record) | Gap | Med | Not in the requested list, yet `FirstPublishLocationId` and most real retrieves reference it. Flag to the roadmap; likely first `UNSUPPORTED:reference-target` the large org hits after this milestone |
| Quote <-> Opportunity sync (`IsSyncing`, `Opportunity.SyncedQuoteId`, line-item copy both ways) | Anti-feature (log `UNSUPPORTED:quote-sync`) | High | Fields exist [OR] ("Setting this field lets you start and stop syncing … the ID has to be for a quote that is a child of the opportunity"); the copy semantics are Help-only, not in [OR] |
| Quote/QuoteLineItem pricebook enforcement: line items need a quote `Pricebook2`; `PricebookEntry` must be in that pricebook; creating a line item increments the quote total; multicurrency code copied from parent | Differentiator | Med | All stated in [OR] Usage; cheap pipeline hooks |
| Order rules: create requires `StatusCode` Draft; activation = updating only `Status`; Draft orders deletable, Activated not; OrderItems need a price book on the Order | Differentiator | Med | [OR] Order Usage; implement as validation, not automation |
| `TotalAmount` / `Quote.TotalPrice` roll-ups as real roll-up columns | Differentiator | Med | Uses v1.0 roll-up engine over master-detail-like lookup; Order->OrderItem behaves like a master-detail ([OR] lists `OrderId` create-only non-nillable; the relationship type itself is UNVERIFIED) |
| Chatter semantics (FeedItem auto posts, tracked changes, mentions, `Type` generation) | Anti-feature | - | Provide a plain table; accept user-creatable types only; reject system types with a clear message (UNVERIFIED code) |
| Email-to-Case, entitlement-process milestones, team-selling sharing side effects, split totals must be 100% | Anti-feature | - | Mark objects as data-only; `OpportunitySplit` total rule is documented on `OpportunitySplitType` (revenue splits must total 100%), defer |
| AccountContactRelation auto-creation when `Contact.AccountId` set; `IsDirect` | Differentiator | Med | [OR]: created "immediately after the contact is saved"; implementable as an after-hook on Contact |

**Dependencies:** v1.0 baseline JSON loader and `hasOwner`, phase-3 DML flags, key-prefix persistence (standard prefixes
must not collide), roll-up engine, REST blob/multipart routing in `packages/api`, `Pricebook2`/`PricebookEntry`/
`Product2` baselines (exist), `Opportunity`, `Case`, `Contact`, `Account`, `Asset`, `ServiceContract`, `User`.

---

## G. `orglet check` for a 3 000-field org

Today (`packages/cli/src/main.ts`): one line of totals, provisional custom prefixes, then every warning as a flat
`warning: …` line on stderr in discovery order; `--strict` returns 1 on any warning. Formula failures are one warning per
formula field, so one missing global produces hundreds of lines (this is the pain the milestone names).

This is a tooling-UX question, not a Salesforce behaviour; the patterns below are conventions (ESLint formatters and
`--max-warnings`, TypeScript's "Found N errors in M files" closing line, Terraform's plan summary line), reference only
(https://eslint.org/docs/latest/use/formatters/, https://eslint.org/docs/latest/use/command-line-interface). No Salesforce
claims depend on them.

### What the report should contain

| Section | Content | Class | Complexity |
|---------|---------|-------|------------|
| 1. Census | Objects (standard modelled / custom / `__mdt` / settings / unmodelled-but-referenced), fields, formulas, roll-ups, validation rules, record types, custom-metadata rows, labels; one block of 8-10 lines | Table stake | Low |
| 2. Verdict line | `RESULT: 214 warnings in 6 areas (38 root causes), 1 140 informational`, plus exit code semantics | Table stake | Low |
| 3. Per-area summary table | `area | root causes | affected items | example` sorted by affected count, using the existing `UNSUPPORTED:<area>` prefix as the key | Table stake | Low |
| 4. Root-cause grouping | A formula that fails because a *referenced field* failed is a cascade: print once under its root cause ("`Account.Region__c` skipped: `$Permission` unsupported; blocks 17 formulas, 3 roll-ups, 2 validation rules") with dependents only in `--verbose` | Table stake | **Med-High** (needs a dependency graph from `FormulaRegistry`; cascade today is a flat list) |
| 5. Missing-reference census | "Referenced but not modelled" objects/fields with referrer counts, split from "modelled but unreferenced" | Table stake | Med |
| 6. Quiet category | Standard system objects nothing references (the milestone's informational bucket): count only, names under `--verbose`; never affects `--strict` | Table stake | Low |
| 7. Top-N | Top 10 objects by warning count; top 10 distinct messages | Differentiator | Low |
| 8. Machine format | `--format json` (stable `{code, area, severity, object, field, rootCause, dependents}`), stdout for the summary and stderr for details | Differentiator | Low-Med |
| 9. Counts-only mode (`--summary`) | Only area counts and census numbers: no object, field or label names. The acceptance wording says the large org is "reported, if at all, as warning counts per area"; this mode makes that output safe to paste | **Differentiator, project-critical** | Low |
| 10. Baseline diff | `--baseline report.json` -> new / fixed / unchanged, so a team can ratchet down on a 3 000-field org | Differentiator | Med |
| 11. Severity and exit codes | error (load fails) / warning (`--strict` fails) / info (never fails); `--max-warnings N` for gradual adoption | Differentiator | Low |
| Deterministic ordering | sort by area, object, field; no timestamps in the default output so CI diffs are stable | Table stake | Low |

Anti-features: interactive TUI, auto-fix suggestions that edit metadata, uploading reports anywhere, colour as the only
severity signal (honour `NO_COLOR`), listing every field's resolved type.

**Dependencies:** warning producers must emit structured records (`{area, severity, object, field, message, cause?}`) instead
of strings. `FormulaRegistry.warnings` and `loadOrgSchema().warnings` are string arrays today; a structured shim that
parses the existing `UNSUPPORTED:<area>` prefix can bridge phase by phase. Root-cause grouping depends on formula dependency
edges, which feature A-C resolution also needs, so build the graph once.

---

## Feature dependency graph (v1.1)

```
Baseline v2 generator (F) -> OwnerId narrowing (D) -> plain Owner.X compiles (formula)
Baseline v2 (F)           -> UserRole fields present -> $UserRole (C)
Custom settings parse (B) -> $Setup (B,C)  -- needs $User/$Profile binding (exists)
CMT parse (A) + MetadataRelationship (A) -> $CustomMetadata (A,C)
Custom labels parse (C)   -> $Label (C)
GlobalResolver (C)        -> all of $Setup, $CustomMetadata, $Label, $Api, $UserRole
Formula dependency list (compiler) -> roll-up over formulas (E) and check root causes (G)
Structured warnings (G)   -> every other feature's UNSUPPORTED:* output
Key-prefix persistence    -> mdt `m00…` series (A), standard prefixes from [KP] (F)
```

## MVP recommendation for the roadmap

1. **Structured warnings + GlobalResolver foundation** (G4, C-shared): both are prerequisites for measuring progress on
   the large org and for every global.
2. **OwnerId narrowing + `$UserRole` + `$Api` + `$Label`** (D, C): small, data-driven, high cascade payoff.
3. **Baseline v2 generator** from the PDF, incl. DML flags and prefix supplement (F): largest volume but mechanical;
   ship object-by-object with the order Order/OrderItem/Quote/QuoteLineItem first (the most referenced), files last.
4. **Custom metadata types + MetadataRelationship + `$CustomMetadata`** (A).
5. **Custom settings + `$Setup`** (B).
6. **Roll-up over formula fields** (E): last, highest complexity, depends on the formula dependency list.
7. **ContentVersion blob upload/download** (F) as its own late phase because it needs multipart + blob storage.

Defer / do not build: Quote<->Opportunity sync, Order activation automation, FeedItem generation, Email-to-Case,
entitlement milestones, packaging visibility, custom-settings list in `$Setup`, translation files.

## Items to verify before the corresponding phase starts

- `customSetting` value in the describe of an `__mdt` (flag, UNVERIFIED).
- Exact REST error code and HTTP status for DML on `__mdt` and for a non-supporting queue owner.
- Whether a null user-level custom-setting field falls through to the profile/org value in `$Setup`.
- Key prefixes for AccountTeamMember (`01M`), ContentVersion (`068`), ContentDocument (`069`), FeedItem (`0D5`), EmailMessage
  (`02s`), OpportunitySplit (`049`): single-list MEDIUM; custom-setting prefix series: no source.
- Roll-up-accepted formula return types (the exact [HELP] text could not be fetched; JS-rendered).
- jsforce/simple-salesforce wire form for ContentVersion create with `VersionData` (inspect the pinned SDK sources in
  `conformance/` before designing the multipart route).

## Sources

All URLs are in the source key at the top. Reproduction note: the PDFs were downloaded with
`curl -sL -A "Mozilla/5.0" https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/<name>.pdf` (names:
`object_reference`, `api_meta`, `api_rest`, `api_tooling`, `salesforce_soql_sosl`) and read with `pdftotext -layout`.
No data from a real org was used.
