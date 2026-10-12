# Architecture Research: Hardening Milestone Integration

**Domain:** Integrating six hardening features into an existing layered pnpm monorepo
(`metadata → schema → {formula, soql} → engine → api → cli`), Postgres 16 only datastore.
**Researched:** 2026-09-29
**Confidence:** HIGH for boundaries/data flow (grounded in the actual source of every file
touched); MEDIUM for exact SFDX XML tag names and pglite runtime limits (verified against
public documentation and the pglite ecosystem via web search, not against a running instance).

This document does not restate `.planning/codebase/ARCHITECTURE.md`. It answers: where does
each hardening feature's code live, what does it depend on, what does it change, and in what
order should the six be built.

## Cross-Cutting Finding

Three of the six features (key-prefix persistence, Bulk job persistence, and — optionally —
roll-up bookkeeping) need a place to store orglet's own state that is not org data. That place
already exists and is unused: `INTERNAL_SCHEMA = "_orglet"` is defined and exported in
`packages/schema/src/columns.ts:10` and re-exported from `packages/schema/src/index.ts:7`, but
`grep -rn "INTERNAL_SCHEMA"` finds no other reference anywhere in the tree. This is a clear
"reserved for future use" seam. Recommendation: use `_orglet` as the schema for the
key-prefix table (owned by `packages/schema`, next to `ids.ts`) and for the Bulk job tables
(owned by `packages/api/src/bulk`, next to `jobs.ts`), each creating its own tables there with
independent `CREATE SCHEMA IF NOT EXISTS "_orglet"` / `CREATE TABLE IF NOT EXISTS` calls. Do
not introduce a shared "ensure internal schema" utility — the two features have nothing else in
common, and keeping each self-contained means either can be built and tested independently
(see Build Order).

## Feature 1: Per-Row Polymorphic Lookups + SOQL `TYPEOF`

### What already works

`checkReferences()` in `packages/engine/src/engine.ts:487-512` already resolves a polymorphic
lookup **correctly, per row**, at write time: for every candidate in `field.referenceTo`, it
finds `target.keyPrefix === keyPrefixOf(id)` (via `keyPrefixOf` from
`packages/schema/src/ids.ts:40`, a pure string-slice with no DB dependency) and validates
against that specific target. This confirms the project's own write path already treats
Salesforce IDs as self-describing — object type is derived from the key prefix, not stored
separately. **Recommendation: option (a) only — derive the target from the ID prefix at read
time too. Do not add a `<field>_type` companion column.** Salesforce itself does not store one;
`OwnerId`/`WhoId`/`WhatId` have no sibling type column in the platform's own schema either, and
adding one here would require a schema migration and a second source of truth that could drift
from the ID.

`resolveRelationship()` in `packages/metadata/src/schema.ts:53-61` already returns everything
the read path needs: `target` (first candidate, kept for backward compatibility), `targets`
(**all** defined candidates), and `polymorphic: boolean`. **No change needed in
`packages/metadata/src/schema.ts` or `types.ts`** beyond updating the stale doc comment on
`OrgSchema.resolveRelationship` (`types.ts:195-200`), which currently says `target` is "what
SOQL and formulas use until TYPEOF is supported" — untrue once this feature ships.
`planTable()` in `packages/schema/src/ddl.ts:46` already skips the FK constraint for
multi-target lookups (`field.referenceTo?.length === 1`), so no DDL change is needed either.

### What changes

**`packages/soql/src/compile.ts`** — the core of this feature. `Compiler.resolve()`
(lines 101–131) currently creates exactly one `LEFT JOIN` per relationship segment, always
against `resolved.target` (index 0). Change: when `resolved.polymorphic` is true, create **one
`LEFT JOIN` per candidate in `resolved.targets`**, not a lateral subquery — the candidate set is
small (2–3 typically) and known at compile time from `field.referenceTo`, so static joins keep
the query plannable and `EXPLAIN`-able the same way every other join in this compiler already
is; a lateral subquery would only earn its complexity if the candidate set were dynamic, which
it never is here. Each candidate join should carry a prefix filter —
`ON candidateAlias."id" = parentAlias."<col>" AND left(parentAlias."<col>", 3) = '<prefix>'` —
which is not required for correctness (IDs are globally unique per object within an org, so an
equality join against the wrong table simply returns no row) but lets Postgres skip scanning
non-matching candidate tables entirely, using the same index the existing lookup index
(`ix_<table>_<col>`, `packages/schema/src/ddl.ts:52-53`) already provides.

Consequences of that one change ripple through the rest of the compiler:
- `Scope.joins`'s value type needs a polymorphic variant (a small discriminated union: single
  join vs. `{ candidates: [...] }`) so `resolve()`, `expr()`, `compileCondition()`,
  `compileFunction()`, `compileGroupBy()`, `compileOrderBy()` can turn a polymorphic leaf field
  into `COALESCE(candidate1.col, candidate2.col, ...)` — skipping any candidate that doesn't
  define the field, erroring only if none does. This is slightly more permissive than real
  Salesforce (which requires a field to exist on every candidate for bare dot-notation, else
  demands `TYPEOF`); flagging that gap as an intentional, documented simplification is more in
  keeping with the project's `UNSUPPORTED:<area>` philosophy than trying to fully replicate
  Salesforce's dot-notation validation rules in this milestone.
