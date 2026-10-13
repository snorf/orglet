# Architecture Patterns: v1.1 real-org fidelity integration

**Domain:** Salesforce platform emulator (orglet), subsequent milestone
**Researched:** 2026-10-12
**Scope:** only how the seven v1.1 features integrate with the shipped v1.0 layering
(`metadata -> schema -> {formula, soql} -> engine -> api -> cli`, vendored `sigha`).
**Confidence:** HIGH on integration points (read from the code: `build.ts`, `rollup.ts`, `formulas.ts`,
`compile.ts`, `evaluate.ts`, `schema/rollup.ts`, `migrate.ts`, `columns.ts`, `ddl.ts`, `engine.ts`, `main.ts`).
MEDIUM on Salesforce-side semantics (roll-up-over-formula restrictions, `$Setup` on list settings,
MetadataRelationship storage); these are flagged LOW where used and need a phase-level check against the public docs.

## Facts about the current code that drive every decision below

1. **Formulas are never stored.** `isVirtual()` in `packages/schema/src/columns.ts` gives formula fields no column.
   They are computed in TypeScript per row by `applyFormulaFields` (`packages/engine/src/formulas.ts`), called from
   `DmlEngine.project()` (reads and SOQL results) after `loadParents` attaches the parent paths the compiled formula needs.
2. **Formulas are compiled once per schema** (`FormulaRegistry` constructor) and evaluated per row with a flat
   `EvaluationContext`. Globals reach evaluation as `ctx.user/profile/organization/recordType`, loaded by
   `DmlEngine.loadGlobals()` once per DML call and once per `project()` call (3 point reads each time).
3. **Global resolution is a compile-time schema lookup.** `GLOBAL_OBJECTS` in `packages/formula/src/compile.ts` maps
   `$user -> User` etc., `resolvePath` validates the path against the schema, and a `FieldReference{kind:"global"}` is
   emitted. `evaluate.ts#globalRecord` returns the record for that global. Adding a global whose data is a record is a
   two-line change in each file; adding one whose data is not a record (`$Api`, `$Label`) needs a different reference kind.
4. **Roll-ups are SQL-only.** `rollupSelectSql`/`rollupBackfillSql` in `packages/schema/src/rollup.ts` emit a correlated
   `(SELECT agg(c.col) FROM child c WHERE c.fk = p.id AND ...)`. `familyOf` in `packages/metadata/src/rollup.ts` rejects
   formula and roll-up filter fields; the summarized field must be a stored column. `migrate()` step 3 backfills new
   roll-up columns by SQL, and `schema` has no dependency on `formula`.
5. **`buildOrgSchema` is a pure function** `(Baseline, SourceProject) -> {schema, warnings: string[]}`. Warnings are
   plain strings prefixed `UNSUPPORTED:<area>`; `orglet check` just prints them (`main.ts#check`) after also printing
   `new FormulaRegistry(schema).warnings`. There is no structured diagnostic, so root-cause grouping needs one.
6. **`migrate()` is additive and transactional**: `ADD COLUMN` for missing columns (NOT NULL only for system fields,
   MasterDetail, Checkbox-with-default-false), type widening automatic / narrowing refused with
   `UNSUPPORTED:schema-narrow`, extra columns kept with `UNSUPPORTED:schema-drop`, `CREATE INDEX IF NOT EXISTS`, and
   FKs added only if the constraint name is absent; a dangling-data FK violation throws and rolls back the whole migration.
7. **sigha is third-party** (`rfaulhaber/sigha`, MIT) vendored by `scripts/sync-sigha.sh <rev>`. Upstream changes
   (colon syntax, `!`) have external lead time; orglet can pin a branch/fork rev meanwhile.

## Recommended architecture (delta view)

```
                        scripts/gen-baseline/  (NEW, offline)
                        input: snapshot/*.json (committed)  -> output: packages/metadata/standard/objects/*.json
                                                  |
 SFDX project  ---> sfdx.ts (MOD: customMetadata/, labels/, settings, MetadataRelationship)
 baseline JSON ---> build.ts (MOD: mdt+settings objects, owner narrowing, Notice tier, SkippedItem list)
                          |  OrgSchema (MOD: + customMetadata records, labels, customSettingsType on SObjectDef)
                          v
 schema:  columns/ddl/migrate (MOD: mdt tables, "pendingBackfills" for formula roll-ups, FK pre-check)
                          |
        +-----------------+------------------+
        v                                    v
 formula (MOD: $UserRole $Api $Setup $Label $CustomMetadata)      soql (MOD: nothing structural;
        |                                                         mdt/settings are ordinary tables)
        v
 engine:  FormulaRegistry (MOD: setupRefs, skipped-set, structured failures)
          loadGlobals (MOD: +userRole, +setup, +api)
          seed.ts (NEW: custom metadata sync after migrate)
          rollups.ts + engine.ts (MOD: formula-aware roll-up recompute, watched set)
          backfill (NEW: formula roll-up backfill after migrate)
                          v
 api: describe.ts (MOD: customSettings flag, mdt read-only flags)       cli: check (MOD: report builder, --json)
```

