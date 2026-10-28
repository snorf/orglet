# Phase 13: Roll-Ups over Formula Fields - Context

**Gathered:** 2026-10-24
**Status:** Ready for planning

<domain>
## Phase Boundary

A roll-up summary (COUNT, SUM, MIN, MAX) whose summarized field or filter field is a same-object,
non-volatile formula on the child object loads, recomputes in the save pipeline exactly as a
stored-field roll-up does (including when a field the formula reads changes), and is backfilled once
when an existing database is upgraded. A roll-up over any formula outside that set degrades with
`UNSUPPORTED:rollup-formula` and the field is skipped, never faked. A formula -> roll-up -> formula
cycle is detected at load and reported instead of looping.

Requirement: ROLL2-01.

Not in this phase: `orglet rollup --recompute` (ROLLX-01, backlog), extending `conformance/rollup-check`
and the acceptance fixture (Phase 14, ACC2-01/02), translating formulas to SQL or generated columns
(PROJECT.md out of scope), formula fields in SOQL `WHERE`/`ORDER BY`/`GROUP BY` (`UNSUPPORTED:soql-formula`
stays as is), the `orglet check` report redesign (Phase 14).

</domain>

<decisions>
## Implementation Decisions

### Allowed formula set (what a roll-up may summarize or filter on)
- **D-01:** The admission rule is evaluated on the compiled formula's dependency list (Phase 12 D-14,
  `CompiledFormula.dependencies {fields, globals, volatile}`): every referenced field is on the child
  object itself (`path: []`), `volatile` is false, and the only globals allowed are the compile-time
  constants `$Label`, `$CustomMetadata` and `$System.OriginDateTime`. Anything else (cross-object path,
  `NOW`/`TODAY`/`TIMENOW`, `$User`, `$Profile`, `$Organization`, `$RecordType`, `$UserRole`, `$Setup`,
  `$Api`, `$Permission`) makes the roll-up `UNSUPPORTED:rollup-formula`. `$Label` is therefore allowed;
  ROADMAP success criterion 3 and ROLL2-01 are amended in this commit to drop `$Label` from the
  forbidden roots.
- **D-02:** Formula-on-formula is allowed when the whole chain qualifies: dependencies are followed
  transitively through other formulas on the same child down to stored fields, and every formula in
  the chain must satisfy D-01. One volatile or cross-object formula anywhere in the chain makes the
  roll-up unsupported, and the warning names the inner formula that breaks the rule (D-08). This
  requires formula evaluation on a record to be ordered topologically by dependency rather than by
  declaration order (today `applyFormulaFields` runs in declaration order).
- **D-03:** A formula that reads a roll-up on the same child (the child is itself a parent of
  something) may be summarized by a roll-up higher up. It is treated as a roll-up chain (Phase 5
  ROLL-06): `rollupDepth` counts the formula hop, lower levels recompute and backfill first, and
  `MAX_ROLLUP_DEPTH` still applies at runtime.
- **D-04:** As a filter field (`summaryFilterItems`, including `valueField`), a formula may be of any
  type family the Phase 5 `filterSql` already handles (text, checkbox, picklist-as-text, number,
  currency, percent, date, datetime); the formula's return type decides the family, with the same
  operator rules as a stored field. The summarized field keeps the Phase 5 D-06 type rules: SUM over
  Number/Currency/Percent, MIN/MAX over Number/Currency/Percent/Date/DateTime, decided by the
  formula's declared return type.
- **D-05:** A number/currency/percent formula value is rounded to the formula's declared scale before
  it enters SUM/MIN/MAX, so the parent total equals the sum of the values a reader sees on the child
  rows. The researcher verifies this against public documentation; if the documentation says
  otherwise, the documented rule wins and this decision is updated in the plan.

### What "skip the field" means
- **D-06:** A roll-up rejected by D-01..D-03 is absent from the schema, exactly as every other skipped
  roll-up since Phase 5 D-06/D-07: no column, not in describe, SOQL answers `INVALID_FIELD`. "Present
  but inert" was rejected because a client could not tell "unsupported" from "no children".
- **D-07:** The admission check runs at schema-build time and its warning goes through
  `pushDiagnostic` with the `rollup-formula` area, `object`, `field` and `cause`, so `orglet check`,
  `--strict` and the Phase 14 report treat it identically to `rollup-target`/`rollup-type`/
  `rollup-filter`. Because `@orglet/metadata` cannot import `@orglet/formula`, the build needs a way to
  ask the formula compiler (an injected resolver/hook into `build()`/`resolveRollups`, or a post-pass
  in `loadOrgSchema` that runs before `migrate()` and removes the field from the schema while
  pushing the diagnostic). Research picks the mechanism; the constraint is that the field is gone
  before DDL is planned and the warning is a build diagnostic.
