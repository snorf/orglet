# Phase 13: Roll-Ups over Formula Fields - Research

**Researched:** 2026-10-24
**Domain:** Roll-up summary recompute/backfill over TS-evaluated (virtual) formula fields; internal layering (metadata -> schema -> formula -> engine -> cli)
**Confidence:** MEDIUM-HIGH (codebase facts HIGH; Salesforce rule set MEDIUM, rounding LOW; official Help pages were not fetchable, see Sources)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Admission rule on `CompiledFormula.dependencies {fields, globals, volatile}`: every referenced field is on the child object itself (`path: []`), `volatile` false, only globals `$Label`, `$CustomMetadata`, `$System.OriginDateTime` allowed. Everything else (cross-object path, NOW/TODAY/TIMENOW, `$User`, `$Profile`, `$Organization`, `$RecordType`, `$UserRole`, `$Setup`, `$Api`, `$Permission`) -> `UNSUPPORTED:rollup-formula`. `$Label` allowed (ROADMAP criterion 3 and ROLL2-01 amended).
- **D-02:** Formula-on-formula allowed when the whole chain qualifies (transitive through same-child formulas down to stored fields, each satisfying D-01). The warning names the inner formula that breaks the rule (D-08). Needs formula evaluation ordered topologically instead of declaration order.
- **D-03:** A formula reading a roll-up on the same child may be summarized by a roll-up higher up; treated as a roll-up chain (Phase 5 ROLL-06): `rollupDepth` counts the formula hop, lower levels recompute/backfill first, `MAX_ROLLUP_DEPTH` still applies at runtime.
- **D-04:** As a filter field (`summaryFilterItems`, incl. `valueField`) a formula may be any type family Phase 5 `filterSql` handles; the formula's return type decides the family. Summarized field keeps Phase 5 D-06 type rules (SUM over Number/Currency/Percent; MIN/MAX over Number/Currency/Percent/Date/DateTime) by declared return type.
- **D-05:** Number/currency/percent formula values are rounded to the formula's declared scale before SUM/MIN/MAX. Researcher verifies; if documentation says otherwise the documented rule wins and the decision is updated in the plan.
- **D-06:** A rejected roll-up is absent from the schema (no column, not in describe, SOQL `INVALID_FIELD`). "Present but inert" rejected.
- **D-07:** Admission runs at schema-build time; warning via `pushDiagnostic` with area `rollup-formula`, `object`, `field`, `cause`. `@orglet/metadata` cannot import `@orglet/formula`; research picks the mechanism (injected resolver vs post-pass in `loadOrgSchema`); constraint: field gone before DDL is planned, warning is a build diagnostic.
- **D-08:** Warning names the rule and the offending field, e.g. `UNSUPPORTED:rollup-formula Account.Total_Score__c: Child__c.Score__c reads Account__r.Rating (cross-object)` / `... uses TODAY()`; for chains the inner formula that breaks the rule.
- **D-09:** formula -> roll-up -> formula cycle at load: `UNSUPPORTED:rollup-cycle` with full cycle path; every roll-up on the cycle skipped (D-06), the formulas stay; `--strict` fails; no hard load failure.
- **D-10:** Formula-dependent roll-ups are not backfilled in the migrate transaction. `migrate()` returns them as pending backfills and skips their SQL; `orglet up` runs an engine backfill step right after constructing `DmlEngine` and before the server listens. SQL-only roll-ups still backfill last inside migrate.
- **D-11:** Completion remembered in a new marker table in `_orglet` (e.g. `_orglet.rollup_backfills` keyed by object and field, completed timestamp). Row written only after the backfill succeeded; a crash after migrate committed redoes it next `up`; a second `up` is silent.
- **D-12:** Backfill is a data load, not a save: parent rules/hooks do not run. DB error aborts `orglet up` with a clear message, marker unwritten.
- **D-13:** Backfill runs regardless of `--import`.
- **D-14:** Watched set = transitive set of stored same-object fields the formula reads (through formula-on-formula and formula-on-roll-up) plus the FK.
- **D-15:** Recompute loads live child rows of affected parents, evaluates child formulas in TS (`loadParents` + `applyFormulaFields`), hands per-row values to the existing SQL aggregate/filter as a derived table. O(children of affected parents), no cap, documented in PROJECT.md Known gaps.
- **D-16:** Only formula-dependent roll-up fields take that path; stored-field roll-ups keep the pure-SQL path untouched.
- **D-17:** `orglet rollup --recompute` stays in backlog (ROLLX-01); shape the engine backfill function so a CLI can call it later; no command added.

### Claude's Discretion
- Mechanism for D-07, data shape/location of the transitive dependency graph, topological evaluation order.
- Shape of the pending-backfill contract between `migrate()` and the engine; marker table DDL.
- Whether derived-table SQL lives in `packages/schema/src/rollup.ts` as an optional parameter of `rollupSelectSql` or elsewhere; "SQL + params, executes nothing" must survive.
- Test fixtures: test-local fixtures with neutral names; `examples/acme` unchanged.

### Deferred Ideas (OUT OF SCOPE)
- `orglet rollup --recompute` (ROLLX-01); formula fields in SOQL WHERE/ORDER BY/GROUP BY (`UNSUPPORTED:soql-formula` stays); extending `conformance/rollup-check` and acceptance fixture (Phase 14 ACC2-01/02); SQL translation of formulas / generated columns; `orglet check` report redesign (Phase 14).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ROLL2-01 | COUNT/SUM/MIN/MAX roll-up whose summarized or filter field is a same-object non-volatile formula loads, recomputes in the save pipeline like a stored roll-up, is backfilled once at upgrade; outside that set -> `UNSUPPORTED:rollup-formula`, skipped | Sections "Mechanism decisions" 1-8, "Architecture Patterns", "Validation Architecture" |
</phase_requirements>

