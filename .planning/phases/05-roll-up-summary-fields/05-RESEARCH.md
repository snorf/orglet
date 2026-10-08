# Phase 5: Roll-Up Summary Fields - Research

**Researched:** 2026-10-09
**Domain:** SFDX `Summary` metadata parsing and resolution, app-side aggregate recompute in the DML pipeline, schema backfill, describe flags
**Confidence:** MEDIUM-HIGH (code facts verified by reading and by running the XML parser; metadata shapes verified against ~35 real open-source `Summary` field files plus the jsforce Metadata API schema; filter-operator semantics and several edge behaviours are MEDIUM/LOW and flagged individually)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Recomputing a roll-up runs the parent's own validation rules on the recomputed row and the parent's before/after hooks through the existing `TriggerExecutor` seam (inert today, no executors are registered). A parent validation failure fails the child record(s) that triggered it with `FIELD_CUSTOM_VALIDATION_EXCEPTION` carrying the parent rule's message, exactly as the platform propagates a parent failure to the detail save.
- **D-02:** Order of execution: recompute happens after the child's own after-hooks (Salesforce order of execution), gated on `!importMode` like every other post-write step, and then runs the parent's before/after hooks around the parent `UPDATE`.
- **D-03:** Granularity: one recompute per affected parent after the child write loop, not one per child. Each parent's recompute (one batched aggregate `UPDATE` per roll-up field for that parent set, `LEFT JOIN` so a parent whose last matching child left is zeroed) runs inside its own nested savepoint. If the parent fails (rule or hook), that parent's savepoint is rolled back and every child in the batch that points at that parent (old or new FK) is rolled back and gets the error; other children and other parents stay committed. Partial success therefore reflects only the children that actually committed (ROADMAP success criterion 3).
- **D-04:** Empty parent (no matching non-deleted children): COUNT and SUM are `0`, MIN and MAX are `null`. New parent rows get these values at insert (in `DmlEngine.defaults()`), not only after the first child.
- **D-05:** Master-detail relationships (`type: MasterDetail`) are accepted. In addition, exactly the three relationships Salesforce documents as roll-up capable without master-detail are whitelisted: `Opportunity.AccountId` (roll-ups on Account), `OpportunityLineItem.OpportunityId` (on Opportunity) and `CampaignMember.CampaignId` (on Campaign). Any other non-master-detail foreign key fails metadata load with a clear error naming the field and the rule. If a whitelisted child object is not in the baseline, the field degrades per D-07 instead.
- **D-06:** An unknown or unsupported `summaryFilterItems` operation, or MIN/MAX over a field type the platform does not allow (anything but Number, Currency, Percent, Date, DateTime), does not create the field: warn `UNSUPPORTED:rollup-filter` / `UNSUPPORTED:rollup-type` and skip it. Never compute a roll-up with a filter silently dropped.
- **D-07:** An unresolvable child object or child field (`summarizedField` / `summaryForeignKey` pointing outside the schema) warns `UNSUPPORTED:rollup-target` and skips the field, the same degrade pattern as `UNSUPPORTED:reference-target` in phase 3.
- **D-08:** Roll-up over a lookup that is neither master-detail nor whitelisted (D-05) is the one hard failure (ROLL-02), everything else degrades with a warning.
- **D-09:** `orglet up --import` keeps the roll-up values supplied by the source org as-is (import mode already writes read-only stored fields directly) and performs no recompute. The org's value is the truth for imported data.
- **D-10:** When `migrate()` adds a new roll-up column to an org that already has rows, it backfills that column once with a full recompute for that field. No new CLI command in this phase.

### Claude's Discretion
- Exact shape of `RollupDef`, `RollupRegistry` and `rollups.ts` (research proposes a module parallel to `formulas.ts`, indexed by child object).
- Filter operator semantics for each documented `summaryFilterItems` operation, including field-to-field `valueField` comparisons, and date-literal handling where the platform allows it.
- How multi-level chains recurse (recompute of a parent that is itself a detail triggers its grandparent) and the recursion guard.
- Fixture design in `examples/acme` (an Account <- Project__c <- Milestone__c master-detail chain already exists) and in-memory `OrgSchema` fixtures for edge cases (phase 4 D-13 pattern).
- Describe shape beyond `createable: false`, `updateable: false`, `calculated: true` (ROLL-07).

### Deferred Ideas (OUT OF SCOPE)
- `orglet rollup --recompute [Object.Field]` CLI command for manual recomputation after import or data repair (D-10 chose migrate-time backfill only).
- Recomputing roll-ups after `orglet up --import` (D-09 keeps org values).
- Reviewed-not-folded todos: "Narrow baseline OwnerId referenceTo per object", "Reword ROADMAP phase 7 ...", "Support Relationship:Object.Field colon syntax for polymorphic formula references".
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ROLL-01 | `Summary` fields load from SFDX (`summarizedField`, `summaryForeignKey`, `summaryOperation`, `summaryFilterItems`); parent field typed Number for COUNT, summarized field's type for SUM/MIN/MAX | "Metadata shape" (verified element names, real samples), "Parsing pitfall" (`value` parses as array), "Type resolution", build.ts second pass design |
| ROLL-02 | Roll-up over a lookup (not master-detail) fails metadata load with a clear error | D-05 whitelist verified against baseline JSON (all three are plain `Lookup`), hard-failure rule in the resolution pass |
| ROLL-03 | COUNT/SUM/MIN/MAX with documented filter operators incl. field-to-field, over non-deleted children | "Filter semantics" table, SQL builder design (correlated subqueries, `FILTER`-free), tokenizer rules for comma lists and quoting |
| ROLL-04 | Recompute in the same transaction on child insert/update(incl. filter-only)/delete/undelete/reparent, old and new parent | "Affected-parent derivation", retry-loop design (Pattern 2), call sites |
| ROLL-05 | Recompute in the app-side pipeline after child after-hooks, parent rules and hooks run | Order-of-execution quote, extraction of `runValidationRules`, `runHooks` reuse |
| ROLL-06 | Multi-level chains recompute upward without infinite recursion; partial success reflects committed children | Chain propagation with blame carry-through, load-time cycle detection, depth cap, retry loop |
| ROLL-07 | Read-only via REST/Bulk, describe `createable:false`, `updateable:false`, `calculated:true` | `readOnly()` in build.ts, `coerceRecord` already enforces; one-line describe change at `describe.ts:111` |
| ROLL-08 | Stored column, selectable/filterable/sortable in SOQL | No schema/soql change needed (verified `isVirtual`/`sqlTypeFor`/`expr()` default branch); test only |
| ROLL-09 | DE retrieve loads with zero `UNSUPPORTED:field-type` for `Summary` | Remove skip at `sfdx.ts:162`; DE field shape (MAX over `CreatedDate`, picklist `equals`) supported |
</phase_requirements>

## Summary

