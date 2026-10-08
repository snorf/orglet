# Phase 5: Roll-Up Summary Fields - Context

**Gathered:** 2026-10-09
**Status:** Ready for planning

<domain>
## Phase Boundary

`Summary` fields (`summarizedField`, `summaryForeignKey`, `summaryOperation`,
`summaryFilterItems`) load from SFDX metadata as real stored columns on the parent, are recomputed
in the app-side save pipeline on every child mutation path (insert, update including filter-only
field changes, delete, undelete, reparent with both parents recomputed), recompute upward through
multi-level master-detail chains without infinite recursion, are read-only via REST and Bulk, and
are selectable, filterable and sortable in SOQL like any other stored field. Johan's Developer
Edition retrieve loads with zero `UNSUPPORTED:field-type` warnings for `Summary` fields (ROLL-09).

Not in this phase: a GUI, Apex/Flow execution on the parent (only the hook seam), a standalone
recompute CLI command (deferred, see below), roll-ups over arbitrary lookups.

</domain>

<decisions>
## Implementation Decisions

### Parent rules and hooks on recompute (ROLL-04, ROLL-05)
- **D-01:** Recomputing a roll-up runs the parent's own validation rules on the recomputed row and
  the parent's before/after hooks through the existing `TriggerExecutor` seam (inert today, no
  executors are registered). A parent validation failure fails the child record(s) that triggered
  it with `FIELD_CUSTOM_VALIDATION_EXCEPTION` carrying the parent rule's message, exactly as the
  platform propagates a parent failure to the detail save.
- **D-02:** Order of execution: recompute happens after the child's own after-hooks (Salesforce
  order of execution), gated on `!importMode` like every other post-write step, and then runs the
  parent's before/after hooks around the parent `UPDATE`.
- **D-03:** Granularity: one recompute per affected parent after the child write loop, not one per
  child. Each parent's recompute (one batched aggregate `UPDATE` per roll-up field for that
  parent set, `LEFT JOIN` so a parent whose last matching child left is zeroed) runs inside its
  own nested savepoint. If the parent fails (rule or hook), that parent's savepoint is rolled back
  and every child in the batch that points at that parent (old or new FK) is rolled back and gets
  the error; other children and other parents stay committed. Partial success therefore reflects
  only the children that actually committed (ROADMAP success criterion 3).
- **D-04:** Empty parent (no matching non-deleted children): COUNT and SUM are `0`, MIN and MAX are
  `null`. New parent rows get these values at insert (in `DmlEngine.defaults()`), not only after
  the first child.

### Which relationships may carry a roll-up (ROLL-02)
- **D-05:** Master-detail relationships (`type: MasterDetail`) are accepted. In addition, exactly
  the three relationships Salesforce documents as roll-up capable without master-detail are
  whitelisted: `Opportunity.AccountId` (roll-ups on Account), `OpportunityLineItem.OpportunityId`
  (on Opportunity) and `CampaignMember.CampaignId` (on Campaign). Any other non-master-detail
  foreign key fails metadata load with a clear error naming the field and the rule. If a
  whitelisted child object is not in the baseline, the field degrades per D-07 instead.

### Metadata-load strictness (ROLL-01, ROLL-03)
- **D-06:** An unknown or unsupported `summaryFilterItems` operation, or MIN/MAX over a field type
  the platform does not allow (anything but Number, Currency, Percent, Date, DateTime), does not
  create the field: warn `UNSUPPORTED:rollup-filter` / `UNSUPPORTED:rollup-type` and skip it.
  Never compute a roll-up with a filter silently dropped.
- **D-07:** An unresolvable child object or child field (`summarizedField` / `summaryForeignKey`
  pointing outside the schema) warns `UNSUPPORTED:rollup-target` and skips the field, the same
  degrade pattern as `UNSUPPORTED:reference-target` in phase 3.
- **D-08:** Roll-up over a lookup that is neither master-detail nor whitelisted (D-05) is the one
  hard failure (ROLL-02), everything else degrades with a warning.

### Import mode and backfill
- **D-09:** `orglet up --import` keeps the roll-up values supplied by the source org as-is (import
  mode already writes read-only stored fields directly) and performs no recompute. The org's value
  is the truth for imported data.
- **D-10:** When `migrate()` adds a new roll-up column to an org that already has rows, it backfills
  that column once with a full recompute for that field. No new CLI command in this phase.

### Claude's Discretion
- Exact shape of `RollupDef`, `RollupRegistry` and `rollups.ts` (research proposes a module
  parallel to `formulas.ts`, indexed by child object).
- Filter operator semantics for each documented `summaryFilterItems` operation, including
  field-to-field `valueField` comparisons, and date-literal handling where the platform allows it.
- How multi-level chains recurse (recompute of a parent that is itself a detail triggers its
  grandparent) and the recursion guard.
- Fixture design in `examples/acme` (an Account ← Project__c ← Milestone__c master-detail chain
  already exists) and in-memory `OrgSchema` fixtures for edge cases (phase 4 D-13 pattern).
