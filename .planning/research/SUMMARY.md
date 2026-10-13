# Project Research Summary

**Project:** orglet, milestone v1.1 "real-org fidelity"
**Domain:** self-hosted, single-tenant Salesforce platform emulator (second milestone on shipped v1.0)
**Researched:** 2026-10-12
**Confidence:** MEDIUM-HIGH (code-level and data-source findings HIGH; Salesforce-side semantics for roll-ups, `$Setup`, MetadataRelationship and several error codes MEDIUM/LOW)

Detail lives in `STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md` in this directory. This file reconciles them.

## Executive Summary

v1.1 makes a large real enterprise retrieve (141 objects, ~3 600 fields, several hundred warnings in a handful of areas) load with zero warnings for everything it references. Nothing new is needed at runtime. The work is (1) a much bigger, generated standard-object baseline, (2) loading more metadata kinds (`__mdt` types and rows, custom settings, labels, `MetadataRelationship`), (3) more formula globals plus two upstream sigha syntax fixes, (4) per-object `OwnerId` narrowing, (5) roll-ups over formula fields, and (6) a root-cause-oriented `orglet check` report. The v1.0 layering (`metadata -> schema -> {formula, soql} -> engine -> api -> cli`) absorbs all of it. No new runtime dependency, no new package.

The recommended approach is data first, then loaders, then semantics, then reporting. A committed, deterministic generator produces the baseline from two public inputs (a Salesforce-published Apache-2.0 dataset and the public Object Reference PDF used as a cross-check) with a hand-written overrides file that always wins. Everything file-derived (`$Label`, `$CustomMetadata`) is constant-folded at formula compile time; everything data-derived (`$Setup`, `$UserRole`, `$Api`) is bound at evaluate time through the existing `loadGlobals`. Custom metadata rows are ordinary Postgres tables seeded at `up`. Roll-ups over formulas compute the formula in TypeScript and feed the values into the existing SQL aggregate, so formula semantics are never reimplemented in SQL. The check report is rendered from structured diagnostics that sit next to, not instead of, the `UNSUPPORTED:<area>` strings.

The main risks are all about what changes under an existing database and under an existing contract. Two HIGH migration hazards: narrowing `OwnerId` adds an FK on populated columns that may hold Group-owned rows, and any new MasterDetail column on a populated table fails `ADD COLUMN ... NOT NULL`. Both are neutralised by a populated-database upgrade test that exists before any baseline change merges. Next: key prefixes are not in any machine-readable public source (they must become nullable and source-labelled), the vendored sigha has a Linux-broken sync script and an `org-verified.json` provenance question, and un-skipping objects will first raise warning counts before it lowers them. Public fixtures must never inherit names from the private org.

## Key Findings

### Recommended Stack (from STACK.md)

**Runtime additions: none.** Added instead: one vendored data snapshot, one generator script, three small parser additions.

- **Vendored data snapshot**: `forcedotcom/sf-skills`, skill `platform-data-and-tooling-api-context-get`, `assets/enterprise_api/<Object>.json` (Apache-2.0, Salesforce, generated from the public Object Reference). Vendor only the ~35-50 needed objects, plus LICENSE and VENDOR.md with the pinned SHA, via a `sync-sfdocs.sh <sha>` script modelled on `sync-sigha.sh`.
- **Generator**: `scripts/gen-baseline/` run with the already-present `tsx` (`pnpm gen:standard`). Not a workspace package. Output is committed, deterministic, and diff-checked in a vitest test.
- **Parser changes** in `packages/metadata`: `customMetadata/*.md-meta.xml`, `labels/CustomLabels.labels-meta.xml`, `<customSettingsType>`, `MetadataRelationship`. Add `labels` to the `REPEATED` set. Do not flip `ignoreAttributes`; coerce values by the declared field type (second parser instance only if nil-vs-empty matters).
- **sigha**: two upstream-only patches. Unary `!` (verified in the BSD-3 `salesforce/formula-engine` grammar: `BANG unaryExpression` rewrites to `NOT`) and `Relationship:Object.Field` (lexer folds `Owner:User` into one identifier token, zero parser/AST change). Never hand-patch `packages/sigha/src`.
- **Do not add**: Playwright/Puppeteer (docs are bot-walled), `@salesforce/source-deploy-retrieve`, jsforce as runtime dep (use its typings as reference only), any WSDL (org-generated, forbidden), `commander`/`chalk`, ANTLR, third-party key-prefix tables as an automated source.