- `parentShape()` (lines 249–276) builds nested-parent shapes for `SELECT Owner.Name` style
  queries. `SObjectShape.type` (`compile.ts:27-38`) is currently a single string fixed at
  compile time (`type: join.obj.name`). For a polymorphic parent this must become **data-driven
  per row**: add a SQL column (e.g. a `CASE WHEN left(col,3)='005' THEN 'User' WHEN
  left(col,3)='00G' THEN 'Group' END`) and change `SObjectShape.type` to
  `string | { columnAlias: string }` so `shapeSObjectRow()` in `packages/soql/src/shape.ts:23-39`
  can read the resolved type per row instead of hard-coding it.
- `case "FieldTypeof": throw unsupported("soql-typeof", ...)` at `compile.ts:326-327` becomes a
  real compile path. Reuse the same polymorphic-join-group primitive from above; each `WHEN
  <Type> THEN <fields>` branch becomes a set of columns that are only non-null when the type
  discriminator matches that branch (`CASE WHEN <discriminator>='User' THEN alias.field END`).
  The shaper should use the discriminator to include **only** the matched branch's fields in the
  record (not all branches with nulls for the non-matching ones), which is closer to what real
  Salesforce returns and is cheap once the discriminator column exists. **This is the most
  complex single piece of Feature 1** — the exact `FieldTypeof` AST shape from
  `@jetstreamapp/soql-parser-js` needs to be read from its actual `.d.ts` during implementation
  (not fully verifiable by static reading alone); flag it in the roadmap as the one sub-task
  likely to need its own short research pass.

**`packages/engine/src/parents.ts`** — `loadParents()` attaches parent records onto rows before
formula/validation-rule evaluation. Its `relationship()` helper (lines 37–41) calls
`resolveRelationship` and, like the SOQL compiler, only ever uses `.target` (first candidate).
Because `loadParents()` batches all IDs for a relationship into **one** `store.loadByIds(client,
rel.target, ids)` call, fixing this means grouping IDs by candidate target via `keyPrefixOf`
first (mirroring `checkReferences`'s existing `wanted: Map<string, Set<string>>` pattern in
`engine.ts:487-512`), then issuing one `loadByIds` per candidate target that actually has
matching IDs in the batch, and merging results back per row. **This file matters more than the
formula compiler for runtime correctness** — without this fix, even a perfectly-typed formula
referencing `Owner.Name` will silently evaluate against `null` or the wrong parent at runtime.

