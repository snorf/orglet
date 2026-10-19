# Phase 11: Custom Metadata, Custom Settings & Labels - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-19
**Phase:** 11-custom-metadata-custom-settings-labels
**Areas discussed:** Ids/m00 prefix/reload, MetadataRelationship to entity/field definition, Read-only surface and describe flags, Custom settings and labels shape

---

## Pending todos cross-reference

| Option | Description | Selected |
|--------|-------------|----------|
| None of them | Both noted as reviewed-but-deferred | ✓ |
| Standard-field gaps on the 18 business objects | Phase 10 leftover (overrides.json) | |
| Colon syntax Rel:Object.Field in formulas | Needs sigha resync, Phase 12 | |

**User's choice:** None of them.

---

## Ids, m00 prefix and reset/reload

### Q1: How is the deterministic Id of an `__mdt` record derived?

| Option | Description | Selected |
|--------|-------------|----------|
| Hash of (type, DeveloperName) | m00 prefix + 12 base62 chars from a hash, case-safe suffix; no new state; same Id in every environment and after reset; collision is a hard error; a removed-then-re-added record gets its Id back | ✓ |
| Persisted mapping in `_orglet` | New table (org_schema, type, developer_name, id) with key-prefix identity rules; never reused; differs per database | |
| You decide | | |

**User's choice:** Hash of (type, DeveloperName).

### Q2: How are m00 prefixes for `__mdt` handled in the key-prefix mechanism?

| Option | Description | Selected |
|--------|-------------|----------|
| Own pool m00..mzz, otherwise identical | Same table, same precedence, `--key-prefixes` accepts `__mdt`, `check` lists them, `reset --drop-prefixes` clears them, cross-pool mapping is a hard error | ✓ |
| Own pool, but not in `--key-prefixes` | Mapping file stays `__c` only | |
| You decide | | |

**User's choice:** Own pool m00..mzz, otherwise identical.

### Q3: What does `orglet up` print when `__mdt` records are synced?

| Option | Description | Selected |
|--------|-------------|----------|
| One summary line, always | `custom metadata: N records in M types (a added, b updated, c removed)`, respects `--quiet` | ✓ |
| Only on changes, with names | Silent when unchanged, one line per affected record | |
| You decide | | |

**User's choice:** One summary line, always.

### Q4: How are record-file anomalies handled?

| Option | Description | Selected |
|--------|-------------|----------|
| Warning + null, record loads | Unknown type skips the record with `UNSUPPORTED:custom-metadata-record`; unknown field / uncoercible / invalid picklist -> null + one warning per type+field; all counted by `--strict` | ✓ |
| Hard error on uncoercible value | `up` exits 1 on a value that cannot be coerced | |
| You decide | | |

**User's choice:** Warning + null, record loads.

---

## MetadataRelationship to entity/field definition

### Q1: Describe shape of a relationship to EntityDefinition/FieldDefinition?

| Option | Description | Selected |
|--------|-------------|----------|
| `reference` with `referenceTo` EntityDefinition/FieldDefinition | Same type as Salesforce, stored value is the qualified API name string; researcher verifies spelling | ✓ |
| Plain string field | `type: string`, no relationshipName | |
| You decide | | |

**User's choice:** `reference` with `referenceTo` EntityDefinition/FieldDefinition.

### Q2: When is an entity/field-definition target "dangling"?

| Option | Description | Selected |
|--------|-------------|----------|
| Target must exist in the loaded OrgSchema | Unmodelled standard object is null + one warning per type+field+target | ✓ |
| Store verbatim, validate only mdt->mdt | No validation of the string | |
| You decide | | |

**User's choice:** Target must exist in the loaded OrgSchema.

### Q3: SOQL path through `Rel__r` other than `QualifiedApiName`?

| Option | Description | Selected |
|--------|-------------|----------|
| Query rejected: INVALID_FIELD with UNSUPPORTED message | HTTP 400, `UNSUPPORTED:entity-definition ...` | ✓ |
| Null + warning in QueryPage.warnings | Query succeeds, field null | |
| You decide | | |

**User's choice:** Query rejected: INVALID_FIELD with UNSUPPORTED message.

### Q4: mdt->mdt column FK and `metadataRelationshipControllingField`?

| Option | Description | Selected |
|--------|-------------|----------|
| Lookup-shaped column without FK, controlling field ignored silently | char(18), describe reference, ordinary JOIN; dangling null + warning in second pass | ✓ |
| Real FK + warning for controlling field | Topological sync ordering, `UNSUPPORTED:metadata-relationship-controlling-field` | |
| You decide | | |

