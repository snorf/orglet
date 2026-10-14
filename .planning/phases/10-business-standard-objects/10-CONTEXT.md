# Phase 10: Business Standard Objects - Context

**Gathered:** 2026-10-14
**Status:** Ready for planning

<domain>
## Phase Boundary

The 18 business objects (Quote, QuoteLineItem, Order, OrderItem, AccountContactRelation,
AccountTeamMember, OpportunityTeamMember, OpportunityContactRole, OpportunitySplit,
ContractLineItem, CaseContactRole, CaseMilestone, EmailMessage, ContentDocument, ContentVersion,
FeedItem, Location, Address) exist as generated baseline objects produced by the Phase 9
generator, with documented key prefix (or null per BASE2-05), name field, system fields,
documented API fields and explicit DML flags. DML against them respects the documented flags
(`INVALID_TYPE_FOR_OPERATION`), lookups to them are validated like any other baseline target, and
`orglet check` gains an informational category for unmodelled standard objects that nothing
references, which never fails `--strict`. Blob fields are omitted and listed in the generator
report. `conformance/run-all.sh` stays green.

Out of scope: any object beyond the 18 (OpportunitySplitType, Calendar, ContentDocumentLink),
automations on the objects (quote sync, order activation, feed generation, Email-to-Case,
entitlement milestones), blob upload/download (FILE-01), `--summary`/`--json` report work
(Phase 14), and the sigha colon-syntax todo (Phase 12).

</domain>

<decisions>
## Implementation Decisions

### Key prefix policy for the single-list objects
- **D-01:** The six prefixes known from only one community list (AccountTeamMember `01M`,
  ContentVersion `068`, ContentDocument `069`, FeedItem `0D5`, EmailMessage `02s`,
  OpportunitySplit `049`) are verified in two steps. Research first looks for a second
  independent public source (SDK test fixtures, Salesforce documentation, PDF extract). Where
  none is found, an execution checkpoint asks Johan to confirm from his own Developer Edition
  describe; the confirmed value is stored in `overrides.json` with `source: "de-describe"` and
  `ref: "author's own DE describe, <date>"` (Phase 3 D-03a precedent). Nothing is guessed.
- **D-02:** If a prefix stays single-source after the checkpoint and the object is documented as
  createable, BASE2-05/Phase 9 D-07 win: the prefix is stored as `null` with its source label,
  the object becomes `createable: false`, and the BASE2-07 line gets a dated deviation note for
  that object. Faithful over convenient.
- **D-03:** The twelve prefixes where two community lists agree (Quote `0Q0`, QuoteLineItem
  `0QL`, Order `801`, OrderItem `802`, AccountContactRelation `07k`, OpportunityTeamMember
  `00q`, OpportunityContactRole `00K`, ContractLineItem `811`, CaseContactRole `03j`,
  CaseMilestone `555`, Location `131`, Address `130`) use the existing `unverified` source
  value with a `ref` in `overrides.json` naming both lists. No fifth `KeyPrefixProvenance`
  value is added. If research finds any of them in the Object Reference extract or an SDK
  fixture, that one is upgraded to `doc` / `sdk-fixture` with the ref.
- **D-04:** The prefix checkpoint is an execution-time checkpoint task in the plan, modelled on
  09-06: the executor presents the verification list (object, prefix, sources found, status),
  Johan fills the gaps, then `overrides.json` is written. The verification list the roadmap
  refers to lives in the plan.

### `orglet check`: referenced versus unreferenced standard objects (BASE2-08)
- **D-05:** "Referenced" means named in `referenceTo` of a lookup/master-detail/owner field, a
  roll-up summary's child relationship, a formula path, or a validation-rule formula, in the
  retrieve or in the baseline. A referenced-but-unmodelled object keeps the existing
  `UNSUPPORTED:reference-target` warning (byte-identical string).
- **D-06:** The informational category covers two populations: (a) standard objects present in
  the retrieve that the baseline lacks and that nothing references, and (b) lookup targets the
  generator skipped (`PROVENANCE.json#skipped.referenceTarget`, e.g. ActivityMetric).
- **D-07:** A standard object present in the retrieve (custom fields, layouts, list views) but
  referenced by nothing, and absent from the baseline, is downgraded from the
  `UNSUPPORTED:standard-object` warning to the informational category. Its metadata is still
  skipped. This is the main noise reducer for large orgs (backlog 999.6) and follows the
  BASE2-08 wording literally. Objects that something references keep the warning.
- **D-08:** Rendering: one summary line on stdout, printed always, after the warnings, of the
  form `info: N standard objects not modelled and unreferenced: A, B, C` (sorted). Never
  prefixed `warning:`, never on stderr, never counted by `--strict`. Implemented as a
  `Diagnostic` with its own severity so Phase 14 can expand it into `--summary`/`--json`
  without a string change.
