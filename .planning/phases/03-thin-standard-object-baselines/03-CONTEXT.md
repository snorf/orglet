# Phase 3: Thin Standard-Object Baselines - Context

**Gathered:** 2026-10-08 (checkpoint D-03a added after research, same day)
**Status:** Ready for planning

<domain>
## Phase Boundary

The 14 standard objects a Developer Edition retrieve references but the built-in baseline lacks
(BusinessHours, BusinessProcess, CallCenter, DandBCompany, Entitlement, ExternalDataSource,
IdeaTheme, Individual, OperatingHours, OpportunityHistory, ServiceAppointment, ServiceContract,
SocialPost, UserLicense) exist as thin baseline objects: documented key prefix, the documented
name-equivalent field (or none), system fields, and the createable/updateable/deletable flags
the public Object Reference documents. Lookups to them are reference-checked on save
(`INVALID_CROSS_REFERENCE_KEY`), DML that violates a flag is rejected with the documented
Salesforce error code, describe for each of them carries everything `jsforce` and
`simple-salesforce` read, and loading Johan's Developer Edition retrieve produces zero
`UNSUPPORTED:reference-target` warnings. `bootstrapOrg` seeds the two rows every real org has
(default BusinessHours, one UserLicense) so read-only objects are not permanently empty.
Requirements BASE-01..05.

Not in this phase: full field parity for the 14 objects (HEAD-06, v2), business behaviour
behind them (entitlement processes, business-hours maths, D&B data), the full conformance
re-run (phase 7), polymorphic lookups (phase 4).

</domain>

<decisions>
## Implementation Decisions

### Field surface per thin object
- **D-01:** Strict minimum per object: `Id`, the documented name-equivalent field, the system
  fields (`CreatedDate`, `CreatedById`, `LastModifiedDate`, `LastModifiedById`,
  `SystemModstamp`, `IsDeleted` as the existing `systemFields()` helper produces them) and
  `OwnerId` only where the Object Reference documents the object as owned. No documented
  lookups (`Entitlement.AccountId`, `ServiceContract.AccountId`, ...) and no business fields.
  Full parity is HEAD-06 in v2.
- **D-02:** The name-equivalent field follows the Object Reference exactly: `nameField: true`
  on the field the reference designates (`Name`, `MasterLabel`, `DeveloperName`,
  `AppointmentNumber`, ...). An object the reference gives no name-equivalent field
  (OpportunityHistory is the known case) gets none, describe reflects that, and the built-in
  object browser falls back to `Id`. No synthetic `Name` fields.
- **D-03:** Every key prefix, name-equivalent field and `Supported Calls` set is verified in
  research against at least two independent public sources (the Object Reference plus one
  other). Anything that cannot be confirmed (today: IdeaTheme's prefix `0Bg` is single-source;
  the name fields of DandBCompany, Entitlement, ServiceContract, SocialPost, IdeaTheme are
  unconfirmed) is raised to Johan as a checkpoint before the JSON is written. Nothing is
  guessed. Johan may answer such a checkpoint from his own org's describe if he chooses; orglet
  itself never contacts Salesforce.
- **D-04:** Flags are written explicitly per object in each JSON (`createable`, `updateable`,
  `deletable`, `undeletable` where relevant), in the style of the existing baselines. No
  generic `thin: true` switch that defaults flags to false (the research's proposal); the
  Object Reference's `Supported Calls` is the source of truth per object. Where it contradicts
  the "the rest full CRUD" summary in REQUIREMENTS/ROADMAP (research indicates BusinessHours
  and BusinessProcess have no `delete()`), the Object Reference wins and the REQUIREMENTS/ROADMAP
  wording is corrected in this phase.

- **D-03a (checkpoint resolved 2026-10-08):** Research (03-RESEARCH.md §Fact Table) confirmed
  all 14 flag sets and 13 of 14 prefixes from public sources. Johan answered the remaining
  questions from his own Developer Edition's describe (his call; orglet never contacts an org;
  record the source as "author's own DE describe, 2026-10-08" in the SUMMARY):
  - Entitlement: prefix `550`, name field `Name`, not owned. CONFIRMED.
  - ServiceContract: prefix `810`, name field `Name`, owned. CONFIRMED.
  - ExternalDataSource: prefix `0XC`, name field `DeveloperName`, not owned. CONFIRMED.
  - UserLicense: prefix `100`, name field `Name` (idLookup), not owned; `MasterLabel` exists
    as a second field. CONFIRMED (supersedes the D-05/D-07 assumption that MasterLabel is the
    name field; see D-07a).
  - DandBCompany: prefix `06E`, name field `Name`, not owned. CONFIRMED (second run against
    the devrandom-heimdall org, 2026-10-08).
  - OperatingHours: prefix `0OH`, name field `Name`, owned. CONFIRMED (same run; settles the
    v56/v68 ownership conflict in favour of owned).
  - IdeaTheme: NOT_FOUND in the Developer Edition (needs Ideas enabled), so it cannot be
    confirmed there. Use the research's safe default and mark it UNVERIFIED in the SUMMARY of
    the plan that writes its JSON: prefix `0Bg`, name field `Title`, not owned. No further
    checkpoint is needed.