## Summary

Formula fields in orglet have no column (`isVirtual`, `packages/schema/src/columns.ts:44`) and are evaluated per row in TypeScript by sigha via `evaluateCompiled` (`packages/formula/src/evaluate.ts:85`). There is no SQL translation. A roll-up over a formula therefore cannot be a pure SQL aggregate over the child table; it must take the CONTEXT D-15 route: load live child rows, evaluate formulas in TS, pass the per-row values back into the existing SQL aggregate/filter as a derived table (a `unnest(...)` join). SUM/MIN/MAX/COUNT, all filter operators and null handling then stay in one implementation (`aggregate()` / `filterSql()` in `packages/schema/src/rollup.ts`).

Four codebase facts shape the plan and are not stated in CONTEXT:
1. **The admission check cannot run inside `buildOrgSchema`.** `compileFormula` needs a finished `OrgSchema` (it resolves field types, including roll-up fields that other formulas read). The only workable mechanism is a post-pass after `loadOrgSchema` and before `reconcileKeyPrefixes`/`migrate` (see Mechanism 1). `metadata` only relaxes its two shape gates.
2. **Evaluation order is already wrong for formula-on-formula.** `evaluateCompiled` reads referenced values from `ctx.record` (`valueFor`, evaluate.ts ~57), and `applyFormulaFields` (`packages/engine/src/formulas.ts` bottom) iterates in declaration order, so a formula declared before the formula it reads sees `undefined`. D-02's topological order is a bug fix for `project()` as well, not only for roll-ups.
3. **Evaluated numbers are not rounded to the declared scale anywhere** (`grep scale` in formula/ and engine/ finds nothing in the evaluation path). D-05 rounding must be added explicitly, and it is best done in SQL (`round(v.x::numeric, scale)`), not in TS.
4. **D-09 "the formulas stay" is not literally achievable.** On a cycle `Parent.R -> Child.F -> Child.R2 -> Parent.G -> Parent.R`, skipping every roll-up on the cycle removes `R` and `R2`, and `G` (reads `R`) and `F` (reads `R2`) then fail to compile in `FormulaRegistry` with their own `UNSUPPORTED:formula` + `missing` diagnostic. See Open Question 1; the plan must either accept that and set `cause`, or change D-09.

**Primary recommendation:** Add `admitFormulaRollups(build: BuildResult): OrgSchemaImpl` as a new file in `@orglet/formula` (post-pass, fixpoint loop, rebuilds `OrgSchemaImpl`); relax the two metadata gates; add an optional `virtual` parameter to `rollupSelectSql`/`rollupBackfillSql`; build a `rollupInputs`/dependency graph module in `@orglet/formula` that both the admission pass and the engine's `RollupRegistry` use; backfill in the engine with a `_orglet.rollup_backfills` marker keyed `(org_schema, object_name, field_name)`.

## Standard Stack

No new dependencies. Everything is existing workspace code.

| Library | Version (repo) | Purpose | Why |
|---------|----------------|---------|-----|
| TypeScript | 5.9.3 | strict, NodeNext, `.js` import suffixes, `import type`, `exactOptionalPropertyTypes` | project convention |
| vitest | 3.2.7 | tests co-located `*.test.ts`; pglite by default, Postgres when `ORGLET_DATABASE_URL` set (`test/db.ts`) | project convention |
| pg / pglite | existing | derived table uses `unnest($n::type[], ...)`; works on pglite | no new deps |
| @orglet/sigha (vendored) | existing | formula evaluation | do not edit |

**Version verification:** not applicable (no packages added). Note: the shell used for research has Node v18.20.8 and no `pnpm`; the project needs Node >=22 and pnpm via Corepack (`engine-strict=true`). Execution must run under Node 22 (nvm/`.nvmrc`).

## Architecture Patterns

### Mechanism decisions (the Claude's-discretion items, resolved)

**1. D-07 mechanism: post-pass in `@orglet/formula`, not an injected hook.**
`resolveRollups` runs inside `buildOrgSchema` before the `OrgSchemaImpl` exists, and `compileFormula(source, {schema, objectName, context})` requires one. Formulas that read roll-up fields (D-03) need those fields present in the schema to compile. So:
- `packages/metadata/src/rollup.ts`: relax (a) `tryResolve` line ~177 (`summarized.formula !== undefined` -> drop) and (b) `familyOf` ~205 (`f.formula !== undefined` -> undefined) so a formula field is admitted on shape/type alone (family from `f.type`; `allowed` set at ~179 already works off `summarized.type`). Keep roll-up fields excluded from `familyOf` (unchanged `rollup-filter` "is a roll-up summary").
- New `packages/formula/src/rollup-admission.ts`: `admitFormulaRollups(build: BuildResult-like {schema: OrgSchemaImpl; warnings; diagnostics}): OrgSchemaImpl`. It (1) finds every roll-up field whose summarized/filter/valueField is a formula (directly, or by summarizing a roll-up that is itself formula-backed), (2) compiles the formulas it needs with `compileFormula` (context `"formula_field"`, `treatBlanksAs: field.formulaTreatBlanksAs`), (3) applies D-01/D-02 on `dependencies`, (4) detects cycles (D-09), (5) removes failing roll-up `FieldDef`s from `SObjectDef.fields` in place and pushes diagnostics via `pushDiagnostic` (exported from `@orglet/metadata`), (6) repeats until no removal (removing a roll-up can invalidate another roll-up built on it), (7) returns `new OrgSchemaImpl(objects, globalValueSets, standardValueSets, labels)` because `OrgSchemaImpl.fieldIndex` is built in its constructor and goes stale on removal (the same trick `formula-globals.test.ts` `extend()` and `migrate.test.ts` `only3()` use).
- Callers: `packages/cli/src/main.ts` `check` (~L55) and `up` (~L103) call `loadOrgSchema` then the new function, before `reconcileKeyPrefixes`/`migrate`. Engine/migrate/schema tests that want formula roll-ups call it too. `BuildResult.warnings`/`diagnostics` are `string[]`/`Diagnostic[]` kept in lock-step by `pushDiagnostic`; push through that, never append to `warnings` alone.

