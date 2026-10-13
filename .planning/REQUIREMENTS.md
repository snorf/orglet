# Requirements: orglet — Milestone v1.1 (real-org fidelity)

**Defined:** 2026-10-12
**Core Value:** A Salesforce client pointed at orglet cannot tell the difference for the surface
orglet claims to support, and anything it does not support is logged as `UNSUPPORTED:<area>`
rather than faked.

**Milestone goal:** A large, real enterprise-org retrieve loads with zero warnings for everything it
itself references. Standard objects nothing references are reported as information, not warnings.

Sources: `.planning/research/SUMMARY.md` (v1.1 research), backlog items 999.1–999.7, and the author's
local load of a large real-org retrieve (private; reported only as warning counts per area).
Constraints carried over from v1.0: public documentation and open-source SDK source only, never a
real org as benchmark, Apache-2.0 with OSI dependencies, public fixtures with generic names, Level 1
data only in repo and CI.

## v1 Requirements

Requirements for this milestone. Each maps to a roadmap phase. "User" is a developer running
orglet or a Salesforce client (`jsforce`, `simple-salesforce`, curl) talking to it.

### Upgrade safety

- [ ] **MIGR-01**: A database created with the v1.0 baseline, containing Group-owned and `--import`
  rows, upgrades to the v1.1 baseline with `orglet up` without data loss, on pglite and Postgres 16,
  with the resulting warning set asserted by a test.
- [x] **MIGR-02**: When a narrowed `OwnerId` (or any new single-target lookup) would add a foreign
  key on a populated column that holds rows violating it, `migrate()` names every offending table,
  column and row count, logs one `UNSUPPORTED:schema-fk` warning per column, skips that foreign key
  and completes; it never deletes or rewrites data.
- [ ] **MIGR-03**: The baseline generator refuses to emit a new MasterDetail (NOT NULL) column on an
  object that existed in v1.0, and a v1-vs-v2 diff gate fails when a v1.0 field disappears or
  narrows without an allowlisted reason, so an upgrade never leaves permanent `schema-drop` or
  `schema-narrow` warnings.
- [x] **MIGR-04**: `migrate()` skips `CREATE INDEX` for indexes that already exist, so a large
  baseline upgrade is idempotent and `orglet up` on an up-to-date database stays silent.

### Baseline v2 (standard objects and fields)

- [ ] **BASE2-01**: A deterministic generator under `scripts/` produces the baseline JSON for a listed
  set of standard objects from a vendored, licence-attributed snapshot of Salesforce's published
  object catalogue (Apache-2.0), cross-checked at generation time against the public Object Reference
  PDF; a flag is "verified" when both agree and otherwise carries a provenance mark; disagreements
  and hand facts (key prefix, precision/scale, compound fields, standard value sets, owner targets)
  live in a committed `overrides.json` with a reason per entry; the output contains no documentation
  prose; CI fails when regeneration differs from the committed files.
- [ ] **BASE2-02**: Regenerating the existing 35 baseline objects first reproduces their current
  shape (no-op diff), then adds every documented API field with its type, length, nillable,
  createable, updateable and defaulted-on-create flags, so `orglet check` on a retrieve that uses
  those fields reports zero `UNSUPPORTED:standard-field` for them.
- [ ] **BASE2-03**: Feature-gated fields (available only when an org feature is enabled) are included
  as nullable fields tagged `featureGated` in the baseline JSON and visible in describe, replacing
  the v1.0 rule of skipping them.
- [ ] **BASE2-04**: `OwnerId.referenceTo` is defined per object from the Object Reference (User-only
  on Account, Contact, Opportunity, Contract, Asset, Campaign, Individual, Solution, ContentVersion;
  User and Group on Case, Lead, Task, SocialPost, Order, Location, ContactRequest, WorkOrder,
  ServiceAppointment, OperatingHours, ServiceContract; Calendar and User on Event; none on Quote,
  QuoteLineItem, Entitlement, Product2, Pricebook2, PricebookEntry, EmailMessage, FeedItem,
  Address), so plain `Owner.X` formula traversal and `Owner.X` SOQL compile on User-only objects
  while polymorphic behaviour from v1.0 is unchanged on queue-enabled objects.
