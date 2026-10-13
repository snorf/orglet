# Phase 8: Upgrade Safety Net & Nullable Key Prefixes - Research

**Researched:** 2026-10-13
**Domain:** Postgres schema migration safety (pg + pglite), nullable key-prefix plumbing through a TypeScript monorepo, structured diagnostics, vendoring script portability
**Confidence:** HIGH (all findings are from reading this repo's code and from probes run in it; no external library is introduced)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** When a planned single-target lookup FK would be violated by existing rows, `migrate()` skips that FK, pushes one `UNSUPPORTED:schema-fk` warning per column naming table, column and offending row count, and completes. It never deletes or rewrites rows. `NOT VALID` stays excluded (Phase 3 decision).
- **D-02:** The skip is re-evaluated on every `up`, not remembered. The FK is absent from `pg_constraint`, so the next `up` runs the pre-check again: it warns while rows still violate and adds the FK silently once the rows are corrected. No new state in `_orglet`.
- **D-03:** Offending-row count comes from a pre-check query per planned FK on a populated column (`count(*) WHERE col IS NOT NULL AND NOT EXISTS (target)`), so the warning names every offender in one run. The existing `migrate.test.ts` case that asserts the abort (around lines 148-175) is rewritten to assert the warning and the intact table.
- **D-04:** `migrate()` reads existing index names from the catalog once (same style as `existingConstraintNames`) and does not run or record `CREATE INDEX` for an index that exists. `IF NOT EXISTS` may stay as belt-and-braces but must not be the mechanism; `MigrateResult.statements` is what the upgrade test asserts on. Same for sequences if cheap.
- **D-05:** v1.0 baseline files are a committed snapshot copy of the 35 v1.0 JSON files (plus `standardValueSets.json` if the loader needs it) in a fixture directory (suggested `packages/metadata/test/fixtures/baseline-v1.0/`) with a README naming the source commit and the rule that the snapshot is never edited. Not `git show` at test time.
- **D-06:** The test populates the v1.0 database through the real write path: `DmlEngine` for Group-owned rows (a Group of Type Queue plus a Group-owned Case) and `importMode` for rows carrying their own Ids and audit fields. No raw SQL inserts for fixture rows.
- **D-07:** Runs on both backends (pglite default, Postgres 16 when `ORGLET_DATABASE_URL` set), asserts every fixture row intact, asserts `MigrateResult.warnings` equal to an explicit expected list (empty in Phase 8), asserts a second `migrate()` returns no warnings and no `CREATE INDEX` statements.
- **D-08:** `SObjectDef.keyPrefix` and `StandardObjectJson.keyPrefix` become `string | null`. Every consumer that maps or matches on prefix filters null-prefix objects out of prefix-based matching. A null-prefix object is never a polymorphic match candidate; no prefix is ever invented or derived.
- **D-09:** Describe returns `keyPrefix: null` for such an object. It still loads, appears in global describe, and is an accepted reference target for `orglet check` (no `UNSUPPORTED:reference-target`).
- **D-10:** A null-prefix object must be `createable: false` in the baseline. The loader treats `keyPrefix: null` together with `createable: true` as a hard baseline error (not an `UNSUPPORTED` warning). Creates hit the Phase 3 object-flag check and return `INVALID_TYPE_FOR_OPERATION`; no new engine code path. Import mode works unchanged because it bypasses the flags (Phase 3 D-08).
- **D-11:** Source label lives in the object's JSON as a sibling field: `"keyPrefix": null, "keyPrefixSource": "unverified"`. No separate `keyPrefixes.json`. Phase 8 defines type and allowed values (suggested `doc`, `sdk-fixture`, `de-describe`, `unverified`; final set is Claude's call) and makes the field optional so the 35 files stay valid.
- **D-12:** Phase 8 does not hand-label the 35 existing prefixes. Null case is proven with a test object (baseline-shaped JSON loaded only in tests) and extended existing tests: all non-null prefixes unique and three characters, none in custom range `a00..azz`, none equal to a custom-metadata `m0x` prefix, persisted custom prefixes never collide with a null.
- **D-13:** Base `Diagnostic { area, message, object?, field?, cause? }` plus `SkippedItem` (adds `kind: object | field | rollup | rule`) and `FormulaFailure` (adds `what` and `missing?: { object, field }`). `cause` references the root-cause diagnostic (or its key). `area` is the `UNSUPPORTED:<area>` token. TypeScript encoding is Claude's call.
- **D-14:** The warning string is derived from the record: every source builds a diagnostic and a single shared formatter renders exactly today's `UNSUPPORTED:<area> <text>` string. All existing `toEqual` assertions on warning strings stay untouched as the regression guard.
- **D-15:** Every existing warning source emits diagnostics: `sfdx.ts`, `build.ts`, `metadata/src/rollup.ts`, `schema/src/prefixes.ts`, `migrate.ts` (incl. new `schema-fk`), `engine/src/formulas.ts` and `engine/src/query.ts`. Each result object keeps `warnings: string[]` and gains a parallel `diagnostics` list; `FormulaCompileError` gains `missing` set by `fieldNotFound`/`resolvePath`. `orglet check --strict` and the `warning:` line format do not change.
- **D-16:** A test proves the records exist beside the strings for at least one source per package and that the formatter output equals the pre-existing string for every area in use.
- **D-17:** `scripts/sync-sigha.sh` loses the two BSD-only `sed -i ''` invocations (portable `sed -i.bak` with cleanup, or `perl -pi`), gets a `trap` that removes the `mktemp -d` clone, keeps NOTICE/LICENSE handling. Exercised on Linux in CI without changing the vendored copy on every push (Phase 1 D-18: CI never rewrites `packages/sigha/src`; a dry-run or throwaway directory that is diffed and discarded is acceptable).
- **D-18:** Claude authors the upstream fix for a lone `!` and for `Rel:Object.Field` colon syntax, tests drawn from the BSD-3 formula-engine corpus, never from an org. Work happens in a separate clone outside the orglet repo. Johan reviews and opens the PR(s) to `rfaulhaber/sigha` himself; Claude does not run `gh pr create`.
- **D-19:** The fork `snorf/sigha` does not exist yet. The plan includes explicit checkpoints asking for OK before `gh repo fork` and before pushing the branch to the fork. Until the PR exists, `VENDOR.md` gets a "Pending upstream changes" section; PR links replace it once Johan opens them. No local patch is ever carried in `packages/sigha/src`.
- **D-20:** Orglet-side expectation tests for correct behaviour of `!ISBLANK(x)`, `x != y`, `Owner:User.Email` / `Owner:Group.Name` (and `Queue` alias of `Group`), and `!` or `:` inside string literals are written now and marked with vitest `it.fails`; they stay red until Phase 12. New pattern: document in TESTING.md next to the "no static skips" rule as the one sanctioned way to express a known upstream gap.
- **D-21:** Existing tests asserting colon syntax throws `UNSUPPORTED:formula` (`packages/formula/src/formula.test.ts` ~47-52, `packages/engine/src/query.test.ts` ~182) stay unchanged.
- **D-22:** A committed `08-GROUP-OWNED-AUDIT.md` in the phase directory records every test, fixture and conformance check that creates or asserts on a Group owner or a `00G` Id, with file, line range and what it relies on (DB row vs literal Id vs describe shape).

### Claude's Discretion
- Exact catalog query for existing indexes and whether sequences get the same treatment.
- Whether the `schema-fk` warning carries a one-line hint on how to fix the rows.
- Name of orglet's `Diagnostic` type versus sigha's own `Diagnostic` and the TypeScript encoding of the specialisations.
- Final set of `keyPrefixSource` values and location/name of the null-prefix test object.
- Layout of the audit list and of the v1.0 fixture README.
- How the sync script is exercised on Linux in CI without touching the vendored copy.