**`packages/formula/src/compile.ts`** — `resolvePath()` (lines 82–102) resolves a formula's
dotted path against `resolved.target` only (line 98, same "first target" comment CONCERNS.md
flags). Recommendation: search across `resolved.targets` for field existence (so `Owner.<a
Group-only field>` doesn't throw `fieldNotFound` if the formula is only ever evaluated on
Group-owned records), but keep using `targets[0]`'s field for sigha's **static** type (formula
languages need one static type per reference; runtime correctness is `parents.ts`'s job, not
the compiler's). This is a secondary fix relative to `parents.ts` — do it in the same pass since
both touch "polymorphic parent path resolution," but the engine fix is what actually changes
behavior for a running org.

### Component boundaries (Feature 1)

| Component | Responsibility | Talks to |
|---|---|---|
| `packages/soql/src/compile.ts` | Emits N candidate `LEFT JOIN`s + `COALESCE`/`CASE` per polymorphic path; compiles `TYPEOF` | `packages/metadata` (`resolveRelationship`), `packages/schema` (`columnName`/`tableName`/`quote`) |
| `packages/soql/src/shape.ts` | Reads the per-row type discriminator column to set `attributes.type` and (for `TYPEOF`) filter fields to the matched branch | `packages/soql/src/compile.ts` (consumes its `Shape`) |
| `packages/engine/src/parents.ts` | Groups IDs by candidate target via `keyPrefixOf`, loads the correct parent per row for formula/validation-rule evaluation | `packages/schema/src/ids.ts` (`keyPrefixOf`), `packages/engine/src/store.ts` |
| `packages/formula/src/compile.ts` | Resolves a formula's dotted path across all candidates for field existence; keeps first-candidate static typing | `packages/metadata` (`resolveRelationship`) |

Data flow: `resolveRelationship()` (pure, `packages/metadata`) → both `packages/soql/src/compile.ts`
(SQL-time, produces N joins + a discriminator column) and `packages/engine/src/parents.ts`
(runtime, produces N `loadByIds` calls keyed by `keyPrefixOf`) independently reimplement
"pick the right candidate," one in SQL, one in JS — there is no shared runtime code between
them because one operates on SQL text at compile time and the other on already-fetched rows.
The one thing worth sharing is the *prefix-matching logic itself*: consider a small exported
helper in `packages/schema/src/ids.ts` (e.g. `targetForId(targets: SObjectDef[], id: string):
SObjectDef | undefined`) since `packages/schema` already depends on `@orglet/metadata` and
already owns `keyPrefixOf` — both `engine.ts`'s `checkReferences` and the new
`engine/src/parents.ts` logic could use it, keeping the "match candidate by key prefix" rule in
one place instead of three.

## Feature 2: Roll-Up Summary Fields

### Storage design: no `packages/schema` changes needed

The key design decision: **do not introduce a `"Summary"` `FieldType`.** A roll-up field's
`FieldDef.type` should be resolved to whatever the aggregation actually produces — `Number` for
`COUNT`, or the summarized child field's own type (`Number`/`Currency`/`Percent`) for
`SUM`/`MIN`/`MAX` — with a separate `FieldDef.rollup?: RollupDef` marker carrying the roll-up
metadata (child object, child field, foreign-key field, operation, filters). Two concrete
consequences, both verified by reading the exhaustive switches involved:

- `packages/formula/src/values.ts:sfTypeOf()` (lines 17-56) is an exhaustive switch over
  `FieldType` with no `default` case — adding a new `FieldType` member would force a change
  here (and TypeScript would catch it), but resolving to an existing type avoids that entirely.
- `packages/schema/src/columns.ts`'s `isVirtual()` (line 44-46: `formula !== undefined ||
  type === "Address"/"Name"/"Location"`) and `sqlTypeFor()` (lines 48-90) both already handle
  `Number`/`Currency`/`Percent` correctly. **A roll-up field with `type: "Currency"` and
  `rollup: {...}` requires zero changes to `packages/schema`** — it gets a real numeric column,
  a real index candidate, everything a normal stored field gets, for free.

This also means `packages/engine/src/coerce.ts` needs **no change**: `coerceRecord()`
(`coerce.ts:120-143`) already rejects client-supplied values for any field with
`createable: false`/`updateable: false` via its `notWritable` check — marking roll-up fields
`readOnly()` in `build.ts` (the same helper already used for `AutoNumber`/formula fields) is
sufficient. `checkRequired()` in `engine.ts:476-485` already skips `field.nillable` fields, so
setting `nillable: true` on roll-ups (they're never "required" from the client's perspective)
means no change there either. And `packages/soql/src/compile.ts`'s `expr()` needs no new case —
the `default:` branch (`${alias}.${quote(columnName(field))}`) already does the right thing for
a plain stored numeric column.

### Parsing (packages/metadata)

`packages/metadata/src/sfdx.ts`: `Summary` is currently force-skipped at `parseField()`
(lines 162-165, unconditionally, before any sub-element is read). This must become a real parse:
Salesforce's `<CustomField type="Summary">` metadata carries `<summarizedField>Child.Field</summarizedField>`,
`<summaryForeignKey>Child.LookupField</summaryForeignKey>`, `<summaryOperation>sum|count|min|max</summaryOperation>`,
and repeatable `<summaryFilterItems>` (`field`/`operation`/`value`) — confirmed against
Salesforce's public Metadata API documentation for `CustomField` (see Sources; MEDIUM
confidence, single external source, but consistent with the well-known shape of this metadata
type). `SourceField` gains the raw dotted strings; `parseField()` stops skipping `Summary`.

`packages/metadata/src/build.ts`: `fromSourceField()`'s `case "Summary":` can only store the
**raw** dotted references at construction time — it does not have access to the full `objects`
map yet (only `sets: ValueSets`), so it cannot resolve the child object/field or determine the
final numeric `FieldDef.type`. Resolution must happen in a **second pass inside
`buildOrgSchema()`**, mirroring the existing dangling-reference pass already there
(`build.ts:457-466`, which runs after every object is registered): resolve each roll-up's child
object/field, rewrite `FieldDef.type` to match, and warn (`UNSUPPORTED:rollup-target`) rather
than throw for anything unresolvable — keeping the project's "degrade gracefully" convention
intact for malformed or forward-looking roll-up definitions.

### Recomputation (packages/engine — new module, not a Postgres trigger)

New file: **`packages/engine/src/rollups.ts`**, parallel in shape to `formulas.ts`:

- `RollupRegistry` — built once per `OrgSchema` in `DmlEngine`'s constructor (alongside
  `this.formulas = new FormulaRegistry(schema)`), indexed **by child object name** (recompute is
  triggered by child DML, not parent DML), each entry carrying the parent object/field, child
  object/field, foreign-key field, operation, and filters.
- `affectedParents(childObj, work: Work[]): Map<SObjectDef, Map<FieldDef, Set<parentId>>>` —
  for insert, the parent is `next[fk]`; for delete/undelete, `old[fk]`; for update, **both**
  `old[fk]` and `next[fk]` when the FK changed (reparent — explicitly called out in the
  milestone brief), **plus** the (unchanged) current parent when any field referenced by a
  roll-up's filter changed, even if the FK itself didn't (a `SUM(Amount) WHERE StageName =
  'Closed Won'` roll-up must recompute when `StageName` changes).
- `recompute(client, parentObj, parentField, parentIds)` — **one batched aggregate `UPDATE`
  per roll-up field per affected-parent batch**, not one query per row: `UPDATE parent p SET col
  = COALESCE(sub.agg, <zero-or-null>) FROM (SELECT unnest($1) AS pid) ids LEFT JOIN (SELECT fk,
  AGG(col) agg FROM child WHERE fk = ANY($1) AND isdeleted = false [AND filters] GROUP BY fk) sub
  ON sub.fk = ids.pid WHERE p.id = ids.pid`. The `LEFT JOIN` against the full requested
  `parentIds` set (not just parents with a match) is what correctly zeroes out a parent whose
  last matching child was just deleted or reparented away — a plain aggregate subquery alone
  would simply omit that parent's row and leave its stale value in place.

Call sites: `saveBatch()` (insert/update), `deleteBatch()`, `undeleteBatch()` in
`packages/engine/src/engine.ts` each need one new call, placed **after** the child's own
`runHooks(..., "after", ...)` — matching Salesforce's documented order of execution, where
roll-up recomputation on the parent happens after the triggering record's own after-triggers,
and (per Salesforce's docs) itself re-runs the *parent's* before/after triggers if the parent
has any registered. Since `DmlEngine` is constructed with zero `TriggerExecutor`s today
(`packages/cli/src/main.ts:81`, no Apex/Flow in this milestone), wrap the roll-up `UPDATE` with
`this.runHooks(session, parentObj, "update", "before"/"after", ...)` anyway so the seam is
correct once Apex/Flow support lands in a later milestone — inert today, correct later. Gate
the whole step on `!this.importMode`, matching every other post-write step in `saveBatch`.
A same-object roll-up chain (a parent that is itself a master-detail child of a grandparent with
its own roll-up) should be handled by having `recompute()` recurse into
`RollupRegistry.affectedParents()` for the object whose column it just changed — a narrow edge
case worth explicit test coverage but not a blocker for the initial design.

New parent records starting with `NULL` roll-up columns before any child exists: initialize
`Count`/`Sum` roll-ups to `0` (Salesforce shows `0` immediately, not blank) in
`DmlEngine.defaults()` (`engine.ts:420-448`), the same function that already special-cases
`AutoNumber`/`Checkbox`/picklist defaults — this keeps `packages/schema` untouched and reuses
an existing, already-understood extension point rather than adding a DDL-level `DEFAULT`.

### Component boundaries (Feature 2)

| Component | Responsibility | Talks to |
|---|---|---|
| `packages/metadata/src/sfdx.ts` | Parses `<summarizedField>`/`<summaryForeignKey>`/`<summaryOperation>`/`<summaryFilterItems>` | XML only |
| `packages/metadata/src/build.ts` | Second-pass resolution: child object/field lookup, final `FieldDef.type`, `UNSUPPORTED:rollup-target` warnings | `SourceField` → `OrgSchema` objects map (second pass) |
| `packages/engine/src/rollups.ts` (new) | `RollupRegistry`, `affectedParents()`, batched aggregate `UPDATE` | `packages/engine/src/store.ts` (table/column naming), `packages/engine/src/hooks.ts` (parent trigger seam) |
| `packages/engine/src/engine.ts` | Calls the registry after child after-hooks in `saveBatch`/`deleteBatch`/`undeleteBatch` | `packages/engine/src/rollups.ts` |

## Feature 3: Custom-Object Key-Prefix Persistence

### The layering problem this solves

`buildOrgSchema()` in `packages/metadata/src/build.ts:409-469` is pure and DB-free by design —
`packages/metadata` has no in-repo dependencies at all. Prefix assignment
(`customKeyPrefix(index)`, lines 400-407, assigned by alphabetical array index at lines 421-424)
happens entirely inside this pure function, which is exactly why it's unstable: it has no
memory across calls. Persistence necessarily requires a Postgres round-trip, which
`packages/metadata` must never do (that's the whole reason `orglet check` can validate a
project with no DB — see below). So the fix cannot live in `packages/metadata`; it must live in
a DB-capable layer that runs **after** `loadOrgSchema()` but **before** anything that generates
or validates IDs.

**Key finding: `keyPrefix` does not affect DDL at all.** `tableName()`/`columnName()` in
`packages/schema/src/columns.ts:23-29` are keyed by object/field API name, never by
`keyPrefix`. `keyPrefix` only matters to `generateId(obj.keyPrefix)` (used in
`engine/src/engine.ts` `saveBatch` and `engine/src/bootstrap.ts`) and to prefix-based ID
validation (`engine.ts`'s `prepareInsert`/`attachOld`/`checkReferences`). This relaxes the
ordering constraint considerably: reconciliation does not need to happen before `migrate()`; it
only needs to happen before `bootstrapOrg()`/`new DmlEngine()` are constructed.

### Design

New file: **`packages/schema/src/keyPrefixes.ts`** (not `ids.ts` — `ids.ts` is a pure codec
with zero DB imports today; mixing DB access into it breaks that separation). Exports
`reconcileKeyPrefixes(pool, orgSchema, schema: OrgSchema): Promise<{ warnings: string[] }>`:

1. `CREATE SCHEMA IF NOT EXISTS "_orglet"`, `CREATE TABLE IF NOT EXISTS "_orglet".key_prefixes
   (object_name text PRIMARY KEY, key_prefix char(3) UNIQUE NOT NULL, assigned_at timestamptz
   NOT NULL DEFAULT now())`.
2. For every object already in the table, **overwrite** `SObjectDef.keyPrefix` on the in-memory
   `OrgSchema` to match the persisted value. This is in-place mutation of a `SObjectDef`, which
   is already how `buildOrgSchema()` itself works today (`target.label = o.label` etc. at
   `build.ts:434`), so it is not a new pattern.
3. For every **custom** object not yet in the table, assign the next unused prefix (scanning
   `a00`, `a01`, ... and skipping anything already claimed by **any** row — custom or, if ever
   added, standard) and `INSERT` it. Because assignment is by first-INSERT-wins rather than by
   array index, adding or removing a custom object never shifts anyone else's prefix again.
4. While assigning, check the new prefix does not collide with any hard-coded **standard**
   object `keyPrefix` in `schema.objects` — a real, if narrow, collision risk once Feature 6
   adds 14 more standard objects with their own fixed prefixes (see Build Order).

Call site: `packages/cli/src/main.ts`'s `up()`, right after the Postgres connectivity check
(`await pool.query("SELECT 1")`, line 69) and before `bootstrapOrg`/`new DmlEngine`. `migrate()`
can run before or after — it doesn't consume `keyPrefix` at all.

### `orglet check` (no DB): unchanged behavior, by necessity

`check()` in `packages/cli/src/main.ts:55-62` calls `loadOrgSchema()` only — it has no pool and
must not gain one (its entire value proposition is "validate an SFDX project without touching
Postgres"). It **cannot** read the persisted mapping. Recommendation: leave
`packages/metadata/src/build.ts`'s existing alphabetical scheme exactly as-is as the *provisional*
prefix `check` reports — update its doc comment to say so explicitly, since the comment
currently claims stability that no longer matches the source of truth once `orglet up` persists
real prefixes. `check`'s prefixes may legitimately differ from what a live org actually assigned
once that org has accumulated custom objects; that's expected, and worth a one-line note in
`check`'s output or the CLI usage text so it doesn't read as a bug.

### Component boundaries (Feature 3)

| Component | Responsibility | Talks to |
|---|---|---|
| `packages/metadata/src/build.ts` | Assigns *provisional* alphabetical prefixes (unchanged); doc-comment updated | Nothing new |
| `packages/schema/src/keyPrefixes.ts` (new) | Persists/reconciles real prefixes against `_orglet.key_prefixes`; mutates the in-memory `OrgSchema` | `packages/schema/src/db.ts` (`Pool`), consumes `packages/metadata`'s `OrgSchema` |
| `packages/cli/src/main.ts` | Calls `reconcileKeyPrefixes()` in `up()`, between connectivity check and bootstrap | `packages/schema/src/keyPrefixes.ts` |

Data flow: `loadOrgSchema()` (DB-free, provisional prefixes) → `reconcileKeyPrefixes(pool, ...)`
(DB read + write, mutates `OrgSchema` in place) → `migrate()` / `bootstrapOrg()` / `new
DmlEngine()` (all now see stable, persisted prefixes). `orglet check` stops after the first
arrow.

## Feature 4: Bulk API 2.0 Job Persistence

### Placement: entirely inside `packages/api/src/bulk`, not `packages/schema`

Unlike key prefixes, Bulk jobs are consumed by nothing outside `packages/api` — no
`engine`/`schema`/`soql` code needs to know a job exists. Per the codebase's own stated
convention ("Add it to the most specific existing package instead," `STRUCTURE.md`'s
Utilities section), both the table DDL and the CRUD queries belong in
`packages/api/src/bulk`, not `packages/schema`. This is also precedented: `packages/api`
already reaches into `ctx.engine.pool` directly for ad-hoc queries outside the `DmlEngine`'s own
DML methods (`packages/api/src/auth.ts:49`, `packages/api/src/routes/sobjects.ts:145,181`) — so
`packages/api/src/bulk` doing the same for job persistence is consistent with existing style,
not a new pattern.

### Design

New file: **`packages/api/src/bulk/store.ts`** (naming mirrors `packages/engine/src/store.ts` —
"row-level Postgres access for one concern"), replacing the in-memory `JobStore` class in
`packages/api/src/bulk/jobs.ts`. Two tables in `_orglet`:

- `_orglet.bulk_ingest_jobs` — one row per ingest job: id, `user_id`/`organization_id`/`profile_id`
  (flattening `Session`), operation, object, external-id field, content type, line
  ending/delimiter, api version, state, timestamps, `input_header`, counts, `csv_data` (a single
  `text`/`bytea` column, appended to on each `PUT .../batches` call via `csv_data =
  COALESCE(csv_data,'') || $1` — replacing the in-memory `csvChunks: string[]` with one
  accumulating column rather than a separate chunks table, since upload sizes in this project's
  stated dev/CI scope don't warrant more), and `success_csv`/`failed_csv` (the **already
  rendered** result CSVs via the existing `writeCsv()` helper in `packages/api/src/bulk/csv.ts`,
  computed once at `UploadComplete` and stored verbatim — `GET .../successfulResults` becomes a
  single `SELECT` with no re-rendering).
- `_orglet.bulk_query_jobs` — one row per query job: id, session fields, operation, object,
  query text, state, timestamps, `header` and `rows` as `jsonb` (**not** a single rendered CSV
  blob) — because `GET .../results` paginates over the parsed row array via offset/`maxRecords`
  (`packages/api/src/routes/bulk.ts:395-407`), keeping `header`/`rows` structured lets that
  pagination logic move unchanged from `job.rows.slice(...)` (in-memory) to a `SELECT` + the
  same slice in JS, still calling the unchanged `writeCsv()` only on the requested page.

`IngestJob`/`QueryJob` interfaces in `packages/api/src/bulk/jobs.ts` stay as the
application-level record shape used by `processIngestJob()` and route handlers — only the
*storage* of that shape moves from a `Map` to Postgres.

### Processing stays synchronous — explicitly acceptable per the milestone scope

No background worker/queue is introduced. `processIngestJob()` in
`packages/api/src/routes/bulk.ts:120-181` keeps its exact current logic (CSV parse, chunked DML
through `DmlEngine`, unchanged) — the only addition is one `await` at the end to persist the
final `state`/counts/result CSVs, and loading the accumulated CSV from `_orglet.bulk_ingest_jobs`
instead of `job.csvChunks.join("")`. `ApiContext` (in `packages/api/src/server.ts`) needs **no
shape change** — `registerBulkRoutes(app, ctx)` continues to construct its own store internally
(`const store = new BulkStore(ctx.engine.pool)`) exactly like today's `const store = new
JobStore()`, keeping the diff to `registerBulkRoutes()`'s internals and `packages/api/src/bulk/`.

`_orglet.bulk_ingest_jobs`/`_orglet.bulk_query_jobs` table creation (`CREATE TABLE IF NOT
EXISTS`) should run once at startup from `packages/cli/src/main.ts`'s `up()`, alongside the
key-prefix reconciliation call — not inside `registerBulkRoutes()` itself, which is a
synchronous Fastify route-registration function and should not block on I/O.

### Component boundaries (Feature 4)

| Component | Responsibility | Talks to |
|---|---|---|
| `packages/api/src/bulk/store.ts` (new) | `_orglet` table DDL, ingest/query job CRUD, CSV chunk append | `ctx.engine.pool` directly (precedented pattern) |
| `packages/api/src/bulk/jobs.ts` | Keeps `IngestJob`/`QueryJob` types; drops `JobStore` | — |
| `packages/api/src/routes/bulk.ts` | Every handler becomes `await`-based against the store; `processIngestJob()` persists at the end | `packages/api/src/bulk/store.ts` |
| `packages/cli/src/main.ts` | Calls table-creation once in `up()` | `packages/api/src/bulk/store.ts` |

## Feature 5: pglite for Tests

### The seam already exists — this is additive test infrastructure, not a source change

Grepping every call site of `Pool`/`PoolClient`/`createPool`/`databaseUrlFromEnv` confirms
**every** package that touches Postgres does so exclusively through
`packages/schema/src/db.ts` — nothing constructs a `pg.Pool` directly anywhere else in the
tree (`packages/engine`, `packages/api`, `packages/cli`, and every `*.test.ts` file all import
from `@orglet/schema`). The "single DB access seam" the milestone brief asks for **already
exists**; the question is only how to point it at pglite for tests without touching it.

Recommended approach, in order of preference: run **`@electric-sql/pglite`** wrapped in
**`@electric-sql/pglite-socket`** (`PGLiteSocketServer`), which speaks the real Postgres wire
protocol over a TCP socket and multiplexes it to the single underlying in-process WASM Postgres
instance. Because `createPool()` in `packages/schema/src/db.ts:30-32` is a thin `new
pg.Pool({connectionString})` and `databaseUrlFromEnv()` (`db.ts:34-36`) just reads
`ORGLET_DATABASE_URL`, **zero changes to any source file or any of the five existing
Postgres-backed test files are needed.** Only test infrastructure changes:

- A new vitest `globalSetup` (e.g. `scripts/pglite-global-setup.ts`) starts one shared `PGlite`
  instance + `PGLiteSocketServer` before the test run, sets `process.env.ORGLET_DATABASE_URL`
  to point at it (vitest's documented pattern for exposing a test database via env var to
  worker processes — the same pattern used by multiple pglite+vitest examples in the ecosystem,
  see Sources), and tears both down after.
- `vitest.config.ts` gains `test.globalSetup`, gated so it only starts pglite when
  `ORGLET_DATABASE_URL` isn't already set (letting a `pnpm test:docker` variant opt into the
  existing Docker Postgres path by setting that env var first, unchanged).
- Root `package.json` gains `@electric-sql/pglite` and `@electric-sql/pglite-socket` as
  devDependencies, and a `test:docker` script alongside the existing `test`.

### "One schema per test file" isolation: unaffected

The existing pattern (`const orgSchema = \`test_${randomBytes(4).toString("hex")}\`;`, seen in
`packages/schema/src/migrate.test.ts:12` and four other test files) isolates tests by **Postgres
schema name**, never by connection or database. A single shared pglite instance fully supports
multiple Postgres schemas the same way a single shared Docker Postgres container does today —
isolation was never connection-based, so it carries over unchanged. Test files running in
parallel vitest worker threads all talk to the same pglite-socket TCP endpoint; the socket
server serializes actual query execution (PGlite is fundamentally single-query-at-a-time
under the hood) but this only affects throughput, not correctness — and per ecosystem
consensus, WASM-in-process startup is faster than Docker container startup per test file
regardless.

