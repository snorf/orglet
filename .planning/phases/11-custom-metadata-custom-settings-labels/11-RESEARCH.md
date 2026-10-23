# Phase 11: Custom Metadata, Custom Settings & Labels - Research

**Researched:** 2026-10-19
**Domain:** SFDX source-format loading of `__mdt` types and records, `MetadataRelationship`, List/Hierarchy custom settings and custom labels into the orglet metadata, schema, engine, SOQL, API and CLI layers
**Confidence:** MEDIUM-HIGH (file formats and key prefix HIGH from public SDK-adjacent repos and the official `forcedotcom/sf-skills` doc mirror; describe spelling of `MetadataRelationship`, the REST DML error code and `customSetting` on `__mdt` are NOT publicly documented and are recorded as orglet choices)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Record Ids, key prefixes and reload**
- **D-01:** A custom-metadata record's Id is derived, not allocated: `<m00-series prefix>` + 12 base62 characters from a hash of `(type API name, DeveloperName)`, then the existing case-safe suffix (`ids.ts`). No new state in `_orglet`. The same retrieve yields the same Id in every environment and after `orglet reset`. A record removed and later re-added gets its Id back. A hash collision between two records of one type is a hard load error (named records), not a warning. Matching of type name and DeveloperName for the hash is case-insensitive (lower-case both).
- **D-02:** `__mdt` key prefixes use the existing persisted mechanism (`_orglet.key_prefixes`, `planKeyPrefixes` / `reconcileKeyPrefixes` in `packages/schema/src/prefixes.ts`) with a separate pool `m00..mzz` instead of `a00..azz`. Precedence is unchanged (existing rows > `--key-prefixes` mapping > provisional > next free). `--key-prefixes` accepts `__mdt` names; a `__mdt` mapped into the `a` range, or a `__c` mapped into the `m` range, is a `KeyPrefixError`. `orglet check` lists `Foo__mdt  m00  (provisional)` beside the custom objects; `reset --drop-prefixes` clears them too. Phase 8's `validateBaseline()` `m0*` guard for standard objects stays as is.
- **D-03:** Sync on reload is a full sync per type in one transaction keyed by `DeveloperName`: changed rows updated (Id kept by construction of D-01), new rows inserted, rows whose record file is gone deleted (hard delete, no `IsDeleted`). It runs on every `up`, including `--import`.
- **D-04:** `orglet up` prints one summary line on stdout after the sync, always, respecting `--quiet`: `custom metadata: <N> records in <M> types (<a> added, <b> updated, <c> removed)`. Removed records are not named. Same style as the `assigned key prefix ...` lines.
- **D-05:** Record-file anomalies warn and load, never abort:
  - record file for a type that is not in `objects/` (or is not `__mdt`): the record is skipped with one `UNSUPPORTED:custom-metadata-record` warning naming the file;
  - `<values>` for a field the type does not declare: value dropped, one warning per type+field;
  - a value that cannot be coerced to the declared field type, or a picklist value outside the declared set: field stored as null, one warning per type+field (not per record);
  - all of these are `warning:` lines counted by `--strict`. Values are coerced by the declared `FieldDef` type, never by `xsi:type`: `"007"` in a Text field stays `"007"`, `xsi:nil="true"` is null, an absent field is null.

**MetadataRelationship fields**
- **D-06:** `MetadataRelationship` becomes a loaded field type instead of a `field-type` skip. Target kind comes from `<referenceTo>`: another `__mdt`, `EntityDefinition` or `FieldDefinition`.
- **D-07:** mdt-to-mdt: a Lookup-shaped `char(18)` column, describe `type: reference`, `referenceTo: ["Other__mdt"]`, `relationshipName` per the `__c -> __r` rule, ordinary SOQL JOIN so `Rel__r.DeveloperName`, `Rel__r.MasterLabel` etc. work. No Postgres FK: the seed resolves the record file's target DeveloperName to an Id in a second pass after all types are seeded (cycles between types are fine). A target record that does not exist is stored null with one `UNSUPPORTED:custom-metadata-record` warning naming type, field and target.
- **D-08:** Entity/field-definition targets: describe `type: reference` with `referenceTo: ["EntityDefinition"]` or `["FieldDefinition"]` and a `relationshipName`; the stored value is the qualified API name string as written in the record file (`Account`, `Project__c`, `Account.Industry`). `EntityDefinition`/`FieldDefinition` are not modelled as objects. The researcher verifies the describe spelling (`type`, `referenceTo`, `relationshipName`) against the Object Reference / REST docs; if nothing documents it, the Lookup spelling is used and recorded as orglet's choice.
- **D-09:** A target is dangling when it is not in the loaded `OrgSchema`: the object (for `EntityDefinition`) or object and field (for `FieldDefinition`) must be modelled, matched case-insensitively. Dangling stores null with one warning per type+field+target in the `reference-target` family (`UNSUPPORTED:reference-target`). An unmodelled standard object is therefore dangling, by design (orglet never points at something it cannot answer for).
- **D-10:** In SOQL, `Rel__r.QualifiedApiName` on an entity/field-definition relationship is an alias of the stored string (selectable, filterable, sortable like a text column). Any other path through such a `Rel__r` (`Label`, `DeveloperName`, nested paths) is rejected: HTTP 400, errorCode `INVALID_FIELD`, message prefixed `UNSUPPORTED:entity-definition` stating that only `QualifiedApiName` is selectable on that relationship.
- **D-11:** `<metadataRelationshipControllingField>` is parsed and ignored silently (it is a Setup-UI filter, not data). No warning, no describe key.

**Read-only surface and describe of `__mdt`**
- **D-12:** DML refusal reuses `DmlEngine.refuse()` with `INVALID_TYPE_FOR_OPERATION` (Phase 3 D-09, Phase 8 D-10), message `entity type Foo__mdt does not support <insert|update|delete|upsert|undelete>`, HTTP 400. Researcher checks whether Salesforce documents a different code for custom-metadata DML through the data API; only a documented code may replace it.
- **D-13:** `__mdt` objects are refused even in import mode (`orglet up --import`). This is a deliberate, documented deviation from Phase 3 D-08: the record files are the only source of `__mdt` rows and D-03's sync would overwrite imported rows anyway. Implemented as one explicit custom-metadata check in `refuse()` ahead of the `importMode` early return, with a comment citing this decision.
- **D-14:** Bulk API 2.0 ingest jobs on a `__mdt` object are rejected when the job is created (`POST /jobs/ingest`), HTTP 400 with the same `INVALID_TYPE_FOR_OPERATION` message, so a job that can never succeed is never accepted. Bulk query jobs on `__mdt` are allowed. Composite and sObject Collections requests go through the engine and get the per-record refusal like plain REST.
- **D-15:** Describe flags on `__mdt` follow the documented Supported Calls strictly, everything else false: `createable`, `updateable`, `deletable`, `undeletable`, `searchable`, `mergeable`, `triggerable`, `layoutable`, `activateable`, `feedEnabled`: false; `queryable`, `retrieveable`, `custom`: true; `customSetting`: false unless the researcher finds a source stating otherwise; `keyPrefix`: the `m` prefix. Each value that differs from a `__c` object's gets a code comment with the source or "orglet choice". No `OwnerId`, no `Name`, no `IsDeleted`, `hasOwner: false`.
- **D-16:** System fields on `__mdt`: `Id`, the eight documented fields (`DeveloperName`, `MasterLabel`, `Label`, `Language`, `NamespacePrefix`, `QualifiedApiName`, `IsProtected`, `SystemModstamp`) plus the audit fields `CreatedDate`, `CreatedById`, `LastModifiedDate`, `LastModifiedById` as on every other object (set to the bootstrap admin user and the seed timestamp; `LastModifiedDate`/`SystemModstamp` advance when a sync updates the row). `__mdt` gets its own system-field variant in the metadata package (no `Name`, no `OwnerId`, no `IsDeleted`). `Label` always equals `MasterLabel`; `QualifiedApiName` is `NamespacePrefix__DeveloperName` or `DeveloperName` when there is no namespace; `NamespacePrefix` is null in a source retrieve. Researcher settles the `Language` default (`en_US` is the working assumption) and whether `Label` describes as `picklist` or `string`.