### Deferred Ideas (OUT OF SCOPE)
- Colon syntax evaluation and `!` as unary NOT in orglet - Phase 12 after the resync.
- Narrowing `OwnerId.referenceTo` per object - Phase 9 (BASE2-04).
- Hand-labelling all 35 existing prefixes - Phase 9 generator output.
- Rendering diagnostics as a root-cause report (`--summary`/`--json`) - Phase 14.
- Re-deciding Phase 5 D-10 (one-time backfill) for roll-ups over formulas - Phase 13.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MIGR-01 | Populated-DB upgrade test (v1.0 baseline -> current code, pglite + Postgres 16, exact warning set) | "Upgrade test design"; `migrate()` flow at `packages/schema/src/migrate.ts:100-187`; `openTestDb` in `test/db.ts`; v1.0 commit `1b737c12d8d10408fe5713a37d4d92557209f229` |
| MIGR-02 | FK violation downgraded to `UNSUPPORTED:schema-fk` warning, nothing deleted/rewritten | Replace the try/catch at `migrate.ts:157-171`; pre-check pattern below; rewrite test at `migrate.test.ts:~148-175` |
| MIGR-04 | Second `up` prints no warnings and issues no `CREATE INDEX` for existing indexes | Catalog read via `pg_indexes`; `migrate.ts:155-156` currently pushes `CREATE ... IF NOT EXISTS` into `statements` every run |
| BASE2-05 | Nullable key prefixes, source-labelled, first-class | "Nullable key prefix: consumer inventory" (every file:line) |
</phase_requirements>

## Summary

All work in this phase is in-repo TypeScript/SQL/Bash against dependencies that are already installed: `pg`, `@electric-sql/pglite` 0.5.8 and `pglite-socket` 0.2.11 are already devDependencies, and `test/db.ts` already gives each test file its own pglite (or the Postgres named by `ORGLET_DATABASE_URL`). No new libraries are needed. The Phase 1 pglite compatibility file already proved `pg_constraint` and `information_schema` work on pglite; `pg_indexes` is an ordinary catalog view and should work the same, but the plan should include running it on pglite as the first check.

Three findings change how tasks should be written. (1) `migrate()` pushes every `CREATE INDEX IF NOT EXISTS` and `CREATE SEQUENCE IF NOT EXISTS` into `statements` on every run (`migrate.ts:155-156`), so success criterion 3 fails today for a reason `IF NOT EXISTS` cannot fix; the catalog read is mandatory. (2) A probe in this repo shows that `x != y` and `!`/`:` inside string literals **already compile today**; only a leading `!` (`!ISBLANK(x)`) and `Owner:User.Email` / `Owner:Group.Name` / `Owner:Queue.Name` fail. `it.fails` on a test that currently passes makes the suite go red, so those cases must be plain `it` regression guards and only the genuinely failing ones may use `it.fails`. (3) `sync-sigha.sh` rewrites `VENDOR.md` from a heredoc, so a hand-added "Pending upstream changes" / PR-links section is wiped by the next sync unless the script is taught to carry it over.

A second gap in CONTEXT.md: D-10 says import mode "works unchanged" for a null-prefix object, but `engine.ts:379` and `engine.ts:414` compare `keyPrefixOf(id) !== obj.keyPrefix`, which for a null prefix is always true, so every supplied Id would be rejected as `MALFORMED_ID`. The engine needs a small, explicit null branch there (see Pitfall 3).

**Primary recommendation:** Implement in four waves: (A) `migrate()` safety net (index/sequence catalog skip, FK pre-check) with the rewritten test; (B) `keyPrefix: string | null` ripple plus loader validation; (C) diagnostics types and shared formatter threaded through the seven sources; (D) sigha script/VENDOR/red tests/audit list, with the upgrade test (needs A and the fixture) as the capstone.

## Project Constraints (from CLAUDE.md)

