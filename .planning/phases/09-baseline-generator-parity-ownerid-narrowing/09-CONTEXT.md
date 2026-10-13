# Phase 9: Baseline Generator, Parity & OwnerId Narrowing - Context

**Gathered:** 2026-10-13
**Status:** Ready for planning

<domain>
## Phase Boundary

A deterministic, licence-attributed generator under `scripts/` replaces the hand-written standard-object
baseline JSON. Regenerating the existing 35 objects first reproduces their v1.0 shape (no-op diff), then
adds every documented API field, includes feature-gated fields as nullable tagged fields, and narrows
`OwnerId.referenceTo` per object from the Object Reference. A v1-vs-v2 diff gate and a MasterDetail
refusal protect existing databases; the Phase 8 upgrade test must stay green with the v2 baseline.

Out of scope here: the 18 new business objects (Phase 10), colon syntax and `!` (Phase 12), the check
report (Phase 14). Only standard objects are touched; custom-object behaviour is unchanged.

Requirements: BASE2-01, BASE2-02, BASE2-03, BASE2-04, MIGR-03 (BASE2-05 is done in Phase 8; this phase
supplies the `keyPrefixSource` labels it left to the generator, see D-07).

</domain>

<decisions>
## Implementation Decisions

### Sources and the "verified" rule
- **D-01:** Two committed, licence-attributed snapshots feed the generator. (a) The sf-skills dataset
  `enterprise_api/<Object>.json` (Apache-2.0, Salesforce, Inc.) for exactly the objects orglet models,
  vendored by a `scripts/sync-sfdocs.sh <sha>`-style script that pins a commit SHA and copies LICENSE
  plus a VENDOR.md (SHA, date), following the sigha precedent. (b) A normalised per-object extraction of
  the public Object Reference PDF (`https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/object_reference.pdf`,
  reachable: HTTP 200, 21 MB, Last-Modified 2026-10-09) produced locally with `pdftotext` (installed,
  26.04.0) by a committed snapshot script. The extraction holds only facts (field name, type, flags,
  length, Reference To, relationship names); no documentation prose. The PDF itself is never committed
  (size and Salesforce copyright). VENDOR.md records the PDF URL, Last-Modified and sha256.
- **D-02:** The generator (`pnpm baseline:gen` or similar) is pure and offline: it reads only the
  committed snapshots and overrides and never touches the network. The two snapshot scripts are the only
  network steps, run manually, never in CI. CI runs the generator against the committed inputs as a
  drift gate.
- **D-03:** A field present in only one source is included and marked (`sdk-only` or `doc-only`). A fact
  (type, flag, length, target) is `verified` only when both sources agree. A disagreement between the
  sources is never resolved silently: it must be settled by an `overrides.json` entry with a reason
  (BASE2-01); until then the generator reports it as a conflict (abort vs. emit-and-mark is Claude's
  call, see discretion).
- **D-04:** Provenance (verified / sdk-only / doc-only / guessed / v1.0 / override) lives in a separate
  committed report next to the objects (for example `packages/metadata/standard/PROVENANCE.json`), not
  in the object JSON. The object files keep the exact v1.0 `StandardObjectJson` shape so the no-op diff
  of SC2 is genuine. The loader and describe never read the provenance file; `orglet check` may.
- **D-05:** A text-like field (`string`, `textarea`, `phone`, `url`, `email`) with no length in either
  source (no length column, no "Maximum size is N characters") gets `length: 255` and is marked
  `guessed` in the provenance report so `overrides.json` can correct it later.
- **D-06:** A field that v1.0 has but neither source mentions (research spotted `Account.Tier`) is kept
  through an `overrides.json` "keep" entry with the reason "present in v1.0, absent from sources" and
  provenance `v1.0`. It leaves only when someone deliberately adds a diff-allowlist entry (D-16).
