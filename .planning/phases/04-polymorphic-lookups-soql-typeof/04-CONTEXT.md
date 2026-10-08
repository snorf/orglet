# Phase 4: Polymorphic Lookups & SOQL TYPEOF - Context

**Gathered:** 2026-10-08
**Status:** Ready for planning

<domain>
## Phase Boundary

A polymorphic lookup (`OwnerId` → User|Group, `Task`/`Event` `WhoId`/`WhatId`,
`User.DelegatedApproverId`, `Group.RelatedId`) resolves its target object per row from the
Id's key prefix on the read path, in agreement with the write path that already does so:
SOQL parent traversal and joins, result shaping (`attributes.type`), and formula parent
references. Without `TYPEOF`, a polymorphic parent behaves as Salesforce's `Name` pseudo-object
(a fixed field set, each value read from the row's concrete object, `null` where that object
lacks the field). `SELECT TYPEOF <field> WHEN <Object> THEN <fields> [WHEN ...] [ELSE <fields>]
END` compiles and shapes per row; `<relationship>.Type` is selectable and filterable; the
documented invalid TYPEOF forms are rejected with `MALFORMED_QUERY` naming the restriction; an
Id whose prefix matches no modelled object degrades to a `null` parent (or the `ELSE` branch)
with an `UNSUPPORTED:reference-target` log line, never an error. Requirements POLY-01..06.

Not in this phase: Task and Event as full objects (HEAD-01), a `<field>_type` companion column
(Out of Scope), Bulk API's rejection of TYPEOF (phase 6), full conformance re-run (phase 7),
any change to the write path (`checkReferences` is the reference behaviour).

</domain>

<decisions>
## Implementation Decisions

### Polymorphic parent without TYPEOF: the Name pseudo-object
- **D-01:** Without `TYPEOF`, the fields a query may read on a polymorphic parent are exactly
  the fields Salesforce documents on the `Name` object (Id, Name, Type, Email, Phone, Alias,
  FirstName, LastName, Title, IsActive, Username, ... — research verifies the list against the
  Object Reference). A field outside that set yields the same `INVALID_FIELD` a real org gives.
  Each value is read from the row's concrete target object; where that object lacks the field
  (for example `Owner.Email` on a Group-owned row) the value is `null` (POLY-02).
- **D-02:** `attributes.type` on a polymorphic parent is the concrete object for that row
  (`Group`, `User`, ...) with the matching `attributes.url`, never `"Name"` and never the
  first-defined target.
- **D-03:** `<relationship>.Type` is both selectable (`SELECT Owner.Type`) and filterable
  (`WHERE Owner.Type = 'Group'`), with the concrete object API name as value, derived in SQL
  from the Id prefix (a `CASE left(col, 3) ...` over the field's targets), not from a stored
  column (POLY-05).

### TYPEOF result shape
- **D-04:** A `TYPEOF` parent contains `attributes` (concrete type) plus exactly the fields of
  the matching `WHEN` (or `ELSE`) branch. Fields of other branches are absent, not `null`, so
  rows in one result may carry different keys, exactly as Salesforce returns them.
- **D-05:** A row whose concrete type matches no `WHEN` and the query has no `ELSE`: follow the
  Salesforce SOQL/SOSL Reference for TYPEOF literally. Research cites the passage and the
  planner locks the behaviour (null parent, attributes-only, or omitted); nothing is assumed.
- **D-06:** POLY-06's invalid forms (TYPEOF in WHERE, GROUP BY, HAVING, inside a semi-join
  subquery, functions in a WHEN field list, nested TYPEOF, TYPEOF together with `COUNT()`) are
  rejected with `SoqlError` `MALFORMED_QUERY` whose message names the restriction, mirroring the
  documented wording where available.