### Seed rows at bootstrap
- **D-05:** `bootstrapOrg` seeds one `BusinessHours` row (`Name` "Default", `IsDefault` true,
  `IsActive` true) and one `UserLicense` row (`MasterLabel` "Salesforce") and points the
  System Administrator `Profile.UserLicenseId` at it. This mirrors a real org, where both
  always exist, and is the only way a read-only object ever gets rows in normal mode.
- **D-06:** Seeding is idempotent per `up`: a row is created only if missing (BusinessHours by
  `IsDefault`, UserLicense by `MasterLabel`), existing rows are never modified, and
  `Profile.UserLicenseId` is set only when it is null. Same pattern as Organization/User today.
  Johan's devrandom org therefore gains the two rows on its next `up`.
- **D-07:** The seed rows are the one explicit exception to D-01: BusinessHours carries
  `IsDefault` and `IsActive`, UserLicense carries `MasterLabel` in addition to its name field,
  and the existing `Profile.UserLicenseId` lookup becomes a real, checked reference to UserLicense.
- **D-07a:** Per D-03a, UserLicense's name field is `Name` (nameField, idLookup), with
  `MasterLabel` as a second required text field. The seed row sets both to "Salesforce".
  D-06's idempotency key for UserLicense stays `MasterLabel` as written (either field is
  unique in practice; keep the decision stable).

### Write protection and import mode
- **D-08:** Object-level flags are bypassed in import mode (`orglet up --import`), exactly as
  field-level flags, lookup checks, rules and hooks already are. This is the only way to migrate
  OpportunityHistory, UserLicense, ExternalDataSource or CallCenter rows from a real org. Normal
  mode keeps rejecting, as `DmlEngine.insert/update/delete` do today.
- **D-09:** The error code for a normal-mode DML that violates an object flag is verified by
  research against Salesforce documentation. Today the engine returns `invalidOperation`
  ("entity type X does not support insert"); keep it only if it matches the documented
  code for that operation, otherwise switch to the documented one (candidates seen in the
  wild: `INVALID_TYPE_FOR_OPERATION`, `CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY`). No invented
  codes; add to `Errors` in `packages/engine/src/errors.ts` if new.

### Describe verification through the SDKs (BASE-04)
- **D-10:** A vitest asserts, for all 14 objects, the describe properties the SDKs read in
  both global describe and per-object describe: `keyPrefix`, `name`, `nameField` on exactly
  one field or on none per D-02, `urls` (`sobject`, `describe`, `rowTemplate`), `fields[]`
  with the system fields present, `childRelationships[]` (which, after this phase, lists the
  baseline and custom lookups that point at the object).
- **D-11:** A reusable script under `conformance/` (working name `conformance/describe-check`,
  one entry per SDK: a Node script for `jsforce`, a Python script for `simple-salesforce`,
  sharing an object list) runs `describe()` for a list of objects against a running orglet
  and fails on any error or missing property. The phase's last plan runs it for the 14
  objects and records the output. The full conformance suites are not re-run here (phase 7).

### Claude's Discretion
- JSON file layout details beyond the existing baseline conventions (field order, labels,
  `length` values for text fields).