### Expected Features (from FEATURES.md)

**Table stakes (needed for the milestone goal):**
- Baseline v2: field parity for the existing 35 objects plus 18 business objects (Quote, QuoteLineItem, Order, OrderItem, AccountContactRelation, AccountTeamMember, OpportunityTeamMember, OpportunityContactRole, OpportunitySplit, ContractLineItem, CaseContactRole, CaseMilestone, EmailMessage, ContentDocument, ContentVersion, FeedItem, Location, Address) with explicit per-object DML flags (`INVALID_TYPE_FOR_OPERATION` on violation).
- `OwnerId` `referenceTo` narrowed per object so plain `Owner.X` compiles (the main unblocker for cascaded formula failures).
- `__mdt` types as read-only objects with rows from `customMetadata/`, system fields (`DeveloperName`, `MasterLabel`, `Label`, `Language`, `NamespacePrefix`, `QualifiedApiName`, `IsProtected`), `MetadataRelationship` loaded instead of skipped.
- Custom settings: `customSettingsType` parsed, describe `customSetting: true`, no `OwnerId`, hierarchy `SetupOwnerId` (Organization/Profile/User) with `DUPLICATE_VALUE` uniqueness.
- Globals: `$UserRole`, `$Api`, `$Label`, `$CustomMetadata`, `$Setup` (hierarchy only); `!` and colon syntax via sigha; `$Permission` stays `UNSUPPORTED:formula-global`.
- Roll-up over a same-object, non-volatile formula field (highest complexity item).
- Check report: census, verdict line, per-area table, root-cause grouping of cascades, referenced-but-missing vs modelled-but-unreferenced, quiet informational category, deterministic ordering.

**Differentiators (worth it when cheap):**
- `--summary` counts-only mode (project-critical: it is what makes the private-org result safe to report) and `--json` (same `Report` object, two renderers).
- Roll-up with a formula as filter field; backfill of formula roll-ups at migrate.
- Cheap EntityDefinition/FieldDefinition alias (`Entity__r.QualifiedApiName` as an alias of the stored string).
- Order/Quote validation rules, AccountContactRelation auto-create hook, queue loading with owner check: only if a phase has slack (queue owner error code is unverified).
- `--baseline report.json` diff and `--max-warnings N`: v1.2 candidates.

**Anti-features / defer:**
- DML on `__mdt` (reject), packaging visibility and mdt limits, Apex `getInstance`, Quote<->Opportunity sync (`UNSUPPORTED:quote-sync`), Order activation automation, FeedItem generation, Email-to-Case, entitlement milestones, `$Setup` on list settings, `$Permission`, `$Label` translations, formula-to-SQL, in-memory mdt store, docs scraping.
- Defer: ContentVersion blob upload/download and `ContentDocumentLink` (see open question 3), per-user language, packaged/namespaced labels.

### Architecture Approach (from ARCHITECTURE.md)

Seven integration decisions, all consistent with the v1.0 layering and the "schema stays formula-agnostic" rule:

1. **`__mdt` rows are ordinary Postgres tables**, seeded idempotently at `up` by `packages/engine/src/seed.ts` (full sync keyed by `DeveloperName`, Ids preserved), plus an immutable copy on `OrgSchema` used only for compile-time folding. Writes are refused through the existing DML-flag mechanism; the seeder bypasses it by writing through `Store`/SQL.
2. **Globals split by mutability.** `$Label`/`$CustomMetadata` are constant-folded to literal AST nodes in `compile.ts` (works in `check` with no DB, cheap per row). `$Setup`/`$UserRole`/`$Api` resolve at evaluate time via `loadGlobals`; `FormulaRegistry` collects which ones compiled formulas reference so the common path stays at three reads.
3. **Roll-up over formula**: formula values computed in TypeScript (same path as `project()`), passed as a derived table (`unnest`) into the existing `rollupSelectSql`. `RollupRegistry.watched` must include the fields the formula reads. `migrate()` returns `pendingBackfills`; `engine.backfillFormulaRollups` runs them after the engine is built. Same-object, non-volatile formulas only (also a staleness guard).
4. **Referenced vs unreferenced** computed once in `build.ts` from project lookups and roll-ups (never transitive closure over baseline lookups). Structured diagnostics (`SkippedItem`, `FormulaFailure`, `FormulaCompileError.missing`) are added beside the warning strings; `packages/cli/src/report.ts` builds the cause graph.
5. **Generator** in `scripts/gen-baseline/`, offline, committed snapshot plus `overrides.json` (each entry carries a `reason`), sorted keys, no timestamps, CI `git diff --exit-code`.
6. **OwnerId narrowing at the data source** via `ownerTargets` on the standard JSON, threaded through `systemFields(hasOwner, ownerTargets)`.
7. **Migration**: the FK pre-check and the populated-DB upgrade test are the acceptance gate for baseline growth; skip `CREATE INDEX` when the index name already exists.