### Unmodelled prefix (POLY-03)
- **D-07:** An Id whose prefix maps to no object in the schema degrades to a `null` parent
  (and takes the `ELSE` branch in TYPEOF, or D-05's behaviour without ELSE). It is never an
  error. The query logs `UNSUPPORTED:reference-target <prefix> matches no object in the org
  schema` via `req.log.warn` once per query, so a degradation is never silent. Same wording
  family as `build.ts`'s load-time warning.

### Formula parent references (POLY-01, formula half)
- **D-08:** Formulas and validation rules reference a polymorphic parent with the Salesforce
  syntax `Owner:User.Name`, `What:Account.Name` (relationship, colon, concrete object, dot,
  field). The value is `null` when the row's concrete type differs. A plain `Owner.Name` on a
  polymorphic lookup is NOT accepted as an orglet extension; it fails compilation the way a real
  org rejects it (research confirms the real error wording).
- **D-09:** If the vendored `sigha` parser does not accept the colon syntax, the fix goes
  upstream in sigha and is synced in with `scripts/sync-sigha.sh`, per the project rule; no
  local pre-processing in `packages/formula`. If the upstream fix cannot land within the phase,
  formulas using the colon syntax raise `UNSUPPORTED:formula` with a clear message, the rest of
  the phase ships, and the formula half of POLY-01 is recorded as a gap in VERIFICATION with a
  todo against sigha.

### Filtering and sorting on polymorphic parent fields
- **D-10:** `WHERE` and `ORDER BY` on the Name-object fields of a polymorphic parent are
  supported (for example `WHERE Owner.Name = 'x'`, `ORDER BY Owner.Alias`), to the extent the
  SOQL reference allows; research verifies the exact allowance and any documented limits.
- **D-11:** SQL strategy: one `LEFT JOIN` per candidate target object with a prefix filter on
  the join condition (`AND left(parent.col, 3) = '<prefix>'`), as the milestone research
  proposes; per-row values are `COALESCE` over the targets that have the field, `Type` is a
  `CASE` over prefixes. Targets are static at compile time (2 to 7). Details (alias scheme,
  how `expr()` and the shape model carry per-target columns, pagination interaction) are
  Claude's discretion.

### Fixtures and test scope
- **D-12:** The primary fixture is `OwnerId` with a Group-owned and a User-owned record
  (Case or Account; a Group row of type Queue is created in the test). It exercises SOQL
  traversal, shaping, `Type` select and filter, Name-object null semantics, and the formula
  syntax. One additional `Task.WhatId` test (Account vs Opportunity) exercises a 7-target
  field and TYPEOF with several WHENs. `User.DelegatedApproverId` and `Group.RelatedId` get the
  mechanism without dedicated tests.
- **D-13:** POLY-03 is tested with a second `OrgSchema` built in memory with one target
  removed (for example no `Group`), the same pattern as phase 2's two-build test; a row with a
  Group-prefixed `OwnerId` is written through import mode and queried. Expected: `null`
  parent, `ELSE` branch, the `UNSUPPORTED:reference-target` log line. No fixture on disk.
- **D-14:** SDK verification is vitest (compile, engine query, API) plus a small targeted
  jsforce and simple-salesforce run against a live orglet in the phase's last plan (a Name-
  object query, a `Type` filter and a TYPEOF query), recorded verbatim in SUMMARY. Full
  conformance stays in phase 7. The `conformance/describe-check` layout from phase 3 is the
  template.

### Planning-time decisions (from 04-RESEARCH.md open questions, confirmed 2026-10-08)
- **D-15:** Baseline metadata keeps `OwnerId` `referenceTo: ["User", "Group"]` on every owned
  standard object. The Name-field restriction (D-01) and the formula colon rule (D-08) apply
  wherever the lookup is polymorphic per metadata, Account/Contact/Opportunity included;
  `formula.test.ts:43` is updated accordingly. Narrowing `OwnerId` per object is NOT done in
  this phase; record a todo. Gate the polymorphic read path on `field.referenceTo.length > 1`
  (not on `resolveRelationship().polymorphic`, which is false when only one target is
  modelled, the D-13 case).
- **D-16:** The formula half of POLY-01 ships as the D-09 fallback from the start: the
  vendored sigha lexer rejects `:` and upstream has no support, so no upstream PR in this
  phase. Formulas using `Owner:Group.Name` / `Owner:Queue.Name` raise `UNSUPPORTED:formula`
  with a clear message; plain `Owner.Name` on a polymorphic lookup still fails compilation
  (D-08). The gap is recorded in VERIFICATION with a todo against sigha. When the colon
  syntax lands, `Queue` is accepted as an alias of `Group`.
- **D-17:** Polymorphic parent traversal and `TYPEOF` inside child subqueries (the
  `row_to_json` branch) are gated with `SoqlError` `UNSUPPORTED:polymorphic-subquery`, not
  implemented in this phase. Likewise Name's `Profile`/`UserRole` pseudo-fields and chains
  past a polymorphic parent (`Owner.Profile.Name`) are gated as `UNSUPPORTED:polymorphic-field`
  / `UNSUPPORTED:polymorphic-traversal`.
