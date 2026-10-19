# Phase 11: Custom Metadata, Custom Settings & Labels - Context

**Gathered:** 2026-10-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Custom metadata types (`__mdt`) in the retrieve load as read-only objects with their
`customMetadata/<Type>.<Record>.md-meta.xml` records seeded as Postgres rows at `orglet up`,
`MetadataRelationship` fields load instead of being skipped, custom objects carrying
`customSettingsType` load as List/Hierarchy custom settings, and `labels/CustomLabels.labels-meta.xml`
lands on the loaded org schema. Everything is reachable through describe, SOQL and REST retrieve via
jsforce and simple-salesforce; data-API DML on `__mdt` is rejected, never accepted.

Not in this phase: the formula globals `$Label`, `$CustomMetadata`, `$Setup` (Phase 12, FORM-04/05);
the `examples/enterprise` fixture and describe-check extension for `__mdt`/settings (Phase 14, ACC2);
label translations, `$Setup` on list settings, queues (v2: CSET-03, CMDT-05); any deploy path for
custom metadata (out of scope, REQUIREMENTS.md).

Requirements: CMDT-01, CMDT-02, CMDT-03, CMDT-04, CSET-01, CSET-02.

</domain>

<decisions>
## Implementation Decisions

### Record Ids, key prefixes and reload
- **D-01:** A custom-metadata record's Id is derived, not allocated: `<m00-series prefix>` + 12
  base62 characters from a hash of `(type API name, DeveloperName)`, then the existing case-safe
  suffix (`ids.ts`). No new state in `_orglet`. The same retrieve yields the same Id in every
  environment and after `orglet reset`. A record removed and later re-added gets its Id back. A hash
  collision between two records of one type is a hard load error (named records), not a warning.
  Matching of type name and DeveloperName for the hash is case-insensitive (lower-case both).
- **D-02:** `__mdt` key prefixes use the existing persisted mechanism (`_orglet.key_prefixes`,
  `planKeyPrefixes` / `reconcileKeyPrefixes` in `packages/schema/src/prefixes.ts`) with a separate
  pool `m00..mzz` instead of `a00..azz`. Precedence is unchanged (existing rows > `--key-prefixes`
  mapping > provisional > next free). `--key-prefixes` accepts `__mdt` names; a `__mdt` mapped into
  the `a` range, or a `__c` mapped into the `m` range, is a `KeyPrefixError`. `orglet check` lists
  `Foo__mdt  m00  (provisional)` beside the custom objects; `reset --drop-prefixes` clears them too.
  Phase 8's `validateBaseline()` `m0*` guard for standard objects stays as is.
- **D-03:** Sync on reload is a full sync per type in one transaction keyed by `DeveloperName`:
  changed rows updated (Id kept by construction of D-01), new rows inserted, rows whose record file
  is gone deleted (hard delete, no `IsDeleted`). It runs on every `up`, including `--import`.
- **D-04:** `orglet up` prints one summary line on stdout after the sync, always, respecting
  `--quiet`: `custom metadata: <N> records in <M> types (<a> added, <b> updated, <c> removed)`.
  Removed records are not named. Same style as the `assigned key prefix ...` lines.
- **D-05:** Record-file anomalies warn and load, never abort:
  - record file for a type that is not in `objects/` (or is not `__mdt`): the record is skipped with
    one `UNSUPPORTED:custom-metadata-record` warning naming the file;
  - `<values>` for a field the type does not declare: value dropped, one warning per type+field;
  - a value that cannot be coerced to the declared field type, or a picklist value outside the
    declared set: field stored as null, one warning per type+field (not per record);
  - all of these are `warning:` lines counted by `--strict`. Values are coerced by the declared
    `FieldDef` type, never by `xsi:type`: `"007"` in a Text field stays `"007"`, `xsi:nil="true"`
    is null, an absent field is null.

### MetadataRelationship fields
- **D-06:** `MetadataRelationship` becomes a loaded field type instead of a `field-type` skip.
  Target kind comes from `<referenceTo>`: another `__mdt`, `EntityDefinition` or `FieldDefinition`.