### Component boundaries (new vs modified)

| Component | New / Mod | Package / path | Responsibility |
|-----------|-----------|----------------|----------------|
| Baseline generator | NEW | `scripts/gen-baseline/` (not a workspace package) | Snapshot -> deterministic `standard/objects/*.json` |
| Baseline snapshot | NEW | `scripts/gen-baseline/snapshot/` | Committed, human-reviewable extraction of the public Object Reference |
| `StandardObjectJson` | MOD | `packages/metadata/src/types.ts` | + `ownerTargets?: string[]`, + `readOnlyObject` etc. only if generator needs them |
| Custom metadata + settings parsing | MOD | `packages/metadata/src/sfdx.ts` | `customMetadata/*.md-meta.xml`, `labels/CustomLabels.labels-meta.xml`, `<customSettingsType>`, `MetadataRelationship` field |
| Custom metadata object construction | MOD | `packages/metadata/src/build.ts` | `__mdt` -> read-only `SObjectDef`; settings -> `SObjectDef{customSettingsType}`; records + labels onto `OrgSchema` |
| `OrgSchema` additions | MOD | `types.ts`, `schema.ts` | `customMetadata: ReadonlyMap<type, ReadonlyMap<devName, RecordData>>`, `labels: ReadonlyMap<name, string>` |
| Skipped/notice bookkeeping | MOD | `build.ts` | `BuildResult.skipped: SkippedItem[]`, `BuildResult.notices: string[]` |
| mdt table DDL | MOD (small) | `packages/schema/src/columns.ts`, `ddl.ts` | none structural; objects are ordinary tables |
| Formula roll-up backfill signal | MOD | `packages/schema/src/migrate.ts` | return `pendingBackfills` instead of running SQL for formula-dependent roll-ups |
| Formula globals | MOD | `packages/formula/src/compile.ts`, `evaluate.ts` | new global kinds, constant folding for `$Label`/`$CustomMetadata` |
| Setup/UserRole/Api globals | MOD | `packages/engine/src/engine.ts#loadGlobals` | load only what compiled formulas reference |
| Custom metadata seeding | NEW | `packages/engine/src/seed.ts` | idempotent file-to-table sync, called by CLI after `migrate` |
| Formula-aware roll-up SQL | MOD | `packages/schema/src/rollup.ts` | optional "virtual column" derived table input |
| Formula-aware recompute | MOD | `packages/engine/src/engine.ts`, `rollups.ts` | compute child formula values in TS, pass to SQL |
| Check report builder | NEW | `packages/cli/src/report.ts` | classify, root-cause group, area summary, `--json` |
| sigha upgrade | MOD (vendored) | `packages/sigha/` via `scripts/sync-sigha.sh` | colon syntax, `!` |

## Answers to the specific questions

### 1. Where do `__mdt` records live at runtime

**Recommendation: ordinary Postgres tables, seeded by `orglet up`, plus an immutable copy on `OrgSchema` used only for
compile-time constant folding.** Do not build an in-memory store.

Rationale:
- Every read surface already goes through Postgres: SOQL (`packages/soql/src/compile.ts`), `Store.loadByIds`, REST
  `sobjects` retrieve/describe, parent loading in `loadParents`, Bulk query. An in-memory store would need a second
  implementation of every one of them (filters, relationship traversal `Rel__r.Field`, ORDER BY, aggregate, paging).
- MetadataRelationship lookups from a `__mdt` to another `__mdt`, and `Child__r.Field` traversals in SOQL, work for free
  if both are tables with FKs.
- The data is small and file-derived, so seeding cost is irrelevant.

Mechanics:
- `build.ts` creates an `SObjectDef` per `X__mdt` with `custom: true`, `createable/updateable/deletable/undeletable: false`,
  `hasOwner: false`. The engine already refuses writes for such flags (UserLicense is the precedent in `bootstrap.ts`), so
  clients get the normal error and read-only behaviour for free. System fields per Salesforce: `Id, DeveloperName,
  MasterLabel, Label, Language, NamespacePrefix, QualifiedApiName` plus audit fields; add a dedicated `systemFields` variant
  rather than reusing the `Name` field logic (mdt has `DeveloperName` and `MasterLabel`, no `Name`).
- Seeding is `seedCustomMetadata(pool, schema, {orgSchema})` in the NEW `packages/engine/src/seed.ts`, run by
  `cli/main.ts#up` between `migrate()` and `bootstrapOrg()` (it needs no session). It writes through `Store`/raw SQL, not
  through `DmlEngine`, which is how it bypasses the read-only flags.
- **Re-seed on reload = full sync keyed by `DeveloperName`**, in one transaction: update rows that exist (Id preserved,
  so Ids that other tables or the user captured stay stable), insert new ones, delete rows no longer in the files. Files are
  the single source of truth and clients cannot write, so deleting is safe and needs no `--force`.