### Critical Pitfalls (from PITFALLS.md; the six roadmap blockers)

1. **Populated-database upgrade test first (M1).** Fixture: v1.0 baseline files from git plus acme data including a Group-owned row and `--import` rows; assert success, zero data loss, exact warning set. Never derive DB `NOT NULL` from `nillable:false`; the generator errors if it would add a MasterDetail to an existing populated object.
2. **Nullable, source-labelled `keyPrefix` before generating ~50 objects (B3).** Type change `keyPrefix: string | null` across `build.ts`, `ids.ts`, `prefixes.ts`, describe. Uniqueness test; test that a new standard prefix cannot collide with persisted custom prefixes (`KeyPrefixError` would break `up` on existing DBs).
3. **OwnerId narrowing is per-object data (O1)**, after auditing Group-owned unit tests and `conformance/poly-check` (Case with a Group owner). Case and Lead stay polymorphic.
4. **sigha resync precedes formula work (S1/S2).** `sync-sigha.sh` uses BSD `sed -i ''` and fails on Linux; `defaults to main`; pin a full SHA; write the orglet-side expectation tests (`Owner:User.Email`, `!ISBLANK(x)`, `x != y`, strings containing `!` and `:`) before the resync.
5. **Decide the layer for formula materialisation in roll-ups (R1)**: engine, not `@orglet/schema`; D-10 ("backfill last in the migrate transaction") is re-decided for this case.
6. **Structured diagnostics and one shared reference walk before the report redesign (K1/K2).** `--strict` must never pass because a group was collapsed; every quiet object must be provably unreferenced.

Also high-signal: un-skipping an object un-skips all its metadata, so warning counts rise mid-milestone (B2); do not copy doc prose into committed JSON (B1); public fixtures must not derive from the private retrieve (G1).

## Reconciled Across Researchers