- **D-07:** mdt-to-mdt: a Lookup-shaped `char(18)` column, describe `type: reference`,
  `referenceTo: ["Other__mdt"]`, `relationshipName` per the `__c -> __r` rule, ordinary SOQL JOIN so
  `Rel__r.DeveloperName`, `Rel__r.MasterLabel` etc. work. No Postgres FK: the seed resolves the
  record file's target DeveloperName to an Id in a second pass after all types are seeded (cycles
  between types are fine). A target record that does not exist is stored null with one
  `UNSUPPORTED:custom-metadata-record` warning naming type, field and target.
- **D-08:** Entity/field-definition targets: describe `type: reference` with
  `referenceTo: ["EntityDefinition"]` or `["FieldDefinition"]` and a `relationshipName`; the stored
  value is the qualified API name string as written in the record file (`Account`,
  `Project__c`, `Account.Industry`). `EntityDefinition`/`FieldDefinition` are not modelled as
  objects. The researcher verifies the describe spelling (`type`, `referenceTo`, `relationshipName`)
  against the Object Reference / REST docs; if nothing documents it, the Lookup spelling is used and
  recorded as orglet's choice.
- **D-09:** A target is dangling when it is not in the loaded `OrgSchema`: the object (for
  `EntityDefinition`) or object and field (for `FieldDefinition`) must be modelled, matched
  case-insensitively. Dangling stores null with one warning per type+field+target in the
  `reference-target` family (`UNSUPPORTED:reference-target`). An unmodelled standard object is
  therefore dangling, by design (orglet never points at something it cannot answer for).
- **D-10:** In SOQL, `Rel__r.QualifiedApiName` on an entity/field-definition relationship is an
  alias of the stored string (selectable, filterable, sortable like a text column). Any other path
  through such a `Rel__r` (`Label`, `DeveloperName`, nested paths) is rejected: HTTP 400, errorCode
  `INVALID_FIELD`, message prefixed `UNSUPPORTED:entity-definition` stating that only
  `QualifiedApiName` is selectable on that relationship.
- **D-11:** `<metadataRelationshipControllingField>` is parsed and ignored silently (it is a Setup-UI
  filter, not data). No warning, no describe key.

### Read-only surface and describe of `__mdt`
- **D-12:** DML refusal reuses `DmlEngine.refuse()` with `INVALID_TYPE_FOR_OPERATION` (Phase 3
  D-09, Phase 8 D-10), message `entity type Foo__mdt does not support <insert|update|delete|upsert|undelete>`,
  HTTP 400. Researcher checks whether Salesforce documents a different code for custom-metadata DML
  through the data API; only a documented code may replace it.
- **D-13:** `__mdt` objects are refused even in import mode (`orglet up --import`). This is a
  deliberate, documented deviation from Phase 3 D-08: the record files are the only source of
  `__mdt` rows and D-03's sync would overwrite imported rows anyway. Implemented as one explicit
  custom-metadata check in `refuse()` ahead of the `importMode` early return, with a comment citing
  this decision.
- **D-14:** Bulk API 2.0 ingest jobs on a `__mdt` object are rejected when the job is created
  (`POST /jobs/ingest`), HTTP 400 with the same `INVALID_TYPE_FOR_OPERATION` message, so a job that
  can never succeed is never accepted. Bulk query jobs on `__mdt` are allowed. Composite and sObject
  Collections requests go through the engine and get the per-record refusal like plain REST.
- **D-15:** Describe flags on `__mdt` follow the documented Supported Calls strictly, everything
  else false: `createable`, `updateable`, `deletable`, `undeletable`, `searchable`, `mergeable`,
  `triggerable`, `layoutable`, `activateable`, `feedEnabled`: false; `queryable`, `retrieveable`,
  `custom`: true; `customSetting`: false unless the researcher finds a source stating otherwise;
  `keyPrefix`: the `m` prefix. Each value that differs from a `__c` object's gets a code comment with
  the source or "orglet choice". No `OwnerId`, no `Name`, no `IsDeleted`, `hasOwner: false`.
- **D-16:** System fields on `__mdt`: `Id`, the eight documented fields (`DeveloperName`,
  `MasterLabel`, `Label`, `Language`, `NamespacePrefix`, `QualifiedApiName`, `IsProtected`,
  `SystemModstamp`) plus the audit fields `CreatedDate`, `CreatedById`, `LastModifiedDate`,
  `LastModifiedById` as on every other object (set to the bootstrap admin user and the seed
  timestamp; `LastModifiedDate`/`SystemModstamp` advance when a sync updates the row). `__mdt`
  gets its own system-field variant in the metadata package (no `Name`, no `OwnerId`, no
  `IsDeleted`). `Label` always equals `MasterLabel`; `QualifiedApiName` is
  `NamespacePrefix__DeveloperName` or `DeveloperName` when there is no namespace;
  `NamespacePrefix` is null in a source retrieve. Researcher settles the `Language` default
  (`en_US` is the working assumption) and whether `Label` describes as `picklist` or `string`.