**2. Dependency graph module (shared by admission, RollupRegistry, backfill ordering).**
Put in `packages/formula/src/rollup-inputs.ts` (formula package already owns `FormulaDependencies`). Shape:
```ts
// per (object, formula field): compiled once
interface FormulaNode { object: string; field: string; deps: FormulaDependencies }
/** Stored same-object fields a field ultimately reads, following formulas transitively. */
function storedInputs(nodes: Map<string, FormulaNode>, schema: OrgSchema, object: string, field: string): Set<string>
/** Formula fields to evaluate for a roll-up, topologically ordered. */
function evaluationOrder(...): string[]
```
`FormulaRegistry` (engine) already compiles every formula field once; for the engine, expose `FormulaRegistry.fieldDependencies(obj, field)` (exists) and add a `FormulaRegistry.formulaOrder(obj): CompiledField[]` (topological). The admission pass compiles its own subset because it runs before any `FormulaRegistry` exists. Do not duplicate the walk: have one pure function over a `(object, field) -> FormulaDependencies | undefined` lookup that both callers feed.

**3. Topological order (D-02).** Kahn's algorithm over same-object formula -> formula edges taken from `dependencies.fields` entries with `path: []`. Change `FormulaRegistry.formulaFields(obj)` ordering (or add a sibling used by `applyFormulaFields`) so `project()`, SOQL result projection and the roll-up path all evaluate in dependency order. Formula-on-formula cycles: not known whether sigha/compile rejects them (see Open Question 2); the sort must not loop - on a residual cycle, keep declaration order for the remainder.

**4. Which roll-ups are "formula-dependent" (needed in `schema`, which cannot compile).** Structural predicate in `packages/schema/src/rollup.ts`:
```ts
/** True when the summarized field, a filter field or a valueField is a formula, or is itself a formula-dependent roll-up. */
export function isFormulaRollup(schema: OrgSchema, field: FieldDef): boolean
```
No compile needed: `FieldDef.formula !== undefined` on the child field is enough, and the transitive case follows `summarizedField`/filters that are roll-ups. `migrate()` step 3 (`packages/schema/src/migrate.ts` ~L214-223) skips these. `rollupDepth` must also count a formula hop (D-03) but `schema` cannot see formula reads; give it an optional `inputsOf?: (child, formulaField) => FieldDef[]` or, simpler, let the engine order its own backfill by the shared graph and leave `rollupDepth` unchanged for SQL-only roll-ups (it is used only by `migrate.ts:219`). Recommended: engine orders; `rollupDepth` unchanged.

**5. `migrate()` contract (D-10).** Add `pendingBackfills: { object: string; field: string }[]` to `MigrateResult` (informational: the formula roll-up columns added in this run). Do not make the engine depend on it: the engine's rule is **"a formula-dependent roll-up with no marker row is backfilled"**. This is self-healing (crash after migrate commit, fresh DB, first upgrade) and needs no cross-call state. On a fresh database the tables are empty so the backfill is a no-op that writes the marker.

**6. Marker table (D-11).** `packages/schema/src/` new file (e.g. `backfills.ts`, mirroring `prefixes.ts` which uses `ensureInternalSchema` + `CREATE TABLE IF NOT EXISTS` + `pg_advisory_xact_lock`):
```sql
CREATE TABLE IF NOT EXISTS "_orglet"."rollup_backfills" (
  org_schema   text        NOT NULL,
  object_name  text        NOT NULL,
  field_name   text        NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_schema, object_name, field_name)
)
```
Create it in the engine step, not inside `migrate()`: the CLI counts schema changes with `/^(CREATE TABLE|ALTER TABLE ...)/` over `migration.statements` (main.ts ~L146), and `migrate.test.ts` "is idempotent" asserts no `CREATE TABLE` on the second run; a `CREATE TABLE IF NOT EXISTS` statement pushed through `run()` would break both. Exports: `ensureRollupBackfillTable`, `completedRollupBackfills(pool, orgSchema)`, `markRollupBackfilled(client, orgSchema, object, field)`, `dropRollupBackfills(pool, orgSchema)`. `orglet reset` (`main.ts` `reset`) must call `dropRollupBackfills` (it already drops bulk jobs per org schema); otherwise a stale marker survives `DROP SCHEMA` and a restored/imported org would skip its backfill.

**7. Engine backfill step (D-10/D-12/D-13/D-17).** New `DmlEngine.backfillFormulaRollups(): Promise<{ done: string[] }>` (or a free function in `packages/engine/src/rollups.ts`), called from `up` right after `new DmlEngine(...)` (main.ts ~L166) and before `createApiServer`. Per pending field, in dependency order (lower chain level first; a formula roll-up that depends on another pending roll-up goes after it): in one transaction, `SELECT` live child rows (all, chunked by parent), `loadParents` is unnecessary (same-object only), evaluate via topologically ordered `applyFormulaFields`, then `UPDATE parent SET col = <aggregate over derived table>` using `rollupBackfillSql(..., virtual)`; then `markRollupBackfilled`. No parent rules/hooks (D-12). Not gated on `importMode` (D-13). Wrap errors as `new Error("roll-up backfill of Parent.Field failed: ...")` so `up` prints a clear message and returns non-zero.
Caution carried from Phase 8: do not run this inside the migrate transaction (deferred FK trigger events block later DDL on the same table).