- **D-09:** Roll-up, formula and validation-rule references to an unmodelled object count only
  for the referenced/unreferenced classification. They do not add a second
  `reference-target` warning on top of their own `rollup-*`/formula warnings. Existing warning
  strings and counts stay unchanged.

### Source of object-level facts for the 18
- **D-10:** DML flags (`createable`, `updateable`, `deletable`, `undeletable`, `searchable`)
  are derived from the Object Reference "Supported Calls" line: `snapshot-pdf.ts` gains an
  object-level extraction, the flags land in PROVENANCE as doc-only facts, and only a
  disagreement or a gap is hand-pinned with a reason. The same path serves future objects
  (backlog 999.5). `v1-pins.json` is not extended with non-v1 objects.
- **D-11:** `label`, `labelPlural` and `hasOwner` are derived too: label/labelPlural from the
  sf-skills object JSON, `hasOwner` from whether `OwnerId` appears in the sources' field list.
  The "pin it in v1-pins.json" abort in `pipeline.ts` applies only when the sources do not
  state the fact. `ownerTargets` still follows Phase 9 D-11..D-15 (Order, Location:
  User+Group; ContentVersion, ContentDocument: User only; Quote, QuoteLineItem, EmailMessage,
  FeedItem, Address: `hasOwner: false`); any abort is settled by an `overrides.json`
  `ownerTargets` entry with a reason.
- **D-12:** ContentVersion is `updateable: true`: the Object Reference lists `update()` and
  wins over the REST guide wording (Phase 3 D-04 precedent). The conflict is recorded as the
  override reason so it stays traceable. ContentVersion remains `deletable: false`.
- **D-13:** No object-level `featureGated` tag. Feature-dependent objects (Location,
  AccountTeamMember, OpportunitySplit, EmailMessage) are always present in orglet; the
  dependency is noted in `packages/metadata/standard/README.md`. Field-level gating stays as
  Phase 9 D-08..D-10.

### Companion objects and edge cases
- **D-14:** The 18 are fixed. OpportunitySplitType, Calendar and ContentDocumentLink are not
  added; lookups to them (e.g. `OpportunitySplit.SplitTypeId`) are skipped by the generator
  and listed in the report as today. They stay in backlog 999.5 / FILE-01.
- **D-15:** Lookup error codes: research verifies from public documentation which status code
  Salesforce documents for an unparsable lookup Id versus a well-formed Id with the wrong
  prefix or no matching row. If the docs are silent, v1 behaviour stands (`MALFORMED_ID` for
  unparsable, `INVALID_CROSS_REFERENCE_KEY` for wrong prefix or missing row) and SC2/BASE2-07
  get a dated wording adjustment. No behaviour change without a documented source.
- **D-16:** Conformance: `conformance/describe-check/objects.txt` grows from 14 to 32 objects
  (both SDK legs). Forbidden DML operations (OrderItem undelete; CaseMilestone create and
  delete; ContentDocument create; ContentVersion delete) and `INVALID_CROSS_REFERENCE_KEY`
  are proven in engine/api vitest, following the existing thin-object pattern. No new
  conformance leg.
- **D-17:** No seed rows in `examples/acme` for the read-only objects (CaseMilestone,
  ContentDocument). SC1 needs describe and query, not rows; rows come via `--import` or
  bootstrap seeds when someone needs them.

### Claude's Discretion
- Delivery order of the 18 (research suggests Order/OrderItem/Quote/QuoteLineItem first,
  content/feed/email objects last).
- Handling of the circular FK between `ContentDocument.LatestPublishedVersionId` and
  `ContentVersion.ContentDocumentId` (deferred FK or nullable first insert).
- Re-examining `SKIP_RATIO_MAX` in `packages/metadata/test/documented-fields.test.ts` after
  the 18 land; a changed constant needs the observed ratio in the SUMMARY, as 09-HUMAN-UAT did.
- Postgres lock pressure from 18 extra tables in one `migrate()` transaction (test leg runs
  `maxWorkers: 3`).
- Shape of the generator report entry for omitted blob fields (`ContentVersion.VersionData`
  is already a `base64` skip in `typemap.ts`; the report must list it per BASE2-06).
- How the Supported Calls extraction tolerates PDF layout variance, and how `searchable` maps
  from the `search()` call.
- Exact diagnostic field names for the informational severity, as long as existing
  `Diagnostic` consumers and `toEqual` tests are untouched.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and roadmap
- `.planning/ROADMAP.md` — Phase 10 goal, success criteria 1-4, backlog 999.5 and 999.6
- `.planning/REQUIREMENTS.md` — BASE2-05..08, FILE-01/02, Out of Scope table
- `.planning/PROJECT.md` — legal constraints (public docs only, never diff against a real org),
  UNSUPPORTED convention, key decisions