**Custom settings**
- **D-17:** A `CustomObject` with `customSettingsType` (`List` or `Hierarchy`) loads as a custom setting: describe `customSetting: true`, `hasOwner: false`, no `OwnerId` column or field. Every other flag and the DML surface are those of an ordinary custom object (rows are real data, DML works, SOQL works). `visibility` is parsed and ignored.
- **D-18:** Hierarchy settings get `SetupOwnerId`: a polymorphic lookup to `Organization`, `Profile`, `User`, validated with `matchTargetByPrefix` like other lookups (`INVALID_CROSS_REFERENCE_KEY` on a wrong type), with a unique index so a second row for the same `SetupOwnerId` fails `DUPLICATE_VALUE` through the existing 23505 mapping. An insert that omits `SetupOwnerId` defaults it to the bootstrap `Organization` Id (org level is the documented default). List settings have no `SetupOwnerId`.
- **D-19:** Custom settings share the custom-object prefix pool `a00..azz` and are persisted exactly like `__c` objects (the series is undocumented; sharing is orglet's choice, recorded as such). Both kinds keep the `Name` field: required and unique per setting on List, optional on Hierarchy, unless the researcher finds a documented difference.
- **D-20:** `orglet check` reports settings on one `info:` line on stdout, printed always, silent with `--quiet`, never counted by `--strict`, same `Diagnostic` severity and mechanism as Phase 10 D-08: `info: <N> custom settings loaded without data (custom-setting data is not part of a retrieve): A__c, B__c` (sorted). No `UNSUPPORTED:` prefix: this is a fact about the retrieve format, not a gap in orglet.

**Custom labels**
- **D-21:** `labels/CustomLabels.labels-meta.xml` loads onto the org schema as `OrgSchema.labels` (or an equivalent read-only accessor): `fullName`, `value`, `language`, `categories`, `protected`, `shortDescription`, with case-insensitive lookup by `fullName`. `labels` joins the `REPEATED` element set in the XML reader. Not an sObject, no table, nothing in describe (Salesforce exposes labels only through the Tooling API). Consumers are Phase 12 (`$Label`) and `orglet check`, whose summary counts them.
- **D-22:** A duplicated `fullName` keeps the first occurrence and warns once (`UNSUPPORTED:custom-label`, counted by `--strict`). `translations/` is ignored in this phase (v2 CSET-03). `<value>` whitespace and XML entities are preserved as decoded by the parser.

### Claude's Discretion
- Where the seed step lives (research suggested `packages/engine/src/seed.ts` between `migrate` and `bootstrapOrg`) and whether it writes through `Store` or direct SQL, as long as it bypasses `DmlEngine` flags like `bootstrapOrg` does.
- The hash function and exact base62 slicing for D-01, provided the Id is 18 characters, case-safe and stable; the collision check lives in the seed step.
- Shape of the parsed record (`SourceProject` slot name, `CustomMetadataRecord` type) and how `customSettingsType` and `MetadataRelationship` extend `SourceObject`/`FieldType`.
- Whether `__mdt`/custom-setting kinds are modelled as an `objectKind` on `SObjectDef` or as booleans (`customMetadata`, `customSetting`), as long as describe keys stay the Salesforce set.
- Unit-test fixture placement: extend `examples/acme` with one `__mdt` type (with a relationship), one hierarchy setting, one list setting and a `CustomLabels` file, or a dedicated metadata test fixture; the Phase 5 blast-radius rule for `examples/acme` applies.
- Ordering of the seed relative to `reconcileKeyPrefixes` (prefix must be final before Ids are derived) and transaction boundaries.

### Deferred Ideas (OUT OF SCOPE)
- `$Label`, `$CustomMetadata`, `$Setup` formula resolution: Phase 12 (FORM-04/05), consumes `OrgSchema.labels` and the seeded `__mdt` rows from this phase.
- `examples/enterprise` fixture with custom metadata, settings seed script and labels, and the describe-check extension for `__mdt`/settings: Phase 14 (ACC2-01/02).
- Label translations (`translations/`), `$Setup` on list settings, per-user language: v2 CSET-03.
- Queues loaded as Group rows: v2 CMDT-05.
- Modelling `EntityDefinition`/`FieldDefinition` as queryable objects (would lift D-10's restriction): not planned; only if a later phase needs the Tooling-style surface.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CMDT-01 | A `__mdt` type in the retrieve loads as a read-only object (describe flags, key prefix `m`, own system fields) | `__mdt` is skipped as `object-kind` at `build.ts` (the `area` regex in `buildOrgSchema`); needs an `isCustomMetadataName` branch, an `mdtKeyPrefix` pool, a dedicated `systemFields` variant; `m00` prefix confirmed by public fixtures; documented system fields |
| CMDT-02 | `customMetadata/<Type>.<Record>.md-meta.xml` seeded into Postgres at `orglet up`, stable Ids, `"007"` stays text, `xsi:nil` null, removed record disappears | File format and nil spelling verified against public repos; parser gotchas (attributes ignored, `trimValues`) in Pitfalls; hash-derived Id + full-sync design in Architecture Patterns |
| CMDT-03 | `MetadataRelationship` loads: mdt target returns Id, entity/field target returns qualified API name, `Rel__r.QualifiedApiName` selectable, dangling warns and is null | XML shape and stored values verified: mdt value is the target's DeveloperName, entity value is the plain API name; SOQL integration points in `compile.ts` (`resolve`, `compileSObjectSelect`) |
| CMDT-04 | Describe / SOQL / REST retrieve of `__mdt` work through jsforce and simple-salesforce; DML rejected | Neither SDK special-cases `__mdt`; `isdeleted` filters in SOQL/Store must be conditional (Pitfall 1); DML refusal via `refuse()` flags plus an import-mode override; bulk-ingest guard |
| CSET-01 | `customSettingsType` List/Hierarchy loads as a custom setting: `customSetting: true`, no `OwnerId`, `SetupOwnerId` unique, `check` states data is not part of a retrieve | `customSettingsType` documented; List `Name` required vs Hierarchy `Name` nillable; unique-index gap in `planTable` for Lookup (Pitfall 4); `result.info` consumer gap in `main.ts` (Pitfall 9) |
| CSET-02 | `CustomLabels.labels-meta.xml` present on the loaded org schema with name, value, language, category | Format verified; `labels` must join `REPEATED`; `OrgSchemaImpl` constructor is called positionally from three test files |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- TypeScript strict plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `noImplicitOverride`; relative imports carry `.js`; cross-package imports go through `@orglet/*` barrels (`src/index.ts`) with explicit named exports (never `export *` beyond what already exists).
- Node 22, pnpm 10+, Postgres 16, Fastify 5, vitest. `consistent-type-imports` and `no-unused-vars` (`^_` ignore) are lint errors. No Prettier; match existing style.
- Build only from public documentation and open-source SDK source; never diff against a real org (Developer MSA). Real-org findings never enter the repo as Tele2 names (user memory rule). Every value that differs from a `__c` object's needs a comment with its source or "orglet choice".
- `UNSUPPORTED:<area>` convention is mandatory for anything recognised but not implemented. Use real Salesforce `StatusCode` / errorCode values; add new error kinds through the `Errors` factory and `apiError`/`sendErrors` (never hand-written envelopes); every REST error body is a JSON array.
- Every source file opens with a `/** ... */` why-comment; package barrels start with a one-line `//` role comment; comments only for domain knowledge.
- Existing conformance suites must stay green; `upgrade.test.ts` `EXPECTED_WARNINGS = []` is a contract (this phase must not add migration warnings to the v1.0 upgrade path).
- Data: only Level 1 data in the emulator and in Claude context. Fixtures must not carry real-org or Tele2 names. Repo-local git identity Johan Karlsteen <johan@karlsteen.com>.
- GSD workflow enforcement: file edits happen inside a GSD command.

## Summary

Phase 11 is mostly a loader and wiring phase on top of machinery that already exists: object flags drive `DmlEngine.refuse()`, the persisted key-prefix table already handles a second pool if given a pool parameter, `Diagnostic`/`InfoDiagnostic` already carry structured warnings, and Postgres is already the only store. The public formats are now verified against real open-source projects (NebulaLogger, apex-rollup, trigger-actions-framework) and the official `forcedotcom/sf-skills` mirror of the Metadata API docs: record files are `<Type>.<DeveloperName>.md-meta.xml` where `<Type>` is written WITHOUT the `__mdt` suffix; `xsi:nil="true"` is written as `<value xsi:nil="true"/>`; an entity-definition relationship value is the plain API name (`Log__c`); and a mdt-to-mdt relationship value is the target record's DeveloperName (`Account` for `sObject_Trigger_Setting__mdt.Account`). The `m00` key prefix is confirmed by public Tooling `EntityDefinition` fixtures showing `CompanyData__mdt` = `m00`, `HandlerControl__mdt` = `m01` (sequential).

The largest hidden risks are not in the loader but in code that assumes every object has `IsDeleted`, `Name` and `OwnerId`. `compile.ts` (three places) and `store.ts` (four places) hard-code `isdeleted = false`; a `__mdt` table without `IsDeleted` (D-16) makes every SOQL and REST retrieve fail with a Postgres error unless those sites become conditional. Likewise `planTable` emits a non-unique index for every Lookup, so `SetupOwnerId` uniqueness (D-18) silently does nothing without a fix. `main.ts#check` treats the whole `result.info` list as "unmodelled standard objects", so the new settings info line needs its own area filter. The parser is `ignoreAttributes: true`, which is fine (D-05 coerces by declared type), but `<value xsi:nil="true"/>` and an empty string both arrive as `""`, and `trimValues: true` trims text values.

Three items cannot be settled from public documentation and must be recorded as orglet choices in code comments: the describe spelling of a `MetadataRelationship` field (use the Lookup spelling, D-08 fallback), the REST error code for DML on `__mdt` (the only documented statement is "DML operations aren't allowed on custom metadata in the Partner or Enterprise APIs"; keep `INVALID_TYPE_FOR_OPERATION` per D-12), and `customSetting` on `__mdt` (no source; keep `false`).

**Primary recommendation:** Add `customMetadata?: true` / `customSetting?: "List" | "Hierarchy"` to `SObjectDef`, a new `MetadataRelationship` `FieldType`, parse `customMetadata/` and `labels/` in `readSourceProject`, resolve structure in `buildOrgSchema` (returned on `BuildResult.customMetadata`, labels on `OrgSchema`), do the typed coercion, Id derivation and cross-record resolution in a pure `planCustomMetadataSeed()` in `packages/engine/src/seed.ts` (reused by `check` without a database), and make the `isdeleted` filters conditional before anything else, because every read path for `__mdt` depends on it.

## Standard Stack

No new dependencies. Everything is already in the repo.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fast-xml-parser | ^5.11.1 (existing) | Parse `.md-meta.xml` and `CustomLabels.labels-meta.xml` via `parseMetadataXml` | Already the metadata reader; a second parser instance is NOT needed (D-05 coerces by declared type; nil and empty both arrive as `""`) |
| pg | ^8.23.0 (existing) | Seed transaction (`withTransaction`) | Only DB driver; type parsers already normalise numeric, date, timestamptz for value comparison |
| node:crypto `createHash("sha256")` | Node 22 | Derive the 12 base62 Id characters | Built in; `identifier()` in `columns.ts` already uses `createHash` |
| vitest | 3.2.7 (existing) | Unit and integration tests on pglite or Postgres via `test/db.ts` | Project test runner |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@orglet/schema` `toCaseSafeId` | in repo | Append the 3-char checksum to `prefix + 12 chars` | Id derivation (D-01) |
| `@orglet/engine` `coerceValue`, `normalizeDatetime` | in repo | Coerce record values by declared `FieldDef` | Seed step (D-05); do not reimplement |
| `@orglet/metadata` `Diagnostic` / `pushDiagnostic` / `InfoDiagnostic` | in repo | `UNSUPPORTED:custom-metadata-record`, `custom-label`, `reference-target`; info line for settings | All new warnings |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hash-derived Ids (D-01, locked) | Persisted mapping table | Locked; derived Ids need no state and are identical across environments |
| Second XML parser with attributes | Reuse global parser | Only needed if nil must be distinguished from an empty string; Salesforce stores no empty strings, so `""` is null |
| `objectKind` enum on `SObjectDef` | Optional booleans `customMetadata` / `customSetting` | Recommend booleans/enum-valued optional fields: absent for all existing objects so baseline JSON, `toJSON()` snapshots and `OrgSchemaImpl` tests do not churn |

**Installation:** none.

**Version verification:** no package additions; existing pins from `CLAUDE.md` (`fast-xml-parser` ^5.11.1, `pg` ^8.23.0, vitest 3.2.7) were not re-queried because nothing new is installed.

## Architecture Patterns

### Recommended changes by package
```
packages/metadata/src/
  types.ts      # FieldType += "MetadataRelationship"; SObjectDef += customMetadata?, customSetting?; CustomLabelDef; OrgSchema += labels, getLabel()
  xml.ts        # REPEATED += "labels"
  sfdx.ts       # parse customSettingsType + MetadataRelationship field; readCustomMetadataRecords(); readCustomLabels()
  build.ts      # isCustomMetadataName; mdt provisional pool m00..mzz; mdtSystemFields(); setting shape; resolve records structurally
  schema.ts     # OrgSchemaImpl gains labels (optional 4th constructor arg to avoid touching tests)
  diagnostics.ts# (no change; new areas are strings)
packages/schema/src/
  ids.ts        # deriveCustomMetadataId(prefix, typeName, developerName)
  columns.ts    # sqlTypeFor: MetadataRelationship -> char(18) if referenceTo[0] endsWith __mdt else varchar(255)
  ddl.ts        # unique index for Lookup when field.unique; index for MetadataRelationship; no FK for MetadataRelationship
  prefixes.ts   # pool parameter ("a" | "m"), nextFree per pool, cross-pool KeyPrefixError, parseKeyPrefixMapping accepts __mdt
packages/engine/src/
  seed.ts       # NEW: planCustomMetadataSeed (pure) + seedCustomMetadata (DB sync)
  engine.ts     # refuse(): explicit customMetadata check before the importMode return; SetupOwnerId default on insert
  store.ts      # soft-delete filter only when the object has IsDeleted
packages/soql/src/compile.ts   # conditional isdeleted; MetadataRelationship entity/field alias path
packages/api/src/describe.ts   # describeType, objectSummary flags from SObjectDef; Label/Language field spelling
packages/api/src/routes/bulk.ts # reject ingest jobs on __mdt at creation
packages/api/src/routes/sobjects.ts # /deleted on an object without IsDeleted
packages/cli/src/main.ts       # check: settings info line, labels count, filter result.info by area; up: seed + summary line
```

### Pattern 1: Pure plan, then DB sync
**What:** `planCustomMetadataSeed(schema, records)` returns `{ rows: Map<typeName, SeedRow[]>, warnings: Diagnostic[] }`. It coerces every value by declared `FieldDef` using `coerceValue`, derives Ids, detects collisions, resolves mdt-to-mdt targets from the in-memory Id map and validates entity/field targets against `schema`. `seedCustomMetadata(pool, schema, plan, { orgSchema, userId })` then runs one `withTransaction`: per type, `SELECT id, <columns>` keyed by `developername`, diff, insert/update/delete, return counts.
**Why:** Because Ids are derived (D-01), the D-07 "second pass" needs no database: every target Id is known before any row is written. `orglet check` can call the same pure function and report coercion and dangling warnings without Postgres (it already imports `FormulaRegistry` from the engine).
**When to use:** always for seeding; order in `main.ts#up` is `loadOrgSchema` -> `reconcileKeyPrefixes` -> `migrate` -> `bootstrapOrg` -> `seedCustomMetadata` (needs final prefixes for Ids, tables to exist, and `boot.session.userId` for audit fields) -> `new DmlEngine`.
**Example:**
```typescript
// Source: derived from packages/schema/src/ids.ts (toCaseSafeId) and node:crypto; D-01
import { createHash } from "node:crypto";
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
export function deriveCustomMetadataId(keyPrefix: string, typeName: string, developerName: string): string {
  const digest = createHash("sha256").update(`${typeName.toLowerCase()}\0${developerName.toLowerCase()}`).digest();
  let n = digest.readBigUInt64BE(0); // 64 bits is enough entropy for a per-type collision check; mod 62^12 below
  let body = "";
  for (let i = 0; i < 12; i++) { body = BASE62.charAt(Number(n % 62n)) + body; n /= 62n; }
  return toCaseSafeId(`${keyPrefix}${body}`); // 3 + 12 = 15 chars, then the 3-char checksum
}
```
Note: 62^12 is about 2^71.5, so a 64-bit seed leaves the top base62 digits low-entropy. Prefer reading 9 bytes (`BigInt("0x" + digest.subarray(0, 9).toString("hex"))`) and taking it modulo `62n ** 12n`. Either satisfies D-01 as long as the collision check stays a hard error.

### Pattern 2: Object kind drives behaviour, not name suffix checks scattered around
**What:** Put the `__mdt`/setting facts on `SObjectDef` once (`customMetadata?: true`, `customSetting?: "List" | "Hierarchy"`) and have `refuse()`, `objectSummary`, bulk guard, `check`, the seed step and the SOQL compiler read the flag. Do not test `name.endsWith("__mdt")` outside `build.ts`.
**When to use:** all consumers.

### Pattern 3: Soft delete is an object capability
**What:** Add a tiny exported helper (for example `hasSoftDelete(obj: SObjectDef): boolean` in `@orglet/metadata`, true when `obj.fields` contains `IsDeleted`) and use it at every site that writes `isdeleted` SQL.
**Sites (all verified by grep):** `packages/soql/src/compile.ts` lines ~293 (root), ~516 (child subquery), ~678 (semi-join inner); `packages/engine/src/store.ts` lines ~32 (`loadByIds`), ~41 (`findByField`), ~49 (`existingIds`), ~95 (`childrenOf`), ~86 (`setDeleted`, unreachable for `__mdt` but keep consistent); `packages/api/src/routes/sobjects.ts` `/deleted` (builds `WHERE IsDeleted = true`); `packages/schema/src/rollup.ts` (parents/children are `__c`, no change). `engine.ts:425` reads `old["IsDeleted"]` from a row object and tolerates `undefined`.

### Pattern 4: `MetadataRelationship` as a dedicated FieldType with Lookup-shaped behaviour
**What:** New `FieldType` member `"MetadataRelationship"` (Metadata API `CustomField.type` name, matching the file's `<type>`), always with `referenceTo: [target]` and `relationshipName` per the `__c -> __r` rule. Column: `char(18)` when the target ends in `__mdt`, else `varchar(255)` (qualified API name). No FK. Plain index only.
**Why a new type rather than reusing `Lookup`:** `Lookup` triggers an FK in `planTable`, `childRelationships` in `OrgSchemaImpl`, ID normalisation in `coerceValue`, `checkReferences` in the engine and `matchLookupTarget`; none apply to a name-valued column or to a loader-only object. The compiler already flags every exhaustive `switch (field.type)` without a default: `describe.ts#describeType`, `columns.ts#sqlTypeFor`, `formula/src/values.ts` (type mapping). `coerce.ts` falls through to its text-like default, which is harmless because `__mdt` DML is refused.
**Describe (orglet choice, D-08):** `type: "reference"`, `referenceTo: [target]`, `relationshipName: "<Field>__r"`, `nillable: true`. For entity/field targets override `length` to 255 and `soapType` to `xsd:string` (the value is a name, not an Id); comment "orglet choice: no public source documents the describe of a MetadataRelationship".

### Pattern 5: `Rel__r.QualifiedApiName` as a compiler special case
**Where:** `Compiler.resolve()` (path walk, used by WHERE/ORDER BY/GROUP BY/aggregates) and the `FieldRelationship` branch of `compileSObjectSelect()` (which calls `schema.resolveRelationship` and `parentShape`). Both call `resolveRelationship`, which returns `undefined` for a relationship whose target is not a modelled object, so today `Rel__r.X` on an `EntityDefinition` relationship throws `invalidRelationship`.
**How:** before `resolveRelationship`, look up a field on `obj` with `type === "MetadataRelationship"`, `relationshipName` equal (case-insensitive) to the segment and `referenceTo[0]` in `{EntityDefinition, FieldDefinition}`. If the leaf is `QualifiedApiName` and the path has exactly one hop, return `{ field: relField, obj, alias }` so `expr()` yields the stored column; in SELECT, build a synthetic `SObjectShape` `{ type: "EntityDefinition" | "FieldDefinition", idAlias: <alias selecting the stored string>, fields: [{ name: "QualifiedApiName", alias }] }` (a NULL stored value then shapes to a null parent via the existing `id === null` rule in `shapeSObjectRow`). Any other leaf or a deeper path throws `new SoqlError("INVALID_FIELD", "UNSUPPORTED:entity-definition only QualifiedApiName is selectable on <Rel__r>")`. Note the existing `unsupported()` helper produces errorCode `UNSUPPORTED`, which D-10 does not want; construct `SoqlError` directly (or add a small named factory in `soql/src/errors.ts`).
**mdt target:** nothing special; `resolveRelationship` finds the modelled `__mdt` target and the ordinary LEFT JOIN on `id` works, including `Rel__r.QualifiedApiName`, `Rel__r.DeveloperName`.

### Pattern 6: Custom settings are `__c` objects with an adjusted shape
**What:** In `build.ts#fromSourceObject`: `hasOwner = false` when `customSettingsType` is present; `Name` field `nillable = true` for Hierarchy and `nillable = false` plus `unique = true` for List; Hierarchy gets `SetupOwnerId` (`Lookup`, `referenceTo: ["Organization", "Profile", "User"]`, `relationshipName: "SetupOwner"`, `defaultedOnCreate: true`, `unique: true`, `nillable: false`). Prefix from the `a` pool. `customSetting` is read by `objectSummary` instead of the hard-coded `false`.
**Engine:** next to `if (obj.hasOwner && w.next["OwnerId"] === undefined) ...` (engine.ts ~line 454) add the `SetupOwnerId` default to `session.organizationId` when the field exists and is undefined. `checkReferences` only validates fields present in `w.changes`, so the defaulted org Id is not re-checked (correct, it is the bootstrap Organization). `duplicateError` already maps a 23505 on a `unique` field whose name ends the constraint name to `DUPLICATE_VALUE` with `fields: ["SetupOwnerId"]`.

### Anti-Patterns to Avoid
- **Flipping the global XML parser to `ignoreAttributes: false`:** would change every existing parse (attribute-bearing nodes become objects). Not needed.
- **Allocating `__mdt` Ids with `generateId`:** monotonic process-local counter; Ids would change per run (violates D-01).
- **Routing the seed through `DmlEngine.insert`:** the flags refuse it by design; follow `bootstrapOrg` (direct `Store`/SQL in `withTransaction`).
- **Reusing `result.info` as "unmodelled standard objects":** `main.ts` does `result.info.map(d => d.object)` unconditionally; filter by `area` once a second info area exists.
- **Emitting `UNSUPPORTED:` for the settings info line:** D-20 forbids it.
- **Adding `__mdt`/settings to `examples/acme`:** moves provisional `a0x` prefixes and counts asserted in `main.test.ts` (`4 custom`, `a00..a03`), `prefixes.test.ts` and conformance READMEs (Phase 5 blast-radius rule).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Value coercion for record values | A per-type switch | `coerceValue(field, raw)` and `normalizeDatetime` from `@orglet/engine` (`coerce.ts`) | Already handles blank -> null, number parsing, date and datetime normalisation, picklist restriction, text length; returns an error object instead of throwing |
| Case-safe Id suffix | Own checksum | `toCaseSafeId` (`ids.ts`) | `normalizeId` validates the checksum on every read |
| Key-prefix persistence/precedence for `m` pool | New table or logic | Extend `planKeyPrefixes`/`reconcileKeyPrefixes` with a pool tag | Precedence, collisions, ambiguity, `--key-prefixes`, `reset --drop-prefixes` all reuse tested code |
| Warning plumbing | String concatenation | `pushDiagnostic(sink, {area, kind, object, field, message})` and `formatDiagnostic` | Keeps `warnings`/`diagnostics` 1:1 (Phase 14 report) |
| Info lines | New channel | `InfoDiagnostic` in `BuildResult.info` plus `log()` in `main.ts` | Phase 10 D-08 mechanism |
| Duplicate detection for `SetupOwnerId` | Pre-query | Postgres unique index plus existing `isPgUniqueViolation` -> `duplicateError` | Already tested path |
| Polymorphic target validation | Own prefix test | `matchTargetByPrefix`/`matchLookupTarget` via `checkReferences` | D-18 says reuse |
| REST error envelope | Hand-built arrays | `apiError` + `sendErrors` (`server.ts`) | Project rule |

**Key insight:** every behaviour in this phase has a precedent in the repo (UserLicense for read-only seeding, Phase 4 polymorphic lookups for `SetupOwnerId`, Phase 2 prefixes, Phase 10 info lines). The new code is parsing, wiring and the three places that assumed `IsDeleted`/`Name`/`OwnerId` exist.

## Runtime State Inventory

Not a rename/refactor phase, but it changes how already-loaded objects are shaped, so the upgrade-relevant state is listed explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | A v1.0 or v1.1 org whose retrieve contained a custom setting loaded it as an ordinary `__c` table with `ownerid` (and `name` NOT-required) columns. After this phase the same object has no `OwnerId` field. `migrate` keeps the orphan column and emits `UNSUPPORTED:schema-drop ... kept (use --force to drop)` (migrate.ts ~line 158). The orphan `ownerid` column has no NOT NULL (only system fields are NOT NULL in `columnFor`), so inserts keep working. | Document in the plan summary and `check`/README: expected one-time warning for pre-existing settings unless `--force`. Add a migrate-level test for a table that gains `customSetting` (warning, not failure). Not part of `upgrade.test.ts` (acme has no settings), so `EXPECTED_WARNINGS = []` is unaffected. |
| Stored data | `_orglet.key_prefixes` rows: `__mdt` types are new rows in the same table with an `m..` prefix; no existing rows change. A custom setting that already has a persisted `a0x` prefix keeps it (precedence rule). | None beyond the pool parameter; add a test that a persisted prefix wins. |
| Live service config | None. orglet has no external service configuration; verified by the architecture (Postgres only). | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | None; no new env var (`ORGLET_EVENTS`, `ORGLET_DATABASE_URL` unchanged). | None. |
| Build artifacts | `packages/*/dist` is stale after type changes (`conformance/run-all.sh` uses `packages/cli/dist/index.js`). | Run `pnpm build` before conformance; vitest uses source aliases and is unaffected. |

## Common Pitfalls

### Pitfall 1: `isdeleted = false` hard-coded on a table that has no `isdeleted`
**What goes wrong:** First `SELECT ... FROM Foo__mdt` or `GET /sobjects/Foo__mdt/<id>` fails with Postgres "column isdeleted does not exist" (HTTP 500).
**Why it happens:** D-16 removes `IsDeleted` from `__mdt` (and the platform has no recycle bin for it); `compile.ts` and `store.ts` assume it exists on every object.
**How to avoid:** `hasSoftDelete(obj)` helper used at every site in Pattern 3; add a regression test per site (root query, child subquery is not reachable for `__mdt` but the helper keeps it consistent, semi-join `WHERE Id IN (SELECT ...)`, `retrieve`, `queryAll`).
**Warning signs:** 500 on first describe-then-query via jsforce; any `isdeleted` in a stack trace.

### Pitfall 2: XML parser details
**What goes wrong (a):** `parseTagValue: false` keeps `007` as text (good) but `ignoreAttributes: true` drops `xsi:type`/`xsi:nil`. `<value xsi:nil="true"/>` parses to `""`; so does `<value xsi:type="xsd:string"></value>`. Both mean null; `coerceValue` already treats `""` as null. **(b):** `trimValues: true` trims leading and trailing whitespace of text values, so a Text value with trailing spaces or a trailing newline loses it; accept and note in the fixture test. **(c):** `value` and `values` are already in `REPEATED`, so `<values>` is always an array and its `<value>` is `string[]` of length 1; read `values[i].value[0]`. A `<values>` without a `<value>` child is treated as absent. **(d):** `labels` is NOT in `REPEATED` today; a single-label file would parse `labels` as an object, not an array (add it; `list()` handles both anyway, but `value` inside a label is then also an array). `str(node, "value")` returns `undefined` for an array, so read label `value` with an array-aware helper (see `readFilterItems` for the precedent).
**How to avoid:** Unit test with the exact snippets from the sources below (nil self-closing with and without space before `/>`, multi-line `<value\n xsi:type="xsd:string"\n>text</value>`).

### Pitfall 3: Record filename splitting
**What goes wrong:** Treating the first filename segment as the full API name; it lacks `__mdt` (`Support_Tier.Bronze.md-meta.xml` is type `Support_Tier__mdt`, record `Bronze`). Namespaced packages write `ns__Type.Dev.md-meta.xml`.
**How to avoid:** strip the `.md-meta.xml` suffix, split at the FIRST `.`: left + `__mdt` = type, right = DeveloperName (DeveloperNames cannot contain dots). Resolve the type case-insensitively against loaded objects (`sObject_Trigger_Setting__mdt` in the wild is mixed case). Handle the Metadata-API `.md` suffix too only if trivial; source format is `.md-meta.xml` (CONTEXT scope).

### Pitfall 4: Lookup unique constraint is silently a plain index
**What goes wrong:** `planTable` (`ddl.ts`) has `if (Lookup || MasterDetail) { non-unique index } else if (field.unique) { unique index }`. `SetupOwnerId` as a unique Lookup gets only `ix_...`, so a second row for the same owner is accepted and criterion 4 fails.
**How to avoid:** branch on `field.unique` first for Lookup (`ux_<table>_<col>` unique, no `lower()` since it is an Id), keep the non-unique index otherwise. Check `migrate.ts` index diffing creates the unique index on an existing table. Test: second insert with the same `SetupOwnerId` returns `DUPLICATE_VALUE` with `fields: ["SetupOwnerId"]`.

### Pitfall 5: `build.ts` reference bookkeeping counts entity-definition targets as missing objects
**What goes wrong:** The `missing`/`referenced` loops in `buildOrgSchema` iterate every field's `referenceTo`. `EntityDefinition` and `FieldDefinition` are not objects, so every such field would print `UNSUPPORTED:reference-target EntityDefinition is referenced but not defined` once per load, always.
**How to avoid:** skip `referenceTo` entries of `MetadataRelationship` fields that name `EntityDefinition`/`FieldDefinition` in both loops (their dangling check is per record at seed time, D-09). A mdt-to-mdt target that is not loaded SHOULD still print the existing `reference-target` warning.

### Pitfall 6: Key-prefix machinery assumes one pool
**What goes wrong:** `reconcileKeyPrefixes` selects `schema.objects.filter(o => o.custom)`, which now includes `__mdt`; `nextFree` only walks `a00..azz`; `parseKeyPrefixMapping` accepts any custom object, so `{"Foo__mdt": "a0X"}` would be accepted. `planKeyPrefixes` input has `{ name, provisional }` with no pool.
**How to avoid:** add `pool: "a" | "m"` to the custom entries (derive from `o.customMetadata`), make `nextFree(taken, pool)` pool-aware, validate in the planner that an assignment's first character matches the pool (mapping into the wrong pool and persisted rows in the wrong pool both throw `KeyPrefixError` with both claims), and give `buildOrgSchema` a separate `mdtKeyPrefix(index)` (`m` + two alphabet chars) indexed over `__mdt` types only so that adding a type never shifts `__c` provisional prefixes. The standard-prefix collision map already covers `m0*` (baseline guard).

### Pitfall 7: Seed-step comparison and the audit stamp
**What goes wrong:** Reporting every row as "updated" on every restart (and bumping `SystemModstamp`) because freshly coerced values are compared with `pg` output of a different shape.
**How to avoid:** compare coerced seed values against the row read through the same pg type parsers (`numeric -> number`, `date -> string`, `timestamptz -> Salesforce string`; `db.ts`). `Number("500.0")` equals the stored 500. Only bump `LastModifiedDate`/`SystemModstamp`/`LastModifiedById` on an actual change. Test: two consecutive syncs report `0 added, 0 updated, 0 removed` and leave `systemmodstamp` untouched.

### Pitfall 8: The seed must work with `--import` and on a database whose tables were created before this phase
**What goes wrong:** `--import` sets `session_replication_role = replica` per call, not per process, so the seed (direct SQL) is unaffected; but the seed runs on every `up`, including for orgs whose `__mdt` tables do not exist yet if `migrate` skipped them.
**How to avoid:** call it strictly after `migrate`; hard-delete with plain `DELETE FROM` (no `IsDeleted`); FKs from `CreatedById`/`LastModifiedById` to User are `DEFERRABLE INITIALLY DEFERRED` and satisfied by the bootstrap admin Id.

### Pitfall 9: `result.info` consumer and the `check` summary
**What goes wrong:** `main.ts#check` treats every `result.info` entry as an unmodelled standard object (`info: N standard objects not modelled and unreferenced: ...`). Pushing a settings `InfoDiagnostic` there would corrupt that line (and `build.test.ts` asserts on `r.info` contents).
**How to avoid:** new area `custom-setting-no-data`; filter by `area` in `main.ts` for both lines; keep the settings entries sorted by object name; add a `main.test.ts` case asserting both lines and that `--strict` stays 0 for a project that only has settings.

### Pitfall 10: Describe contract keys and per-object flags
**What goes wrong:** `objectSummary` hard-codes `layoutable: true`, `triggerable: true`, `retrieveable: true`, `replicateable: true`, `mruEnabled: true`, `customSetting: false`, `mergeable` from a name list. D-15 needs `layoutable`/`triggerable`/`searchable`/`mergeable`/`activateable`/`feedEnabled` false and `customSetting` data-driven. The key SET must stay exactly the Salesforce set (`contract.json` `globalSObjectKeys`; `api.test.ts` compares sets).
**How to avoid:** change values only, never add or remove keys; derive from `SObjectDef` (`customMetadata` -> flags above; `customSetting` -> `true`). `replicateable` and `mruEnabled` on `__mdt` are not in D-15: pick `false` (follows from "getUpdated/getDeleted not supported" in Supported Calls) and comment "orglet choice".

### Pitfall 11: `Label` and `Language` describe typing
**What goes wrong:** The Object Reference table lists `Label` with an (empty) value list, i.e. it is documented as a picklist, while `Language` is documented as a plain string whose value is "always the default language of the developing organization". Making `Language` a restricted picklist or giving `Label` a value list would mis-state the docs.
**How to avoid:** `Label`: `Picklist` with an empty, non-restricted `picklist` value set (documented type), stored as `varchar(255)` like any picklist, value = `MasterLabel`. `Language`: `Text` (documented string), default `en_US` (matches the bootstrap Organization `LanguageLocaleKey: "en_US"` in `bootstrap.ts`). Both are MEDIUM confidence (the doc mirror is machine-converted); record as orglet choices in comments.

### Pitfall 12: Anything that assumes `Name`, `OwnerId` or `IsDeleted` on every object
**Checked and fine:** `engine.ts:454` guards on `hasOwner`; `engine.ts:750` reads `old["Name"]` into a message only; `engine.ts:425` tolerates an undefined `IsDeleted`; `permissionable` in `describe.ts` is a name list. **Needs attention:** the three `isdeleted` sites above; the built-in UI at `packages/api/ui/index.html` (object browser) may select `Name` by default (check when running the criterion-1 smoke test; fix only if it breaks); `FIELDS(ALL)` expansion (`expandFieldsFn`) is field-driven and fine.

### Pitfall 13: `OrgSchemaImpl` constructor is called positionally by tests
`packages/schema/src/migrate.test.ts` (lines ~100, ~220) and `packages/engine/src/formulas.test.ts:27` call `new OrgSchemaImpl(objects, globalValueSets, standardValueSets)`. Add `labels` as an optional fourth parameter defaulting to an empty map, and add `labels` to the `OrgSchema` interface; also make the new `SourceProject` fields (`customMetadata?`, `labels?`) optional because `rollup.test.ts` and `migrate.test.ts:265` build `SourceProject` literals.

### Pitfall 14: Hierarchy `customSettingsType` with no text
The Metadata API says Hierarchy "is the default" for `customSettingsType`. If the element is present but empty (`str()` returns `""`), treat it as Hierarchy; any other unknown value gets an `UNSUPPORTED:custom-setting` warning and loads as an ordinary object. The element's presence, not its value, marks the object as a setting.

## Code Examples

### Record file as written by real projects (parsed by `parseMetadataXml(xml, "CustomMetadata", file)`)
```xml
<!-- Source: github.com/jongpie/NebulaLogger LoggerSObjectHandler.LogHandler.md-meta.xml -->
<CustomMetadata xmlns="http://soap.sforce.com/2006/04/metadata" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
    <label>LogHandler config</label>
    <protected>false</protected>
    <values><field>IsEnabled__c</field><value xsi:type="xsd:boolean">true</value></values>
    <values><field>SObjectTypeOverride__c</field><value xsi:nil="true"/></values>
    <values><field>SObjectType__c</field><value xsi:type="xsd:string">Log__c</value></values>   <!-- MetadataRelationship -> EntityDefinition -->
</CustomMetadata>
```
```xml
<!-- Source: github.com/shahrier/trigger-actions-adminpanel Trigger_Action.TA_Account_ValidateName.md-meta.xml; field def in mitchspano/trigger-actions-framework -->
<values><field>Before_Insert__c</field><value xsi:type="xsd:string">Account</value></values>
<!-- Before_Insert__c: <type>MetadataRelationship</type>, <referenceTo>sObject_Trigger_Setting__mdt</referenceTo>; "Account" is that record's DeveloperName -->
<values><field>Order__c</field><value xsi:type="xsd:double">2.0</value></values>
```

### Field definitions
```xml
<!-- Source: NebulaLogger LoggerFieldMapping__mdt TargetSObjectType__c / LogEntryTagRule__mdt SObjectField__c -->
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>SObjectField__c</fullName>
    <label>Field</label>
    <metadataRelationshipControllingField>LogEntryTagRule__mdt.SObjectType__c</metadataRelationshipControllingField>
    <referenceTo>FieldDefinition</referenceTo>
    <relationshipLabel>Log Entry Tag Rules</relationshipLabel>
    <relationshipName>LogEntryTagRules</relationshipName>   <!-- child-side name, like Lookup: parent-side is SObjectField__r -->
    <required>true</required>
    <type>MetadataRelationship</type>
    <unique>false</unique>
</CustomField>
```
Note: `<relationshipName>` is the child-side (one-to-many) name per the Metadata API doc and per the existing Lookup rule in `fromSourceField`; the SOQL name is `fullName.replace(/__c$/i, "__r")`.

### Custom labels
```xml
<!-- Source: forcedotcom/sf-skills metadata_api/CustomLabels.json (mirror of the Metadata API doc sample) -->
<CustomLabels xmlns="http://soap.sforce.com/2006/04/metadata">
    <labels>
        <fullName>quoteManual</fullName>
        <value>This is a manual quote.</value>
        <language>en_US</language>
        <protected>false</protected>
        <shortDescription>Manual Quote</shortDescription>
    </labels>
</CustomLabels>
```
`<categories>` is a comma-separated string (max 255 chars); `value` max 1000 chars.

### Seed-step skeleton
```typescript
// Source: pattern of packages/engine/src/bootstrap.ts (withTransaction + direct Store/SQL)
export async function seedCustomMetadata(pool: Pool, schema: OrgSchema, plan: CustomMetadataPlan, options: { orgSchema: string; userId: string }): Promise<SeedCounts> {
  const store = new Store(schema, options.orgSchema);
  return withTransaction(pool, async (client) => {
    const counts = { added: 0, updated: 0, removed: 0, records: 0, types: 0 };
    for (const [obj, rows] of plan.byType) {
      const existing = await client.query(`SELECT ${selectList} FROM ${store.table(obj)}`);
      // key by lower(developername): insert new, update changed (stamp LastModified*/SystemModstamp), DELETE FROM for ids not planned
    }
    return counts;
  });
}
```

### Refusal (D-12/D-13)
```typescript
// engine.ts refuse(): the explicit check goes BEFORE the importMode early return
if (obj.customMetadata) return refusalFor(obj, operation, count); // D-13: record files are the only source of __mdt rows; deliberate deviation from Phase 3 D-08
if (this.importMode) return undefined;
```
Flags `createable/updateable/deletable/undeletable = false` on the `SObjectDef` already make the normal path produce `INVALID_TYPE_FOR_OPERATION` with `entity type Foo__mdt does not support insert`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `customSettingsVisibility` on `CustomObject` | `visibility` (Public / Protected / PackageProtected) | API 34.0; PackageProtected from 47.0 | Parse and ignore `visibility` (D-17); do not warn on either spelling |
| Custom metadata relationships limited to other types | `MetadataRelationship` to `EntityDefinition`/`FieldDefinition` | Spring '17 (API 39.0 for `metadataRelationshipControllingField`) | Three target kinds (D-06) |
| `SystemModStamp` absent on `__mdt` | present from API 56.0 | docs list it | Object Reference spells it `SystemModStamp`; orglet's other objects use `SystemModstamp`; use the latter (D-16) |

**Deprecated/outdated:** the Spring '17 SOQL narrowing for custom metadata (single `FROM`, limited operators) is dated and unverified for current API versions; do not police it (FEATURES.md already decided).

## Open Questions

1. **Describe of a `MetadataRelationship` field (type, referenceTo, relationshipName, length)**
   - What we know: no public Salesforce page found documents it (Object Reference pages are mirrored without describe samples; no SDK fixture found). `DescribeFieldResult` for a lookup-like field is `type: reference` with `referenceTo`.
   - What's unclear: whether Salesforce returns `reference` with `referenceTo: ["EntityDefinition"]`.
   - Recommendation: D-08 fallback is correct. Use the Lookup spelling, override `length: 255` and `soapType: xsd:string` for entity/field targets, and write "orglet choice: no public source" next to it. Not a blocker.
2. **REST/SOAP error code for DML on `__mdt`**
   - What we know: Metadata API doc (CustomMetadata Special Access Rules, via secondary quote and an Apex-guide summary) says "DML operations aren't allowed on custom metadata in the Partner or Enterprise APIs". Apex raises a different exception ("DML operation Update not allowed on Metadata") which is not a REST code.
   - What's unclear: any documented `StatusCode`/errorCode for the data API.
   - Recommendation: keep D-12 (`INVALID_TYPE_FOR_OPERATION`, a real `StatusCode` enum member already used for flag refusals) and mark it as convention in the code comment, not as documented behaviour. Do not assert the code in a conformance script against jsforce (assert HTTP 400 + that the record was not created instead).
3. **`customSetting` flag on a `__mdt` describe**
   - What we know: `DescribeSObjectResult.customSetting` exists (jsforce `types/common.ts:226` declares `customSetting: boolean`); the Tooling `EntityDefinition` has `IsCustomSetting`. No source states its value for custom metadata types.
   - Recommendation: `false` (D-15), comment "no public source; orglet choice".
4. **Whether the `m00` series is shared by anything else**
   - What we know: public `EntityDefinition` fixtures show `__mdt` types at `m00`, `m01`, `m02` in creation order, in separate orgs' data (j-schreiber/js-sf-cli-plugin test data; millena84/util-doc-generator-project-sf fixture).
   - Recommendation: the `m00..mzz` pool is consistent with D-02; keep `--key-prefixes` so real values can be pinned.
5. **Hierarchy `Name` uniqueness**
   - What we know: one secondary source says Hierarchy `Name` is nillable and List `Name` is required; "List setting Name must be unique" is common platform knowledge but not found in a primary doc during this research.
   - Recommendation: follow D-19 (List: required plus unique, Hierarchy: nillable, not unique); LOW-MEDIUM confidence on the uniqueness half.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | build, tests | assumed (project pins 22; not re-probed in this session) | >=22 | none |
| pnpm | scripts | assumed (`packageManager` pnpm@12.6.0) | - | none |
| Postgres 16 (Docker) | optional; `ORGLET_DATABASE_URL` | not probed | - | pglite via `test/db.ts` (default when the env var is unset) |
| pglite + pglite-socket | default test DB | in devDependencies | 0.5.8 / 0.2.11 | Postgres via `pnpm db:up` |
| jsforce checkout (pinned SHA) | conformance leg | `conformance/jsforce/.cache/jsforce` present locally | 3.10.26 | `run.sh` re-clones |
| simple-salesforce venv | conformance leg | `conformance/python/.venv` present (python3.9 site-packages) | per `requirements.txt` | recreate venv per describe-check README (Python 3.12) |

**Missing dependencies with no fallback:** none identified. Environment tools were not re-probed (this phase is code and fixtures only); `gh`, used for public-source research, is authenticated.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.7 (single root config, source aliases to `packages/*/src/index.ts`) |
| Config file | `/Users/johankarlsteen/Development.nosync/local-salesforce/vitest.config.ts` |
| Quick run command | `pnpm vitest run packages/metadata packages/schema/src/prefixes.test.ts packages/engine/src/seed.test.ts` |
| Full suite command | `pnpm build && pnpm test && pnpm lint` (conformance: `bash conformance/run-all.sh`, needs built `dist`) |
| DB | pglite per test file by default; Postgres when `ORGLET_DATABASE_URL` is set (`test/db.ts`) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CMDT-01 | `Foo__mdt` loads (no `object-kind` warning), `m00` provisional prefix, own system fields (no Name/OwnerId/IsDeleted), describe flags per D-15 | unit | `pnpm vitest run packages/metadata/src/build.test.ts` | extend |
| CMDT-01 | `m` pool persisted, `--key-prefixes` accepts `__mdt`, cross-pool is `KeyPrefixError`, `reset --drop-prefixes` clears | unit/integration | `pnpm vitest run packages/schema/src/prefixes.test.ts` | extend |
| CMDT-02 | record file parsing: type from filename, nil, `"007"`, multi-line value, protected, label | unit | `pnpm vitest run packages/metadata/src/sfdx.test.ts` | extend |
| CMDT-02 | seed plan: coercion warnings once per type+field, unknown type/field warnings, collision hard error, dangling targets | unit (no DB) | `pnpm vitest run packages/engine/src/seed.test.ts` | NEW Wave 0 |
| CMDT-02 | seed sync: Ids stable across two runs and after reset, removed record disappears, re-added gets Id back, second run `0/0/0` and `SystemModstamp` unchanged, summary line | integration (pglite) | `pnpm vitest run packages/engine/src/seed.test.ts` | NEW Wave 0 |
| CMDT-03 | mdt->mdt returns Id, `Rel__r.DeveloperName` joins; entity/field returns qualified name; `Rel__r.QualifiedApiName` select/where/order; `Rel__r.Label` -> 400 `INVALID_FIELD` + `UNSUPPORTED:entity-definition`; dangling -> null + one warning | integration | `pnpm vitest run packages/soql/src/compile.test.ts packages/engine/src/seed.test.ts` | extend + NEW |
| CMDT-04 | describe/query/retrieve work over HTTP; insert/update/delete/upsert/undelete/composite/collections refused (400, `INVALID_TYPE_FOR_OPERATION`), also with `importMode`; bulk ingest job creation rejected, bulk query allowed; `/deleted` does not 500 | integration (Fastify inject) | `pnpm vitest run packages/api/src/api.test.ts packages/api/src/bulk.test.ts` | extend (new describe block with the dedicated fixture) |
| CSET-01 | List/Hierarchy shape (`customSetting: true`, no `OwnerId`, Name nillable vs required), `SetupOwnerId` default and `DUPLICATE_VALUE`, wrong-type owner -> `INVALID_CROSS_REFERENCE_KEY`, List rejects `SetupOwnerId` | unit + integration | `pnpm vitest run packages/metadata/src/build.test.ts packages/engine/src/engine.test.ts` | extend |
| CSET-01 | `check` prints the settings `info:` line, not counted by `--strict`, silent with `--quiet` | unit | `pnpm vitest run packages/cli/src/main.test.ts` | extend |
| CSET-02 | labels load with name/value/language/category/protected/shortDescription; case-insensitive lookup; duplicate warns once; single-label file | unit | `pnpm vitest run packages/metadata/src/sfdx.test.ts packages/metadata/src/build.test.ts` | extend |
| (guard) | v1.0 upgrade path adds no warnings and no forbidden statements | integration | `pnpm vitest run packages/engine/src/upgrade.test.ts` | existing, must stay green |
| (guard) | `isdeleted` filters conditional (regression for Pitfall 1) | integration | `pnpm vitest run packages/soql/src/compile.test.ts packages/engine/src/query.test.ts` | extend |

### Fixture recommendation
Add one dedicated SFDX fixture, `conformance/cmdt-check/project/force-app/main/default/` (objects: `Support_Tier__mdt` with a Text, a Number, a Checkbox, a Picklist and a `MetadataRelationship` to `EntityDefinition`; `Tier_Group__mdt` and a mdt-to-mdt relationship, including a cycle; `App_Config__c` Hierarchy and `Region_List__c` List settings; `customMetadata/` records covering `"007"` text, `xsi:nil`, a dangling target, an unknown field, an unknown type; `labels/CustomLabels.labels-meta.xml`). Tests reference it by `fileURLToPath(new URL("../../../conformance/cmdt-check/project/", import.meta.url))` like the existing `ACME` constants. This leaves `examples/acme` untouched, so `main.test.ts` (`4 custom`, `a00..a03`), `prefixes.test.ts`, `api.test.ts` (32 listed objects) and the jsforce README numbers do not move. Names must be neutral (no real-org or Tele2 names).

### Conformance additions (success criteria 1 to 4 through the SDKs)
- New leg `conformance/cmdt-check/{jsforce.mjs,sf_cmdt.py}` modelled on `poly-check` and `rollup-check`: `describe` and `query` of the `__mdt` type, `"007"` stays text, nil is null, relationship traversal, `Rel__r.QualifiedApiName`, DML attempt returns HTTP 400 and creates nothing (do not assert the errorCode from the SDK side, see Open Question 2), a hierarchy-setting duplicate returns `DUPLICATE_VALUE`.
- `conformance/run-all.sh`: start a second orglet on the fixture project with its own `ORG_SCHEMA`/port and run the two legs there; keep the acme server and all existing legs untouched. Update `conformance/README.md`.
- Extend `conformance/describe-check` only if cheap; CONTEXT assigns the `__mdt`/settings describe-check extension to Phase 14, so leave it.

### Sampling Rate
- **Per task commit:** `pnpm vitest run <the package's touched test files>` (under 30 s on pglite) plus `pnpm lint` for touched packages.
- **Per wave merge:** `pnpm build && pnpm test && pnpm lint`.
- **Phase gate:** full suite green and `bash conformance/run-all.sh` green on a fresh schema before `/gsd:verify-work`.

### How each success criterion is verified
1. Describe and SOQL via both SDKs, stable Ids across restarts, `"007"`, nil, removed record: `seed.test.ts` (two syncs, a reset, a file removed) plus the new conformance leg.
2. DML rejected and flags: `api.test.ts` block (REST, composite, collections, bulk ingest creation, importMode) and describe assertions.
3. `MetadataRelationship`: `seed.test.ts` plus `compile.test.ts` (alias path and the rejection) plus conformance traversal.
4. Settings: `build.test.ts` (shape), `engine.test.ts` (`SetupOwnerId` default and duplicate), `main.test.ts` (`info:` line).
5. Labels: `sfdx.test.ts` and `build.test.ts`.

### Wave 0 Gaps
- [ ] `packages/engine/src/seed.test.ts` - covers CMDT-02, CMDT-03 (new)
- [ ] `conformance/cmdt-check/project/...` fixture and `jsforce.mjs` / `sf_cmdt.py` - covers CMDT-04 through the SDKs (new)
- [ ] Shared helper to build a temp SFDX project is already in `main.test.ts` (`project({...})`); reuse by copying the pattern, or add `test/project.ts` if a third file needs it
- [ ] Framework install: none (vitest, pglite already present)

## Sources

### Primary (HIGH confidence)
- `forcedotcom/sf-skills` `skills/platform-metadata-api-context-get/assets/metadata_api/{CustomMetadata,CustomLabels,CustomObject,CustomField}.json` (official Salesforce repository, converted Metadata API docs): `CustomMetadataValue.value` ("Where fields are EntityDefinition and FieldDefinition, the qualified API names of the entity and the field it points to. This value can be null."), file suffix `.md`, folder `customMetadata`, `description`/`label`/`protected`/`values`; `CustomLabel` fields (categories comma-separated, `language`, `protected`, `shortDescription`, `value` max 1000); `customSettingsType` List/Hierarchy ("Hierarchy ... is the default"), `visibility` values; `metadataRelationshipControllingField` (API 39.0+); `relationshipName` described as the one-to-many name.
- `sf-explorer/sf-doc-to-json` `packages/salesforce-object-reference/src/doc/objects/C/Custom Metadata Type __mdt __mdt.json` (converted Object Reference, source URL `.../object_reference.meta/sforce_api_objects_custommetadatatype__mdt.htm`): `DeveloperName`, `isProtected`, `Label` ("always the same as the MasterLabel value"), `Language` ("always the default language of the developing organization"), `MasterLabel`, `NamespacePrefix`, `QualifiedApiName` (`NamespacePrefix__DeveloperName`), `SystemModStamp` (API 56.0+). Same repo: `EntityDefinition.json`, `FieldDefinition.json` (both carry `QualifiedApiName`; EntityDefinition has `KeyPrefix`, `IsCustomSetting`).
- Public record and field files: `jongpie/NebulaLogger` (`LoggerSObjectHandler.LogHandler.md-meta.xml`, `LoggerFieldMapping__mdt/fields/TargetSObjectType__c`, `LogEntryTagRule__mdt/fields/SObjectField__c`), `jamessimone/apex-rollup` (`RollupControl.Org_Defaults.md-meta.xml` with `<value xsi:nil="true" />`, `Rollup__mdt/fields/CalcItem__c`, `RollupControl__c`), `mitchspano/trigger-actions-framework` (`Trigger_Action__mdt/fields/Before_Insert__c`: `MetadataRelationship` to `sObject_Trigger_Setting__mdt`) and `shahrier/trigger-actions-adminpanel` (`Trigger_Action.TA_Account_ValidateName.md-meta.xml`: relationship value `Account`).
- Pinned SDK sources in the repo: `conformance/jsforce/.cache/jsforce/src/types/common.ts:226` (`customSetting: boolean` in the describe type), `src/api/soap/schema.ts`; grep of both jsforce `src` and `simple_salesforce` found no `__mdt` special handling.
- In-repo code read for integration points (file and line references above).

### Secondary (MEDIUM confidence)
- Public Tooling `EntityDefinition` fixtures showing `KeyPrefix`: `j-schreiber/js-sf-cli-plugin` `test/data/garbage-collection/custom-object-entity-defs.json` (`CompanyData__mdt` m00, `HandlerControl__mdt` m01, `CHANNEL_ORDERS__System_Property__mdt` m02) and `millena84/util-doc-generator-project-sf` `tests/fixtures/query/EntityDefinition.json` (`Config__mdt` m00).
- https://unanswered.io/guide/dml-on-custom-settings-and-custom-metadata-salesforce - "DML operations are also blocked on custom metadata in Partner and Enterprise APIs"; DML works on custom settings (secondary summary of the Apex Guide / Metadata API statement; the developer.salesforce.com pages returned HTTP 403 to WebFetch, so the primary page was not read directly in this session).
- https://ktema.org/articles/distinguishing-custom-settings-apex/ - "For a Hierarchy setting, `Name` is nillable, while it is required for List settings"; inserting a List setting with non-null `SetupOwnerId` throws `FieldIntegrityException`.
- https://picchiri.altervista.org/salesforce/duplicate_value-setupownerid-custom-setting/ - one instance per `SetupOwnerId`, `DUPLICATE_VALUE` on a second insert (carried over from FEATURES.md, LOW-MEDIUM).
- Prior milestone research: `.planning/research/FEATURES.md`, `PITFALLS.md` C1-C5/F3, `STACK.md`, `ARCHITECTURE.md` (this document supersedes their UNVERIFIED items where noted).

### Tertiary (LOW confidence, flagged)
- Describe of `MetadataRelationship` fields, REST errorCode for `__mdt` DML, `customSetting` on `__mdt`, List `Name` uniqueness: no public source found; orglet choices recorded above.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies; everything verified in the repo.
- Architecture: HIGH for integration points (read from source with line references); MEDIUM for the exact SOQL special-case shape (design recommendation, not yet compiled).
- File formats and key prefix: HIGH - verified in several independent public projects and the official doc mirror.
- Describe spelling / DML code / `customSetting` on mdt: LOW - undocumented, deliberately recorded as orglet choices.
- Pitfalls: HIGH for the `isdeleted`, unique-index, `result.info`, reference bookkeeping and constructor findings (verified in code); MEDIUM for the parser trim/nil behaviours (derived from parser options, to be confirmed by the first unit test).

**Research date:** 2026-10-19
**Valid until:** 2026-11-18 (stable domain; the code line references hold until the next change to `compile.ts`, `store.ts`, `build.ts`)
