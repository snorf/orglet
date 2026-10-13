# Phase 8: Upgrade Safety Net & Nullable Key Prefixes - Context

**Gathered:** 2026-10-13
**Status:** Ready for planning

<domain>
## Phase Boundary

A database created by v1.0 can be upgraded by any later baseline change without data loss or an
aborted `orglet up`, and a standard object without a confirmed key prefix is a first-class citizen.
Concretely: a populated-database upgrade test (pglite + Postgres 16), FK violations downgraded to
`UNSUPPORTED:schema-fk` warnings, an idempotent second `up` (no `CREATE INDEX` for existing
indexes), `keyPrefix: string | null` with a source label, structured diagnostic records beside the
unchanged warning strings, a portable `scripts/sync-sigha.sh`, red expectation tests for `!` and
colon syntax, the upstream sigha fix prepared and its PR links recorded in `VENDOR.md`, and a
Group-owned test audit list for Phase 9.

Out of scope (later phases): the baseline generator and OwnerId narrowing (Phase 9), new business
objects (Phase 10), the sigha resync itself and colon/`!` evaluation (Phase 12), the check report
renderer (Phase 14). The pending todos "colon syntax" and "narrow OwnerId" were reviewed and stay
with Phases 12 and 9 respectively; Phase 8 only lays their groundwork.

</domain>

<decisions>
## Implementation Decisions

### FK violations and the upgrade safety net
- **D-01:** When a planned single-target lookup FK would be violated by existing rows, `migrate()`
  skips that FK, pushes one `UNSUPPORTED:schema-fk` warning per column naming table, column and
  offending row count, and completes. It never deletes or rewrites rows. `NOT VALID` stays
  excluded (Phase 3 decision).
- **D-02:** The skip is re-evaluated on every `up`, not remembered. Because the FK is absent from
  `pg_constraint`, the next `up` runs the pre-check again: it warns while rows still violate and
  adds the FK silently once the user has corrected the rows. No new state in `_orglet`. This
  matches how `schema-drop` and `schema-narrow` repeat until resolved.
- **D-03:** The offending-row count comes from a pre-check query per planned FK on a populated
  column (`count(*) WHERE col IS NOT NULL AND NOT EXISTS (target)`), so the warning names every
  offender in one run instead of aborting on the first 23503. The existing `migrate.test.ts` case
  that asserts the abort (around lines 148-175) is rewritten to assert the warning and the intact
  table.
- **D-04:** Idempotency: `migrate()` reads the existing index names from the catalog once (same
  style as `existingConstraintNames`) and does not run or record `CREATE INDEX` for an index that
  exists. The `IF NOT EXISTS` clause may stay as belt-and-braces but must not be the mechanism,
  because the success criterion is "executes no CREATE INDEX", and `MigrateResult.statements` is
  what the upgrade test asserts on. Apply the same to sequences if cheap.

### Upgrade test fixture and data
- **D-05:** The v1.0 baseline files are a committed snapshot copy of the 35 v1.0 JSON files (plus
  `standardValueSets.json` if the loader needs it) in a test fixture directory (suggested:
  `packages/metadata/test/fixtures/baseline-v1.0/`) with a README naming the source commit and the
  rule that the snapshot is never edited. Hermetic: works in a shallow CI checkout and cannot
  drift when the live baseline changes. Not `git show` at test time.
- **D-06:** The test populates the v1.0 database through the real write path: `DmlEngine` for the
  Group-owned rows (a Group of Type Queue plus a Group-owned Case, as in `query.test.ts` and
  `poly-check`) and `importMode` for rows carrying their own Ids and audit fields. No raw SQL
  inserts for fixture rows.
- **D-07:** The test runs on both backends (pglite by default, Postgres 16 when
  `ORGLET_DATABASE_URL` is set, per Phase 1 D-09..D-11), asserts every fixture row intact
  afterwards, asserts `MigrateResult.warnings` equal to an explicit expected list, and asserts that
  a second `migrate()` returns no warnings and no `CREATE INDEX` statements. In Phase 8 the
  expected warning list is empty (no baseline change has happened yet); Phase 9 extends the list
  with its allowlisted entries.