- `.planning/STATE.md` — decision log

### Milestone research (per-object facts for the 18)
- `.planning/research/SUMMARY.md` — Phase 10 section, OwnerId table, open questions
- `.planning/research/FEATURES.md` §F — per-object key prefix, name field and Supported
  Calls table; single-list prefixes; ContentVersion notes; `CasesId` naming on CaseContactRole
- `.planning/research/PITFALLS.md` — B1, B2, B3, B5, N1, G1
- `.planning/research/ARCHITECTURE.md` — generator and OwnerId sections

### Prior phase decisions that bind this phase
- `.planning/phases/03-thin-standard-object-baselines/03-CONTEXT.md` — DML flags (D-04),
  name fields (D-02), two-source rule and DE-describe exception (D-03/D-03a), import mode (D-08)
- `.planning/phases/08-upgrade-safety-net-nullable-key-prefixes/08-CONTEXT.md` — nullable
  prefixes (D-08..D-12), structured diagnostics (D-13..D-16)
- `.planning/phases/09-baseline-generator-parity-ownerid-narrowing/09-CONTEXT.md` — generator
  design (D-01..D-05, D-19), OwnerId narrowing (D-11..D-15), two-source rule from Phase 10 (D-07)
- `.planning/phases/09-baseline-generator-parity-ownerid-narrowing/09-RESEARCH.md` — generator
  internals
- `.planning/phases/09-baseline-generator-parity-ownerid-narrowing/09-HUMAN-UAT.md` —
  SKIP_RATIO_MAX approval precedent
- `.planning/phases/07-conformance-re-run-milestone-acceptance/07-CONTEXT.md` — `--strict`
  semantics (D-16)
- `.planning/phases/04-polymorphic-lookups-soql-typeof/04-CONTEXT.md` — unmodelled prefix on
  read (D-07/D-19)

### Generator and baseline (code and data)
- `packages/metadata/standard/README.md` — rules for generated files
- `packages/metadata/standard/PROVENANCE.json` — per-fact provenance, `skipped.referenceTarget`
- `scripts/gen-baseline/objects.json`, `overrides.json`, `v1-pins.json`, `diff-allowlist.json`
- `scripts/gen-baseline/pipeline.ts`, `sources.ts`, `typemap.ts`, `snapshot-pdf.ts`,
  `snapshot-lists.ts`, `generate.ts`
- `scripts/gen-baseline/source/sf-skills/VENDOR.md`,
  `scripts/gen-baseline/source/object-reference/VENDOR.md`
- `scripts/sync-sfdocs.sh`
- `.github/workflows/ci.yml` — `baseline-gen-check` drift gate

### Engine, check and conformance
- `packages/engine/src/engine.ts` — `refuse()`, `checkReferences()`
- `packages/engine/src/errors.ts` — `invalidTypeForOperation`, `invalidCrossReference`
- `packages/engine/src/coerce.ts` — `MALFORMED_ID` on unparsable Id
- `packages/schema/src/ids.ts` — `matchLookupTarget`, null-prefix exclusion
- `packages/metadata/src/build.ts` — `standard-object`, `reference-target` warnings,
  `validateBaseline`
- `packages/metadata/src/diagnostics.ts` — `Diagnostic` shape
- `packages/cli/src/main.ts` — `check`, `--strict`
- `packages/api/src/describe.ts` — object summary flags
- `conformance/run-all.sh`, `conformance/README.md`, `conformance/describe-check/objects.txt`,
  `conformance/describe-check/contract.json`