### Custom settings
- **D-17:** A `CustomObject` with `customSettingsType` (`List` or `Hierarchy`) loads as a custom
  setting: describe `customSetting: true`, `hasOwner: false`, no `OwnerId` column or field. Every
  other flag and the DML surface are those of an ordinary custom object (rows are real data, DML
  works, SOQL works). `visibility` is parsed and ignored.
- **D-18:** Hierarchy settings get `SetupOwnerId`: a polymorphic lookup to `Organization`,
  `Profile`, `User`, validated with `matchTargetByPrefix` like other lookups
  (`INVALID_CROSS_REFERENCE_KEY` on a wrong type), with a unique index so a second row for the same
  `SetupOwnerId` fails `DUPLICATE_VALUE` through the existing 23505 mapping. An insert that omits
  `SetupOwnerId` defaults it to the bootstrap `Organization` Id (org level is the documented
  default). List settings have no `SetupOwnerId`.
- **D-19:** Custom settings share the custom-object prefix pool `a00..azz` and are persisted
  exactly like `__c` objects (the series is undocumented; sharing is orglet's choice, recorded as
  such). Both kinds keep the `Name` field: required and unique per setting on List, optional on
  Hierarchy, unless the researcher finds a documented difference.
- **D-20:** `orglet check` reports settings on one `info:` line on stdout, printed always, silent
  with `--quiet`, never counted by `--strict`, same `Diagnostic` severity and mechanism as Phase 10
  D-08: `info: <N> custom settings loaded without data (custom-setting data is not part of a retrieve): A__c, B__c` (sorted).
  No `UNSUPPORTED:` prefix: this is a fact about the retrieve format, not a gap in orglet.

### Custom labels
- **D-21:** `labels/CustomLabels.labels-meta.xml` loads onto the org schema as `OrgSchema.labels`
  (or an equivalent read-only accessor): `fullName`, `value`, `language`, `categories`, `protected`,
  `shortDescription`, with case-insensitive lookup by `fullName`. `labels` joins the `REPEATED`
  element set in the XML reader. Not an sObject, no table, nothing in describe (Salesforce exposes
  labels only through the Tooling API). Consumers are Phase 12 (`$Label`) and `orglet check`, whose
  summary counts them.
- **D-22:** A duplicated `fullName` keeps the first occurrence and warns once
  (`UNSUPPORTED:custom-label`, counted by `--strict`). `translations/` is ignored in this phase (v2
  CSET-03). `<value>` whitespace and XML entities are preserved as decoded by the parser.

### Claude's Discretion
- Where the seed step lives (research suggested `packages/engine/src/seed.ts` between `migrate` and
  `bootstrapOrg`) and whether it writes through `Store` or direct SQL, as long as it bypasses
  `DmlEngine` flags like `bootstrapOrg` does.
- The hash function and exact base62 slicing for D-01, provided the Id is 18 characters, case-safe
  and stable; the collision check lives in the seed step.
- Shape of the parsed record (`SourceProject` slot name, `CustomMetadataRecord` type) and how
  `customSettingsType` and `MetadataRelationship` extend `SourceObject`/`FieldType`.
- Whether `__mdt`/custom-setting kinds are modelled as an `objectKind` on `SObjectDef` or as
  booleans (`customMetadata`, `customSetting`), as long as describe keys stay the Salesforce set.
- Unit-test fixture placement: extend `examples/acme` with one `__mdt` type (with a relationship),
  one hierarchy setting, one list setting and a `CustomLabels` file, or a dedicated metadata test
  fixture; the Phase 5 blast-radius rule for `examples/acme` applies.
- Ordering of the seed relative to `reconcileKeyPrefixes` (prefix must be final before Ids are
  derived) and transaction boundaries.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and roadmap
- `.planning/REQUIREMENTS.md` §"Custom metadata types and custom settings" (CMDT-01..04, CSET-01..02),
  §"Formulas" FORM-04/05 (Phase 12 consumer of labels and records), §"Out of Scope" rows on DML on
  custom metadata and the in-memory store, §"Deferred to v2" CMDT-05 / CSET-03.