### Nullable key prefixes
- **D-08:** `SObjectDef.keyPrefix` and `StandardObjectJson.keyPrefix` become `string | null`.
  Every consumer that maps or matches on prefix (ids `keyPrefixOf`/`matchTargetByPrefix`/
  `generateId`, engine Id checks and `checkReferences`, `parents.ts`, bootstrap seeds, SOQL
  polymorphic joins and TYPEOF CASE, composite prefix lookup, `prefixes.ts` planner and standard
  list) filters null-prefix objects out of prefix-based matching. A null-prefix object is never a
  polymorphic match candidate and no prefix is ever invented or derived for it.
- **D-09:** Describe returns `keyPrefix: null` for such an object, which is what Salesforce itself
  returns for prefix-less objects. The object still loads, appears in global describe, and is an
  accepted reference target for `orglet check` (no `UNSUPPORTED:reference-target`).
- **D-10:** A null-prefix object must be `createable: false` in the baseline. The loader treats
  `keyPrefix: null` together with `createable: true` as a hard baseline error (a bug in orglet's
  own files, not an `UNSUPPORTED` warning). Creates then hit the Phase 3 object-flag check and
  return `INVALID_TYPE_FOR_OPERATION`; no new engine code path. Import mode (caller-supplied Ids)
  works unchanged because it bypasses the flags (Phase 3 D-08).