**8. Derived table SQL (D-15) in `packages/schema/src/rollup.ts`.** Add an optional last parameter to `rollupSelectSql(orgSchema, schema, parent, fields, parentIds, virtual?)` and `rollupBackfillSql(..., virtual?)`:
```ts
export interface VirtualColumn { values: Array<string | number | boolean | null> } // aligned with ids
export interface VirtualRows { ids: string[]; columns: Map<string /*lower-cased child field name*/, VirtualColumn> }
```
`aggregate()` currently emits `FROM <child> c` and refers to `c."<col>"` via `columnName(summarized)` / `columnName(childField)` in `filterSql`. For formula fields there is no column, so `columnName` must not be used. Emit, only when a referenced child field is virtual:
```sql
(SELECT c0.*, v."f1", v."f2"
   FROM "org"."child__c" c0
   JOIN unnest($n::char(18)[], $m::numeric[], $k::boolean[]) AS v(id, "f1", "f2") ON v.id = c0."id") c
```
so every `c."col"` expression and `filterSql` stay as they are (`familyOf` in schema/rollup.ts already maps by `FieldDef.type`, which is the formula's return type). Array element SQL type per family: numeric -> `numeric[]`, date -> `date[]`, DateTime -> `timestamptz[]`, Checkbox -> `boolean[]`, text/picklist -> `text[]`. Params are pushed in order into the same `params` array (`$n` indices are assigned from `params.length`). Keep "returns SQL and params, executes nothing": the module receives already-evaluated values.
**Rounding (D-05):** in the select list of the derived table, `round(v."f1", <scale>)` for Number/Currency/Percent formula columns whose `FieldDef.scale` is defined (`round(numeric,int)` rounds half away from zero in Postgres). Add a unit test in `schema/src/rollup.test.ts` asserting the SQL contains `round(` with the scale as a literal integer (scale comes from metadata, not user input; still emit via `Number.isInteger` check, not string concatenation of untrusted data).
Datetime values are produced by `fromSfValue` as `YYYY-MM-DDTHH:mm:ss.SSS+0000` strings (`formula/src/values.ts` header); whether Postgres `timestamptz` accepts the `+0000` offset form inside an array parameter must be verified by a test on pglite and Postgres (Open Question 3). Safe fallback: normalise to `...Z` in the engine before passing.

**9. Recompute path (D-14..D-16).** `packages/engine/src/rollups.ts`:
- `RollupRegistry` constructor takes the formula inputs (e.g. `new RollupRegistry(schema, formulas)`; in `DmlEngine` constructor build `this.formulas` first - it already is built first, only the argument changes). `watched` adds `storedInputs(child, summarizedField|filter.field|valueField)` for each formula field (transitive through formula-on-formula and formula-on-roll-up) and a `formulaBacked: boolean` + `formulaFields: string[]` on `RollupBinding`.
- `affectedParents` needs no change (it keys on `w.changes` vs `watched`, and a roll-up written by `saveRollupParent` flows into `changes`).
- `recomputeRollups` (`engine.ts` ~L579-624): per `ParentGroup`, split `group.fields` into SQL-only fields and `formulaBacked` fields. SQL-only: the existing `rollupSelectSql` call, unchanged (D-16). Formula-backed: load live children `this.store.childrenOf(client, childObj, fkField, ids)` per distinct (child object, FK) (children are read after the write because `withRollups` runs `body()` before `recompute()`), evaluate with topologically ordered `applyFormulaFields(this.formulas, child, row, {})` (empty globals are valid: only constants are allowed), build `VirtualRows`, call `rollupSelectSql(..., virtual)`, and merge the rows into `fresh` (a second statement per group; the `Map` keyed by `Id`). Note `childrenOf` returns all live rows for the given parent ids, so cost is O(children of affected parents) as accepted in D-15.
- Child rows in the in-flight batch whose FK changes (reparent) are covered by `affectedParents` returning both old and new parent ids.
- Rolled-up `Currency`/`Number` results compare as numbers (`value !== row[f.name]`) - same as today.
- `MAX_ROLLUP_DEPTH` (16) remains the runtime guard (D-03).

### Recommended structure
```
packages/metadata/src/rollup.ts            # relax two formula gates (shape only)
packages/formula/src/rollup-admission.ts   # admitFormulaRollups (D-01..D-09); NEW
packages/formula/src/rollup-inputs.ts      # storedInputs / evaluationOrder over FormulaDependencies; NEW
packages/formula/src/index.ts              # export both
packages/schema/src/rollup.ts              # isFormulaRollup, VirtualRows, derived-table SQL, round()
packages/schema/src/backfills.ts           # marker table helpers; NEW (+ index.ts exports)
packages/schema/src/migrate.ts             # skip formula rollups in step 3, return pendingBackfills
packages/engine/src/formulas.ts            # topological order (D-02)
packages/engine/src/rollups.ts             # watched += formula inputs; formulaBacked flag
packages/engine/src/engine.ts              # recomputeRollups split; backfillFormulaRollups
packages/cli/src/main.ts                   # check/up call admit; up calls backfill; reset drops markers
```

### Anti-Patterns to Avoid
- **Admitting by try/catch at recompute time** - the field would already have a column and a describe entry (violates D-06).
- **Mutating `OrgSchemaImpl` without rebuilding it** - `fieldIndex`/`children` are constructor-built; stale `getField` would still return removed roll-ups.
- **Appending only to `warnings`** - always `pushDiagnostic(sink, ...)` so warnings and diagnostics stay 1:1 (`diagnostics.test.ts` asserts the invariant).
- **Putting `CREATE TABLE IF NOT EXISTS _orglet.rollup_backfills` through migrate's `run()`** - breaks "a second up is silent" measurement (see Mechanism 6).
- **Backfilling before the `FormulaRegistry` exists / inside the migrate transaction** - layering and Phase 8 deferred-trigger constraint.
- **Using `columnName(formulaField)` in SQL builders** - formula fields have no column.
- **Round in TS with `toFixed`/`Math.round`** - IEEE half-even drift; let Postgres `round(numeric, scale)` do it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Aggregating formula values | A TS-side SUM/MIN/MAX/filter evaluator | Existing `aggregate()`/`filterSql()` over an `unnest` derived table | one source of truth for case-insensitive text, NULL, valueField, range semantics (ROLL-03) |
| Formula semantics in SQL | Formula -> SQL translation / generated columns | `evaluateCompiled` via `applyFormulaFields` | PROJECT.md out of scope; sigha is the single formula implementation |
| Rollup/formula dependency collection | A second AST walk | `CompiledFormula.dependencies` (`fields[].path === []`, `globals`, `volatile`) | Phase 12 already built it for this phase |
| Internal bookkeeping table | A file or in-memory flag | `_orglet` table with `ensureInternalSchema` + advisory lock (pattern: `prefixes.ts`) | survives restarts, crash-safe, `reset`-aware |
| Warning plumbing | New list/formatter | `pushDiagnostic` + `SkippedItem{kind:"rollup"}` | `orglet check --strict`, Phase 14 report |
| Cycle path search | Ad-hoc recursion with no visited set | Standard DFS with colouring over `Obj.Field` nodes | message needs the full path; no infinite loop |

## Common Pitfalls

### Pitfall 1: Formula-on-formula reads a stale value
**What goes wrong:** `F2 = F1 + 1` declared before `F1` evaluates against `undefined`/missing `record.F1` (blank). A roll-up over `F2` is then silently wrong.
**Why:** `applyFormulaFields` iterates declaration order and `evaluateCompiled` reads `ctx.record` (evaluate.ts `valueFor`).
**Avoid:** topological `formulaFields` ordering (D-02); regression test in `formulas.test.ts` with a reversed declaration order.
**Warning signs:** values correct only when formulas are declared bottom-up.

### Pitfall 2: Unrounded formula values produce parent totals that differ from what readers see
**What goes wrong:** `Qty__c * 0.333` with scale 2 sums to 0.99 stored-rounded vs 0.999 unrounded.
**Avoid:** `round(v.x, scale)` in the derived table (Mechanism 8); test with 3 children of 0.3333.
**Note:** the platform rule is not documented (Open Question 4); D-05 stands as an orglet choice.

### Pitfall 3: Stale marker after `orglet reset`
**What goes wrong:** `DROP SCHEMA <org> CASCADE` leaves `_orglet.rollup_backfills` rows; recreating tables and importing data skips the backfill.
**Avoid:** `reset` calls `dropRollupBackfills(pool, orgSchema)`; test it.

### Pitfall 4: A formula roll-up removed by admission breaks formulas that read it
**What goes wrong:** removed roll-up `R` -> `FormulaRegistry` compile of `G` (reads `R`) fails with `UNSUPPORTED:formula ... skipped` (own diagnostic, `missing` set).
**Avoid:** set `cause` on the roll-up diagnostic's key and mention in tests; document that D-09 "formulas stay" holds only for formulas that do not read a skipped roll-up (Open Question 1).

### Pitfall 5: `affectedParents` misses the formula's inputs
**What goes wrong:** updating a field only the formula reads (not the summarized field) leaves the parent stale (success criterion 1, "including when a field the formula reads changes").
**Avoid:** `watched` built from `storedInputs`; test: update `Qty__c` on a child where roll-up sums formula `Qty__c * Price__c`.

### Pitfall 6: Date/Datetime array parameters
**What goes wrong:** `+0000` offset or `NULL` elements in `timestamptz[]`/`date[]` params fail or coerce differently on pglite vs Postgres.
**Avoid:** one cross-engine test for MIN/MAX over a Date and a DateTime formula; normalise to `Z` if needed.

### Pitfall 7: Roll-up result column type for formula-typed sources
**What goes wrong:** `tryResolve` builds the column from `summarized.type/precision/scale`; a formula Number with undefined `precision` falls back to `Math.max(summarized.precision ?? 18, 18)` and `scale ?? 0`. Fine, but a formula Currency declared `scale: 2` must carry through to the roll-up column's `numeric(18,2)`.
**Avoid:** assert `column.scale` in `metadata/src/rollup.test.ts`.

### Pitfall 8: Pre-existing tests assert the old rejection
`packages/metadata/src/build.test.ts` ~L568-L580 (`Sum_Formula__c` expects `rollup-type`, count 6 -> 5) and `packages/metadata/src/rollup.test.ts` filter-over-formula cases must be rewritten, not deleted: keep `Sum_Formula__c` as an admitted case at the metadata layer and move the rejection assertions to `formula/src/rollup-admission.test.ts`.

## Salesforce Rules (public documentation)

| Question | Finding | Confidence |
|----------|---------|------------|
| Which formula fields may be summarized | A roll-up summary can calculate formula fields only if the formula contains no cross-object field references and no functions that derive values on the fly such as NOW or TODAY | MEDIUM (multiple secondary sources quote the Help text; the Help pages themselves rendered only a loading shell to WebFetch) |
| Filter criteria | Roll-up summary filters cannot use cross-object formula fields or formula fields containing on-the-fly functions (NOW/TODAY); long text, multi-select picklist, Description, system fields such as Last Activity, and lookup fields are also excluded as filter fields | MEDIUM |
| `$User`, `$Profile`, `$Setup`, `$Api`, `$Organization`, `$RecordType`, `$UserRole` | Not individually documented in the sources found; orglet's D-01 bans them because their value is evaluation-time context (same stale-roll-up rationale as TODAY). Stricter than the documented minimum - acceptable for "fails soft" | LOW (orglet choice, consistent with documented principle) |
| `DATEVALUE` | One secondary snippet lists DATEVALUE with NOW/TODAY among "derive values on the fly" functions. Not adopted: DATEVALUE on a stored datetime is deterministic. Flag only | LOW |
| Return types | SUM: Number/Currency/Percent; MIN/MAX: Number/Currency/Percent/Date/DateTime; COUNT needs no summarized field. Formula return types follow the same rule (decided by the declared return type) | MEDIUM (Phase 5 already encodes this for stored fields; no source found that treats formulas differently) |
| Rounding before aggregating | No public statement found. Reasoning: platform stores summed values to the roll-up's declared scale and a formula's displayed value is rounded to its declared decimal places; D-05 mirrors the reader-visible value | LOW; D-05 stays as the orglet decision |
| Roll-up over a formula reading another roll-up | No public statement found in the sources reachable. D-03 is an orglet decision; cycles are reported by orglet as `rollup-cycle` at load | LOW |

Because the Help pages could not be read directly, the plan should record in the code comments that the rule set is "as documented in Roll-Up Summary Field considerations" and not claim a benchmarked result (legal constraint: never diff against a real org).

## Code Examples

### Admission rule on a compiled formula (D-01)
```ts
// Source: packages/formula/src/compile.ts FormulaDependencies; D-01
const CONSTANT_GLOBALS = new Set<GlobalRoot>(["$Label", "$CustomMetadata", "$System"]);

function violation(d: FormulaDependencies): string | undefined {
  const cross = d.fields.find((f) => f.path.length > 0);
  if (cross) return `reads ${cross.path.join(".")}.${cross.fields[0] ?? ""} (cross-object)`;
  if (d.volatile) return "uses a volatile function or global (NOW/TODAY/TIMENOW, $User, ...)";
  const g = d.globals.find((x) => !CONSTANT_GLOBALS.has(x));
  return g ? `uses ${g}` : undefined;
}
```
Note `volatile` already covers TODAY/NOW/TIMENOW and every evaluation-time global (compile.ts ~L127, L269-334); the explicit `globals` check keeps the message precise (`uses $User`) and is defensive against a global added later. For "uses TODAY()" the message needs the function name, which `dependencies` does not carry; produce `uses a volatile function or global` unless the plan adds a `volatileReasons` field to `FormulaDependencies` (small, additive, recommended for D-08 fidelity).

### Marker-gated engine backfill (shape)
```ts
// Source: new, modelled on prefixes.ts reconcileKeyPrefixes
async backfillFormulaRollups(): Promise<string[]> {
  await ensureRollupBackfillTable(this.pool);
  const done = await completedRollupBackfills(this.pool, this.orgSchema);   // Set<"object.field">
  const todo = this.rollups.formulaBacked().filter((b) => !done.has(key(b))).sort(byChainLevel);
  for (const b of todo) {
    await withTransaction(this.pool, async (client) => {
      await this.backfillOne(client, b);              // childrenOf -> applyFormulaFields -> rollupBackfillSql(virtual)
      await markRollupBackfilled(client, this.orgSchema, b.parent.name, b.field.name);
    });
  }
  return todo.map(key);
}
```
`backfillOne` for the full-table UPDATE: pass the entire child set (all live rows of the child object, one pass) as `VirtualRows`; the correlated subquery's `c."fk" = p."id"` keeps per-parent grouping. For very large tables chunk by child id range and run `rollupSelectSql`-style per parent batch instead of one `unnest`; keep unchunked first (D-15 accepts O(n)) and note the memory cost in Known gaps.

## State of the Art

| Old | Current | Impact |
|-----|---------|--------|
| Roll-up over formula -> `UNSUPPORTED:rollup-type` (Phase 5) | admitted with `rollup-formula` for the forbidden subset | metadata gates relaxed; tests rewritten |
| Backfill entirely inside migrate transaction (Phase 8 D-10) | SQL-only inside migrate; formula roll-ups in engine step with `_orglet` marker | new `pendingBackfills` / marker table |
| Formula evaluation in declaration order | dependency order | fixes formula-on-formula generally |

## Runtime State Inventory

Not a rename/migration phase, but it creates new persisted state:

| Category | Items | Action |
|----------|-------|--------|
| Stored data | New `_orglet.rollup_backfills` rows; new formula-roll-up columns on parent tables (existing DBs get them via `ALTER TABLE ADD COLUMN` in migrate) | code (new table + engine step) |
| Live service config | None - verified: no external services hold roll-up config | none |
| OS-registered state | None | none |
| Secrets/env vars | None | none |
| Build artifacts | `dist/` per package (project references) - rebuild with `pnpm build` after new exports | rebuild |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node >=22 | build/test | shell default is v18.20.8 | 18.20.8 | use `.nvmrc` (22) via nvm/Corepack before running |
| pnpm >=10 | scripts | not on PATH in this shell | - | `corepack enable pnpm` under Node 22 |
| Docker / Postgres 16 | optional full-engine test run | Docker engine present | - | tests default to embedded pglite when `ORGLET_DATABASE_URL` is unset |
| Public Salesforce Help pages | rule verification | WebFetch returns a loading shell | - | secondary sources (see Sources); cannot be upgraded to HIGH |

**Blocking:** none for planning. Execution must switch to Node 22 first.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.7, single root `vitest.config.ts` (aliases `@orglet/*` to `src/index.ts`) |
| DB | embedded pglite via `test/db.ts` `openTestDb()`; real Postgres when `ORGLET_DATABASE_URL` is set (then `maxWorkers: 3`) |
| Quick run | `pnpm vitest run packages/<pkg>/src/<file>.test.ts` |
| Full suite | `pnpm test` (plus `pnpm lint`, `pnpm build`, and `conformance/run-all.sh` unchanged) |
| Fixtures | in-code `SourceObject`/`SourceField` builders + `buildOrgSchema(await loadBaseline(), {rootDir:"", packageDirectories:[], objects, ...})` as in `metadata/src/build.test.ts` L414-445, `schema/src/migrate.test.ts` L203-240 and `engine/src/rollups.test.ts` imports; neutral names (`Parent__c`, `Child__c`, `Calc__c`). Do not touch `examples/acme`. |

### Phase Requirements -> Test Map
| Success criterion | Behaviour | Test type | File / command | Exists |
|-------------------|-----------|-----------|----------------|--------|
| SC1 load | COUNT/SUM/MIN/MAX roll-up over same-object non-volatile formula (summarized and filter, incl. valueField, formula-on-formula, `$Label`) is kept in the schema | unit | `packages/metadata/src/rollup.test.ts` (shape), `packages/formula/src/rollup-admission.test.ts` (admission) - `pnpm vitest run packages/formula/src/rollup-admission.test.ts` | Wave 0 (admission file new; metadata file exists, update) |
| SC1 recompute | insert/update/delete/undelete of children moves parent; update of a field only the formula reads recomputes; reparent; filter on formula | integration (pglite) | `packages/engine/src/rollups-formula.test.ts` - `pnpm vitest run packages/engine/src/rollups-formula.test.ts` | Wave 0 |
| SC1 watched | `RollupRegistry` binding `watched` contains transitive stored inputs incl. through formula-on-formula and formula-on-roll-up | unit | same file, `describe("RollupRegistry watched set")` | Wave 0 |
| D-05 rounding | 3 children of 0.3333 with scale-2 formula sum to 1.00 not 0.9999; MIN/MAX use rounded values | integration | `rollups-formula.test.ts` | Wave 0 |
| SC2 backfill | rows exist, formula roll-up column added in a later `migrate`, engine `backfillFormulaRollups()` fills it once, lower chain level first, no parent hooks fire (executor log empty); marker row written | integration | `rollups-formula.test.ts` `describe("backfill")` | Wave 0 |
| SC2 silent | second `migrate` has no `UPDATE`/`CREATE TABLE`/`ALTER`; second `backfillFormulaRollups()` returns `[]` and executes no `UPDATE` (spy on `pool.query` or count statements) | integration | `packages/schema/src/migrate.test.ts` (migrate side, new `it` in the `roll-up backfill` describe), `rollups-formula.test.ts` (engine side) | extend / Wave 0 |
| crash recovery | marker absent but column present -> backfill redone | integration | `rollups-formula.test.ts` (delete the marker row, rerun) | Wave 0 |
| reset | `dropRollupBackfills` removes only this org's rows | integration | `packages/schema/src/backfills.test.ts` | Wave 0 |
| SC3 | cross-object path, `NOW`/`TODAY`/`TIMENOW`, `$User`, `$Profile`, `$Setup`, `$Api` (and `$Organization`, `$UserRole`, `$RecordType`) formula: load does not throw, exactly one `UNSUPPORTED:rollup-formula <Parent>.<Field>: ...` per roll-up, field absent from `schema.getField`, from `migrate` columns and from SOQL (`INVALID_FIELD`); chain names the inner formula; unrelated roll-ups still load | unit + integration | `packages/formula/src/rollup-admission.test.ts`; SOQL assertion in `rollups-formula.test.ts` via `runQuery` | Wave 0 |
| SC3 `--strict` | warning counts under `orglet check --strict` (diagnostic is in `BuildResult.warnings`) | unit | `rollup-admission.test.ts` asserts `warnings` and `diagnostics` stay 1:1 | Wave 0 |
| SC4 | formula->roll-up->formula cycle across two master-detail objects reports `UNSUPPORTED:rollup-cycle` with the full path, skips every roll-up on it, terminates | unit | `rollup-admission.test.ts` | Wave 0 |
| D-02 order | formula declared before the formula it reads evaluates correctly in `project()` | unit | `packages/engine/src/formulas.test.ts` (extend) | extend |
| SQL | derived-table SQL shape, `round()` scale, param order, filter on formula column, no `columnName` use for virtual fields | unit (no DB) | `packages/schema/src/rollup.test.ts` (extend) | extend |
| Regression | existing roll-ups and acme unchanged | full | `pnpm test`, `bash conformance/run-all.sh` | exists |

### Sampling Rate
- **Per task commit:** the single test file the task touches (`pnpm vitest run <file>`), pglite only.
- **Per wave merge:** `pnpm vitest run packages/metadata packages/schema packages/formula packages/engine` + `pnpm build` + `pnpm lint`.
- **Phase gate:** `pnpm test` green, and once with `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet` (after `pnpm db:up`) to cover the Postgres-vs-pglite date/array parameter difference (Pitfall 6); `conformance/run-all.sh` green.

### Wave 0 Gaps
- [ ] `packages/formula/src/rollup-admission.test.ts` - SC1 admission, SC3, SC4, `--strict` invariant
- [ ] `packages/engine/src/rollups-formula.test.ts` - SC1 recompute, rounding, SC2 backfill/silence/crash, SOQL `INVALID_FIELD`
- [ ] `packages/schema/src/backfills.test.ts` - marker helpers, per-org isolation
- [ ] Update `packages/metadata/src/build.test.ts` (~L568-580), `packages/metadata/src/rollup.test.ts` (formula gates) - see Pitfall 8
- [ ] Extend `packages/schema/src/rollup.test.ts`, `packages/schema/src/migrate.test.ts`, `packages/engine/src/formulas.test.ts`
- Framework install: none.

## Open Questions

1. **D-09 "formulas stay" vs a skipped roll-up that a formula reads.**
   - Known: removing the roll-up deletes the field the formula references, so the formula fails compile (`FormulaCompileError` with `missing`) and is skipped with its own `UNSUPPORTED:formula` warning.
   - Unclear: whether the user wants the formulas kept at the cost of keeping a roll-up.
   - Recommendation: keep D-06/D-09 for roll-ups (remove all on the cycle) and accept the secondary formula warnings, set the cycle diagnostic first so the order reads cause-then-effect; update D-09's wording in the plan ("formulas that do not read a skipped roll-up stay"). Confirm with the user in plan review.
2. **Formula-on-formula self/mutual cycles** (no roll-up involved): unknown whether `compileFormula`/sigha rejects them. Recommendation: add a one-test probe in Wave 0 (`F1 = F2 + 1`, `F2 = F1 + 1`); the topological sort must tolerate residual cycles regardless.
3. **Datetime array parameter format** on pglite vs Postgres (`+0000`). Recommendation: test early; normalise to `Z` if it fails.
4. **Rounding rule in the platform** is undocumented in found sources; D-05 is an orglet choice. Recommendation: comment it as such, no claim of platform parity.
5. **`volatileReasons` for D-08 wording (`uses TODAY()`).** `dependencies` does not record which function made a formula volatile. Recommendation: add an optional `volatileReasons: string[]` to `FormulaDependencies` in `compile.ts` (additive; `dependencies.test.ts` toEqual assertions need updating) or accept the generic wording.
6. **Memory of one-shot backfill `unnest`** on very large child tables: accepted by D-15; note in PROJECT.md Known gaps (required by D-15).

## Project Constraints (from CLAUDE.md)

- Build only from public Salesforce docs and open-source SDK source; never diff against a real org (Developer MSA).
- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), Node 22, pnpm 10+, Postgres 16, Fastify 5, vitest; ESM; relative imports end in `.js`; `import type` for type-only (ESLint error); one barrel `src/index.ts` per package with explicit named exports (values and types listed separately, no `export *`).
- Every source file opens with a `/** ... */` block explaining why it exists; comments explain Salesforce-specific reasoning only.
- Errors: `UNSUPPORTED:<area>` convention is mandatory for anything not implemented; build messages through `pushDiagnostic`; REST errors via `apiError`/`sendErrors` (not touched here).
- Existing conformance suites must stay green; `examples/acme` unchanged.
- Only Level 1 data in Claude context; no Tele2 names in repo artifacts (real-org findings only as generic Salesforce areas).
- Test names state the invariant (e.g. `formula_rollup_follows_a_field_only_the_formula_reads`).
- Git: repo-local identity Johan Karlsteen <johan@karlsteen.com>; outward-facing actions confirmed first; work goes through GSD commands.
- No project skills directory exists.