- Two-pass for MetadataRelationship: pass 1 inserts all rows; pass 2 resolves `<values><field>Rel__c</field><value>Type.Rec`
  references (record DeveloperName) to Ids. Store the column as a `Lookup`-shaped `char(18)` with `referenceTo:[Target__mdt]`.
  (LOW confidence on how the real API surfaces MetadataRelationship values and on entity/field-definition targets; the
  latter should stay `UNSUPPORTED:metadata-relationship` stored as `varchar(255)` until researched.)
- Key prefix: `__mdt` types need a prefix like any object. `customKeyPrefix(i)` in `build.ts` indexes only `__c` objects
  (`isCustomObjectName`), so mdt must get its own provisional pool (e.g. `m` + 2 chars) and be included in
  `reconcileKeyPrefixes`; otherwise adding `__mdt` types would shift provisional indices (persisted ones do not shift).
- `build.ts` currently emits `UNSUPPORTED:object-kind` for `__mdt`; that branch is replaced, the other kinds (`__e`, `__x`,
  `__b`, `__share`, `__history`, `__feed`) keep it.

**Custom settings are different: they are mutable data**, so they are tables with normal write semantics (list and
hierarchy). Metadata gives `<customSettingsType>List|Hierarchy</customSettingsType>`, stored as
`SObjectDef.customSettingsType`. Hierarchy settings get a `SetupOwnerId` lookup (User/Profile/Organization targets).
Describe adds `customSettings: true`.

### 2. `$CustomMetadata` / `$Setup` / `$Label` at compile vs evaluate time

Split by mutability, which falls out of the architecture:

| Global | Data source | Mutable at runtime | Resolution | Where |
|--------|-------------|--------------------|------------|-------|
| `$Label.X` | `labels/CustomLabels.labels-meta.xml` (+ standard labels, out of scope) | No (file only) | **Compile time, constant-folded to a `StringLit`** | `compile.ts`, reads `OrgSchema.labels` |
| `$CustomMetadata.T__mdt.Rec.F__c` | `OrgSchema.customMetadata` (same parse as seeding) | No (read-only) | **Compile time, constant-folded to a literal of the field's type** | `compile.ts` |
| `$Setup.S__c.F__c` | Table rows (user-writable) | Yes | **Evaluate time**, compile validates the path | `compile.ts` + `evaluate.ts` + `loadGlobals` |
| `$UserRole.F` | `UserRole` row of the session user | Yes | Evaluate time, same as `$User` | add `$userrole: "UserRole"` to `GLOBAL_OBJECTS`, `ctx.userRole` |
| `$Api.Session_ID` etc. | Process/session constants | n/a | Evaluate time, from a new `ctx.api` | new reference kind `"api"` |

Why constant folding for `$CustomMetadata`/`$Label`: compiled-once-per-field fits exactly (value fixed for the life of the
`OrgSchema`, which is immutable and rebuilt on reload), it makes the evaluator and per-row cost unchanged, and compile
errors for a nonexistent type/record/field come out at compile time with Salesforce-style wording
(`Field $CustomMetadata.X does not exist`) and cleanly become a root cause in `orglet check`. Implementation: in
`rewriteFieldRef`, before the `GLOBAL_OBJECTS` lookup, handle roots `$label` and `$custommetadata`: build a literal AST node
(`StringLit`/`NumberLit`/`BooleanLit`/`NullLit` from `packages/sigha/src/syntax/ast.ts`) and return it instead of
`register(...)`. The folded value must go through `toSfValue` typing the same way `valueFor` does for a stored field, so
reuse `sfTypeOf(field)` plus the existing literal constructors. Do NOT hold DB state in the compiled formula.

Why evaluate time for `$Setup`: custom settings rows are loadable through the API, so a value baked at compile time goes
stale. Keep the compile step schema-only and add data at evaluation:
- `compile.ts`: `$setup` resolves via `resolvePath(schema, <SettingObject>, rest)` exactly like other globals; emit
  `FieldReference{kind:"global", global:"$Setup", path:[Setting__c, Field__c]}`. `evaluate.ts#globalRecord("$Setup")`
  returns `ctx.setup`, a `RecordData` keyed by setting object name (`lookup()` then walks `[Setting__c, Field__c]` with no
  other evaluator change).
- `FormulaRegistry` collects `setupObjects: Set<string>` (union of `$Setup` references over all compiled formulas) so
  `loadGlobals` loads settings only when some formula uses them. This keeps the common DML/read path at 3 reads.
- `loadGlobals` resolves hierarchy settings for the session: row with `SetupOwnerId = userId`, else `profileId`, else the
  org default (`SetupOwnerId = organizationId`). List settings: LOW confidence that `$Setup` addresses them in formulas at
  all (documentation to confirm); until confirmed, `$Setup.<list setting>` should compile to
  `UNSUPPORTED:formula-global` and only hierarchy settings are wired.
- Perf note: `project()` calls `loadGlobals` on every read that returns rows; add a per-call memo (a `Globals` is already
  passed down on the DML path, `project()` is the only place that reloads) or a short-lived cache keyed by session when
  `setupObjects.size > 0`.