- **D-11:** The source label lives in the object's own JSON file as a sibling field:
  `"keyPrefix": null, "keyPrefixSource": "unverified"`. No separate `keyPrefixes.json`. Phase 8
  defines the type and the allowed values (suggested: `doc`, `sdk-fixture`, `de-describe`,
  `unverified`; final set is Claude's call, aligned with Phase 3 D-03/D-03a source kinds) and
  makes the field optional on the type so the 35 existing files stay valid.
- **D-12:** Phase 8 does not hand-label the 35 existing prefixes. The Phase 9 generator writes
  `keyPrefixSource` for every object from its fact tables. Phase 8 proves the null case with a test
  object (a baseline-shaped JSON loaded only in tests) and with the existing tests extended:
  all non-null prefixes unique and three characters, none in the custom range `a00..azz`, none
  equal to a custom-metadata `m0x` prefix, and persisted custom prefixes never collide with a null.

### Structured diagnostics (groundwork)
- **D-13:** Shape: a base `Diagnostic { area, message, object?, field?, cause? }` plus two
  specialisations named as in the roadmap: `SkippedItem` (adds `kind: object | field | rollup |
  rule`) and `FormulaFailure` (adds `what` and `missing?: { object, field }`). `cause` references
  the root-cause diagnostic (or its key) so Phase 14 can group cascaded formula failures; `area` is
  the `UNSUPPORTED:<area>` token so Phase 14 can count per area. Exact TypeScript encoding
  (discriminated union vs interfaces) is Claude's call.
- **D-14:** The warning string is derived from the record: every source builds a diagnostic and a
  single shared formatter renders exactly today's `UNSUPPORTED:<area> <text>` string. One source
  of truth, no drift. All existing `toEqual` assertions on warning strings stay untouched and
  serve as the regression guard that the formatter reproduces the old text byte for byte.
- **D-15:** Every existing warning source emits diagnostics in Phase 8: `sfdx.ts`, `build.ts`,
  `metadata/src/rollup.ts`, `schema/src/prefixes.ts`, `migrate.ts` (including the new
  `schema-fk`), `engine/src/formulas.ts` (`FormulaRegistry`) and `engine/src/query.ts`. Each
  result object keeps `warnings: string[]` and gains a parallel `diagnostics` list;
  `FormulaCompileError` gains `missing` set by `fieldNotFound`/`resolvePath` so messages are never
  regex-parsed. `orglet check --strict` and the `warning:` line format do not change.
- **D-16:** A test proves the records exist beside the strings for at least one source per
  package and that the formatter output equals the pre-existing string for every area in use.

### sigha: portable sync script, upstream fix, red tests
- **D-17:** `scripts/sync-sigha.sh` loses the two BSD-only `sed -i ''` invocations (portable
  `sed -i.bak` with cleanup, or `perl -pi`), gets a `trap` that removes the `mktemp -d` clone, and
  keeps NOTICE/LICENSE handling. The script is exercised on Linux in CI in a way that does not
  change the vendored copy on every push (Phase 1 D-18 stands: CI never rewrites
  `packages/sigha/src`; a dry-run or a run against a throwaway directory that is diffed and
  discarded is acceptable).
- **D-18:** Claude authors the upstream fix for a lone `!` (unary NOT, see Phase 12 and the
  research note that the corpus must confirm Salesforce semantics) and for `Rel:Object.Field`
  colon syntax, with test cases drawn from the BSD-3 formula-engine corpus, never from an org.
  The work happens in a separate clone outside the orglet repo. Johan reviews and opens the
  pull request(s) to `rfaulhaber/sigha` himself; Claude does not run `gh pr create`.
- **D-19:** The fork `snorf/sigha` does not exist yet. The plan includes an explicit checkpoint
  where Claude asks for OK before `gh repo fork` and again before pushing the branch to the fork.
  Until the PR exists, `VENDOR.md` gets a "Pending upstream changes" section listing the branch
  and the intended PR; the PR links replace it once Johan has opened them. No local patch is ever
  carried in `packages/sigha/src`.
- **D-20:** Orglet-side expectation tests for the correct behaviour of `!ISBLANK(x)`, `x != y`,
  `Owner:User.Email` / `Owner:Group.Name` (and `Queue` as an alias of `Group`), and `!` or `:`
  inside string literals are written now and marked with vitest `it.fails`. They stay red until
  the Phase 12 resync makes them pass, at which point `it.fails` turns them into failures and
  Phase 12 must flip them. This is a new pattern in the repo; document it in TESTING.md next to
  the "no static skips" rule as the one sanctioned way to express a known upstream gap.
- **D-21:** The existing tests that assert colon syntax throws `UNSUPPORTED:formula`
  (`packages/formula/src/formula.test.ts` ~47-52, `packages/engine/src/query.test.ts` ~182) stay
  unchanged in Phase 8; they protect the current classification until Phase 12 removes them.

### Group-owned test audit (groundwork for Phase 9)
- **D-22:** A committed markdown list in the phase directory (`08-GROUP-OWNED-AUDIT.md`) records
  every test, fixture and conformance check that creates or asserts on a Group owner or a `00G`
  Id, with file, line range and what it relies on (DB row vs literal Id vs describe shape). The
  scout found: `engine/src/query.test.ts`, `engine/src/engine.test.ts`, `api/src/api.test.ts`
  (rows and describe `referenceTo`), `schema/src/ids.test.ts`, `soql/src/shape.test.ts`,
  `soql/src/compile.test.ts`, `formula/src/formula.test.ts`, `schema/src/migrate.test.ts`
  (literals), `conformance/poly-check` (both legs), and the stale comment at `engine.ts` ~692.
  Phase 9 uses it to decide which tests move to Case/Lead (still queue-owned) and which are
  rejected as Salesforce would (`INVALID_CROSS_REFERENCE_KEY`).

### Claude's Discretion
- Exact catalog query for existing indexes and whether sequences get the same treatment.
- Whether the `schema-fk` warning carries a one-line hint on how to fix the rows.
- Name of orglet's `Diagnostic` type versus sigha's own `Diagnostic` (import alias or a different
  export name) and the TypeScript encoding of the specialisations.
- Final set of `keyPrefixSource` values and the location/name of the null-prefix test object.
- Layout of the audit list and of the v1.0 fixture README.
- How the sync script is exercised on Linux in CI without touching the vendored copy.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone and requirements
- `.planning/ROADMAP.md` — Phase 8 goal, success criteria 1-5, dependencies (first v1.1 phase)
- `.planning/REQUIREMENTS.md` — MIGR-01, MIGR-02, MIGR-04, BASE2-05 (lines ~24-36, ~61-63)
- `.planning/PROJECT.md` — v1.1 milestone goal; "never diff against a real org" constraint

### v1.1 research
- `.planning/research/SUMMARY.md` — Phase 8 scope (lines ~111-115), open questions 1, 2 and 7
  (sigha provenance, upstream PR, FK violation policy), "never ship a guessed key prefix"
- `.planning/research/ARCHITECTURE.md` — migrate pre-check design (~264-278), diagnostics proposal
  (~233-257), current abort behaviour (~34)
- `.planning/research/PITFALLS.md` — M1 (NOT NULL / FK on populated tables), M2 (index idempotency
  budget), B3 (null prefixes, source labels, collision tests), K1 (diagnostic fields), S1 (sync
  script portability), S2 (expected-failing tests before resync), O1 (Group-owned usages)
- `.planning/research/STACK.md` §sigha (~110-120) — smallest upstream lexer/parser changes for `!`
  and colon
- `.planning/research/FEATURES.md` (~378) — alternative diagnostic field set (superseded by D-13)

### Prior phase decisions that bind this phase
- `.planning/phases/01-test-infrastructure-ci/01-CONTEXT.md` — D-09..D-11 backend selection,
  D-18 CI never runs sync, D-19..D-21 no static skips / no production workarounds for pglite
- `.planning/phases/02-custom-object-key-prefix-persistence/02-CONTEXT.md` — D-03 standard
  prefixes are baseline constants, D-09/D-18 conflicts are hard errors, D-13 `up` never removes
- `.planning/phases/03-thin-standard-object-baselines/03-CONTEXT.md` — D-03/D-03a source rules,
  D-04 explicit flags, D-08 import mode bypasses flags, "no NOT VALID" FK decision
- `.planning/phases/04-polymorphic-lookups-soql-typeof/04-CONTEXT.md` — D-03/D-11 prefix-based
  joins and CASE, D-07/D-19 unmodelled prefix is a null parent, D-09/D-16 colon syntax upstream
  only, `Queue` alias of `Group`, D-12 Group-owned fixture
- `.planning/phases/05-roll-up-summary-fields/05-CONTEXT.md` — D-10 migrate backfill is the last
  transaction step (pending-trigger-events constraint for any new migrate step)
- `.planning/phases/07-conformance-re-run-milestone-acceptance/07-CONTEXT.md` — D-02 no sed
  rewriting in harnesses, D-16 `--strict` semantics and warning line format

### Vendoring and todos
- `packages/sigha/VENDOR.md` — current revision, "nothing edited by hand" rule; gains the PR section
- `.planning/todos/pending/2026-10-08-sigha-colon-syntax-for-polymorphic-formula-references.md` —
  colon semantics incl. `Owner:Group` canonical segment (Phase 12 scope; informs the red tests)
- `.planning/todos/pending/2026-10-08-narrow-baseline-ownerid-per-object.md` — Phase 9 scope;
  informs the Group-owned audit

### Codebase maps
- `.planning/codebase/CONVENTIONS.md` (~83-88) — `UNSUPPORTED:<area>` format and result-object
  convention
- `.planning/codebase/TESTING.md` (~82, ~86-125) — openTestDb/usingPglite, no static skips
- `.planning/codebase/CONCERNS.md` (~62-69) — migrate diffs by name only

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/schema/src/migrate.ts` — `existingConstraintNames` (~92-98) is the pattern to copy for
  existing indexes; `run()` (~108-111) records every statement into `MigrateResult.statements`;
  `isPgForeignKeyViolation` (~42) and the throw at ~159-170 are what D-01/D-03 replace
- `packages/schema/src/ddl.ts` — `foreignKeySql` (~91-97), `indexSql` (~99-101), FK planning only
  for single-target Lookup/MasterDetail (~46-51)
- `packages/schema/src/ids.ts` — `keyPrefixOf` (~40), `matchTargetByPrefix` (~50-52),
  `generateId` (~78-79): the three prefix primitives everything else calls
- `packages/schema/src/prefixes.ts` — planner `taken` map (~104), standard list (~251),
  `KeyPrefixError.claims` (~22-30) as an existing structured-error precedent
- `packages/metadata/src/build.ts` — `loadBaseline` (~36-52, no validation today),
  `fromStandardObject` (~222), `customKeyPrefix` (~420-426), reference-target warning (~486-494)
- `packages/formula/src/compile.ts` — `FormulaCompileError.diagnostics` (~51-59) already uses
  sigha's `Diagnostic` (name clash to resolve); colon classification regex at ~173-181
- `packages/engine/src/formulas.ts` — `FormulaRegistry.warnings` (~19, ~58)
- `packages/cli/src/main.ts` — `check` merges warnings (~72-85), `up` prints and counts (~129-132)
- `test/db.ts` — `openTestDb`/`usingPglite`, per-file pglite, `skip(usingPglite, reason)`
- `packages/sigha/src/syntax/lexer.ts` (~421-430) — `!=` accepted, lone `!` is `unexpectedBang`
- `scripts/sync-sigha.sh` — lines 38 and 40 are the BSD-only `sed -i ''`; VENDOR.md heredoc at
  ~43-53

### Established Patterns
- Warnings are `string[]` on result objects, printed by the CLI as `warning: ...`; tests assert with
  `toEqual`. D-14 keeps this surface and adds records underneath.
- Migration is one transaction; roll-up backfill must stay the last step (Phase 5 D-10).
- Object flags are explicit per baseline JSON; violations return `INVALID_TYPE_FOR_OPERATION`.
- Tests: pglite per file, random `test_<hex>` schema, Postgres via env, no static skips.
- Corpus tests in `packages/sigha/src/engine/*.test.ts` are vendored and regenerated by the sync
  script; never hand-edited.

### Integration Points
- `migrate()` pre-check and index catalog read: inside the existing transaction, before FK adds and
  before the roll-up backfill.
- `keyPrefix: string | null` ripples through metadata types, schema ids/prefixes, engine
  (`engine.ts` ~379/414/435/690, `parents.ts` ~37, `bootstrap.ts` ~58-118), soql (`compile.ts`
  ~48/164-165, `polymorphic.ts`), api (`describe.ts` ~197, `routes/composite.ts` ~102).
- Diagnostics: new exports from `@orglet/metadata` (types + formatter) consumed by schema, engine,
  formula and cli through each package's `index.ts`.
- Upgrade test lives beside `migrate.test.ts` or in a new `packages/schema/src/upgrade.test.ts`,
  reading the fixture snapshot through `loadOrgSchema` with a baseline-directory override (may
  need a small option on the loader).

</code_context>

<specifics>
## Specific Ideas

- "Warn, don't fake; never delete user data" governs every migrate choice: skip and re-check,
  never `--force`-delete, never `NOT VALID`.
- The upgrade test is the contract for Phases 9-13: each later phase extends its expected warning
  list rather than weakening its assertions.
- Outward-facing steps (fork creation, branch push, PR) are Johan's: Claude prepares, asks at a
  checkpoint, and never opens the PR.
- `it.fails` is accepted as the one sanctioned "known upstream gap" marker; it must be documented
  in TESTING.md so it is not mistaken for a skip.

</specifics>

<deferred>
## Deferred Ideas

- Colon syntax evaluation (`Owner:User.Email` resolving against the named target, `Queue` alias)
  and `!` as unary NOT — Phase 12 after the resync.
- Narrowing `OwnerId.referenceTo` per object — Phase 9 (BASE2-04), using the audit list from D-22.
- Hand-labelling all 35 existing prefixes — Phase 9 generator output (D-12).
- Rendering diagnostics as a root-cause report with `--summary`/`--json` — Phase 14.
- Re-deciding Phase 5 D-10 (one-time backfill) for roll-ups over formulas — Phase 13.

### Reviewed Todos (not folded)
- `2026-10-08-sigha-colon-syntax-for-polymorphic-formula-references` — stays with Phase 12; Phase 8
  only adds the red expectation tests and prepares the upstream fix.
- `2026-10-08-narrow-baseline-ownerid-per-object` — stays with Phase 9; Phase 8 only produces the
  Group-owned audit list it needs.

</deferred>

---

*Phase: 08-upgrade-safety-net-nullable-key-prefixes*
*Context gathered: 2026-10-13*