## Sources

### Primary (HIGH confidence)
- Repository code read in full or in the relevant ranges: `packages/metadata/src/rollup.ts`, `build.ts` (L395-405, L595-720), `diagnostics.ts`, `schema.ts`; `packages/schema/src/rollup.ts`, `migrate.ts`, `columns.ts`, `prefixes.ts` (L225-318), `internal.ts`, `index.ts`; `packages/formula/src/compile.ts` (L40-135, L360-401), `evaluate.ts`, `values.ts`; `packages/engine/src/rollups.ts`, `formulas.ts`, `engine.ts` (L60-130, L255-300, L540-700), `store.ts`, `parents.ts`; `packages/cli/src/main.ts` (L40-200); tests `metadata/src/build.test.ts`, `schema/src/migrate.test.ts`, `engine/src/rollups.test.ts`, `engine/src/formula-globals.test.ts`; `.planning/research/ARCHITECTURE.md` §3, `PITFALLS.md` R1.

### Secondary (MEDIUM confidence)
- Salesforce Help search results quoting "Create a Roll-Up Summary Field" - https://help.salesforce.com/s/articleView?language=en_US&id=platform.fields_defining_summary_fields.htm&type=5 (page itself not renderable by WebFetch; text obtained via search excerpts)
- Salesforce Help "Roll-Up Summary Field" - https://help.salesforce.com/s/articleView?language=en_US&id=platform.fields_about_roll_up_summary_fields.htm&type=5
- Secondary explanations agreeing on the cross-object / NOW / TODAY restriction: https://www.salesforceben.com/salesforce-cross-object-formulas-vs-roll-up-summary-fields/ , https://trailhead.salesforce.com/it/content/learn/projects/improve-data-quality-for-a-recruiting-app/formula-roll-up-summary-fields

### Tertiary (LOW confidence)
- Rounding-before-aggregation behaviour, `$User`/`$Setup`/`$Api` handling, roll-up-over-formula-over-roll-up: no public source found; reasoning only.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies.
- Architecture: HIGH for code-fact-driven parts (post-pass need, derived table, marker, declaration-order bug); MEDIUM for datetime array params until tested.
- Salesforce rule set: MEDIUM (restriction subset documented via excerpts), rounding LOW.
- Pitfalls: HIGH (verified against code).

**Research date:** 2026-10-24
**Valid until:** 2026-11-23 (stable internal code; re-check if Phase 12/14 code changes `FormulaDependencies` or `BuildResult`)