- **D-08:** The warning names the rule and the offending field, e.g.
  `UNSUPPORTED:rollup-formula Account.Total_Score__c: Child__c.Score__c reads Account__r.Rating (cross-object)`
  or `... uses TODAY()`; for a chain, the inner formula that breaks the rule is named.
  Decided 2026-10-24 (plan review): `FormulaDependencies` gains an optional `volatileReasons: string[]`
  (e.g. `["TODAY()"]`) filled by the compiler so the warning can name the function; additive change in
  `@orglet/formula`, `dependencies.test.ts` assertions updated.
- **D-09:** A formula -> roll-up -> formula cycle detected at load is reported as
  `UNSUPPORTED:rollup-cycle` with the full cycle path in the message; every roll-up on the cycle is
  skipped (D-06). Formulas that do not read a skipped roll-up stay; a formula that reads a skipped
  roll-up fails compile as usual and gets its own `UNSUPPORTED:formula` warning, emitted after the
  cycle diagnostic so the order reads cause-then-effect (decided 2026-10-24, plan review). `--strict`
  fails on it as on any warning. No hard load failure (Phase 5 D-08 stays reserved for roll-ups over
  a disallowed lookup).

### Backfill on upgrade
- **D-10:** Formula-dependent roll-ups are not backfilled inside the migrate transaction. `migrate()`
  returns them as pending backfills and skips their SQL; `orglet up` runs an engine backfill step
  right after constructing `DmlEngine` (so the `FormulaRegistry` exists) and before the server listens.
  Phase 5 D-10 is restated as: SQL-only roll-ups backfill last inside the migrate transaction; formula
  roll-ups backfill in the engine step that follows. Layering stays `metadata -> schema -> formula ->
  engine`.
- **D-11:** Completion is remembered in a new internal marker table in the `_orglet` schema (e.g.
  `_orglet.rollup_backfills` keyed by object and field, with a completed timestamp). A new column
  queues the backfill; the row is written only after the backfill succeeded. If the engine step
  crashes after migrate committed, the next `orglet up` finds the column without a row and redoes it.
  A second `orglet up` on a completed database is silent (no DDL beyond the existing idempotent
  statements, no backfill).
- **D-12:** The backfill is a data load, not a save: parent validation rules and parent hooks do not
  run (same as the SQL backfill today). A database error aborts `orglet up` with a clear message and
  leaves the marker row unwritten.
- **D-13:** The backfill runs regardless of `--import`. Phase 5 D-09 concerns values the import writes;
  a column that is new at upgrade has no org value to keep. (Matches the SQL backfill today.)

### Recompute triggers and cost
- **D-14:** The watched set of a formula roll-up is the transitive set of stored same-object fields the
  formula reads, followed through formula-on-formula and formula-on-roll-up (D-02/D-03) down to
  stored columns, plus the foreign key as today. Only a change to one of those triggers a recompute
  of the parent.
- **D-15:** The recompute path for a formula-dependent roll-up loads the live child rows of the
  affected parents, evaluates the child formulas in TypeScript (same path as `project()`:
  `loadParents` + `applyFormulaFields`) and hands the per-row values to the existing SQL aggregate and
  filter as a derived table (research recommendation, `.planning/research/ARCHITECTURE.md` §3). Cost
  is O(children of affected parents); accepted without a cap and documented in PROJECT.md Known gaps.
- **D-16:** Only formula-dependent roll-up fields take that path. Stored-field roll-ups on the same
  parent keep the Phase 5 pure-SQL path untouched.
- **D-17:** `orglet rollup --recompute` stays in the backlog (ROLLX-01). The engine backfill function
  from D-10 should be shaped so a CLI command can call it later, but no command is added.

### Claude's Discretion
- Exact mechanism for D-07 (resolver hook vs post-pass), the data shape of the transitive dependency
  graph and where it lives (`FormulaRegistry` vs a new module), and the topological ordering of
  formula evaluation (D-02).
- Shape of the pending-backfill contract between `migrate()` and the engine, and the marker table DDL.
- Whether the derived-table SQL (D-15) is generated in `packages/schema/src/rollup.ts` as an optional
  parameter to `rollupSelectSql` (research proposal) or elsewhere; the "SQL + params, executes nothing"
  contract of that module must survive.