Roll-ups need no new `FieldType` and no new DDL: a `Summary` field resolves at metadata build time into an ordinary `Number`/`Currency`/`Percent`/`Date`/`DateTime` `FieldDef` carrying a new `rollup?: RollupDef` marker, made read-only with the existing `readOnly()` helper. That gives ROLL-07 (coerce already rejects client writes) and ROLL-08 (stored column, SOQL default branch) essentially for free; the real work is (a) parsing and resolving the metadata strictly, (b) one SQL builder, shared by migrate backfill and the engine, and (c) the recompute orchestration inside `saveBatch`/`deleteBatch`/`undeleteBatch`.

Three findings change the project-level architecture notes. First, in the SFDX XML parser the repeated-element list contains `value`, so `<value>True</value>` inside `summaryFilterItems` parses to `["True"]` and `<value/>` to `[""]` (verified by running fast-xml-parser 5.11.1); the existing `str()` helper returns `undefined` for arrays, so filter items need a dedicated reader or blank/boolean filters will silently vanish. Second, Salesforce's own Order of Execution page states that the parent record "goes through the save procedure" after a roll-up update and that this continues to the grandparent, which confirms D-01 and contradicts the one-level-only advice in PITFALLS.md Pitfall 3 (ROLL-06 and the official doc win). Third, D-03's "nested savepoint per parent" cannot by itself undo already-released child writes; the cleanest way to make "failed parent => its children are rolled back, others committed" true is a batch-level savepoint with a bounded retry loop (Pattern 2 below), which terminates because each pass marks at least one more work item failed.

The roadmap research flag (reparent and undelete triggers, Help article `000391766`) is resolved only partially: article 000391766 is the "force a mass recalculation" article and does not state the triggers. The triggers are supported by secondary sources and by the Order of Execution doc (any DML on the detail). Implement them as required; record in VERIFICATION that no primary quote exists.

**Primary recommendation:** Resolve `Summary` into a plain stored `FieldDef` with `rollup` in a second pass of `buildOrgSchema`; put the filter/aggregate SQL builder in `@orglet/schema` (so `migrate()` backfill and the engine share it); orchestrate recompute in a new `packages/engine/src/rollups.ts` called from the three batch methods inside a batch-savepoint retry loop.

## Standard Stack

No new dependencies. Everything is existing, already-pinned tooling.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| fast-xml-parser | 5.11.1 (installed, verified in `node_modules/.pnpm`) | parse `Summary` field XML | already used by `packages/metadata/src/xml.ts` |
| pg | 8.23.0 | run recompute SQL | only driver; type parsers in `db.ts` turn `numeric`/`int8` into `Number`, `date` into string, `timestamptz` into Salesforce-format string |
| vitest | 3.2.7 | tests on embedded pglite (`test/db.ts`) or real Postgres | project standard |
| @electric-sql/pglite | 0.5.8 | default test DB | verified: correlated subqueries, `ANY($n::text[])`, savepoints all already used elsewhere |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@orglet/soql` `dateLiteralRange` | in-repo | date literals as ranges | only if date-literal filters are enabled (recommended deferred, see Filter semantics) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `UPDATE ... FROM (SELECT ... GROUP BY) LEFT JOIN` (ARCHITECTURE.md) | correlated scalar subqueries `SET col = COALESCE((SELECT SUM(x) FROM child WHERE fk = p.id AND isdeleted=false AND <filter>), 0)` | Same result, no LEFT JOIN zero-row subtlety, one shape for both targeted recompute and full backfill, composes with several roll-ups per statement; FK columns are already indexed (`ddl.ts` indexes every Lookup/MasterDetail). Recommended. |
| Per-child recompute | Per-parent after loop | locked by D-03 |
| Postgres triggers | app-side | forbidden (CLAUDE.md, ARCHITECTURE Anti-Pattern 1) |

**Installation:** none. Node 22 is required to run tests (this shell defaults to Node 18.20.8; `nvm use 22`, v22.23.3 is installed; pnpm is not on PATH in this shell, use corepack under Node 22).

## Architecture Patterns

### Recommended Project Structure
```
packages/metadata/src/
  types.ts       # + RollupOperation, RollupFilterOperation, RollupFilterDef, RollupDef; FieldDef.rollup?
  sfdx.ts        # parseField: stop skipping Summary; SourceField.summarizedField/summaryForeignKey/summaryOperation/summaryFilterItems
  rollup.ts      # NEW: pure resolution (resolveRollups) + value tokenizer; called from build.ts
  build.ts       # partition Summary out of fromSourceObject / standard-object loop; resolution pass before new OrgSchemaImpl
packages/schema/src/
  rollup.ts      # NEW: rollupSelectSql / rollupBackfillSql (pure, uses tableName/columnName/quote)
  migrate.ts     # backfill newly added roll-up columns (D-10)
  index.ts       # export the builders
packages/engine/src/
  rollups.ts     # NEW: RollupRegistry, affectedParents, recomputeParents orchestration
  engine.ts      # defaults(), three call sites, runValidationRules extraction, batch-savepoint retry loop
packages/api/src/describe.ts  # calculated: f.formula !== undefined || f.rollup !== undefined
examples/acme/...             # Summary fixtures (see Validation Architecture)
```

Why the SQL builder lives in `@orglet/schema`, not `@orglet/engine`: `migrate()` (schema package) must backfill (D-10) and cannot import engine (engine depends on schema). The builder only needs `FieldDef.rollup` (metadata) and the naming helpers in `columns.ts`, so it fits the schema layer with zero new dependencies and is unit-testable without a database.

### Metadata shape (verified)

Element names (jsforce Metadata API `schema.ts` from the WSDL: `summarizedField?: string`, `summaryFilterItems: FilterItem[]`, `summaryForeignKey?: string`, `summaryOperation?: string`; `FilterItem { field: string; operation: string; value?: string; valueField?: string }`) and real files (NPSP, survey-force, Summit Events, b2c-crm-sync, PMT, ~35 files sampled):

```xml
<CustomField xmlns="http://soap.sforce.com/2006/04/metadata">
    <fullName>Orders_Most_Advanced_Date__c</fullName>
    <label>Orders Most Advanced Date</label>
    <summarizedField>Store_Supply_Order__c.Delivery_Date__c</summarizedField>
    <summaryFilterItems>
        <field>Store_Supply_Order__c.Order_Status__c</field>
        <operation>notEqual</operation>
        <value>Completed, Cancelled</value>
    </summaryFilterItems>
    <summaryForeignKey>Store_Supply_Order__c.Store__c</summaryForeignKey>
    <summaryOperation>max</summaryOperation>
    <type>Summary</type>