- Describe shape beyond `createable: false`, `updateable: false`, `calculated: true` (ROLL-07).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project research
- `.planning/research/ARCHITECTURE.md` §"Feature 2: Roll-Up Summary Fields" (lines ~141-235) —
  storage design (no new `FieldType`, `FieldDef.rollup` marker on a stored column), parsing in
  `sfdx.ts`/`build.ts` second pass, `rollups.ts` registry, batched `UPDATE ... LEFT JOIN`, call
  sites in `saveBatch`/`deleteBatch`/`undeleteBatch`, Anti-Pattern 1 (no Postgres triggers)
- `.planning/research/PITFALLS.md` — roll-up related pitfalls
- `.planning/REQUIREMENTS.md` §"Roll-Up Summary Fields" (ROLL-01..ROLL-09)
- `.planning/ROADMAP.md` §"Phase 5" — success criteria and the research flag: verify reparent and
  undelete recompute triggers against Salesforce Help article `000391766` or equivalent

### Prior phase decisions that bind here
- `.planning/phases/04-polymorphic-lookups-soql-typeof/04-CONTEXT.md` D-13 (in-memory `OrgSchema`
  for edge-case tests), D-14 (SDK verification pattern)
- `.planning/phases/03-thin-standard-object-baselines/03-CONTEXT.md` — DE-retrieve validation is
  Johan's local checkpoint, never in repo or CI; `UNSUPPORTED:reference-target` degrade pattern

### Salesforce public documentation (build only from these, never from org behaviour)
- Metadata API Developer Guide, `CustomField` (`summarizedField`, `summaryForeignKey`,
  `summaryOperation`, `summaryFilterItems` / `FilterItem` with `field`, `operation`, `value`,
  `valueField`)
- Salesforce Help, "Roll-Up Summary Field" and "Order of Execution" (roll-up recompute after the
  triggering record's after-triggers; parent triggers and validation rules run on the parent)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/engine/src/formulas.ts` `FormulaRegistry` — the shape `rollups.ts` should mirror
  (built once per `OrgSchema` in the `DmlEngine` constructor).
- `packages/engine/src/engine.ts` `defaults()` — the existing extension point for initial
  `0`/`null` roll-up values on parent insert (D-04).
- `packages/engine/src/coerce.ts` `coerceRecord()` — already rejects client values for
  `createable: false` / `updateable: false` fields with `notWritable`; marking roll-ups read-only
  in `build.ts` is sufficient for ROLL-07 (import mode already bypasses this for stored fields,
  which is what D-09 relies on).
- `packages/metadata/src/build.ts` dangling-reference second pass — the place to resolve
  `summarizedField`/`summaryForeignKey` and apply D-05..D-08.
- `packages/schema/src/columns.ts` `isVirtual()` / `sqlTypeFor()` — a roll-up resolved to
  Number/Currency/Percent/Date/DateTime gets a real column with no schema-package change.
- `examples/acme` already has master-detail `Project__c.Account__c` (standard parent) and
  `Milestone__c.Project__c` — a ready two-level chain for fixtures.

### Established Patterns
- One transaction per DML call, one savepoint per record (`SAVEPOINT rec`); D-03 adds nested
  savepoints per affected parent after the loop.
- `runHooks(session, obj, operation, "before"|"after", work)` is the only hook seam.
- Warnings are collected as strings and printed by the CLI as `warning: UNSUPPORTED:<area> ...`.
- `packages/metadata/src/sfdx.ts` line ~162 currently force-skips `Summary` with
  `UNSUPPORTED:field-type`; that branch goes away (ROLL-09).

### Integration Points
- `saveBatch`, `deleteBatch`, `undeleteBatch` in `engine.ts` each get one recompute call after
  the child's after-hooks.
- `migrate()` in `packages/schema` gets the D-10 backfill hook for newly added roll-up columns.
- Describe (`packages/api`) must emit `calculated: true` alongside the read-only flags.
- Johan's DE retrieve has one `Summary` field: `ObjectBackup__c.Last_Backup_Run__c`, MAX over
  `ObjectBackupRun__c.CreatedDate` (a DateTime system field) with one `equals` filter on a
  picklist, over master-detail `ObjectBackupRun__c.ObjectBackup__c`. ROLL-09 is checked locally by
  Johan, not in repo or CI.

</code_context>

<specifics>
## Specific Ideas

- The DE field summarises `CreatedDate`, so MIN/MAX over Date/DateTime (ROLL-01) and over system
  fields must work from day one, not only over custom numeric fields.
- A parent validation rule referencing a roll-up field must be able to block a child insert, as on
  the platform (D-01).

</specifics>

<deferred>
## Deferred Ideas

- `orglet rollup --recompute [Object.Field]` CLI command for manual recomputation after import or
  data repair (D-10 chose migrate-time backfill only).
- Recomputing roll-ups after `orglet up --import` (D-09 keeps org values).

### Reviewed Todos (not folded)
- "Narrow baseline OwnerId referenceTo per object" — metadata/polymorphic follow-up from phase 4,
  unrelated to roll-ups.
- "Reword ROADMAP phase 7 to validate against the DE retrieve, not the org" — planning wording,
  belongs to phase 7.
- "Support Relationship:Object.Field colon syntax for polymorphic formula references" — sigha
  upstream work, unrelated.

</deferred>

---

*Phase: 05-roll-up-summary-fields*
*Context gathered: 2026-10-09*