- TypeScript strict with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`; relative imports carry `.js`; cross-package imports via `@orglet/*` index only (no deep imports).
- Public surface of each package is `src/index.ts` with explicit named exports (values and types listed separately, never `export *`; the metadata barrel's existing `export * from "./types.js"` is the one precedent).
- `UNSUPPORTED:<area> <text>` convention is mandatory for anything recognised but not implemented; status codes must be real Salesforce codes; build errors through the `Errors` factory.
- Result objects carry `warnings: string[]`; CLI prints `warning: ${w}`; `--strict` fails on any warning.
- Source files open with a `/** ... */` why-comment; comment Salesforce reasoning, not obvious code.
- Tests: co-located `*.test.ts`, one random `test_<hex>` schema per file, `openTestDb()`, no static skips (`skip(usingPglite, reason)` only for genuinely Postgres-only behaviour), test names state the invariant.
- Only Level 1 data; only public docs/SDK source; never diff behaviour against a real org; no Tele2 names anywhere (memory: real-org findings enter only as generic Salesforce areas).
- Git: repo-local identity Johan Karlsteen <johan@karlsteen.com>; outward-facing actions (fork, push to fork, PR) are confirmed with Johan first. Claude never runs `gh pr create`.
- GSD workflow: edits happen through `/gsd:execute-phase`.
- Surgical changes: do not refactor unrelated code; match existing style (long lines are accepted).

## Standard Stack

No new dependencies. Everything below is already in the lockfile.

### Core
| Library | Version (verified in package.json / lockfile) | Purpose | Why |
|---------|---------|---------|-----|
| `pg` | ^8.23.0 | Postgres client used by `migrate()` | Only DB driver in the codebase |
| `@electric-sql/pglite` + `pglite-socket` | 0.5.8 / 0.2.11 (exact pins, root devDeps) | Default test backend (Phase 1 D-09) | Already wired in `test/db.ts`; no Docker needed |
| `vitest` | 3.2.7 | Test runner; `it.fails` is available | Existing |
| `fast-xml-parser` | ^5.11.1 | SFDX XML (unchanged) | Existing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Fixture snapshot dir (D-05, locked) | `git show 1b737c1:path` at test time | Breaks in shallow CI checkouts; locked decision says snapshot |
| `pg_indexes` view | `pg_class`/`pg_index` join | `pg_indexes` is simpler (`schemaname`, `indexname`); both exist on pglite |
| `sed -i.bak` + cleanup | `perl -pi` | `sed -i.bak` is the same on GNU and BSD and was verified (below); perl adds a dependency on its presence |

**Installation:** none. The shell used for this research had Node v18 on PATH and no `pnpm`; the repo pins Node 22 (`.nvmrc`) and `packageManager: pnpm@12.6.0`, so executors must `nvm use` / `corepack enable pnpm` before running commands.

## Architecture Patterns

### Recommended placement
```
packages/metadata/src/diagnostics.ts      # NEW: Diagnostic, SkippedItem, FormulaFailure, formatDiagnostic
packages/metadata/test/fixtures/baseline-v1.0/{objects/*.json, standardValueSets.json, README.md}
packages/metadata/test/fixtures/null-prefix/   # baseline-shaped dir holding one null-prefix object (tests only)
packages/schema/src/upgrade.test.ts       # NEW: MIGR-01 contract test (or beside migrate.test.ts)
packages/formula/src/expectations.test.ts # NEW (or appended to formula.test.ts): it.fails / guard cases
.planning/phases/08-.../08-GROUP-OWNED-AUDIT.md
```
`vitest.config.ts` already includes `packages/*/test/**/*.test.ts`, and `tsconfig.test.json` allows `packages/*/test/**/*.ts`, so fixtures under `packages/metadata/test/` need no config change. Note `packages/metadata/standard/README.md` mentions "35 files" nowhere; the count is `ls packages/metadata/standard/objects | wc -l` = 35 (verified).

### Pattern 1: Skip-if-exists via one catalog read (D-04)
Copy `existingConstraintNames` (`migrate.ts:92-98`). Add, next to it:
```ts
// Source: same style as migrate.ts:92-98; pg_indexes is a standard catalog view.
async function existingIndexNames(client: PoolClient, orgSchema: string): Promise<Set<string>> {
  const res = await client.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = $1`, [orgSchema]);
  return new Set(res.rows.map((r) => r.indexname));
}
async function existingSequenceNames(client: PoolClient, orgSchema: string): Promise<Set<string>> {
  const res = await client.query<{ sequencename: string }>(`SELECT sequencename FROM pg_sequences WHERE schemaname = $1`, [orgSchema]);
  return new Set(res.rows.map((r) => r.sequencename));
}
```
Read them **after** step 1 (tables/columns), in the same place `existingConstraintNames` is read (`migrate.ts:153`), then in the loop: `if (!indexes.has(ix.name)) { await run(indexSql(...)); indexes.add(ix.name); }` (the `add` guards two planned objects mapping to the same truncated `identifier()` name). Keep `IF NOT EXISTS` in `indexSql`/`sequenceSql` as belt-and-braces. Sequences are cheap to include (`pg_sequences` exists since PG 10; sequence names come from `sequenceName(obj, field)`), so include them: `statements` should contain no `CREATE ...` at all on a second run.

A subtlety: an index that exists under the same name but a different definition (for example a field that became `unique`) is not re-created; that matches today's `IF NOT EXISTS` behaviour and `CONCERNS.md` "migrate diffs by name only". Do not widen scope.

### Pattern 2: FK pre-check, skip and warn (D-01..D-03)
Replace the try/catch at `migrate.ts:157-171`. Inside the existing `for (const fk of plan.foreignKeys)`:
```ts
if (constraints.has(fk.name)) continue;
// A table created in this run is empty; only a table that existed before can hold violators.
if (existingTables.has(plan.table)) {
  const bad = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM ${quote(orgSchema)}.${quote(plan.table)} t
      WHERE t.${quote(fk.column)} IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM ${quote(orgSchema)}.${quote(fk.referencesTable)} r WHERE r."id" = t.${quote(fk.column)})`,
  );
  const n = Number(bad.rows[0]?.n ?? 0);
  if (n > 0) { warnings.push(`UNSUPPORTED:schema-fk ${plan.table}.${fk.column} ...${n}...`); continue; }
}
await run(foreignKeySql(orgSchema, plan.table, fk));
```
- The pre-check is a read, so it is deliberately not pushed through `run()` and does not appear in `statements`.
- `existingTables` is the pre-run snapshot (`migrate.ts:115`); do not skip the check for tables whose *column* was added in this run (a freshly added column is all NULL, count is 0, harmless either way).
- Keep a defensive `isPgForeignKeyViolation` catch? Within one transaction a failed statement aborts it (`current transaction is aborted`), so a catch-and-continue is impossible without a savepoint. Remove the catch (and `isPgForeignKeyViolation`, `migrate.ts:42`) rather than leave dead code; the pre-check is the mechanism.
- The target table always exists at this point (every planned FK references a planned table, created in step 1), so the subquery is safe. Id columns compare as text; no cast needed.
- Warning text (suggested; no existing test pins it, so the planner can fix the wording): `UNSUPPORTED:schema-fk foreign key ${fk.name} not added: ${plan.table}.${fk.column} holds ${n} value(s) with no matching row in ${fk.referencesTable}; correct or clear them and run \`orglet up\` again`. It must name table, column and row count (success criterion 2).
- Emit one diagnostic per column with `area: "schema-fk"`, `object`/`field` set from `plan.object.name` and the field name (the planned `fk` has `column`, a lowercase column name; the `FieldDef` is findable via `plan.object.fields.find((f) => columnName(f) === fk.column)`).
- Deferred and ordering constraints: FKs are `DEFERRABLE INITIALLY DEFERRED`; adding one over valid rows needs no special handling. Phase 5 D-10 (roll-up backfill is the last step because of pending trigger events) is unaffected: the pre-check is a read-only SELECT before the backfill.
- Cost: the pre-check only runs for FKs that are not yet in `pg_constraint`, so a second `up` runs zero pre-checks when all FKs exist; with D-02 (skip is not remembered) a still-violating FK re-runs one count per `up`, which is the intended behaviour.

### Pattern 3: Nullable key prefix is loaded, validated, and filtered
See the consumer inventory below. Core rule: every site that compares or generates by prefix either narrows `keyPrefix` with a type guard or filters nulls before building candidate lists. With `string | null` the compiler finds all sites (there are about 20 listed below), which is the main safety net, so make the type change first and follow the `tsc -b` errors.

### Pattern 4: Diagnostic record + one formatter (D-13..D-15)
```ts
// packages/metadata/src/diagnostics.ts (name `Diagnostic` clashes with sigha's in formula/compile.ts only)
export interface Diagnostic { area: string; message: string; object?: string; field?: string; cause?: string }
export interface SkippedItem extends Diagnostic { kind: "object" | "field" | "rollup" | "rule" }
export interface FormulaFailure extends Diagnostic { what: string; missing?: { object: string; field: string } }
export const formatDiagnostic = (d: Diagnostic): string => `UNSUPPORTED:${d.area} ${d.message}`;
```
Recommendations:
- Interfaces extending a base, not a discriminated union: the specialisations are not mutually exclusive in a single list (the base is what `warnings` derive from), and `exactOptionalPropertyTypes` is easier with plain optional fields. Do not add `undefined` to optionals; omit them.
- `message` holds **everything after** `UNSUPPORTED:<area> ` so the formatter is trivially byte-exact. Several current strings embed a nested prefix (for example `UNSUPPORTED:formula ${what} skipped: ${err.message}` where `err.message` itself may begin `UNSUPPORTED:formula polymorphic reference ...`, `formulas.ts:58`, `compile.ts:173-181`). The record must store the full remainder, not a "cleaned" message, or D-14 breaks.
- Name: export from `@orglet/metadata` as `Diagnostic`, `SkippedItem`, `FormulaFailure`, `formatDiagnostic`; in `packages/formula/src/compile.ts` alias sigha's import (`import type { Diagnostic as SighaDiagnostic }`, currently `compile.ts:51-59` uses it for `FormulaCompileError.diagnostics`). The formula package depends on metadata already, so no new edge.
- Results gain `diagnostics: Diagnostic[]` next to `warnings`: `BuildResult` (`build.ts:30-34`), `SourceProject` (`sfdx.ts:86`), `MigrateResult`, `ReconcileKeyPrefixesResult` (`prefixes.ts:53,233`; today `warnings` is always `[]`, `prefixes.ts:183`), `FormulaRegistry` (`formulas.ts:19,58`), `runQuery` page result (`engine/src/query.ts:29,66`). Build the diagnostic first, then `warnings = diagnostics.map(formatDiagnostic)` (or push both from one helper) so they cannot drift.
- `FormulaCompileError.missing?: { object: string; field: string }` is set in `fieldNotFound`/`resolvePath` (`compile.ts:77-103`); `FormulaRegistry.tryCompile` copies it into `FormulaFailure.missing`. Never regex messages.
- `rollup.ts` (`metadata/src/rollup.ts:96,101`) builds `UNSUPPORTED:${outcome.area} ...` and `UNSUPPORTED:rollup-cycle ...`; `resolveRollups` takes a `warnings: string[]` parameter, so it needs a parallel sink parameter or a collector object. Prefer one small collector (`push(d: Diagnostic)` that appends to both arrays) passed down, to avoid changing 7 call signatures twice.
- `cause`: a string key (for example `"formula-field:Account.Total__c"` or the `object.field` of the root) is enough for Phase 14 grouping; Phase 8 only needs the field to exist and be set where a cascade is already knowable (it is not yet, since the topological compile order is Phase 14 scope). Do not build cascade detection now.