- Test fixtures: phase tests use test-local SFDX fixtures with neutral names; `examples/acme` is not
  changed (Phase 14 ACC2-01 adds the acceptance fixture).

### Folded Todos
None.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Scope and requirements
- `.planning/ROADMAP.md` §"Phase 13: Roll-Ups over Formula Fields" — goal, four success criteria
  (criterion 3 amended: `$Label` is allowed), research flag.
- `.planning/REQUIREMENTS.md` §"Roll-ups over formula fields" (ROLL2-01, amended) and the
  "Out of Scope" row "Translating formulas to SQL, generated columns for formula roll-ups".
- `.planning/PROJECT.md` — Key Decisions rows on roll-ups (SELECT-first correlated subqueries,
  whitelisted lookups, backfill last in migrate) and on `CompiledFormula.dependencies`; Known gaps
  line "Roll-ups: no re-backfill on definition change, no date-literal filters, no parent row locking".

### Prior research and decisions
- `.planning/research/ARCHITECTURE.md` §3 "Roll-up over a formula child field" (~lines 174-205) —
  options table and the recommended design (TS-computed values as a derived table, `pendingBackfills`,
  watched-set extension, `familyOf` accepting formulas).
- `.planning/research/PITFALLS.md` §R1 "Roll-up over a formula field: formulas are not stored" —
  layering trap for backfill, rounding to declared scale, cycle test.
- `.planning/phases/05-roll-up-summary-fields/05-CONTEXT.md` — D-01..D-10 (recompute semantics,
  savepoints, defaults, skip pattern, import mode, backfill). All still binding except D-10, restated
  here as D-10/D-11.
- `.planning/phases/08-upgrade-safety-net-nullable-key-prefixes/08-CONTEXT.md` — lines ~239-247 and
  ~281: backfill must stay last in the migrate transaction (deferred FK trigger events); the note that
  Phase 13 re-decides D-10 for formula roll-ups.
- `.planning/phases/12-sigha-resync-formula-globals/12-CONTEXT.md` — D-14/D-15 (dependency list,
  `ReferenceKind`), D-09 (evaluation without a request), the "Phase 13 decides what a roll-up may use"
  note in `packages/formula/src/compile.ts` (~line 127).
- `.planning/phases/10-business-standard-objects/10-CONTEXT.md` — D-09 (a reference to an unmodelled
  object counts once as `reference-target`, not again as a `rollup-*` warning).

### Public platform documentation (researcher verifies; no real-org diffing)
- Salesforce Help, "Roll-Up Summary Field" / "Roll-Up Summary Field Considerations" — which formula
  fields may be summarized or used in filter criteria (the documented restriction list), allowed
  summarized types per operation.
- Salesforce Help, "Formula Field Limits and Restrictions" and "Tips for Working with Number Formula
  Fields" — rounding/scale behaviour for D-05.
- Salesforce Help, "Order of Execution" — roll-up recompute after child after-hooks (already applied
  in Phase 5).

### Code to read first
- `packages/metadata/src/rollup.ts` (`resolveRollups`, `tryResolve` line ~177 formula rejection,
  `familyOf` ~205, `rollupDepth` consumers), `packages/metadata/src/build.ts` (~397, ~670),
  `packages/metadata/src/diagnostics.ts`, `packages/metadata/src/build.test.ts` (~568-610 asserts the
  current rejection), `packages/metadata/src/rollup.test.ts`.
- `packages/schema/src/rollup.ts` (`rollupSelectSql`, `rollupBackfillSql`, `aggregate`, `filterSql`),
  `packages/schema/src/migrate.ts` (step 1 ~146, step 3 ~214-223), `packages/schema/src/columns.ts`
  (`isVirtual`, `INTERNAL_SCHEMA`), `packages/schema/src/migrate.test.ts` (idempotency test ~58),
  `packages/schema/src/rollup.test.ts`.
- `packages/engine/src/rollups.ts` (`RollupRegistry`, `watched`, `affectedParents` ~98),
  `packages/engine/src/engine.ts` (`withRollups` ~558, `recomputeRollups` ~579-624,
  `saveRollupParent` ~627, `MAX_ROLLUP_DEPTH` ~90, defaults ~675), `packages/engine/src/formulas.ts`
  (`FormulaRegistry`, `applyFormulaFields`, `fieldDependencies`), `packages/engine/src/rollups.test.ts`.
- `packages/formula/src/compile.ts` (`FormulaDependencies` ~61-68, volatility ~127-334),
  `packages/formula/src/evaluate.ts` (~59-61 record reads).
