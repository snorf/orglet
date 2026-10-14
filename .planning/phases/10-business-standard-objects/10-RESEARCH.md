# Phase 10: Business Standard Objects - Research

**Researched:** 2026-10-14
**Domain:** Offline baseline generator extension (scripts/gen-baseline), 18 generated Salesforce standard objects, `orglet check` classification, conformance
**Confidence:** HIGH for generator/test mechanics (all dry-run in a scratch copy of the repo), MEDIUM for key-prefix provenance and lookup error codes, LOW for object labels and child-relationship names

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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

### Deferred Ideas (OUT OF SCOPE)

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
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BASE2-06 | The 18 objects exist as baseline objects with documented key prefix (or null per BASE2-05), name field, system fields, documented API fields, explicit DML flags; blobs omitted and listed in the generator report | Generator dry-run of all 18 (below): 604 fields generated, 12 field-type skips (2 base64, 4 JunctionIdList, 1 location, rest pre-existing), needs 45 hand `set` overrides, 6 AutoNumber overrides, type-map additions, name-field overrides; Supported Calls extraction for flags |
| BASE2-07 | DML respects documented flags; a lookup to any of the 18 with a malformed or wrong-type Id is rejected | Flags table (Q4) from the cached Object Reference PDF; error-code verdict (Q3): docs support `MALFORMED_ID` for unparsable, are mixed on wrong-type, so v1 behaviour stands and SC2 wording needs a dated adjustment |
| BASE2-08 | `orglet check` separates referenced from unreferenced unmodelled standard objects; unreferenced ones are informational and never fail `--strict` | Q5: `BuildResult.info` side channel keeps the `warnings`/`diagnostics` 1:1 invariant; PROVENANCE.json is not loaded at runtime today; `--quiet` test forces the line through `log(c, ...)` |
</phase_requirements>

## Summary