**User's choice:** Lookup-shaped column without FK, controlling field ignored silently.

---

## Read-only surface and describe flags

### Q1: May `orglet up --import` write `__mdt` rows?

| Option | Description | Selected |
|--------|-------------|----------|
| No, `__mdt` refused even in import mode | Retrieve is the only source; documented deviation from Phase 3 D-08 | ✓ |
| Yes, consistent with D-08 | Import bypasses all flags | |
| You decide | | |

**User's choice:** No, `__mdt` refused even in import mode.

### Q2: Where are Bulk 2.0 and composite requests on `__mdt` rejected?

| Option | Description | Selected |
|--------|-------------|----------|
| Bulk at job creation, composite per record via refuse() | Ingest job gets 400 at POST; bulk query allowed | ✓ |
| Everything per record | Job created, all rows fail | |
| You decide | | |

**User's choice:** Bulk at job creation, composite per record via refuse().

### Q3: Describe flags not settled by docs?

| Option | Description | Selected |
|--------|-------------|----------|
| Follow Supported Calls strictly, rest false | queryable/retrieveable/custom true, everything else false, `customSetting` false unless sourced; deviations commented | ✓ |
| Only DML flags, others as `__c` | searchable/triggerable/layoutable inherited true | |
| You decide | | |

**User's choice:** Follow Supported Calls strictly, rest false.

### Q4: System fields on `__mdt`?

| Option | Description | Selected |
|--------|-------------|----------|
| Documented list + audit fields | Id, eight documented fields, CreatedDate/CreatedById/LastModifiedDate/LastModifiedById; no Name/OwnerId/IsDeleted | ✓ |
| Only the documented list | No audit fields | |
| You decide | | |

**User's choice:** Documented list + audit fields. Language default and Label picklist-vs-string left to research.

---

## Custom settings and labels shape

### Q1: Hierarchy setting insert without SetupOwnerId?

| Option | Description | Selected |
|--------|-------------|----------|
| Default to Organization Id | Org level is the documented default; second default row fails DUPLICATE_VALUE | ✓ |
| REQUIRED_FIELD_MISSING | Always required | |
| You decide | | |

**User's choice:** Default to Organization Id.

### Q2: Key prefix and Name field for custom settings?

| Option | Description | Selected |
|--------|-------------|----------|
| Share a00..azz pool, Name on both kinds | Series undocumented; Name required on List, optional on Hierarchy unless research says otherwise | ✓ |
| Own pool for settings | No source | |
| You decide | | |

**User's choice:** Share a00..azz pool, Name on both kinds.

### Q3: How does `orglet check` say custom-setting data is not in a retrieve?

| Option | Description | Selected |
|--------|-------------|----------|
| One `info:` line on stdout, not counted by `--strict` | Phase 10 D-08 mechanism, no UNSUPPORTED prefix | ✓ |
| `warning: UNSUPPORTED:custom-setting-data` | Counted by `--strict` | |
| You decide | | |

**User's choice:** One `info:` line on stdout, not counted by `--strict`.

### Q4: Where do custom labels live, and how are duplicates handled?

| Option | Description | Selected |
|--------|-------------|----------|
| Only on OrgSchema, duplicate warns | `OrgSchema.labels`, case-insensitive lookup, no sObject, `UNSUPPORTED:custom-label` on duplicate fullName, first wins | ✓ |
| Also as a readable object | Tooling-API-only in Salesforce | |
| You decide | | |

**User's choice:** Only on OrgSchema, duplicate warns.

---

## Claude's Discretion

- Seed step location and write path (Store vs SQL), hash function and slicing, parsed-record
  shapes, object-kind modelling on SObjectDef, test fixture placement, seed ordering relative to
  prefix reconciliation and transaction boundaries. Research settles Language default, Label
  describe type, MetadataRelationship describe spelling, the documented DML error code, and the
  `customSetting` value on `__mdt`.

## Deferred Ideas

- Formula globals (Phase 12), enterprise fixture and describe-check extension (Phase 14), label
  translations and `$Setup` on list settings (v2 CSET-03), queues (v2 CMDT-05), modelling
  EntityDefinition/FieldDefinition as queryable objects (not planned).
- Reviewed, not folded: standard-field gaps todo (Phase 10 leftover), colon-syntax todo (Phase 12).