- **D-07:** Key prefixes of the 35 existing objects are hand facts in `overrides.json`. All 35 keep
  their prefix; none becomes null in this phase (they are v1.0 data, the diff gate protects them, and
  a null prefix requires `createable: false` per Phase 8 D-10). The generator writes `keyPrefixSource`
  for each: `doc` when public Salesforce documentation confirms it (for example the public record-ID
  prefix article), `sdk-fixture` when a public SDK fixture (jsforce, simple-salesforce) confirms it,
  otherwise `unverified`. Never from an org. The two-independent-sources rule of BASE2-05 applies in full
  to objects added from Phase 10 on.

### Feature-gated fields
- **D-08:** Gating is detected by a committed keyword list in the generator configuration (Person
  Accounts, Data.com/Jigsaw, Territory Management, Knowledge, Omni-Channel, Field Service, Social,
  Chatter, and phrases such as "available when/if X is enabled") matched against the sources' prose at
  generation time. Prose is read, never emitted. `overrides.json` can force a field gated or not gated
  with a reason. The generator report lists every heuristic hit so the list is reviewable in the PR.
- **D-09:** A gated field keeps its documented `createable`/`updateable` flags; `nillable` is forced
  `true` so a field no org may have never yields `REQUIRED_FIELD_MISSING`. It is tagged
  `featureGated: true` in the baseline JSON (new optional key on `StandardFieldJson`), replacing the v1.0
  README rule of skipping such fields.
- **D-10:** The tag is not exposed in describe. Describe shows the field as a plain nullable field with the
  exact Salesforce key set (the describe-check contract compares key sets against the SDKs). The tag is
  visible in the baseline JSON and in the `orglet check` output. SC3's "tagged `featureGated`" is
  satisfied at baseline/check level, not as a describe key.