- [x] **BASE2-05**: Every standard-object key prefix in the baseline is either confirmed by two
  independent public sources or stored as `null` with a source label; an object with a null prefix
  still loads, describes and is reference-checked, and the generator never invents a prefix.
- [ ] **BASE2-06**: The 18 business objects a typical sales/service org references exist as baseline
  objects with documented key prefix (or null per BASE2-05), name field, system fields, documented
  API fields and explicit create/update/delete/undelete flags: Quote, QuoteLineItem, Order,
  OrderItem, AccountContactRelation, AccountTeamMember, OpportunityTeamMember,
  OpportunityContactRole, OpportunitySplit, ContractLineItem, CaseContactRole, CaseMilestone,
  EmailMessage, ContentDocument, ContentVersion, FeedItem, Location, Address. Blob fields
  (`ContentVersion.VersionData`) are omitted and listed in the generator report.
- [ ] **BASE2-07**: DML against each of the 18 objects respects its documented flags (OrderItem no
  undelete; CaseMilestone no create or delete; ContentDocument no create; ContentVersion no delete)
  and violations return `INVALID_TYPE_FOR_OPERATION` as in v1.0; lookups to any of them with an
  invalid Id are rejected with `INVALID_CROSS_REFERENCE_KEY`.
- [ ] **BASE2-08**: `orglet check` distinguishes a standard object that is referenced (by a lookup,
  roll-up, formula or validation rule in the retrieve or baseline) from one that is not: a
  referenced-but-unmodelled object stays an `UNSUPPORTED:reference-target` warning; an unreferenced,
  unmodelled standard object is reported in an informational category that never fails `--strict`.

### Custom metadata types and custom settings

- [ ] **CMDT-01**: A custom metadata type (`__mdt`) in the retrieve loads as a read-only object with
  the documented system fields (`DeveloperName`, `MasterLabel`, `Label`, `Language`,
  `NamespacePrefix`, `QualifiedApiName`, `IsProtected`, `SystemModstamp`), a key prefix from the
  `m00` series allocated and persisted through the existing key-prefix mechanism, and describe
  flags that match the documented supported calls (describe, query, retrieve only).
- [ ] **CMDT-02**: Records in `customMetadata/<Type>.<Record>.md-meta.xml` are seeded into the
  type's table at `orglet up` with deterministic Ids (stable across reloads, keyed by type and
  `DeveloperName`), values coerced by the field's declared type (`"007"` stays text, `xsi:nil` is
  null, a missing field warns once), and a full sync on reload (changed rows updated, removed
  records deleted).
- [ ] **CMDT-03**: `MetadataRelationship` fields load instead of being skipped: a relationship to
  another `__mdt` resolves to that record's Id in a second pass, a relationship to an entity or
  field definition stores the qualified API name, and `Rel__r.QualifiedApiName` is selectable in
  SOQL as an alias of the stored string; a dangling target warns and leaves the field null.
- [ ] **CMDT-04**: SOQL and REST describe/retrieve of `__mdt` objects work through jsforce and
  simple-salesforce; create, update and delete through the data API are rejected with a documented
  Salesforce error code (or `INVALID_TYPE_FOR_OPERATION` where none is documented) and never
  silently accepted.
- [ ] **CSET-01**: A custom object carrying `customSettingsType` (List or Hierarchy) loads as a custom
  setting: describe reports `customSetting: true`, the object has no `OwnerId`, a hierarchy setting
  has `SetupOwnerId` (Organization, Profile or User) with uniqueness enforced as `DUPLICATE_VALUE`,
  and `orglet check` states that custom-setting data is not part of a retrieve.
- [ ] **CSET-02**: Custom labels in `labels/CustomLabels.labels-meta.xml` load onto the org schema
  (name, value, language, category) so `$Label` formulas resolve; translations are out of scope.

### Formulas

- [ ] **FORM-01**: The vendored sigha is resynced to a pinned full upstream commit (or a named fork
  commit recorded in `VENDOR.md` while the upstream PR is open) that accepts unary `!` as NOT and the
  `Relationship:Object.Field` colon syntax; `sync-sigha.sh` runs on macOS and Linux; the formula
  corpus pass count is compared against the v1.0 baseline (6 312 cases) and may not regress.