### One known risk to verify early, not solve here

`SET LOCAL session_replication_role = replica` (`packages/engine/src/engine.ts:215`, used only
in import mode to disable FK enforcement) has at least one reported compatibility issue against
PGlite in the wild (see Sources). This is exercised by a small number of import-mode tests in
`engine.test.ts`. Recommendation: don't attempt to resolve this in the architecture phase — build
the pglite seam first specifically so this surfaces against the *existing* five Postgres-backed
test files (119 tests, known-good baseline) before any new roll-up/key-prefix/Bulk tests are
layered on top. If it fails, tag the affected import-mode tests to run only under the optional
Docker-Postgres CI job (`describe.skipIf`) rather than blocking the whole pglite path.

### CI matrix

- **pglite job (always runs)**: `pnpm install && pnpm build && pnpm lint && pnpm typecheck &&
  pnpm test` — no service containers, no Docker.
- **Docker-Postgres job (optional — manual trigger or scheduled, not required on every push)**:
  provisions Postgres 16 (GitHub Actions `services:` block, mirroring `docker-compose.yml`) and
  runs `ORGLET_DATABASE_URL=... pnpm test`, catching anything pglite's Postgres fork doesn't
  fully replicate.

## Feature 6: Thin Standard-Object Baselines

### The format already supports this — confirmed by the codebase's own documentation

