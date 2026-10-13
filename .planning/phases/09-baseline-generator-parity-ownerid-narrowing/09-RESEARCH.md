# Phase 9: Baseline Generator, Parity & OwnerId Narrowing - Research

**Researched:** 2026-10-13
**Domain:** Deterministic code generation of the standard-object baseline JSON from two public documentation snapshots; schema-compatible growth of an existing populated database; per-object `OwnerId` narrowing.
**Confidence:** MEDIUM-HIGH (data shapes and parity numbers were measured on the real inputs on 2026-10-13; legal reading of the PDF extraction is MEDIUM; Salesforce describe fidelity of guessed numeric precision is LOW by nature)

## Summary

This is a design spike, so most of the research was empirical: both sources (sf-skills `enterprise_api/*.json` at commit `4bbae5c421e51b40e4169afa72c4496372a602a7`, 2026-10-09, and the Object Reference PDF, Last-Modified 2026-10-09, 21.3 MB, 6437 pages, sha256 starts `6b9d3731`) were downloaded and compared against the 35 committed v1.0 objects (659 fields in `packages/metadata/standard/objects`). The sources are workable but three facts reshape the plan:

1. **The generator cannot reproduce v1.0 from the sources alone.** Of 623 v1.0 fields that exist in sf-skills, about 52 differ in label, 25 in `createable`, 19 in `updateable`, 26 in `nillable`, 26 in `referenceTo` (for example `RecordTypeId`, where sf-skills has an empty `refers_to`); lengths differ for 8 text fields (including a would-be **narrowing**: `UserLicense.Name` 80 in v1.0, 40 in `field_reference`); and neither source contains `precision`/`scale` at all (79 v1.0 numeric fields carry them). SC2 step 1 ("regenerate the 35 first, no-op diff") therefore needs a **v1.0 pin layer** (a committed, reviewable list of per-field v1.0 facts that differ from the sources, bootstrapped mechanically from `test/fixtures/baseline-v1.0`), not just `overrides.json` hand facts. Without it, step 1 is impossible.
2. **The two sources are not independent.** The PDF's per-field blocks (`Type / Properties / Description / Relationship Name / Refers To`) are the same content that sf-skills' `fields` table was generated from. For 22 of the 31 comparable objects the field name sets are identical. "Verified = both sources agree" therefore mostly proves the PDF extraction is correct, not that Salesforce behaves that way. The honest value of the PDF is (a) fields sf-skills deliberately splits out or omits (Person Account fields live under `ispersonaccount_fields` in sf-skills; the Data.com Clean fields on Contact/Lead are only in the PDF), (b) objects sf-skills lacks (`BusinessProcess` is in neither, `Event`/`Product2`/`Profile`/`UserRole`/`DandBCompany` were not found by my crude heading detector, see Pitfall 7), and (c) cross-checking `Refers To`.
3. **Roughly 774 new non-custom fields land on the existing 35 objects** (sf-skills `fields` alone), 17 of which look required (not Nillable, Create, not Defaulted) and would start returning `REQUIRED_FIELD_MISSING` for inserts that work today. Migration is mechanically safe (`migrate()` only creates `NOT NULL` columns for system fields, `MasterDetail` and `Checkbox` with default; nillable is engine-enforced only), but behavioural safety needs an explicit rule (see Pattern 6).