| Topic | What they said | Decision |
|-------|---------------|----------|
| Generator input | STACK: vendor the sf-skills JSON (Apache-2.0; flags, types, relationships; no picklist values, precision, key prefixes; `__c` leakage from doc examples). FEATURES: Object Reference PDF (v68.0, `resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/object_reference.pdf`) readable with `pdftotext`; 18 business objects already extracted (flags, OwnerId). STACK got a 404 on a different PDF path (`atlas.en-us.object_reference.meta.pdf`) and a 403 on the HTML, so the two findings are compatible. | **Primary input: sf-skills snapshot** (vendored, licensed, reproducible, no network). **Cross-check input: PDF extraction**, run as a generator-time verification, not committed as source. Rule from PITFALLS B1: a flag is `verified` when both agree, `unverified` (and logged in the generator report) when only one states it; disagreements go into `overrides.json` with a reason. PDF text is never redistributed; facts only. Both are public; neither is a real org. |
| Snapshot location | STACK: `packages/metadata/standard/source`. ARCHITECTURE: `scripts/gen-baseline/snapshot`. | `scripts/gen-baseline/` for snapshot, vendor copy, and `overrides.json`; generated output stays in `packages/metadata/standard/objects/`. Drop ARCHITECTURE's "scrape the HTML" snapshot step; the sf-skills sync replaces it. |
| Global resolution | FEATURES: a `GlobalResolver` pre-resolving all globals per batch. ARCHITECTURE: split by mutability. | **ARCHITECTURE's split.** `$Label`/`$CustomMetadata` need no resolver (folded; the sigha evaluator that throws for un-pre-resolved `$CustomMetadata` keys is never reached). FEATURES' pre-resolver survives as the evaluate-time half: `FormulaRegistry` collects referenced `$Setup`/`$UserRole`/`$Api` keys, `loadGlobals` loads only those, memoised per call or session. |
| `$Api` values | FEATURES: reuse login URL builder, session token. PITFALLS: do not trust `Host`. | One configured public base URL (`ORGLET_BASE_URL`, default derived once at `up`); `Session_ID` from the session, blank without one; never persisted; rejected in roll-up formulas. Formula fields only (per sigha contexts), not validation rules. |
| OwnerId targets | ARCHITECTURE guessed Task User-only (LOW). FEATURES read the PDF. | **FEATURES' table** (see below). Widen `ownerTargets` from `("User"\|"Group")[]` to `string[]` because Event is `Calendar + User`. |
| Gated fields | FEATURES: generate all documented fields, tag `featureGated`. PITFALLS B1 and the v1.0 `standard/README.md`: exclude gated, reserved, deprecated. | Choose one, do not blend: **include gated fields, tagged `featureGated` in the generator provenance; exclude only reserved, deprecated and Lightning-only.** Reason: the goal is zero warnings for what a real retrieve references, and a retrieve may legitimately use a gated field. Cost: describe shows fields a non-gated org would lack (nullable columns, low harm). This changes the v1.0 README rule, so it is open question 6. |
| Roll-up formula restrictions | FEATURES/ARCHITECTURE: accept at load, mark `UNSUPPORTED:rollup-formula` (warning, roll-up inert). PITFALLS: fail load per D-05. | **Warn, do not fail.** D-05 rejects a case Salesforce itself forbids with high confidence; the formula restriction set is only MEDIUM/LOW confidence, and a retrieve already passed Salesforce's save-time validation. Failing load on a doc-vs-reality mismatch would block the real org. |
| Roll-up evaluation | FEATURES: load children, aggregate with decimal.js, write parent. ARCHITECTURE: TS values into SQL derived table. | ARCHITECTURE's (reuses all filter/aggregate SQL semantics). Round to the formula's declared scale before aggregating (verify in the phase). Add formula -> roll-up -> formula cycle test. |
| Structured diagnostics timing | FEATURES: first. ARCHITECTURE: collect during phases, render last. | Both: introduce the `Diagnostic` types in Phase 8 (additive; strings stay), every later phase emits them, renderer in the last phase. This also gives a per-area measuring stick on the large org from the start. |
| Report flags | FEATURES `--format json`; ARCHITECTURE `--json`. | `--json` and `--summary`. Keep one `warning:` line per root cause on stderr, summary on stdout, same exit-code semantics (K3). |
| MetadataRelationship targets | ARCHITECTURE: keep EntityDefinition/FieldDefinition `UNSUPPORTED` varchar. FEATURES: alias variant. PITFALLS: explicit `UNSUPPORTED:field-type`. | `__mdt` -> `__mdt` fully supported (two-pass, deferred FK). Entity/FieldDefinition targets: varchar plus `QualifiedApiName` alias, with one `UNSUPPORTED:reference-target` for anything beyond that. Needs a research check in Phase 11. |
| DML on `__mdt` error code | STACK suggested `INVALID_OPERATION`/`FEATURE_NOT_ENABLED`; FEATURES/ARCHITECTURE reuse the existing flag error. | `INVALID_TYPE_FOR_OPERATION` (project convention); mark unverified in the message source; do not assert it in conformance until confirmed. |
| `__mdt` key prefix | Task text says `m0`; sources say first prefix is `m00`. | Own provisional pool `m00..`, never the `a..` custom range; one secondary source only, so document as an orglet choice if no public fixture confirms. Custom settings share the persisted custom prefix mechanism (no source). |
| Key prefixes for new objects | STACK: hand-maintained `keyPrefixes.json`. PITFALLS: nullable plus source. FEATURES: two agreeing community lists. | Both: `keyPrefixes.json` with a `source` label per entry (`doc`, `community-list`, `unverified`); six prefixes (AccountTeamMember `01M`, ContentVersion `068`, ContentDocument `069`, FeedItem `0D5`, EmailMessage `02s`, OpportunitySplit `049`) are single-list and stay `community-list` until a second source appears. No prefix means null, excluded from polymorphic matching. |
| sigha provenance | STACK/PITFALLS: `org-verified.json` is upstream's record of org-verified rows. | Open question 1. |

### OwnerId table (FEATURES, read from the Object Reference)

| `ownerTargets` | Objects |
|----------------|---------|
| `["User"]` | Account, Contact, Opportunity, Contract, Asset, Campaign, Individual, Solution, ContentVersion, ContentDocument |
| `["Group","User"]` (stay polymorphic) | Case, Lead, Task, SocialPost, Order, Location, ContactRequest, WorkOrder, ServiceAppointment, OperatingHours |
| `["Calendar","User"]` | Event (needs a `Calendar` baseline object or one `UNSUPPORTED:reference-target`) |
| no `OwnerId` (`hasOwner:false`) | Quote, QuoteLineItem, Entitlement, Product2, Pricebook2, PricebookEntry, EmailMessage, FeedItem, Address, OpportunityLineItem, CampaignMember, BusinessHours |
| contradictions | ServiceContract: Metadata API says queue-capable, Object Reference silent; use `["Group","User"]` (MEDIUM). Order: Object Reference says `Group, User` though Order is not a valid QueueSobject; follow the Object Reference because describe is what clients see. |

