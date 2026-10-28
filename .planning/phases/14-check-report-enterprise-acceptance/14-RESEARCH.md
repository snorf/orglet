# Phase 14: Check Report & Enterprise Acceptance - Research

**Researched:** 2026-10-28
**Domain:** CLI report over existing structured diagnostics (TypeScript, Node 22 `util.parseArgs`), public enterprise-shaped SFDX fixture, conformance/CI wiring
**Confidence:** HIGH for codebase findings (read directly from the repo at HEAD 4043e76); MEDIUM for the Salesforce doc URLs (not re-fetched this session)

## Summary

Phase 8 already laid the groundwork this phase needs. Every `UNSUPPORTED:<area>` warning is created through `pushDiagnostic(sink, d)` (`packages/metadata/src/diagnostics.ts:53`), which stores a structured `Diagnostic { area, message, object?, field?, cause? }` and derives the warning string with `formatDiagnostic`. `warnings[i] === formatDiagnostic(diagnostics[i])` holds for the metadata build, `admitFormulaRollups`, `planCustomMetadataSeed` and `FormulaRegistry` (construction time). The informational category already exists as `BuildResult.info: InfoDiagnostic[]` (`severity: "info"`). So CHECK-01/02 is mostly a pure "report builder + renderer" in `packages/cli`, plus three small data gaps in the diagnostics (below). No change to warning strings is needed, and none should be made.

The three gaps for root-cause grouping: (1) `cause` is only populated by `admitFormulaRollups` (`packages/formula/src/rollup-admission.ts:193`); (2) a formula failure carries `missing: {object, field}` (`FormulaFailure`, `packages/engine/src/formulas.ts:88-93`) but no `cause`, so the report must resolve it by lookup; (3) the `field-type` diagnostic (`packages/metadata/src/sfdx.ts:200`) has `field` but no `object`, so a formula that references an `ExternalLookup` field cannot be matched to it. Gap 3 needs a one-line source change (message text unchanged).

`examples/enterprise` does not exist; `examples/acme` and `conformance/cmdt-check/project` contain none of the Phase 12 globals, colon syntax, `!` or a roll-up over a formula in an example fixture (verified by grep: no `$Label|$Setup|$CustomMetadata|$Api|$UserRole|$Organization|$User` in either). Those features are covered only by unit tests today. The SDK suites (jsforce subset, simple-salesforce script) are not parameterised by project; they assume acme's objects (`BigTable__c`, `UpsertTable__c`, `Account.Customer_Number__c`), so "both SDK suites green against enterprise" means enterprise must contain those objects unchanged.

**Primary recommendation:** Build a pure `buildCheckReport()` in `packages/cli/src/report.ts` over the existing `diagnostics`/`info` arrays, render text/summary/JSON from it, keep the `warning:` stderr loop byte-identical in default mode, make `examples/enterprise` a superset of acme (reuse acme via a second `packageDirectories` entry if the metadata reader merges same-named objects, otherwise copy), run `check --strict` on it from a vitest test and a CI step, and parameterise `conformance/run-all.sh` with a `PROJECT` env so the whole set runs against enterprise.

## User Constraints (from CONTEXT.md)

No CONTEXT.md exists for this phase (user chose to plan without discuss-phase). All areas below are Claude's discretion; the planner should treat the roadmap success criteria and REQUIREMENTS.md text as the locked contract.

### Locked Decisions
None beyond ROADMAP/REQUIREMENTS wording and project CLAUDE.md constraints (see Project Constraints).

### Claude's Discretion
All design choices (report layout, JSON shape, flag interplay, plan split).