`$Api`: Salesforce exposes `$Api.Session_ID`, `$Api.Partner_Server_URL_xxx`, `$Api.Enterprise_Server_URL_xxx`. These are
not schema fields; `rewriteFieldRef` should validate the member name against a small allowlist, register
`{kind:"api", path:[member]}`, and `evaluate.ts` reads `ctx.api[member]`. The API layer owns the values (the `Session` type
in `packages/engine/src/hooks.ts` gains an optional `sessionId`/`serverUrl`, populated by `packages/api/src/auth.ts`).
Anything not allowlisted stays `UNSUPPORTED:formula-global`. `$Permission` stays unsupported (milestone decision).

`$UserRole` is the only "record global" that needs a new baseline object guarantee: `UserRole` exists in the 35 objects,
the session user's `UserRoleId` is set by `bootstrap.ts` only if a role row exists; absence yields null fields, which is
the correct Salesforce result for a user with no role.

### 3. Roll-up over a formula child field

Options evaluated against facts 1 and 4:

| Option | Verdict | Why |
|--------|---------|-----|
| SQL translation of a "safe" formula subset | Reject | Second implementation of formula semantics next to sigha; two sources of truth drift (BlankAsZero, text coercion, date arithmetic, `ISBLANK`/`NULL` rules). Cross-object (`Parent__r.F`) needs joins. Unbounded surface forever. |
| Stored generated column | Reject | Postgres generated columns must be immutable and single-row; formulas read parents, `TODAY()`, `$User`. Would also give formulas a column, breaking `isVirtual` and everything keyed on it. |
| Materialise on write into a stored shadow column | Reject | Staleness whenever a referenced parent or time-dependent term changes; needs its own dependency tracking and backfill on every formula edit. |
| **Compute formula values in TS, hand them to the existing SQL aggregate as a derived table** | **Recommend** | Reuses 100% of the filter/aggregate SQL semantics (case-insensitive text, null handling, ROLL-03 rules) and 100% of formula semantics. Only the child source relation changes. |

Design:
1. `packages/metadata/src/rollup.ts`: `familyOf` accepts a formula field (family from its return type) both as summarized
   field and as filter field; `resolveRollups` produces the column type from the formula's type (the summarized-type
   check at the `allowed` set already works off `summarized.type`). Add `RollupDef.viaFormula?: string[]` (names of the
   formula fields it depends on) so downstream layers do not re-derive it. Keep dropping with `UNSUPPORTED:rollup-type`
   anything Salesforce disallows (restrictions on cross-object/volatile formulas: LOW confidence, verify in docs; the
   safe default is to allow only formulas whose `CompiledFormula.references` are all same-object non-global and contain
   no `TODAY/NOW` and otherwise warn `UNSUPPORTED:rollup-formula`, which also removes the staleness problem below).
   Because `metadata` cannot compile formulas, the "is it safe" check runs in `FormulaRegistry` (engine) as a second
   validation pass that downgrades to a warning and marks the roll-up inert; `metadata` only does type/shape.
2. `packages/schema/src/rollup.ts`: `aggregate()` gains an optional `virtualCols: Map<fieldName, {param index}>`; when a
   child column is virtual the child relation becomes
   `(SELECT c0.*, v."<f>" FROM org.child c0 JOIN unnest($n::char(18)[], $m::<sqltype>[]) AS v(id, "<f>") ON v.id = c0.id) c`
   so every existing `c."col"` reference and `filterSql` keeps working. `rollupSelectSql(... , virtual?: VirtualColumns)`
   is a backwards-compatible optional parameter; the pure "SQL + params, executes nothing" contract is preserved.
3. `packages/engine/src/engine.ts#recomputeRollups`: for a `ParentGroup` containing any formula-dependent field, first
   `SELECT` the live child rows for the affected parent ids (one query per child object), run `loadParents` +
   `applyFormulaFields` (the same path as `project()`), build the id/value arrays, then call `rollupSelectSql` with
   `virtual`. Children are read after the write (the DML write precedes the recompute callback in `withRollups`), so values
   are consistent. Cost is O(children of affected parents) rather than O(1) aggregate; acceptable for an emulator, call it out.
4. `RollupRegistry` (`packages/engine/src/rollups.ts`) is built from the schema only. Its `watched` set must additionally
   contain the same-object fields the child formula reads, otherwise updates to those fields do not trigger a recompute
   (the registry would silently miss them). So `RollupRegistry` takes the `FormulaRegistry` (or a `formulaDeps(child, field)`
   callback) in its constructor; `DmlEngine` already builds both, order them formulas first.
5. `packages/schema/src/migrate.ts` step 3: backfill SQL for formula-dependent roll-ups cannot run in `schema` (no
   formula engine, layering). `migrate()` returns `pendingBackfills: {object, field}[]` for them and skips the SQL;
   `cli/main.ts#up` calls `engine.backfillFormulaRollups(pendingBackfills)` right after constructing the `DmlEngine`
   (before `app.listen`). Plain-stored roll-ups keep the current in-transaction backfill. Ordering by `rollupDepth` still
   applies; formula-dependent ones run in the engine pass, after SQL ones of lower depth.