Check before the narrowing lands: which of Product2, Pricebook2, Entitlement, BusinessHours currently have `hasOwner:true` in the v1.0 baseline. Dropping `OwnerId` there yields a permanent `UNSUPPORTED:schema-drop` warning on every existing database (M4); the generator's v1-vs-v2 diff gate must list these.

## Implications for Roadmap

Phase numbers continue from v1.0 (phases 1-7). Seven phases plus one optional.

### Phase 8: Safety net, diagnostics, sigha preparation
**Rationale:** Everything later grows the baseline or changes contracts; the highest-risk failure (aborted `up` on an existing database) must be testable first, and several decisions (nullable prefix, diagnostic shape, sigha stance) are cheap now and expensive later.
**Delivers:** populated-DB upgrade test (v1.0 baseline files from git, Group-owned and `--import` rows, exact warning set asserted); migrate FK pre-check naming every offender (violations downgrade to a warning and skip the FK, never delete data); skip-existing-index optimisation; `keyPrefix: string | null` with source labels and uniqueness/collision tests; `Diagnostic`/`SkippedItem`/`FormulaFailure` types and `FormulaCompileError.missing` (strings untouched); portable `sync-sigha.sh` plus orglet-side expectation tests (colon, `!`, `!=`, `!` and `:` inside strings); upstream sigha PR opened (external lead time starts here); Group-owned test audit list for Phase 9.
**Avoids:** M1, B3, K1 groundwork, S1/S2 groundwork, M2.
**Research flag:** none (standard patterns), except the sigha provenance inquiry to upstream.

### Phase 9: Baseline generator, parity for the existing 35 objects, OwnerId narrowing
**Rationale:** The generator is the widest-blast-radius change; prove it reproduces the current shape first (no-op regeneration), then grow. OwnerId narrowing ships here because it is data in the same generator and needs the Phase 8 FK pre-check.
**Delivers:** `sync-sfdocs.sh` plus vendored subset with LICENSE/VENDOR.md; `scripts/gen-baseline/` (SOAP-type mapping table, union of `fields` and `field_reference`, `__c`/`__r` and `wsdl_segment` dropped, compound-field table, `overrides.json` with reasons, PDF cross-check, per-field provenance, no description prose); v1-vs-v2 diff gate (no v1 field disappears or narrows without an allowlist entry); child-relationship-name uniqueness check; parity for the existing 35 objects; `ownerTargets` per the table above; picklists stay `restricted:false` and bound to `standardValueSet` names that match the Metadata API exactly (B4).
**Addresses:** baseline parity, OwnerId narrowing (plain `Owner.X` now compiles for User-only objects).
**Avoids:** B1, B4, M3, M4, N2, N3, O1.
**Research flag:** short design spike (not a full research-phase): type mapping, `string` length rules, which flags are single-source.

### Phase 10: Business standard objects
**Rationale:** Needs the generator and corrected Account/Contact/Opportunity/Pricebook2 fields. Order of delivery by reference count: Order, OrderItem, Quote, QuoteLineItem first; ContentVersion/ContentDocument/FeedItem/EmailMessage last.
**Delivers:** the 18 objects with explicit create/update/delete/undelete/search flags from the Object Reference (OrderItem no undelete/search; CaseMilestone no create/delete; ContentDocument no create; ContentVersion no delete), no invented Name fields, blob fields omitted and listed in the generator report, `describe-check/objects.txt` extended, conformance `run-all.sh` after the phase (not only at milestone end), expected warning shifts written into the plan (B2). `examples/enterprise` fixture created from public docs with generic names.
**Avoids:** B2, B5, N1, G1.
**Research flag:** none beyond the verification list below (six single-list prefixes, `CasesId` naming, ContentVersion update disagreement).