`packages/metadata/standard/objects/<Name>.json` (`StandardObjectJson` in `types.ts:210-223`)
requires only `name`, `label`, `labelPlural`, `keyPrefix`, `hasOwner`, and `fields[]` — system
fields (`Id`, `IsDeleted`, audit fields, `OwnerId` if `hasOwner`) are added automatically by
`systemFields()` in `build.ts:82-125` and must **not** be listed. `packages/metadata/standard/objects/Group.json`
(read directly) is a working example of an already-minimal baseline object: 7 fields total, no
`Name` auto-generation trick needed since standard objects (unlike custom ones) must list `Name`
explicitly if they have one. `STRUCTURE.md`'s own "Where to Add New Code" section confirms: "No
code changes needed elsewhere — `loadBaseline()` picks up every `*.json` file in that directory
automatically; schema/DDL/API all derive from `OrgSchema`." **This is directly verifiable and
already true for the 14 missing objects — no `packages/schema`, `packages/engine`,
`packages/soql`, or `packages/api` changes are needed for them to exist.** Once each JSON file
exists, the `UNSUPPORTED:reference-target` warning for it disappears automatically (the `missing`
set check at `build.ts:458-466` only flags objects absent from `objects`).

### `thin: true`: recommend it, but as a small functional default, not just documentation