6. SOQL on a formula-summarized roll-up needs nothing: the roll-up column is an ordinary stored column.

Risk: a roll-up over a formula that reads a *parent* of the child is stale when that parent changes (nothing re-triggers).
Hence the same-object-only restriction above is also a correctness guard, not just a Salesforce fidelity rule.

### 4. "Referenced vs unreferenced" standard objects and root-cause reporting

What actually needs distinguishing: project files that mention a standard object the baseline does not model
(`UNSUPPORTED:standard-object X skipped` today). Those are noise **unless something loaded refers to them**.

Computation in `build.ts` (pure, no formula package needed): after the merge loops and roll-up resolution, build
`referenced = { every f.referenceTo[*] on every field } U { rollup.childObject } U { objects named in validationRules'
parent chains are already lookups }`. Formula text can only reach another object through a relationship, which is a
lookup, so lookup `referenceTo` plus roll-ups covers formulas and validation rules without compiling them. Then:
- skipped object `X` with `X in referenced` -> stays a warning, but as a **root cause**: the existing
  `UNSUPPORTED:reference-target X is referenced but not defined` is that warning; fold the redundant
  `standard-object X skipped` into it (one line, not two).
- skipped object `X not in referenced` -> `BuildResult.notices` (info tier, never counted by `--strict`).

Structured diagnostics (the prerequisite for root cause): keep `warnings: string[]` and the `UNSUPPORTED:<area>` text
convention untouched (CONVENTIONS, `--strict`, CI depend on it), and add alongside:

```ts
interface SkippedItem {            // build.ts, load-time skips; also pushed as the existing warning string
  kind: "object" | "field" | "rollup" | "rule";
  object: string; name?: string;   // e.g. Account / Legacy__c
  area: string;                    // field-type, standard-object, rollup-target, ...
}
interface FormulaFailure {         // engine/formulas.ts, produced next to the existing warning string
  what: string;                    // "formula field X.Y"
  object: string; name: string;
  missing?: { object: string; field: string };   // from FormulaCompileError.missing
}
```

- `FormulaCompileError` (`packages/formula/src/compile.ts`) gains an optional `missing: {object, field}` set by
  `fieldNotFound`/`resolvePath`, so no regex on messages.
- `FormulaRegistry` keeps `failures: FormulaFailure[]` and a `skippedFormulaFields` set; when compiling formula B that
  references formula A which failed, A is absent from nothing (A exists in the schema as a field), so the compile succeeds
  and fails only at evaluation. To make the cascade explicit, compile in dependency order: sort formula fields by
  references-to-other-formula-fields (topological; cycles -> `UNSUPPORTED:formula-cycle`), and when a reference points at a
  field in `skippedFormulaFields`, throw `FormulaCompileError` with `cause: <that failure>`.
- `packages/cli/src/report.ts` (NEW) builds the graph: nodes are `SkippedItem` and `FormulaFailure`; an edge A -> B when B's
  `missing` is (or its `cause` chain ends in) A. Roots (no incoming edge) are printed with "caused N dependent items";
  dependents are printed collapsed under the root, e.g.
  `ROOT UNSUPPORTED:field-type Account.Legacy__c (MetadataRelationship) -> 14 formula fields, 2 roll-ups skipped`.
  Per-area counts come from the `area` token already present in every warning; this needs no new data.
- `--json` emits `{summary:{byArea}, roots:[{item, dependents}], notices:[...], warnings:[...]}`; the human format and the
  JSON are two renderers over one `Report` object, so they cannot disagree. `--strict` semantics: exit 1 if any
  *warning* remains, notices never count.

The area taxonomy for the summary is the text between `UNSUPPORTED:` and the first space; do not invent a second enum.

### 5. Baseline generator: location and reproducibility

**Location: `scripts/gen-baseline/` (a TypeScript script run with `tsx`), not a workspace package.** Rationale: it is
build-time tooling that is never imported at runtime, `sync-sigha.sh` is the established precedent for "vendoring step
whose output is committed", and a package would enter the project-reference `tsc -b` graph, the lint config, and the
`exports` conventions for no benefit. It still gets a vitest test (picked up via a path added to
`vitest.config.ts` includes, or colocated under `packages/metadata/test/` which `tsconfig.test.json` already allows).

Reproducibility:
- **Snapshot input committed**: `scripts/gen-baseline/snapshot/<Object>.json`, a normalised extraction of the public Object
  Reference (one file per object: fields with type, length, nillable, createable, updateable, referenceTo, picklist,
  relationship names). Fetching/scraping is a separate, manual, human-reviewed step (`pnpm baseline:snapshot`) that rewrites
  the snapshot; the generator step (`pnpm baseline:gen`) is offline, pure and has no network.