### Anti-Patterns to Avoid
- **Remembering skipped FKs in `_orglet`:** forbidden by D-02; the catalog is the state.
- **`NOT VALID` FKs:** forbidden (Phase 3).
- **Letting `IF NOT EXISTS` be the idempotence mechanism:** the success criterion is on `statements`, not on database state.
- **Keeping a try/catch around `ADD CONSTRAINT`:** a failed statement poisons the whole transaction on Postgres.
- **Inventing a prefix for a null-prefix object** (for example deriving from the name or reusing `a00`-style slots): forbidden by D-08.
- **Adding `if (usingPglite)` branches in production code:** forbidden (Phase 1 D-19..D-21).
- **Hand-editing `packages/sigha/src` to make red tests green:** forbidden (D-19).

## Nullable key prefix: consumer inventory (verified by `grep keyPrefix`)

| Site (file:line) | Today | Required change |
|---|---|---|
| `metadata/src/types.ts:179` (`SObjectDef.keyPrefix`) and `:247` (`StandardObjectJson.keyPrefix`) | `string` | `string \| null`; add optional `keyPrefixSource?: KeyPrefixSource` to `StandardObjectJson` (and to `SObjectDef` if describe/tests should see it; optional to keep the 35 files valid) |
| `metadata/src/build.ts:36-52` `loadBaseline` | no validation | add `validateBaseline(objects)`: reject `keyPrefix === null && createable !== false` (note `createable` defaults to `true` at `build.ts:222-228`, so an omitted flag is also an error), reject non-null prefixes not matching `/^[0-9A-Za-z]{3}$/`, duplicates among non-null prefixes, prefixes inside `a00..azz` (custom range, produced by `customKeyPrefix` `build.ts:420-426`), and unknown `keyPrefixSource` values. Throw `Error` (hard error, D-10). |
| `metadata/src/build.ts:222` `fromStandardObject` | `keyPrefix: j.keyPrefix` | passes null through; carry `keyPrefixSource` |
| `metadata/src/build.ts:386-396` `fromSourceObject(obj, keyPrefix: string, ...)` | custom objects, always string | unchanged (custom objects always get a provisional prefix) |
| `metadata/src/build.ts:486-494` reference-target warning | checks `objects.has(ref)` only | no change needed: a null-prefix object is in `objects`, so no `UNSUPPORTED:reference-target`; add a test (success criterion 4) |
| `schema/src/ids.ts:50-52` `matchTargetByPrefix<T extends { readonly keyPrefix: string }>` | requires string | widen to `{ readonly keyPrefix: string \| null }`; `t.keyPrefix === prefix` is already false for null, which gives "never a candidate" for free, but add an explicit comment/test |
| `schema/src/ids.ts:78-79` `generateId(keyPrefix: string)` | throws on invalid | keep `string`; callers must narrow. Do not accept null here, so the compiler forces every caller to decide |
| `schema/src/prefixes.ts:251` standard list `{ name, keyPrefix: o.keyPrefix }` and `:36` input type, `:104` `taken.set(s.keyPrefix, ...)` | string | filter `o.keyPrefix !== null` into the `taken` map input (a null object claims nothing) |
| `schema/src/prefixes.ts:284-285` `obj.keyPrefix = value` | custom objects only | unchanged |
| `engine/src/engine.ts:379` `keyPrefixOf(given) !== obj.keyPrefix` (insert with supplied Id, import mode) | string compare | **null branch required** (Pitfall 3): when `obj.keyPrefix === null`, skip the prefix equality but still require a well-formed Id |
| `engine/src/engine.ts:414` `attachOld` | string compare | same null branch (update/delete/undelete of rows in a null-prefix object) |
| `engine/src/engine.ts:435` `generateId(obj.keyPrefix)` | string | when null: error, never mint (`Errors.requiredMissing(["Id"])` is an existing factory; unreachable outside import mode because `createable: false` blocks first) |
| `engine/src/engine.ts:~688-692` `checkReferences` + `matchTargetByPrefix(targets, id)` | target list comes from `referenceTo` | a null-prefix target is simply never matched; if a field's `referenceTo` is single-target and the target has null prefix, behaviour must not regress to `INVALID_CROSS_REFERENCE_KEY` for valid Ids: see Pitfall 4 |
| `engine/src/bootstrap.ts:58,59,60,100,105,118` `generateId(x.keyPrefix)` | string | these are fixed seed objects (Organization, Profile, User, BusinessHours, UserLicense, RecordType) whose prefixes must stay non-null; use `need()`-style narrowing helper that throws a clear error if null |
| `engine/src/parents.ts:37` `matchTargetByPrefix(rel.targets, id)` | string | covered by the widened signature |
| `soql/src/compile.ts:164-165` `polyTargets = targets.map(t => ({..., prefix: t.keyPrefix}))` and the join `left(fk,3) = '${t.prefix}'` | string | `targets.filter((t): t is ... & {keyPrefix: string} => t.keyPrefix !== null)` before building; never emit `= 'null'`. Check `PolyTarget` type and `soql/src/typeof.ts` / `polymorphic.ts` (no direct `keyPrefix` use per grep, but TYPEOF CASE is built from `polyTargets`) |
| `soql/src/shape.ts:33,63` `keyPrefixOf(fk)` | Id -> prefix for the unmodelled-prefix callback | unchanged |
| `api/src/describe.ts:197` `keyPrefix: obj.keyPrefix` | string | emits `null` as is (D-09); verify the describe typing accepts null; global describe lists the object |
| `api/src/routes/composite.ts:102` `o.keyPrefix === id.slice(0,3)` | string | null never equals a 3-char string, so unmatched Ids already fall to `MALFORMED_ID`; compiles after the type change, add no code unless lint complains |
| `cli/src/main.ts:79` | prints custom objects' prefix | custom only; unchanged |
| `conformance/describe-check/{sf_describe.py,jsforce.mjs}` | reference `keyPrefix` | read only; check that they do not assume a string for objects in their list (none of the 35 is null today) |

The Phase 4 rule "an unmodelled prefix is a null parent" (D-07/D-19) is unaffected.

### Test object for the null case (D-12)
A baseline-shaped dir `packages/metadata/test/fixtures/null-prefix/{objects/Thing.json,standardValueSets.json}`: copy the real `standardValueSets.json`, plus one object with `"keyPrefix": null, "keyPrefixSource": "unverified", "createable": false, "hasOwner": false`, a Name field, and optionally a lookup from a small second object to it. Load via `loadBaseline(dir)` + `buildOrgSchema` (as `migrate.test.ts` already does with filtered baselines), no loader option needed. Because it needs the standard bootstrap seeds, simplest is a *combined* baseline: `{ ...realBaseline, objects: [...realBaseline.objects, nullPrefixObject] }` built in the test, so only the one JSON file lives in the fixture dir and is read with a `readFile`+`JSON.parse` or via `loadBaseline` on the dir and concatenation. Assertions for success criterion 4: schema has the object; `buildOrgSchema(...).warnings` has no `reference-target` for it; describe route/shape returns `keyPrefix: null`; `reconcileKeyPrefixes` completes and assigns custom prefixes without collision; `matchTargetByPrefix([nullObj, user], anyId)` never returns the null object; `engine.insert` returns `INVALID_TYPE_FOR_OPERATION`; an `importMode` engine accepts a well-formed supplied Id.

## Upgrade test design (MIGR-01)

**Fixture source (recommendation, consistent with D-05):** `git archive 1b737c12d8d10408fe5713a37d4d92557209f229 packages/metadata/standard | tar -x` then move into `packages/metadata/test/fixtures/baseline-v1.0/` (35 files in `objects/` + `standardValueSets.json`; `standard/README.md` need not be copied). There is **no git tag** for v1.0 (`git tag` is empty). The v1.0 completion commit is `1b737c1` (`chore: complete v1.0 milestone`, full SHA above). `git diff --stat 1b737c1 HEAD -- packages/metadata/standard` is empty, so the snapshot equals the current baseline today. Record that SHA in the fixture README; do not create a tag (a tag is a ref that would need pushing, an outward-facing action). Add a guard test that fails if any file in the fixture is modified? A cheap invariant is a sha256 manifest in the README checked by the test, but that is optional; the README rule plus review is what D-05 asks for.