### External public sources (never committed)
- Object Reference PDF: `https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/object_reference.pdf`
- sf-skills enterprise_api: `https://github.com/forcedotcom/sf-skills/tree/main/plugins/builder/salesforce-development/skills/platform-data-and-tooling-api-context-get/assets/enterprise_api`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/gen-baseline/` pipeline: adding an object today means appending to `objects.json`,
  running `scripts/sync-sfdocs.sh` and `pnpm baseline:snapshot`, adding a `keyPrefix` entry in
  `overrides.json`, and running `pnpm baseline:gen`. Object-level pins in `v1-pins.json` are
  currently mandatory (D-11 relaxes this where the sources state the facts).
- `typemap.ts` already skips `base64` as unsupported and `pipeline.ts` records
  `UNSUPPORTED:field-type Object.Field (<token>)` in `report.unsupportedTypes` — the blob
  omission for BASE2-06 is mostly reporting.
- `DmlEngine.refuse()` with `invalidTypeForOperation` covers all five operations from the
  object flags; new objects need no engine change for BASE2-07's first half.
- `checkReferences()` validates lookups by prefix and existence against any modelled target,
  so lookups to the 18 are checked as soon as the objects exist.
- `Diagnostic{area, message, object?, field?, cause?}` and the shared formatter are the hook
  for the informational severity (D-08).
- Thin-object test patterns: `packages/metadata/src/build.test.ts` (`THIN` table),
  `packages/engine/src/engine.test.ts` (per-operation refusal loop),
  `packages/api/src/api.test.ts` (REST 400 envelope), `packages/engine/src/null-prefix.test.ts`.

### Established Patterns
- Hand facts live only in committed files with a reason or ref (`overrides.json`,
  `diff-allowlist.json`); provenance in `PROVENANCE.json`; nothing resolved silently.
- All 34 non-Account baseline objects carry string prefixes with `keyPrefixSource: "unverified"`;
  Phase 10 objects are the first held to the two-source rule (Phase 9 D-07).
- `validateBaseline` hard-fails null prefix with `createable !== false`, duplicate prefixes,
  and custom-range prefixes.
- Warning strings are byte-identical regression guards (`toEqual` tests in
  `packages/cli/src/main.test.ts` and `packages/metadata/src/build.test.ts`).
- `packages/engine/src/upgrade.test.ts` keeps `EXPECTED_WARNINGS = []`: 18 new tables must
  upgrade a populated v1.0 database silently (new tables, ADD COLUMN, FKs only).
- MasterDetail refusal applies only to v1.0 objects; new objects may carry master-detail
  columns (Order→OrderItem, Quote→QuoteLineItem candidates, as the Object Reference states).

### Integration Points
- `scripts/gen-baseline/snapshot-pdf.ts` and `snapshot-lists.ts`: object-level Supported
  Calls extraction (D-10), `NOT_IN_PDF`/`KNOWN_GAPS` lists for any of the 18 absent from the PDF.
- `scripts/gen-baseline/pipeline.ts` ~364-376: object-pin abort and `overrides.json` mandatory
  prefix entry.
- `packages/metadata/src/build.ts` ~494-536: `standard-object` and `reference-target`
  emission, where the referenced/unreferenced classification and the informational line attach.
- `packages/cli/src/main.ts:73-88`: `check` output and `--strict` exit decision.
- `conformance/describe-check/objects.txt`: 14 → 32 objects.
- `conformance/README.md`: recorded warning counts and leg pass counts (prose, updated by hand).

</code_context>

<specifics>
## Specific Ideas

- Verification list format for the plan: one table with object, prefix, source 1, source 2,
  status (verified / needs checkpoint / null), mirrored into `overrides.json` refs.
- The informational line is a single sorted summary, not one line per object, so the DE
  retrieve output stays readable while Phase 14 owns the richer report.
- Judge SC4 by "no `standard-object` or `reference-target` warnings left for referenced
  objects" and record the before/after warning counts in the SUMMARY, not by the raw total
  (PITFALLS B2).
- Any REQUIREMENTS wording change (D-02, D-15) follows the 09-07/09-09 precedent: before/after
  table plus dated deviation note, and the requirement is ticked only when true.

</specifics>

<deferred>
## Deferred Ideas

- **OpportunitySplitType** (prefix `149`) as a thin object so `OpportunitySplit.SplitTypeId`
  can be modelled — backlog 999.5.
- **Calendar** thin object so Event can declare `["User","Calendar"]` — backlog, carried from
  Phase 9.
- **ContentDocumentLink** — FILE-01 / backlog 999.5; likely the first `reference-target` a
  large org hits after this milestone.
- **Object-level `featureGated` tag** — rejected for now (D-13); revisit if a client-visible
  need appears.
- **`community-list` provenance value** — rejected (D-03); `unverified` + ref is enough.
- **Seed rows for read-only objects in `examples/acme`** — not needed for SC1; Phase 14
  acceptance fixture (`examples/enterprise`) may want them.
- **Re-enabling the excluded jsforce insert-from-file conformance test** — carried from
  Phase 9, optional here, otherwise Phase 14.
- **PROJECT.md target-features list names only 15 of the 18** (missing OpportunitySplit,
  CaseContactRole, CaseMilestone) and the BASE2-04 forward clause names Solution,
  ContactRequest and WorkOrder, which are not among the 18 — doc alignment for the plan's
  docs task, not a scope change.

### Reviewed Todos (not folded)
- **Support Relationship:Object.Field colon syntax for polymorphic formula references**
  (`.planning/todos/pending/2026-10-08-sigha-colon-syntax-for-polymorphic-formula-references.md`)
  — matched on keywords only; requires a sigha upstream change and resync, which is Phase 12
  / backlog 999.7. Not Phase 10 work.

</deferred>

---

*Phase: 10-business-standard-objects*
*Context gathered: 2026-10-14*