- **Overrides file** `scripts/gen-baseline/overrides.json` (committed): hand corrections the docs get wrong or omit
  (owner targets per object, key prefixes, `childRelationshipName`, standard-value-set bindings, feature-gated fields to
  skip per the README rules). Every override carries a `reason` string. Keeping data and corrections separate is what keeps
  regeneration diffs reviewable.
- **Deterministic output**: stable key order, objects and fields sorted with a fixed comparator (not locale-dependent;
  `localeCompare` is already used in `planSchema`, use plain code-unit compare in the generator), 2-space JSON, trailing
  newline, no timestamps. CI check `pnpm baseline:gen && git diff --exit-code packages/metadata/standard` guards drift.
- Output contract is unchanged: same `StandardObjectJson` shape, same `standard/README.md` rules (the generator must keep
  excluding the system fields `build.ts#systemFields` adds), so `loadBaseline` and every consumer stay untouched. Only
  addition: `ownerTargets` (see 6).
- Legal constraint (PROJECT.md): snapshot is derived from public documentation only; record the doc URL and retrieval date
  per object in the snapshot header. Never diff against a real org.

### 6. OwnerId `referenceTo` narrowing per object

Today `systemFields(hasOwner)` hardcodes `owner.referenceTo = ["User","Group"]`, so `Owner.Name` fails in
`compile.ts` (polymorphic traversal throws `fieldNotFound`). Fix at the data source, not in the compiler:
- `StandardObjectJson.ownerTargets?: ("User"|"Group")[]` (default `["User","Group"]`, matching today); generator emits
  `["User"]` for objects whose OwnerId is User-only (Account, Contact, Opportunity, Campaign, Contract...) and keeps both
  for queue-capable ones (Lead, Case, Task? check docs per object; Task OwnerId is User-only in docs, LOW confidence on any
  one object so the generator's overrides carry a source URL).
- `systemFields(hasOwner, ownerTargets)` in `build.ts` threads it through; custom objects keep `["User","Group"]`
  (custom objects can be queue-owned only if enabled; keep existing behaviour, no change for custom).
- Effect downstream: `resolveRelationship` returns a single non-polymorphic target, `compile.ts` accepts `Owner.Name`,
  SOQL `Owner.Name` stops needing the polymorphic first-target path, `planTable` now adds an FK for the OwnerId column
  (`referenceTo.length === 1`). **That FK addition on a populated column is the migration risk in section 7.**

### 7. What breaks in `migrate()` when the baseline grows on an existing org database

Walk of `migrate.ts` / `columns.ts` / `ddl.ts` against a populated v1.0 database:

| Change in baseline v2 | migrate() behaviour | Severity | Action |
|-----------------------|---------------------|----------|--------|
| Hundreds of new nullable columns on existing objects | `ADD COLUMN` nullable, no rewrite, fast. 1600-column Postgres limit not near (Account ~100-200). | None | Nothing; add a migrate test with a v1-shaped DB then v2 schema (use the real v1.0 baseline files from git as the fixture). |
| New Checkbox columns | `NOT NULL DEFAULT false`: Postgres 11+ adds constant defaults without rewrite; OK on populated tables. | None | Nothing. |
| New MasterDetail column on an **existing populated** table | `notNull:true` with no default -> `ADD COLUMN ... NOT NULL` **fails** on a non-empty table, aborting the transaction | **High** | Baseline v2 must not add MasterDetail to existing objects; generator asserts it. If unavoidable, migrate must add nullable then enforce only when table is empty (never silently default). |
| OwnerId `referenceTo` narrowed to `["User"]` (section 6) | New FK `fk_<table>_ownerid` added on populated column; rows owned by a Group or an id that was never a User fail `foreignKeySql` -> whole migration rolled back with the "cannot add foreign key" error | **High** | Pre-check query before adding any new FK (`SELECT count(*) ... WHERE col IS NOT NULL AND NOT EXISTS (...)`) so the error names every offending table/column/count at once, not the first. Offer that FKs introduced by a baseline change on existing columns downgrade to `UNSUPPORTED:schema-fk` warning + skip when violated (never `--force` delete data). Only objects whose real owner is User-only get narrowed. |
| Lookups from existing columns to newly added objects (Quote, Order...) | FK created in step 2 after all tables exist (step 1 runs first); existing values are NULL | None | Table creation happens before FKs, good; keep that ordering. |
| Existing field gets different length/precision in generated baseline | Widening auto-applied (`isWidening`); narrowing refused with `UNSUPPORTED:schema-narrow` and the DB keeps old type -> permanent warning on every `up` | Medium | Generator regression check against v1 for shrinking fields; for real corrections tell users to use `--force`. Expect noise in `check` against old DBs, but `check` has no DB (it reads only the schema), so noise only appears in `up`. |
| Field removed/renamed by generator correction | `UNSUPPORTED:schema-drop column` per column, column kept | Low | Expected; list in release notes. A mass of warnings would hide real ones, so group them in the report builder by area. |
| Field flips Lookup <-> Text (v1 guess corrected) | `char(18)` vs `varchar(n)` mismatch -> narrow warning, kept | Low | Generator diff review. |
| Index volume: one `ix_` per Lookup/MasterDetail/externalId | `CREATE INDEX IF NOT EXISTS` for every lookup on every table each `up`; hundreds of new lookups = hundreds of index builds on first migrate (fast on small data) and a long no-op statement list each start | Low-Medium | Skip `CREATE INDEX` when the index name already exists (read `pg_indexes` once, as `existingConstraintNames` does for FKs) to cut start time. Postgres identifiers over 63 bytes already hash via `identifier()`; collisions are only theoretical. |
| `statements` list / `changes` count in `main.ts` | `up` counts `CREATE TABLE|ALTER TABLE ...` matches; with baseline v2 the first run prints a large count | Cosmetic | Nothing. |
| Key prefix of a new baseline object collides with a prefix persisted for a custom object | `reconcileKeyPrefixes` throws `KeyPrefixError` (already validated against `matchTargetByPrefix`) | Low | Real standard prefixes are unlikely to collide with `a..` custom ones; keep the existing guard and add a generator test that all baseline prefixes are unique. |

Cross-cutting: run the first v2 `up` on a copied v1 database in CI (`test-postgres`) as the acceptance test for migration; the
embedded pglite path should run the same test. pglite behaves differently on some DDL (see `pglite-compat.test.ts`), so keep
the pre-check queries to portable SQL.

## Data-flow changes (`orglet up`)

```
loadOrgSchema(project)
  -> sfdx.ts parses objects/, customMetadata/, labels/, settings            [MOD]
  -> build.ts merges baseline v2 + project; computes notices + skipped      [MOD]
reconcileKeyPrefixes(pool, schema)    (now includes __mdt and settings)     [MOD small]
migrate(pool, schema)                 -> {statements, warnings, pendingBackfills}   [MOD]
seedCustomMetadata(pool, schema)      full sync mdt tables from schema      [NEW]
bootstrapOrg(pool, schema)            unchanged
new DmlEngine(pool, schema)           FormulaRegistry first, RollupRegistry gets it   [MOD]
engine.backfillFormulaRollups(pendingBackfills)                             [NEW]
createApiServer(...)                  describe flags only                   [MOD small]
```

`orglet check` (no DB): `loadOrgSchema` -> `new FormulaRegistry(schema)` -> `report.ts` renders. It must not call `seed` or
`migrate`; constant folding of `$CustomMetadata`/`$Label` works in `check` because it reads `OrgSchema`, not the DB. That is a
second reason for the compile-time folding decision.

## Build order and dependencies

```
 (A) migration safety net + baseline generator ---+--> (B) baseline v2 data (existing 35, then business objects)
                                                  |
 (S) sigha upstream PRs (external, start day 1)   |        (resync last, independent of all but colon formulas)
                                                  v
 (C) metadata: mdt, settings, labels, MetadataRelationship, OwnerId narrowing, Notice tier
                                                  v
 (D) formula globals ($UserRole, $Api, $Setup, $Label, $CustomMetadata) + seed.ts + loadGlobals
                                                  v
 (E) roll-up over formula (needs FormulaRegistry changes from D and migrate pendingBackfills)
                                                  v
 (F) check report (needs structured failures from D/E and all warning areas to exist)
```

1. **Phase: baseline generator + migration regression harness.** Build the generator first with the *existing* 35 objects
   regenerated as a no-op diff (proves reproducibility and that output shape is unchanged), and write the v1-database ->
   v2-schema migrate test before any data grows. Reason: it is the highest-risk, widest-blast-radius change (every later
   feature is tested against objects it produces) and it validates the pipeline cheaply. Avoids pitfall: silent column
   narrowing/FK failure surfacing late.
2. **Phase: baseline v2 data**: field parity for 35 objects, then business objects. OwnerId narrowing ships here
   (`ownerTargets`) together with the FK pre-check in `migrate`. Business objects after parity, because Quote/Order etc.
   reference Account/Contact/Opportunity/Pricebook2 fields that must be right first.
3. **Phase: custom metadata + settings (metadata/schema/engine seed + describe).** Must precede `$CustomMetadata`/`$Setup`
   because compile resolves against these objects. `MetadataRelationship` lives here (it is what unlocks the
   `UNSUPPORTED:field-type` cascade in real orgs).
4. **Phase: formula globals + sigha resync.** `$UserRole` (trivial, needs only baseline), `$Api`, `$Label`, `$CustomMetadata`
   (constant fold, need phase 3 data on `OrgSchema`), `$Setup` (needs phase 3 tables + `loadGlobals`). Colon syntax and `!`
   land when the upstream release is available; compile.ts already has a branch that detects the colon pattern and emits
   `UNSUPPORTED:formula polymorphic reference`, which is replaced by real resolution of `Rel:Object.Field`
   (`resolvePath` needs a polymorphic-aware branch that picks the named target from `referenceTo`). If upstream is slow, vendor
   a pinned fork rev through `sync-sigha.sh <rev>` and keep the upstream PR as the long-term path; do not block the milestone.
5. **Phase: roll-up over formula.** Needs the structured `FormulaRegistry` (restriction check, deps for `watched`), and
   `migrate` `pendingBackfills`. Independent of phase 3 and 4's globals; can run in parallel with phase 4 if staffed, but both
   touch `formulas.ts` and `engine.ts` constructors, so serialise to avoid merge conflicts for one developer.
6. **Phase: `orglet check` report.** Last because it consumes the final set of warning areas, `SkippedItem`/`FormulaFailure`
   and notices. The `SkippedItem` collection in `build.ts` and `FormulaCompileError.missing` are tiny and should be added
   during phases 3 and 4 (so they are exercised as features land); the renderer and `--json` come last.

Acceptance fixture (`examples/enterprise`, generic names) grows with each phase and is run with `--strict` in CI at the end of
each phase, so regressions in earlier features show up as new warnings.

## Patterns to follow

- **Constant-fold what is file-derived, evaluate what is data-derived.** (`$Label`, `$CustomMetadata` vs `$Setup`, `$User`.)
- **New unsupported behaviour = new `UNSUPPORTED:<area>`**, never a silent fallback (`rollup-formula`, `metadata-relationship`,
  `formula-global` for list-setting `$Setup`).
- **Layer purity**: `schema` stays formula-agnostic (signals `pendingBackfills`, accepts virtual columns); anything needing the
  formula engine lives in `engine`; `metadata` stays pure and dependency-free.
- **Optional parameters over signature breaks** for `rollupSelectSql` and `buildOrgSchema` results (add fields to
  `BuildResult`; existing callers destructure `{schema, warnings}`).
- **Barrel discipline**: new exports go through each package's `src/index.ts` with value and type exports listed separately.

## Anti-patterns to avoid

- **In-memory mdt store beside Postgres**: duplicates SOQL/describe/relationship logic; rejected above.
- **Parsing warning strings for root-cause analysis**: brittle; carry structured fields (`missing`, `SkippedItem`) next to the strings.
- **Baking `$Setup` values at compile time**: stale after any DML on the setting.
- **Translating formulas to SQL**: permanent semantic fork from sigha.
- **Materialising every baseline object whose name appears in a lookup**: the baseline-internal reference graph is nearly fully
  connected via User/Account, so "referenced" must be computed from the *project* (custom fields, roll-ups, overrides), not by
  transitive closure over baseline lookups.
- **Hand-editing generated baseline JSON**: add to `overrides.json` instead, or the next regeneration silently reverts it.
- **Running migrate FK adds without a pre-check on populated data**: whole-startup failure for a data issue.

## Research flags for later phases

| Phase | Flag |
|-------|------|
| Roll-up over formula | Needs doc check: which formula fields Salesforce allows in roll-ups (cross-object, volatile functions, field types). LOW confidence in the restriction set here. |
| Custom settings `$Setup` | Needs doc check: list vs hierarchy availability in formulas, `$Setup.Hierarchy__c.Field` resolution order. LOW. |
| MetadataRelationship | Needs doc check on stored value (Id vs DeveloperName) and entity/field-definition targets. LOW. |
| Baseline generator | Needs a spike on the snapshot source (Object Reference HTML structure and licence of reuse); deterministic extraction is the risk, not the generator. |
| sigha upstream | External lead time; decide pin-a-fork vs wait early. |
| Baseline v2 / migrate | Standard patterns, no further research once the v1->v2 DB test exists. |
| Check report | Standard; design above is sufficient. |

## Scalability considerations

| Concern | Small org (examples) | Real enterprise retrieve | Notes |
|---------|----------------------|--------------------------|-------|
| `up` migrate time | negligible | first run creates hundreds of tables/indexes, seconds; later runs dominated by `information_schema` read + per-index `IF NOT EXISTS` | Skip existing-index statements |
| Formula compile at start | negligible | thousands of formulas compiled once | Already once-per-schema; folding adds no per-row cost |
| `loadGlobals` per read | 3 reads | +1 (UserRole) +N settings only when referenced | Memoise per call/session |
| Roll-up recompute over formula | n/a | O(children per affected parent) formula evals | Acceptable; document |
| `check` on large retrieve | instant | seconds; no DB | Report builder is O(items + edges) |

## Sources

- Repository code read for this document (HIGH): `packages/metadata/src/{build,rollup,sfdx,types}.ts`,
  `packages/formula/src/{compile,evaluate}.ts`, `packages/engine/src/{formulas,rollups,engine,bootstrap}.ts`,
  `packages/schema/src/{rollup,migrate,columns,ddl}.ts`, `packages/cli/src/main.ts`, `scripts/sync-sigha.sh`,
  `packages/metadata/standard/README.md`, `.planning/PROJECT.md` (Current Milestone).
- Salesforce-side semantics (restrictions on roll-up over formula, `$Setup` on list settings, MetadataRelationship values) were
  NOT verified against documentation in this pass: LOW confidence, flagged above for phase-level research.