### Phase 11: Custom metadata, custom settings, labels
**Rationale:** Must precede `$CustomMetadata`, `$Label`, `$Setup`, because compile resolves against these objects; also unlocks the `MetadataRelationship` `UNSUPPORTED:field-type` cascade.
**Delivers:** parsers; `__mdt` read-only `SObjectDef` with system fields, `m00..` key prefix pool included in `reconcileKeyPrefixes`; `seed.ts` (deterministic Ids from type + DeveloperName, persisted mapping, upsert/delete sync, two-pass MetadataRelationship resolution); custom settings shape (no `OwnerId`, `SetupOwnerId`, `customSetting: true`); values coerced by declared type (`"007"` stays a string, `xsi:nil` null, missing field warns); `labels` on `OrgSchema`; describe flags. `check` states "custom setting has no data in the retrieve".
**Avoids:** C1-C5.
**Research flag:** YES. MetadataRelationship stored value and describe spelling, `customSetting` flag on `__mdt`, DML error code, `m00` prefix, nil handling.

### Phase 12: Formula globals and sigha resync
**Rationale:** Needs Phase 11 data on `OrgSchema`; the resync goes first in the phase, so globals are not built on a lexer about to change.
**Delivers:** sigha resync to a pinned full SHA (upstream merged commit, or a named PR/fork commit recorded in VENDOR.md if the PR stalls; pass counts compared against the 6 312 baseline; NOTICE/LICENSE intact); `!` and colon resolution (`resolvePath` splits segments on `:`, qualifier selects the target, mismatch is a compile diagnostic); `$UserRole` (null role gives blank), `$Api`, `$Label` and `$CustomMetadata` (folded; unknown type/field is a compile error, unknown record evaluates blank with one aggregated `UNSUPPORTED:custom-metadata-record`), `$Setup` hierarchy (user, then profile, then org, per field; list settings `UNSUPPORTED:formula-global`); `$Permission` unchanged; update D-16.
**Avoids:** S1, S2, F1-F5, N4.
**Research flag:** YES (small): null user-level `$Setup` field fall-through, `$Api` URL shapes, `$Label` casing and `$Label.ns.Name`.

### Phase 13: Roll-up over formula fields
**Rationale:** Highest complexity; depends on the structured `FormulaRegistry` (dependency list, restriction check) from Phase 12 and `pendingBackfills`. Both touch `formulas.ts` and `engine.ts`, so serialise.
**Delivers:** `familyOf` accepts formula fields (summarized and filter) by return type; `RollupDef.viaFormula`; `FormulaRegistry` second validation pass (same-object only; no NOW/TODAY/TIMENOW, no `$User`/`$Profile`/`$Setup`/`$Api`/`$Label` roots, no dotted parent path) downgrading to `UNSUPPORTED:rollup-formula`; virtual-column support in `rollupSelectSql` (optional parameter, still pure); formula-aware `recomputeRollups`; widened `watched` set; `pendingBackfills` plus `backfillFormulaRollups`; cycle test; document O(children) recompute.
**Avoids:** R1 and the staleness risk.
**Research flag:** YES. Salesforce's allowed return types and restriction set (the Help article is JS-rendered; MEDIUM at best).

### Phase 14: `orglet check` report and enterprise acceptance
**Rationale:** Consumes the final set of warning areas and all structured diagnostics.
**Delivers:** `packages/cli/src/report.ts`: census, verdict line, per-area table keyed by the `UNSUPPORTED:<area>` token, root-cause grouping (every dependent kept, collapsed by default, both numbers stated), referenced-versus-unreferenced from one shared reference walk, quiet category (never fails `--strict`, never omitted from `--json`), `--summary` counts-only, `--json`, deterministic ordering, snapshot test of exact acme output; `examples/enterprise` runs with `--strict` in CI; DE retrieve still 0 warnings; local-only large-org run reported as counts per area. Conformance `run-all.sh` final run with every exclusion classified.
**Avoids:** K1, K2, K3, G1.
**Research flag:** none (design is sufficient).

### Phase 15 (optional, decide before requirements): ContentVersion blob upload/download
Multipart route, blob storage, `GET .../sobjects/ContentVersion/{id}/VersionData`, `VersionData` URL rewrite in SOQL shaping. Recommended OUT of v1.1 (open question 3).

### Phase Ordering Rationale

- Baseline and migration safety first because every other feature is exercised against baseline objects, and a failed `up` on an existing database is the worst regression.
- Loaders (11) before globals (12) because compile validates paths against the objects they create; globals before roll-up (13) because the roll-up validation pass reuses the structured registry; report (14) last because it needs every warning area to exist.
- sigha work is a parallel external track: PR on day 1, tests and portable script in Phase 8, resync at the start of Phase 12. Phases 9-11 do not depend on it; plain `Owner.X` on User-only objects compiles without the colon syntax.
- Warning counts on the large org will rise after Phases 10 and 11 and fall after 12. Judge Phase 10 by "no `standard-object` or `reference-target` warnings left for referenced objects", not by total count.