- [ ] **FORM-02**: `Owner:User.Field` / `Owner:Queue.Field` (and any `Rel:Object.Field`) compile
  against the named target of a polymorphic lookup and evaluate to blank when the row's actual
  target is a different object; `Queue` is accepted as an alias of `Group`; a qualifier naming an
  object the lookup cannot reference is a compile error with Salesforce's wording.
- [ ] **FORM-03**: `$UserRole.<field>` resolves from the running user's role at evaluation time (blank
  when the user has no role) and `$Api.Partner_Server_URL_<n>`, `$Api.Enterprise_Server_URL_<n>` and
  `$Api.Session_ID` resolve to the running server's URLs and the request's session.
- [ ] **FORM-04**: `$Label.<Name>` and `$CustomMetadata.<Type__mdt>.<Record>.<Field__c>` are resolved
  at compile time from the loaded labels and custom-metadata records; an unknown label, type or field
  is a compile error with Salesforce's wording, and an unknown record evaluates blank with one
  aggregated `UNSUPPORTED:custom-metadata-record` warning.
- [ ] **FORM-05**: `$Setup.<Setting__c>.<Field__c>` resolves hierarchy custom settings at evaluation
  time per field in the order user, profile, organization; `$Setup` on a list custom setting and
  `$Permission.<name>` remain explicit `UNSUPPORTED:formula-global` warnings with the reason stated.

### Roll-ups over formula fields

- [ ] **ROLL2-01**: A roll-up (COUNT, SUM, MIN, MAX) whose summarized field or filter field is a
  same-object, non-volatile formula (no cross-object path, no `NOW`/`TODAY`/`TIMENOW`, no `$User`,
  `$Profile`, `$Setup`, `$Api`, `$Label` roots) loads, recomputes in the save pipeline exactly as a
  stored-field roll-up does, and is backfilled once at upgrade; a roll-up over a formula outside that
  set warns `UNSUPPORTED:rollup-formula` and skips the field instead of failing the load.

### `orglet check` report

- [ ] **CHECK-01**: `orglet check` prints a census (objects, fields, custom and standard counts), a
  one-line verdict, a per-area table keyed by the `UNSUPPORTED:<area>` token, and groups cascaded
  formula failures under their root cause (a field or object skipped upstream) while keeping every
  dependent listed and both counts stated; ordering is deterministic and covered by a snapshot test on
  `examples/acme`; the `warning:` line format from v1.0 is unchanged.
- [ ] **CHECK-02**: `orglet check --summary` prints only the census, the verdict and per-area counts
  (no object, field or rule names), and `orglet check --json` emits the same report as structured
  JSON including the informational category; `--strict` exits 1 on any warning and 0 on
  informational entries alone.

### Acceptance

- [ ] **ACC2-01**: A public fixture `examples/enterprise`, authored from the feature documentation
  under generic names, exercises every v1.1 category (custom metadata with relationships, hierarchy
  and list custom settings with a seed script, custom labels, the new globals, colon-syntax and `!`
  formulas, a roll-up over a formula field, lookups to the 18 business objects, OwnerId on User-only
  and queue-enabled objects) and runs in CI with `orglet check --strict` exiting 0 and the full
  conformance set green against it.
- [ ] **ACC2-02**: `conformance/describe-check`, `poly-check` and `rollup-check` are extended for the
  new objects and `__mdt`/custom-setting describe through both SDKs, run by `conformance/run-all.sh`,
  and both existing SDK suites stay green with every exclusion still classified.
- [ ] **ACC2-03**: The author's Developer Edition retrieve still loads with `orglet check --strict`
  exiting 0, and the author's large real-org retrieve, run locally only, reports zero warnings for
  everything it references; its result is recorded in `conformance/README.md` as counts per area
  only, never as names.

## v2 Requirements

Deferred to later milestones. Tracked but not in the current roadmap.

### Content and files

- **FILE-01**: `ContentVersion.VersionData` upload (multipart) and download
  (`GET /sobjects/ContentVersion/{id}/VersionData`), `ContentDocumentLink`
- **FILE-02**: Attachment and Document blob fields

### Events and platform

- **EVT-01**: Platform events (`__e`) as publish-only objects; CDC / Platform Events to Kafka, SQS,
  webhooks; Pub/Sub API (backlog 999.8)