- `.planning/ROADMAP.md` §"Phase 11" (goal, success criteria 1-5, research flag).

### Milestone research (facts, source tags and open questions for this area)
- `.planning/research/FEATURES.md` ~lines 44-101 (custom metadata), 112-133 (custom settings),
  183-196 (labels), 414-420 (verification list).
- `.planning/research/PITFALLS.md` C1-C5 (Ids, `m0x` prefix, MetadataRelationship, value parsing,
  custom settings) and F3 (labels).
- `.planning/research/ARCHITECTURE.md` ~lines 87-125 (seed step, sync, prefix pool, settings shape).
- `.planning/research/STACK.md` ~lines 82-93 (file shapes, `REPEATED`, parser advice).
- `.planning/research/SUMMARY.md` ~lines 85-91, 132-134 (phase 11 flags).

### Prior phase decisions that bind this phase
- `.planning/phases/02-custom-object-key-prefix-persistence/02-CONTEXT.md` D-01..D-16 (prefix
  persistence rules reused by D-02).
- `.planning/phases/03-thin-standard-object-baselines/03-CONTEXT.md` D-04..D-09 (object flags,
  `INVALID_TYPE_FOR_OPERATION`, import-mode bypass, bootstrap seeding through Store).
- `.planning/phases/08-upgrade-safety-net-nullable-key-prefixes/08-CONTEXT.md` D-08..D-15 (null
  prefixes, `m0` guard, structured `Diagnostic`, upgrade test contract `EXPECTED_WARNINGS`).
- `.planning/phases/10-business-standard-objects/10-CONTEXT.md` D-05..D-09 (`info:` line pattern),
  D-16/D-17 (forbidden DML proven in vitest, no seed rows in acme for read-only objects).

### External public documentation (as cited by the research; researcher re-reads)
- Metadata API Developer Guide: `CustomMetadata`, `CustomObject.customSettingsType`,
  `CustomField.type` MetadataRelationship, `CustomLabels`.