- `packages/cli/src/main.ts` (`check` ~73-98, `up` ~103-158: migrate runs before `DmlEngine`).
- `conformance/rollup-check/` — existing checks (not extended in this phase, must stay green).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/schema/src/rollup.ts`: pure SQL builders (`aggregate`, `filterSql`, `rollupSelectSql`,
  `rollupBackfillSql`, `rollupDepth`) — the derived-table input (D-15) extends them without changing
  the "SQL + params" contract.
- `packages/engine/src/formulas.ts` `FormulaRegistry.fieldDependencies(obj, field)` and
  `applyFormulaFields` — the inputs for the admission rule (D-01) and for computing child values (D-15).
- `packages/engine/src/engine.ts` `recomputeRollups` / `saveRollupParent` — parent-side semantics
  (savepoints, rules, hooks, blame) are reused unchanged for formula roll-ups.
- `packages/metadata/src/diagnostics.ts` `pushDiagnostic` + `SkippedItem.kind: "rollup"` — the
  warning channel for D-07/D-08/D-09.
- `_orglet.key_prefixes` in `packages/schema` — the pattern for an internal marker table (D-11).

### Established Patterns
- Formula fields have no column (`isVirtual`) and are evaluated per row after fetch; roll-ups are
  stored, read-only columns. Nothing in this phase changes that split.
- Dependency direction `metadata -> schema -> formula -> soql -> engine -> api -> cli`; the metadata
  build cannot compile formulas, hence D-07's injected check and D-10's engine backfill step.
- `UNSUPPORTED:<area>` warnings are the only degrade channel; `orglet check --strict` exits 1 on any.
- Roll-up chains already exist (`rollupDepth`, `rollup-cycle` for roll-up -> roll-up); D-03/D-09
  extend the same graph with formula hops.
- Recompute is skipped in `importMode` (Phase 5 D-09); backfill is not (D-13).

### Integration Points
- `packages/metadata/src/rollup.ts` lines ~177 and ~205-207 are the two gates to replace with the
  D-01 admission check; `build.test.ts` ~568 asserts today's rejection and must change.
- `packages/engine/src/rollups.ts` `watched` must include formula inputs (D-14); the registry needs
  access to formula dependencies, so build `FormulaRegistry` before `RollupRegistry`.
- `packages/schema/src/migrate.ts` step 3 must skip formula-dependent roll-ups and report them
  (D-10); `packages/cli/src/main.ts` `up` gains the engine backfill call after `new DmlEngine(...)`.
- `packages/formula/src/compile.ts` volatility classification (~127) is the contract D-01 relies on;
  `$Label`/`$CustomMetadata`/`$System.OriginDateTime` are non-volatile today and stay so.
- `conformance/rollup-check` and `examples/acme` are unchanged; the existing acme roll-ups
  (`Account.Open_Project_Milestones__c`, `Last_Active_Project_Created__c`, `Total_Budget__c`,
  `Project__c.Next_Due_Date__c`, `Milestone_Count__c`, `Open_Milestones__c`) must keep working.

</code_context>

<specifics>
## Specific Ideas

- Warning wording follows the Phase 5 style and names both the roll-up and the offending child formula:
  `UNSUPPORTED:rollup-formula <Parent>.<Field>: <Child>.<Formula> reads <path> (cross-object)` /
  `uses TODAY()` / `uses $User` ; for chains `... via <Child>.<InnerFormula>`.
- Cycle message lists the path, e.g. `Parent.R__c -> Child.F__c -> Child.R2__c -> Parent.G__c -> Parent.R__c`.
- "Second `orglet up` is silent" is measured as in `migrate.test.ts`: no DDL beyond the idempotent
  statements and no backfill executed, with the marker table populated.

</specifics>

<deferred>
## Deferred Ideas

- `orglet rollup --recompute` (ROLLX-01) — stays in backlog; the engine backfill function is its
  natural base.
- Formula fields in SOQL `WHERE`/`ORDER BY`/`GROUP BY` — unchanged (`UNSUPPORTED:soql-formula`); the
  per-row TS evaluation built here does not change that.
- Conformance `rollup-check` extension and acceptance fixture with a formula roll-up — Phase 14
  (ACC2-01/ACC2-02).

### Reviewed Todos (not folded)
- "Standard-field gaps on the 18 business objects seen in a large real-org retrieve"
  (`.planning/todos/pending/2026-10-16-standard-field-gaps-on-the-18-business-objects.md`) — keyword
  match only; concerns the baseline generator, not roll-ups. Left pending.

</deferred>

---

*Phase: 13-roll-ups-over-formula-fields*
*Context gathered: 2026-10-24*