- How `bootstrapOrg` discovers the existing default BusinessHours / UserLicense rows (query
  pattern) and where the seed constants live.
- Whether the import-mode bypass is implemented as one check in `DmlEngine` or per
  operation; test placement in `engine.test.ts`.
- The exact name and interface of the describe-check script, and whether `conformance/*/README.md`
  gain a short section for it now or in phase 7.
- Whether to update `.planning/codebase/` documents (ARCHITECTURE/STRUCTURE) for the 14 new
  files.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` §"Phase 3" — goal, five success criteria, research flag naming the
  unconfirmed prefixes/name fields
- `.planning/REQUIREMENTS.md` — BASE-01..BASE-05; note D-04 on the "the rest full CRUD" summary
- `.planning/PROJECT.md` — constraints (public docs and SDK source only, no behaviour-diffing,
  Level 1 data only), Key Decisions

### Research for this phase
- `.planning/research/FEATURES.md` lines ~36-75 — per-object table: key prefix, Supported
  Calls, name-equivalent field, confidence; the starting point D-03 must re-verify
- `.planning/research/ARCHITECTURE.md` §"Feature 6" (around lines 460-500) — JSON files are
  auto-loaded by `loadBaseline()`; the `thin` flag proposal is NOT adopted (D-04), the rest
  of the component table applies
- `.planning/research/PITFALLS.md` §"Pitfall 18" — thin objects that break the SDKs'
  describe contract; the reason for D-02, D-10 and D-11

### Prior phase context
- `.planning/phases/02-custom-object-key-prefix-persistence/02-CONTEXT.md` D-03 and
  `packages/schema/src/prefixes.ts` — persisted custom prefixes are compared against every
  standard prefix on every `up`; the 14 new prefixes enter that check
- `.planning/phases/01-test-infrastructure-ci/01-CONTEXT.md` D-09..D-12, D-20/D-21 — pglite
  per file, `test_<hex>` schema, Postgres-only skip mechanism

### Existing code this phase changes or depends on
- `packages/metadata/standard/objects/*.json` — 21 existing baselines; `Group.json` and
  `Profile.json` are the closest templates (flags, `hasOwner`, `nameField`, `idLookup`)
- `packages/metadata/src/build.ts` — `loadBaseline()` (auto-discovers `*.json`),
  `fromStandardObject()` (flag defaults `?? true`, `systemFields(hasOwner)`), the
  `UNSUPPORTED:reference-target` warning loop at the end of `buildOrgSchema()`
- `packages/metadata/src/types.ts` — `StandardObjectJson`, `SObjectDef` flags
- `packages/engine/src/engine.ts` — object-flag checks at the top of `insert`/`update`/
  `delete` (~lines 95, 105, 158), `importMode`, `checkReferences` (~line 487-510)
- `packages/engine/src/coerce.ts` ~line 132 — the existing import-mode bypass for field flags
- `packages/engine/src/errors.ts` — `Errors` factory, `invalidOperation`,
  `invalidCrossReference`
- `packages/engine/src/bootstrap.ts` — `need()`, `withTransaction`, the existing-row check
  and `store.insert` pattern to extend for the seed rows
- `packages/api/src/describe.ts` — global and per-object describe shapes (`keyPrefix`,
  `nameField`, `urls`, `childRelationships`)
- `packages/metadata/src/build.test.ts` — "loads the phase-0 standard objects with their key
  prefixes" test to extend for the 14
- `conformance/jsforce/run.sh`, `conformance/jsforce/seed.mjs`, `conformance/python/run.py`
  — how the SDK harnesses reach a running orglet (reuse for D-11)
- `examples/acme` — fixture for tests; Johan's DE retrieve
  (`~/Development.nosync/devrandom-metadata`, Level 1, local only) for the BASE-05 check

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `loadBaseline()` reads every `*.json` under `standard/objects`, so the 14 objects need no
  loader change; `fromStandardObject()` already applies `createable/updateable/deletable`
  from JSON and adds system fields via `systemFields(hasOwner)`.
- `DmlEngine.insert/update/delete` already refuse operations on objects whose flag is false
  (`Errors.invalidOperation`), so BASE-03's enforcement exists; the phase supplies correct flag
  values, the documented error code (D-09) and the import-mode bypass (D-08).
- `checkReferences` already validates lookups against any object present in the schema, so
  BASE-02 follows automatically once the 14 objects exist; the DE's `BusinessHoursId`,
  `IndividualId`, `DandbCompanyId`, ... lookups become checked.
- `bootstrapOrg` has the idempotent "find existing by key, else insert with system fields"
  pattern for Organization/Profile/User and RecordType, to extend for the two seed rows.
- `describe.ts` derives `childRelationships` from `schema.childRelationships(obj.name)`, so
  the new objects' child relationships appear without describe changes.
- Phase 2's `prefixes.ts` collision check will reject a persisted custom prefix equal to any
  of the 14 new prefixes; none of them start with `a`, so acme and devrandom are unaffected.

### Established Patterns
- Baseline JSON: `name`, `label`, `labelPlural`, `keyPrefix`, `hasOwner`, optional
  `createable/updateable/deletable/undeletable/queryable`, `fields[]` with `nameField`,
  `idLookup`, `nillable`, `updateable`, `createable` per field.
- `Errors.*` factories with real Salesforce `StatusCode` values; `UNSUPPORTED:<area>` only for
  deliberately unimplemented features (not for rejected DML).
- Import mode bypasses enforcement rather than changing data semantics (`coerce.ts`,
  `session_replication_role`, audit stamps).
- Tests: per-file pglite, `test_<hex>` schema, `openTestDb`; CLI tests via `main()` with
  console spies; acceptance evidence recorded as literal output in SUMMARY.
- Conformance harnesses live in `conformance/jsforce` (bash + mjs) and `conformance/python`
  (Python 3, `requirements.txt`) and are run manually against a server, never in CI.

### Integration Points
- 14 new files in `packages/metadata/standard/objects/`.
- `packages/engine/src/bootstrap.ts` (seed rows), `packages/engine/src/engine.ts` (import-mode
  bypass of object flags, possibly error code), `packages/engine/src/errors.ts`.
- `packages/metadata/standard/objects/Profile.json` — `UserLicenseId` lookup is already
  declared; it becomes a checked reference once UserLicense exists.
- `conformance/` — new describe-check script (D-11).
- `.planning/REQUIREMENTS.md` / `.planning/ROADMAP.md` — wording fix per D-04 if research
  confirms the BusinessHours/BusinessProcess delete() gap.

</code_context>

<specifics>
## Specific Ideas

- BASE-05 is checked literally: `orglet check --project ~/Development.nosync/devrandom-metadata`
  must print zero `UNSUPPORTED:reference-target` lines (the remaining `UNSUPPORTED:field-type`
  for the Summary field belongs to phase 5). The DE retrieve stays local; the acme fixture is
  what tests use.
- The verification mindset from phase 2 carries over: literal observed output in SUMMARY, the
  real CLI run against Docker Postgres in an isolated org schema, and Johan's devrandom org as
  the final human checkpoint (expect the two seed rows to appear once, then silence).
- "Faithful over faked": an object the Object Reference marks read-only must reject writes in
  normal mode even though that makes it harder to populate; D-05 and D-08 are the sanctioned
  ways to get rows in.

</specifics>

<deferred>
## Deferred Ideas

- Full field sets for the 14 objects (HEAD-06, v2).
- Documented lookups on the thin objects (Entitlement.AccountId, ServiceContract.AccountId,
  SocialPost.ParentId, ServiceAppointment.ParentRecordId): revisit with HEAD-06 or when phase 4
  needs a polymorphic fixture.
- A generic `thin` flag in `StandardObjectJson` (research proposal): not needed with explicit
  flags; reconsider only if many more thin objects arrive.
- Running the describe-check script in CI: conformance stays manual until phase 7 decides.

### Reviewed Todos (not folded)
- "Reword ROADMAP phase 7 to validate against the DE retrieve, not the org" — matched on
  keywords only; belongs to phase 7 and stays pending there.

</deferred>

---

*Phase: 03-thin-standard-object-baselines*
*Context gathered: 2026-10-08*