- **D-18:** D-05 is locked from the SOQL/SOSL Reference: a row whose concrete type matches no
  `WHEN` and the query has no `ELSE` returns a `null` parent.

- **D-19:** Clarifies D-07 for TYPEOF: an Id whose prefix matches no modelled object yields a
  `null` parent in every case, including when the TYPEOF has an `ELSE` branch. No synthetic
  `attributes.type: "Name"` object is ever returned (D-02 holds without exception). The D-07
  `UNSUPPORTED:reference-target` warning is still logged once per query.

### Claude's Discretion
- Internal shape model changes in `packages/soql/src/compile.ts` and `shape.ts` to carry
  per-target columns and the per-row type (for example a `polymorphic` shape kind).
- Where the Name-object field list lives (a constant in `@orglet/metadata` or `@orglet/soql`).
- How `packages/engine/src/parents.ts` groups Ids by prefix for formula parents, and whether
  a shared "match target by key prefix" helper is placed in `@orglet/schema` next to
  `keyPrefixOf` for all three read-path call sites plus `checkReferences`.
- Exact SQL for `COALESCE`/`CASE`, alias naming, and EXPLAIN output format.
- Test file placement and the targeted SDK script's name under `conformance/`.
- Wording of MALFORMED_QUERY messages beyond what the SOQL reference documents.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` §"Phase 4" — goal, five success criteria, research flag (read the
  `FieldTypeof` AST shape from the parser's `.d.ts`; confirm parser coverage of
  `WHERE <rel>.Type = '...'` independently of TYPEOF)
- `.planning/REQUIREMENTS.md` — POLY-01..POLY-06; "Out of Scope": no `<field>_type` column
- `.planning/PROJECT.md` — constraints (public docs and SDK source only, no behaviour-diffing,
  Level 1 data only), sigha gaps fixed upstream, `UNSUPPORTED:<area>` convention

### Research for this phase
- `.planning/research/ARCHITECTURE.md` §"Feature 1: Per-Row Polymorphic Lookups + SOQL
  TYPEOF" — join-per-target design, `resolveRelationship` already returns `targets` and
  `polymorphic`, DDL already skips FKs for multi-target lookups, shared prefix-match helper
- `.planning/research/PITFALLS.md` §"Pitfall 5" (three independent call sites must converge
  on one helper; write path is the reference), §"Pitfall 6" (TYPEOF and `.Type` in WHERE are
  two grammar productions; ELSE fall-through), §"Pitfall 7" (never assume every target is
  modelled)
- `.planning/research/SUMMARY.md` — polymorphic section

### Prior phase context
- `.planning/phases/03-thin-standard-object-baselines/03-CONTEXT.md` D-11/D-14 and
  `conformance/describe-check/` — the targeted-SDK-script pattern to copy
- `.planning/phases/02-custom-object-key-prefix-persistence/02-CONTEXT.md` — in-memory
  second schema via `buildOrgSchema(baseline, { ...project, objects })` (D-13 here)
- `.planning/phases/01-test-infrastructure-ci/01-CONTEXT.md` D-09..D-12, D-20/D-21 — test
  backend rules

### Existing code this phase changes or depends on
- `packages/soql/src/compile.ts` — `resolve()` ~line 105-131 (one join per segment, first
  target), WHERE relationship resolution ~line 250-275, `FieldTypeof` case ~line 326 (throws
  `UNSUPPORTED:soql-typeof`), semi-join handling ~line 506
- `packages/soql/src/shape.ts` — `attributes()`, `shapeSObjectRow()` (type fixed per shape)
- `packages/soql/src/errors.ts` — `malformed`, `invalidField`, `invalidRelationship`,
  `unsupported`
- `packages/metadata/src/schema.ts` ~line 53 — `resolveRelationship` (`target`, `targets`,
  `polymorphic`); `packages/metadata/src/types.ts` — stale doc comment on `OrgSchema`
- `packages/metadata/src/build.ts` ~line 110 — `OwnerId` `referenceTo: ["User", "Group"]`
- `packages/formula/src/compile.ts` ~line 95 — parent-path resolution via first target;
  `packages/sigha/src` — the vendored parser (colon syntax check, D-08/D-09)
- `packages/engine/src/parents.ts` — `loadParents` (per relationship, first target)
- `packages/engine/src/engine.ts` ~line 520-530 — `checkReferences` per-row prefix match
  (reference behaviour); `packages/schema/src/ids.ts` — `keyPrefixOf`
- `packages/api/src/routes/query.ts` and `packages/api/src/server.ts` — where a per-query
  `req.log.warn` for D-07 would be emitted
- `node_modules/.pnpm/@jetstreamapp+soql-parser-js@8.1.0/node_modules/@jetstreamapp/soql-parser-js/dist/types/api/api-models.d.ts`
  — `FieldTypeof` and related AST types
- `packages/soql/src/compile.test.ts`, `packages/engine/src/query.test.ts`,
  `packages/api/src/api.test.ts` — existing `Account.Owner.Alias` tests that currently rely on
  first-target behaviour
- `scripts/sync-sigha.sh`, `packages/sigha/VENDOR.md` — how an upstream sigha fix is pulled in

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `resolveRelationship` already exposes every candidate target and a `polymorphic` flag; no
  metadata change is needed beyond the doc comment.
- `checkReferences` (write path) already matches `target.keyPrefix === keyPrefixOf(id)` per
  row; the read path converges on that rule.
- `keyPrefixOf` in `@orglet/schema` is the pure prefix helper all call sites can share.
- `loadParents` already walks relationship paths and loads by Ids; grouping Ids by prefix is
  the only addition for formula parents.
- The shape model (`SObjectShape` with `parents`, `fields`, `idAlias`) and `shapeSObjectRow`
  are the single place result JSON is built; per-row type and branch selection slot in there.
- `SoqlError` factories exist for `MALFORMED_QUERY`, `INVALID_FIELD`, `INVALID_RELATIONSHIP`.
- Phase 2/3 test patterns: in-memory second schema, import-mode writes, `openTestDb`,
  `conformance/describe-check` as the targeted-SDK-script template.

### Established Patterns
- `UNSUPPORTED:<area>` only for deliberately unimplemented behaviour; rejected SOQL is a real
  `MALFORMED_QUERY`.
- Compiler is pure and unit-tested on generated SQL (`compile.test.ts`); row shaping is
  tested through `engine/query.test.ts` and `api.test.ts`.
- Vendored sigha is never hand-edited; gaps go upstream and are resynced.
- Tests named by invariant; literal observed output in SUMMARY.

### Integration Points
- `packages/soql/src/compile.ts` (joins, WHERE/ORDER BY on parent fields, TYPEOF, `.Type`),
  `packages/soql/src/shape.ts` (per-row type, branch fields), `packages/formula/src/compile.ts`
  (colon syntax, per-type parent paths), `packages/engine/src/parents.ts` (prefix grouping),
  `packages/engine/src/formulas.ts` (record context for polymorphic parents), the query route
  for the D-07 warning, `packages/metadata/src/types.ts` doc comment.
- Phase 6 will reuse the compiler's TYPEOF detection to reject it for Bulk queries.

</code_context>

<specifics>
## Specific Ideas

- Success criterion 1 is a three-way agreement test on one fixture row (a Group-owned Case):
  `SELECT Owner.Name FROM Case`, that row's `Owner.attributes.type`, and a validation rule or
  formula using `Owner:Group.Name` must all say `Group`. Write the three assertions against the
  same row, as Pitfall 5 asks.
- The strong `.Type` test is `WHERE Owner.Type = 'Group'` returning exactly the Group-owned
  rows (Pitfall 6).
- A Group owner means a Queue: `Group` rows with `Type = 'Queue'`; the engine already accepts a
  Group-prefixed `OwnerId`.
- Keep the legal posture: TYPEOF semantics come from the public SOQL and SOSL Reference and
  the Object Reference's `Name` object page; no org is queried.

</specifics>

<deferred>
## Deferred Ideas

- Plain `Owner.Name` in formulas as an orglet extension: rejected for fidelity (D-08); revisit
  only if a real-org use case shows Salesforce accepts it.
- Task and Event as full objects with their own fixtures (HEAD-01, v2); this phase tests one
  `Task.WhatId` case only.
- Dedicated tests for `User.DelegatedApproverId` and `Group.RelatedId`.
- A stored type column for polymorphic lookups: explicitly out of scope (REQUIREMENTS).
- Bulk API rejection of TYPEOF: phase 6.

### Reviewed Todos (not folded)
- "Reword ROADMAP phase 7 to validate against the DE retrieve, not the org" — keyword match
  only; stays pending for phase 7 (also reviewed in phase 3).

</deferred>

---

*Phase: 04-polymorphic-lookups-soql-typeof*
*Context gathered: 2026-10-08*