Structurally, nothing requires a `thin` marker — the loader doesn't care how many fields an
object has, and the *existing* generic "unknown field skipped with `UNSUPPORTED:standard-field`"
warning (`build.ts:447-450`) already degrades gracefully for any standard object narrower than
the real Salesforce one, thin or not. Recommendation: add `thin?: boolean` to
`StandardObjectJson` anyway, and use it in `fromStandardObject()` to change **one thing**: when
`thin` is true, default `createable`/`updateable`/`deletable` to `false` unless the JSON
explicitly overrides them (today's `j.createable ?? true` becomes `j.createable ?? !j.thin`,
etc.). This is a genuine, if narrow, functional benefit consistent with "faithful over faked":
orglet cannot correctly emulate the real business behavior behind objects like
`ServiceContract`/`Entitlement`, so a thin object should refuse writes with a clear
`invalidOperation` error (already supported by the existing `obj.createable` check at the top of
`DmlEngine.insert()`, `engine.ts:95`) rather than silently accepting them into a half-modeled
table. `queryable: true` stays the default (`SELECT Id, Name FROM BusinessHours` should work)
since read/lookup-target validation is the actual goal.

### What still needs implementation-time research, not architecture-time guessing

Real Salesforce key prefixes and minimal field sets for each of the 14 objects
(`BusinessHours`, `BusinessProcess`, `CallCenter`, `DandBCompany`, `Entitlement`,
`ExternalDataSource`, `IdeaTheme`, `Individual`, `OperatingHours`, `OpportunityHistory`,
`ServiceAppointment`, `ServiceContract`, `SocialPost`, `UserLicense`) should be looked up from
Salesforce's own object reference per object, not guessed — using the real prefixes matters for
Feature 3's collision check (see below) and for any client code that inspects ID prefixes
directly. This is a roadmap-phase research task, not something this document should assert.