### Deferred Ideas (OUT OF SCOPE)
- CHECK-03 `--baseline <report.json>` diff and `--max-warnings N` (REQUIREMENTS v2).
- CMDT-05 queues, CSET-03 `$Setup` on list settings, ROLLX-*, BULKX-*, HEIM-01.
- Backlog 999.6 items beyond what CHECK-01/02 state (it is the source of this phase's report goals; do not widen).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CHECK-01 | census, one-line verdict, per-area table keyed by `UNSUPPORTED:<area>`, cascaded formula failures grouped under root cause with both counts, deterministic order covered by snapshot on acme, `warning:` format unchanged | Diagnostics already structured (`diagnostics.ts`); grouping inputs `cause` + `FormulaFailure.missing`; gaps and algorithm below; snapshot via `toMatchFileSnapshot` |
| CHECK-02 | `--summary` (no names), `--json` (same report incl. informational), `--strict` (1 on any warning, 0 on info only) | `parseArgs` already in `main.ts:214`; `--strict` already implemented at `main.ts:100`; add two boolean options and a renderer |
| ACC2-01 | `examples/enterprise` covers every v1.1 category, `check --strict` exit 0 in CI, full conformance green against it | Category map below; vitest test + CI step; `run-all.sh` PROJECT parameter |
| ACC2-02 | describe-check, poly-check, rollup-check extended; `__mdt`/custom-setting describe via both SDKs; run by `run-all.sh`; both SDK suites green, exclusions classified | Existing check layout and what each hardcodes; extension plan below |
| ACC2-03 | Author's DE retrieve `check --strict` exit 0; large real-org retrieve zero warnings for what it references; counts per area in `conformance/README.md`, never names | Existing DE table format; human checkpoint pattern; known open gap (todo on standard-field gaps) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), Node 22, pnpm 10+, Postgres 16, vitest; do not fork conventions.
- Relative imports carry `.js`; cross-package imports go through `@orglet/*` barrels only (no reaching into another package's internals); explicit named exports in `index.ts` (never `export *`), values and types listed separately.
- Every source file opens with a `/** ... */` block saying why the file exists; comments carry Salesforce-specific reasoning, not restated code.
- `UNSUPPORTED:<area>` convention mandatory; message prefix only, status/error codes stay real. Do not rename existing areas or alter existing message text.
- Console conventions in the CLI: `console.log` gated by `--quiet`, `console.warn("warning: " + w)` for warnings, `console.error` for fatal; no new logging mechanism.
- Legal/data: only public documentation, never diff behaviour against a real org; never the employer's names or metadata in the repo; only Level 1 data in Claude context. `conformance/README.md` records the real-org runs as counts per area only.
- Git identity repo-local `Johan Karlsteen <johan@karlsteen.com>`; creating the GitHub repo and first push need Johan's confirmation (already done in earlier phases; not in scope).
- Tests encode intent: names state the invariant (e.g. `test_refund_blocked_after_30_days` style).
- GSD workflow: file edits happen through GSD execute-phase; no direct edits outside it.
- Global user rule: ask before write/destructive commands (`git push`, `rm -rf`, prod installs); `docker compose` / schema drops in conformance runs use throwaway schemas.

## Standard Stack

No new dependencies. Everything is already in the repo.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:util` `parseArgs` | Node 22 built-in | `--summary`, `--json` flags | Already used in `packages/cli/src/main.ts:214` with `allowPositionals`; keep it |
| vitest | 3.2.7 (root) | report unit tests, CLI tests, snapshot | Single root config `vitest.config.ts`; `@orglet/*` aliased to `src` |
| `@orglet/metadata` diagnostics types | in repo | `Diagnostic`, `SkippedItem`, `FormulaFailure`, `InfoDiagnostic`, `formatDiagnostic` | Already exported from `packages/metadata/src/index.ts:7-8` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:util` `styleText` | Node 22 built-in | colour | NOT recommended: the CLI uses no colour anywhere (grep `styleText|NO_COLOR` in `packages/*/src` is empty). Stay plain text so snapshots and CI logs stay stable |
| vitest `toMatchFileSnapshot` | vitest 3.2.7 | snapshot of the acme report to a committed `.txt` | The repo has no snapshot convention yet (grep for `toMatchSnapshot|toMatchInlineSnapshot|__snapshots__` finds nothing). A file snapshot makes the report readable in review. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `toMatchFileSnapshot` | `toMatchInlineSnapshot` | Inline works but the acme report is ~15 lines plus a 39-name info line; a committed `.txt` is easier to review. Either satisfies "snapshot test". |
| Report in `packages/cli` | Report in `@orglet/metadata` | Inputs come from metadata, formula (rollup admission), engine (seed plan, `FormulaRegistry`), so only the CLI layer sees all three without a dependency inversion. Keep it in cli. |
| New CLI framework (commander etc.) | none | Not needed; two boolean flags. |

**Installation:** none.

**Version verification:** no packages added; versions above are from the root `package.json`/CLAUDE.md (vitest `^3.2.0` resolved 3.2.7). Note: the shell used for this research reported Node v18.20.8; the repo requires Node 22 (`.nvmrc`), so run all verification under Node 22.

## Architecture Patterns

### Recommended Project Structure
```
packages/cli/src/
├── main.ts          # parseArgs, check() orchestration (collects inputs, prints warning: lines, picks renderer, returns exit code)
├── report.ts        # NEW: buildCheckReport(inputs): CheckReport  (pure, no console, no fs)
├── report.test.ts   # NEW: grouping, ordering, counts, summary redaction, JSON shape
├── render.ts        # NEW (or inside report.ts): renderText(report, {summary}) / JSON.stringify
├── main.test.ts     # existing: update the assertions that pin the old census line / order
└── __snapshots__/check-acme.txt   # NEW: toMatchFileSnapshot target
examples/enterprise/               # NEW fixture
conformance/run-all.sh             # PROJECT env + enterprise invocation
```

### Where warnings originate today (all findings verified by reading source)

`check()` is `packages/cli/src/main.ts:74-101`. It does, in this order:
1. `admitFormulaRollups(await loadOrgSchema(...))` (`main.ts:76`) -> `result.schema`, `result.warnings`, `result.diagnostics`, `result.info`, `result.customMetadata`.
2. Prints the census line `N objects (M custom), K fields` (`main.ts:78`), the feature-gated line, one `  <name>  <prefix>  (provisional)` line per custom object, the provisional-prefix note, `custom metadata: R records in T types`, `N custom labels`.
3. `warnings = [...result.warnings, ...cmdt.warnings, ...new FormulaRegistry(result.schema, cmdt).warnings]` (`main.ts:90`), each emitted `console.warn("warning: " + w)` (stderr; not `--quiet`-gated).
4. Two info lines on stdout (quiet-gated): unreferenced unmodelled standard objects (areas `standard-object-unmodelled` and `reference-target-skipped`, de-duplicated and sorted) and custom settings without data (`custom-setting-no-data`).
5. Exit code: `strict && warnings.length > 0 ? 1 : 0` (`main.ts:100`). Info never counts.

Warning sources and their structured twins (the report must read the twins, in the same concatenation order as step 3):

| Source | Warnings | Structured | Areas |
|--------|----------|------------|-------|
| `loadOrgSchema` -> `sfdx.ts` reader | `result.warnings` | `result.diagnostics` | `field-type` (ExternalLookup, IndirectLookup), `custom-setting`, `custom-metadata-record` (bad file name) |
| `build.ts` | same | same | `object-kind`, `standard-object`, `standard-field`, `custom-label` (duplicate), `custom-metadata-record`, `reference-target`, plus rollup areas from `rollup.ts` (`rollup-cycle` and the `outcome.area` values) |
| `admitFormulaRollups` | appended to the same arrays | same | `rollup-target`, `rollup-cycle`, `rollup-formula` (these carry `cause`) |
| `planCustomMetadataSeed` (`seed.ts:156`) | `cmdt.warnings` | `cmdt.diagnostics` (sorted by `localeCompare`, see Pitfall 3) | `custom-metadata-record`, `reference-target` |
| `FormulaRegistry` ctor (`formulas.ts:62-97`) | `.warnings` | `.diagnostics: FormulaFailure[]` | `formula` (compile failure, with `missing`), `formula-global`, `formula-function`, `rollup-formula`-style area strings from `compiled.warnings` (`w.area`) |
| `migrate()` / `DmlEngine.warnings` / `reconcileKeyPrefixes` | only in `up` | | `schema-fk`, `schema-drop`, `schema-narrow`... NOT part of `check` (needs a database) |

Enumerated `UNSUPPORTED:` areas in non-test source (grep of `packages/*/src`): `bulk-relationship-column`, `composite-rollback`, `sosl` (API runtime), `reference-target`, `custom-metadata-record`, `formula-global` (x3), `rollup-formula`, `formula-function`, `rollup-*` (`rollup-filter`, `rollup-formula`, `rollup-target`, `rollup-cycle`), `schema-*` (`schema-fk`, `schema-drop`, `schema-narrow`), `entity-definition` (SOQL errors). Areas passed as variables (not literal in the grep): `standard-object`, `object-kind`, `standard-field`, `field-type`, `custom-setting`, `custom-label`, `formula`, `rollup-cycle`. Of these only the load-time set is reachable from `orglet check`; runtime ones (`bulk-*`, `composite-*`, `sosl`, `entity-definition`) are thrown/logged per request and are out of the report.

Thrown vs warning: `UnsupportedMetadataError` (`sfdx.ts`) and `throw new Error("unknown field type")` abort the load (not a warning, not in the report; the CLI top-level prints `err.stack`). Informational: `InfoDiagnostic` only, areas `standard-object-unmodelled`, `reference-target-skipped`, `custom-setting-no-data` (`build.ts:721-737`); none carries the `UNSUPPORTED:` prefix.

### Pattern 1: Pure report builder over the structured twins
**What:** `buildCheckReport({ schema, diagnostics, info, customMetadata, labels })` returns a plain object; renderers and `--json` consume it. `main.ts` keeps the `warning:` loop over the *strings* (so byte-identity is trivially preserved) and uses the report only for stdout.
**When:** always for `check`.
**Example (shape, not final):**
```typescript
// Source: derived from packages/metadata/src/diagnostics.ts and packages/cli/src/main.ts
export interface CheckReport {
  version: 1;
  census: { objects: Count3; fields: Count3; customMetadataTypes: number; customMetadataRecords: number; customSettings: number; labels: number; featureGatedFields: number };
  verdict: { ok: boolean; warnings: number; rootCauses: number; dependents: number; info: number };
  areas: { area: string; severity: "warning" | "info"; count: number; dependents: number }[];  // sorted by (severity, area) code-point order
  groups: { root: Diagnostic; dependents: Diagnostic[] }[];   // omitted/empty in --summary
  info: InfoDiagnostic[];                                       // omitted in --summary
}
interface Count3 { total: number; custom: number; standard: number }
```
Census sources: `schema.list()` for objects (`o.custom`), `o.fields` for fields (`FieldDef.custom` exists, `types.ts`), `f.featureGated === true` (already used at `main.ts:80`), `planCustomMetadataSeed(...).types.length/.records`, `schema.labels.size`, objects with `customSetting`.

### Pattern 2: Root-cause resolution (the algorithm to implement)
1. Index every diagnostic that names a thing: key = `` `${area}:${object}.${field}` `` (same format `admitFormulaRollups` already writes into `cause`, `rollup-admission.ts:11`), and a second index by lower-cased `object.field` for "skipped field" diagnostics (`kind` in `field|rollup`, plus `standard-field`).
2. `rootOf(d)`: if `d.cause` resolves in the key index, recurse on that entry; else if `d` is a `FormulaFailure` with `missing`, look up lower(`missing.object.missing.field`) in the skipped-field index and recurse; else `d` is its own root. Guard against cycles with a visited set (rollup cycles are separate diagnostics with no cause).
3. Group: `groups = Map<rootKey, {root, dependents[]}>`; a diagnostic is a *dependent* iff `rootOf(d) !== d`. Dependents are always listed, never dropped. Counts: `rootCauses` = number of distinct roots that have at least one dependent plus standalone roots? Define it explicitly: `warnings = standalone + groupedRoots + dependents`; verdict states `W warnings: R root causes, D dependents` where `R = warnings - D`.
4. Roots for "an object skipped upstream": `standard-object` / `object-kind` / `custom-setting` diagnostics have `object` only; match a dependent whose `missing.object` equals the skipped object. Verify with a probe what `FormulaCompileError.missing` holds when the *object* is unknown (not checked in this research; see Open Question 2).

### Pattern 3: Output contract
- Default: current lines plus (new) census block, verdict, per-area table, grouped failures; `warning:` lines unchanged on stderr in their original order; info lines unchanged.
- `--summary`: census, verdict, per-area counts only. No object/field/rule names, so also no provisional-prefix list, no info name lists, no `warning:` lines. Counts of info areas are shown.
- `--json`: one JSON document on stdout from the same `CheckReport` (with `groups`, `info`, and the full diagnostics); nothing else on stdout. `--json --summary` emits the report with `groups`/`info`/name-bearing fields stripped (reuse the same redaction function as the text path so the two cannot drift).
- `--strict`: unchanged semantics; exit code computed from the warning count, never from the report formatting.
- Flag/`--quiet` interplay: recommend `--quiet` gates the human text report only; `--json` is an explicit request and always prints. Confirm in planning (Open Question 3).

### Anti-Patterns to Avoid
- **Re-deriving areas from warning strings by regex:** the structured twins exist for this exact reason (diagnostics.ts header says so). Use `d.area`.
- **Changing `formatDiagnostic` or any message text to make the report prettier:** breaks `warning:` byte-identity and the pinned expectations in `main.test.ts` (e.g. the eight cmdt warnings).
- **`localeCompare` for ordering anything in the report or its inputs:** ICU/locale dependent; see Pitfall 3.
- **Putting absolute paths in snapshot-covered output:** `custom-metadata-record` messages embed the full file path (seen in the `cmdt-check` run); the acme snapshot has no warnings, but any fixture-based report test must normalise the project root (the existing test already does for `Retired_Type`).
- **Adding a third `console` channel or colour.**

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Flag parsing | custom argv loop | `parseArgs` already in `main()` | Add `summary`/`json` booleans next to `strict` |
| Warning-to-area parsing | regex over `UNSUPPORTED:(\S+)` | `Diagnostic.area` | Structured twins exist and are tested for 1:1 order |
| Snapshot plumbing | hand-diffed golden files | `expect(text).toMatchFileSnapshot(path)` | Built into vitest 3.2.7 |
| Dependency analysis of formulas | a second formula walker | `FormulaFailure.missing` + `cause` already carried | Rollup admission already computed causes |
| Enterprise fixture XML | invented element names | Metadata API field/object shapes (URLs below) and the existing fixtures under `examples/acme`, `conformance/cmdt-check/project` as templates | Both already load clean through the reader |

**Key insight:** this phase adds almost no new analysis; it only exposes data the previous phases deliberately recorded. The risk is in output stability and fixture coverage, not algorithms.

## Runtime State Inventory

Not a rename/refactor/migration phase; omitted. (One note: `check` writes nothing; `run-all.sh` creates Postgres schemas `conformance_run` and `conformance_run_cmdt`, and an enterprise run needs its own fresh schema/port, cleaned with `orglet reset --org-schema <s> --drop-prefixes`.)

## Common Pitfalls

### Pitfall 1: Existing CLI tests pin the old output
**What goes wrong:** `packages/cli/src/main.test.ts` asserts `logs[0]` matches `^\d+ objects \(4 custom\), \d+ fields$` (line ~49, again ~179 and ~213), expects `logs` to contain the `  X__c  a00  (provisional)` lines, and that the info line is `logs[logs.length - 1]` (lines ~98-109, ~203). A new census/verdict block breaks these.
**How to avoid:** decide the full-mode layout first, then update those assertions in the same plan that changes the output (not later). Keep the provisional-prefix lines, the feature-gated line and info lines in default mode if possible; place the new census/verdict/table block so that either the old first line stays first or the tests are consciously rewritten. Prefer rewriting the tests to anchor on stable substrings; do not weaken `warns` assertions.
**Warning signs:** failing `main.test.ts` on the first run after wiring.

### Pitfall 2: Counting identity between warnings and report
**What goes wrong:** verdict says N warnings while stderr printed M lines.
**How to avoid:** assert in a test that `report.verdict.warnings === warnings.length` and `diagnostics.length === warnings.length` (the D-15 invariant) for acme, the cmdt project and a failing project. `FormulaRegistry.evaluate` pushes a `$Api` diagnostic at runtime (formulas.ts:109) but only after construction; `check` never evaluates, so the invariant holds in `check`. Do not reuse the registry after construction in `check`.

### Pitfall 3: Non-deterministic ordering
**What goes wrong:** snapshot differs between macOS and Linux CI.
**Why:** `String.prototype.localeCompare` uses the host ICU locale. It is used in `seed.ts:155` (sorting the cmdt diagnostics), `sfdx.ts:430` (object directory order) and `rollup-admission.ts` (parent sort). The warning *order* is part of the existing contract, so do not touch those; but the new report must sort with an explicit code-point comparator (`a < b ? -1 : a > b ? 1 : 0`) on `(severity, area)` and on group root keys, and must never depend on `Map` insertion order from the schema.
**Warning signs:** snapshot passes locally, fails in `test-pglite`.

### Pitfall 4: Snapshot brittleness from the baseline
**What goes wrong:** acme census (57 objects, 3643 fields; 146 feature-gated; 39 unreferenced standard objects at HEAD) moves whenever the baseline generator output changes (`baseline-gen-check` CI job guards the generator, so this is intentional drift).
**How to avoid:** accept it (CHECK-01 explicitly asks for a snapshot on acme), document in the test header that a baseline regeneration legitimately updates the file, and keep the committed snapshot as a reviewed `.txt`. Do not hard-code counts in other tests. `vitest -u` must be a conscious step; CI runs without `-u`, so drift fails loudly (good).

### Pitfall 5: `field-type` diagnostic has no `object`
**What goes wrong:** a formula referencing a skipped ExternalLookup field is not grouped under it.
**How to avoid:** `parseField(node, file, sink)` (`sfdx.ts:192`) has no object name; its caller `readObjectDir` (`sfdx.ts:298`) does. Thread the object name in (or patch the pushed diagnostic after the call). Message text must not change. Add a test that the three-line cascade (skipped field -> formula -> second formula) groups under the skipped field.

### Pitfall 6: `--strict` semantics drift
**What goes wrong:** report-level "verdict OK" diverges from exit code, e.g. info-only exits 1, or a dependent-only count of 0.
**How to avoid:** keep `strict && warnings.length > 0 ? 1 : 0` as the single source; test: info-only project exit 0 (existing tests at `main.test.ts` "strict exits 0 when only informational items exist" and "custom setting only") stay green; warning project exit 1; with `--summary` and with `--json` too.

### Pitfall 7: Enterprise fixture accidentally warning-free by omission
**What goes wrong:** the fixture "passes --strict" because it avoids the features.
**How to avoid:** a category-coverage test that loads `examples/enterprise` and asserts presence of each category (see map) so the fixture cannot be gutted silently, in addition to `check --strict` exit 0.

### Pitfall 8: SDK suites assume acme
**What goes wrong:** pointing `run-all.sh` at a project without `BigTable__c`/`UpsertTable__c`/`Account.Customer_Number__c` fails the jsforce subset (51 passed / 60 excluded counts in `conformance/README.md`) and simple-salesforce (29/29).
**How to avoid:** enterprise is a superset of acme with those definitions unchanged; the jsforce `--seed` and counts then stay the same. Do not alter acme fields while merging.

### Pitfall 9: Two servers/ports and schema freshness in CI
`run-all.sh` already starts acme (PORT, schema `ORG_SCHEMA`) and cmdt (PORT+1, `${ORG_SCHEMA}_cmdt`) and requires fresh schemas. An enterprise run needs its own `ORG_SCHEMA`/ports; running it as a second CI invocation (matrix entry) is safer than a third concurrent server (jsforce suite is the slow leg).

## Code Examples

### parseArgs additions (consistent with `main.ts:214-231`)
```typescript
// Source: packages/cli/src/main.ts (existing options block)
options: {
  // ...existing...
  strict: { type: "boolean" },
  summary: { type: "boolean" },
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
}
// and in USAGE:  orglet check [--project <sfdx-dir>] [--strict] [--summary] [--json]
```
Note `main.test.ts` "usage" test asserts the exact substring `orglet check [--project <sfdx-dir>] [--strict]`; the USAGE line must keep that as a prefix or the test must be updated deliberately.

### Snapshot test shape
```typescript
// Source: vitest 3.2 file snapshots; paths via the existing ACME constant in main.test.ts
it("prints a stable census, verdict and area table for examples/acme", async () => {
  expect(await main(["check", "--project", ACME])).toBe(0);
  await expect(logs.join("\n") + "\n").toMatchFileSnapshot("./__snapshots__/check-acme.txt");
});
```

### Deterministic comparator
```typescript
// code-point order, never localeCompare (ICU-dependent)
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
```

## `examples/acme` today and "every v1.1 category"

`examples/acme` (verified by `find`): objects `Account` (6 custom fields, 1 validation rule), `Contact` (`Preferred_Language__c`), `Opportunity` (`Weighted_Amount__c`), `Project__c` (11 fields, 2 record types, 2 validation rules), `Milestone__c`, `BigTable__c`, `UpsertTable__c`; one `globalValueSet` (Tier), one `standardValueSet` (Industry); package dir `force-app`, API 62.0. Contains roll-ups (Project/Account/Milestone, phase 5), polymorphic owners via standard objects (phase 4), but **no** custom metadata, custom settings, labels, `$` globals, colon syntax, `!`, roll-up over formula, or lookup to the 18 business objects.

`conformance/cmdt-check/project` covers CMDT/custom settings/labels but is deliberately a *warning* fixture (8 expected warnings, pinned in `main.test.ts` "prints the fixture's eight warnings") and uses `a00/m00` provisional prefixes asserted in three places; it must stay as is.

Category map for `examples/enterprise` (v1.1 REQUIREMENTS ACC2-01 list -> artefact; "unit-only today" means no example fixture exercises it):

| v1.1 category (phase) | enterprise artefact | Covered by fixture today? |
|-----------------------|---------------------|---------------------------|
| Custom metadata type + records + `MetadataRelationship` to another `__mdt`, EntityDefinition, FieldDefinition (11) | 2 `__mdt` types, records under `customMetadata/`, one `"007"`-style text, one `xsi:nil` | cmdt-check project only (with warnings); enterprise must be warning-free: no dangling targets, no unknown fields |
| Hierarchy and List custom setting (11) | one each under `objects/`; data comes from a **seed script** (settings data is not in a retrieve), see ACC2-01 wording | cmdt-check project only |
| Custom labels (11) | `labels/CustomLabels.labels-meta.xml` without case-duplicates (else `custom-label` warning) | cmdt-check only |
| `$Label`, `$CustomMetadata` in formulas / validation rules (12) | formula field + validation rule using each | unit tests only |
| `$Setup` (hierarchy), `$UserRole`, `$Organization`, `$User`, `$Profile`, `$Api` (12) | formula fields / rules using them; note `$Api` formulas log a runtime warning only at evaluation, not in `check` | unit tests only |
| `!` operator and `Owner:User.Email` / `Owner:Queue.Name` colon syntax (12) | a validation rule with `!ISBLANK(...)`, a formula with colon syntax on a polymorphic `OwnerId` | unit tests only |
| Roll-up over a same-object non-volatile formula (13) | child formula `Qty__c * Price__c` + Summary field (the `rollupBase()` shape in `main.test.ts`) | unit tests only |
| Lookups to the 18 business objects (10) | custom object with lookups to Quote, Order, OrderItem, ContentDocument, Location, etc., so they count as *referenced* | unit/conformance describe only |
| `OwnerId` narrowing (9): User-only (`Account, Asset, Campaign, Contact, ContentDocument, ContentVersion, Contract, Event, Individual, Opportunity` per `ownerTargets` in baseline JSON) and queue-enabled (Case, Lead, Task, Quote etc.: `ownerTargets` absent = User and Group) | validation rule / formula using `Owner.Name` on narrowed objects, a `TYPEOF Owner` use on a queue-enabled one | poly-check at runtime only |
| Nullable key prefixes (8) | no baseline object currently has `keyPrefix: null` (grep of `packages/metadata/standard/objects` found none), so it cannot be exercised by a public fixture; cover by unit tests only and record that in the plan | n/a |
| Feature-gated standard fields (9) | reference one gated standard field in a formula | only the census count today |

Recommended structure: enterprise reuses acme through a second `packageDirectories` entry (`{"path": "../acme/force-app"}`); `readPackageDirectories` (`sfdx.ts:125-135`) does `join(rootDir, d.path)`, so it resolves. Unverified: whether the build merges same-named objects (e.g. Account fields in both package dirs) or the second silently wins/duplicates. First plan task must probe that; if it does not merge, copy the acme objects the suites need and add the new ones. Real `sf` tooling may reject a path outside the project root, so document that this fixture is orglet-only.

## Conformance harness (verified)

- `conformance/run-all.sh`: starts `up --project examples/acme` (PORT 8093, schema `ORG_SCHEMA`) and `up --project conformance/cmdt-check/project` (PORT+1, `${ORG_SCHEMA}_cmdt`), obtains a token, then legs in this order: `jsforce-subset` (`conformance/jsforce/run.sh "$BASE" "$TOKEN" --seed`), `simple-salesforce` (`python/run.py`), `describe-check` jsforce/python, `poly-check` jsforce/python, `rollup-check` jsforce/python, `cmdt-check` jsforce/python on the second server. Prints PASS/FAIL per leg, exit non-zero on any FAIL. The project path is hard-coded in the script; no `PROJECT` env today.
- `describe-check`: reads `objects.txt` (32 objects) and `contract.json`; object names given as args override. Parameterisable already: enterprise adds the `__mdt` and custom-setting objects (extend `objects.txt` or pass args) so `Support_Tier__mdt`-style describe goes through both SDKs.
- `poly-check`, `rollup-check`: create their own records (Account/Case/Queue; Account/`Project__c`/`Milestone__c`) with names from acme. They need acme's `Project__c`/`Milestone__c` to exist, satisfied by the superset. To "extend for the new objects" add a formula-roll-up check (Phase 13) to rollup-check and a typed-polymorphic (`Owner:User`) or business-object check to poly-check, keeping the 5/5 and 4/4 counts' README rows updated.
- `cmdt-check`: hard-coded to its own project and port 8095 default. For enterprise, add the `__mdt`/setting describe checks to the *enterprise* server via `describe-check` args, or run `cmdt-check` against the enterprise server only if its expected facts are generalised; recommended: leave cmdt-check as is and add enterprise-specific describe checks.
- CI (`.github/workflows/ci.yml`): jobs `test-pglite` (build, lint, typecheck:scripts, test), `test-postgres` (build, lint, test with `ORGLET_DATABASE_URL`), `conformance` (python 3.12 venv, `conformance/run-all.sh` with `ORG_SCHEMA=conformance_run PORT=8093`), `sigha-sync-check`, `baseline-gen-check`. **`orglet check --strict` is not a CI step today**; add it either as a vitest test (runs in both test jobs, no DB needed, recommended) and/or an explicit `node packages/cli/dist/index.js check --strict --project examples/enterprise` step in `test-pglite` after `pnpm build`.
- `conformance/README.md`: Overview table (Check, Date, orglet commit, SDK, Result, Details), a "Running everything" section, and a "DE retrieve check" section whose table records `Date | Result` rows such as `2026-10-16 | exit 0, 0 warnings, 55 objects (2 custom), 3647 fields; info: 39 unreferenced`. Exclusions are classified in `conformance/jsforce/README.md` (core 51 passed / 60 excluded; Bulk 2.0 12 passed / 5 excluded) and `python/README.md` (29/29). The enterprise run must reproduce those counts or each difference must be classified there.

## Real-org acceptance (ACC2-03) precedent

Phase 10-06 (`10-06-SUMMARY.md`, "Task 3 result") is the template: the author runs `orglet check --strict` locally against his own Developer Edition retrieve; only exit code, number of `warning:` lines and the summary line are recorded in `conformance/README.md` (Overview row + DE table row). A *second, informal* large real-org run was reported there as counts only and not recorded in the README. Phase 14 now makes that second run official: record counts per area (`orglet check --summary` is designed to produce exactly the safe text; `--json` per-area `count` fields), never names. Human-in-the-loop handling in earlier plans: a final plan task marked `checkpoint` that stops for Johan, who runs the command locally, pastes counts, and the executor edits `conformance/README.md` only with those counts.

Known risk for the large-retrieve criterion (zero warnings for everything it references): todo `.planning/todos/pending/2026-10-16-standard-field-gaps-on-the-18-business-objects.md` lists `UNSUPPORTED:standard-field` gaps seen on that retrieve (Order.AccountNumber, OrderItem.ProductCode, CaseMilestone.MilestoneId, ContentDocument.ParentId, OpportunitySplit.SplitTypeId, Opportunity.SyncedQuoteId, ...). These are still pending, so ACC2-03 part 2 can fail until they are closed or explicitly accepted. This is the biggest schedule risk; surface it in planning (Open Question 1). Names from that retrieve must not enter the repo (project memory: stand-alone, no employer attribution); the todo already lists only generic Salesforce standard-field names.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Free-text warnings only | Structured `Diagnostic` twins beside strings | Phase 8 (08-05, 08-06) | Report can group/count without parsing |
| `UNSUPPORTED:standard-object` for every unreferenced unmodelled object | Informational `info:` line, not counted by `--strict` | Phase 10 (BASE2-08) | Info is a first-class category the report just has to render |
| Rollup-formula gaps ignored | `cause` keys written by `admitFormulaRollups` | Phase 13 | First producer of `cause`; the report generalises it |

**Deprecated/outdated:** nothing relevant; `styleText` is not in use.

## Open Questions

1. **Large real-org retrieve vs pending standard-field gaps**
   - Known: the todo lists ~20 gaps that surface as `UNSUPPORTED:standard-field` on that retrieve; the todo is `pending`.
   - Unclear: whether ACC2-03 "zero warnings for everything it references" should be met by closing the todo inside Phase 14 or by an accepted exclusion list.
   - Recommendation: planner asks Johan at planning time; budget one optional plan (generator overrides in `scripts/gen-baseline/overrides.json`, regenerate, rerun `baseline-gen-check`) before the acceptance checkpoint.

2. **What `FormulaCompileError.missing` holds when the whole object is skipped** (`packages/formula/src/compile.ts:96-112,162`)
   - Known: for a missing field it is `{object, field}`.
   - Unclear: for a lookup traversal through an unmodelled object. Needs a 5-minute probe test before finalising the object-level root-cause rule.
   - Recommendation: first task writes the failing grouping tests for (a) skipped field, (b) skipped rollup (has `cause`), (c) skipped object, and the report implements what the probe shows; if (c) has no `missing`, group only (a) and (b) and state that in the summary.

3. **Flag/`--quiet`/stderr interplay**
   - Recommendation (no CONTEXT): `--summary` and `--json` suppress `warning:` stderr lines (names must not appear; JSON carries them); default mode unchanged; `--quiet` hides only the human text report; `--json` always prints. Planner to confirm; it is a user-visible decision.

4. **Does the metadata build merge same-named objects across package directories?** Decides "reuse acme via second package directory" vs "copy". Probe first (see fixture section).

5. **Custom-setting data "seed script"** (ACC2-01): settings data is not in a retrieve. Recommend a small `examples/enterprise/seed.mjs` (REST `POST /composite/sobjects`, like `conformance/jsforce/seed.mjs`) creating hierarchy rows (org default + one `SetupOwnerId`) and list rows, run by `run-all.sh` after login, so `$Setup` formulas have data to resolve in the conformance run.

6. **Where census "standard" counts come from for fields:** `FieldDef.custom` exists; confirm it is set for both baseline and source fields before relying on it (not read in detail).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 22 | build, tests, CLI | partial: this shell reports v18.20.8; repo `.nvmrc` = 22 | v18.20.8 seen | switch via nvm before any verification; executor must confirm `node -v` |
| pnpm 10+ | install/build | not confirmed (`pnpm -v` returned nothing) | n/a | Corepack: `corepack enable pnpm` |
| Docker + Postgres 16 | conformance run, `test-postgres` | Docker daemon up; a container named `local-klv-db-1` (postgres:16) is on 5432 | postgres:16 | `docker compose up -d postgres` uses 5433; or pglite for unit tests |
| Python 3.12 venv | simple-salesforce legs | `conformance/python/.venv` exists | not checked | `conformance/describe-check/.venv` per READMEs; arm64 note in 13-08 |
| jsforce build | jsforce legs | `conformance/jsforce/.cache/jsforce` present | pin `9bae14e` | `run.sh` clones and builds |
| Author's DE + large retrieve | ACC2-03 | local only, not in repo | n/a | none (human checkpoint) |

**Missing dependencies with no fallback:** the author's real retrieves (by design, human step).
**Note:** the existing container on 5432 belongs to another project (`local-klv-db-1`); executors must not drop or reuse its databases; use the orglet compose DB (port 5433) or fresh throwaway schemas.

## Validation Architecture

(`workflow.nyquist_validation` is `true` in `.planning/config.json`.)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.7, single root config `vitest.config.ts` (`@orglet/*` -> `src/index.ts`; includes `packages/*/src/**/*.test.ts`, `packages/*/test/**/*.test.ts`) |
| Config file | `/Users/johankarlsteen/Development.nosync/local-salesforce/vitest.config.ts` |
| Quick run command | `pnpm vitest run packages/cli/src` |
| Full suite command | `pnpm build && pnpm lint && pnpm test` (also once with `ORGLET_DATABASE_URL` set), then `bash conformance/run-all.sh` with a fresh `ORG_SCHEMA` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CHECK-01 | census + verdict + per-area table printed for acme; order deterministic | snapshot (`toMatchFileSnapshot`) | `pnpm vitest run packages/cli/src/main.test.ts -t "stable census"` | Wave 0 (new snapshot file) |
| CHECK-01 | cascaded failures grouped under root cause; every dependent listed; both counts stated | unit (pure `buildCheckReport` with hand-built `Diagnostic[]`) + one project-level test via `main()` | `pnpm vitest run packages/cli/src/report.test.ts` | Wave 0 (`report.test.ts`) |
| CHECK-01 | root resolution for skipped field, skipped rollup (`cause`), cycle guard, order independent of input permutation | unit (shuffle inputs, assert identical report) | same | Wave 0 |
| CHECK-01 | `warning:` lines byte-identical to v1.0 format and original order | CLI test comparing `warns` before/after for acme (empty), cmdt project (8 pinned) and a failing project; keep existing tests | `pnpm vitest run packages/cli/src/main.test.ts` | exists, extend |
| CHECK-01 | `report.verdict.warnings === warns.length` and `diagnostics.length === warnings.length` | CLI test over 3 projects | same | Wave 0 |
| CHECK-02 | `--summary` contains no object/field/rule names | test: run on cmdt project and a failing project; assert none of the known names (`Ext__c`, `Support_Tier__mdt`, `App_Config__c`, ...) appear in `logs.join()` or `warns` | `pnpm vitest run packages/cli/src/main.test.ts -t summary` | Wave 0 |
| CHECK-02 | `--json` parses, equals the report incl. informational category; `--json --summary` redacts | test: `JSON.parse(logs.join("\n"))` shape + info areas present | same | Wave 0 |
| CHECK-02 | `--strict`: 1 on any warning, 0 on info only; also with `--summary`/`--json` | extend the existing strict tests (`main.test.ts` already has warning and info-only cases) | same | exists, extend |
| ACC2-01 | `examples/enterprise` loads with zero warnings, `--strict` exit 0 | vitest via `main(["check","--strict","--project", ENTERPRISE])`; plus CI step after `pnpm build` | `pnpm vitest run packages/cli/src/main.test.ts -t enterprise` | Wave 0 |
| ACC2-01 | fixture really covers each category (cannot be gutted) | test asserting presence: a `__mdt`, a Hierarchy and a List setting, labels > 0, a formula using each global, a roll-up over a formula, lookups to the 18, narrowed and queue-enabled owner uses | `pnpm vitest run packages/cli/src/enterprise.test.ts` | Wave 0 |
| ACC2-01/02 | full conformance green against enterprise | `PROJECT=examples/enterprise ORG_SCHEMA=ent_run PORT=8096 bash conformance/run-all.sh` and the default acme run | needs Postgres, venv, jsforce cache | existing script, extend |
| ACC2-02 | describe-check includes `__mdt`/setting objects through both SDKs; poly/rollup checks extended | `run-all.sh` legs; README counts updated | as above | extend scripts |
| ACC2-03 | DE retrieve `check --strict` exit 0; large retrieve counts per area recorded | manual-only (local data never in repo/CI) | `node packages/cli/dist/index.js check --strict --project <retrieve>` then `... --summary` | n/a (human checkpoint) |

### Sampling Rate
- **Per task commit:** `pnpm vitest run packages/cli/src` (pglite, seconds)
- **Per wave merge:** `pnpm build && pnpm lint && pnpm test`
- **Phase gate:** full suite green (pglite and once on Postgres), `run-all.sh` green for acme and for enterprise on fresh schemas, then the human checkpoint, before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `packages/cli/src/report.test.ts` - grouping, counts, ordering, redaction (CHECK-01/02)
- [ ] `packages/cli/src/__snapshots__/check-acme.txt` - committed snapshot (CHECK-01)
- [ ] failing-first tests for root-cause cases (skipped field/rollup/object) using `project()` helpers from `main.test.ts` (extract helper if reused by a second file)
- [ ] `examples/enterprise/` + `enterprise.test.ts` (ACC2-01)
- [ ] no framework install needed

## Recommended Plan Split

Five plans, three waves (planner may merge 14-04 into 14-02/14-03 if small):

**Wave 1 (parallel, no file overlap):**
- **14-01 Report core (CHECK-01 logic):** thread `object` into the `field-type` diagnostic (message unchanged), write `report.ts` + `report.test.ts` first (red), implement root-cause grouping, counts, code-point ordering; probe Open Question 2. No CLI output change yet.
- **14-02 Enterprise fixture (ACC2-01):** probe multi-package-dir merge, author `examples/enterprise` from the Metadata API docs under generic names (category map), seed script for settings, `enterprise.test.ts` + `check --strict` test.

**Wave 2 (parallel after Wave 1):**
- **14-03 CLI wiring (CHECK-01/02):** `--summary`, `--json`, renderer, USAGE, README line, update pinned assertions in `main.test.ts`, acme snapshot, strict/exit-code tests, `warning:` byte-identity tests. Depends on 14-01.
- **14-04 Conformance + CI (ACC2-01/02):** `run-all.sh` `PROJECT` support, enterprise server config, describe-check object list, rollup-check/poly-check extensions, CI `check --strict` step and conformance matrix entry, README rows. Depends on 14-02.

**Wave 3:**
- **14-05 Acceptance gate (ACC2-03):** full runs (acme and enterprise) on fresh schemas, regenerate counts in `conformance/README.md`, checkpoint for Johan (DE retrieve and large retrieve via `--summary`), tick REQUIREMENTS, update PROJECT.md/STATE. Optionally a preceding plan for the pending standard-field todo if Open Question 1 says to close it.

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Snapshot churn from baseline regeneration (census numbers) | red CI after unrelated baseline PR | Document in test header; `baseline-gen-check` already gates the generator; update is a reviewed `-u` |
| Locale-dependent ordering (`localeCompare` in inputs) | flaky across OS | Explicit comparator in the report; do not alter input ordering (warning order is contract) |
| Changing warning order/text by accident | breaks `main.test.ts` pins and the author's habit of counting `warning:` lines | Keep stderr loop over strings; add before/after byte-identity tests; no scripts in `conformance/` grep `warning:` (verified), only docs mention it |
| Fixture "superset" via package dirs outside root | `sf` tooling rejects; object merge may duplicate | Probe first; fall back to copy; label fixture orglet-only |
| Enterprise passes `--strict` only by omission | false acceptance | Category-coverage test |
| `$Api` formulas | a `$Api` use only warns at evaluation, never in `check`; a conformance run may log it once | Use `$Api` once in a formula and document that the runtime warning is expected, or keep it in a rule only evaluated with a request |
| Real-org acceptance blocked by pending standard-field gaps | ACC2-03 not meetable | Open Question 1, early decision |
| Shared port/DB: existing Postgres on 5432 belongs to another project | accidental data loss | use fresh throwaway schemas, never `reset` without `--org-schema` of ours |
| Python venv CPU mismatch | SDK legs fail locally | use arm64 venv as in 13-08; CI unaffected |

## Public documentation for authoring the fixture (cite only these; MEDIUM, not re-fetched this session)

- Metadata API Developer Guide, CustomObject / CustomField (field types, `summaryForeignKey`, `customSettingsType`, `MetadataRelationship`): https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/customobject.htm and https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/customfield.htm
- CustomMetadata (record file shape, `<values><field>`, `xsi:nil`): https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_custommetadata.htm
- CustomLabels / CustomLabel: https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_customlabels.htm
- ValidationRule: https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_validationrule.htm
- Formula operators and global variables (`$Label`, `$Setup`, `$User`, `$UserRole`, `$Organization`, `$Api`, `$CustomMetadata`): Salesforce Help "Formula Operators and Functions" and "Global Variables" (help.salesforce.com article view pages; the existing 12-RESEARCH.md cites the `articleView` pattern).
- Object Reference for the Salesforce Platform (standard objects, fields, Supported Calls): already vendored/pinned for the baseline generator (`scripts/sync-sfdocs.sh`, `scripts/gen-baseline`); reuse those facts rather than new fetches.
- Roll-up summary restrictions: Salesforce Help "Roll-Up Summary Field" (already cited in `rollup-admission.ts` header).
Existing fixtures (`examples/acme`, `conformance/cmdt-check/project`) are the working XML templates; copy their element order.

## Sources

### Primary (HIGH confidence, read directly)
- `packages/cli/src/main.ts` (check at 74-101, arg parsing at 213-255), `packages/cli/src/main.test.ts` (336 lines), `packages/cli/package.json`
- `packages/metadata/src/diagnostics.ts`, `build.ts` (BuildResult 33-45, diagnostics/info at 607-748), `sfdx.ts` (125-135, 192-200, 298-318, 382-440), `index.ts`
- `packages/formula/src/rollup-admission.ts` (cause keys, drops), `packages/engine/src/formulas.ts` (FormulaRegistry), `packages/engine/src/seed.ts` (139-157)
- `.github/workflows/ci.yml`, `conformance/run-all.sh`, `conformance/README.md`, `conformance/{describe,poly,rollup,cmdt}-check/*`, `conformance/jsforce/README.md`
- `.planning/REQUIREMENTS.md`, `ROADMAP.md` (phases 8-14, backlog 999.6), `STATE.md`, `config.json`, `10-06-SUMMARY.md`, `.planning/todos/pending/2026-10-16-*.md`
- Live runs of `node packages/cli/dist/index.js check` on acme and the cmdt project (outputs quoted above)

### Secondary (MEDIUM)
- Salesforce Metadata API doc URLs listed above (known pages; not fetched in this session)

### Tertiary (LOW)
- None used for recommendations.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies; all in-repo
- Architecture: HIGH for data sources and gaps; MEDIUM for the object-level root-cause rule (needs the probe in Open Question 2)
- Pitfalls: HIGH - derived from reading the tests and sources
- Fixture/doc URLs: MEDIUM - not re-verified this session

**Research date:** 2026-10-28
**Valid until:** 2026-11-27 (repo-internal; invalidated sooner by any change to diagnostics, baseline regeneration, or the CLI output)