**Flow (all through real code paths):**
1. `loadBaseline(FIXTURE_V1)` + `loadOrgSchema`-equivalent: `buildOrgSchema(baseline, await readSourceProject(ACME))` (this is what `query.test.ts` already does, line 4). No loader option is needed because `loadBaseline(dir)` already takes a directory (`build.ts:36`); only add `baselineDir` to `LoadOptions` (`metadata/src/index.ts:13-22`) if the planner wants the CLI/`loadOrgSchema` path used. Not required.
2. `reconcileKeyPrefixes` + `migrate` + `bootstrapOrg` in a fresh `test_<hex>` schema with the v1.0 schema. This mirrors `up` (`cli/src/main.ts:114-128`): reconcile -> migrate -> bootstrap. `main.ts` does not export `up` (only `main(argv)`, line 181, and `up` starts a server), so the test composes the same three calls. Mention in the test header that it mirrors `up`.
3. Populate: `new DmlEngine(pool, schemaV1, { orgSchema })` insert a Group (`Name`, `DeveloperName`, `Type: "Queue"`) and a Group-owned Case (`OwnerId: groupId`), as in `query.test.ts:~137-139`; plus a second engine with `importMode: true` inserting rows with their own `Id`, audit fields, and (to make the later FK interesting in future phases) a lookup value; keep rows realistic (Account/Contact/Case from ACME).
4. Capture a content snapshot of every populated table (`SELECT * ... ORDER BY id`), then call `reconcileKeyPrefixes` + `migrate` again with the **current** schema (`loadBaseline()` default dir). In Phase 8 the two baselines are identical, so the expected result is: `warnings` equals `[]` (an explicit `toEqual([])` against a named `EXPECTED_WARNINGS` constant, which Phase 9 extends), `statements` contains no `CREATE`/`ALTER ... ADD`/`DROP`, and every captured row is byte-identical.
5. Second `migrate` returns `warnings: []` and `statements.filter(s => /^CREATE (UNIQUE )?INDEX|^CREATE SEQUENCE/.test(s))` is empty (and in fact `statements` is only `CREATE SCHEMA IF NOT EXISTS`; consider also guarding that one: it is a statement that runs every time, harmless but visible; the criterion only names `CREATE INDEX`, so leave it unless the planner wants "no statements except CREATE SCHEMA").

Note `STATE`/D-07: "the contract for Phases 9-13": structure the test with `EXPECTED_WARNINGS` as an array constant and a helper that builds the "old" org, so Phase 9 only changes the target baseline and the expected list.

**Existing test to rewrite (D-03):** `migrate.test.ts` "thin: an upgrade whose new foreign key meets a dangling Id fails..." (lines ~148-175, uses `before`/`after` schemas built by filtering the 14 thin objects out of the baseline and a raw `INSERT` with `SET LOCAL session_replication_role = replica`). Rewrite to: `migrate(after)` resolves; `warnings` equals the exact `UNSUPPORTED:schema-fk` list (one per violating column; here `case.businesshoursid`); `statements` contains no `fk_case_businesshoursid`; the row is still there; the `businesshours` table **exists** (the old test asserted it did not, because of rollback); a follow-up: delete the dangling value (test setup, not migrate) and `migrate` again adds the FK silently (D-02). The raw INSERT in this pre-existing test is a legitimate exception to D-06 (D-06 governs the new upgrade test; this one needs an Id with no parent, which only replica mode can create; keep it).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Existing index/sequence detection | Per-statement `IF NOT EXISTS` plus filtering | One `pg_indexes` / `pg_sequences` read | Success criterion is on executed statements |
| FK violation detection | Parsing 23503 error text | `count(*) ... NOT EXISTS` pre-check | A failed statement aborts the transaction; the count names all offenders |
| Test database | Docker-only setup | `openTestDb()` from `test/db.ts` | Already supports pglite and Postgres via one switch |
| Warning text | Per-site template strings alongside records | `formatDiagnostic` | One source of truth (D-14) |
| v1.0 baseline provenance | Runtime `git show` | Committed snapshot (D-05) | Works in shallow checkouts, cannot drift |
| Known-upstream-gap marker | `it.skip` / commented tests | `it.fails` (documented in TESTING.md) | Flips to a failure when the gap closes |

## Common Pitfalls

### Pitfall 1: `it.fails` on a test that already passes
**What goes wrong:** The suite goes red immediately. D-20 lists `x != y` and `!`/`:` inside string literals, but a probe in this repo (compileFormula against the loaded baseline) showed:
- `Name != 'x'` compiles OK; `Name = 'a!b:c'` compiles OK (the colon-detection regex strips string literals, `compile.ts:173`).
- `!ISBLANK(Name)` fails: `Syntax error in formula: Unexpected '!'.` (sigha lexer `unexpectedBang`, `packages/sigha/src/syntax/lexer.ts:~421-430`).
- `Owner:User.Email`, `Owner:Group.Name`, `Owner:Queue.Name` (on Case) fail with `UNSUPPORTED:formula polymorphic reference ...`.

**How to avoid:** Write guards for `!=` and string-literal cases as ordinary `it(...)` (they pass today and must keep passing across the Phase 12 resync; this is the S2 regression guard). Use `it.fails` only for `!ISBLANK(x)` and the three colon cases, asserting the *correct* future behaviour (compiles; `references` contains the right keys), not the present error. For colon cases the assertion should be on successful compile and on resolving against the named target (for example `Owner:Group.Name` references `Group.Name`, `Owner:User.Email` references a User field); Phase 12 defines the exact reference-key shape, so keep assertions to "compiles without throwing" plus `parentPaths`/`references` non-empty to avoid pinning a key format Phase 12 may choose differently. Document the `it.fails` pattern in `.planning/codebase/TESTING.md` (~line 82, next to the "no static skips" rule). Keep D-21 tests unchanged.
**Warning signs:** `pnpm test` red on a brand-new test with no code change.