- Object Reference: `CustomMetadata`-type system fields and Supported Calls.
- REST API Developer Guide: `DescribeSObjectResult.customSetting`.
- Apex Developer Guide, Custom Settings (`SetupOwnerId`, hierarchy default, data not in packages).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/schema/src/prefixes.ts`: `planKeyPrefixes` (pure), `reconcileKeyPrefixes`,
  `dropKeyPrefixes`, `parseKeyPrefixMapping`, table `_orglet.key_prefixes`. Needs a pool parameter
  (`a` vs `m`) and to accept `__mdt`; today `reconcileKeyPrefixes` handles only `o.custom` and
  `parseKeyPrefixMapping` refuses non-custom names.
- `packages/schema/src/ids.ts`: `generateId`, case-safe suffix, `keyPrefixOf`,
  `matchTargetByPrefix`/`matchLookupTarget` (for `SetupOwnerId`).
- `packages/engine/src/engine.ts`: `refuse()` (lines ~126-138) with the `importMode` early return;
  `isPgUniqueViolation` + `duplicateError` (23505 -> `DUPLICATE_VALUE`, constraint name ends with
  the field name).
- `packages/engine/src/bootstrap.ts`: `withTransaction` + `Store.insert` pattern that bypasses
  engine flags; the Organization Id needed for D-18's default lives here.
- `packages/metadata/src/diagnostics.ts`: `Diagnostic`, `SkippedItem`, `InfoDiagnostic`,
  `pushDiagnostic`, `formatDiagnostic` (`UNSUPPORTED:<area> <message>`).
- `packages/metadata/src/xml.ts`: `REPEATED` element set (add `labels`, `values`).
- `packages/api/src/describe.ts`: `objectSummary` (hard-codes `customSetting: false`,
  `retrieveable: true`), `describeField`.
- `packages/schema/src/ddl.ts`: `planTable` unique index (`ux_<table>_<col>`), lookup index rule.
- `packages/soql/src/compile.ts`: `Compiler.resolve` relationship walking, `Compiler.expr` virtual
  columns (Name/Address) as the precedent for the `QualifiedApiName` alias.
- `packages/api/src/bulk/jobs.ts` + `routes/bulk.ts`: job creation validation point for D-14.

### Established Patterns
- `readSourceProject` (`packages/metadata/src/sfdx.ts` ~359-385) scans only `objects/`,
  `globalValueSets/`, `standardValueSets/` via `findDirs`; `customMetadata/` and `labels/` are
  silently ignored today. `readObjectDir` does not read `customSettingsType` or `visibility`.
- `CUSTOM_FIELD_TYPES` allow-list; `MetadataRelationship` currently becomes a `field-type`
  `SkippedItem`. `FieldType` union in `types.ts` has no MetadataRelationship member.
- `build.ts`: `isCustomObjectName` is `/__c$/i`; `__mdt` falls into the `object-kind` skip
  (warning, fails `--strict`). `fromSourceObject` hard-codes `custom: true`, all flags true,
  `Name` + `OwnerId` + system fields. `validateBaseline()` rejects `m0*` on standard objects.
- Seeding today is create-if-missing, never modify, never delete (Phase 3 D-06). D-03's full sync is
  new behaviour and must not leak into bootstrap seeds.
- `orglet up` prints load warnings but not `info`; `orglet check` prints both. `--strict` counts
  warnings only.
- `upgrade.test.ts` `EXPECTED_WARNINGS = []` is a contract: this phase must not add warnings to the
  v1.0 upgrade path.

### Integration Points
- `loadOrgSchema` = `loadBaseline` + `readSourceProject` + `buildOrgSchema` (`metadata/src/index.ts`).
- CLI boot order (`packages/cli/src/main.ts`): `loadOrgSchema` -> pool -> `reconcileKeyPrefixes` ->
  `migrate` -> `bootstrapOrg` -> `new DmlEngine` -> `createApiServer`. The record seed goes after
  `migrate` (tables exist) and after `bootstrapOrg` (admin user for audit fields) or takes the
  admin Id some other way.
- Describe-check contract (`conformance/describe-check/contract.json`, `packages/api/src/api.test.ts`)
  compares key sets; new object kinds must emit exactly the Salesforce key set.
- `examples/acme` has no `customMetadata/`, `labels/`, or `__mdt`; no test fixture in the repo
  contains them.

</code_context>

<specifics>
## Specific Ideas

- "Warn, don't fake" governs every anomaly path: null plus one warning per type+field, never a
  guessed value and never an aborted load (D-05, D-07, D-09).
- The honesty line for relationships: a stored `EntityDefinition`/`FieldDefinition` value must
  point at something orglet models; an unmodelled standard object is dangling on purpose (D-09).
- Describe must never claim more than orglet supports on `__mdt` (D-15): false by default, each
  deviation commented with its source.
- `__mdt` refusal in import mode is intentional and must be visible as a comment citing D-13 next to
  the Phase 3 D-08 bypass.
- The `check` info line for settings states a fact about retrieves, so it carries no `UNSUPPORTED:`
  prefix (D-20).

</specifics>

<deferred>
## Deferred Ideas

- `$Label`, `$CustomMetadata`, `$Setup` formula resolution: Phase 12 (FORM-04/05), consumes
  `OrgSchema.labels` and the seeded `__mdt` rows from this phase.
- `examples/enterprise` fixture with custom metadata, settings seed script and labels, and the
  describe-check extension for `__mdt`/settings: Phase 14 (ACC2-01/02).
- Label translations (`translations/`), `$Setup` on list settings, per-user language: v2 CSET-03.
- Queues loaded as Group rows: v2 CMDT-05.
- Modelling `EntityDefinition`/`FieldDefinition` as queryable objects (would lift D-10's
  restriction): not planned; only if a later phase needs the Tooling-style surface.

### Reviewed Todos (not folded)
- "Standard-field gaps on the 18 business objects seen in a large real-org retrieve"
  (`.planning/todos/pending/2026-10-16-standard-field-gaps-on-the-18-business-objects.md`):
  Phase 10 leftover on the baseline generator and `overrides.json`; keyword match only, out of
  scope here.
- "Support Relationship:Object.Field colon syntax for polymorphic formula references"
  (`.planning/todos/pending/2026-10-08-sigha-colon-syntax-for-polymorphic-formula-references.md`):
  needs the sigha resync, which the roadmap places in Phase 12.

</deferred>

---

*Phase: 11-custom-metadata-custom-settings-labels*
*Context gathered: 2026-10-19*