- **SEC-01**: Profiles, permission sets, custom permissions (`$Permission`), FLS, OWD enforcement
- **FLOW-01**: Flow interpreter
- **APEX-01**: Apex runtime behind `TriggerExecutor`
- **UI-01**: UI API and LWC/SLDS front end

### Headless completeness (carried from v1.0)

- **HEAD-01**: Task and Event as full objects with polymorphic `WhoId`/`WhatId` (Event owner
  `Calendar` target)
- **HEAD-02**: SOSL search
- **HEAD-03**: Metadata API zip import
- **HEAD-04**: Compound fields (Address, Name) selectable in SOQL
- **HEAD-05**: Record types per picklist value sets
- **CHECK-03**: `orglet check --baseline <report.json>` diff and `--max-warnings N`
- **CMDT-05**: Queues (`queues/*.queue-meta.xml`) loaded as Group rows with owner-eligibility checks
- **CSET-03**: `$Setup` on list custom settings, `$Label` translations, per-user language
- **ROLLX-01**: Force-recalculation helper (`orglet rollup --recompute`) for definition changes
- **ROLLX-02**: More than 25 roll-ups per object
- **BULKX-01**: Asynchronous Bulk processing; **BULKX-02**: PK chunking
- **HEIM-01**: Heimdall end-to-end backup run against orglet (backlog 999.9; needs FILE-01)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| DML on custom metadata via the data API | Salesforce rejects it; orglet rejects it with an error, never emulates Metadata API deploys |
| Quote ↔ Opportunity sync, Order activation automation, FeedItem generation, Email-to-Case, entitlement milestones | Platform automations behind the objects; v1.1 models the objects, not the automations (`UNSUPPORTED:quote-sync` etc. where a client could notice) |
| Translating formulas to SQL, generated columns for formula roll-ups | Formula engine stays TypeScript; roll-up materialisation feeds the existing SQL aggregate instead |
| In-memory custom-metadata store | Postgres is the only datastore (v1.0 decision) |
| Scraping developer.salesforce.com HTML | Pages return 403 to tools; the published dataset and PDFs are the public sources |
| Any real-org describe as baseline input | Developer MSA; the author's own DE describe stays a personal cross-check, never a generator input |
| Fixture content derived from a real org | Fixtures are authored from feature documentation under generic names |
| Behaviour-diffing against a real Salesforce org | Developer MSA (unchanged from v1.0) |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| MIGR-01 | Phase 8 | Pending |
| MIGR-02 | Phase 8 | Complete |
| MIGR-03 | Phase 9 | Pending |
| MIGR-04 | Phase 8 | Complete |
| BASE2-01 | Phase 9 | Pending |
| BASE2-02 | Phase 9 | Pending |
| BASE2-03 | Phase 9 | Pending |
| BASE2-04 | Phase 9 | Pending |
| BASE2-05 | Phase 8 | Complete |
| BASE2-06 | Phase 10 | Pending |
| BASE2-07 | Phase 10 | Pending |
| BASE2-08 | Phase 10 | Pending |
| CMDT-01 | Phase 11 | Pending |
| CMDT-02 | Phase 11 | Pending |
| CMDT-03 | Phase 11 | Pending |
| CMDT-04 | Phase 11 | Pending |
| CSET-01 | Phase 11 | Pending |
| CSET-02 | Phase 11 | Pending |
| FORM-01 | Phase 12 | Pending |
| FORM-02 | Phase 12 | Pending |
| FORM-03 | Phase 12 | Pending |
| FORM-04 | Phase 12 | Pending |
| FORM-05 | Phase 12 | Pending |
| ROLL2-01 | Phase 13 | Pending |
| CHECK-01 | Phase 14 | Pending |
| CHECK-02 | Phase 14 | Pending |
| ACC2-01 | Phase 14 | Pending |
| ACC2-02 | Phase 14 | Pending |
| ACC2-03 | Phase 14 | Pending |

**Coverage:**
- v1 requirements: 29 total
- Mapped to phases: 29
- Unmapped: 0

---
*Requirements defined: 2026-10-12*
*Last updated: 2026-10-12 after v1.1 roadmap creation*