The generator from Phase 9 handles most of the 18 as-is. A dry run in a scratch copy (all 18 appended to `objects.json`, their sf-skills JSON fetched at the pinned revision, the Object Reference PDF re-extracted from the cached copy `~/.cache/orglet/object_reference-6b9d37316f09.pdf`) produced 604 fields across the 18 files. It also surfaced ten concrete problems that the CONTEXT assumes away; each is a plan task, none is a blocker. The most important: (1) sf-skills has **no object-level label/labelPlural** (D-11 premise is wrong), (2) the PDF states no `Refers To` for 43 required-looking lookups (QuoteLineItem.QuoteId, Order.OpportunityId, AccountContactRelation.AccountId ...), which the generator silently **skips**, leaving the objects unusable unless a `set referenceTo` override is written per field, (3) `FeedItem.ParentId`, `EmailMessage.RelatedToId`, `ContentVersion.FirstPublishLocationId` are polymorphic over 100+ targets and are skipped wholesale (the generator's all-or-nothing rule), (4) no source states a `nameField` or an `AutoNumber` for any of the 18, (5) the Phase 9 generator test deliberately **rejects `de-describe` as a key-prefix source**, which D-01 now needs, (6) `upgrade.test.ts` forbids `CREATE TABLE` in an upgrade, but 18 new objects are 18 new tables.

Key-prefix verdict (Q1): two of the six single-list prefixes now have a Salesforce-documentation source (ContentVersion `068`: REST API Developer Guide; ContentDocument `069`: Object Reference), and Quote `0Q0` from the twelve is upgradable to `doc`. Contrary to the CONTEXT premise, **both** community gists list `01M`, `068`, `069`, `0D5`, `02s`; only OpportunitySplit `049` is in a single list. Lookup error codes (Q3): the docs support v1 for unparsable Ids (`MALFORMED_ID`), mix for wrong-type Ids (one official REST example shows `MALFORMED_ID: ... id value of incorrect type` on a lookup field), and tie `INVALID_CROSS_REFERENCE_KEY` to a non-existent record. Recommendation is that v1 behaviour stands, SC2 wording changes.

**Primary recommendation:** Build the phase in four waves: (0) generator capability work (Supported Calls extraction, label/name/autonumber/type-map/de-describe/`Defaulted on Create` token, test-constant updates), (1) prefix/label checkpoint plus the 18 generated files with ~60 hand overrides, (2) engine/api/metadata tests plus the `upgrade.test.ts` relaxation, (3) `orglet check` informational category, then conformance and docs. Do the sync and snapshot steps with the **pinned inputs** (`sync-sfdocs.sh 4bbae5c4...`, `snapshot-pdf.ts --pdf <cached>`), never against `main`/latest.

## Corrections to CONTEXT premises (read first)

| # | CONTEXT says | Found | Consequence for the plan |
|---|--------------|-------|--------------------------|
| C1 | D-11: label/labelPlural "from the sf-skills object JSON" | sf-skills object JSON has only `title` ("Order - Data API"), `description`, `fields`, `field_reference`, `usage`, `associated_objects`, `wsdl_segment`, `special_access_rules`. No label, no plural. The PDF extraction has none either. | label/labelPlural cannot be derived. Add an object-level hand fact in `overrides.json` (new optional `labels: {label, labelPlural, reason}`) required for every non-v1 object; ask Johan to confirm at the D-04 checkpoint (LOW-confidence proposals below). The pipeline.ts abort stays for label/labelPlural. |
| C2 | D-11: `hasOwner` from "OwnerId appears in the sources' field list" | `Quote` has `OwnerId` in sf-skills `field_reference` only (not in `fields`, not in the PDF). A naive "appears anywhere" rule makes Quote owned, contradicting Phase 9 D-11..D-15 (Quote `hasOwner: false`). | Derive `hasOwner` from sf-skills `fields` OR the Object Reference, never from `field_reference` alone. Result for the 18: true only for Order, Location, ContentDocument, ContentVersion (matches D-11). |
| C3 | D-11: owner-target aborts settled by overrides | No abort occurred. Order and Location derive `Group, User` (= default, nothing written); ContentDocument and ContentVersion derive `User` and get `ownerTargets: ["User"]`. | No `ownerTargets` overrides needed. But `baseline-generator.test.ts` "ownerTargets is written only when narrower" has a hard-coded `USER_ONLY` list; extend it with `ContentDocument`, `ContentVersion`. |
| C4 | Prefix status: six single-list | Both community gists (FishOfPrey KeyPrefixes.html and Synchro sfprefix.php) list `01M`, `068`, `069`, `0D5`, `02s`. Only `049` is single-list. `068`, `069` have Salesforce documentation sources; `0Q0` too. | See Q1: checkpoint is mandatory for `049` only; `01M`, `0D5`, `02s` are D-03-class (two lists) and may ride along at Johan's option. |
| C5 | D-01: stored `source: "de-describe"` | `pipeline.ts` `KEY_PREFIX_SOURCES = ["doc","sdk-fixture","unverified"]` and `baseline-gate.test.ts` "a key prefix sourced from a describe aborts (D-07: never from an org)" assert the opposite. | Phase 10 D-01 is newer and locked: add `"de-describe"` to `KEY_PREFIX_SOURCES`, rewrite that test (de-describe accepted only with a `ref`), update the abort message `doc|sdk-fixture|de-describe|unverified`. Flag to Johan in the plan as an intentional reversal of a Phase 9 guard. |
| C6 | "Normal baseline additions: new tables, ADD COLUMN, FKs only" (upgrade.test) | `upgrade.test.ts` line 117 `FORBIDDEN = /^(CREATE TABLE\|DROP TABLE\|...)/` and expects the filtered statements to be empty. 18 new tables = 18 `CREATE TABLE`. | Narrow the regex: allow `CREATE TABLE <schema>.<t>` only for the 18 new table names, keep forbidding it for the 35 v1.0 tables and keep DROP/ALTER-TYPE forbidden. Also `CREATE SEQUENCE` appears for new AutoNumber fields on the first up (the second-up assertion is unaffected). |
| C7 | Phase 10 diff-allowlist list: Contract.SourceQuoteId, Opportunity.SyncedQuoteId, Entitlement.ContractLineItemId, Asset.LocationId, Entitlement.LocationId, Case.FeedItemId | Only **Contract.SourceQuoteId -> Quote** returns automatically (explicit Refers To). `Opportunity.SyncedQuoteId` is in neither source as a field (it appears only in prose). The other four are "(none stated)" and stay skipped unless a `set referenceTo` override is added (optional, additive). | No allowlist entry is needed for any of them: additive fields never trip the diff gate (which only guards removed/narrowed v1 fields). Whether to un-skip Asset.LocationId etc. is a planner choice; if yes, each is an additive nullable FK column. |
| C8 | D-10: PDF "Supported Calls" per object | Confirmed present for all 18 and extractable (Q2). One object prints `describeLayout()describeSObjects()` without a comma (ContentDocument), FeedItem prints the calls in non-alphabetical order, long lists wrap to a second line. | Tokenise with `/([A-Za-z]+)\(\)/g`, not split-on-comma; validate against a closed vocabulary. |
| C9 | D-08 "printed always" (info line) | `main.test.ts` "--quiet does not hide warnings..." asserts `expect(logs).toEqual([])` under `--quiet`, and "prints nothing with --quiet" likewise. A population (b) line is non-empty for every project (23 unmodelled skipped targets today, 39 after this phase). | Print the line through the existing `log(c, ...)` (quiet-gated), after the warning loop. "Always" then means "independent of `--strict` and of warnings", not "independent of `--quiet`". Flag the interpretation in the plan. |
| C10 | `check` can read `PROVENANCE.json#skipped.referenceTarget` | `PROVENANCE.json` ships in the package (`files: ["dist","standard"]`) but `loadBaseline()` does not read it; nothing at runtime does (only two test files). | `loadBaseline()` must read it (optional file; absent in test baseline fixtures `baseline-v1.0`, `NULL_PREFIX`). See Q5. |

## Standard Stack

No new runtime libraries. Everything extends existing in-repo tooling.

### Core
| Library / tool | Version | Purpose | Why standard |
|----------------|---------|---------|--------------|
| `scripts/gen-baseline` (tsx 4.x, TypeScript 5.9.3) | repo | Offline generator: sources -> `packages/metadata/standard/objects/*.json` + `PROVENANCE.json` | The Phase 9 decision; hand facts live only in committed files with a reason |
| poppler `pdftotext -layout` | 26.04.0 (installed; matches the pin in `object-reference/VENDOR.md`) | Object Reference PDF -> text for the snapshot step | Already the extractor; version is recorded in VENDOR.md |
| vitest | 3.2.7 | All verification | Existing |
| sf-skills enterprise_api snapshot | revision `4bbae5c421e51b40e4169afa72c4496372a602a7` | Source 1 (all 18 exist upstream at this revision) | Vendored, Apache-2.0 |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `community-list` provenance value | `unverified` + `ref` naming the lists | Locked by D-03; no fifth value |
| Reading `PROVENANCE.json` at check time | A small dedicated `skipped-targets.json` emitted by the generator | Extra generated file and drift-gate surface; PROVENANCE already has the data. Prefer reading PROVENANCE (optional file). |

**Installation:** none. Re-pinned inputs, in this order, from the repo root with Node 22 (`nvm use`; this shell defaulted to Node 18 and has no `pnpm` on PATH, run `corepack enable pnpm` first):
```bash
# 1. add the 18 names to scripts/gen-baseline/objects.json (alphabetical, as the file is today)
# 2. sf-skills: PIN THE EXISTING REVISION; the script defaults to `main` and would re-pin all 35 files
bash scripts/sync-sfdocs.sh 4bbae5c421e51b40e4169afa72c4496372a602a7
# 3. Object Reference: reuse the cached PDF whose sha256 equals the pin (6b9d3731...), otherwise the download is a newer PDF
pnpm baseline:snapshot -- --pdf ~/.cache/orglet/object_reference-6b9d37316f09.pdf
```

**Version verification:** `pdftotext -v` -> 26.04.0 (verified 2026-10-14); the cached PDF's sha256 prefix `6b9d37316f09` equals the VENDOR.md pin. `git diff --stat scripts/gen-baseline/source/sf-skills` after step 2 must show only 18 added files and an updated file list in VENDOR.md; any change to an existing file means the revision drifted.

## Architecture Patterns

### Recommended wave structure
```
Wave 0  Generator capability (no data change to the 35)
  - snapshot-pdf.ts: object-level supportedCalls; "Defaulted on Create" token; DOC_ONLY_REVIEWED Quote.InsuranceQuoteType
  - sources.ts/pipeline.ts: parse supportedCalls, derive flags, labels via overrides, hasOwner rule, de-describe source
  - typemap.ts: five new type tokens
  - tests: object-reference-snapshot, baseline-gate (de-describe), baseline-generator (USER_ONLY)
Wave 1  Data
  - sync + snapshot with pinned inputs; D-04 checkpoint; overrides.json (prefix, labels, names, refs); baseline:gen
  - PROVENANCE/report review; SKIP_RATIO_MAX check; README/standard docs
Wave 2  Behaviour tests + upgrade
  - build.test THIN-style table for 18; engine refusal + reference tests; api 400 envelope; upgrade.test relax
Wave 3  orglet check informational category (independent of Wave 1 data except tests)
Wave 4  conformance objects.txt 14 -> 32, README numbers, REQUIREMENTS wording, SUMMARY with before/after counts
```

### Pattern 1: Object-level facts live in the extraction, not in pins
**What:** `snapshot-pdf.ts` writes `supportedCalls: ["create","delete",...]` (sorted, facts only) beside `fields` in each `object-reference/<Object>.json`. `parseObjectReference` accepts it (optional). `pipeline.ts` maps tokens to flags and writes only the `false` ones plus explicit keys exactly as the 35 files do today.
**When to use:** every object without v1 pins (the 18, and 999.5 successors).

### Pattern 2: Hand fact = `overrides.json` entry with a reason (unchanged)
Per field: `{ "set": { "referenceTo": ["Quote"], "relationshipName": "Quote" }, "reason": "settle-conflicts rule (09-06): field name names modelled object Quote; neither source states Refers To" }` (exact precedent text in `Account.PersonContactId`). `set` key order is enforced by `orderKeys` (`referenceTo` before `relationshipName`).

### Pattern 3: Informational diagnostics are a side channel
`BuildResult.info: InfoDiagnostic[]` where `InfoDiagnostic extends Diagnostic { severity: "info" }`. It never enters `warnings`/`diagnostics`, so the tested invariants `warnings == diagnostics.map(formatDiagnostic)` (migrate.test:186, formulas.test:40, sfdx.test:122) and `--strict` (`warnings.length > 0`) are untouched by construction.

### Anti-Patterns to Avoid
- **Extending `v1-pins.json` with the 18** (D-10 forbids it; it also triggers the MasterDetail-on-v1-object refusal for any object with pins).
- **Pushing the info item into `sink.warnings`**: breaks `--strict` and three equality tests.
- **Deriving `hasOwner` from `field_reference`** (Quote trap, C2).
- **Re-running `sync-sfdocs.sh` / `baseline:snapshot` without pins**: rewrites all 35 source files and shifts `PROVENANCE.json` pins.

## Q1. Key-prefix second sources (D-01, D-03)

Method: grep of every Salesforce-published PDF reachable offline-style (Object Reference, REST API Developer Guide, Metadata API, Bulk/Async, Tooling, SOQL, Streaming) for Ids of each prefix; clones of jsforce, simple-salesforce, sfdx-core, SalesforceMobileSDK-Shared searched for Id-shaped values and quoted prefixes (0 hits); the full sf-skills enterprise_api tree grepped (only the `sfdc://069B0000000omjh` rich-text example); the two gists and three community pages fetched.

### Six single-list prefixes (D-01)

| Object | Prefix | Source 1 | Source 2 | Verdict |
|--------|--------|----------|----------|---------|
| ContentVersion | `068` | Gist FishOfPrey KeyPrefixes.html: `068 ContentVersion` | **REST API Developer Guide** (`api_rest.pdf`, "Example response body for inserting a ContentVersion", multipart insert of `VersionData`): `"id" : "068D00000000pgOIAQ"` ; Synchro gist; automationchampion list | **`doc`**. `ref`: `REST API Developer Guide, Insert a ContentVersion: example response id 068D00000000pgOIAQ` |
| ContentDocument | `069` | FishOfPrey gist | **Object Reference** ContentDocumentLink Usage: `SELECT ContentDocument.title FROM ContentDocumentLink WHERE ContentDocumentId = '069D00000000so2' ...`; Synchro gist | **`doc`**. `ref`: `Object Reference, ContentDocumentLink Usage: ContentDocumentId = '069D00000000so2'` (the value sits in a `ContentDocumentId` filter, unambiguous) |
| FeedItem | `0D5` | FishOfPrey gist | Synchro gist (`0D5 => FeedItem ... at least three object types ... same keyPrefix`), automationchampion; the Object Reference ContentDocumentLink example uses `LinkedEntityId = '0D5000000089123'` but its prose says "Chatter group", so it is **not** usable as evidence | `unverified` (two lists); not documentation. Optional checkpoint item. Note the Synchro gist's warning that 0D5 is shared by FeedItem, NewsFeed, UserProfileFeed |
| EmailMessage | `02s` | FishOfPrey gist (`02S` is HTML_COMPONENT, different case) | Synchro gist `02s => EmailMessage`; automationchampion; massmailer.io glossary | `unverified` (two lists). Optional checkpoint item. Case matters: `02s` vs `02S` |
| AccountTeamMember | `01M` | FishOfPrey gist `01M AccountTeamMember` | Synchro gist `01M => ACC_TEAM_MEMBER` (internal entity name, same prefix). Case twin: `01m` is BusinessHours | `unverified` (two lists, one under an internal name). Optional checkpoint item |
| OpportunitySplit | `049` | FishOfPrey gist only | none: Synchro gist, apexhours, AutoRabit and automationchampion have no OpportunitySplit row; apexhours has `OpportunitySplitType 149` | **none found: mandatory D-04 checkpoint.** Fallback D-02 (null prefix, `createable: false`) if Johan's DE has no splits enabled (describeGlobal omits feature-gated objects) |

### Twelve two-list prefixes (D-03)

| Object | Prefix | Lists seen (all community) | Documentation / SDK evidence | Status |
|--------|--------|----------------------------|------------------------------|--------|
| Quote | `0Q0` | FishOfPrey, Synchro, automationchampion | **Object Reference** Java sample under Opportunity SyncedQuoteId: `opp.setSyncedQuoteId(new ID("0Q0D000000002OZ"))` | **upgrade to `doc`** |
| QuoteLineItem | `0QL` | both gists, apexhours, AutoRabit, automationchampion | none | `unverified` + ref |
| Order | `801` | both gists, apexhours, AutoRabit, automationchampion | Object Reference JSON sample `"ChangeOrderId": "801xx000003Gd01111"` (a Revenue Cloud ChangeOrder Id; plausibly an Order Id but not stated) | `unverified` + ref (do not upgrade on an inference) |
| OrderItem | `802` | same four | none | `unverified` |
| AccountContactRelation | `07k` | both gists, automationchampion (not apexhours/AutoRabit in my fetch) | none | `unverified`. Case twin `07K` ComponentFeatureDependency |
| OpportunityTeamMember | `00q` | both gists, automationchampion | none | `unverified`. Case twin `00Q` Lead |
| OpportunityContactRole | `00K` | both gists, apexhours, automationchampion | none | `unverified`. Case twin `00k` OpportunityLineItem |
| ContractLineItem | `811` | both gists, apexhours, AutoRabit, automationchampion | none | `unverified` |
| CaseContactRole | `03j` | both gists (Synchro), automationchampion | none | `unverified`. Case twin `03J` ChatterMessage |
| CaseMilestone | `555` | FishOfPrey, apexhours, AutoRabit, automationchampion (not Synchro) | none | `unverified` |
| Location | `131` | FishOfPrey, apexhours, AutoRabit, automationchampion | none | `unverified` |
| Address | `130` | FishOfPrey, apexhours, AutoRabit, automationchampion | none | `unverified` |

Source URLs: gists `https://gist.github.com/FishOfPrey/05f7a742757fce071a09`, `https://gist.github.com/Synchro/2c6186203c15dc2bd14bd2c7f6396583`; `https://www.apexhours.com/salesforce-object-key-prefix/`, `https://www.autorabit.com/blog/salesforce-object-prefixes-cheat-sheet/`, `https://automationchampion.com/2024/01/22/salesforce-object-key-prefix-list-2/`. Whether the lists are independent of one another cannot be proven; they differ in naming (Synchro uses internal names), so treat "two lists" as D-03 defines it. The lists were read through a summarising fetch tool; the gist rows were verified by parsing the raw gist files (HIGH), the three web pages are MEDIUM.

**Case-twin collision (new pitfall, HIGH):** three of the 18 differ from an existing v1 prefix only by case: `01M` (new) / `01m` BusinessHours, `00q` / `00Q` Lead, `00K` / `00k` OpportunityLineItem. Prefix matching in code is exact-case (`matchTargetByPrefix` uses `===`; `validateBaseline` uses an exact-case `Map`), so no collision is flagged and none occurs, but this is exactly where a stray `.toLowerCase()` or a case-insensitive collation would break Id routing. Add a test that lookups route `00q...` to OpportunityTeamMember and `00Q...` to Lead.

### Verification list for the D-04 checkpoint (format the plan should use)

| Object | Prefix | Source 1 | Source 2 | Status | Ask Johan? |
|--------|--------|----------|----------|--------|-----------|
| OpportunitySplit | `049` | FishOfPrey gist | none | needs checkpoint | **yes (mandatory)** |
| AccountTeamMember | `01M` | gist | Synchro gist | two lists | optional |
| FeedItem | `0D5` | gist | Synchro gist | two lists | optional |
| EmailMessage | `02s` | gist | Synchro gist | two lists | optional |
| ContentVersion | `068` | gist | REST guide | verified `doc` | no |
| ContentDocument | `069` | gist | Object Reference | verified `doc` | no |
| Quote | `0Q0` | gist | Object Reference | verified `doc` | no |
| other 11 | see table | two lists | - | `unverified` + ref | no |

Because the same sitting can cover them, recommend the checkpoint asks Johan for one batch from his DE `describeGlobal`/describe: prefix for `049`, `01M`, `0D5`, `02s` (if present in his DE), the 18 labels/plurals (LOW proposals below), the name field of Order, EmailMessage, OpportunityTeamMember, ContentDocument, and the `childRelationships` names for Order->OrderItem, Quote->QuoteLineItem, Opportunity->Quote/OpportunityContactRole/OpportunityTeamMember/OpportunitySplit, Case->CaseContactRole/CaseMilestone/EmailMessage. Each answer is recorded as `de-describe` with `ref: "author's own DE describe, <date>"`.

## Q2. Supported Calls extraction (D-10, D-11)

### Layout in the PDF text (verified on the cached PDF, `pdftotext -layout`)
Per object section, after the heading and description paragraph(s) and **before** the first `Field Name / Details` table header:

```
      Supported Calls
      create(), delete(), describeLayout(), describeSObjects(), getDeleted(), getUpdated(), query(),
      retrieve(), search(), undelete(), update(), upsert()
```
- Label line `Supported Calls` indented 6 spaces; value lines at the same indent; ends at the first blank line. Value can wrap (ContractLineItem, Order, Quote ...).
- A running page header/footer can sit between the heading and the label (ContentVersion has a Note and a page break first). Search the whole TOC-bounded section (`sectionLines()` output), not a fixed number of lines. **Do not search the whole text for a bare heading** (a global heading search returned wrong sections for Campaign/Opportunity/OpportunityHistory in a quick test; the TOC-based `sectionLines` is correct).
- Variance seen in the 18: `ContentDocument` prints `describeLayout()describeSObjects()` (missing comma); `FeedItem` prints `describeSObjects(), describeLayout()` (order). Tokenise with `/([A-Za-z]+)\(\)/g`; validate each token against the closed set `create delete describeLayout describeSObjects getDeleted getUpdated query retrieve search undelete update upsert`; an unknown token fails the snapshot like `KNOWN_PROPERTY_TOKENS`; an object with no `Supported Calls` line in its section is an error (add to a reviewed `NO_SUPPORTED_CALLS` list with a reason, mirroring `NOT_IN_PDF`).
- Associated-object sections (Feed/History/Share) also carry the label; the TOC-bounded section for the object itself does not mix them.

### Where it lands
`object-reference/<Object>.json`: `{ "object": "Order", "supportedCalls": ["create", ...], "fields": {...} }` (sorted array of the tokens as printed, without `()`). `object-reference-snapshot.test.ts` needs `supportedCalls` allowed at top level, token vocabulary checked, and "no prose" extended. Re-running the snapshot with `--pdf <cached>` rewrites all 35 existing files with the one added key (deterministic, small diff); VENDOR.md facts line should mention "object-level Supported Calls tokens".

### Token -> flag mapping (validated)
| Token | Flag | Default when token absent |
|-------|------|---------------------------|
| `create` | `createable` | false |
| `update` | `updateable` | false |
| `delete` | `deletable` | false |
| `undelete` | `undeletable` | false |
| `search` | `searchable` | false |
| `query` | `queryable` (all 18 list it; write only when absent) | false |

Validation of the mapping on existing data: for the 14 Phase-3 thin objects the derived flags equal the committed flags in every case (BusinessHours ... UserLicense, 0 diffs; the Phase 3 flags were themselves derived from Supported Calls). `upsert` is not a flag (engine: createable && updateable).

### Expected flags for the 18 (parsed from the PDF)
| Object | C | U | D | UD | S | Calls line (abridged) |
|--------|---|---|---|----|---|------------------------|
| Quote | y | y | y | y | y | create ... search, undelete, update, upsert |
| QuoteLineItem | y | y | y | y | y | same |
| Order | y | y | y | y | y | same |
| OrderItem | y | y | y | **n** | **n** | no undelete(), no search() |
| AccountContactRelation | y | y | y | n | n | no search/undelete |
| AccountTeamMember | y | y | y | n | n | same |
| OpportunityTeamMember | y | y | y | n | n | same |
| OpportunityContactRole | y | y | y | n | n | same |
| OpportunitySplit | y | y | y | n | n | same |
| ContractLineItem | y | y | y | y | y | full |
| CaseContactRole | y | y | y | n | n | no search/undelete |
| CaseMilestone | **n** | y | **n** | n | n | `describeLayout(), describeSObjects(), query(), retrieve(), update()` |
| EmailMessage | y | y | y | y | y | full |
| ContentDocument | **n** | y | y | y | y | `delete(), describeLayout()describeSObjects(), query(), retrieve(), search(), undelete(), update()` |
| ContentVersion | y | **y** | **n** | n | y | `create(), ..., query(), retrieve(), search(), update(), upsert()` |
| FeedItem | y | y | y | **n** | y | no undelete() |
| Location | y | y | y | y | y | full |
| Address | y | y | y | y | y | full |

ContentVersion: Object Reference lists `update()`; the REST API Developer Guide says "Tip: The ContentVersion object doesn't support updates. Therefore, you can't update a ContentVersion." (`api_rest.pdf`, ContentVersion insert example). D-12 chooses the Object Reference; the `overrides.json` reason must quote both.

### pipeline.ts change (lines ~364-376)
Today: `objectFacts = objectPins?.object ?? {}`; abort unless `label`, `labelPlural`, `hasOwner` all present. New order of precedence for an object **without v1 pins**:
1. `createable/updateable/deletable/undeletable/searchable/queryable`: from `objectReference.supportedCalls` (write the key only when `false`, matching the 35 files: `queryable` is never written today because all are true). A pin (`objectPins.object`) or an `overrides.json` object-level `flags` entry (new, with `reason`) wins; a pin or override that disagrees with the source is recorded as `overrideResolved` (same mechanism as `ownerTargets`). Absent `supportedCalls` and no pin/override -> abort with a message naming the object.
2. `hasOwner`: `OwnerId` in sf-skills `fields` or the Object Reference field list (not `field_reference` alone, C2).
3. `label`, `labelPlural`: **only** from `overrides.json` (new optional `labels`, reason required) or the pin; abort otherwise (C1).
4. `keyPrefixSource: "de-describe"` accepted with `ref` (C5).
v1 objects keep their pins exactly (byte-identical output is asserted by `baseline-generator.test.ts` "v1.0 scope reproduces the frozen v1.0 fixture").

Provenance: record the flag facts in `PROVENANCE.json` per object (`objects.<Name>.flags: "doc-only" | "override"`), "doc-only" because the sf-skills `fields` carry no object-level calls (verified: no "Supported Calls" text in any of the 34 vendored files or the 18 fetched).

## Q3. Lookup error codes (D-15)

| Case | What orglet does today | What public documentation says | Verdict |
|------|------------------------|--------------------------------|---------|
| Unparsable string in a lookup (`"abc"`, 5 chars, bad characters) | `MALFORMED_ID` "`<label>`: id value of incorrect type: abc" (`coerce.ts`/`Errors.malformedId`) | Salesforce Help "Errors due to invalid IDs during Data Loader import and update" (KB 000387915): `MALFORMED_ID: Object name id: id value of incorrect type` occurs with "Invalid ID Characters or ID Length Less Than 15 Characters"; it names a Text column mapped to a Lookup field as a cause. REST API Developer Guide ("Incorrect ID example"): `{"fields":["Id"],"message":"Account ID: id value of incorrect type: 001900K0001pPuOAAU","errorCode":"MALFORMED_ID"}` | **Docs support v1.** The message wording orglet uses is the documented wording. |
| Well-formed Id, wrong object type, in a lookup | `INVALID_CROSS_REFERENCE_KEY` "invalid cross reference id" (`checkReferences`, `matchLookupTarget` mismatch) | REST API Developer Guide (Insert Document with blob, "Example error response"): `{"fields":["FolderId"],"message":"Folder ID: id value of incorrect type: 005D0000001GiU7","errorCode":"MALFORMED_ID"}` - an Id whose prefix `005` is not a folder, on a reference field, is **MALFORMED_ID**. Also four composite examples where a `001...` Id sent for a Contact record Id is `MALFORMED_ID ... id value of incorrect type`. The only sources saying `INVALID_CROSS_REFERENCE_KEY` for wrong type are third-party (salesforcedictionary.com: "the id type doesn't match the field's allowed targets"; xappex, default.com blogs). | **Contradicted by one official example, supported by third-party text.** Not a general statement for lookups (the example is the special `Document.FolderId`). |
| Well-formed Id, right type, no such row | `INVALID_CROSS_REFERENCE_KEY` | Help article 000387915: `INVALID_CROSS_REFERENCE_KEY: invalid cross reference id` under "Incorrect ID for Update or Upsert Operations": verify the Id "corresponds to an existing record". Not stated for insert-time lookups specifically. | **Docs support v1** for update/upsert Ids; silent for lookups on insert. |

Recommendation (apply D-15 literally, and tell Johan): v1 behaviour stands for all three cases (no change to the 35 existing objects, existing tests `engine.test.ts` "thin: ... wrong-prefix Id is INVALID_CROSS_REFERENCE_KEY" and the conformance legs lock it). Dated wording adjustment for SC2/BASE2-07: "a lookup to any of the 18 with an **unparsable** Id is rejected with `MALFORMED_ID`; with a well-formed Id of a wrong type or no matching row, with `INVALID_CROSS_REFERENCE_KEY`". Record in the SUMMARY that one official example (Document.FolderId, `MALFORMED_ID` for wrong prefix) points the other way, as a follow-up candidate (needs a decision from Johan; it would change 35 objects' behaviour, so out of this phase). Sources: `https://help.salesforce.com/s/articleView?id=000387915&language=en_US&type=1` (fetched), REST API Developer Guide PDF `api_rest.pdf` (downloaded and grepped). The SOAP `StatusCode` enumeration page (`sforce_api_calls_concepts_core_data_objects.htm`) returned HTTP 403 to the fetch tool and the SOAP guide PDF path 404s, so its wording could not be quoted (LOW: a search snippet says "an invalid foreign key can't be set on a field"; not verified).

## Q4. Per-object facts for the 18

All 18 exist in the sf-skills tree at the pinned revision (verified against the git tree of `4bbae5c4`), and in the Object Reference (`NOT_IN_PDF` stays empty). `BusinessProcess`'s missing-upstream precedent does not recur. Field counts are the generated counts after the proposed overrides (dry run; includes feature-gated and sdk-only read-only fields; excludes system fields the loader adds).

| Object | Prefix | Name field to set (hand) | hasOwner / ownerTargets | Fields | Notable |
|--------|--------|--------------------------|-------------------------|--------|---------|
| Quote | `0Q0` doc | `Name` (idLookup in PDF; sources disagree on length: sf-skills 255, PDF 225) | false | ~84 | 4 address compounds; `QuoteNumber`; `OwnerId` is in `field_reference` only, must NOT be generated; `InsuranceQuoteType` is doc-only (needs a `DOC_ONLY_REVIEWED` entry or gating) |
| QuoteLineItem | `0QL` | `LineNumber` (AutoNumber, idLookup in PDF) | false | ~77 | `Status` type `dynamic picklist` (type-map); required `Quantity`, `UnitPrice`, `QuoteId`, `PricebookEntryId`, `Product2Id`; Description length 255 vs 225 conflict |
| Order | `801` | `OrderNumber` (AutoNumber, idLookup) | true, default Group+User | ~82 | `Name` also exists (create, nillable, update); `EffectiveDate`, `Status` required |
| OrderItem | `802` | `OrderItemNumber` (AutoNumber, idLookup) | false | ~93 | `OrderId` Lookup (PDF states **lookup**, not master-detail), create-only, required; 5 `timeOnly` fields (type-map); `UnitPrice`/`Quantity` |
| AccountContactRelation | `07k` | none | false | 6 | `AccountId`/`ContactId` Refers To not stated (override) |
| AccountTeamMember | `01M` | none | false | 8 | prefix checkpoint-optional; needs account teams (D-13: always present) |
| OpportunityTeamMember | `00q` | `Name` read-only nillable (decide; PDF lists it with no idLookup) | false | 5 | `PhotoURL`/`PhotoUrl` case duplicate: skip the `field_reference` spelling |
| OpportunityContactRole | `00K` | none | false | 6 | Refers To stated here |
| OpportunitySplit | `049` | `Split` is AutoNumber+idLookup in PDF, but FEATURES §F says none: decide | false | 8 | `SplitTypeId -> OpportunitySplitType` and `Territory2Id -> Territory2` skipped (D-14); `SplitOwnerId -> User` |
| ContractLineItem | `811` | `LineItemNumber` (AutoNumber, idLookup) | false | 14 | all 7 lookups lack Refers To (override) |
| CaseContactRole | `03j` | none | false | 3 | lookup named **`CasesId`** (relationshipName `Cases`), `ContactId` |
| CaseMilestone | `555` | none | false | 23 | `TimeRemainingInHrs/Mins` have type `text` (type-map); `CaseId` Refers To not stated; only update is allowed |
| EmailMessage | `02s` | `Name` is idLookup (read-only); FEATURES lists it as the name | false | 37 | 4 `JunctionIdList` (`BccIds`, `CcIds`, `ContentDocumentIds`, `ToIds`) skipped as unsupported types; `RelatedToId` 106 targets (polymorphic override); `ParentId -> Case` |
| ContentDocument | `069` doc | `Title` (update, idLookup) | true, `["User"]` derived | 19 | `OwnerId` not createable; `LatestPublishedVersionId` read-only; token `Defaulted on Create` (capital C) |
| ContentVersion | `068` doc | `Title` (create, update, idLookup; required) | true, `["User"]` derived | 38 | `VersionData` (base64) skipped; `VersionDataURL` vs `VersionDataUrl` case duplicate; `ContentSizeLong` type `long`; `FirstPublishLocationId` 169 targets |
| FeedItem | `0D5` | none (`Title` exists, not a name) | false | 22 | `ContentData` (base64) skipped; `ParentId` required, polymorphic over ~163 targets |
| Location | `131` | `Name` (create, update, idLookup) | true, default Group+User | 55 | compound `Location` (type `location`) skipped as unsupported; 3 `integer` fields; duplicate block warning `FoCapacity` (later wins) |
| Address | `130` | `Name` (AutoNumber, idLookup, not creatable) | false | 24 | `ParentId -> Location` required create-only; compound `Address`; docs: "You can create an address only when creating a location" (automation, out of scope) |

### Required lookups and targets outside the 35+18
Skipped (reported in `PROVENANCE.skipped.referenceTarget`, D-14 style): `OpportunitySplit.SplitTypeId -> OpportunitySplitType`, `Territory2Id -> Territory2`, `ContentDocument.ContentAssetId`, `ContentVersion.ContentBodyId`, `Location.LogoId -> ContentAsset`, `EmailMessage.EmailTemplateId`/`EmailRoutingAddressId`, `FeedItem.BestCommentId -> FeedComment`, `Order.PaymentTermId`/`SalesStoreId -> WebStore`, `OrderItem.OrderActionId`/`OrderDeliveryGroupId`/`TaxTreatmentId`/..., `QuoteLineItem.QuoteLineGroupId`/`QuoteActionId`/.... After the proposed overrides the unmodelled skipped target set is **39 distinct names** (23 today). `ContentDocumentLink` is not a lookup target of any of the 18 (it is a junction); `Calendar` is not referenced by the 18.

### Master-detail and other structure
- No field of the 18 is `master-detail` in the Object Reference (`relationshipType` is `lookup` wherever stated; 0 master-detail across all 18). Do not invent MasterDetail for OrderItem.OrderId or QuoteLineItem.QuoteId: the docs state lookup or nothing. (MasterDetail refusal applies only to v1.0 objects; new objects could carry it, but there is no source.)
- Circular FK `ContentDocument.LatestPublishedVersionId` <-> `ContentVersion.ContentDocumentId`: **not a problem.** All FKs are `DEFERRABLE INITIALLY DEFERRED` (`ddl.ts` line 94-95); `LatestPublishedVersionId` is not createable; `ContentVersion.ContentDocumentId` is forced nullable by generator rule 4 (see Pitfall 5). Neither needs special handling. Do not implement the "insert ContentVersion auto-creates ContentDocument" automation (out of scope).
- Blob / non-column fields omitted: `ContentVersion.VersionData` (base64), `FeedItem.ContentData` (base64), `EmailMessage.{BccIds,CcIds,ContentDocumentIds,ToIds}` (JunctionIdList), `Location.Location` (compound geolocation). All five kinds already appear in `report.unsupportedTypes` as `UNSUPPORTED:field-type Object.Field (<token>)` (printed as `warning:` by `generate.ts`). BASE2-06's "omissions listed in the generator report" is satisfied by the existing report; the only addition is a test asserting these seven entries.
- Child relationships: **none of the 18 gets any `childRelationshipName`** (the generator derives it only from v1 pins; neither source states child-side names; no public doc text lists `OrderItems`, `QuoteLineItems` etc.). `SELECT (SELECT ... FROM OrderItems) FROM Order` therefore cannot resolve and describe `childRelationships` stays empty for these. Not required by SC1; record in the generator report/README as a known gap, or collect the pairs at the D-04 checkpoint.
- Table names: `order` is a SQL reserved word. DDL goes through `quote()` everywhere (`group`, `case` precedent) and `soql-parser-js` accepts `FROM Order ORDER BY OrderNumber`, `FROM Order o`, `(SELECT Id FROM OrderItems) FROM Order` (tested 2026-10-14). Add a compile+execute test for `SELECT Id FROM Order ORDER BY OrderNumber`.

### Hand overrides the dry run shows are required (the settle list)

**Type map additions** (`typemap.ts`, otherwise the generator aborts `unknown source type`): `text` -> Text (CaseMilestone.TimeRemainingInHrs/Mins), `timeonly` -> Time (5 OrderItem fields), `long` -> Number 18,0 (ContentSizeLong x2), `integer` -> Number 18,0 guessed (3 Location fields), `dynamic picklist` -> Picklist (QuoteLineItem.Status). Note the sf-skills spelling is `timeOnly`; `mapType` lower-cases tokens.

**Snapshot-list additions** (otherwise `snapshot-pdf.ts` refuses to write): token `Defaulted on Create` (capital C; ContentDocument.Division/IsArchived/IsInternalOnly; without it `defaultedOnCreate` conflicts sf=true vs doc=false), and `DOC_ONLY_REVIEWED.Quote.InsuranceQuoteType` with a reason (doc-only, no gating keyword).

**Field overrides**, `set referenceTo` + `relationshipName`, rule "field name names a modelled object, neither source states Refers To" (43 fields; all targets are in the 35+18):
Account/Contact/User/etc.: `AccountContactRelation.{AccountId,ContactId}`, `AccountTeamMember.{AccountId,UserId}`, `CaseMilestone.{BusinessHoursId,CaseId}`, `ContentDocument.ArchivedById->User`, `ContentVersion.RecordTypeId`, `ContractLineItem.{AssetId,LocationId,ParentContractLineItemId,PricebookEntryId,Product2Id,RootContractLineItemId,ServiceContractId}`, `FeedItem.LastEditById->User`, `Location.{AccountId,BusinessHoursId}`, `OpportunityTeamMember.{OpportunityId,UserId}`, `Order.{BillToContactId,OpportunityId,QuoteId,RecordTypeId,ShipToContactId}`, `OrderItem.{ParentOrderItemId,QuoteLineItemId,RelatedOrderItemId}` (**only one** of `RelatedOrderItemId`/`RelatedOrderItemID`; the other is a case duplicate), `Quote.{AccountId,BillToContactId,ContactId,ContractId,OpportunityId,PartnerAccountId,Pricebook2Id,PricingContractId,RecordTypeID,RelatedQuoteId}`, `QuoteLineItem.{OpportunityLineItemId,PricebookEntryId,Product2Id,QuoteId}`.
Nothing else is guessed: 32 further "(none stated)" lookups (`Order.LegalEntityId`, `FeedItem.ConnectionId`, `EmailMessage.FromId`, `ContentDocument.ParentId`, `Quote.RelatedWorkId`, ...) have no modelled implied target and stay skipped.

**Polymorphic subset overrides** (3): `FeedItem.ParentId`, `EmailMessage.RelatedToId`, `ContentVersion.FirstPublishLocationId`: the generator skips a polymorphic lookup if any target is unmodelled (rule 2). Without an override `FeedItem` has no parent and `ContentVersion`/`EmailMessage` lose their main association. Override `referenceTo` to the modelled subset (FeedItem.ParentId: 19 of 163 are modelled; RelatedToId: 10 of 106; FirstPublishLocationId: 20 of 169) with a reason; precedent: v1 `Task.WhatId` is pinned to 7 targets. Side effect: a Id of an unmodelled type in these fields is `INVALID_CROSS_REFERENCE_KEY` rather than unchecked; state this in the reason. Skipping instead leaves 163+106+169 target names flowing into the check info line (see Q5).

**Length conflicts** (2, generator aborts on unresolved conflicts): `Quote.Name` (sf-skills 255, PDF 225) and `QuoteLineItem.Description` (255 vs 225). Phase 9 D-05 precedence picks sf-skills for text types: `set length: 255` with a reason quoting both. (LOW on which is right; both sources are public docs. Johan's checkpoint can settle it.)

**Case duplicates** (skip the `field_reference`-only spelling, precedent `Account.PersonBirthdate`): `ContentVersion.VersionDataUrl`, `OpportunityTeamMember.PhotoUrl`; `OrderItem.RelatedOrderItemID` (and later `Entitlement.AssetWarrantyID` style hazards).

**AutoNumber + name field** (typemap says AutoNumber/Name are never derived): `Order.OrderNumber`, `OrderItem.OrderItemNumber`, `QuoteLineItem.LineNumber`, `ContractLineItem.LineItemNumber`, `Address.Name`, (`OpportunitySplit.Split`): `set {type: AutoNumber, displayFormat, createable:false, updateable:false, defaultedOnCreate:true, idLookup:true, nameField:true}` as for `ServiceAppointment.AppointmentNumber` (`{00000000}`, v1 pin). The Object Reference marks them Autonumber but states no display format, so the format is an orglet convention (`{00000000}`), flagged `guessed` in the reason. `nameField` for Quote.Name, Location.Name, ContentDocument.Title, ContentVersion.Title, EmailMessage.Name: same mechanism. Engine support exists (`formatAutoNumber`, sequences created in the new tables).

**Required fields:** generator rule 4 (`forcedNullable`) makes every documented-required field of a **new** object nillable (22 of the 18's fields, e.g. `Order.EffectiveDate`, `Order.Status`, `QuoteLineItem.Quantity`, `ContentVersion.Title`, `OrderItem.OrderId`, `OpportunityContactRole.ContactId`). The rule exists to protect v1.0 inserts; for objects with no v1 history it removes `REQUIRED_FIELD_MISSING` from the whole phase. Decide explicitly in the plan: either keep (documented, simplest, nothing new fails) or restrict rule 4 to objects with pins and accept that documented-required fields now enforce (more faithful, BASE2-06 "documented API fields"; needs the `engine.test` tests to supply required fields). Recommendation: restrict rule 4 to pinned objects and add a REQUIRED_FIELD_MISSING test per a couple of the 18, since faithful over convenient is the project's stated value; if the planner prefers risk-minimal, keep and add a README line.

### Label proposals (LOW; confirm at the checkpoint)
`humanise(name)` gives singular labels; plurals and exceptions are not in any source. Likely describe labels (training knowledge, unverified): OrderItem is "Order Product(s)"; ContentDocument and ContentVersion may read "Content Document(s)"/"Content Version(s)" or "File"; the rest follow `humanise`: Quote/Quotes, Quote Line Item(s), Order/Orders, Account Contact Relationship(s), Account Team Member(s), Opportunity Team Member(s), Opportunity Contact Role(s), Opportunity Split(s), Contract Line Item(s), Case Contact Role(s), Case Milestone(s), Email Message(s), Feed Item(s), Location(s), Address/Addresses. Do not ship these as "verified"; provenance `override` with the reason "label not stated by either source".

## Q5. `orglet check` classification (D-05..D-09)

### Current code (verified)
- `buildOrgSchema` (`build.ts` ~486-538): per retrieve object missing from the baseline, `pushDiagnostic(sink, {area: "standard-object"|"object-kind", kind:"object", object, message: "<Name> skipped"})`; per unresolved `referenceTo` name collected from **all** fields (custom and baseline) -> `reference-target` once per target, sorted, **after** all other warnings.
- Baseline fields never produce `reference-target` (the generator skips them), so the existing warning is effectively produced by retrieve fields only.
- `check()` (`cli/src/main.ts:73-88`): `log` lines (quiet-gated), then `console.warn("warning: ...")` for `[...result.warnings, ...new FormulaRegistry(schema).warnings]`; `--strict` returns 1 iff `warnings.length > 0`.
- `loadBaseline()` reads `objects/*.json` + `standardValueSets.json` only. `PROVENANCE.json` is not read.

### Where referenced-object names come from
1. Field `referenceTo` (retrieve and baseline, lookup/master-detail/owner): already iterated in the `missing` loop. Reuse that single pass to build `referenced = Set<lowercase name>` of every `referenceTo` target, modelled or not.
2. Roll-up summaries: pending summary fields carry `summaryForeignKey` = `Child.Field`; `rollup.ts` `tryResolve` drops with `rollup-target` "child object X is not defined". Add the child object name of every pending roll-up to `referenced` in `build.ts` (use `splitRollupRef`, already exported/available in `rollup.ts`), independent of the outcome. No string parsing of warnings.
3. Formulas and validation rules: a formula can reach another object only through a relationship on a field with `referenceTo`, which is covered by (1); compile failures carry `missing: {object, field}` but `object` there is the object the field was looked up **on** (always modelled). Therefore (1)+(2) is the complete input for D-05 in practice; document this and prove it with a test (retrieve with a lookup to an unmodelled `Foo` plus a formula path through it: `Foo` is referenced). In `main.ts` additionally add `FormulaRegistry.diagnostics[].missing?.object` names to the referenced set (zero cost, guards the future colon-syntax work of Phase 12).
4. Population (b): `PROVENANCE.json#skipped.referenceTarget` entries `Obj.Field -> A, B` or `-> (none stated)`: parse each target name after ` -> `, split on `, `, drop `(none stated)`, drop names that are modelled. Extend `Baseline` with an optional `skippedReferenceTargets?: string[]` filled by `loadBaseline()` when `PROVENANCE.json` exists and parses; absent for the fixtures. Today 23 distinct unmodelled names (incl. `ActivityMetric`), 39 after this phase with the polymorphic subset overrides, ~200 without them.

### The D-07 downgrade
After the `missing` pass, for each `standard-object` diagnostic whose object is not in `referenced` (case-insensitive) remove it from **both** `sink.warnings` and `sink.diagnostics` (same index; relative order of the rest is preserved, which keeps tests that look at positions stable) and add it to the info set; objects that something references keep the warning. `object-kind` (`__e`, `__mdt`, `__share`, ...) is not a standard object and is unchanged. Note `up` also calls `loadOrgSchema`; the downgrade applies there too (those warnings disappear from `up` output; intended by D-07).

### Type shape
```typescript
// packages/metadata/src/diagnostics.ts (additive)
export interface InfoDiagnostic extends Diagnostic {
  severity: "info";
}
// BuildResult gains: info: InfoDiagnostic[]   (areas: "standard-object-unmodelled" for retrieve objects, "reference-target-skipped" for generator-skipped targets)
```
`formatDiagnostic` unchanged (the string `UNSUPPORTED:<area> ...` is for warnings; the info line has its own formatter). `check` prints once, sorted, de-duplicated across both populations:
`info: N standard objects not modelled and unreferenced: A, B, C` (`log(c, ...)`, after the warning loop; empty set prints nothing). 39 names make a long line (~600 chars); D-08 says one line, so leave as is and note Phase 14 owns truncation (or cap only the printed names, never the count; planner's call).

### Tests that constrain the change
| Test | Constraint |
|------|-----------|
| `cli/main.test.ts` "prints nothing with --quiet", "--quiet does not hide warnings ... `expect(logs).toEqual([])`" | info line must be `log(c, ...)` (quiet-gated) |
| `main.test.ts` "reports no reference-target warning, and no warning at all, for acme" (`warns` empty), "strict check of a clean project exits 0" | info goes to stdout, never `console.warn` |
| `main.test.ts` line 1 `logs[0]` matches `/^\d+ objects \(4 custom\), \d+ fields$/` | the info line must not precede the totals line |
| `metadata/build.test.ts` lines 131, 276, 290, 306, 623 (`reference-target` toEqual guards, exact strings and `{area, object, message}`) | do not touch `reference-target` strings or add keys to those diagnostics |
| `metadata/diagnostics.test.ts` (formatter table incl. `standard-object Quote skipped`) | formatter unchanged; `Quote` is now modelled, the table row is a pure formatter test and stays valid |
| `schema/migrate.test.ts:186`, `engine/formulas.test.ts:40`, `metadata/sfdx.test.ts:122` | `warnings == diagnostics.map(formatDiagnostic)`: info must not enter those arrays |
| `metadata/documented-fields.test.ts` | `result.diagnostics.filter(area === "reference-target") == []` for a retrieve using every documented field; keep true |
| No test asserts an `UNSUPPORTED:standard-object` warning for a real retrieve object by string (verified by grep: only the formatter table); new tests must cover: referenced -> warning stays, unreferenced -> info only, referenced only via roll-up child -> warning stays, `--strict` exit 0 with only info |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.7 (`vitest run`), single root config `vitest.config.ts`; pglite per file by default, real Postgres 16 with `ORGLET_DATABASE_URL` (then `maxWorkers: 3`) |
| Config file | `/Users/johankarlsteen/Development.nosync/local-salesforce/vitest.config.ts` |
| Quick run command | `pnpm vitest run packages/metadata packages/cli` (pure/in-memory; no DB) |
| Full suite command | `pnpm test` (also `pnpm lint`, `pnpm typecheck`, `pnpm typecheck:scripts`, `pnpm baseline:check`); Postgres run: `pnpm db:up` then `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` |
| Conformance | `pnpm build` then `conformance/run-all.sh` (needs Docker Postgres, built `dist`, `conformance/jsforce/.cache` and `conformance/python/.venv`, both present locally) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BASE2-06 | 18 objects load with prefix/flags/name field/owner; `THIN`-style table | unit | `pnpm vitest run packages/metadata/src/build.test.ts` | extend (add a `BUSINESS` table next to `THIN`) |
| BASE2-06 | blob/junction/compound omissions listed in report | unit | `pnpm vitest run packages/metadata/test/baseline-generator.test.ts` | extend |
| BASE2-06 | generated files == regeneration (drift) | unit/CI | `pnpm baseline:check` | exists (`baseline-gen-check`) |
| BASE2-06 | skip ratio after the 18 | unit | `pnpm vitest run packages/metadata/test/documented-fields.test.ts` | exists; observed ratio with the 45 overrides: **126/1410 = 0.0894** (bound 0.103 holds; without the overrides it is 164/1410 = 0.1163 and the test fails). Lowering the constant is a decision needing the observed value in the SUMMARY |
| BASE2-06 | Supported Calls extraction + vocabulary | unit | `pnpm vitest run packages/metadata/test/object-reference-snapshot.test.ts` | extend |
| BASE2-07 | OrderItem undelete, CaseMilestone create/delete, ContentDocument create, ContentVersion delete refused | integration | `pnpm vitest run packages/engine/src/engine.test.ts` | extend `THIN_FLAGS`-style loop (insert/update/delete + undelete cases) |
| BASE2-07 | REST 400 `INVALID_TYPE_FOR_OPERATION` for the same | integration | `pnpm vitest run packages/api/src/api.test.ts` | extend (pattern at ~line 406) |
| BASE2-07 | lookup to the 18: unparsable -> MALFORMED_ID, wrong prefix / missing row -> INVALID_CROSS_REFERENCE_KEY; case-twin prefixes route correctly | integration | `pnpm vitest run packages/engine/src/engine.test.ts` | extend (pattern at ~line 280) |
| BASE2-07 | `FROM Order ORDER BY OrderNumber` compiles and runs | integration | `pnpm vitest run packages/engine/src/query.test.ts` | extend |
| BASE2-07 | upgrade of a populated v1.0 DB is silent and additive | integration | `pnpm vitest run packages/engine/src/upgrade.test.ts` | exists; `FORBIDDEN` regex must allow `CREATE TABLE` for exactly the 18 new tables; `EXPECTED_WARNINGS` stays `[]` |
| BASE2-08 | referenced -> warning, unreferenced -> info, roll-up child, `--strict` | unit/integration | `pnpm vitest run packages/metadata/src/build.test.ts packages/cli/src/main.test.ts` | extend |
| BASE2-08 | `PROVENANCE.json` skipped targets read, absent file tolerated | unit | `pnpm vitest run packages/metadata/src/build.test.ts` | extend (fixtures `baseline-v1.0`, `NULL_PREFIX` have none) |
| SC1/SC4 | describe through both SDKs, 32 objects | conformance | `conformance/run-all.sh` | `objects.txt` 14 -> 32 |
| generator | `de-describe` accepted with ref, rejected without | unit | `pnpm vitest run packages/metadata/test/baseline-gate.test.ts` | rewrite the "describe-sourced aborts" test |
| generator | ownerTargets list incl. ContentDocument, ContentVersion | unit | `pnpm vitest run packages/metadata/test/baseline-generator.test.ts` | update `USER_ONLY` |

### Sampling Rate
- **Per task commit:** the quick command for the touched package plus `pnpm baseline:check` when generator inputs changed.
- **Per wave merge:** `pnpm lint && pnpm typecheck && pnpm typecheck:scripts && pnpm test` (pglite).
- **Phase gate:** full suite on Postgres 16 (`ORGLET_DATABASE_URL`) and `conformance/run-all.sh` green before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `scripts/gen-baseline/snapshot-pdf.ts`, `snapshot-lists.ts`: Supported Calls, `Defaulted on Create`, `DOC_ONLY_REVIEWED.Quote`
- [ ] `packages/metadata/test/object-reference-snapshot.test.ts`: allow/validate `supportedCalls`
- [ ] `conformance/describe-check/jsforce.mjs` and `sf_describe.py` fail when `keyPrefix` is not a 3-character string; if D-02 forces a null prefix for any object, either keep that object out of `objects.txt` (with a comment) or make the check accept `null` for an explicit list. Decide before the checkpoint result is known.
- [ ] No framework install needed.

### Expected warning-count and count shifts the plan must record (SC4)
| Measure | Before | After (expected) | How measured |
|---------|--------|------------------|--------------|
| `orglet check --strict` on the DE retrieve (conformance README row, 2026-10-12) | exit 0, 0 warnings, 37 objects (2 custom), 983 fields | exit 0, 0 warnings, **55 objects (2 custom)**, fields +~604 plus ~7 system fields per new object (record the printed value) | `conformance/README.md` table, re-run by Johan on his own DE retrieve |
| `check` on `examples/acme` | 0 warnings | 0 warnings (test asserts `warns == []`) | `main.test.ts` |
| `reference-target` warnings for referenced objects | `Contract.SourceQuoteId -> Quote` is skipped (no warning) | field returns; still 0 warnings | `PROVENANCE.skipped.referenceTarget`: 94 entries before, 150 after (the 18 add ~56; 1 returns) |
| `UNSUPPORTED:standard-object` for unreferenced retrieve objects | 1 warning each | 0 warnings, in the info line | new `check` tests |
| Info line | does not exist | `info: 39 standard objects not modelled and unreferenced: ...` on a project with no references (count from PROVENANCE) | `check` output |
| documented skip ratio | 84/818 = 0.1027 | 126/1410 = 0.0894 (with overrides) | `documented-fields.test.ts` message |
| describe-check | jsforce 14/14, simple-salesforce 14/14 | 32/32 each (if D-02 nulls a prefix, 31/31 plus the documented exception) | `conformance/README.md` |
| jsforce subset 51/12, simple-salesforce 29/29 | as listed | unchanged | `run-all.sh` |
Judge SC4 by "no standard-object or reference-target warning remains for a referenced object" (PITFALLS B2), not by raw totals.

### Postgres lock pressure (Claude's discretion item)
A v2 schema is ~500 relations and ~190 FKs (~700 locks in one `migrate()` transaction, `vitest.config.ts` comment). The 18 add 18 tables, their PK/unique indexes, ~6 sequences (AutoNumber) and roughly 100 FK constraints (33 explicit lookups + 45 overrides + owner/audit columns) i.e. an estimated +250 locks, ~950 per migrating file; the shared lock table is `max_locks_per_transaction (64) x connections (100)` = 6400 slots, and `maxWorkers: 3` allows three concurrent migrations: ~2900 < 6400. Estimate only (MEDIUM); the real run on Postgres 16 is the gate. Watch `out of shared memory` in `upgrade.test.ts`, `migrate.test.ts`, `rollups.test.ts`; fallback is lowering `maxWorkers` to 2, not changing `migrate()`.

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---------|-------------|-------------|-----|
| Object-level DML flags for new objects | Pins in `v1-pins.json` or hard-coded JSON | `supportedCalls` from the extraction + token map | D-10; also serves 999.5 |
| Label humaniser for the 18 | A second plural/singular generator | Hand `labels` overrides with reasons (+ existing `humanise` for fields) | no source states them; pluralisation is irregular |
| Info-severity reporting | A new warning prefix or stderr line | `BuildResult.info` + one `log()` line | `--strict` and three equality tests depend on `warnings`/`diagnostics` |
| Referenced-object discovery | Regex over warning strings | Walk `referenceTo` and pending roll-ups in `build.ts` | strings are byte-guarded regression artefacts |
| Key-prefix collision detection | New case-folding logic | Existing exact-case `validateBaseline` + a routing test | prefixes are case-sensitive by design |
| Circular FK handling | Nullable-first-insert code | Existing `DEFERRABLE INITIALLY DEFERRED` FKs | already in `ddl.ts` |
| Blob storage | bytea/multipart | nothing (FILE-01) | out of scope; the fields are omitted |

## Common Pitfalls

### Pitfall 1: Silent skip of unstated lookups
**What goes wrong:** 43 lookups with no Refers To (QuoteLineItem.QuoteId, Order.OpportunityId, ...) are dropped as `-> (none stated)` without any abort; the 18 files regenerate "green" but are unusable (no QuoteId on QuoteLineItem).
**How to avoid:** a test asserting the presence of a list of load-bearing lookup fields per object (QuoteLineItem.QuoteId/Product2Id/PricebookEntryId, OrderItem.OrderId, AccountContactRelation.AccountId/ContactId, ...). **Warning signs:** `referenceTarget` skip count for the 18 above ~25 after overrides.

### Pitfall 2: Generator aborts on first contact (in order)
`unknown source type` (5 tokens), `fields X and Y differ only in case` (3), `doc-only fields without gating or DOC_ONLY_REVIEWED` (Quote.InsuranceQuoteType), `unknown Properties token "Defaulted on Create"`, `unresolved source conflicts` (5: three defaultedOnCreate, two lengths), `no source names a User or Group owner target` (only if hasOwner is derived from `field_reference`: Quote). Budget one iteration per abort; the dry run above found them all, none depends on Johan's answers.

### Pitfall 3: Network steps with unpinned inputs
`sync-sfdocs.sh` defaults to `main` and `snapshot-pdf.ts` without `--pdf` downloads the *current* PDF. Both rewrite the 35 existing source files and move the pins in `PROVENANCE.json`. Always pass the pinned sha / the cached PDF; check `git diff --stat` shows additions only. These steps are manual, never CI; the CI gate `baseline-gen-check` (`pnpm baseline:gen && git diff --exit-code -- packages/metadata/standard`) needs only committed inputs (no network, no poppler).

### Pitfall 4: Prefix labelling reversal
`de-describe` is rejected by the generator today (C5). Also `keyPrefix.ref` is required for every non-`unverified` source (`validateOverrides`), and Phase 9 D-07 reserves `unverified` for "no public doc"; use `unverified` + `ref` naming both lists for the two-list prefixes, `doc` + ref for 068/069/0Q0.

### Pitfall 5: Rule 4 hides required fields on new objects
See Q4. Decide deliberately; a silent default changes what "documented API fields" means for 22 fields.

### Pitfall 6: null-prefix fallback ripple (D-02)
`validateBaseline` demands `createable: false` for a null prefix; the object-level flag from Supported Calls says `create()` is allowed, so the fallback needs an explicit object override (`flags` with reason) and the describe-check scripts reject a null `keyPrefix` (Wave 0 gap). `OpportunitySplit` is the likely candidate and Johan's DE may not list it (feature-gated). Also `createable: false` should be reflected on its `createable` fields? Not required; the engine refuses on the object flag.

### Pitfall 7: Feature-gated objects and the checkpoint
Johan's DE `describeGlobal` omits objects whose feature is off (AccountTeamMember, OpportunitySplit, Location, EmailMessage need Account Teams, Splits, Field Service/inventory, Email-to-Case). "Not in my DE" must be an acceptable checkpoint answer (-> D-02), not a blocker.

### Pitfall 8: Test constants
`USER_ONLY` (ownerTargets), `baseline-generator.test.ts` "35" in test titles/`toHaveLength(35)` (the *fixture* count stays 35; only titles about "documented fields of the 35" read stale), `documented-fields.test.ts` writes a retrieve for every object in `objects.json` (now 53) and its `written.size > 1000` stays true.

### Pitfall 9: Upgrade test relaxation must stay narrow
Allow `CREATE TABLE "<schema>"."<new18>"` and nothing broader; keep `expect(migration.warnings).toEqual(EXPECTED_WARNINGS)` with `[]` and the row-equality `expect(await snapshot()).toEqual(before)` untouched. Add a second assertion that none of the 35 v1.0 tables gets a `CREATE TABLE`.

### Pitfall 10: Info line volume
Population (b) is never empty. Without the three polymorphic overrides the name list would be ~200; with them 39. The count is part of the visible contract, so changing which fields are overridden changes the line.

## Code Examples

### Supported Calls extraction (inside `snapshot-pdf.ts`, per TOC-bounded section)
```typescript
// Source: layout verified on object_reference.pdf sha256 6b9d37316f09 (pdftotext 26.04.0 -layout)
const CALL = /([A-Za-z]+)\(\)/g;
const KNOWN_CALLS = ["create","delete","describeLayout","describeSObjects","getDeleted","getUpdated","query","retrieve","search","undelete","update","upsert"];
function supportedCalls(lines: string[]): string[] | undefined {
  const at = lines.findIndex((l) => l.trim() === "Supported Calls");
  if (at < 0) return undefined;
  const text: string[] = [];
  for (let i = at + 1; i < lines.length && (lines[i] as string).trim() !== ""; i++) text.push((lines[i] as string).trim());
  const found = [...text.join(" ").matchAll(CALL)].map((m) => m[1] as string);
  const unknown = found.filter((c) => !KNOWN_CALLS.includes(c));
  if (unknown.length > 0) throw new Error(`unknown Supported Call(s) ${unknown.join(", ")}`);
  return [...new Set(found)].sort();
}
```

### Token -> flags (inside `pipeline.ts`)
```typescript
const FLAG_BY_CALL = { create: "createable", update: "updateable", delete: "deletable", undelete: "undeletable", search: "searchable" } as const;
function flagsFromCalls(calls: readonly string[]): Partial<Record<(typeof FLAG_BY_CALL)[keyof typeof FLAG_BY_CALL], false>> {
  const out: Record<string, false> = {};
  for (const [call, flag] of Object.entries(FLAG_BY_CALL)) if (!calls.includes(call)) out[flag] = false; // loader defaults to true
  return out;
}
```

### Settle override (precedent: `Account.PersonContactId` in overrides.json)
```json
"QuoteId": {
  "set": { "referenceTo": ["Quote"], "relationshipName": "Quote" },
  "reason": "settle-conflicts rule (09-06 checkpoint): field name names modelled object Quote; neither source states Refers To"
}
```

### Optional provenance read (inside `loadBaseline`)
```typescript
// PROVENANCE.json ships with the package; fixtures do not have it.
const provPath = join(dir, "PROVENANCE.json");
let skippedReferenceTargets: string[] | undefined;
try {
  const prov = JSON.parse(await readFile(provPath, "utf8")) as { skipped?: { referenceTarget?: string[] } };
  skippedReferenceTargets = prov.skipped?.referenceTarget;
} catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; }
```

## State of the Art

| Old approach (v1.0/Phase 9) | Current approach | When | Impact |
|-----------------------------|------------------|------|--------|
| Object facts only via v1 pins | Facts derived from Supported Calls; hand facts only on gap/conflict | this phase (D-10) | new objects need no pins; 35 v1 objects unchanged |
| `de-describe` forbidden in the generator | allowed with `ref` | this phase (D-01) | Phase 9 guard and test change |
| Warnings only | warnings + side-channel info | this phase (D-08) | Phase 14 can expand into `--summary/--json` |

**Deprecated/outdated:** the CONTEXT line "label/labelPlural from the sf-skills object JSON" (C1); the PITFALLS-era assumption that all six prefixes are single-list (C4).

## Open Questions

1. **Rule 4 (forced nullable) for new objects.** What we know: it removes `REQUIRED_FIELD_MISSING` for 22 documented-required fields. Unclear: whether Johan wants faithfulness or insert-compat here. Recommendation: restrict to pinned objects (faithful), decide at plan review.
2. **ContentVersion/ContentDocument name of the `Title` field vs `nameField`.** PDF: idLookup, not Namefield. Recommendation: set `nameField: true` on Title (FEATURES §F says Title), flag as hand fact.
3. **Un-skipping Asset.LocationId, Entitlement.LocationId/ContractLineItemId, Case.FeedItemId, Contract.SourceOpportunityId.** Additive nullable FK columns on existing tables; "(none stated)" in the sources. Recommendation: include Asset.LocationId, Entitlement.ContractLineItemId, Entitlement.LocationId, Case.FeedItemId (name-rule overrides, upgrade-safe because new columns are null), leave the rest; or defer wholesale. Planner/Johan call.
4. **Wrong-type Id error code** (Q3). One official example says `MALFORMED_ID`. Recommendation: keep v1, record, revisit as its own decision.
5. **SOAP StatusCode page unreachable** (403) - the exact documented text for `INVALID_CROSS_REFERENCE_KEY` is not quoted from the SOAP guide.
6. **Display format for AutoNumber of the 6 fields** is not documented; `{00000000}` follows the v1 convention.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 22 | everything | shell default is v18.20.8 | 18.20.8 (22 via `.nvmrc`/nvm) | `nvm use`; tsx scripts ran on 18 in this research but tests need 22 |
| pnpm 10+ | scripts | not on PATH in this shell | - | `corepack enable pnpm` |
| pdftotext (poppler) | `baseline:snapshot` | yes | 26.04.0 (= VENDOR.md pin) | none needed |
| Cached Object Reference PDF | pinned snapshot | yes | `~/.cache/orglet/object_reference-6b9d37316f09.pdf` (sha prefix = pin) | download = newer PDF, re-pin deliberately |
| Network (GitHub, resources.docs.salesforce.com) | sync + snapshot, manual only | yes | - | never in CI |
| Docker + Postgres 16 | Postgres test run, conformance | docker 29.7.2 present; container not checked | - | pglite for the unit suite |
| jsforce build, Python venv | conformance | `conformance/jsforce/.cache`, `conformance/python/.venv` present | jsforce 9bae14e | - |
| Johan's own Developer Edition | D-04 checkpoint | his; orglet never contacts it | - | D-02 null-prefix fallback |

## Sources

### Primary (HIGH confidence)
- Repo files read in full or in the relevant ranges: `scripts/gen-baseline/{pipeline,sources,typemap,snapshot-pdf,snapshot-lists,generate}.ts`, `overrides.json`, `objects.json`, `source/*/VENDOR.md`; `packages/metadata/src/{build,diagnostics,rollup}.ts`; `packages/cli/src/main.ts` and `main.test.ts`; `packages/engine/src/{engine,errors}.ts`, `engine.test.ts`, `upgrade.test.ts`; `packages/metadata/test/{baseline-generator,baseline-gate,documented-fields,object-reference-snapshot}.test.ts`; `conformance/describe-check/*`, `conformance/README.md`; `vitest.config.ts`; `.github/workflows/ci.yml`.
- Dry run in a scratch copy of the repo (outside the repo tree): all 18 objects added, sf-skills JSON fetched at `4bbae5c4`, PDF re-extracted from the cached PDF; results quoted above (604 fields, 45 overrides -> skip ratio 0.0894, 39 unmodelled skipped targets).
- Object Reference PDF (pinned, local) - Supported Calls for all 18; ContentDocumentLink Usage example (`069D00000000so2`); Opportunity SyncedQuoteId Java sample (`0Q0D000000002OZ`); `https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/object_reference.pdf`.
- REST API Developer Guide PDF (`api_rest.pdf`, downloaded 2026-10-14) - ContentVersion insert example (`068D00000000pgOIAQ`); `MALFORMED_ID` examples; ContentVersion update tip: `https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_rest.pdf`.
- sf-skills git tree at `4bbae5c4...` via `gh api` (existence of all 18 + OpportunitySplitType, Calendar, ContentDocumentLink, ActivityMetric).

### Secondary (MEDIUM confidence)
- Salesforce Help KB 000387915 "Errors due to invalid IDs during Data Loader import and update": `https://help.salesforce.com/s/articleView?id=000387915&language=en_US&type=1`
- Community prefix lists (parsed raw): `https://gist.github.com/FishOfPrey/05f7a742757fce071a09`, `https://gist.github.com/Synchro/2c6186203c15dc2bd14bd2c7f6396583`; read through a summarising fetch: `https://www.apexhours.com/salesforce-object-key-prefix/`, `https://www.autorabit.com/blog/salesforce-object-prefixes-cheat-sheet/`, `https://automationchampion.com/2024/01/22/salesforce-object-key-prefix-list-2/`.

### Tertiary (LOW confidence)
- `https://salesforcedictionary.com/errors/invalid-cross-reference-key` (wrong-type -> INVALID_CROSS_REFERENCE_KEY), xappex/default.com blog posts (same claim); massmailer.io (EmailMessage `02s`); `trailhead.salesforce.com/trailblazer-community/feed/0D5...` URLs embed FeedItem Ids (weak support for `0D5`, not documentation).
- Object label proposals (training knowledge).

## Project Constraints (from CLAUDE.md)

- Build only from public documentation and open-source SDK source; never contact or diff against a real org. The `de-describe` checkpoint is Johan's own choice (Phase 3 D-03a precedent), recorded as "author's own DE describe, <date>"; orglet itself never contacts an org; real-org findings enter the repo only as generic Salesforce areas, never Tele2 names (user memory). Searches in this research were public-docs only.
- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), ESM `.js` import extensions, `import type` enforced, no `export *`; every file opens with a `/** why */` block; barrels list values and types separately.
- `UNSUPPORTED:<area>` convention mandatory for anything unimplemented; error envelopes built through `Errors`/`apiError`; never invent StatusCodes.
- Warning strings are byte-identical regression guards; existing conformance suites stay green; vitest co-located `*.test.ts`; tests name the invariant (`test_refund_blocked_after_30_days` style).
- Repo-local git identity Johan Karlsteen <johan@karlsteen.com>; creating the GitHub repo and first push need confirmation (not this phase).
- Workflow: edits only through a GSD command (`/gsd:execute-phase`).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - existing tooling, versions read from the repo and the machine
- Architecture / generator changes: HIGH - every claim reproduced by a scratch dry run of the actual pipeline and tests read from source
- Key-prefix provenance: MEDIUM - docs found for 3 of 18, community lists for the rest; the lists were not independently verifiable
- Lookup error codes: MEDIUM - official examples found but no general statement; SOAP StatusCode page unreachable
- Labels, child-relationship names, display formats: LOW - no public source located
- Pitfalls: HIGH for generator/test pitfalls, MEDIUM for Postgres lock estimate

**Research date:** 2026-10-14
**Valid until:** 2026-11-13 (inputs are pinned; the Object Reference PDF and sf-skills `main` move, the pinned copies do not)