### Research Flags

Need `/gsd:research-phase`: Phase 11 (MetadataRelationship, mdt describe/DML specifics), Phase 12 (small: `$Setup` fall-through, `$Api`), Phase 13 (roll-up formula restrictions and return types).
Standard patterns, skip research: Phase 8, Phase 10 (use the FEATURES tables), Phase 14. Phase 9 gets a design spike, not a research phase.

## Open Questions for Johan (decide before requirements)

1. **`org-verified.json` in vendored sigha.** It is upstream's corpus of rows verified against a real org; it has shipped since v1.0, and it sits badly with the "never diff against a real org" rule. Options: accept as upstream's MIT data; drop it from the vendored copy (change the `sync-sigha.sh` copy list; the 6 312-case baseline count will change); or ask upstream for its provenance first. **Recommendation:** open an upstream issue now, and keep it out of the vendored copy until the answer is known if you want the rule applied strictly. Its size and which tests depend on it were not measured.
2. **Upstream PR versus pinned fork for sigha.** **Recommendation:** open the PR to `rfaulhaber/sigha` on day 1 (small, with corpus rows taken from the BSD-3 formula-engine oracle, not an org) and, in parallel, be ready to pin a named PR-branch or fork commit in `VENDOR.md` if it has not merged by Phase 12. Never carry a local patch; the milestone must not wait on upstream.
3. **ContentVersion blob upload/download in or out?** It needs a multipart route, blob storage and URL shaping, and `ContentDocumentLink` (the junction that makes a file visible on a record) is a bigger gap that real retrieves reference. **Recommendation:** OUT of v1.1. Model ContentVersion/ContentDocument as data objects without blob fields, record both gaps in the backlog. Move it in only if the large org's formulas or roll-ups depend on file content (they should not).
4. **`$Setup` for list custom settings out?** All three researchers independently lean out (Visualforce docs say unavailable; a list setting has no unambiguous row). **Recommendation:** confirm out; `UNSUPPORTED:formula-global`; hierarchy only.
5. **Sign-off on the data sources.** The legal reading is the researcher's, not legal advice. Confirm you are comfortable with (a) vendoring the Apache-2.0 sf-skills subset (facts only, no description prose), (b) reading the public Object Reference PDF as a cross-check, (c) community key-prefix lists as labelled secondary sources.
6. **Gated-field policy** (include with `featureGated` tag versus the v1.0 README rule of skipping them). Recommendation above: include.
7. **OwnerId FK violation policy.** Downgrade to a warning and skip the FK when existing rows violate it (recommended), or abort `up`. Related: accept removing `OwnerId` from objects that gain `hasOwner:false`.
8. **Roll-up formula violations: warn versus fail load.** Recommendation above: warn.
9. **Custom-setting data.** The retrieve carries definitions only. Confirm the stance: no seed invented; `examples/enterprise` ships a small seed script for the fixture; `check` says so.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Licence, coverage and shape of the sf-skills dataset were read and measured; sigha `!`/colon verified in the formula-engine grammar and the vendored lexer. Dataset sufficiency MEDIUM (overrides required). |
| Features | MEDIUM-HIGH | Object shapes and metadata formats come from the current public PDFs (HIGH). Formula-global semantics, queue-owner error codes and roll-up formula rules came through search snippets (MEDIUM/LOW). Several items are explicitly UNVERIFIED. |
| Architecture | HIGH (integration), MEDIUM (Salesforce semantics) | Read from the code in 12+ files. Roll-up restrictions, `$Setup` on list settings and MetadataRelationship values were not verified against docs. |
| Pitfalls | MEDIUM-HIGH | Code-level claims HIGH; Salesforce-side claims secondary-sourced. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- Key prefixes: six single-list community entries, mdt `m00` single secondary source, custom-setting series no source. Handle with source labels; verify in Phases 9-11; never invent.
- Exact DML error code for `__mdt` and for a queue owner on a non-queue object. Use the project convention, flag unverified, do not assert in conformance.
- `customSetting` value on `__mdt` describe; `Label`/audit fields in the `__mdt` describe (Metadata API and Object Reference contradict).
- `$Setup` null-field fall-through and `$UserRole` fields restricted in formulas (VF excludes four): research flag in Phase 12.
- Roll-up-accepted formula return types and the real restriction set: Phase 13 research.
- jsforce/simple-salesforce wire form for ContentVersion `VersionData` create: inspect the pinned SDK sources in `conformance/` only if question 3 goes IN.
- Dataset field lengths are partial; defaults (255, flagged `guessed`) need review. Precision/scale come from the existing baseline via overrides (hand overrides win; never overwrite).
- `FeedItem.ParentId`, `OpportunitySplitType` (prefix `149`) and `Calendar` are lookup targets outside the requested list; each needs either a baseline entry or one `UNSUPPORTED:reference-target`.
- Index/FK statement volume and `up` time with ~50 more objects are unmeasured; budget no more than 2x and track `statements.length`.