### Pitfall 2: `sync-sigha.sh` rewrites `VENDOR.md`, wiping the upstream-PR section
**What goes wrong:** `scripts/sync-sigha.sh:43-53` generates `VENDOR.md` from a heredoc on every sync. A hand-added "Pending upstream changes" / PR-links section disappears on the next sync (including Phase 12's).
**How to avoid:** Before `rm -rf "$DEST/src"`, save the existing section (`sed -n '/^## Upstream changes/,$p' "$DEST/VENDOR.md"` into a temp file) and append it after the heredoc, or hold the section in a tracked sibling file the heredoc `cat`s in. Pick one and test it by running the script twice (VENDOR.md section survives both). Format suggestion for `packages/sigha/VENDOR.md`: `## Upstream changes` with a table `| Change | Branch / PR | Status |` for the `!` fix and the colon fix; PR links replace "pending" once Johan opens them. The existing heredoc must not claim "Behaviour changes belong upstream" and then contradict itself; keep that sentence.

### Pitfall 3: Import mode and null-prefix objects (gap between D-10 and the engine)
**What goes wrong:** `engine.ts:379` (insert with a supplied Id) and `:414` (`attachOld`) reject any Id whose prefix differs from `obj.keyPrefix`; for a null prefix that is always, so import mode returns `MALFORMED_ID` for every row, contradicting D-10's "import mode works unchanged".
**How to avoid:** One small, explicit branch: when `obj.keyPrefix === null`, accept any Id that `normalizeId`/the existing malformed-Id check accepts and skip only the prefix-equality test; when no Id is supplied and the prefix is null, push an error instead of calling `generateId`. This is a necessary part of D-08, not a new feature; add a test with the import-mode engine. Do not generalise beyond these three lines.

### Pitfall 4: Single-target lookup to a null-prefix object
**What goes wrong:** `checkReferences` (`engine.ts:~681-700`) uses `matchTargetByPrefix(targets, id)` even for single-target lookups; with a null-prefix target it matches nothing, and because `targets.length === referenceTo.length` it then pushes `INVALID_CROSS_REFERENCE_KEY` for a perfectly valid Id.
**How to avoid:** In `checkReferences`, when the field has exactly one target, use that target directly if its `keyPrefix` is null (prefix cannot be checked), otherwise keep the current rule. The same applies anywhere a single-target path calls `matchTargetByPrefix` (`parents.ts:37` for single-target relationships). Write a test: lookup to the null-prefix object accepts a real Id. If the planner judges lookups to null-prefix objects out of scope for Phase 8, the fallback is to document it as an Open Question; the success criteria require only load, describe, `check`, and exclusion from polymorphic matching.

### Pitfall 5: Quoted identifiers and truncated names in the catalog diff
**What goes wrong:** `identifier()` (`columns.ts:13-17`) truncates names over 63 chars with a hash suffix; the catalog stores the truncated name. Comparing planned `ix.name` (already passed through `identifier()` in `planTable`) to `pg_indexes.indexname` works, but comparing a raw un-truncated string would not.
**How to avoid:** Compare `ix.name` exactly as planned (already truncated). Two planned objects can collide after truncation; `Set.add` after create covers it.

### Pitfall 6: Roll-up backfill must stay last
**What goes wrong:** Adding the FK pre-check or any write after step 3 triggers "pending trigger events" on Postgres.
**How to avoid:** Keep the new code inside step 2, before the backfill loop (`migrate.ts:179-183`). The pre-check is a SELECT only.

### Pitfall 7: pglite and Postgres drift for catalog views
**What goes wrong:** A catalog query that works on Postgres 16 behaves differently on pglite.
**How to avoid:** `pg_constraint` and `information_schema` are proven (`pglite-compat.test.ts`). Extend that file with one test that `pg_indexes` and `pg_sequences` return the expected names on both backends, run first in the wave. Do not add production workarounds if one fails; per Phase 1 D-19..D-21 the answer would be a different catalog query used on both backends.

### Pitfall 8: Diagnostics changing warning order or text
**What goes wrong:** Warnings are asserted with `toEqual` in many tests (build, migrate, prefixes, formulas); deriving them from diagnostics in a different order, or trimming nested prefixes, breaks them.
**How to avoid:** Preserve push order; derive `warnings` from `diagnostics` in the same order (or push both in one helper). Run the whole suite after threading each source.

### Pitfall 9: Name clash and barrel rules
`Diagnostic` exists in `@orglet/sigha` (`syntax/diagnostic.ts:68`) and is used in `formula/compile.ts`. `@orglet/metadata` re-exports its types through `export * from "./types.js"`; add `diagnostics.ts` exports explicitly (value `formatDiagnostic` and `export type {...}` separately) per CLAUDE.md barrel convention. `consistent-type-imports` is an error.

## Code Examples

### Sync script: portable sed (verified)
Verified in this research on macOS (BSD sed): a copy of `scripts/sync-sigha.sh` with `DEST=${SIGHA_DEST:-packages/sigha}`, both `sed -i ''` replaced by `sed -i.bak`, and `find "$DEST/src" -name '*.bak' -delete` before the final echo, run against pinned rev `2abe5dbb3ca0ab17b7aa1443024562041336ca5f` into a scratch directory, produced output **byte-identical** to the committed `packages/sigha/{src,corpus,LICENSE,NOTICE}` (only `VENDOR.md`'s `Synced:` date differed). `sed -i.bak ... ` is accepted by GNU sed with the same meaning, so no OS branching is needed. The lines to change are `sync-sigha.sh:38` (the `import Decimal` rewrite) and `:40` (the `.ts"` -> `.js"` rewrite; note it uses `-E`, which both implementations accept; with `-i.bak -E` order is fine).
```bash
find "$DEST/src" -name '*.ts' -exec sed -i.bak 's#^import Decimal from "decimal.js";#import { Decimal } from "decimal.js";#' {} \;
find "$DEST/src" -name '*.ts' -exec sed -i.bak -E 's#(from "\.{1,2}/[^"]+)\.ts"#\1.js"#g' {} \;
find "$DEST/src" -name '*.bak' -delete
```
Also add: `trap 'rm -rf "$CLONE"' EXIT` only when the script created the clone (set a flag; do not delete a caller-supplied local clone directory), and `DEST=${SIGHA_DEST:-packages/sigha}`. The script `cd`s to the repo root and `rm -rf "$DEST/src" "$DEST/corpus"`, so with `SIGHA_DEST` pointing at a throwaway dir it never touches the vendored copy.

### CI exercise on Linux without rewriting the vendored copy (D-17)
New job in `.github/workflows/ci.yml` (existing jobs: `test-pglite`, `test-postgres`, `conformance`; actions pinned at `checkout@v7`, `setup-node@v7`):
```yaml
  sigha-sync-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: |
          REV=$(sed -n 's/^Revision: //p' packages/sigha/VENDOR.md)
          SIGHA_DEST="$RUNNER_TEMP/sigha" scripts/sync-sigha.sh "$REV"
          diff -r packages/sigha/src "$RUNNER_TEMP/sigha/src"
          diff -r packages/sigha/corpus "$RUNNER_TEMP/sigha/corpus"
          diff packages/sigha/LICENSE "$RUNNER_TEMP/sigha/LICENSE"
```
This proves the script runs on GNU userland and that the vendored copy is exactly reproducible from the recorded revision (a stronger check than "the script exits 0"). It needs network (clones GitHub) like `conformance` already does. It does not violate Phase 1 D-18: nothing under `packages/sigha` is written. Bash `git` is on the runner; `node`/`pnpm` are not needed.

### `it.fails` shape (vitest 3.2.7)
```ts
// Known upstream gap (rfaulhaber/sigha has no unary `!`); flips to a failure when the Phase 12 resync fixes it.
it.fails("unary ! negates its operand like NOT()", () => {
  expect(() => rule("!ISBLANK(Name)")).not.toThrow();
});
```
Existing formula test helpers (`packages/formula/src/formula.test.ts:1-28`): `rule(source, objectName)`, `field(...)`, `run(...)` against `ACME` via `loadOrgSchema({ projectDir: ACME })`. Put the new cases in the same file (or a sibling `expectations.test.ts` importing the same helpers copy), same style.

### Upstream sigha fix (D-18, D-19)
Smallest upstream changes are specified in `.planning/research/STACK.md` §sigha (lines ~110-120): `!` -> lexer `operator` token when not followed by `=`, `UnaryOperator` gains `"!"`, `parseUnary` accepts it, evaluator maps it to `NOT`, formatter/analysis exhaustive switches updated (the compiler will list them); colon -> in `scanIdentifier`, after the identifier run, if `peek()===":"` and `isIdentStart(peek(1))`, absorb `:` plus next identifier run so `Owner:User` is a single identifier token (zero parser/AST change). Test cases from the BSD-3 `salesforce/formula-engine` grammar (`Formula.g4`: `BANG unaryExpression`; `COLON`), never from an org. Work in a clone **outside** the repo (for example `~/Development.nosync/sigha-upstream`). Checkpoints (ask Johan, wait for OK): `gh repo fork rfaulhaber/sigha --clone=false` (account `snorf` is the authenticated gh account; the fork does not exist yet), then `git push` of the branch to the fork. Claude never runs `gh pr create`; Johan opens the PR(s); then `VENDOR.md` "Upstream changes" is updated with the links (a manual checkpoint with Johan, so this plan task cannot fully complete autonomously: mark the PR-link step `human-action`).
Note `org-verified.json` in the vendored corpus (research SUMMARY legal flag) is outside this phase's scope.

## Group-owned audit (D-22): scout results to seed `08-GROUP-OWNED-AUDIT.md`

Grep for `Group|00G|Queue` across `packages/**` (excluding sigha vendored code, node_modules, dist) and `conformance/**` (excluding `.venv`, `.cache`). File-level hit counts; the audit task must record exact line ranges and the nature of each reliance (DB row / literal Id / describe shape / comment). Seeds, with line numbers already found:

| File | Reliance | Lines / count |
|---|---|---|
| `packages/engine/src/query.test.ts` | DB rows: Group (Type Queue) + Group-owned Case, owner joins, `Owner.Type`, TYPEOF | 29 hits, setup at ~137-139 |
| `packages/engine/src/engine.test.ts` | DB row: Group insert, `Owner` parent load | 351, 361 |
| `packages/api/src/api.test.ts` | describe shape (`OwnerId.referenceTo: ["User","Group"]`) and REST rows | 173; 427-439 |
| `packages/schema/src/ids.test.ts` | literal prefix `00G` / `generateId("00G")` | 80-88 |
| `packages/soql/src/shape.test.ts` | literal Id `00G000000000001AAA`, `Group` branch of TYPEOF shape | 11 hits, line 7 |
| `packages/soql/src/compile.test.ts` | SQL for polymorphic joins/CASE over `Group` | 12 hits, from ~35 |
| `packages/formula/src/formula.test.ts` | colon syntax `Owner:Group.Name`, `Owner.Alias` rejection | 43, 49-50 |
| `packages/schema/src/migrate.test.ts` | comment/assert: no FK on polymorphic `fk_account_ownerid` | 74 |
| `conformance/poly-check/{jsforce.mjs,sf_poly.py,README.md}` | live REST: creates a Queue (Group), Group-owned and User-owned Case; asserts `Owner.Type`, `TYPEOF Owner` | `sf_poly.py` 3, 44, 60, 69, 74, 79-81, 109 |
| `conformance/describe-check/*` | `keyPrefix`/`referenceTo` of OwnerId in describe comparison (verify) | grep `keyPrefix` hits both files |
| `packages/engine/src/engine.ts` | **stale comment** "Unknown target object (e.g. Group): accept unchecked" | ~692 (Group is modelled now) |
| `packages/engine/src/parents.ts` | comment describing Group-owned parent load | ~34 |
| `packages/metadata/src/build.ts` | `owner.referenceTo = ["User", "Group"]` (the line Phase 9 narrows) | 115 |
| `packages/metadata/src/types.ts` | doc comment on `hasOwner` | 187 |
| `packages/formula/src/compile.ts` | comment on polymorphic traversal | 97 |
| `packages/soql/src/compile.ts`, `polymorphic.ts` | comments on Group.Email / Owner.Type | `compile.ts` 210, `polymorphic.ts` 5 |

Suggested layout: one table per category (tests that need DB rows; tests with literal Ids; describe-shape assertions; conformance legs; comments/stale text; production code that encodes the polymorphism), with columns `file | lines | relies on | Phase 9 disposition (stays / moves to Case or Lead / expect INVALID_CROSS_REFERENCE_KEY / n.a.)`. The disposition column may stay empty (that is Phase 9's decision); fill "relies on" now. Cross-check the list with two greps in the verification step so it is complete: `grep -rnE "\bGroup\b|00G|Queue" packages conformance examples ...` with the same exclusions, and confirm every file with a hit has a row.

## Runtime State Inventory

Not a rename phase. Closest concern is runtime state that a migration could touch:

| Category | Items Found | Action Required |
|---|---|---|
| Stored data | Org schema tables in Postgres (`test_<hex>` in tests); `_orglet.key_prefixes` (custom prefixes, persisted, never removed by `up`, Phase 2 D-13) | None to migrate. Tests must prove persisted custom prefixes never collide with a null/standard prefix (D-12). |
| Live service config | None | None |
| OS-registered state | None | None |
| Secrets/env vars | `ORGLET_DATABASE_URL` selects backend (existing) | None |
| Build artifacts | `packages/*/dist` (tsc -b output) | `pnpm build` after type changes; CI builds before tests |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---|---|---|---|
| FK add aborts `up` with a thrown Error (`migrate.ts:157-171`) | Pre-check, skip, warn `UNSUPPORTED:schema-fk` | This phase | Upgrade never aborts on dirty `--import` data |
| Index/sequence statements every `up` | Catalog diff, skip | This phase | Second `up` is silent |
| `keyPrefix: string` everywhere | `string \| null` + `keyPrefixSource` | This phase | Prefix-less standard objects can enter the baseline in Phase 9/10 |

## Open Questions

1. **Single-target lookup to a null-prefix object (Pitfall 4).**
   - Known: D-08 only requires exclusion from polymorphic matching; `checkReferences`/`parents.ts` use `matchTargetByPrefix` for all lookups.
   - Unclear: whether Phase 8 should make valid lookups to a null-prefix object succeed.
   - Recommendation: do it (about five lines plus one test); it is the only way a null-prefix object is truly "first class" and it is cheap now, costly to discover in Phase 10.
2. **Custom-metadata `m0x` prefix wording in D-12.** The exact reserved range for custom metadata types is not defined anywhere in the repo; research could only confirm the `a00..azz` custom range (`customKeyPrefix`, `build.ts:420-426`). Recommendation: assert "no baseline prefix starts with `m0`" as a conservative guard, with a comment pointing to the v1.1 PITFALLS C-series (custom metadata Phase 11); the planner should confirm the intended rule with Johan if it matters beyond Phase 11.
3. **`statements` containing `CREATE SCHEMA IF NOT EXISTS` on every run.** Criterion 3 names only `CREATE INDEX`. Recommendation: leave as is.
4. **Whether `keyPrefixSource` should also live on `SObjectDef` (for describe/debug).** Recommendation: yes, optional, so Phase 9's generator output and Phase 14's report can read it; costs one field.
5. **Which Postgres the new upgrade test is expected to run on locally.** CI covers both backends (`test-pglite` and `test-postgres`); locally Postgres needs `pnpm db:up` and `ORGLET_DATABASE_URL`. Not a blocker.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 22 | build/test | Shell default is Node v18.20.8 (`.nvmrc` pins 22) | 18.20.8 on PATH | `nvm use` 22 before running anything; do not assume the default shell works |
| pnpm | all scripts | Not on PATH in the research shell | - | `corepack enable pnpm` (packageManager `pnpm@12.6.0`) |
| Docker | Postgres 16 backend (`pnpm db:up`) | Yes | 29.7.2 | pglite default needs no Docker |
| git / gh | fixture snapshot, fork checkpoint | Yes / gh 2.102.0, authenticated as `snorf` | - | - |
| Network (GitHub clone) | sync-script CI check, upstream work | Yes (verified: cloned rfaulhaber/sigha at the pinned rev) | - | - |
| `@electric-sql/pglite` | tests | Already devDependency (0.5.8) | 0.5.8 | - |

**Missing dependencies with no fallback:** none. A probe test (`vitest run`) did execute under the research shell, but the planner should state `nvm use` / `corepack enable` in task verification steps to avoid Node-version surprises.

## Validation Architecture

(`workflow.nyquist_validation` is `true` in `.planning/config.json`.)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.7 (single root config `vitest.config.ts`, include `packages/*/src/**/*.test.ts` and `packages/*/test/**/*.test.ts`) |
| Config file | `/Users/johankarlsteen/Development.nosync/local-salesforce/vitest.config.ts` |
| Quick run command | `pnpm vitest run packages/schema/src/migrate.test.ts packages/schema/src/upgrade.test.ts` (pglite, no Docker) |
| Full suite command | `pnpm build && pnpm lint && pnpm test` (pglite); with Postgres: `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` after `pnpm db:up` |

### Phase Requirements -> Test Map
| Req / Criterion | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| MIGR-01 / SC1 | v1.0-baseline DB with Group-owned and `--import` rows survives `up` with current code on pglite and Postgres 16; exact warning set `[]` | integration | `pnpm vitest run packages/schema/src/upgrade.test.ts` and the same with `ORGLET_DATABASE_URL` set | Wave 0 (new) + fixture dir |
| MIGR-02 / SC2 | FK violation yields one `UNSUPPORTED:schema-fk` per column (table, column, count), rows intact, no abort; FK added silently after rows fixed | integration | `pnpm vitest run packages/schema/src/migrate.test.ts -t "foreign key"` | exists (rewrite ~148-175) |
| MIGR-04 / SC3 | Second `migrate` returns `warnings: []`, no `CREATE INDEX`/`CREATE SEQUENCE` in `statements` | integration | `pnpm vitest run packages/schema/src/upgrade.test.ts -t "second"` plus an assertion added to the existing "idempotent re-run" test in `migrate.test.ts` | partly exists |
| BASE2-05 / SC4 | Null-prefix object loads, in describe with `keyPrefix: null`, accepted by `check` (no `reference-target`), excluded from `matchTargetByPrefix` and SOQL poly joins, create -> `INVALID_TYPE_FOR_OPERATION`, import accepts Id; loader rejects `null` + `createable: true`; prefix uniqueness/range guards | unit + integration | `pnpm vitest run packages/metadata packages/schema/src/ids.test.ts packages/engine packages/soql packages/api` | extend `build.test.ts`, `ids.test.ts`, `engine.test.ts`, `compile.test.ts`, `api.test.ts` (Wave 0 for fixture) |
| SC5a | `Diagnostic`/`SkippedItem`/`FormulaFailure` exist beside unchanged warning strings; formatter equals old string for every area in use | unit | `pnpm vitest run packages/metadata/src/diagnostics.test.ts` plus per-package assertions (schema, engine, formula) | Wave 0 (new) |
| SC5b | `scripts/sync-sigha.sh` runs on Linux with no BSD-only `sed` | CI job | `sigha-sync-check` job; locally `grep -n "sed -i ''" scripts/sync-sigha.sh` returns nothing, and `SIGHA_DEST=<tmp> scripts/sync-sigha.sh <rev> && diff -r ...` | Wave 0 (CI job new) |
| SC5c | Red expectation tests for `!`, colon exist; `!=` and string-literal cases pass as guards | unit | `pnpm vitest run packages/formula` (all pass; `it.fails` ones count as passing while the gap exists) | Wave 0 (new cases) |
| SC5d | Upstream PR links (or "Pending upstream changes") recorded in `packages/sigha/VENDOR.md`; survives a re-sync | manual + script | `grep -n "Upstream changes" packages/sigha/VENDOR.md`; run sync twice into scratch and confirm the section persists | manual (PR creation is Johan's) |
| SC5e | Group-owned audit list committed | review | `test -s .planning/phases/08-upgrade-safety-net-nullable-key-prefixes/08-GROUP-OWNED-AUDIT.md` plus the completeness grep documented in the file | Wave 0 (new) |
| Regression | All existing warning `toEqual` tests unchanged | full suite | `pnpm test` (both backends) | exists |

### Sampling Rate
- **Per task commit:** the narrowest relevant `pnpm vitest run <files>` above, plus `pnpm build` when types change (the nullable-prefix wave needs `tsc -b` first because the compiler enumerates the consumers).
- **Per wave merge:** `pnpm build && pnpm lint && pnpm test` on pglite; the upgrade test and the rewritten FK test additionally with `ORGLET_DATABASE_URL` (`pnpm db:up`).
- **Phase gate:** full suite green on both backends, `conformance/run-all.sh` unchanged-green if Docker/Python are available (describe-check touches `keyPrefix`), and the CI jobs `test-pglite`, `test-postgres`, `conformance`, `sigha-sync-check` green, before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `packages/metadata/test/fixtures/baseline-v1.0/` (35 object JSONs + `standardValueSets.json` + README with the SHA `1b737c12d8d10408fe5713a37d4d92557209f229`) - MIGR-01
- [ ] `packages/schema/src/upgrade.test.ts` - MIGR-01, MIGR-04
- [ ] `packages/metadata/test/fixtures/null-prefix/objects/<Thing>.json` - BASE2-05
- [ ] `packages/metadata/src/diagnostics.ts` and `diagnostics.test.ts` - SC5a
- [ ] `pglite-compat.test.ts`: add `pg_indexes` / `pg_sequences` check - MIGR-04
- [ ] `ci.yml`: `sigha-sync-check` job; `sync-sigha.sh` edits (`SIGHA_DEST`, `sed -i.bak`, `trap`, VENDOR section carry-over)
- [ ] formula expectation cases (4 `it.fails`, 2+ guard `it`) and TESTING.md note
- [ ] No framework install needed.

## Sources

### Primary (HIGH confidence; read or run in this repository)
- `packages/schema/src/migrate.ts` (full), `ddl.ts` (planTable, foreignKeySql, indexSql, sequenceSql), `columns.ts` (`identifier`), `prefixes.ts` (planner, `reconcileKeyPrefixes`), `ids.ts`
- `packages/schema/src/migrate.test.ts` (FK abort test ~148-175, `before`/`after` filtering pattern), `pglite-compat.test.ts`, `test/db.ts`, `vitest.config.ts`, `.github/workflows/ci.yml`
- `packages/metadata/src/{build,types,index}.ts`, `packages/metadata/standard/README.md`, `git diff 1b737c1 HEAD -- packages/metadata/standard` (empty)
- `packages/engine/src/{engine,bootstrap,parents,formulas}.ts`, `packages/soql/src/compile.ts`, `packages/api/src/{describe.ts,routes/composite.ts}`, `packages/cli/src/main.ts`
- `packages/formula/src/{compile.ts,formula.test.ts}`, probe run of `compileFormula` for `!=`, string literals, `!ISBLANK`, `Owner:User|Group|Queue` (results in Pitfall 1)
- `scripts/sync-sigha.sh`, `packages/sigha/VENDOR.md`, `packages/sigha/src/syntax/lexer.ts`, and a scratch run of a portable `sed -i.bak` variant against the pinned rev with `diff -r` against the vendored tree (identical except `Synced:` date)
- `git log`/`git tag` (no tags; `1b737c1` = `chore: complete v1.0 milestone`)
- `.planning/research/{STACK,ARCHITECTURE,PITFALLS}.md` (sigha change spec, diagnostics proposal, B3/M1/M2/S1/S2/O1)
- `.planning/codebase/{TESTING,CONVENTIONS,CONCERNS}.md` as cited in CONTEXT.md

### Secondary / Tertiary
- None. No external web sources were needed; Postgres catalog views (`pg_indexes`, `pg_sequences`) are standard and flagged for verification on pglite (Pitfall 7).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies; versions read from package.json/lockfile.
- Architecture (migrate, nullable prefixes, diagnostics): HIGH for the code sites (read directly); MEDIUM for `pg_indexes`/`pg_sequences` on pglite until the compat test runs.
- Pitfalls: HIGH for 1-3, 5, 6, 8, 9 (verified by probe or code reading); MEDIUM for 4 and 7 (reasoned from code, not executed).
- Group-owned audit seeds: MEDIUM - file-level scout, line ranges still to be confirmed during the audit task.

**Research date:** 2026-10-13
**Valid until:** 2026-11-12 (stable; invalidated if any baseline or `migrate.ts` change lands first)