</CustomField>
```

Facts from the samples (HIGH for shape, MEDIUM for semantics):
- All three references are dotted `ChildObject.Field`, including the filter `field`.
- `summaryOperation` is lowercase `count|sum|min|max` (13 sum, 18 count, 3 min, 1 max seen). `avg` does not exist. Parse case-insensitively.
- COUNT has no `summarizedField`.
- Filters are optional and repeatable; multiple items are ANDed.
- Observed `operation` values in the wild: `equals` (30), `notEqual` (8). No sample of `valueField`, `lessThan` etc. was found (GitHub code search returned none), so those rest on the Metadata API `FilterOperation` enumeration only.
- Value encodings seen: checkbox `True` / `False` (capitalised); blank test as empty element `<value/>` (NPSP: "notEqual blank" and "equals blank"); picklist/text as the label text; **comma-separated multi-values** with `equals`/`notEqual` (`Completed, Cancelled`), and double-quote wrapping to protect a comma (`"Completed", "Closed, not Completed"`).
- Summary field XML in these samples carries no `precision`/`scale`; type info must come from the summarized child field. Parse `precision`/`scale` if present (already generic in `parseField`) and prefer them.
- `FilterOperation` enumeration (Metadata API docs, via NamedFilter page, MEDIUM): `equals, notEqual, lessThan, greaterThan, lessOrEqual, greaterOrEqual, contains, notContain, startsWith, includes, excludes, within`. The roll-up filter UI exposes the first nine; `includes`/`excludes` are multi-select-picklist operators and multi-select picklists cannot be used in roll-up filters; `within` is geolocation. Support the first nine; anything else is `UNSUPPORTED:rollup-filter` (D-06).

### Parsing pitfall (verified by execution)

`xml.ts` `REPEATED` contains `value`. Running the project's parser options on the sample above gives:

```json
{"summaryFilterItems":[{"field":"A.B","operation":"equals","value":["True"]},{"field":"A.C","operation":"notEqual","value":[""]}]}
```

`str(node, "value")` returns `undefined` for an array. Add a small `filterValue(node)` reader that unwraps `[x]` (join multiple with `,`), and treat an absent `value` and `""` identically as "blank". Test it with `True`, `<value/>`, and a two-token value. Also: a single `<summaryFilterItems>` parses as an object, several as an array; use the existing `list()` helper.

### Type resolution (ROLL-01)

| Operation | Allowed child field types | Parent field |
|-----------|---------------------------|--------------|
| COUNT | no field (any records) | `Number`, precision 18, scale 0 |
| SUM | Number, Currency, Percent | child's type, precision/scale copied |
| MIN / MAX | Number, Currency, Percent, Date, DateTime | child's type (Date/DateTime included; MAX over `CreatedDate` works because system fields are in `obj.fields` as `DateTime`) |

Rules: SUM over a non-numeric type gets the same `UNSUPPORTED:rollup-type` warning as D-06's MIN/MAX case (D-06 names MIN/MAX only; extending to SUM and to unknown operations is a documented small extension, no new area). The summarized or filter field must be a stored field (`!isVirtual`, no `formula`); a formula/compound summarized field is `UNSUPPORTED:rollup-type`, a formula filter field is `UNSUPPORTED:rollup-filter`. A summarized field that is itself a roll-up is allowed (needed for chains), so resolution must run to a fixpoint (see below). Use `precision = max(child precision, 18)` capped at 18 only if the child declares none; otherwise copy exactly and accept numeric overflow as a Postgres error (flag, unlikely).

COUNT parent precision: Salesforce metadata files carry none; use 18/0. Describe then reports `double` for custom Number (`describeType`: `int` only for non-custom), which is acceptable.

### Resolution pass in `buildOrgSchema` (D-05..D-08)

Current flow: `fromSourceField` is called for every `SourceField` (custom objects via `fromSourceObject`, `__c` fields on standard objects at `build.ts` ~line 440). `Summary` must not reach it (there is no matching `FieldType`; `SourceField.type` should become `FieldType | "Summary"` or Summary should be a separate list on `SourceObject`).

Recommended: in `fromSourceObject` and the standard-object loop, filter `type === "Summary"` out and collect `{ objectName, sf }` into `pending`. After all objects are registered and before `new OrgSchemaImpl`, run `resolveRollups(objects, pending, warnings)`:

1. For each pending, split dotted references (`child`, `fkField`, optional `summarizedField`). Child object lookup is case-insensitive; unresolved => warn `UNSUPPORTED:rollup-target <Parent>.<Field> ...` and drop (D-07). The FK must exist on the child, and its `referenceTo` must include the owning parent object, else `rollup-target`.
2. FK relationship check (D-05/D-08): accept `fk.type === "MasterDetail"`, or `(child, fk)` in the whitelist `{Opportunity.AccountId, OpportunityLineItem.OpportunityId, CampaignMember.CampaignId}` (case-insensitive). Anything else: `throw new Error("<Parent>.<Field>: roll-up summary over lookup <Child>.<Fk> is not allowed; ...")` (the single hard failure). Order matters: check target resolvability first, then the lookup rule, so an unresolvable child degrades and a resolvable non-MD lookup fails.
3. Operation, summarized-field type, filter operations and value shape checks => D-06 warnings, field dropped.
4. Chains: iterate until no progress; a pending roll-up whose summarized field is another pending roll-up waits. If the loop stalls with items left, they form a dependency cycle: warn `UNSUPPORTED:rollup-cycle` and drop them (cheap; cycles need cyclic master-detail so this is defensive).
5. Build the `FieldDef` with `baseField(name, label, resolvedType, true)`, then `readOnly(f)`, `f.nillable = true`, `f.defaultedOnCreate = false`, `f.rollup = def`, push onto `obj.fields`. Warnings are plain strings in the existing `warnings` array; the engine does not need its own roll-up warnings, which also keeps the existing `expect(engine.warnings).toEqual([])` assertion in `engine.test.ts` valid.

Verified baseline facts for D-05: `Opportunity.AccountId`, `OpportunityLineItem.OpportunityId` (`nillable:false`, `updateable:false`) and `CampaignMember.CampaignId` (`nillable:false`, `updateable:false`) are all present in `packages/metadata/standard/objects/*.json` as plain `Lookup`, with child relationship names `Opportunities`, `OpportunityLineItems`, `CampaignMembers`. So the whitelist is exercised, and the "child not in baseline degrades" branch needs an in-memory schema test. Evidence that Salesforce documents these three: Help "Roll-Up Summary Field" overview (search extraction, MEDIUM): roll-ups on Opportunities from opportunity products, on Accounts from related opportunities, on Campaigns from campaign member status/custom fields. The Help page itself is JavaScript-rendered and could not be fetched directly, so the wording was not read verbatim.

`FieldDef.rollup` suggested shape (Claude's discretion):

```ts
export type RollupOperation = "COUNT" | "SUM" | "MIN" | "MAX";
export type RollupFilterOperation = "equals" | "notEqual" | "lessThan" | "greaterThan" | "lessOrEqual" | "greaterOrEqual" | "contains" | "notContain" | "startsWith";
export interface RollupFilterDef {
  field: string;                 // child field API name (resolved, canonical casing)
  operation: RollupFilterOperation;
  values: string[];              // tokenised literal(s); [] means "blank"
  valueField?: string;           // child field API name for field-to-field comparison
}
export interface RollupDef {
  childObject: string;           // canonical API name
  foreignKey: string;            // child FK field API name
  summarizedField?: string;      // absent for COUNT
  operation: RollupOperation;
  filters: RollupFilterDef[];
}
```

### Filter semantics (ROLL-03)

Public docs give the operator names and the list of disallowed filter field types (long text, multi-select picklist, description, cross-object formula, lookup; Help search extraction, MEDIUM) but not SQL-level semantics. The table is the recommended, testable interpretation; items marked LOW are assumptions the planner should record as such.

| Operator | Types | SQL (col = child column) | Confidence |
|----------|-------|--------------------------|------------|
| equals | all stored | text/picklist: `lower(col) = ANY($n::text[])` (tokens lowercased, OR over tokens); number: `col = ANY($n::numeric[])`; date/datetime: `col = $n::date`/`::timestamptz`; checkbox: `col = $n::boolean`; blank: `col IS NULL` (text: `(col IS NULL OR col = '')`) | MEDIUM (multi-token OR and blank seen in real files; case-insensitive text LOW) |
| notEqual | same | `NOT (<equals>)` with NULL counted as not equal: `(col IS NULL OR NOT (...))`; blank: `col IS NOT NULL` (text also `<> ''`) | MEDIUM for blank, LOW for NULL-inclusion |
| lessThan / greaterThan / lessOrEqual / greaterOrEqual | number, date, datetime, (text) | `col < $n::type` etc.; NULL never matches | MEDIUM |
| contains / notContain / startsWith | text, picklist | `col ILIKE '%'||esc($n)||'%'` over tokens (OR), `notContain` negates (AND of NOT) | LOW on multi-token semantics |
| `valueField` | same column type family | `col <op> other_col` (no parameters); reject at load if types differ | LOW (no public sample; ROLL-03 requires it) |

Value tokenizer (pure function in `packages/metadata/src/rollup.ts`): split on commas outside double quotes, trim, strip enclosing quotes; empty after trim => blank. Booleans accept `True/False` case-insensitively; numbers must pass `Number.isFinite`; dates must match `YYYY-MM-DD`, datetimes ISO 8601 (reuse the regexes in `coerce.ts` or duplicate the pattern). Anything unparsable is `UNSUPPORTED:rollup-filter` at load (D-06). Date literals (`TODAY`, `LAST_N_DAYS:n`) are not verified for roll-up filters in public docs; recommended: warn-skip with `UNSUPPORTED:rollup-filter date literal ...` in this phase (discretion item), record as deferred. If the planner wants them, resolve with `dateLiteralRange` at recompute time (value drifts with time because nothing recomputes at midnight; same on the platform).

### SQL builder (`packages/schema/src/rollup.ts`)

One statement shape serves recompute-on-ids and full backfill:

```sql
-- targeted: returns the new values for the affected parents (read-only SELECT)
SELECT p."id" AS "id",
       (SELECT COUNT(*) FROM "org"."milestone__c" c
         WHERE c."project__c" = p."id" AND c."isdeleted" = false AND lower(c."status__c") = ANY($2::text[])) AS "r0",
       COALESCE((SELECT SUM(c."budget__c") FROM "org"."project__c" c WHERE c."account__c" = p."id" AND c."isdeleted" = false), 0) AS "r1",
       (SELECT MAX(c."createddate") FROM ... ) AS "r2"
FROM "org"."account" p
WHERE p."id" = ANY($1) AND p."isdeleted" = false
```

```sql
-- backfill (migrate): one UPDATE per newly added roll-up column
UPDATE "org"."account" p SET "total__c" = COALESCE((SELECT SUM(...) ...), 0)
```

Notes: COUNT needs no `COALESCE` (returns 0); SUM wraps in `COALESCE(..., 0)`; MIN/MAX stay null (D-04). Parameter typing uses explicit casts so pglite and Postgres behave identically. All identifiers go through `quote()/tableName()/columnName()`; no value is ever interpolated. Return `{ sql, params, columns }` so engine and tests can assert on the generated SQL without a DB (mirrors `compile.test.ts` style). Batched across all roll-ups of the same parent object that watch the same child object. Result values come back typed by `db.ts` parsers (numbers, Salesforce datetime strings), which is exactly what `store.update` takes.

SELECT-first plus app-side rules plus explicit write is deliberate: validation rules and before-hooks need the prospective parent row (with new roll-up values) before the write, and a failing parent must not leave a half-applied row. D-03's "batched aggregate UPDATE" is honoured as: one batched aggregate statement per (parent object, child object), then one `store.update` per parent that passes, each inside its own nested savepoint together with the after-hooks (so a hook that writes can be undone per parent). Flag this to the planner as the one place the implementation form differs from D-03's literal wording while preserving its behaviour; if the planner wants the literal form, run `UPDATE ... RETURNING *` for the whole set inside a group savepoint, evaluate rules on the returned rows, and on any failure `ROLLBACK TO` and re-run the UPDATE for the passing parents only.

### Affected-parent derivation (ROLL-04)

`RollupRegistry` (built in the `DmlEngine` constructor beside `FormulaRegistry`): `byChild: Map<lowerChildName, Binding[]>`, where a binding holds the parent `SObjectDef`, roll-up `FieldDef`, resolved FK `FieldDef`, and `watched: Set<string>` = `{fk, summarizedField, ...filter fields, ...valueFields}` (canonical names).

Per child work item:

| Path | Parents to recompute | Source |
|------|----------------------|--------|
| insert | `next[fk]` | live work only (no errors, written) |
| update | `old[fk]` and `next[fk]` when they differ (reparent: both); `next[fk]` when any watched field is a key of `changes` | over-approximate on key presence; recompute is idempotent and unchanged values are skipped, so a false trigger is cheap and a missed trigger is a bug (PITFALLS 2) |
| delete | `old[fk]` | after `setDeleted` and after-hooks |
| undelete | `old[fk]` | after `setDeleted(false)` |

Skip null/undefined parent ids. Collect `Map<parentObj, Map<parentId, Set<Work>>>` where the `Set<Work>` is the blame list (D-03: every child pointing at that parent as old or new FK, plus filter-only changers).

Facts from the code that matter: in `saveBatch` `w.next` is the full row and `w.changes` the client delta (plus hook/platform-rule changes); in `deleteBatch`/`undeleteBatch` `w.old` is the row. `attachOld` loads with `includeDeleted = true`, so delete/undelete have `old[fk]`.

Cascade recursion trap (verified in `deleteBatch`): deleting a parent recursively calls `deleteBatch` for children before `setDeleted` on the parent, so an inner roll-up recompute would run (and could fail a parent validation rule) against a parent that is itself being deleted. Pass a `deleting: ReadonlySet<string>` (ids being deleted up the stack) into the recursive call and skip those parents. `undeleteBatch` sets the parent live first, so the inner recompute is correct there; the outer one is idempotent.

### Pattern 1: parent recompute step (rules, hooks, write)

For each parent object, one SELECT (above) for all affected ids, then per parent id:

1. Skip if the parent row is missing/deleted (`WHERE ... isdeleted = false` already omits it) or the new values deep-equal the current values for all roll-up columns (documented assumption, LOW: the platform is not documented to re-save an unchanged parent; skipping avoids pre-existing rule violations on untouched parents blocking child saves).
2. Build the parent `Work` `{ index, errors: [], changes: newValues, old: current, next: {...current, ...newValues}, id }`. Do not stamp `LastModifiedDate` (assumption, LOW: roll-up recalculation is not documented to change it; see Open Questions).
3. `runHooks(session, parentObj, "update", "before", [pw])`, fold hook changes into `changes` like `saveBatch` does, then `runValidationRules` (extracted from `saveBatch`, see below) on `[pw]`.
4. If `pw.errors` is non-empty: blame every `Work` in the parent's blame set with `Errors.customValidation(message)` (copy the message, no `fields`, because `errorDisplayField` names a parent field). Do not write.
5. Else `SAVEPOINT rollup_<n>`; `store.update(client, parentObj, id, changes)`; after-hooks; on hook error `ROLLBACK TO` and blame as in 4; else `RELEASE`.
6. If parent object is itself a roll-up child (`byChild` has bindings whose `watched` intersects the changed columns, or any binding for it), add its parent ids to the next level with blame set = union of the current blame set. Process levels in a loop with `depth` counter and a `visited` set of `objectName:id:fieldName` per recompute pass; abort with an internal `Error` if `depth > 16` (cycle guard, unreachable after load-time cycle detection). Compare change by roll-up column: only propagate when the parent's value actually changed.

`runValidationRules` extraction: the inline block in `saveBatch` (compile list, `loadParents` for rule parent paths, build `EvaluationContext` with `old`, push `Errors.customValidation`) is reused verbatim for the parent row with `isNew: false`. Extract it as a private method taking `(client, obj, candidates: Work[], operation, globals)`; behaviour for `saveBatch` must be unchanged and is covered by the existing engine tests.

### Pattern 2: batch-savepoint retry loop (makes D-03 and ROADMAP criterion 3 true)

The problem: `saveBatch` writes each child under `SAVEPOINT rec` and releases it. When a parent later fails, you cannot `ROLLBACK TO` an earlier savepoint without also discarding later children's writes. Compensating writes are error-prone (insert -> hard delete, update -> restore old values, delete -> cascade un-delete, undelete -> re-delete, plus every cascade).

Recommended: wrap "write loop + child after-hooks + roll-up recompute" in a retry loop guarded by one savepoint:

```ts
// Source: design for this phase (pattern from saveBatch's existing per-record savepoint)
for (;;) {
  await client.query(`SAVEPOINT rollup_batch`);
  await writeLoop(live());                         // existing per-record "rec" savepoints, unchanged
  if (!this.importMode) await this.runHooks(session, obj, operation, "after", live());
  const failed = this.importMode ? 0 : await this.rollups.apply(...); // marks child Works as failed, returns count of newly failed
  if (failed === 0) { await client.query(`RELEASE SAVEPOINT rollup_batch`); break; }
  await client.query(`ROLLBACK TO SAVEPOINT rollup_batch`);
  await client.query(`RELEASE SAVEPOINT rollup_batch`);
  // failed Works now carry errors, so live() excludes them; loop replays the survivors
}
```

Why it is correct: the final pass has no failures, so the committed state is exactly the surviving children and every parent value was computed from that state (no stale Q after a P failure on a reparent). Why it terminates: each iteration that repeats marks at least one more Work failed, so at most N+1 passes for N children; in practice 1 or 2. Replay safety: Ids, `next`, auto-numbers and before-hook results are computed before the loop and are not recomputed; unique-violation handling stays inside the loop; the after-hook seam runs again for survivors, which is acceptable because hooks are inert today and any DB effects were rolled back. Apply the same wrapper in `deleteBatch` around "cascade + `setDeleted` + after-hooks + recompute" and in `undeleteBatch` likewise; nested recursion works because each level opens its own savepoint (Postgres stacks same-named savepoints; use a counter suffix for readability). Errors that an inner cascade `deleteBatch` pushes onto child works are already propagated to the deleting parent's work by existing code, which then drops out of `live()` on replay.

`allOrNone: true` is unaffected: `run()` rolls back the whole transaction if any work failed.

### Defaults (D-04)

In `defaults()` add, in the same loop that already special-cases AutoNumber/Checkbox: `if (field.rollup) out[field.name] = field.rollup.operation === "COUNT" || field.rollup.operation === "SUM" ? 0 : null`. The early `continue` (`changes[field.name] !== undefined && !== null`) already lets import mode supply the source value (D-09); in import mode a supplied `null` COUNT/SUM becomes 0 (acceptable). `Store.insert` skips `undefined` values, so MIN/MAX nulls are simply omitted. Because `coerceRecord` rejects roll-up keys for non-import callers, `changes` never contains them in normal mode.

### migrate backfill (D-10)

`migrate()` runs everything in one `withTransaction`. Step 1 adds columns via `addColumnSql`. Add after step 1 (so all child columns exist) and still before commit: for every plan column that was just added (`!current` branch) whose `FieldDef.rollup` is set, run the backfill `UPDATE` from `@orglet/schema`'s builder. Order backfills by chain depth ascending (a roll-up over another new roll-up needs the lower one first). The parent table need not be checked for emptiness; an UPDATE over zero rows is a no-op. Backfill uses no hooks or rules (migration semantics, like import). Include the statement in `MigrateResult.statements` so tests can assert it. Known limitation to record: changing the operation or filters of an already-present column does not re-backfill (D-10 scope); that staleness is what the deferred `rollup --recompute` command is for.

`plan.columns` carries `ColumnSpec`, not `FieldDef`; look the field up through `plan.object.fields` (`TablePlan.object` exists) by matching `columnName(field)`.

### Describe and API (ROLL-07)

Single change: `packages/api/src/describe.ts:111` `calculated: f.formula !== undefined` becomes `calculated: f.formula !== undefined || f.rollup !== undefined`; leave `calculatedFormula: f.formula ?? null`. `createable`/`updateable` come from `readOnly()`. REST create/update, composite and Bulk ingest all funnel through `DmlEngine.insert/update/upsert` and `coerceRecord`, which rejects with `INVALID_FIELD_FOR_INSERT_UPDATE` (`Errors.notWritable`); no route code changes. The OpenAPI/SOAP describe paths reuse `describeField`.

### Anti-Patterns to Avoid
- **Postgres triggers for recompute:** forbidden by CLAUDE.md and ARCHITECTURE Anti-Pattern 1.
- **Recompute inside the child's per-record savepoint:** conflicts with D-03 (per-parent after the loop) and recomputes one parent N times.
- **One-level-only cascade (PITFALLS Pitfall 3 advice):** Salesforce's Order of Execution describes parent and grandparent roll-ups; ROLL-06 requires upward chains. Keep the cycle detection and depth cap from that pitfall, drop the one-level cap.
- **Dropping a filter on parse failure:** D-06 requires skipping the whole field with a warning.
- **Stamping `LastModifiedDate` on parent via the shared `saveBatch` update path:** the parent recompute uses its own narrow `store.update`.
- **Adding a `"Summary"` member to `FieldType`:** breaks the exhaustive switch in `packages/formula/src/values.ts` `sfTypeOf` and `describeType`/`sqlTypeFor`; resolve to an existing type.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Read-only enforcement | a roll-up-specific check in routes or Bulk | `readOnly(f)` in build.ts + existing `coerceRecord` `notWritable` | already covers REST, composite, Bulk, upsert; import mode bypass is what D-09 relies on |
| Column naming / quoting | string concatenation of identifiers | `tableName`, `columnName`, `quote` from `@orglet/schema` | 63-byte identifier hashing (`identifier()`) must match the DDL |
| Validation-rule evaluation on the parent | a second rule evaluator | extracted `runValidationRules` using `FormulaRegistry.validationRules` + `loadParents` | rules may reference parent paths and `PRIORVALUE` |
| Hook dispatch | a new hook mechanism | `runHooks(session, obj, "update", timing, works)` | the one seam; Apex/Flow will plug in later |
| Error construction | hand-built `SaveError` objects | `Errors.customValidation(message)` | CLAUDE.md convention |
| Metadata warnings | `console.warn` | strings in `buildOrgSchema`'s `warnings` array | CLI prints them as `warning: UNSUPPORTED:...` |
| SQL string escaping of filter values | manual quoting | positional parameters with explicit casts; escape `%`, `_`, `\` for LIKE tokens | injection and pglite parity |
| Aggregation in JS | loading all children and reducing in Node | the correlated-subquery SQL | correctness over deleted rows, scale |

**Key insight:** every hard part (read-only flags, columns, SOQL, hooks, rules, error shape) already exists; this phase is metadata resolution plus one SQL builder plus orchestration. Resist adding new surface.

## Runtime State Inventory

Not a rename/refactor/migration phase in the sense of the template, but one runtime-state aspect applies and is answered explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Existing orgs (a developer's Postgres) have parent rows but no roll-up column for newly loaded `Summary` fields. | Data migration: D-10 backfill in `migrate()` for newly added columns (code edit in migrate, one-off data effect at first `orglet up`). |
| Live service config | None; orglet is self-hosted, single Postgres. | None, verified by reading architecture. |
| OS-registered state | None. | None. |
| Secrets/env vars | None; no new env vars. | None. |
| Build artifacts | `packages/*/dist` are rebuilt by `pnpm build` (`tsc -b`); new files in four packages need the project references already present. No new package. | `pnpm build` in the phase gate. |

## Common Pitfalls

### Pitfall 1: `value` parses as an array
**What goes wrong:** `str(node, "value")` returns `undefined`; checkbox and blank filters (`True`, `<value/>`) vanish and the roll-up counts every child.
**Why:** `xml.ts` marks `value` as always-array for picklist values.
**How to avoid:** dedicated `filterValue()` reader, unit test with `True`, `<value/>` and `A, B`.
**Warning signs:** a COUNT with a Checkbox filter returning the unfiltered count.

### Pitfall 2: Parent failure strands the other parent of a reparent
**What goes wrong:** child reparented P to Q; P's rule fails, child is rolled back, but Q already counted it.
**How to avoid:** Pattern 2's replay recomputes everything from surviving state; test exactly this scenario.

### Pitfall 3: Cascade delete recomputes a parent that is being deleted
**What goes wrong:** deleting a Project cascades to Milestones whose inner recompute updates (and rule-checks) the Project that is about to be soft-deleted.
**How to avoid:** carry a `deleting` id set through the recursive `deleteBatch`; skip those parents.

### Pitfall 4: Filter-only field change and `changes` semantics
**What goes wrong:** relying on `old[f] !== next[f]` misses hook-changed fields, relying on FK change alone misses `Status` changes.
**How to avoid:** trigger on key presence in `changes` for any watched field (after the before-hook fold-back loop in `saveBatch`); idempotent recompute makes over-triggering harmless.

### Pitfall 5: `isVirtual`/formula checks
**What goes wrong:** a roll-up over a formula child field cannot be filtered or aggregated in SQL (formulas are computed at read time).
**How to avoid:** reject at load (`UNSUPPORTED:rollup-type`/`rollup-filter`).

### Pitfall 6: Roll-up fields on standard objects
**What goes wrong:** `Summary` fields on `Account`/`Opportunity` arrive through the standard-object merge loop, not `fromSourceObject`; handling only the custom-object path misses ROLL-09-style retrieves and the D-05 whitelist cases.
**How to avoid:** partition `Summary` out in both places; test an `Account.X__c` roll-up over a custom master-detail and an `Opportunity.Items_Total__c` roll-up over `OpportunityLineItem`.

### Pitfall 7: Concurrent transactions and lost updates (known limitation)
**What goes wrong:** two transactions inserting children of the same parent each recompute without seeing the other's uncommitted child; Postgres FK checks take `FOR KEY SHARE` on the parent, so upgrading to `FOR UPDATE` late can deadlock.
**How to avoid / scope:** orglet is single-tenant and low-concurrency. Optional hardening: lock affected parent ids (`SELECT ... WHERE id = ANY($1) ORDER BY id FOR UPDATE`) before the child writes, in the same order everywhere. Not required by any success criterion; record as a limitation and do not add unless cheap.

### Pitfall 8: Numeric overflow and precision
**What goes wrong:** SUM of `numeric(16,2)` values into a `numeric(16,2)` parent column can overflow ("numeric field overflow" is a SQL error, surfacing as a 500).
**How to avoid:** copy child scale, set precision 18 when the child's is smaller; document residual risk.

### Pitfall 9: Existing sfdx test expects the skip
`packages/metadata/src/sfdx.test.ts` ("skips roll-up summary fields with an UNSUPPORTED warning") asserts the old behaviour and must be replaced, not left failing.

### Pitfall 10: Unchanged-parent skip is an assumption
Skipping the parent save when no roll-up value changed avoids spurious hook/rule runs but is not documented platform behaviour (LOW). If a parent validation rule is meant to run on every child DML, remove the equality skip; the cost is more rule evaluations and pre-existing violations on untouched parents failing child saves.

## Code Examples

### Reading filter items (handles the array-valued `value`)
```ts
// Source: verified by running the project's fast-xml-parser options (this research)
function readFilterItems(node: XmlNode): SourceFilterItem[] {
  return list(node, "summaryFilterItems").map((n) => {
    const raw = n["value"];
    const value = Array.isArray(raw) ? raw.map((v) => (typeof v === "string" ? v : "")).join(",") : (str(n, "value") ?? "");
    const item: SourceFilterItem = { field: str(n, "field") ?? "", operation: str(n, "operation") ?? "", value };
    const valueField = str(n, "valueField");
    if (valueField !== undefined) item.valueField = valueField;
    return item;
  });
}
```

### Call-site shape in `saveBatch` (after the write loop; D-02 ordering)
```ts
// after existing: if (!this.importMode) await this.runHooks(session, obj, operation, "after", live());
// inside the Pattern 2 retry loop:
const failed = this.importMode ? 0 : await applyRollups(this, client, session, globals, obj, operation, work);
```

### Source references for Salesforce order of execution
Salesforce Apex Developer Guide "Triggers and Order of Execution" (search-extracted text, MEDIUM): "If the record contains a roll-up summary field or is part of a cross-object workflow, Salesforce performs calculations and updates the roll-up summary field in the parent record. The parent record goes through the save procedure. If the parent record is updated, and a grandparent record contains a roll-up summary field ... Salesforce performs calculations and updates the roll-up summary field in the grandparent record. The grandparent record goes through the save procedure." The page also says a recursive save skips the assignment-rules through grandparent-roll-up steps. The page returned HTTP 403 to direct fetch, so the wording comes from the search engine's extraction of the official page.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| PITFALLS: one-level roll-up only | parent and grandparent recompute per Order of Execution | this research | implement upward chain with guard |
| ARCHITECTURE: `UPDATE ... FROM (agg) LEFT JOIN` | correlated scalar subqueries, SELECT-first | this research | simpler, shared with backfill |
| ARCHITECTURE: recompute "inside the same savepoint as the triggering child write" | batch savepoint + replay | this research | satisfies D-03 attribution and criterion 3 |

**Deprecated/outdated:** the Salesforce Metadata/Help pages cited by the roadmap flag: article `000391766` is only about manual force-recalculation.

## Open Questions

1. **Does a roll-up recompute change the parent's `LastModifiedDate`/`SystemModstamp`?**
   - Known: not documented in the pages reachable here. Recommendation: do not stamp (narrowest), assert in a test so it is a conscious choice. LOW.
2. **`notEqual` and NULL.**
   - Recommendation: treat NULL as not equal (included). LOW; no public source. Tested by an explicit case.
3. **Text comparison case sensitivity and multi-token `contains`.**
   - Recommendation: case-insensitive, OR across tokens for `equals/contains/startsWith`, AND-negation for `notEqual/notContain`. LOW.
4. **`valueField` encoding.**
   - No public sample. Accept `Child.Field` and bare `Field`, same table only. LOW.
5. **Reparent and undelete triggers lack a primary-source quote** (roadmap flag). Evidence: Order of Execution (any detail DML), secondary articles stating recalculation on create/update/delete/undelete and both masters on reparent. Implement as specified; note in VERIFICATION.
6. **Date literals in roll-up filters.** Recommended deferral with a warning; planner may lift.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 22 | build, tests (pglite-socket needs Node 19+) | yes via nvm | v22.23.3 installed; shell default is v18.20.8 | `nvm use 22` before any pnpm command |
| pnpm 12.6.0 | scripts | not on PATH in this shell | - | `corepack enable pnpm` under Node 22 |
| Docker | optional real-Postgres run | yes | Docker Engine 29.7.2 | pglite is the default test DB |
| GitHub CLI | not needed at runtime | yes | - | - |

**Missing dependencies with no fallback:** none. **Missing with fallback:** pnpm on default PATH (use Node 22 + corepack).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.7, single root config, aliases `@orglet/*` to `src` |
| Config file | `/Users/johankarlsteen/Development.nosync/local-salesforce/vitest.config.ts` |
| Quick run command | `pnpm vitest run packages/metadata/src packages/schema/src/rollup.test.ts packages/engine/src/rollups.test.ts` |
| Full suite command | `pnpm test && pnpm lint && pnpm build` |

DB: embedded pglite per test file by default (no Docker); `ORGLET_DATABASE_URL` switches to real Postgres. Run the phase gate on both (CI uses real Postgres). All commands need Node 22.

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ROLL-01 | `Summary` XML parses to `SourceField` incl. `<value>True</value>`, `<value/>`, multi-token and quoted values | unit | `pnpm vitest run packages/metadata/src/sfdx.test.ts` | update (replace the "skips roll-up" test) |
| ROLL-01 | COUNT resolves to Number(18,0); SUM Currency keeps child precision/scale; MAX over `CreatedDate` resolves to DateTime; field is read-only, nillable, custom | unit | `pnpm vitest run packages/metadata/src/build.test.ts -t rollup` | add |
| ROLL-01 | MIN/MAX over Text, unknown op, bad filter op, formula summarized field each warn `UNSUPPORTED:rollup-type`/`rollup-filter` and the field is absent | unit | same file | add |
| ROLL-01 | child/field unresolvable warns `UNSUPPORTED:rollup-target`, field absent | unit | same | add |
| ROLL-02 | roll-up over non-MD, non-whitelisted lookup throws naming field and rule | unit | same | add |
| ROLL-02 | the three whitelisted lookups load; whitelisted child missing from baseline degrades (in-memory schema, D-13 pattern) | unit | same | add |
| ROLL-03 | SQL builder output per operator/type incl. blank, multi-token, `valueField`, LIKE escaping, params order (pure) | unit | `pnpm vitest run packages/schema/src/rollup.test.ts` | add |
| ROLL-03 / ROLL-04 | `count_excludes_soft_deleted_children`, `sum_ignores_children_failing_filter`, `min_max_null_when_no_matching_children`, `count_sum_zero_when_last_child_deleted` | integration (pg) | `pnpm vitest run packages/engine/src/rollups.test.ts` | add |
| ROLL-04 | insert, update, filter-only update, delete, undelete, reparent (both parents), each asserting parent values after; `reparent_recomputes_old_and_new_parent` | integration | same | add |
| ROLL-05 | parent validation rule referencing the roll-up blocks the child insert with `FIELD_CUSTOM_VALIDATION_EXCEPTION` and parent message; hook log shows `before:update:<Parent>` then `after:update:<Parent>` after child `after:insert` | integration | same | add |
| ROLL-06 | Account <- Project__c <- Milestone__c chain: milestone insert updates Project then Account (Account rolls up a Project roll-up); no infinite recursion; two-object cycle schema warns `UNSUPPORTED:rollup-cycle` | integration + unit | same + build.test.ts | add |
| ROLL-06 | `partial_success_batch_counts_only_committed_children`: batch of 3 children with one failing validation, `allOrNone:false`; and parent-rule-failure batch where only children of the failing parent roll back, other parents' values are right, including the reparent-with-failing-old-parent case | integration | same | add |
| ROLL-06 | cascade delete of a Project does not run rules on that Project; Account roll-up over Project updates | integration | same | add |
| D-04 | new parent insert has COUNT/SUM `0`, MIN/MAX `null` before any child | integration | same | add |
| D-09 | import mode keeps supplied roll-up values, no recompute | integration | same (`importMode` engine) | add |
| D-10 | `migrate()` on a database with parents and children but no roll-up column backfills it once; second `migrate()` is a no-op | integration | `pnpm vitest run packages/schema/src/migrate.test.ts -t rollup` | add |
| ROLL-07 | REST/engine insert or update carrying the roll-up field returns `INVALID_FIELD_FOR_INSERT_UPDATE`; describe has `createable:false, updateable:false, calculated:true`; Bulk ingest row with the column fails | api + integration | `pnpm vitest run packages/api/src/api.test.ts packages/api/src/bulk.test.ts -t rollup` | add |
| ROLL-08 | SOQL `SELECT`, `WHERE total > 0`, `ORDER BY` on the roll-up; aggregate `SUM(rollup)` | integration | `pnpm vitest run packages/engine/src/query.test.ts -t rollup` | add |
| ROLL-09 | local, Johan only: DE retrieve load prints zero `UNSUPPORTED:field-type` for Summary; in repo: a fixture shaped like `ObjectBackup__c.Last_Backup_Run__c` (MAX over `CreatedDate`, picklist `equals`, master-detail) loads with zero warnings | unit + manual | `pnpm vitest run packages/metadata/src/build.test.ts -t "DE-shaped"` | add (the real retrieve is never in repo or CI) |
| SDK | jsforce + simple-salesforce: describe flags for a roll-up and a rejected write | manual-scripted | extend `conformance/describe-check` (template) | last wave |

Test names must state invariants; assert concrete numbers/ids, not shapes. Make each failure-attribution test also assert the committed child set (`SELECT count(*) ... WHERE isdeleted=false`) so a stale-parent regression fails.

### Sampling Rate
- **Per task commit:** quick command for the touched package (under 30 s with pglite).
- **Per wave merge:** `pnpm test && pnpm lint`.
- **Phase gate:** `pnpm build && pnpm lint && pnpm test`, plus one run with `ORGLET_DATABASE_URL` against real Postgres, plus the SDK runs recorded verbatim in SUMMARY.

### Wave 0 Gaps
- [ ] `packages/metadata/src/rollup.ts` and a test seam for resolution without files (reuse `buildOrgSchema(baseline, { ...project, objects })` as in phase 4 D-13).
- [ ] `packages/schema/src/rollup.test.ts` (pure SQL builder tests).
- [ ] `packages/engine/src/rollups.test.ts` with fixtures: extend `examples/acme` with `Summary` fields **only after** grepping the ten acme-consuming tests for count/shape assertions (`api.test.ts` describe contract, `build.test.ts`, `migrate.test.ts`, `prefixes.test.ts`, `query.test.ts`, `bulk.test.ts`, `main.test.ts`, conformance seed). Suggested fields: `Project__c.Milestone_Count__c` (COUNT), `Project__c.Done_Count__c` (COUNT, filter `Done__c equals True`), `Project__c.Next_Due__c` (MIN `Due_Date__c`), `Account.Total_Budget__c` (SUM `Project__c.Budget__c`, Currency). If the blast radius is large, put roll-up fixtures in a separate `examples/acme-rollups` project instead; `engine.test.ts` also asserts `engine.warnings` equals `[]` and counts hook-log entries, so a new parent hook entry for Account/Project updates must not break its exact assertions (those use `toContain`, which is safe).
- [ ] A Group/Account rule fixture whose parent validation rule references a roll-up (in-memory or a new acme rule), for the ROLL-05 blocking test.
- [ ] Update `sfdx.test.ts` skip test.

## Project Constraints (from CLAUDE.md)
- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`); relative imports carry `.js`; `import type` / inline `type` specifiers (eslint error); `_`-prefixed unused vars only.
- One barrel per package, explicit named exports, values and types listed separately; no cross-package deep imports. New schema builder and new metadata types must be exported from the package `index.ts`.
- Every new source file opens with a why-comment block; inline comments explain Salesforce reasoning only.
- Errors: use `Errors.*` factories (`Errors.customValidation` for parent failures); REST errors via `apiError`/`sendErrors`; `UNSUPPORTED:<area>` mandatory for deliberate gaps. New areas this phase: `rollup-filter`, `rollup-type`, `rollup-target`, `rollup-cycle` (the first three are fixed by D-06/D-07; `rollup-cycle` is a research addition).
- No Postgres triggers; recompute is app-side only.
- Tests co-located `*.test.ts`; Postgres-backed tests use a fresh schema per run (`test_<hex>` pattern); name by invariant.
- Legal: public documentation and open-source SDK source only; never compare against a real org; Level 1 data only (all research queries and sample files here are public).
- sigha is vendored; not touched by this phase.
- Git: repo-local identity Johan Karlsteen <johan@karlsteen.com>; commits only through the GSD workflow; no outward-facing actions without Johan's OK.
- Surgical changes: the `runValidationRules` extraction must be behaviour-preserving; do not refactor adjacent code in `saveBatch`.

## Sources

### Primary (HIGH confidence)
- Repo code read and cited: `packages/metadata/src/{sfdx.ts,xml.ts,build.ts,types.ts,schema.ts}`, `packages/engine/src/{engine.ts,formulas.ts,hooks.ts,store.ts,parents.ts,coerce.ts,errors.ts}`, `packages/schema/src/{migrate.ts,columns.ts,ddl.ts,db.ts}`, `packages/api/src/describe.ts`, `test/db.ts`, `vitest.config.ts`, `examples/acme/**`, `packages/metadata/standard/objects/{Opportunity,OpportunityLineItem,CampaignMember}.json`.
- Executed fast-xml-parser 5.11.1 with the project's parser options on a `Summary` field (array-valued `value` confirmed).
- jsforce Metadata API schema (generated from the Salesforce WSDL): https://raw.githubusercontent.com/jsforce/jsforce/main/src/api/metadata/schema.ts (`CustomField.summarizedField/summaryFilterItems/summaryForeignKey/summaryOperation`, `FilterItem`).
- ~35 real `Summary` field files (GitHub: SalesforceFoundation/NPSP, SalesforceCommerceCloud/b2c-crm-sync, SalesforceLabs/ProjectManagementTool, SFDO-Community/Summit-Events-App, adam17amo/platformDev, dstdia/playbyplay_order, others) for value encodings and operations.

### Secondary (MEDIUM confidence)
- Salesforce Apex Developer Guide, Triggers and Order of Execution (https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_triggers_order_of_execution.htm): parent/grandparent roll-up text via search extraction (direct fetch returned 403).
- Salesforce Help "Roll-Up Summary Field" (https://help.salesforce.com/s/articleView?id=fields_about_roll_up_summary_fields.htm): supported standard roll-ups (Opportunity from products, Account from opportunities, Campaign from members), filter field restrictions, 25-field limit, via search extraction (page is JavaScript-rendered).
- Metadata API `FilterOperation` enumeration (NamedFilter page, https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/namedfilter.htm), via search extraction.
- Salesforce Help article 000391766 "How to Recalculate Rollup Summary Fields" (https://help.salesforce.com/s/articleView?id=000391766&language=en_US&type=1): fetched; covers only the manual force-recalculation procedure.

### Tertiary (LOW confidence)
- Third-party articles (customertimes, wedgecommerce, ksolves) stating recalculation on create/update/delete/undelete and on both masters at reparent. No Salesforce primary quote found for reparent/undelete (roadmap research flag remains open).
- Filter semantic choices flagged LOW in the Filter semantics table.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new dependencies; verified versions in repo.
- Architecture: MEDIUM-HIGH, designed against verified code; the retry-loop pattern is new and must be proven by the listed tests.
- Metadata shape: HIGH (WSDL-derived schema plus real files); operator semantics MEDIUM/LOW.
- Pitfalls: HIGH for code-derived ones (array `value`, cascade recursion, existing sfdx test), MEDIUM for platform-behaviour ones.

**Research date:** 2026-10-09
**Valid until:** 2026-11-08 (stable domain; code line references drift as phase 5 lands)