## Watch Out For

1. Warning counts go UP when Quote, Order and friends land (their retrieved validation rules, formulas and lookups start loading). Plan the expected shifts; do not read the total as regression.
2. Never ship a guessed key prefix. Null plus exclusion from polymorphic matching beats a plausible wrong one that mints Ids that mean something else after migration to a real org.
3. `migrate` aborts the whole transaction on a NOT NULL or FK violation. Pre-check, name all offenders, downgrade to a warning, test on a populated database.
4. Narrowing every `OwnerId` is wrong. Case, Lead, Task, Order and others stay polymorphic; `conformance/poly-check` and several unit tests use Group owners.
5. The sf-skills dataset leaks org-specific `__c`/`__r` fields from doc examples and its `wsdl_segment` is org-derived: drop both. Do not copy description prose. `field_reference` fields have no create/update flags: default read-only and record that.
6. Never run `sync-sigha.sh` in CI; always give it a full SHA; it wipes anything outside its layer list; fix the BSD-only `sed` as a separate reviewed change.
7. `$Setup` must not be baked at compile time (stale after DML); `$Label`/`$CustomMetadata` must not hit the DB at evaluate time (breaks `check` and costs per row). Load `$Setup` once per batch, not per row.
8. `$Api` values: no `Host` header, no persisted session token, no roll-up use.
9. Roll-up over a formula that reads a parent is stale when the parent changes; same-object only is a correctness guard, not just fidelity.
10. Root-cause grouping must never hide an independent second error or let `--strict` pass; the quiet set and the warning set must come from the same reference walk.
11. Keep the `warning: UNSUPPORTED:<area>` line format on stderr; CI, docs and the acceptance record parse it.
12. Hard constraint: `examples/enterprise` is authored from public docs with generic names (`Acme_*`, `Widget__c`), never by sanitising a copy of the private retrieve. No object, field, label or validation-rule names from the large org in plans, commits, issues or the research files; report only counts per area. Keep the denylist outside the repo.
13. Generated JSON must be deterministic (no timestamps, fixed comparator, v1 field order kept, append-only) or every regeneration is a huge diff.
14. Standard picklist values are per-org: `restricted:false`, `standardValueSet` names must match the Metadata API exactly, and a retrieve override must still win wholesale (test it).

## Sources

### Primary (HIGH confidence)
- `forcedotcom/sf-skills` (Apache-2.0): `platform-data-and-tooling-api-context-get`, `platform-metadata-api-context-get`, `platform-docs-get`
- `salesforce/formula-engine` (BSD-3): `Formula.g4`, `LexerRules.g4`, `ANTLR4GrammarVisitor.java`, `FormulaUtils.java`
- `rfaulhaber/sigha` (MIT) and the vendored `packages/sigha`
- Public Object Reference, Metadata API, REST API and Tooling API PDFs at `resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/` (v68.0)
- Repository code: `packages/{metadata,schema,formula,engine,cli}/src/*`, `scripts/sync-sigha.sh`, `conformance/{poly-check,describe-check}`, `.planning/PROJECT.md`

### Secondary (MEDIUM confidence)
- Visualforce global-variable pages (`$Api`, `$Setup`, `$UserRole`, `$Label`) via search snippets; Apex custom-settings pages (snippets); Salesforce Help roll-up article (snippet)
- Two community key-prefix gists and Apex Hours (agree with each other)
- Trailhead module on custom metadata in formulas; Custom Metadata Types Implementation Guide (Spring '17, dated)

### Tertiary (LOW confidence, needs validation)
- Third-party blog posts on roll-up restrictions and custom-setting field limits; AutoRabit prefix cheat sheet; `m00` custom-metadata prefix from a single secondary source

---
*Research completed: 2026-10-12*
*Ready for roadmap: yes, after the decisions in "Open Questions for Johan"*