### Component boundaries (Feature 6)

| Component | Responsibility | Talks to |
|---|---|---|
| `packages/metadata/standard/objects/*.json` (14 new files) | Minimal object definitions | Loaded by `loadBaseline()` |
| `packages/metadata/src/types.ts` | `StandardObjectJson.thin?: boolean` | — |
| `packages/metadata/src/build.ts` | `fromStandardObject()` defaults `createable`/`updateable`/`deletable` to `false` when `thin` | Reads the new JSON files |

## Build Order

1. **pglite test seam** (Feature 5) — first, and low-risk: touches no `packages/metadata`,
   `packages/schema`, `packages/engine`, `packages/soql`, or `packages/api` **source**, only test
   infrastructure. Validates the existing 119 tests / 12 files / 5 Postgres-backed files against
   pglite while the codebase is still exactly today's size, surfacing incompatibilities (the
   `session_replication_role` risk) against a small, known-good baseline rather than after four
   more features' worth of new DB-backed tests exist. Also unblocks standing up
   GitHub Actions CI meaningfully without Docker, which is itself a milestone acceptance
   criterion — do that right after this step, not at the end.

2. **Custom-object key-prefix persistence** (Feature 3) — next, because ID stability is
   foundational: every other feature's tests create records, and if custom-object prefixes are
   still drifting during this milestone's own development (as `examples/acme` or Johan's fixture
   gain fields/objects while building Features 1/2/4/6), all of those tests become harder to
   reason about. It's also self-contained (`packages/schema` + one `packages/cli` call site),
   so it doesn't block on anything else being built first.

3. **Thin standard-object baselines** (Feature 6) — right after key-prefix persistence, for two
   reasons found while reading the source, not just the milestone brief's own hint: (a) the
   reconciliation table from step 2 is where a prefix-collision check between newly-assigned
   custom prefixes and the 14 new standard objects' hard-coded prefixes should live, so building
   it second means that check exists by the time these 14 files are added; (b) some existing
   polymorphic `referenceTo` lists point at objects among these 14 or adjacent to them (e.g.
   `Group.RelatedId` → `User|UserRole`) — landing thin baselines before Feature 1 gives that
   feature's own test coverage more real, checkable candidate targets instead of only
   `UNSUPPORTED:reference-target`-degraded ones. It is also the fastest, lowest-risk feature (14
   JSON files + two small `build.ts`/`types.ts` edits, no other package touched), and directly
   reduces Johan's Developer Edition warning count (14 of today's 15), which is worth validating
   early against the real retrieve while the milestone is still in progress.