**Primary recommendation:** Build `scripts/gen-baseline/` (TypeScript run with `tsx`, no new dependencies) as a pure function `generate(inputs) -> {objects, provenance, report}` layered as: sources -> type mapping -> v1.0 pins -> `overrides.json` -> deterministic serialiser. Land it in two verifiable steps: (A) generator + pins reproduce the 35 v1.0 files byte-for-byte (test against the frozen fixture), then (B) switch on "all documented fields" and `ownerTargets`, with the v1-vs-v2 gate and allowlist active from step B onward. Rework the Phase 8 upgrade test's "no ALTER TABLE" assertion into "only `ADD COLUMN`, never `DROP`/`ALTER ... TYPE`/`DROP TABLE`" (it currently forbids every `ADD COLUMN`, which v2 necessarily triggers).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Sources and the "verified" rule**
- **D-01:** Two committed, licence-attributed snapshots feed the generator. (a) The sf-skills dataset `enterprise_api/<Object>.json` (Apache-2.0, Salesforce, Inc.) for exactly the objects orglet models, vendored by a `scripts/sync-sfdocs.sh <sha>`-style script that pins a commit SHA and copies LICENSE plus a VENDOR.md (SHA, date), following the sigha precedent. (b) A normalised per-object extraction of the public Object Reference PDF (`https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/object_reference.pdf`, reachable: HTTP 200, 21 MB, Last-Modified 2026-10-09) produced locally with `pdftotext` (installed, 26.04.0) by a committed snapshot script. The extraction holds only facts (field name, type, flags, length, Reference To, relationship names); no documentation prose. The PDF itself is never committed (size and Salesforce copyright). VENDOR.md records the PDF URL, Last-Modified and sha256.
- **D-02:** The generator (`pnpm baseline:gen` or similar) is pure and offline: it reads only the committed snapshots and overrides and never touches the network. The two snapshot scripts are the only network steps, run manually, never in CI. CI runs the generator against the committed inputs as a drift gate.
- **D-03:** A field present in only one source is included and marked (`sdk-only` or `doc-only`). A fact (type, flag, length, target) is `verified` only when both sources agree. A disagreement between the sources is never resolved silently: it must be settled by an `overrides.json` entry with a reason (BASE2-01); until then the generator reports it as a conflict (abort vs. emit-and-mark is Claude's call, see discretion).
- **D-04:** Provenance (verified / sdk-only / doc-only / guessed / v1.0 / override) lives in a separate committed report next to the objects (for example `packages/metadata/standard/PROVENANCE.json`), not in the object JSON. The object files keep the exact v1.0 `StandardObjectJson` shape so the no-op diff of SC2 is genuine. The loader and describe never read the provenance file; `orglet check` may.
- **D-05:** A text-like field (`string`, `textarea`, `phone`, `url`, `email`) with no length in either source (no length column, no "Maximum size is N characters") gets `length: 255` and is marked `guessed` in the provenance report so `overrides.json` can correct it later.
- **D-06:** A field that v1.0 has but neither source mentions (research spotted `Account.Tier`) is kept through an `overrides.json` "keep" entry with the reason "present in v1.0, absent from sources" and provenance `v1.0`. It leaves only when someone deliberately adds a diff-allowlist entry (D-16).
- **D-07:** Key prefixes of the 35 existing objects are hand facts in `overrides.json`. All 35 keep their prefix; none becomes null in this phase (they are v1.0 data, the diff gate protects them, and a null prefix requires `createable: false` per Phase 8 D-10). The generator writes `keyPrefixSource` for each: `doc` when public Salesforce documentation confirms it (for example the public record-ID prefix article), `sdk-fixture` when a public SDK fixture (jsforce, simple-salesforce) confirms it, otherwise `unverified`. Never from an org. The two-independent-sources rule of BASE2-05 applies in full to objects added from Phase 10 on.

**Feature-gated fields**
- **D-08:** Gating is detected by a committed keyword list in the generator configuration (Person Accounts, Data.com/Jigsaw, Territory Management, Knowledge, Omni-Channel, Field Service, Social, Chatter, and phrases such as "available when/if X is enabled") matched against the sources' prose at generation time. Prose is read, never emitted. `overrides.json` can force a field gated or not gated with a reason. The generator report lists every heuristic hit so the list is reviewable in the PR.
- **D-09:** A gated field keeps its documented `createable`/`updateable` flags; `nillable` is forced `true` so a field no org may have never yields `REQUIRED_FIELD_MISSING`. It is tagged `featureGated: true` in the baseline JSON (new optional key on `StandardFieldJson`), replacing the v1.0 README rule of skipping such fields.
- **D-10:** The tag is not exposed in describe. Describe shows the field as a plain nullable field with the exact Salesforce key set (the describe-check contract compares key sets against the SDKs). The tag is visible in the baseline JSON and in the `orglet check` output. SC3's "tagged `featureGated`" is satisfied at baseline/check level, not as a describe key.

**OwnerId narrowing (folds todo 2026-10-08-narrow-baseline-ownerid-per-object)**
- **D-11:** `StandardObjectJson.ownerTargets?: ("User" | "Group")[]` is an object-level key; absent means `["User", "Group"]` (today's behaviour). The README rule that OwnerId is never listed in `fields[]` stays; `build.ts#systemFields` threads `ownerTargets` into `OwnerId.referenceTo`. The generator writes it for every owned object from the Object Reference "Reference To" line, following the BASE2-04 list (User-only: Account, Contact, Opportunity, Contract, Asset, Campaign, Individual, Solution; User and Group: Case, Lead, Task, SocialPost, Location, ContactRequest, WorkOrder, ServiceAppointment, OperatingHours, ServiceContract; none on Quote-family, Entitlement, Product2, Pricebook2, PricebookEntry, EmailMessage, FeedItem, Address). Each override carries reason and source.
- **D-12:** Event (documented as Calendar and User) gets `ownerTargets: ["User"]` through an override with the reason "Calendar not modelled; widen when a Calendar object lands". No object is invented.
- **D-13:** Custom objects (`__c`) keep `["User", "Group"]`. Reading `queues/*.queue-meta.xml` to narrow them is a deferred idea (see below).
- **D-14:** An existing database holding a queue-owned row on a now-User-only object gets the Phase 8 behaviour: `migrate()` skips the new OwnerId FK with one `UNSUPPORTED:schema-fk` warning and rewrites nothing; the FK is added silently once the data is corrected. The upgrade-test fixture is not extended with such a row (its Group-owned rows are Cases, which stay queue-enabled), so `EXPECTED_WARNINGS` stays empty unless a plan adds a case deliberately.
- **D-15:** Test disposition follows `08-GROUP-OWNED-AUDIT.md`: Group-owned scenarios on objects that become User-only move to Case or Lead; new negative tests assert that a Group Id on `Account.OwnerId` is rejected with `INVALID_CROSS_REFERENCE_KEY`; `conformance/poly-check` already uses Case and is unchanged; the audit's "Phase 9 disposition" column is filled in by the plan that touches each row.

**v1-vs-v2 diff gate and allowlist (MIGR-03)**
- **D-16:** The allowlist is its own file next to the overrides (`scripts/gen-baseline/diff-allowlist.json` or the generator's equivalent location) with entries `{ object, field, kind: "removed" | "narrowed", reason }`. `overrides.json` states facts about Salesforce; the allowlist states deliberate migration exceptions.
- **D-17:** "Narrows" is schema-level only: a removed field, a changed type, or a decreased length/precision/scale, mirroring what `migrate()` reports as `schema-drop`/`schema-narrow` (`isWidening`). Flag changes (createable, updateable, nillable, restrictedPicklist) follow the documentation freely and need no allowlist entry.
- **D-18:** The gate runs twice: a vitest test under `packages/metadata/test` regenerates in memory and compares against the frozen `packages/metadata/test/fixtures/baseline-v1.0` fixture from Phase 8 plus the allowlist, with one clear message per offending field; and a CI step `pnpm baseline:gen && git diff --exit-code packages/metadata/standard` catches uncommitted regeneration. A new MasterDetail field on an object that existed in v1.0 is a generator error (MIGR-03).
- **D-19:** Output is deterministic: fields sorted alphabetically by plain code-unit compare (the v1.0 files already are, so this is a no-op for them), stable key order matching the existing files, 2-space JSON, trailing newline, no timestamps. New databases get the sorted order; existing databases are unaffected because `migrate()` appends new columns.

### Claude's Discretion
- Generator location and layout (research recommends `scripts/gen-baseline/` run with `tsx`, not a workspace package), pnpm script names (`baseline:gen`, `baseline:snapshot`, ...), and the format of the generator report and of the provenance file.
- The SOAP-type to `FieldType` mapping table, the string-length extraction rules and the single-source flag semantics: the ROADMAP research flag is a design spike on exactly these, to be settled in research/planning within D-03 and D-05.
- How the pdftotext extraction parses the per-object field tables, and how robust it must be (it is a manual, reviewed snapshot step; a diff of the committed extraction is the review).
- Whether a source conflict (D-03) aborts the generator or emits the sf-skills value marked `conflict`; in both cases the report names it and the committed baseline must contain no unresolved conflict.
- Whether the v1.0 `description`-free README rules are restated in a generated-file header comment or only in README.md (no prose from Salesforce either way).

### Deferred Ideas (OUT OF SCOPE)
- Narrow custom-object OwnerId from the retrieve's `queues/*.queue-meta.xml` (D-13); candidate backlog item.
- Thin Calendar object so Event can declare `["User","Calendar"]`; belongs with Phase 10 or later (D-12).
- Re-enabling the excluded jsforce insert-from-file conformance test if Data.com gated fields make it pass: optional in this phase, otherwise Phase 14 acceptance.
- Reviewed, not folded: `Relationship:Object.Field` colon syntax (Phase 12). Also out of scope: the 18 new business objects (Phase 10), `!` operator (Phase 12), the check report (Phase 14).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BASE2-01 | Deterministic generator under `scripts/`; byte-identical on re-run; CI fails on drift; no prose committed | Pattern 1 (pure pipeline), Pattern 5 (serialiser), CI gate in Code Examples; PDF/prose handling in Pitfalls 4, 8 |
| BASE2-02 | Regenerating the existing 35 reproduces v1.0 (no-op), then adds every documented field; diff gate | Finding 1 (v1.0 pin layer is required), Pattern 2 (two-step landing), Pattern 7 (diff gate mirrors `isWidening`) |
| BASE2-03 | Feature-gated fields included as nullable tagged fields; zero `UNSUPPORTED:standard-field` on documented fields | Pattern 4 (gating), measured evidence that PDF-only fields are Data.com/Person-Account fields, `build.ts` line ~505 check path |
| BASE2-04 | `OwnerId.referenceTo` per object; `Owner.Name` works in formula/SOQL for User-only objects | Pattern 3 (`ownerTargets`), measured Refers-To table, conflicts (ServiceContract, Group, Event), audit-driven test moves |
| MIGR-03 | Generator refuses a new MasterDetail on an object existing in v1.0; v1-vs-v2 diff gate with allowlist | Pattern 7, migrate NOT NULL analysis, master-detail detection gap (Pitfall 6) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Build only from public documentation and open-source SDK source; never diff behaviour against a real org (Developer MSA). No `describe` from an org as a source, no Enterprise WSDL.
- Apache-2.0 project; dependencies must be OSI-licensed. The generator needs **no new dependency** (use `node:fs`, `node:crypto`, `node:child_process` for `pdftotext`; `tsx` already a root devDependency).
- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), ESM, relative imports carry `.js`, `import type` enforced by ESLint, Node 22, pnpm 10+, vitest. Co-located tests are `*.test.ts`; metadata tests also live under `packages/metadata/test`.
- Every source file opens with a `/** ... */` block explaining why it exists; domain-only inline comments; English in code/commits/docs.
- `UNSUPPORTED:<area>` convention is mandatory for anything not implemented (new areas this phase: reuse `standard-field`; add `standard-field-type` for documented types the baseline cannot model).
- Data: only Level 1 data in the emulator and in Claude context; no Tele2 names anywhere (memory: orglet is stand-alone, no Tele2 attribution). Everything used here is public documentation.
- Git identity: repo-local Johan Karlsteen <johan@karlsteen.com>. Creating the GitHub repo/first push is confirmed with Johan (not relevant to this phase's PR flow, but never push without asking).
- Never run `pnpm build` in two parallel executors (shared `dist`).
- GSD: file edits go through GSD workflow commands.

## Standard Stack

### Core
| Component | Version | Purpose | Why |
|-----------|---------|---------|-----|
| TypeScript script run by `tsx` | tsx `^4.20.0` (lockfile 4.23.15) | Generator + snapshot extractor in `scripts/gen-baseline/` | Already a root devDependency; no build step; zero new deps (CONTEXT research recommendation) |
| `node:fs`, `node:path`, `node:crypto`, `node:child_process` | Node 22 | IO, sha256 of the PDF, spawn `pdftotext` | Standard library suffices |
| sf-skills `enterprise_api/<Object>.json` | commit `4bbae5c421e51b40e4169afa72c4496372a602a7` (2026-10-09) | Primary field catalogue | Apache-2.0 (`LICENSE.txt`, "Copyright (c) 2026 Salesforce, Inc."), SKILL.md metadata `minApiVersion: 67.0` |
| `pdftotext -layout` (poppler) | 26.04.0 installed | Local, manual PDF snapshot step only | Verified: `-layout` output is parseable (15 s, 324,847 lines for 6437 pages) |
| vitest | 3.2.7 | Determinism test, parity test, diff-gate test, upgrade test | Existing workspace config; `include` globs already cover `packages/metadata/test/**` |

### Supporting
| Item | Purpose | When to use |
|------|---------|-------------|
| `packages/metadata/test/fixtures/baseline-v1.0` (37 files, frozen) | Ground truth for step A byte-identity and for the v1-vs-v2 diff gate | Always; never edited |
| `packages/schema` `migrate()` / `isWidening` semantics | Definition of "narrows" for the gate | Mirror the rules, do not import `migrate` into the script |
| `Diagnostic`/`pushDiagnostic` in `packages/metadata/src/diagnostics.ts` | Surfacing gated fields in `orglet check` | Only if check lists them (optional, see Open Question 4) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `scripts/gen-baseline` + tsx | a new workspace package | Extra tsconfig/references/barrel for a dev-only tool; CONTEXT recommends scripts. Requires the lint/tsconfig fix in Pitfall 1 |
| Parsing PDF with `pdftotext -layout` | `pdf-parse`/`pdfjs-dist` | New dependency, slower, no better structure. Do not add |
| Embedding provenance in object JSON | separate `PROVENANCE.json` | Locked by D-04 |

**Installation:** none. Add root scripts only:
```json
"baseline:gen": "tsx scripts/gen-baseline/generate.ts",
"baseline:check": "tsx scripts/gen-baseline/generate.ts --check",
"baseline:snapshot": "tsx scripts/gen-baseline/snapshot-pdf.ts"
```
plus `scripts/sync-sfdocs.sh <sha>` (bash, mirrors `sync-sigha.sh`).

**Version verification:** sf-skills HEAD resolved via GitHub API on 2026-10-13 (`4bbae5c4...`, committed 2026-10-09T23:30:06Z); Object Reference PDF HEAD: `last-modified: Fri, 09 Oct 2026 22:12:36 GMT`, `content-length: 21277574`. Pin both in VENDOR.md; re-pinning later is a deliberate PR.

## Architecture Patterns

### Recommended Project Structure
```
scripts/
├── sync-sigha.sh                       # existing
├── sync-sfdocs.sh                      # NEW: vendor enterprise_api/<Object>.json for the object list + LICENSE + VENDOR.md
└── gen-baseline/
    ├── generate.ts                     # CLI: reads inputs, writes standard/objects + PROVENANCE.json (or --check)
    ├── pipeline.ts                     # pure: generate(inputs) -> { files, provenance, report }  (test imports this)
    ├── sources.ts                      # load sf-skills + PDF-extraction, normalise to one SourceField shape
    ├── typemap.ts                      # SOAP type -> FieldType table (data) + length/precision defaults
    ├── gating.ts                       # keyword list + matcher (prose read, never emitted)
    ├── snapshot-pdf.ts                 # MANUAL: pdftotext -> normalised facts JSON (the only other network step besides sync-sfdocs.sh)
    ├── objects.json                    # the object list (data input; Phase 10 appends 18)
    ├── overrides.json                  # facts about Salesforce: keys, ownerTargets, keeps, forced gating, length fixes (each with reason)
    ├── v1-pins.json                    # per-field v1.0 facts that differ from sources (bootstrapped from the fixture, reviewed)
    ├── diff-allowlist.json             # deliberate migration exceptions (D-16)
    └── source/                         # committed snapshots
        ├── sf-skills/<Object>.json (+LICENSE, VENDOR.md)   # vendored subset, fields/field_reference/ispersonaccount_fields ONLY
        └── object-reference/<Object>.json (+VENDOR.md)     # normalised extraction: names/types/flags/refs, no prose
packages/metadata/standard/
├── objects/*.json                      # generator output (exact StandardObjectJson shape)
├── PROVENANCE.json                     # generator output (D-04)
├── GENERATED.md or README.md           # rules + attribution (see Licence)
└── standardValueSets.json              # stays hand-maintained
packages/metadata/test/baseline-generator.test.ts   # determinism, step-A byte-equality, parity, diff gate
```
Where to place the vendored sf-skills copy: inside `scripts/gen-baseline/source/` (build input, not shipped). `packages/metadata/package.json` `files` lists `standard`; keep sources out of the published package.

### Pattern 1: Pure pipeline, thin IO shell
**What:** `pipeline.ts` takes already-parsed inputs and returns `{ files: Map<path,string>, provenance, report, conflicts }`; `generate.ts` does IO. The vitest gate calls `pipeline.ts` directly, so "regenerate in memory" (D-18) needs no filesystem writes and no child process.
**When:** always. Output serialisation (`JSON.stringify(value, null, 2) + "\n"`) lives only in `pipeline.ts` so the CLI and the test cannot diverge.

### Pattern 2: Two-step landing (SC2)
Step A (commit 1): inputs = sf-skills + PDF extraction restricted to the field names already present in v1.0, plus `v1-pins.json`. Test: `pipeline(...)` output equals every file in `test/fixtures/baseline-v1.0/objects/*.json` byte-for-byte (the live `standard/objects` files at that moment are identical to the fixture; assert both). Step B (commit 2): remove the field restriction (all documented fields), add `ownerTargets`, `featureGated`, gating; regenerate; the diff gate becomes active. The first regenerated tree is committed with the allowlist in the same commit so CI is green.

`v1-pins.json` is **bootstrapped** by a one-off mode (`--bootstrap-pins`) that runs the pipeline on sources only and emits, per v1.0 field, only the keys that differ from the derived value, with reason "v1.0 value; sources differ" (this will be a few hundred small entries: labels, flags, referenceTo, lengths, precision/scale for numerics, Text-vs-AutoNumber/Name types). Review diff of `v1-pins.json` is where Johan decides which differences should instead adopt the source value (flag changes may be adopted freely per D-17 by deleting the pin in step B; schema-level facts - type, length, precision, scale - must stay pinned or be allowlisted).

### Pattern 3: `ownerTargets` (D-11)
- `types.ts`: `StandardObjectJson.ownerTargets?: ("User" | "Group")[]`.
- `build.ts#systemFields(hasOwner, ownerTargets?)`: replace the literal at line ~118 with `owner.referenceTo = [...(ownerTargets ?? ["User", "Group"])]`; `fromStandardObject` passes `j.ownerTargets`. Extend `validateBaseline` (do not add a second validator): non-empty subset of `{User, Group}`, only allowed when `hasOwner`.
- Everything downstream already keys off `referenceTo.length`: DDL adds a FK only for `length === 1` (`ddl.ts:46`), SOQL polymorphic join only for `> 1` (`soql/compile.ts:162`), formula rejects only `> 1` (`formula/compile.ts:109`), describe `polymorphicForeignKey` is `> 1` and `namePointing` is `f.name === "OwnerId" || >1` (`describe.ts:142`). So `Owner.Name` on a User-only object resolves as a plain single-target relationship with no further compiler change; SC4 needs tests, not new compiler code. `namePointing` stays true for OwnerId unchanged (describe-check compares key sets, not values; whether a real org says false for User-only owners is unverified, LOW, leave alone).
- Generator derives the list from the `Refers To` of `OwnerId` (PDF) / `refers_to` (sf-skills): `User` -> `["User"]`, `Group, User` -> absent key (default), then applies `overrides.json` `ownerTargets` entries. Write the key **only when narrower than the default**, so the 8 untouched objects keep byte-identical files (only the User-only ones change in step B).

Measured Refers-To (sf-skills, 2026-10-13) against the locked D-11 list:

| Object | sf-skills `OwnerId.refers_to` | D-11 / BASE2-04 | Result |
|--------|------------------------------|-----------------|--------|
| Account, Contact, Opportunity, Contract, Asset, Campaign, Individual, Solution | `User` | User-only | agree |
| Case, Lead, Task, SocialPost, Location, ContactRequest, WorkOrder, ServiceAppointment, OperatingHours | `Group, User` | User and Group | agree (default, no key) |
| Event | `Calendar, User` | `["User"]` by override (D-12) | agree via override |
| **ServiceContract** | **no `refers_to`; description says "the ID of the user who currently owns"; the PDF block has no `Refers To` either** | **User and Group** | **CONFLICT with the locked list; see Open Question 1** |
| **Group** (in the baseline, `hasOwner: true`) | `Organization, User` | not listed | **needs an explicit decision, see Open Question 2** |
| Quote, Entitlement, Product2, Pricebook2, PricebookEntry, EmailMessage, FeedItem, Address | no OwnerId in `fields` (Quote has one only in `field_reference`) | none | agree (only Entitlement/Product2/Pricebook2/PricebookEntry are in the 35, all `hasOwner: false`) |

### Pattern 4: Feature gating (D-08..D-10)
- `gating.ts` holds the keyword list as data; matching runs on the description prose of **both** sources at generation time and records only `{object, field, keyword}` in the report/provenance (a keyword and a short rule id, never a sentence).
- Strong structural signals found in the data, use them in addition to prose: (1) sf-skills `ispersonaccount_fields` on Account (33 entries; all 29 PDF-only extra Account fields are exactly these); (2) Contact/Lead PDF-only fields are the Data.com Clean family (`CleanedByJob`, `IsDifferent*`, `DataDotComId`, `ContactStatusDataDotCom`, ... 46 and 51 fields). These are the fields jsforce's CSV fixture needed (`JigsawCompanyId`).
- Output: `"featureGated": true` on the field and `nillable: false` is **not written** (nillable defaults to true), i.e. D-09 is "never write `nillable: false` for a gated field". `fromStandardJson` needs `copy("featureGated")` and a new optional `featureGated?: boolean` on `FieldDef` (types.ts) so `orglet check` can see it; describe must not read it (D-10). Add a describe-key regression assertion (the field's described key set equals a non-gated field's).
- Rewrite `standard/README.md`: delete the "Skip fields that only exist when a feature is enabled" rule; add the `featureGated`/`ownerTargets` rules and "generated; edit overrides, not these files".

### Pattern 5: Deterministic serialisation (D-19)
- Field sort: `a.name < b.name ? -1 : a.name > b.name ? 1 : 0` (code-unit, not `localeCompare`). Verified the 35 v1.0 files already satisfy this; assert it in the step-A test, otherwise the premise "sort is a no-op" is false.
- Key order within a field and an object: copy the existing order (`name,label,type,length,precision,scale,...` and `name,label,labelPlural,keyPrefix[,keyPrefixSource],...,hasOwner,[ownerTargets],fields`). Derive the order from a single `FIELD_KEY_ORDER` array in `pipeline.ts`, built by scanning the v1.0 files once (field-key frequency in v1: name, label, type, createable, updateable, length, nillable, referenceTo, relationshipName, defaultedOnCreate, compoundFieldName, precision, scale, picklistValues, defaultValue, restrictedPicklist, nameField, childRelationshipName, standardValueSet, idLookup, displayFormat, unique, groupable, sortable). Note the existing files are **hand-formatted**: Account.json is expanded one-key-per-line, but Event.json has single-line field objects. Step A therefore cannot be byte-identical with a plain `JSON.stringify(…, null, 2)`. Decide once, in step A: either (preferred) accept a one-time mechanical reformat of all 35 files in the same commit as the generator and make the *semantic* no-op the SC2 test (deep-equal of parsed JSON against the fixture, plus byte-equality of generator-vs-committed from then on), or implement a "compact object when it fits" printer. Recommend the first: simple, honest, and the v1.0 fixture stays untouched. Flag it in the plan so the reviewer is not surprised by a 35-file whitespace diff. (Open Question 3.)
- Never emit timestamps, absolute paths, or the generation date. Provenance records source pins (commit SHA, PDF sha256) only.

### Pattern 6: Rules for fields that are new to a v1.0 object
Rules for deriving a field from sources, in precedence order: `overrides.json` > `v1-pins.json` > source-derived > type defaults.
- **Required-looking new fields:** a field that is new to one of the 35 and is not Nillable, Create-able, not Defaulted-on-create (17 found; some are artefacts: `Event.AcceptedEventInviteeIds`, `Task.TaskWhoIds` are `JunctionIdList`, `CampaignMember.AccountId`, `User.Manager`) must not start failing existing inserts. Recommended default: write them without `nillable: false` (i.e. nillable) and list them in the report as "newly required in docs, forced nullable"; `overrides.json` can restore `nillable: false` with a reason. Do not apply to v1.0 pinned fields. Rationale: BASE2-02 promises existing objects "keep their shape"; engine required-field checks are the only place nillable matters (DB has no NOT NULL).
- **Column additions are safe by construction:** `columnFor` makes only system fields, `MasterDetail` and `Checkbox` (default false) `NOT NULL`. Any new `Checkbox` gets `DEFAULT false NOT NULL` which PostgreSQL fills for existing rows, so it is also safe. MasterDetail is the only hazard, hence MIGR-03.

### Pattern 7: v1-vs-v2 diff gate (MIGR-03, D-16..D-18)
Compare, per object and field, fixture (v1.0) vs generated (v2) using the same notion as `isWidening`, computed on the metadata level, not by importing `migrate`:
- removed field (v1 field absent in v2) -> needs `{kind: "removed"}` allowlist entry;
- type change -> `narrowed`; length/precision/scale decrease -> `narrowed`; for numerics also integer digits `precision - scale` decrease or `scale` decrease (exactly `isWidening`'s `t.a - t.b >= f.a - f.b && t.b >= f.b`), and `varchar -> text` and `numeric` rules; text length growth is fine. (Check which Postgres types `sqlTypeFor` yields for `Text`/`TextArea`/`LongTextArea` and compare *sql types* by calling `sqlTypeFor` from `@orglet/schema` in the **test** (vitest alias exists), which removes any chance of the gate disagreeing with `migrate`.)
- flags (createable, updateable, nillable, restrictedPicklist, labels) are free (D-17).
- v1.0 objects removed: error (never allowed). `keyPrefix` change on any v1.0 object: error (Phase 8 prefixes are persisted; the gate should assert equality of every v1.0 prefix and `keyPrefixSource` presence).
- MasterDetail: generator throws when a field of type `MasterDetail` is produced for an object in the v1.0 set (regardless of the allowlist) with message naming `Object.Field` and "would add a NOT NULL column to a populated table; model as Lookup in overrides.json".
- One message per offending field in the vitest test (collect all, then `expect(messages).toEqual([])`).

### Anti-Patterns to Avoid
- **Deriving v1.0 shape purely from sources and "fixing" the diffs later:** produces a non-no-op step A and silent narrowings (`UserLicense.Name` 80 -> 40).
- **Resolving a conflict by "sf-skills wins":** D-03 forbids silent resolution. Abort on conflicts that touch schema-level facts (type, length, referenceTo); emit-and-mark `conflict` is acceptable only for flag/label differences and only if the committed baseline contains none unresolved (recommended: abort on all; simpler to reason about and CI-enforceable).
- **Copying `description` text anywhere** (object JSON, provenance, report, snapshot): see Pitfall 4.
- **Importing from `packages/*/src` internals in the script:** use public barrel exports (`@orglet/metadata` types), or keep the script type-light with its own interfaces.
- **Hand-editing `standard/objects/*.json` after this phase:** CI drift gate fails; all hand facts go to `overrides.json`.

## Design-spike answers

### 1. Type mapping (sf-skills `type` / PDF `Type` -> `FieldType`)
Observed type vocabulary across the 35 objects' non-custom fields (sf-skills, counts of new fields): `boolean` 165, `string` 146, `picklist` 128, `reference` 123, `int` 69, `dateTime`/`datetime` 43 (**both spellings**), `double` 29, `textarea` 24, `date` 15, `time` 14, `currency` 12, `url` 9, `address` 6, `percent` 6, `JunctionIdList` 4 (+1 spelled `JunctionIdLIst`), `phone` 2, `email` 2, `String` 1 and `ID` 1 (**capitalised variants**), `multipicklist` 1. Normalise by lower-casing the key before lookup.

| Source type | `FieldType` | Rule |
|-------------|-------------|------|
| `string` | `Text` | `length` per Q2; `AutoNumber` / `Name` only via `v1-pins`/`overrides` (v1 has `string` -> `AutoNumber` x3, `Name` x4: these are not derivable) |
| `textarea` | `TextArea` if length <= 255 else `LongTextArea` | Matches all 23 v1.0 cases (9 `TextArea`/255; 15 `LongTextArea` 1000/1333/4000/32000). `Html` only via override |
| `picklist` | `Picklist` | `standardValueSet` binding only via v1 pins / overrides; new picklists get `picklistValues: []`, `restrictedPicklist` not set (values are per-org, Pitfall B4); do not invent values |
| `multipicklist` | `MultiselectPicklist` | same |
| `boolean` | `Checkbox` | loader forces nillable false + default false |
| `int` | `Number`, scale 0 | precision unknown in both sources; v1.0 uses 2/3/4/8/9. Default **18,0** for new fields (generous = never truncates; mark `guessed`). Lower precision later via override would be a *narrowing*, so a too-small guess is the dangerous direction |
| `double` | `Number` | no scale in sources. v1.0 uses (18,15) for lat/long x18, (12,2), (18,0), (18,2). Default **(18,6)** for new fields; names ending `Latitude`/`Longitude` -> (18,15) (matches v1.0 geolocation convention); `guessed` |
| `currency` | `Currency` (18,2) | v1.0 majority 19/20; the 4 v1.0 `currency` fields typed `Number` (8,0) and 1 at (18,0) are pins |
| `percent` | `Percent` (5,2) | v1.0 has (3,0), (3,2), (5,2) so any default is a guess; `guessed` |
| `date` / `datetime` / `time` | `Date` / `DateTime` / `Time` | `Time` exists in `FieldType`; 14 new `time` fields (verify `sqlTypeFor` and DML coercion handle `Time` before admitting them; if not, treat as unsupported, see below) |
| `phone` / `url` / `email` | `Phone` / `Url` / `Email` | length per Q2 |
| `reference` | `Lookup` | `referenceTo` from `refers_to` split on `,` and trimmed; empty/missing -> pins/overrides (26 v1.0 cases, e.g. `RecordTypeId` -> `RecordType`); polymorphic lists keep source order sorted alphabetically |
| `address` | `Address` | compound parent, `createable: false, updateable: false`; parts are separate `string`/`double`/`picklist` fields and need `compoundFieldName`: derive by prefix (`X` + `Street|City|State|PostalCode|Country|Latitude|Longitude|GeocodeAccuracy|StateCode|CountryCode`) for each `address` field `XAddress`; v1.0 has 80 such parts, new compound fields: 6 |
| `id` / `ID` | `Id` | only system fields; skip, loader adds them |
| `JunctionIdList`, `base64`, `anyType`, `complexvalue`, `location` (SOAP) and anything not in the table | none | Not physical columns / not modelled: **skip the field and report** as `UNSUPPORTED:standard-field-type` in the generator report and PROVENANCE (area name proposed; reuse of `standard-field` is also acceptable). Never fabricate a type. `Event.EventWhoIds`, `Task.TaskWhoIds`, `*InviteeIds` are exactly these |

Unknown type strings abort the generator (new Salesforce type must be a conscious table addition).

Flags from `properties` (comma list): `Create`->createable, `Update`->updateable, `Nillable`->nillable, `Filter`, `Sort`, `Group`, `Defaulted on create`, plus `Unique`, `Case Sensitive`, `ID lookup`/`Idlookup`, `Name Field` style entries if present (collect the vocabulary in the snapshot step and fail on unknown tokens). **Absence means false** (confirmed against v1.0: Create/Update agree on ~96% of fields). Write flags only when they differ from the baseline default (true) per the README rule; `filterable/sortable/groupable` are written only for the existing `groupable`/`sortable` exceptions today and the loader defaults them: do **not** start emitting `Filter/Sort/Group` unless a v1.0 pin has them (they're not in the v1 shape for most fields; emitting would break the no-op). Decision for the plan: ignore Filter/Sort/Group from sources except for text-area types where the loader already special-cases them.

Relationship type: sf-skills `relationship_type` is only ever `Lookup`/absent, so **master-detail cannot be detected from sf-skills**. The PDF has a `Relationship Type` line (98 `Master-detail`, 6 `Master-Detail`, 6 `Parent-detail`, 2 `Primary-detail`); the extraction must capture it per reference field, and MIGR-03 uses it. No master-detail was found on the 35 (none of the 35 object files contains `MasterDetail` today); the refusal is a guard for Phase 10 and for future re-pins.

### 2. String-length rules (keep v1.0 byte-identical)
Precedence for a text-like field (`Text`, `Phone`, `Url`, `Email`, `TextArea`, `LongTextArea`): (1) `overrides.json`; (2) `v1-pins.json` (v1 value wins for every field that exists in v1.0, so lengths stay identical and nothing narrows); (3) sf-skills `field_reference[Name].length` **only when** the type is `string|phone|url|email|textarea` (it is also populated for picklists = 255 and ids = 18; ignore those); (4) regex over prose `Maximum size is ([\d,]+) characters` (265 hits in the PDF; also appears in sf-skills `description`); (5) default 255 + `guessed` (D-05).

Measured on the 35 objects: of 179 v1.0 text fields that carry a length, 171 equal `field_reference.length` or the prose maximum; **8 do not**: `Asset.ProductDescription` 255 vs 4000, `CallCenter.Name` 80 vs 255, `IdeaTheme.Title` 255 vs none, `OperatingHours.Name` 80 vs 255, `OpportunityLineItem.Name` 255 vs 376, `Organization.InstanceName` 5 vs 40, `Product2.DisplayUrl` 255 vs 1000, `UserLicense.Name` 80 vs 40. Seven are widening (harmless if adopted), `UserLicense.Name` is a narrowing. Rule: **pins keep v1.0** in step A; whether to adopt the wider documented value afterwards is a deliberate per-field decision recorded in `overrides.json` (so `UserLicense.Name` is never auto-narrowed). Also observed: `field_reference.length` is a string, sometimes exceeds the real maximum for `textarea` (it reports the UI length), so for `LongTextArea` prefer the prose maximum, then `field_reference`, and apply a ceiling check (`length > 131072` -> report).

Where prose gives a length with a byte unit ("bytes") treat as characters only with `guessed`; log it.

### 3. Single-source flags and where flags live
- Per **fact**, not per field, provenance values: `verified` (both sources agree), `sdk-only`, `doc-only`, `v1.0` (pin), `override`, `guessed` (defaults), `conflict` (never committed). Because the sources are not independent (Summary point 2), name `verified` in the report as "sources agree" and do not claim it as ground truth in README or `orglet check` output.
- Storage: `packages/metadata/standard/PROVENANCE.json`, shape `{ pins: {sfSkills: "<sha>", objectReference: {url, lastModified, sha256}}, objects: { "<Object>": { fields: { "<Field>": { type: "verified", length: "guessed", ... } } , ownerTargets: "...", keyPrefix: "..."} } }`, sorted, no prose. Only non-`verified` facts need listing to keep it small (default = `verified`); recommend listing every fact whose provenance is not `verified`, plus a per-object counts summary (so churn is reviewable).
- `featureGated`, `ownerTargets`, `keyPrefix`, `keyPrefixSource` are the **only** new keys in object JSON (they are behaviour, not provenance). Licence attribution lives in file-level docs (README/VENDOR.md/NOTICE), not in each object file (JSON has no comments; adding `_generated` keys would break the exact-shape rule).
- Gating hits and conflicts and unsupported types go into a generator report (`scripts/gen-baseline/REPORT.md` or stdout + committed JSON). Recommend a committed `GENERATOR-REPORT.json` next to PROVENANCE only if reviewers want it in PRs; otherwise print it and have the vitest gate assert "no conflicts, no unknown types".

### 4. Licence
- **sf-skills (primary input):** Apache-2.0, "Copyright (c) 2026 Salesforce, Inc." (verified `LICENSE.txt` header via raw GitHub 2026-10-13). Vendor the exact files with `LICENSE.txt` copy and a `VENDOR.md` (repo URL, pinned SHA, sync date, "derived from the public Object Reference", what was kept/dropped). Keep only `fields`, `field_reference`, `ispersonaccount_fields` (and `title` if needed) in the committed copy? **No**: for a clean "vendored = upstream" guarantee and an Apache redistribution, copy the files unmodified (the sync script can run in CI to prove reproducibility like `sigha-sync-check`); the "no documentation prose in committed *output*" criterion (SC1) concerns `standard/objects/**`, not the vendored input. But drop `wsdl_segment` is a modification; vendoring unmodified (70 KB per object x ~35-55) is acceptable and keeps the CI sync check trivial. Apache-2.0 section 4(b) requires modified files to carry notices, so unmodified is the legally simpler path.
  - Add a repo `NOTICE` entry (project is Apache-2.0): "This product includes data derived from sf-skills (Apache-2.0, Copyright 2026 Salesforce, Inc.) ...". Check whether a root `NOTICE` exists; if not, put the attribution in `scripts/gen-baseline/source/sf-skills/NOTICE` and README of `standard/`.
- **Object Reference PDF:** "© Copyright 2000–2026 Salesforce, Inc. All rights reserved." (page 1 text). No licence grant found in the PDF. The committed extraction must therefore be strictly **facts**: object name, field name, type token, property tokens, relationship name, `Refers To` names, relationship type token, a numeric maximum. No sentences. I judge this defensible (names, types and flags are functional facts; same facts also exist in the Apache-licensed sf-skills), but it is the one legally grey item. Confidence MEDIUM; recommend Johan consciously accepts it (STATE note). Mitigation if he does not: restrict the PDF extraction to the three things sf-skills lacks (Data.com/gated field names, master-detail tokens, `Refers To` cross-check) and keep everything else sf-skills-only.
- Generated object files: header via `standard/README.md` (rules + "generated by scripts/gen-baseline from sf-skills <sha> (Apache-2.0, Salesforce, Inc.) and the public Object Reference of <Last-Modified>; do not edit") and the root attribution. No prose from Salesforce in generated files; the gate asserts this (see Validation: scan output for any string value that is not a name/label/enum; labels are short facts and exist in v1.0 already).
- Trademark/no-benchmark rule is unaffected (public docs only). Never use `sf sobject describe`, the Enterprise WSDL or sf-skills' `wsdl_segment`.
- PDF snapshot step is manual and needs network; record `Last-Modified` + sha256 + `pdftotext --version` in VENDOR.md. Reproducibility caveat: `pdftotext` output can differ between poppler versions; the *committed extraction JSON* is the CI input, so this only affects who re-snapshots.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDF text extraction | a PDF parser | `pdftotext -layout` (installed) + small line-state-machine on its output | Output measured parseable; adding a PDF library is a new dependency and slower |
| JSON diff reporting | a custom differ | plain in-memory comparison in vitest + `git diff --exit-code` in CI | D-18 already specifies both |
| Narrowing semantics | a second definition of "narrow" | `sqlTypeFor` from `@orglet/schema` in the test + the `isWidening` rules written down once | Gate and migrate must not disagree |
| Vendoring | ad-hoc curl | `scripts/sync-sfdocs.sh` modelled on `sync-sigha.sh` (pinned SHA, `SIGHA_DEST`-style override, VENDOR.md) + a CI re-sync job | Established precedent |
| Key-prefix validation | new rules | extend `validateBaseline()` (Phase 8) | Already rejects malformed/duplicate/custom-range/`m0` prefixes |
| Stable key ordering | alphabetising keys | explicit `FIELD_KEY_ORDER` array | v1.0 key order is semantic-by-convention, not alphabetical |

**Key insight:** the hard part is not parsing but *preserving v1.0 and refusing silent change*. Spend effort on the pin layer, the gate, and the upgrade test, not on parser polish.

## Runtime State Inventory

This is a baseline growth, not a rename, but existing databases are the runtime state at risk:

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | Populated org schemas created by v1.0 code: hold `OwnerId` values (User or Group Ids) in 35 tables. Narrowing `OwnerId` to User-only adds an FK on `account`, `contact`, `opportunity`, `contract`, `asset`, `campaign`, `individual` (`ddl.ts:46` FK only when `referenceTo.length === 1`) | Code only: Phase 8 `migrate()` validates existing rows and skips the FK with one `UNSUPPORTED:schema-fk` warning if violated (D-14). No data migration. Add a test for a Group-owned Account row -> warning + rows untouched + FK added after correction |
| Stored data | ~774 new columns appended to existing tables (`ADD COLUMN`, nullable except Checkbox with `DEFAULT false`) | Code only; confirm with the reworked upgrade test |
| Live service config | None - orglet is a single-tenant local emulator; no external UI-held config | None - verified by architecture (Postgres is the only datastore) |
| OS-registered state | None | None - verified (no daemons/tasks registered by the project) |
| Secrets/env vars | None touched (`ORGLET_DATABASE_URL`, `ORGLET_PG_PORT` unchanged) | None |
| Build artifacts | `packages/metadata/dist` is stale after `types.ts`/`build.ts` change; `standard/` is shipped via `files` | `pnpm build` once; tests use source aliases so unaffected |

## Common Pitfalls

### Pitfall 1: ESLint/tsc do not cover `scripts/**/*.ts`
**What goes wrong:** `eslint .` runs type-aware rules against `./packages/*/tsconfig.json` and `./tsconfig.test.json` only; `tsconfig.test.json` `include` has no `scripts/`. A new `scripts/gen-baseline/*.ts` fails lint with "file not found in any project" and CI `pnpm lint` goes red.
**How to avoid:** add `"scripts/**/*.ts"` to `tsconfig.test.json` `include` (strict config applies, which is desirable), keep script imports `.js`-suffixed per NodeNext; or add `scripts/**` to eslint `ignores` (inferior). The vitest test imports `pipeline.ts` through a relative path.
**Warning sign:** first `pnpm lint` after adding the script.

### Pitfall 2: Phase 8 upgrade test forbids `ADD COLUMN`
**What goes wrong:** `packages/engine/src/upgrade.test.ts` line 99 asserts that upgrading emits no `CREATE TABLE|ALTER TABLE ... (ADD|DROP|ALTER) COLUMN|DROP TABLE`. v2 adds hundreds of columns, so SC5 as literally coded cannot pass.
**How to avoid:** change the filter to forbid `DROP COLUMN`, `ALTER COLUMN ... TYPE`, `DROP TABLE` and `CREATE TABLE` for pre-existing tables, and assert that `ADD COLUMN` statements exist and `EXPECTED_WARNINGS` is the allowlisted list. The "rows byte-identical" snapshot (`SELECT *` of 4 tables) must change to compare **by named columns of the v1 set** (`SELECT *` now returns extra columns; compare only the v1 columns, or compare `before` columns subset). The second-run silent assertion stays. State this in the plan as a deliberate contract edit, not a weakening: the row-preservation and second-run assertions remain.

### Pitfall 3: Required-looking new fields break existing inserts
See Pattern 6. Detect by a generator report section "newly required on a v1.0 object", asserted empty unless overridden.

### Pitfall 4: Documentation prose leaking into committed files
**What goes wrong:** copying `description`, or the PDF text "Description" blocks, into the extraction or PROVENANCE. Violates SC1 and the "snapshot holds only facts" rule.
**How to avoid:** the extractor's output type has no free-text field except `label` candidates; a vitest check scans `standard/**` and `source/object-reference/**` and fails on any string longer than N chars or containing a sentence terminator followed by a space (labels such as "Dun & Bradstreet Company ID" are short). Gating reads prose in memory and discards it.

### Pitfall 5: Sorting changes ordinal positions only for new databases
Existing databases get new columns appended; new databases get sorted. Describe order for fields is `fields` array order, so a database built under v1 and one built under v2 describe fields in different orders. Acceptable per D-19; do not "fix" by append-only ordering (it would break byte-identical regeneration of sorted output).

### Pitfall 6: Master-detail not detectable from sf-skills
See type-mapping section; capture `Relationship Type` from the PDF or the guard is blind. Also note `deleteConstraint` is not provided by either source; generated lookups get none (loader default). Do not infer Cascade from master-detail text.

### Pitfall 7: PDF section boundaries
My quick parser (heading = last bare line before `Supported Calls`) found 1543 headings, missed `Event`, `Product2`, `Profile`, `UserRole`, `DandBCompany` and likely merged neighbouring sections for `Contact` (it reported spurious fields `Address`, `City`, `Country` which are not Contact fields) and `Lead`. The field-name column also moves per page/object (indent differs: 7 vs 8 spaces seen). Build the extractor around the **`Field Name  Details` table header** to find the name column, take sections from the TOC order (the PDF TOC lists objects, lines ~320-1500 of the text), and add a cross-check: for each object the extracted name set must be a superset of sf-skills `fields` keys except documented gaps; mismatches fail the snapshot step. Also handle sub-bullets ("• Refers To: X") and "Refers To" lists spanning lines. Budget this as the riskiest task.

### Pitfall 8: sf-skills irregularities
`__c` fields appear inside `field_reference` (drop `__c`/`__r`); `fields` vs `field_reference` partially disjoint (e.g. `Campaign` 69 vs 35, `Account` 76 vs 126); `properties` can be **missing** on an entry (key error seen); type spellings vary in case; `refers_to` empty for `RecordTypeId` and some others; `ispersonaccount_fields` is a third catalogue (dict, Account only seen). Treat `field_reference`-only fields as read-only with `doc-only`-like provenance `sdk-only` (defaults: createable false, updateable false per STACK.md trap 2) and report them.

### Pitfall 9: Labels
v1.0 has hand labels differing from `field_label` in 52 cases ("Product" vs "Product ID", "Campaign Name" vs "Name"). Labels for existing fields are pinned; for new fields use `field_reference.field_label`, else humanise the API name (33 of 623 comparable fields have no `field_label`; BusinessProcess/Event gaps). Mark humanised labels `guessed`.

### Pitfall 10: Tests that assumed Group ownership
Follow the audit table, concretely: `query.test.ts`, `engine.test.ts`, `api.test.ts` Group-owned **Case** scenarios stay (Case is queue-enabled); `api.test.ts:173` asserts `OwnerId.referenceTo: ["User","Group"]` on **Account** -> must change to `["User"]` or move to Case; `migrate.test.ts:75` ("no FK on polymorphic OwnerId") needs the Account OwnerId FK to now exist, or switch the assertion to Case; `soql/compile.test.ts` and `formula.test.ts` assertions about `Owner.Alias`/`Owner.Name` rejection on Account flip to accepted (that is SC4). Add: Account insert with a Group Id on `OwnerId` -> `INVALID_CROSS_REFERENCE_KEY`; check which code path produces it for single-target lookups (it exists for other lookups) and that `OwnerId` special-casing (`namePointing`, `Owner` parents in `engine/parents.ts`) does not still assume User/Group for single-target owners.

### Pitfall 11: `featureGated` and engine behaviour
Gated nullable fields become real columns on every org, including those without the feature (acceptable, D-09). Ensure compound/lookup gated fields (e.g. Person Account lookups to Contact, `PersonContactId`) don't add FK targets to non-modelled objects: a `referenceTo` target not in the baseline raises `UNSUPPORTED:reference-target` at load. Generator must **drop/skip** a reference field whose target object is outside the object list (report as `UNSUPPORTED:reference-target`) or the loader will warn on every `orglet check`, defeating SC3 ("zero `UNSUPPORTED:standard-field`" and a quiet baseline). Count of such fields is large (e.g. `ActivityMetricId`->`ActivityMetric`); decide skip vs keep-as-text-ID policy in the plan (recommend skip + report, consistent with Phase 10 adding objects later; changing later is additive).

## Code Examples

### Deterministic serialiser and sort (pipeline.ts)
```typescript
// Why: one serialiser shared by the CLI and the vitest gate (D-19). Code-unit compare, never localeCompare.
const byName = (a: { name: string }, b: { name: string }): number => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function serialise(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}
```

### Type map entry shape (typemap.ts)
```typescript
// Lower-case the source type first: sf-skills mixes "dateTime"/"datetime" and "String"/"ID".
export const TYPE_MAP: Record<string, { type: FieldType; precision?: number; scale?: number; guessed?: boolean } | "skip"> = {
  boolean: { type: "Checkbox" },
  int: { type: "Number", precision: 18, scale: 0, guessed: true },
  double: { type: "Number", precision: 18, scale: 6, guessed: true },
  currency: { type: "Currency", precision: 18, scale: 2 },
  percent: { type: "Percent", precision: 5, scale: 2, guessed: true },
  junctionidlist: "skip", // not a physical column: report UNSUPPORTED:standard-field-type
  // ...
};
```

### CI drift gate (ci.yml, beside sigha-sync-check)
```yaml
  baseline-gen-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm baseline:gen && git diff --exit-code -- packages/metadata/standard
      # sf-skills vendored copy is exactly reproducible from the pinned SHA (mirrors sigha-sync-check)
      - run: |
          REV=$(sed -n 's/^Revision: //p' scripts/gen-baseline/source/sf-skills/VENDOR.md)
          SFDOCS_DEST="$RUNNER_TEMP/sfdocs" bash scripts/sync-sfdocs.sh "$REV"
          diff -r scripts/gen-baseline/source/sf-skills "$RUNNER_TEMP/sfdocs"
```
Note `git diff --exit-code` misses **untracked** files; also run `git status --porcelain packages/metadata/standard` and fail if non-empty (a newly generated object file would otherwise pass).

### `ownerTargets` threading (build.ts)
```typescript
// Source: packages/metadata/src/build.ts systemFields (current literal at ~line 118)
function systemFields(hasOwner: boolean, ownerTargets?: readonly ("User" | "Group")[]) {
  // ...
  owner.referenceTo = [...(ownerTargets ?? ["User", "Group"])];
}
```

### Diff gate sketch (packages/metadata/test/baseline-generator.test.ts)
```typescript
it("no v1.0 field disappears or narrows without an allowlist entry", () => {
  const messages: string[] = [];
  for (const v1 of loadFixture()) for (const f of v1.fields) {
    const v2 = generated.get(v1.name)?.fields.find((x) => x.name === f.name);
    if (!v2) { if (!allowed(v1.name, f.name, "removed")) messages.push(`${v1.name}.${f.name} removed`); continue; }
    if (narrows(f, v2) && !allowed(v1.name, f.name, "narrowed")) messages.push(`${v1.name}.${f.name} narrowed: ${describe(f)} -> ${describe(v2)}`);
  }
  expect(messages).toEqual([]);
});
```
`narrows` should compare `sqlTypeFor`-derived SQL types with the `isWidening` rules, so lint the logic against `migrate.test.ts` cases.

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Hand-transcribed baseline (v1.0, README rules) | Generated from vendored Apache-2.0 snapshot + PDF facts + pins/overrides | Reproducible, reviewable provenance, drift gate |
| "Skip feature-gated fields" | include as nullable `featureGated` | Removes `UNSUPPORTED:standard-field` for documented fields (SC3) |
| Polymorphic `OwnerId` everywhere | per-object `ownerTargets` | `Owner.Name` works on User-only objects |
| Research note (STACK.md) said the official PDF bundle 404s | `resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/object_reference.pdf` returns 200 (21 MB) | PDF is a usable second source (CONTEXT D-01); STACK.md statement is stale |

**Deprecated/outdated:** the README rule "skip fields that only exist when a feature is enabled"; STACK.md's "PDF 404".

## Open Questions

1. **ServiceContract.OwnerId targets.**
   - Known: both sources document it as user-only (no `Refers To`; "the ID of the user who currently owns the service contract"); BASE2-04 and D-11 list ServiceContract as User and Group.
   - Unclear: whether the requirement came from a docs page I cannot see (HTML) or from an assumption.
   - Recommendation: follow the locked list (default, no key) via an override entry whose reason states "BASE2-04 lists User and Group; Object Reference shows no Refers To"; flag to Johan to confirm or correct the requirement. The generator should report the disagreement as an override-resolved conflict.
2. **Group.OwnerId** (`Group` object has `hasOwner: true` in v1.0; docs: `Organization, User`).
   - Not covered by D-11/D-12. Recommendation: override `ownerTargets: ["User"]` with reason "Organization not modelled" (consistent with D-12), or leave the default and record why. Changing to User-only adds an FK on `group.ownerid`; Group rows are created by tests/bootstrapping, check their owner is always a User before choosing. Planner to decide with Johan; default recommendation: leave default and add to the allowlist-free "known deviations" note, since narrowing Group is not required by BASE2-04 and carries FK risk on queue rows created by `bootstrapOrg`.
3. **Whitespace reformat of the 35 v1.0 files.** Existing files are hand-formatted (mixed single-line field objects); a plain serialiser changes all of them. Recommendation: accept a one-time mechanical reformat in the step-A commit, with the SC2 no-op defined as deep-equal of parsed JSON against the fixture and byte-equality of `standard/` against regeneration afterwards. Confirm acceptable for "no-op diff against v1.0".
4. **Does `orglet check` need to list gated fields now?** SC3 only requires "tagged in baseline/describe-nullable". Minimum: `FieldDef.featureGated` passthrough + one summary line in `check` ("N feature-gated standard fields included"). Full per-field listing can wait for Phase 14's report.
5. **Policy for reference targets outside the object list** (Pitfall 11): skip + report vs keep. Recommend skip + report.
6. **Key-prefix sources for the 35 (D-07).** Not researched against external pages in this spike (needs web lookups of the public record-ID prefix article and jsforce/simple-salesforce fixtures; outside the data sets inspected). The plan must schedule that as an explicit, reviewable task; default `unverified` is valid and honest.
7. **Event.json, BusinessProcess, Product2, Profile, UserRole, DandBCompany coverage.** `BusinessProcess` is in neither source (sf-skills 404, no PDF heading): treat the whole object as v1.0-kept via overrides ("object absent from sources", provenance `v1.0`); the others exist in sf-skills (except possibly Profile/UserRole mixed) or the PDF but my heading detector missed them; the extractor must resolve them.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | tsx, vitest | yes | >=22 per `.nvmrc` | - |
| pnpm | scripts | yes (project standard) | 12.6.0 pin | - |
| `tsx` | generator | yes (root devDep) | 4.23.15 | - |
| `pdftotext` | snapshot-pdf.ts (manual step only) | yes | 26.04.0 (`/opt/homebrew/bin/pdftotext`) | none needed in CI (extraction is committed) |
| curl / network to `resources.docs.salesforce.com`, `github.com` | the two manual snapshot scripts | yes (verified 2026-10-13: PDF HTTP 200, GitHub API OK) | - | commit pinned snapshots; CI never needs network for `baseline:gen` |
| Docker/Postgres 16 | upgrade test on Postgres | optional | - | pglite is the default test DB |

**Missing dependencies with no fallback:** none. Note the sync script and the CI re-sync job need `git` and network (GitHub clone) like `sigha-sync-check`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.7 (single root config) |
| Config file | `/Users/johankarlsteen/Development.nosync/local-salesforce/vitest.config.ts` (include already covers `packages/*/test/**/*.test.ts`) |
| Quick run command | `pnpm vitest run packages/metadata` |
| Full suite command | `pnpm test` (pglite default; `ORGLET_DATABASE_URL=... pnpm test` for Postgres 16) plus `pnpm lint` and `conformance/run-all.sh` for poly-check |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BASE2-01 | Two in-memory runs yield identical bytes; committed `standard/` equals regeneration; no prose in output | unit + CI | `pnpm vitest run packages/metadata/test/baseline-generator.test.ts` ; `pnpm baseline:gen && git diff --exit-code -- packages/metadata/standard` | Wave 0 (new) |
| BASE2-01 | Unknown source type / unresolved conflict / unknown property token aborts | unit | same file, `describe("failure modes")` | Wave 0 |
| BASE2-02 | Step A: generator output (parsed) deep-equals `test/fixtures/baseline-v1.0/objects/*`; all 35 objects, key prefixes and sources preserved | unit | same file | Wave 0 |
| BASE2-02 / MIGR-03 | Diff gate: every v1.0 field present and non-narrowing unless allowlisted; allowlist entries all still needed (no stale entries) | unit | same file | Wave 0 |
| MIGR-03 | A MasterDetail field on a v1.0 object throws with `Object.Field` in the message | unit | same file (synthetic input to `pipeline`) | Wave 0 |
| BASE2-03 | `orglet check` on `examples`/test project using documented fields of the 35 prints zero `UNSUPPORTED:standard-field`; gated fields are nullable and `featureGated`; describe key set of a gated field equals a normal field | unit + api | `pnpm vitest run packages/metadata packages/api -t featureGated` | Wave 0 (new tests; sfdx test project fixture to add) |
| BASE2-04 | Each object's `OwnerId.referenceTo` equals the D-11 list (table-driven test over the 35 + overrides) | unit | `pnpm vitest run packages/metadata/src/build.test.ts` | extend existing |
| BASE2-04 | `Owner.Name` compiles in formula and SOQL on Account, Contact, Opportunity, Contract, Asset, Campaign; Case/Lead/Task keep User+Group (`Owner.Type`, `TYPEOF Owner`) | unit | `pnpm vitest run packages/formula packages/soql packages/engine -t Owner` | extend existing |
| BASE2-04 | Group Id on `Account.OwnerId` -> `INVALID_CROSS_REFERENCE_KEY`; Group on Case ok | engine | `pnpm vitest run packages/engine` | Wave 0 (new tests) |
| BASE2-04 | `conformance/poly-check` stays green (jsforce + simple-salesforce) | conformance | `conformance/run-all.sh` (needs Postgres, Python venv) | exists |
| SC5 | Populated v1.0 DB upgrades to v2: rows identical on v1 columns, only `ADD COLUMN`/FK statements, warnings == allowlist, second `up` silent | integration | `pnpm vitest run packages/engine/src/upgrade.test.ts` (both pglite and `ORGLET_DATABASE_URL`) | exists; must be edited (Pitfall 2) |
| BASE2-01 | `pdftotext` extraction sanity (extracted names superset of sf-skills names per object; no prose) | unit on committed JSON | same generator test file | Wave 0 |
| D-14 | Group-owned Account row in a v1.0 DB: upgrade warns `UNSUPPORTED:schema-fk` once, keeps rows, FK appears after correction | integration | add a case to upgrade test or `migrate.test.ts` | Wave 0 (optional per D-14) |

### Sampling Rate
- **Per task commit:** `pnpm vitest run packages/metadata` (generator + build tests, seconds)
- **Per wave merge:** `pnpm lint && pnpm test`
- **Phase gate:** full suite green on pglite and on Postgres 16, `conformance/run-all.sh` green, before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `packages/metadata/test/baseline-generator.test.ts` - determinism, step A parity, diff gate, MasterDetail refusal, prose scan, failure modes
- [ ] `tsconfig.test.json` include `scripts/**/*.ts` (lint/typecheck of the generator)
- [ ] sfdx test-project fixture exercising documented fields and gated fields for `orglet check` (reuse `examples/acme` if it can host them; the upgrade test already reads an `ACME` project)
- [ ] Copy/derive the committed snapshots (`scripts/sync-sfdocs.sh`, `snapshot-pdf.ts`) before any generator test can run on real inputs
- [ ] Framework install: none

## Sources

### Primary (HIGH confidence, measured 2026-10-13)
- sf-skills `platform-data-and-tooling-api-context-get/assets/enterprise_api/*.json` at `4bbae5c421e51b40e4169afa72c4496372a602a7` (raw GitHub) - structure, type vocabulary, per-object comparisons against the 35 v1.0 files
- sf-skills `LICENSE.txt` (Apache-2.0, Copyright (c) 2026 Salesforce, Inc.) and `SKILL.md` (`minApiVersion: 67.0`, standard objects only)
- `https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/object_reference.pdf` - HEAD (200, 21,277,574 bytes, Last-Modified 2026-10-09), `pdftotext -layout` structure, `Refers To` / `Relationship Type` / "Maximum size is N characters" occurrences
- Repo code read: `packages/metadata/src/{build,types}.ts`, `packages/metadata/standard/{README.md,objects/*}`, `packages/schema/src/{ddl,columns,migrate}.ts`, `packages/api/src/describe.ts`, `packages/{soql,formula}/src/compile.ts`, `packages/engine/src/upgrade.test.ts`, `packages/cli/src/main.ts`, `.github/workflows/ci.yml`, `scripts/sync-sigha.sh`, `eslint.config.js`, `tsconfig.test.json`, `vitest.config.ts`, `08-GROUP-OWNED-AUDIT.md`
- `.planning/research/{STACK,ARCHITECTURE,PITFALLS}.md` (B2, B4, M3, M4, N2)

### Secondary (MEDIUM confidence)
- My ad-hoc comparison scripts (not committed): counts of label/flag/ref/length mismatches and PDF-vs-sf-skills field-set differences. Treat the exact numbers as approximate (crude heading parser) but directionally reliable

### Tertiary (LOW confidence)
- Describe value fidelity for guessed numeric precision/scale and for `namePointing` on User-only owners (no org comparison allowed by project rules; unverifiable)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies; versions and sources measured
- Architecture (pipeline, pin layer, two-step landing, gate): HIGH - driven by measured v1.0 vs source differences
- Type mapping / length rules: MEDIUM - vocabulary and v1.0 correlations measured; precision/scale defaults are guesses by necessity
- Licence: MEDIUM - sf-skills clear; PDF extraction is a legal judgement call to confirm with Johan
- PDF extractor robustness: MEDIUM-LOW - boundaries and column handling not yet solved (Pitfall 7)
- Pitfalls: HIGH for 1, 2, 10 (read in code), MEDIUM for others

**Research date:** 2026-10-13
**Valid until:** 2026-11-12 (sources are re-pinned deliberately; the Object Reference PDF changes at least monthly, so pin SHA/sha256 and do not re-snapshot mid-phase)
