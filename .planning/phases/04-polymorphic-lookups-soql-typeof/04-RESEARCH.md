# Phase 4: Polymorphic Lookups & SOQL TYPEOF - Research

**Researched:** 2026-10-08
**Domain:** SOQL compiler (SQL generation + row shaping), polymorphic reference resolution, formula parent traversal
**Confidence:** MEDIUM-HIGH (code facts and parser behaviour verified by running them; Salesforce rules read from the public SOQL/SOSL Reference PDF; Name-object field list from an archived 2016 Object Reference page)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Without `TYPEOF`, the fields a query may read on a polymorphic parent are exactly the fields Salesforce documents on the `Name` object (Id, Name, Type, Email, Phone, Alias, FirstName, LastName, Title, IsActive, Username, ... research verifies the list against the Object Reference). A field outside that set yields the same `INVALID_FIELD` a real org gives. Each value is read from the row's concrete target object; where that object lacks the field (for example `Owner.Email` on a Group-owned row) the value is `null` (POLY-02).
- **D-02:** `attributes.type` on a polymorphic parent is the concrete object for that row (`Group`, `User`, ...) with the matching `attributes.url`, never `"Name"` and never the first-defined target.
- **D-03:** `<relationship>.Type` is both selectable (`SELECT Owner.Type`) and filterable (`WHERE Owner.Type = 'Group'`), with the concrete object API name as value, derived in SQL from the Id prefix (a `CASE left(col, 3) ...` over the field's targets), not from a stored column (POLY-05).
- **D-04:** A `TYPEOF` parent contains `attributes` (concrete type) plus exactly the fields of the matching `WHEN` (or `ELSE`) branch. Fields of other branches are absent, not `null`, so rows in one result may carry different keys, exactly as Salesforce returns them.
- **D-05:** A row whose concrete type matches no `WHEN` and the query has no `ELSE`: follow the Salesforce SOQL/SOSL Reference for TYPEOF literally. Research cites the passage and the planner locks the behaviour (null parent, attributes-only, or omitted); nothing is assumed.
- **D-06:** POLY-06's invalid forms (TYPEOF in WHERE, GROUP BY, HAVING, inside a semi-join subquery, functions in a WHEN field list, nested TYPEOF, TYPEOF together with `COUNT()`) are rejected with `SoqlError` `MALFORMED_QUERY` whose message names the restriction, mirroring the documented wording where available.
- **D-07:** An Id whose prefix maps to no object in the schema degrades to a `null` parent (and takes the `ELSE` branch in TYPEOF, or D-05's behaviour without ELSE). It is never an error. The query logs `UNSUPPORTED:reference-target <prefix> matches no object in the org schema` via `req.log.warn` once per query, so a degradation is never silent. Same wording family as `build.ts`'s load-time warning.
- **D-08:** Formulas and validation rules reference a polymorphic parent with the Salesforce syntax `Owner:User.Name`, `What:Account.Name` (relationship, colon, concrete object, dot, field). The value is `null` when the row's concrete type differs. A plain `Owner.Name` on a polymorphic lookup is NOT accepted as an orglet extension; it fails compilation the way a real org rejects it (research confirms the real error wording).
- **D-09:** If the vendored `sigha` parser does not accept the colon syntax, the fix goes upstream in sigha and is synced in with `scripts/sync-sigha.sh`, per the project rule; no local pre-processing in `packages/formula`. If the upstream fix cannot land within the phase, formulas using the colon syntax raise `UNSUPPORTED:formula` with a clear message, the rest of the phase ships, and the formula half of POLY-01 is recorded as a gap in VERIFICATION with a todo against sigha.
- **D-10:** `WHERE` and `ORDER BY` on the Name-object fields of a polymorphic parent are supported (for example `WHERE Owner.Name = 'x'`, `ORDER BY Owner.Alias`), to the extent the SOQL reference allows; research verifies the exact allowance and any documented limits.
- **D-11:** SQL strategy: one `LEFT JOIN` per candidate target object with a prefix filter on the join condition (`AND left(parent.col, 3) = '<prefix>'`); per-row values are `COALESCE` over the targets that have the field, `Type` is a `CASE` over prefixes. Targets are static at compile time (2 to 7). Details (alias scheme, how `expr()` and the shape model carry per-target columns, pagination interaction) are Claude's discretion.
- **D-12:** Primary fixture is `OwnerId` with a Group-owned and a User-owned record (Case or Account; a Group row of type Queue is created in the test). One additional `Task.WhatId` test (Account vs Opportunity) exercises a 7-target field and TYPEOF with several WHENs. `User.DelegatedApproverId` and `Group.RelatedId` get the mechanism without dedicated tests.
- **D-13:** POLY-03 is tested with a second `OrgSchema` built in memory with one target removed (for example no `Group`), same pattern as phase 2's two-build test; a row with a Group-prefixed `OwnerId` is written through import mode and queried. Expected: `null` parent, `ELSE` branch, the `UNSUPPORTED:reference-target` log line. No fixture on disk.
- **D-14:** SDK verification is vitest (compile, engine query, API) plus a small targeted jsforce and simple-salesforce run against a live orglet in the phase's last plan (Name-object query, a `Type` filter, a TYPEOF query), recorded verbatim in SUMMARY. Full conformance stays in phase 7. `conformance/describe-check` is the template.

### Claude's Discretion
- Internal shape model changes in `packages/soql/src/compile.ts` and `shape.ts` to carry per-target columns and the per-row type (for example a `polymorphic` shape kind).
- Where the Name-object field list lives (a constant in `@orglet/metadata` or `@orglet/soql`).
- How `packages/engine/src/parents.ts` groups Ids by prefix for formula parents, and whether a shared "match target by key prefix" helper is placed in `@orglet/schema` next to `keyPrefixOf` for all three read-path call sites plus `checkReferences`.
- Exact SQL for `COALESCE`/`CASE`, alias naming, and EXPLAIN output format.
- Test file placement and the targeted SDK script's name under `conformance/`.
- Wording of MALFORMED_QUERY messages beyond what the SOQL reference documents.

### Deferred Ideas (OUT OF SCOPE)
- Plain `Owner.Name` in formulas as an orglet extension: rejected for fidelity (D-08).
- Task and Event as full objects with their own fixtures (HEAD-01, v2); this phase tests one `Task.WhatId` case only.
- Dedicated tests for `User.DelegatedApproverId` and `Group.RelatedId`.
- A stored type column for polymorphic lookups: explicitly out of scope (REQUIREMENTS).
- Bulk API rejection of TYPEOF: phase 6.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| POLY-01 | Polymorphic lookup resolves target per row from key prefix in SOQL parent traversal, shaping and formula parent references; write path is reference | Three first-target call sites located (compile.ts:116-123, formula/compile.ts:~95, engine/parents.ts:24-29); reference rule at engine.ts:526; sigha cannot lex `:` (verified) so the formula half likely lands as D-09 fallback |
| POLY-02 | Polymorphic parent carries concrete `attributes.type`; fields absent on concrete object are `null` | Shape model gap (shape.ts:26 fixes type per shape); Name-object field table; per-field contributor table |
| POLY-03 | Unmodelled prefix degrades to null parent / ELSE | LEFT JOIN with prefix filter yields NULL naturally; detection of the unmodelled case at shape time via selected FK + type CASE |
| POLY-04 | `TYPEOF` compiles and shapes per row | AST shape verified; spec text for no-match behaviour found (null) |
| POLY-05 | `<rel>.Type` selectable and filterable | Parser emits ordinary `Field`/`FieldRelationship`/condition for `Owner.Type`; must be special-cased in `resolve()`; `Group.Type` collision pitfall |
| POLY-06 | Invalid TYPEOF forms rejected `MALFORMED_QUERY` | Parser behaviour matrix below: three forms are parser errors with generic text, three are accepted and must be rejected by orglet |
</phase_requirements>

## Summary

The read path today is entirely first-target: `Compiler.resolve()` joins `target` (first defined) for every relationship segment (`packages/soql/src/compile.ts:114-125`), `parentShape()` hard-codes `type: join.obj.name` into the shape (`compile.ts:268`), `shapeSObjectRow` emits `attributes.type` from the static shape (`shape.ts:26`), the formula compiler resolves polymorphic paths through `resolved.target` (`packages/formula/src/compile.ts` `resolvePath`), and `loadParents` loads every Id of a polymorphic lookup from the first target (`packages/engine/src/parents.ts:24-29`, `37-41`). The write path (`engine.ts:520-530`) picks the target by `t.keyPrefix === keyPrefixOf(id)` and silently accepts an Id when some declared target is not modelled. Read must converge on that exact rule; one shared helper is the right way to avoid a fourth divergent copy.

The parser (`@jetstreamapp/soql-parser-js` 8.1.0) already produces a clean `FieldTypeof` node (`{type, field, conditions:[{type:'WHEN'|'ELSE', objectType?, fieldList: string[]}]}`) and parses `Owner.Type` as an ordinary relationship field in SELECT, WHERE and ORDER BY, so no parser work is needed. Three of the six invalid forms (TYPEOF in WHERE, in GROUP BY, functions/nesting inside a WHEN list) are already parse errors, but with generic messages that do not name the restriction; three (TYPEOF with COUNT(), inside a semi-join, with GROUP BY/aggregates) parse fine and the compiler must reject them explicitly. Today a parser error is wrapped as `malformed(err.message)` (`compile.ts:171`), so POLY-06 needs a pre-parse text diagnosis, only when the source contains `TYPEOF`.

Two decision-level risks surfaced and need planner attention (see Open Questions): (1) baseline metadata gives EVERY owned standard object `OwnerId -> [User, Group]` (`build.ts:109-114`), so D-01/D-08 would apply the Name-object restriction to `Account.Owner.*` and break real-org-valid queries and the existing tests; (2) sigha cannot lex `:` and upstream HEAD equals the vendored revision, so the formula half of POLY-01 (success criterion 1's third leg) is very likely the D-09 fallback.

**Primary recommendation:** Add a shared `matchTargetByPrefix` helper in `@orglet/schema`, generalise the compiler `Scope.joins` entry to a polymorphic join (one LEFT JOIN per target with `left(fk,3)` prefix filter), add a `polymorphic` parent shape that carries a per-row type column and per-target field columns, special-case the `Type` leaf, implement TYPEOF as a `typeof` shape member keyed by relationship name, and put all POLY-06 rejections in a single `assertTypeofAllowed` pre-check.

## Standard Stack

No new dependencies. Everything is existing, pinned workspace code.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@jetstreamapp/soql-parser-js` | 8.1.0 (verified in node_modules) | SOQL AST incl. `FieldTypeof` | Already the project's parser; AST verified by running it |
| `pg` via `@orglet/schema` | ^8.23 | SQL execution | Only DB driver |
| vitest | 3.2.7 | Tests | Established; embedded pglite when `ORGLET_DATABASE_URL` unset |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| LEFT JOIN per target (D-11, locked) | `UNION`/lateral per-row lookup | Locked by CONTEXT; do not revisit |
| Local pre-processing of `Owner:User.Name` | n/a | Forbidden by D-09 |

**Installation:** none.

## Architecture Patterns

### Recommended change map
```
packages/schema/src/ids.ts        # + matchTargetByPrefix(targets, id) next to keyPrefixOf; export from index.ts
packages/soql/src/compile.ts      # polymorphic join in resolve(); Type leaf; Name-object table; TYPEOF select; POLY-06 pre-check
packages/soql/src/shape.ts        # per-row type, typeof branches, unmodelled-prefix collection
packages/soql/src/errors.ts       # reuse malformed(); no new class needed
packages/engine/src/parents.ts    # group Ids by prefix for "Rel:Object" path segments
packages/engine/src/query.ts      # surface shape warnings (UNSUPPORTED:reference-target) to caller
packages/api/src/routes/query.ts  # req.log.warn once per query
packages/formula/src/compile.ts   # reject plain polymorphic traversal (D-08); colon path (D-09 fallback UNSUPPORTED:formula)
packages/metadata/src/types.ts    # fix stale OrgSchema doc comment
conformance/poly-check/           # copy of conformance/describe-check layout (jsforce.mjs + sf_*.py + README)
```

### Pattern 1: Shared prefix matcher (the single source of truth)
**What:** `matchTargetByPrefix(targets: SObjectDef[], id: string): SObjectDef | undefined` using `t.keyPrefix === keyPrefixOf(id)`, exactly `engine.ts:526`. Use it from `checkReferences` (refactor, behaviour unchanged), `loadParents`, and the formula path. The SQL side cannot call it, but must be generated from the same data: the CASE/prefix filters use `target.keyPrefix` of `resolveRelationship(...).targets`.
**Caveat:** `resolveRelationship` filters out undefined targets (`metadata/src/schema.ts:60`), so `targets` = modelled targets only; the write path's "unknown target accepted unchecked" case is `targets.length !== referenceTo.length`.

### Pattern 2: Polymorphic join in `resolve()`
Today `scope.joins: Map<key, {alias,obj,sql}>`. Change the entry to carry `poly?: { fk: string /* "t0"."ownerid" */; targets: { obj: SObjectDef; alias: string; prefix: string }[] }` and emit one `LEFT JOIN <table> tN ON tN.id = fk AND left(fk, 3) = '<prefix>'` per target (the `id` primary-key equality already makes duplicates impossible, so no row multiplication and pagination in `runQuery` (`SELECT * FROM (<sql>) q LIMIT/OFFSET`, query.ts:44) is unaffected). Use `$n` params or inline-quoted prefix literals; prefixes are 3 alphanumerics from the schema, never user input, so inline is safe.
`resolve()` currently returns `{field, obj, alias}`; it must return a discriminated result so `expr()` callers (WHERE at compile.ts:492-494, ORDER BY :640, GROUP BY :624, aggregate :368, `compileFunction` argExpr :388) get a per-row SQL expression: `COALESCE(t1."name", t2."name")` for contributing targets, or the type CASE for the `Type` leaf. Callers that currently do `isText(r.field)` need a synthetic `FieldDef` (type `Text`) for the pseudo-field so case-insensitive comparison logic (compile.ts:536-539) keeps working. Simplest: `resolve()` returns `{ field, obj, alias, sqlOverride?: string }` and `expr()` callers use `sqlOverride ?? this.expr(...)`.
**Chains past a polymorphic parent** (`Owner.Profile.Name`, `What.Owner.Name`): not in Name's documented scalar set; recommend `unsupported("polymorphic-traversal", ...)` (new area, per the UNSUPPORTED convention) rather than INVALID_FIELD, since a real org does allow `Owner.Profile.Name`-style references through Name's `Profile` reference field. LOW confidence on real-org behaviour; flag in plan.

### Pattern 3: Name pseudo-object (D-01) as a data table
Documented Name fields (archived Object Reference 2016, MEDIUM): `Alias, Email, FirstName, IsActive, LastName, LastReferencedDate, LastViewedDate, MiddleName, Name, Phone, Profile, ProfileId, Suffix, Title, Type, Username, UserRole, UserRoleId`, plus `Id`. Descriptions say Alias, Email, IsActive, Phone, Profile/ProfileId, Username, UserRole(Id) "contain a value only if the related record is a user"; FirstName/LastName/MiddleName/Suffix/Name are user, contact or lead; `Type` is the sObject type (picklist, filterable).
**Recommendation:** model as `NAME_OBJECT_FIELDS: Record<string, { userOnly: boolean }>` in `@orglet/soql` (it is a SOQL-resolution concept). For a `userOnly` field only the `User` target contributes even if `Group` has a same-named field (`Group.json` has `Email`; the doc says Name.Email is user-only). Others take every target that `schema.getField(target, name)` finds. `Id` comes from the join's id column. `Profile`/`UserRole` (name-valued pseudo-fields) have no direct column; treat as `UNSUPPORTED:polymorphic-field` initially (or INVALID_FIELD) rather than guessing. Anything else: `invalidField(path, "Name")`.
Entities for the error text: use `Name` as the entity (`No such column 'X' on entity 'Name'`), matching D-01's "same INVALID_FIELD a real org gives" (LOW: exact real wording unverified, never diff against an org).

### Pattern 4: `Type` leaf
`Owner.Type` is a normal AST node (`FieldRelationship{field:"Type", relationships:["Owner"]}` in SELECT; `{field:"Owner.Type"}` in WHERE/ORDER BY; verified). In `resolve()` and `parentShape` flows, when the leaf is `type` (case-insensitive) AND the last relationship is polymorphic, produce `CASE WHEN left(fk,3) = '005' THEN 'User' WHEN left(fk,3)='00G' THEN 'Group' ... END` (NULL when fk is NULL or prefix unmodelled). This MUST be checked before the Name-field/`getField` lookup because `Group.Type` exists (Queue/Regular) and would otherwise win via COALESCE (`Owner.Type` must be `'Group'`, not `'Queue'`). WHERE comparison text is case-insensitive via the existing `lower()` path because literal type is STRING; ensure `textual` is true for the synthetic expression (compile.ts:536 uses `field` when present; pass a synthetic text FieldDef or let `literalType === "STRING"` drive it). `LIKE`, `IN`, `!=` all work through existing operator switch (SOQL reference: "any WHERE comparison operator ... such as = or LIKE"). `Owner.Type` on a NON-polymorphic relationship is not valid in a real org; fall through to normal `getField` (INVALID_FIELD unless the object has a Type field, e.g. `Account.Type`-style parents must keep working).

### Pattern 5: Shape model
Add to `SObjectShape`:
```ts
// per-row concrete type for a polymorphic parent
poly?: { typeAlias: string /* CASE column */; fkAlias: string; targets: { name: string; prefix: string }[] }
typeofs: Map<string /*relationship name*/, TypeofShape>
interface TypeofShape { typeAlias: string; fkAlias: string; branches: Map<string /*object*/, SObjectShape>; else?: SObjectShape }
```
`shapeSObjectRow` (shape.ts:23): for `poly` parents compute `type` from `row[poly.typeAlias]`; if null while `row[fkAlias]` non-null, the prefix is unmodelled -> return `null` and record the prefix (D-07). Build `attributes(type, id, apiVersion)` with the id column from the winning target (COALESCE of target ids, or just the FK value, which equals the parent Id when the parent exists; but if the parent row is missing/deleted the join yields NULL fields and Id must then be null -> parent null, matching today's `idAlias` null check at shape.ts:25). Use `COALESCE(t1.id, t2.id)` as `idAlias`.
`ShapeOptions` gains an optional `onUnmodelledPrefix?: (prefix: string) => void`; `runQuery` collects a `Set`, returns `warnings: string[]` on `QueryPage`; the route emits `req.log.warn` once. Warning text per D-07: `UNSUPPORTED:reference-target ${prefix} matches no object in the org schema`.
**Order-of-keys:** fields first then parents then children (shape.ts:27-31); keep, add typeofs after parents.

### Pattern 6: TYPEOF compile
For `FieldTypeof` in `compileSObjectSelect` (replaces the throw at compile.ts:326-327): resolve `f.field` as a relationship path (parser accepts dotted `Account.Owner`, verified); require the final relationship be polymorphic (spec: "can't be used with a relationship field whose namePointing attribute is false") else `malformed`. Create the polymorphic join (shared with Pattern 2, keyed by relationship path). For each WHEN: look up `objectType` in the field's modelled targets (case-insensitive); an object not among the targets: raise `malformed` naming it (LOW: real code/wording unknown; do not claim). Compile `fieldList` into a branch `SObjectShape` rooted at that target's join alias, reusing `addField`/`parentShape` with a Scope whose `joins` key-space is prefixed by `<relpath>@<Object>` so a branch can traverse further (spec: whenFieldList may be "paths to related object fields"). `ELSE` list: only Name-object fields (spec text), compiled through Pattern 3. A WHEN naming an object not modelled (`Group` missing in D-13's schema) simply never matches: skip it silently only if the object is absent from the schema; an object unknown everywhere is `invalidType`.
Selected FK + CASE type column + per-branch columns are all plain SELECT items, so `SELECT * FROM (...) q` pagination works.
Shaping (D-04, D-05 verified): per row, pick branch = WHEN whose object equals the row's concrete type; else ELSE; else the relationship value is `null`. **D-05 citation (SOQL and SOSL Reference, "Using TYPEOF"):** "Note that if an ELSE clause isn't provided and the object type isn't Account or Opportunity, then null is returned for that Event." Lock: **null parent**. The reference also says (Combining TYPEOF and Type) an ELSE is ignored when WHERE already restricts types; no special handling needed.
Additional documented rule to enforce (SOQL ref, `typeOfField`): "typeOfField cannot reference a relationship field that is also referenced in the fieldList of a SELECT statement" -> `malformed` if `SELECT Owner.Name, TYPEOF Owner ...`. Multiple TYPEOF on different polymorphic fields in one SELECT are allowed ("you can use more than one TYPEOF expression").

### Pattern 7: POLY-06 enforcement (one function)
Parser behaviour, verified by executing `parseQuery` on 8.1.0:

| Invalid form | Parser result | Orglet action |
|--------------|---------------|---------------|
| TYPEOF in WHERE | throws `Expected operator but found IDENTIFIER ("Owner")` | pre-parse text check -> message "TYPEOF is only allowed in the SELECT clause" |
| TYPEOF in GROUP BY | throws `Unexpected token "Owner"...` | same pre-check -> "TYPEOF can't be used in queries with GROUP BY" |
| TYPEOF in HAVING | throws (`Expected operator`) | same pre-check -> "...HAVING" |
| function in WHEN list (`toLabel(Name)`) | throws `Expected END but found L_PAREN` | pre-check on `WHEN ... THEN ... (` -> "TYPEOF can't be used in queries with functions in the SELECT clause" |
| nested TYPEOF | throws `Expected END but found IDENTIFIER ("Manager")` | pre-check -> "TYPEOF expressions can't be nested" |
| TYPEOF with `COUNT()` | PARSES (COUNT + FieldTypeof both in `fields`) | AST check -> "TYPEOF isn't allowed in queries that don't return objects, such as COUNT()" |
| TYPEOF in semi-join select | PARSES (`valueQuery.fields[0].type === "FieldTypeof"`) | AST check before compile.ts:506 -> "TYPEOF isn't allowed in the SELECT clause of a semi-join query" |
| TYPEOF + GROUP BY Id / aggregate fn / `FORMAT()` sibling | PARSES; today `aggregate` becomes true (compile.ts:183) and `compileAggregateSelect` throws a generic `UNSUPPORTED:soql-aggregate` | AST check BEFORE the aggregate branch -> "TYPEOF can't be used in queries with GROUP BY..." / "...functions in the SELECT clause" |
| TYPEOF in child subquery (`(SELECT TYPEOF What ... FROM Tasks)`) | PARSES | Not listed as invalid; allowed. `compileChildSubquery` uses `compileSObjectSelect`, so it works if shape JSON (row_to_json) carries the typeof columns; plan an explicit test |
| TYPEOF on non-polymorphic relationship | parses | `malformed` (spec: namePointing false) |

Messages mirror the documented wording (SOQL/SOSL Reference, TYPEOF "considerations"): "TYPEOF is only allowed in the SELECT clause of a query", "TYPEOF isn't allowed in queries that don't return objects, such as COUNT()", "TYPEOF expressions can't be nested", "TYPEOF isn't allowed in the SELECT clause of a semi-join query", "TYPEOF can't be used in queries with functions in the SELECT clause", "TYPEOF can't be used in queries with GROUP BY, GROUP BY ROLLUP, GROUP BY CUBE, and HAVING". Note the spec says *functions in the SELECT clause* (any function sibling), broader than CONTEXT's "functions in WHEN"; implement the broader rule (any `FieldFunctionExpression` incl. `toLabel`/`FORMAT` in the same SELECT) since it is the documented one.
Pre-parse diagnosis: only run when `/\bTYPEOF\b/i` is in the SOQL and `parseQuery` threw; keep it a small tokenizer-free heuristic on the text (strip string literals first) deciding which restriction applies; fall back to the original parser message. Do not hand-roll a SOQL parser.
Bulk API rejection of TYPEOF is phase 6; expose a cheap `queryUsesTypeof(CompiledQuery)` or a flag on `CompiledQuery` (CONTEXT notes phase 6 reuse) but do not wire it.

### Pattern 8: Formula path (POLY-01 formula half)
- `resolvePath` (formula/compile.ts) currently resolves any polymorphic segment through `resolved.target`. Per D-08 a polymorphic segment without `:object` must throw a `FormulaCompileError`. Real-org wording is NOT confirmed (searched; not found in public docs); recommend reusing the existing `Field X does not exist. Check spelling.` text (`fieldNotFound`) and flag LOW.
- **Verified: sigha rejects the colon.** `parse("Owner:Group.Name = 'x'")` returns `FieldRef{path:["Owner"]}` plus diagnostics `unexpected-character ':'` and `unexpected-token` ("Unexpected trailing input"). Upstream `rfaulhaber/sigha` HEAD (`main`, pushed 2026-09-29) is `2abe5dbb...`, identical to the vendored `Revision` in `packages/sigha/VENDOR.md`, so no upstream support exists today. Therefore the D-09 fallback is the realistic outcome unless Johan lands an upstream change. Plan accordingly: a task that (a) ships the formula-side wiring that does not depend on the lexer (see below), and (b) turns the `:` diagnostics into `UNSUPPORTED:formula polymorphic reference 'Owner:Group.Name' needs sigha colon syntax`, plus a `.planning/todos` entry against sigha and a VERIFICATION gap. Ask Johan whether he owns/can PR upstream.
- Real-syntax discrepancy (MEDIUM, from public blog/community results, not the Reference): for `Owner` real formulas use `Owner:User.Field` and `Owner:Queue.QueueName` / `Owner:Queue.DeveloperName` (object `Queue`, not `Group`). D-08 writes `Owner:Group.Name`. orglet has no `Queue` object (queues are `Group` rows with `Type='Queue'`). When the colon syntax lands, accept `Queue` as an alias of `Group` for `Owner`/polymorphic references or the first real-world rule will fail. Surface this to Johan.
- Wiring that is independent of the lexer: canonical parent path segment `"Owner:Group"`; `FieldReference.key` already splits on `.` (compile.ts `register`), so `["Owner:Group","Name"]` flows; `loadParents` must treat a segment containing `:` as "load relationship `Owner`, keep only Ids whose prefix equals `Group.keyPrefix`, store under `r["Owner:Group"]`" using `matchTargetByPrefix`; other rows get `null`, giving the `null when type differs` rule. Evaluation reads the nested record by path (verify in `packages/formula/src/evaluate.ts` during planning; not read in this research).

### Anti-Patterns to Avoid
- **A fourth prefix matcher.** Pitfall 5 (milestone research): all call sites call the one helper; add a test that iterates `checkReferences` and the SQL CASE for the same fixture Ids.
- **Joining the first target when `polymorphic` is false and all targets are modelled** is fine (keep current single-join SQL for non-polymorphic to avoid churn and to keep existing generated-SQL tests in `compile.test.ts` valid); only `polymorphic === true` takes the new path. Note `polymorphic` is `defined.length > 1`: a polymorphic field with only ONE modelled target (D-13: no Group) reports `polymorphic:false`. D-13 needs the polymorphic path (null on foreign prefix, `ELSE` branch, warning) to run even then. Use `field.referenceTo.length > 1` (declared targets), not `resolved.polymorphic`, as the trigger, and keep prefix filtering active in that case.
- **Letting `Group.Type` leak into `Owner.Type`** (see Pattern 4).
- **Throwing for unmodelled prefixes.** Join yields NULL; only warn.
- **Filtering `WHERE Owner.Name = 'x'` with a plain first-target comparison.** Must be the COALESCE expression so Group-owned rows match on `Group.Name`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SOQL TYPEOF grammar | Own SOQL lexer for TYPEOF | `parseQuery` `FieldTypeof` AST | Verified: handles WHEN/ELSE, multiple WHENs, dotted `Account.Owner`, relationship paths in THEN lists |
| Prefix to object | Inline `left(...)` string compare in each call site | `matchTargetByPrefix` + generated SQL from the same targets | Pitfall 5 divergence |
| MALFORMED_QUERY errors | New error class | `malformed()` in `packages/soql/src/errors.ts` | Convention; API layer already maps `SoqlError` to HTTP 400 |
| Warning plumbing | New logger | Existing `req.log.warn` + `UNSUPPORTED:` prefix (convention in CLAUDE.md) | Matches softer-gap pattern (SOSL stub) |
| Formula colon parsing | Regex pre-processor in `packages/formula` | Upstream sigha change + `scripts/sync-sigha.sh` | D-09 |

**Key insight:** every difficult part is already a solved sub-problem inside the repo (prefix rule, join planner, shape tree, error factories); the work is generalising `resolve()` and the shape tree from "one type per join" to "one type per row".

## Runtime State Inventory

Not a rename/refactor/migration phase; no stored data, service config, OS registration, env var or build artifact carries a renamed string. The only schema-adjacent item: the polymorphic SQL reads existing `ownerid`-style columns; no DDL change (DDL already skips FKs for multi-target lookups per milestone research). **None required.** (Stale `dist/` folders are rebuilt by `pnpm build`; vitest aliases use `src`, so tests don't need a build.)

## Common Pitfalls

### Pitfall 1: Baseline makes every owned object polymorphic (decision conflict)
**What goes wrong:** `build.ts:109-114` assigns `OwnerId.referenceTo = ["User","Group"]` to every `hasOwner` object, including Account, Contact, Opportunity (real orgs: User only). With D-01 (Name-object field set) and D-08 (plain `Owner.X` rejected in formulas) those objects lose `Owner.Department`, `Owner.Manager.Name`, and `formula.test.ts:43` (`rule("Owner.Alias = 'x'")` on Account) must fail. `api.test.ts:170` pins `OwnerId referenceTo ["User","Group"]` (on which object: verify).
**How to avoid:** Do NOT silently narrow. Put it to Johan as a decision (see Open Questions). Minimal-risk default: keep metadata unchanged, apply the Name rules only on polymorphic relationships, update the tests that encode first-target behaviour (query.test.ts:65 `Account.Owner.Alias` still passes because Alias is a Name field; formula.test.ts:43 must change).
**Warning signs:** existing tests using `Owner.<non-Name field>` fail; conformance seeds (`conformance/jsforce/seed.mjs`) querying owner fields (grep showed no `Owner` use in `examples/` or the seeds, MEDIUM).

### Pitfall 2: `polymorphic` flag false when targets are unmodelled
See Anti-Patterns: gate on declared `referenceTo.length > 1`.

### Pitfall 3: `compile()` decides `aggregate` before looking at TYPEOF
`compile.ts:182-183`: `COUNT()` / GROUP BY route to aggregate/countOnly paths, which never see TYPEOF. Run the POLY-06 AST check first, at the top of `compile()` after parse.

### Pitfall 4: Semi-join inner compiler is a separate `Compiler`
`compile.ts:498-510` constructs `new Compiler`, bumps `aliasCounter` by 100. The new polymorphic joins created inside semi-joins (`WHERE OwnerId IN (SELECT Id FROM Case WHERE Owner.Type='Group')`, parses fine, verified) work through `inner.resolve`, but the polymorphic join list lives on `innerScope.joins` (already emitted at :510). Keep joins in `scope.joins` so every emission site (main :205, child subquery :352, semi-join :510) picks them up.

### Pitfall 5: Child subquery rows go through `row_to_json`
`compileChildSubquery` (compile.ts:358) wraps in `json_agg(row_to_json(sub))`; aliases `cN` are unique per compiler, but TYPEOF/poly columns inside a child must still be uniquely aliased and the inner shape reads them from the JSON by alias. Add a test (`SELECT Id, (SELECT Id, What.Name FROM Tasks) FROM Account`; Task has `AccountId` so verify the child relationship name) or explicitly gate with `UNSUPPORTED:soql-subquery-poly` if it is not worth it. Parser accepts TYPEOF inside child selects.

### Pitfall 6: Formula fields on a polymorphic parent
`addField` throws `unsupported("soql-formula", ...)` for parent formula fields (compile.ts:237). Unchanged; keep consistent for polymorphic parents.

### Pitfall 7: Unmodelled-prefix warning needs the FK value
The `null` parent from a failed prefix match is indistinguishable from "FK is null" unless the FK column is also selected. Select it (and the type CASE) for every polymorphic parent; warn only when `fk IS NOT NULL AND type IS NULL`. Warn once per query (Set of prefixes, one `warn` call or one per distinct prefix; decide: "once per query" = one log call listing distinct prefixes is safest).

### Pitfall 8: Import-mode rows with Group-prefixed ids but Group unmodelled
Write path already accepts (engine.ts:527-529 comment). Fine; D-13 relies on it. Group-owned rows also need the Group row to exist for `Owner.Name` to be non-null; for the fixture, insert a Group (Type Queue) via the engine (check `bootstrap.ts` and `engine.insert('Group', ...)` works: `Group.json` exists with keyPrefix `00G`; confirm creatable).

## Code Examples

### FieldTypeof AST (verified on 8.1.0)
```ts
// node_modules/.pnpm/@jetstreamapp+soql-parser-js@8.1.0/.../dist/types/api/api-models.d.ts
export interface FieldTypeOf { type: 'FieldTypeof'; field: string; conditions: FieldTypeOfCondition[]; }
export interface FieldTypeOfCondition { type: 'WHEN' | 'ELSE'; objectType?: string; fieldList: string[]; }
// SELECT TYPEOF Owner WHEN User THEN Name, Alias WHEN Group THEN Name, Type ELSE Id END FROM Case
// -> {type:"FieldTypeof", field:"Owner", conditions:[{type:"WHEN",objectType:"User",fieldList:["Name","Alias"]},
//     {type:"WHEN",objectType:"Group",fieldList:["Name","Type"]},{type:"ELSE",fieldList:["Id"]}]}
// SELECT Owner.Type -> {type:"FieldRelationship", field:"Type", relationships:["Owner"], rawValue:"Owner.Type"}
// WHERE Owner.Type = 'Group' -> {left:{field:"Owner.Type", operator:"=", value:"'Group'", literalType:"STRING"}}
```
`fieldList` entries are plain strings (dotted for paths), so a function in THEN can never appear in the AST (it is a parse error).

### Generated SQL sketch (D-11)
```sql
SELECT t0.id AS c0,
       t0."ownerid" AS c1,
       CASE left(t0."ownerid",3) WHEN '005' THEN 'User' WHEN '00G' THEN 'Group' END AS c2,
       COALESCE(t1.id, t2.id) AS c3,
       COALESCE(t1."name_concat...", t2."name") AS c4        -- per-target expr() output
FROM "s"."case" t0
LEFT JOIN "s"."user"  t1 ON t1.id = t0."ownerid" AND left(t0."ownerid",3) = '005'
LEFT JOIN "s"."group" t2 ON t2.id = t0."ownerid" AND left(t0."ownerid",3) = '00G'
WHERE t0.isdeleted = false
  AND lower(CASE left(t0."ownerid",3) WHEN '005' THEN 'User' WHEN '00G' THEN 'Group' END) = lower($1)
```
(Names are illustrative: use `quote(...)`, `tableName`, `columnName` as the existing code does. `expr()` for the `Name` compound field on User already yields `NULLIF(concat_ws(' ', firstname, lastname), '')`.)

### Shape per-row type
```ts
// shape.ts sketch
const type = shape.poly ? (typeof row[shape.poly.typeAlias] === "string" ? (row[shape.poly.typeAlias] as string) : undefined) : shape.type;
if (type === undefined) { if (row[shape.poly.fkAlias] != null) options.onUnmodelledPrefix?.(String(row[shape.poly.fkAlias]).slice(0, 3)); return null; }
```

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Polymorphic parents typed as `Name` (WSDL type `ens:Name`) | API 46.0+ returns concrete `sObject` types per row | `attributes.type` is the concrete object (SOQL ref "Object Types in WSDLs"), consistent with D-02 |
| TYPEOF Developer Preview (v26-45) | GA in API 46.0+ | none for orglet |

**Deprecated/outdated:** none relevant. Note the Object Reference page for `Name` is only available archived (2016 revision) in what I could fetch; the current page returned 403 to WebFetch.

## Open Questions

1. **Owned standard objects are modelled as polymorphic (User|Group) in baseline.**
   - What we know: `build.ts:109-114`; real Account/Contact/Opportunity owner is User-only. D-01/D-08 would then wrongly restrict them. `api.test.ts:170` and `build.test.ts` fact table pin current metadata.
   - Unclear: whether to narrow baseline `OwnerId` per object (Case/Lead/custom: User|Group; Account etc: User) or accept the infidelity.
   - Recommendation: surface to Johan before planning wave 1; default to "keep metadata, apply rules only where polymorphic, update tests that encode first-target behaviour, record a todo". Narrowing is a separate metadata change (touches phase 3 fact table tests), so out of scope without his OK.

2. **Formula colon syntax cannot land in-phase unless sigha is changed upstream.**
   - Known: lexer rejects `:` (verified), upstream HEAD == vendored rev.
   - Recommendation: plan the D-09 fallback (`UNSUPPORTED:formula`), file a sigha todo, and mark success criterion 1's formula leg as a recorded gap; ask whether Johan controls upstream. Also resolve `Queue` vs `Group` naming (Pattern 8).

3. **Exact real-org error wording** for plain `Owner.Name` in a formula, and for `INVALID_FIELD` on `Name` entity, is not in public docs I could reach. Use existing wording; mark LOW; never verify against an org (legal constraint).

4. **`WHEN` naming a non-target object** (e.g. `WHEN Contact` on `Owner`): real error code unknown. Use `malformed` with a clear message.

5. **Name `Profile` / `UserRole` pseudo-fields** (name-valued): decide between UNSUPPORTED and INVALID_FIELD; recommend `UNSUPPORTED:polymorphic-field`.

6. **ORDER BY / GROUP BY on polymorphic parent fields** (D-10): spec text in the SOQL reference read here documents `Type`/WHERE filtering and Name field selection but states no ORDER BY limit; the Name page marks fields "Filter, Group, Nillable, Sort", supporting WHERE/ORDER BY/GROUP BY. Implement all three through the same override expression.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | build/test | yes | >=22 (project pin) | - |
| pnpm | scripts | yes (project) | 10+ | - |
| Postgres | tests | embedded pglite when `ORGLET_DATABASE_URL` unset (test/db.ts) | pglite 0.5.8 | `pnpm db:up` Docker Postgres 16 |
| Docker | optional real PG, live server for SDK check | not probed (not needed for vitest) | - | pglite for tests; the live jsforce/simple-salesforce run (D-14) needs a running `orglet up`, which needs a Postgres: probe `docker info` at plan/execute time |
| Python venv | simple-salesforce check | `conformance/describe-check/.venv` (py3.12) present | - | create via the describe-check README |
| jsforce | SDK check | `conformance/describe-check/jsforce.mjs` template exists | - | - |

**Missing dependencies with no fallback:** none identified. The live SDK run needs a running Postgres; confirm Docker availability before the final plan (not probed here).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.7, single root `vitest.config.ts`, aliases `@orglet/*` to `src` |
| Config file | `/Users/johankarlsteen/Development.nosync/local-salesforce/vitest.config.ts` |
| Quick run command | `pnpm vitest run packages/soql/src/compile.test.ts packages/engine/src/query.test.ts packages/formula/src/formula.test.ts` |
| Full suite command | `pnpm test && pnpm lint && pnpm build` |

DB: embedded pglite per test file by default (no Docker); `ORGLET_DATABASE_URL` switches to real Postgres. Both must pass (CI uses real PG per phase 1).

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| POLY-01 | Group-owned and User-owned Case: `SELECT Owner.Name`, `Owner.attributes.type`, formula agree on `Group`/`User` (three assertions on one row) | integration (pg) | `pnpm vitest run packages/engine/src/query.test.ts -t polymorphic` | add to existing file (Wave 0: fixture inserts Group Queue + Case rows) |
| POLY-01 | `matchTargetByPrefix` equals `checkReferences` behaviour | unit | `pnpm vitest run packages/schema/src/ids.test.ts` | add to existing |
| POLY-01 (formula) | plain `Owner.Name` rejected; `Owner:Group.Name` either evaluates or raises `UNSUPPORTED:formula` (D-09) | unit | `pnpm vitest run packages/formula/src/formula.test.ts` | update `formula.test.ts:43` |
| POLY-02 | `Owner.Email` null on Group row; `Owner.Phone` etc.; non-Name field `Owner.Department` -> `INVALID_FIELD` | integration | `pnpm vitest run packages/engine/src/query.test.ts -t "Name"` | add |
| POLY-03 | schema without Group: Group-prefixed owner -> null parent, ELSE branch, warning text | integration (second `OrgSchema`, import mode) | `pnpm vitest run packages/engine/src/query.test.ts -t unmodelled` | add |
| POLY-04 | TYPEOF user/group branches, no-match -> null, ELSE, multiple TYPEOF, `Task.WhatId` Account vs Opportunity | integration | `pnpm vitest run packages/engine/src/query.test.ts -t TYPEOF` | add |
| POLY-04 | compile output + shape for TYPEOF (pure) | unit | `pnpm vitest run packages/soql/src/compile.test.ts` | add |
| POLY-05 | `WHERE Owner.Type = 'Group'` returns exactly Group-owned rows; `IN`, `LIKE`, `!=`; `SELECT Owner.Type`; `ORDER BY Owner.Type`; `Group.Type` not leaked | integration + unit (SQL) | same files | add |
| POLY-06 | each invalid form -> `MALFORMED_QUERY` naming restriction (7 cases, table above) | unit (no DB) | `pnpm vitest run packages/soql/src/compile.test.ts -t TYPEOF` | add |
| API | `/query` returns same JSON; D-07 warn emitted once | api | `pnpm vitest run packages/api/src/api.test.ts` | add |
| SDK | jsforce + simple-salesforce: Name query, Type filter, TYPEOF | manual-scripted (live server) | `node conformance/poly-check/jsforce.mjs` and the python script (name TBD) | Wave last |

Test names must state invariants (e.g. `owner_type_filter_returns_only_group_owned_rows`, `typeof_without_else_yields_null_parent_for_unlisted_type`, `unmodelled_prefix_never_errors_and_logs_reference_target`). Assert real values, not shapes: mutate the Group fixture's Id prefix expectations so a first-target regression fails.

### Sampling Rate
- **Per task commit:** the quick command for the touched package(s) (`<30s` with pglite).
- **Per wave merge:** `pnpm test && pnpm lint`.
- **Phase gate:** `pnpm build && pnpm lint && pnpm test` green (also run once with `ORGLET_DATABASE_URL` against real Postgres), plus the D-14 SDK runs recorded verbatim in SUMMARY.

### Wave 0 Gaps
- [ ] Fixture helper inserting a Group (Type `Queue`) and Case/Account rows owned by a User and by the Group in `query.test.ts` (confirm engine can insert Group; `bootstrapOrg` creates the admin User).
- [ ] Second-schema builder for POLY-03 (`buildOrgSchema(baseline, { ...project, objects })` pattern from phase 2; locate the actual helper in `packages/metadata/src/build.ts`).
- [ ] `Task` fixture rows for the `WhatId` test (Task exists, prefix `00T`; confirm it is createable).
- [ ] `conformance/poly-check/` scaffold copied from `conformance/describe-check/`.

## Project Constraints (from CLAUDE.md)
- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`); relative imports carry `.js`; `import type` / inline `type` specifiers (eslint error).
- One barrel per package, explicit named exports, values and types listed separately; no cross-package deep imports. New helper must be exported from `packages/schema/src/index.ts`.
- Every new source file opens with a why-comment block; comments explain Salesforce reasoning only.
- Errors: use `malformed`/`invalidField`/`invalidType`/`unsupported` factories; never hand-build; REST errors via `apiError`/`sendErrors`. `UNSUPPORTED:<area>` is mandatory for deliberate gaps (new areas this phase: `polymorphic-traversal`, `polymorphic-field`, and the existing `reference-target`, `formula`).
- Warnings: `req.log.warn` in the API; never `console` in packages/api.
- Tests co-located `*.test.ts`; Postgres-backed tests use a fresh schema per run; name by invariant.
- Legal: public docs and SDK source only; never compare against a real org; Level 1 data only.
- sigha is vendored; never hand-edit; upstream fix + `scripts/sync-sigha.sh`.
- Git: repo-local identity Johan Karlsteen <johan@karlsteen.com>; commits only via GSD workflow; no outward-facing actions (push/repo creation) without Johan's OK.
- Surgical changes: do not refactor adjacent code; the `checkReferences` refactor to call the shared helper must be behaviour-preserving and covered by existing engine tests.

## Sources

### Primary (HIGH confidence)
- Repo code read and cited by line: `packages/soql/src/compile.ts`, `shape.ts`, `errors.ts`; `packages/engine/src/parents.ts`, `formulas.ts`, `engine.ts:505-545`, `query.ts`; `packages/metadata/src/schema.ts:53-63`, `build.ts:82-115`; `packages/formula/src/compile.ts`; `test/db.ts`.
- `@jetstreamapp/soql-parser-js` 8.1.0 `api-models.d.ts`, plus executed `parseQuery` on 25 representative queries (outputs summarised above).
- Executed vendored sigha `parse()` on colon forms (rejects `:`); `gh api repos/rfaulhaber/sigha/commits` HEAD sha equals `VENDOR.md` revision.
- Salesforce SOQL and SOSL Reference Version 68.0, Winter '27 (PDF fetched from resources.docs.salesforce.com, text extracted): TYPEOF section pp.14-16, "Filter on Polymorphic Relationship Fields" p.31-32, "Understanding Relationship Fields and Polymorphic Fields" pp.75-79 (https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/salesforce_soql_sosl.pdf).

### Secondary (MEDIUM confidence)
- Archived Object Reference "Name" object page (2016 revision via web.archive.org of developer.salesforce.com `sforce_api_objects_name.htm`): field list and "only if user" notes.
- Web search results on `Owner:User` / `Owner:Queue.DeveloperName` formula syntax (https://developer.salesforce.com/blogs/2013/06/cross-object-owner-fields-a-powerful-new-formula-option and community posts).

### Tertiary (LOW confidence)
- Real-org error wording for plain polymorphic traversal in formulas, for WHEN on a non-target object, and for INVALID_FIELD entity name on `Name`: not found; flagged.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new dependencies.
- Architecture: MEDIUM-HIGH, design derived from verified code structure; SQL not yet executed.
- Spec rules (TYPEOF restrictions, no-match null): HIGH (current Reference text).
- Name-object field list: MEDIUM (archived page).
- Formula colon / Queue naming: MEDIUM-LOW.
- Pitfalls: HIGH for code-derived ones.

**Research date:** 2026-10-08
**Valid until:** 2026-11-07 (parser pinned; docs stable)