4. **Per-row polymorphic lookups + SOQL `TYPEOF`** (Feature 1) — after thin baselines, for the
   reason above, and internally ordered as: `packages/engine/src/parents.ts` (runtime
   correctness for formulas/validation rules) and `packages/soql/src/compile.ts`'s basic
   per-row dot-notation joins first, `TYPEOF` last — `TYPEOF` reuses the exact same
   polymorphic-join-group primitive the simpler dot-notation fix needs anyway, so building it
   second avoids inventing that primitive twice at different complexity levels.

5. **Roll-up summary fields** (Feature 2) — after the pglite seam (its own hint, confirmed:
   this feature needs the most new DB-backed test cases of any of the six — insert / update /
   delete / undelete / reparent / filter-change scenarios, each needing real assertions against
   Postgres), and after Feature 1 for a softer, pedagogical reason: both features touch
   `packages/engine`'s save pipeline and `parents.ts`-adjacent parent-loading code, and Feature
   1's fix to `parents.ts` is meaningfully simpler than Feature 2's new `rollups.ts` module and
   its cascading-recompute edge cases — doing the smaller engine change first builds direct,
   transferable familiarity with the exact code roll-ups also need to touch.

6. **Bulk API 2.0 job persistence** (Feature 4) — last. It is the most isolated feature of the
   six (touches only `packages/api/src/bulk` and one `packages/cli/src/main.ts` call site — no
   `packages/engine`/`packages/soql`/`packages/metadata` coupling beyond the already-existing
   `ctx.engine.pool` access pattern), so it carries the least risk of blocking or being blocked
   by anything else, and none of the milestone's headline acceptance criteria (Developer Edition
   zero-warnings, conformance suites green) depend on it. Doing it last also means its new tests
   run under CI (unblocked by step 1) for their entire development, same as every other feature
   from step 2 onward.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Recomputing roll-ups via a Postgres trigger

**What it would look like:** a `AFTER INSERT/UPDATE/DELETE` trigger on each child table that
updates the parent's roll-up column directly in SQL. **Why it's wrong here:** explicitly
excluded by `PROJECT.md`'s constraints — Salesforce's own order of execution requires
`PRIORVALUE`/`ISCHANGED` and mutable before-hooks that only the application layer can provide,
and a DB trigger firing on `INSERT`/`UPDATE`/`DELETE` cannot participate in that ordering (it
also cannot be skipped in import mode the way `saveBatch`'s hooks already are, and it duplicates
logic that would then exist in two places — SQL and the engine — for validation rules that also
touch parent state). **Do instead:** the batched aggregate `UPDATE` issued from
`packages/engine/src/rollups.ts`, called explicitly from `DmlEngine`'s save/delete/undelete
pipeline, described above.

### Anti-Pattern 2: A new package for any of these six features

**What it would look like:** `packages/rollups`, `packages/bulk-store`, etc. **Why it's wrong
here:** every one of the six features is a small, layer-appropriate extension of an existing
package's already-stated responsibility (`packages/engine` already owns "the DML pipeline";
`packages/api/src/bulk` already owns "Bulk API 2.0 internals... because it's stateful and
specific to that one feature," per `STRUCTURE.md`). Introducing a new package for any of them
would violate the project's own explicit convention ("there is no shared 'core' or 'common'
package... add it to the most specific existing package instead") without any of the six needing
a genuinely new dependency direction in the `metadata → schema → {formula, soql} → engine → api
→ cli` graph.

## Sources

- [Salesforce CustomField Metadata API reference](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/customfield.htm) — MEDIUM confidence, roll-up summary field XML shape (`summarizedField`/`summaryForeignKey`/`summaryOperation`/`summaryFilterItems`)
- [PGlite](https://pglite.dev/) / [electric-sql/pglite](https://github.com/electric-sql/pglite) — embeddable Postgres, WASM, single-connection-internally
- [@electric-sql/pglite-socket](https://www.npmjs.com/package/@electric-sql/pglite-socket) / [PGlite Socket docs](https://pglite.dev/docs/pglite-socket) — TCP wire-protocol bridge that multiplexes a single PGlite instance to multiple `pg`-driver connections
- [pglite-server (kamilogorek)](https://github.com/kamilogorek/pglite-server) — confirms multi-connection support is via multiplexing, not native PGlite concurrency
- [PGlite replication slot issue #880](https://github.com/electric-sql/pglite/issues/880) and related — LOW-MEDIUM confidence signal that `session_replication_role`-adjacent session settings have had reported friction against PGlite; flagged as a risk to verify early, not resolved here
- Drizzle/Prisma + Vitest + PGlite examples (multiple, aggregated) — confirms the "vitest `globalSetup` starts the test DB and exports its connection string via env var" pattern used in this document's Feature 5 recommendation
- All file-path-specific claims in this document (component boundaries, "no change needed," exhaustive-switch findings) — HIGH confidence, verified by directly reading the named source files in this repository on 2026-09-29

---
*Architecture research for: orglet hardening milestone*
*Researched: 2026-09-29*