### OwnerId narrowing (folds todo 2026-10-08-narrow-baseline-ownerid-per-object)
- **D-11:** `StandardObjectJson.ownerTargets?: ("User" | "Group")[]` is an object-level key; absent
  means `["User", "Group"]` (today's behaviour). The README rule that OwnerId is never listed in
  `fields[]` stays; `build.ts#systemFields` threads `ownerTargets` into `OwnerId.referenceTo`. The
  generator writes it for every owned object from the Object Reference "Reference To" line, following
  the BASE2-04 list (User-only: Account, Contact, Opportunity, Contract, Asset, Campaign, Individual,
  Solution; User and Group: Case, Lead, Task, SocialPost, Location, ContactRequest, WorkOrder,
  ServiceAppointment, OperatingHours, ServiceContract; none on Quote-family, Entitlement, Product2,
  Pricebook2, PricebookEntry, EmailMessage, FeedItem, Address). Each override carries reason and source.
- **D-12:** Event (documented as Calendar and User) gets `ownerTargets: ["User"]` through an override
  with the reason "Calendar not modelled; widen when a Calendar object lands". No object is invented.
- **D-13:** Custom objects (`__c`) keep `["User", "Group"]`. Reading `queues/*.queue-meta.xml` to
  narrow them is a deferred idea (see below).
- **D-14:** An existing database holding a queue-owned row on a now-User-only object gets the Phase 8
  behaviour: `migrate()` skips the new OwnerId FK with one `UNSUPPORTED:schema-fk` warning and rewrites
  nothing; the FK is added silently once the data is corrected. The upgrade-test fixture is not extended
  with such a row (its Group-owned rows are Cases, which stay queue-enabled), so `EXPECTED_WARNINGS`
  stays empty unless a plan adds a case deliberately.
- **D-15:** Test disposition follows `08-GROUP-OWNED-AUDIT.md`: Group-owned scenarios on objects that
  become User-only move to Case or Lead; new negative tests assert that a Group Id on `Account.OwnerId`
  is rejected with `INVALID_CROSS_REFERENCE_KEY`; `conformance/poly-check` already uses Case and is
  unchanged; the audit's "Phase 9 disposition" column is filled in by the plan that touches each row.

### v1-vs-v2 diff gate and allowlist (MIGR-03)
- **D-16:** The allowlist is its own file next to the overrides (`scripts/gen-baseline/diff-allowlist.json`
  or the generator's equivalent location) with entries `{ object, field, kind: "removed" | "narrowed",
  reason }`. `overrides.json` states facts about Salesforce; the allowlist states deliberate migration
  exceptions.
- **D-17:** "Narrows" is schema-level only: a removed field, a changed type, or a decreased
  length/precision/scale, mirroring what `migrate()` reports as `schema-drop`/`schema-narrow`
  (`isWidening`). Flag changes (createable, updateable, nillable, restrictedPicklist) follow the
  documentation freely and need no allowlist entry.
- **D-18:** The gate runs twice: a vitest test under `packages/metadata/test` regenerates in memory and
  compares against the frozen `packages/metadata/test/fixtures/baseline-v1.0` fixture from Phase 8 plus
  the allowlist, with one clear message per offending field; and a CI step `pnpm baseline:gen && git diff
  --exit-code packages/metadata/standard` catches uncommitted regeneration. A new MasterDetail field on an
  object that existed in v1.0 is a generator error (MIGR-03).
- **D-19:** Output is deterministic: fields sorted alphabetically by plain code-unit compare (the v1.0
  files already are, so this is a no-op for them), stable key order matching the existing files,
  2-space JSON, trailing newline, no timestamps. New databases get the sorted order; existing databases
  are unaffected because `migrate()` appends new columns.

### Claude's Discretion
- Generator location and layout (research recommends `scripts/gen-baseline/` run with `tsx`, not a
  workspace package), pnpm script names (`baseline:gen`, `baseline:snapshot`, ...), and the format of
  the generator report and of the provenance file.
- The SOAP-type to `FieldType` mapping table, the string-length extraction rules and the single-source
  flag semantics: the ROADMAP research flag is a design spike on exactly these, to be settled in
  research/planning within D-03 and D-05.
- How the pdftotext extraction parses the per-object field tables, and how robust it must be (it is a
  manual, reviewed snapshot step; a diff of the committed extraction is the review).
- Whether a source conflict (D-03) aborts the generator or emits the sf-skills value marked `conflict`;
  in both cases the report names it and the committed baseline must contain no unresolved conflict.
- Whether the v1.0 `description`-free README rules are restated in a generated-file header comment or
  only in README.md (no prose from Salesforce either way).

### Folded Todos
- **Narrow baseline OwnerId referenceTo per object** (`.planning/todos/pending/2026-10-08-narrow-baseline-ownerid-per-object.md`):
  baseline gives every owned object `["User","Group"]`, so `Account.Owner.Department` in SOQL and
  `Owner.Alias` in an Account formula fail although a real org accepts them. Fully covered by D-11..D-15
  and BASE2-04; the todo moves to done when the phase completes.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` §"Phase 9: Baseline Generator, Parity & OwnerId Narrowing" — goal, five success criteria, research flag (design spike on type mapping, string-length rules, single-source flags)
- `.planning/REQUIREMENTS.md` — BASE2-01..BASE2-04 and MIGR-03 (this phase), BASE2-05 (done, labels pending), BASE2-06..08 (Phase 10, do not pull in)
- `.planning/PROJECT.md` §"Current Milestone: v1.1 real-org fidelity" and §"Constraints" — public-docs-only rule, never diff against a real org, Apache-2.0 dependencies only

### Data sources and generator design (v1.1 research)
- `.planning/research/STACK.md` §1 "Reading the public Object Reference programmatically" — sf-skills dataset location, licence, file layout, what it contains and lacks (precision/scale, picklist values, keyPrefix absent), the five dataset traps, integration sketch
- `.planning/research/FEATURES.md` lines 12-22 — source table with the Object Reference PDF URL and the pdftotext approach; lines ~270-280 — feature-gated field marking
- `.planning/research/ARCHITECTURE.md` §5 "Baseline generator: location and reproducibility", §6 "OwnerId referenceTo narrowing per object", §7 "What breaks in migrate() when the baseline grows"
- `.planning/research/PITFALLS.md` B1 (Object Reference is not describe ground truth), B2 (un-skipping cascades), B3 (key prefixes), B4 (standard picklists are per-org), M3 (compound fields), M4 (v1-v2 renames leave permanent warnings), N2 (generated JSON churn)

### Prior phase decisions that bind this phase
- `.planning/phases/08-upgrade-safety-net-nullable-key-prefixes/08-CONTEXT.md` — D-01..D-04 (schema-fk, idempotent second up), D-05..D-07 (upgrade fixture and test), D-08..D-12 (nullable keyPrefix, keyPrefixSource, generator labels all 35), D-22 (Group-owned audit)
- `.planning/phases/08-upgrade-safety-net-nullable-key-prefixes/08-GROUP-OWNED-AUDIT.md` — every test, fixture and conformance leg relying on a Group owner, with an empty "Phase 9 disposition" column this phase fills
- `.planning/phases/08-upgrade-safety-net-nullable-key-prefixes/08-02-SUMMARY.md` and `08-03-SUMMARY.md` — `validateBaseline()` rules, `KeyPrefixProvenance` values, `matchLookupTarget`, what a null prefix may and may not do
- `.planning/phases/04-*/04-CONTEXT.md` D-15/D-16 (if present) — polymorphic traversal gated on `referenceTo.length > 1`; colon syntax deferred to Phase 12

### Baseline contract and precedents in the repo
- `packages/metadata/standard/README.md` — the baseline rules the generator must keep (system fields never listed, defaults for nillable/createable/updateable, compound fields, StandardValueSet binding); its "skip feature-gated fields" rule is replaced by D-08..D-10 and must be rewritten
- `packages/metadata/test/fixtures/baseline-v1.0/README.md` — the frozen v1.0 snapshot the diff gate compares against (never edited)
- `packages/engine/src/upgrade.test.ts` — the populated-upgrade contract (`EXPECTED_WARNINGS`), SC5
- `scripts/sync-sigha.sh` and `packages/sigha/VENDOR.md` — the vendoring precedent (pinned SHA, LICENSE, VENDOR.md, CI sync check) to mirror for the sf-skills snapshot
- `.github/workflows/ci.yml` — where the `baseline:gen` drift step joins `sigha-sync-check`
- `conformance/describe-check/contract.json` — describe key sets per SDK; the reason D-10 keeps `featureGated` out of describe
- `.planning/todos/pending/2026-10-08-narrow-baseline-ownerid-per-object.md` — folded todo

### External (public, read-only; never committed as-is)
- sf-skills dataset: `https://github.com/forcedotcom/sf-skills/tree/main/plugins/builder/salesforce-development/skills/platform-data-and-tooling-api-context-get/assets/enterprise_api` (Apache-2.0, pin a commit SHA)
- Object Reference PDF: `https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/object_reference.pdf` (extraction committed, PDF not)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/metadata/src/types.ts` `StandardObjectJson` / `StandardFieldJson`: the output contract; already has
  `keyPrefix: string | null` and `keyPrefixSource?: KeyPrefixProvenance` (Phase 8). Needs two optional
  additions: object-level `ownerTargets` (D-11) and field-level `featureGated` (D-09).
- `packages/metadata/src/build.ts`: `systemFields(hasOwner)` hardcodes `owner.referenceTo = ["User","Group"]`
  at ~line 114-118 (the single line D-11 threads through); `validateBaseline()` (Phase 8) already rejects
  malformed, duplicate, custom-range and `m0` prefixes and null prefixes without a source: extend rather than duplicate.
- `packages/schema/src/migrate.ts`: `isWidening` defines what counts as a narrowing (D-17 mirrors it);
  `schema-fk` diagnostic and catalog skips (Phase 8) are what D-14 relies on.
- `packages/engine/src/upgrade.test.ts` + `packages/metadata/test/fixtures/baseline-v1.0/`: the frozen
  v1.0 snapshot (35 objects + standardValueSets.json) is the exact comparison basis for the diff gate (D-18).
- `scripts/sync-sigha.sh`: portable, SHA-pinned vendoring with a VENDOR.md section that survives re-sync;
  copy the shape for `sync-sfdocs.sh`.
- `packages/metadata/src/diagnostics.ts` (Phase 8): `Diagnostic`/`SkippedItem` + `pushDiagnostic` for any
  loader-side reporting the baseline changes need (e.g. gated fields listed by `orglet check`).
- `tsx` is already a root devDependency: the generator runs without a build step.

### Established Patterns
- Vendored inputs are pinned by SHA, carry LICENSE + VENDOR.md, and are checked by a CI job that re-syncs
  and diffs (`sigha-sync-check`). The baseline snapshot and the generator drift gate follow the same shape.
- Baseline rules live in `standard/README.md`; the loader adds system fields; `nillable`/`createable`/
  `updateable` default to true and are only written when false. The generator must honour these to
  reproduce v1.0 byte-for-byte.
- Anything the generator cannot establish from public sources is reported, never guessed silently
  (`UNSUPPORTED:<area>` convention); hand facts always live in a committed file with a reason.
- Tests run on pglite by default and on Postgres 16 when `ORGLET_DATABASE_URL` is set; never run
  `pnpm build` in two parallel executors (shared `dist`).
- Requirement IDs are ticked only when the behaviour is actually true (Phase 5/7 precedent).

### Integration Points
- `packages/metadata/standard/objects/*.json` become generator output (committed); `standardValueSets.json`
  stays hand-maintained unless the generator proves it can reproduce it.
- `build.ts#systemFields` ← `ownerTargets`; `fromStandardJson` ← `featureGated` passthrough into `FieldDef`
  (so `orglet check` can list gated fields); describe untouched.
- `.github/workflows/ci.yml`: new drift step (and the sf-skills sync check) beside `sigha-sync-check`.
- `08-GROUP-OWNED-AUDIT.md`: disposition column filled; affected tests in engine/api/soql/formula/schema
  moved to Case/Lead or turned into negative tests per D-15.
- Phase 10 consumes the same generator for the 18 business objects; keep the object list a data input.

</code_context>

<specifics>
## Specific Ideas

- v1.0 conformance excluded the jsforce "insert from file" test because its CSV fixture includes the
  Data.com field `JigsawCompanyId`, which orglet lacked. With Data.com fields included as gated nullable
  fields (D-08/D-09) that exclusion can probably be lifted; a plan may try it and record the result in
  `conformance/jsforce` (keep `not-implemented` if anything else blocks it).
- SC3's wording "tagged `featureGated` in describe" is deliberately read as baseline-level tagging (D-10);
  the verifier should not expect a `featureGated` key in describe output.
- Phase 8's `m0` custom-metadata prefix guard in `validateBaseline()` is a conservative assumption; the
  generator's prefix facts (D-07) should cite a source for the reserved ranges while labelling prefixes.

</specifics>

<deferred>
## Deferred Ideas

- **Narrow custom-object OwnerId from the retrieve's `queues/*.queue-meta.xml`** (a custom object no Queue
  lists becomes User-only). Faithful for a complete retrieve, wrong for a partial one. Not in Phase 9
  (D-13); candidate backlog item.
- **Thin Calendar object** so Event can declare `["User","Calendar"]` as documented. Belongs with the
  object-adding work (Phase 10 or later), not here (D-12).
- **Re-enabling the excluded jsforce insert-from-file conformance test** if Data.com gated fields make it
  pass: optional in this phase, otherwise Phase 14 acceptance.

### Reviewed Todos (not folded)
- **Support Relationship:Object.Field colon syntax for polymorphic formula references**
  (`.planning/todos/pending/2026-10-08-sigha-colon-syntax-for-polymorphic-formula-references.md`):
  high keyword match, but it needs the sigha resync and is scheduled for Phase 12 (Phase 8 D-21 keeps
  the `it.fails` expectation tests red until then).

</deferred>

---

*Phase: 09-baseline-generator-parity-ownerid-narrowing*
*Context gathered: 2026-10-13*
