---
phase: 02-custom-object-key-prefix-persistence
verified: 2026-10-02T13:42:00Z
status: gaps_found
score: 4/5 must-haves verified
gaps:
  - truth: "A persisted custom prefix that equals a standard-object prefix in the loaded OrgSchema fails `orglet up` with a KeyPrefixError on every run (D-03, PREFIX-03 'can never collide')"
    status: partial
    reason: "planKeyPrefixes seeds `taken` with standard prefixes and then overwrites with persisted rows (prefixes.ts:104-105) without comparing the two sets. The collision check only runs for claims being assigned this run (records/mapping/provisional). A row persisted earlier (e.g. seeded via --key-prefixes with a non-`a` value, or hand-edited) that later matches a standard prefix added to the baseline (phase 3 adds 14) is accepted silently and two objects then share a prefix. Verified empirically: planKeyPrefixes({custom:[Foo__c], standard:[{BusinessHours,01m}], persisted:{foo__c:01m}}) returns {assignments:[]} with no error."
    artifacts:
      - path: "packages/schema/src/prefixes.ts"
        issue: "No persisted-vs-standard comparison after building `taken` (lines 103-105); D-03's 'on every up' check is missing"
      - path: "packages/schema/src/prefixes.test.ts"
        issue: "No planner case covering a persisted row whose prefix equals a standard prefix"
    missing:
      - "In planKeyPrefixes, after seeding `taken` with standard prefixes, loop over input.persisted and throw KeyPrefixError(`key prefix X for Foo__c (persisted) collides with standard object Bar (X)`, [persistedClaim, standardClaim]) when taken.get(p.keyPrefix)?.source === 'standard', before any overwrite"
      - "Planner unit test: persisted {foo__c: 01m} + standard {BusinessHours: 01m} throws KeyPrefixError naming Foo__c, BusinessHours and 01m; sibling test that a persisted prefix not in the standard set still produces no assignment"
      - "Optional: make KEY_PREFIX_HINT in packages/cli/src/main.ts cover this case (the fix is `reset --drop-prefixes` or editing _orglet.key_prefixes, not a --key-prefixes entry)"
---

# Phase 02: Custom-Object Key-Prefix Persistence Verification Report

**Phase Goal:** A custom object's key prefix is assigned once and persisted, so adding, removing or renaming custom objects never shifts the Id-meaning of existing records.
**Verified:** 2026-10-02T13:42:00Z
**Status:** gaps_found (one partial gap on CONTEXT decision D-03; all four ROADMAP success criteria verified)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

Truths 1-4 are the ROADMAP success criteria verbatim. Truth 5 is derived from 02-CONTEXT.md D-03 ("the collision check compares persisted custom prefixes against every standard prefix in the loaded OrgSchema on every `up`") and REQUIREMENTS PREFIX-03 ("A persisted custom prefix can never collide with a standard-object prefix").

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1   | A custom object's key prefix, once assigned on first `orglet up`, is unchanged across two consecutive reloads even when other custom objects are added, removed or renamed in between | ✓ VERIFIED | `prefixes.ts:233-282` reads persisted rows first, only plans objects without a row, never deletes; `prefixes.test.ts` "two-build" (Aardvark__c sorts first in memory as a00, persisted BigTable__c stays a00, Aardvark__c gets a04 next-free; third run writes 0 rows), "removal" (row kept, prefix handed back), "rename" (new name = new object, old row kept). `main.ts:118` calls `reconcileKeyPrefixes` before `migrate` (127), `bootstrapOrg` (132) and `new DmlEngine` (133). Ran green on pglite. |
| 2   | An org database whose prefixes were previously assigned by the old alphabetical scheme keeps those exact assignments as its initial persisted state on first upgrade | ✓ VERIFIED | `prefixes.ts:251-259` scans `SELECT DISTINCT left(id, 3)` per existing custom table for objects without a row; `planKeyPrefixes` pass 1 gives `records` claims precedence over mapping/provisional. Test "seeds from existing records" (BigTable__c a00 / UpsertTable__c a03 from records, update by old Id still succeeds) and "sorts before" (newcomer cannot steal a00). Devrandom checkpoint approved by Johan: a00/a01 unchanged, second start silent (seed source `provisional` because both tables were empty, see 02-03-SUMMARY — not a defect). |
| 3   | Assigning a prefix that would collide with a standard-object prefix or another custom object's persisted prefix fails the load with a clear error instead of silently overlapping | ✓ VERIFIED | `planKeyPrefixes` lines 116-157: ambiguous records, mapping-vs-records, claim-vs-taken (standard or persisted), mapping-vs-own-persisted all throw `KeyPrefixError` naming both parties and both prefixes; `withTransaction` (`db.ts:39-52`) rolls back so nothing is written. Tests: 5 planner collision cases, "nothing written" DB case (0 rows after a `Project__c: 001` mapping), smoke run exit 1 with `error: key prefix 001 for Project__c (from --key-prefixes) collides with standard object Account (001)` + hint, no stack. `UNIQUE (org_schema, key_prefix)` DDL as backstop. |
| 4   | `orglet check` (no database) labels any prefix it reports as provisional, and `orglet reset` preserves persisted prefix assignments unless the user explicitly asks to drop them | ✓ VERIFIED | `main.ts:72-83` `check` never creates a pool, prints `  <Object>  <prefix>  (provisional)` per custom object plus the closing sentence, gated by `log()` (`--quiet`). `main.ts:158-171` `reset` drops only the org schema; `dropKeyPrefixes` runs only when `--drop-prefixes`. `_orglet` is a sibling schema (`internal.ts`), so `DROP SCHEMA <org> CASCADE` cannot reach it — test "drop: rows survive DROP SCHEMA ... removes only that org's rows". `main.test.ts` 3/3 green. |
| 5   | A persisted custom prefix that equals a standard-object prefix in the loaded OrgSchema fails `orglet up` on every run (D-03) | ✗ FAILED (partial) | `prefixes.ts:104` seeds `taken` with standard prefixes, `:105` overwrites with persisted rows; no comparison between the two sets. Probe (`tsx` script against `planKeyPrefixes`): persisted `Foo__c=01m` + standard `BusinessHours=01m` returns `{ assignments: [] }` with no error. Only *new* claims are checked against standard prefixes. Narrow (requires a non-`a` prefix seeded via mapping or hand-edited rows, then a baseline that adds that standard prefix), but D-03 names this check explicitly and phase 3 adds 14 standard objects. |

**Score:** 4/5 truths verified (all 4 ROADMAP success criteria pass; the failed truth is the D-03 "every up" re-check)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `packages/schema/src/internal.ts` | `ensureInternalSchema(client)`: constant advisory lock + `CREATE SCHEMA IF NOT EXISTS "_orglet"` | ✓ VERIFIED | 15 lines, exactly that; imported and called at `prefixes.ts:237`; exported from barrel line 22 |
| `packages/schema/src/prefixes.ts` | `KeyPrefixError`, `planKeyPrefixes`, `parseKeyPrefixMapping`, `reconcileKeyPrefixes`, `dropKeyPrefixes`; min 150 lines | ✓ VERIFIED | 290 lines, all five exported; wired from barrel, CLI (`main.ts:12`) and API test; substantive (two-pass planner, transaction, scan, insert, mutate) |
| `packages/schema/src/prefixes.test.ts` | T1-T8, T10, T12; min 200 lines | ✓ VERIFIED | 389 lines, 27 tests (12 planner, 6 parser, 9 DB); 26 pass + 1 Postgres-only skip on pglite |
| `packages/schema/src/index.ts` | explicit named exports | ✓ VERIFIED | lines 22-24: values and types on separate lines, no `export *` |
| `packages/cli/src/main.ts` | `--key-prefixes`, `--drop-prefixes`, reconcile call, `KeyPrefixError` catch, provisional `check` output | ✓ VERIFIED | all present: parseArgs 185-186, reconcile 118, two `instanceof KeyPrefixError` catches (100, 120), `(provisional)` 78, `dropKeyPrefixes` 164; `UNSUPPORTED` count 0; no `err.stack` |
| `packages/cli/src/main.test.ts` | T9 console-spy test; min 40 lines | ✓ VERIFIED | 51 lines, 3 tests, green |
| `packages/metadata/src/build.ts` | `customKeyPrefix` doc comment says provisional | ✓ VERIFIED | comment at lines 400-405 ("Provisional key prefix for the i-th custom object..."); algorithm untouched. gsd-tools reports "Missing pattern: provisional" only because its match is case-sensitive and the comment capitalises the word — not a gap |
| `README.md` | `## Custom-object key prefixes` section with `--key-prefixes` | ✓ VERIFIED | section at line 57, between Quick start (34) and Layout (87); covers assignment, storage, `(provisional)`, `reset --drop-prefixes`, collisions, mapping file + `sf sobject describe` recipe; Layout line reads `orglet up / check / reset` |
| `packages/api/src/api.test.ts` | T11: reconcile with mapping in `beforeAll`, `dropKeyPrefixes` in `afterAll`, describe/Id assertion | ✓ VERIFIED | lines 37-38 (reconcile before migrate), 55-56 (drop before DROP SCHEMA), 159-166 (`keyPrefix: "a0Z"`, per-object describe, Id `/^a0Z[0-9A-Za-z]{15}$/`); 17/17 green on pglite |

### Key Link Verification

gsd-tools `verify key-links` reported most links unverified because the PLAN frontmatter patterns are double-escaped and the `from` fields carry function suffixes (`main.ts up()`), so the tool could not open the files. Every link was therefore checked manually with grep.

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `prefixes.ts` | `internal.ts` | `await ensureInternalSchema(client)` first inside `withTransaction` | ✓ WIRED | line 237, first statement in the transaction callback |
| `prefixes.ts` | `_orglet.key_prefixes` | `CREATE TABLE IF NOT EXISTS` + `INSERT` in same transaction | ✓ WIRED | lines 206-214 DDL, 238 create, 270 insert, all inside `withTransaction` |
| `prefixes.ts` | `SObjectDef.keyPrefix` | in-place mutation after INSERTs | ✓ WIRED | line 277 `obj.keyPrefix = value` after the insert loop |
| `prefixes.ts` | `pg_advisory_xact_lock` | per-org lock after constant lock, before reading rows | ✓ WIRED | line 239 `pg_advisory_xact_lock(hashtext($1), hashtext($2))`, after `ensureInternalSchema` (constant lock), before the `SELECT` at 245 |
| `main.ts up()` | `reconcileKeyPrefixes` | between `SELECT 1` and `migrate(...)` | ✓ WIRED | `SELECT 1` line 110, reconcile 118, migrate 127 |
| `main.ts up()` | `KeyPrefixError` | `instanceof` catch, `error:` + hint, return 1 | ✓ WIRED | lines 99-103 (mapping parse) and 119-124 (reconcile); hint constant line 60 |
| `main.ts reset()` | `dropKeyPrefixes` | only when `--drop-prefixes` | ✓ WIRED | lines 163-166 inside `if (dropPrefixes)` |
| `main.ts check()` | custom `SObjectDef.keyPrefix` | `(provisional)` log line | ✓ WIRED | lines 77-79, no pool created in `check` |
| `api.test.ts beforeAll` | `reconcileKeyPrefixes` | before `migrate`, before bootstrap/engine | ✓ WIRED | line 37 precedes 38 (migrate), 39 (bootstrap), 42 (engine) |
| `describe.ts objectSummary` | `SObjectDef.keyPrefix` | read at request time | ✓ WIRED | `describe.ts:196` `keyPrefix: obj.keyPrefix`; T11 asserts `a0Z` through REST |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `reconcileKeyPrefixes` | `persisted` | `SELECT object_name, key_prefix FROM _orglet.key_prefixes WHERE org_schema = $1` | Yes | ✓ FLOWING |
| `reconcileKeyPrefixes` | `observed` | `SELECT DISTINCT left(id, 3)` per existing custom table (only for objects without a row) | Yes | ✓ FLOWING |
| `reconcileKeyPrefixes` | `obj.keyPrefix` | `persisted ?? assigned` after INSERT | Yes | ✓ FLOWING |
| `up()` log lines | `prefixes.assignments` | return value of reconcile | Yes | ✓ FLOWING |
| `check()` lines | `o.keyPrefix` | `buildOrgSchema` provisional scheme (by design, no DB) | Yes | ✓ FLOWING |
| REST describe | `obj.keyPrefix` | mutated `OrgSchema` shared with `DmlEngine`/`createApiServer` | Yes | ✓ FLOWING (T11) |

### CONTEXT Decisions D-01..D-18

| Decision | Status | Evidence |
| -------- | ------ | -------- |
| D-01 sibling `_orglet` schema, survives reset | ✓ | `internal.ts`, `INTERNAL_SCHEMA = "_orglet"`; test "rows survive DROP SCHEMA" |
| D-02 PK `(org_schema, object_name)`, UNIQUE `(org_schema, key_prefix)`, case-insensitive match | ✓ | DDL lines 212-213; lower-cased map keys throughout; parser canonicalises casing |
| D-03 only custom persisted; standard compared on every up | ⚠ PARTIAL | only custom rows written (✓); standard prefixes compared against *new* claims (✓) but not against already-persisted rows (✗, see gap) |
| D-04 reconcile after `SELECT 1`, before migrate/bootstrap/engine; one transaction; `check` never touches DB | ✓ | `main.ts:110/118/127/132/133`; `withTransaction`; `check` has no pool |
| D-05 `pg_advisory_xact_lock` keyed on org schema | ✓ | `prefixes.ts:239`; Postgres-only concurrency test exists (skipped on pglite, 02-03-SUMMARY reports it green on Docker) |
| D-06 shared `ensureInternalSchema` helper | ✓ | `internal.ts`, exported from barrel |
| D-07 `reset --drop-prefixes` deletes only that org's rows, schema left in place | ✓ | `dropKeyPrefixes` `DELETE ... WHERE org_schema = $1`; no `DROP SCHEMA _orglet` anywhere |
| D-08 precedence persisted > records > mapping > provisional > next-free | ✓ | `planKeyPrefixes` pass 1 / pass 2; `persisted.get(lower)?.keyPrefix ?? assigned.get(lower)` |
| D-09 every contradiction is a hard error, nothing written | ✓ | 5 throw sites, all `KeyPrefixError`; ROLLBACK via `withTransaction`; test "nothing written" |
| D-10 one `SELECT DISTINCT left(id,3)` per table, only for objects without a row | ✓ | lines 254-259, `if (persisted.has(lower) || !tables.has(...)) continue` |
| D-11 `--key-prefixes <file>` JSON, consulted only for objects without a row, never overrides | ✓ | `main.ts:88-105`; planner pass 1 skips persisted, pass 1b errors on disagreement; README recipe |
| D-12 lowest free in a00..azz, not held by persisted or standard | ✓ | `nextFree(taken)` |
| D-13 rows never removed by `up` | ✓ | no DELETE in `reconcileKeyPrefixes`; tests "removal", "rename" |
| D-14 rename = new object | ✓ | test "rename"; no `--rename` flag |
| D-15 `check` lines + closing sentence, standard objects not listed | ✓ | `main.ts:77-79`; `main.test.ts` asserts exactly 4 `(provisional)` lines |
| D-16 `up` logs only new assignments with source, silent otherwise, respects `--quiet` | ✓ | `main.ts:126` via `log()`; `sourceSuffix` 63-70; smoke: second run 0 lines |
| D-17 flag name `--drop-prefixes` | ✓ | `main.ts:186, 208` |
| D-18 `KeyPrefixError`, `error: <msg>` + one hint, exit 1, no stack, not `UNSUPPORTED:*` | ✓ | `main.ts:60, 99-103, 119-124`; `UNSUPPORTED` count 0 in all three files; `err.stack` count 0 |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Prefix module, CLI and build tests pass | `pnpm vitest run packages/schema/src/prefixes.test.ts packages/cli/src/main.test.ts packages/metadata/src/build.test.ts` | 44 passed, 1 skipped (Postgres-only) | ✓ PASS |
| REST describe/Id reflect persisted prefix | `pnpm vitest run packages/api/src/api.test.ts` | 17 passed | ✓ PASS |
| Full suite on pglite | `pnpm test` | 15 files, 153 passed, 2 skipped, 0 failed | ✓ PASS |
| Typecheck and lint | `pnpm build && pnpm lint` | both exit 0 | ✓ PASS |
| Summary commits exist | `gsd-tools verify commits <10 hashes>` | 10/10 valid | ✓ PASS |
| D-03 persisted-vs-standard re-check | `tsx` probe calling `planKeyPrefixes` with persisted `01m` and standard `BusinessHours 01m` | `NO ERROR; assignments: []` | ✗ FAIL |
| Docker Postgres suite, CLI smoke, devrandom restart | not re-run here (no server start allowed; devrandom on 8180 left alone) | recorded in 02-03-SUMMARY (155/155, 0 skipped; smoke counts match; checkpoint approved) | ? SKIP (documented evidence accepted) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| PREFIX-01 | 02-01, 02-02, 02-03 | Prefix assigned on first `up`, stored in `_orglet`, reload with new/renamed object never changes an existing prefix | ✓ SATISFIED | Truth 1; two-build/removal/rename tests; CLI wiring; T11 |
| PREFIX-02 | 02-01, 02-02, 02-03 | Existing org keeps old alphabetical assignments on first upgrade; no Id changes meaning | ✓ SATISFIED | Truth 2; records-seeding tests; devrandom checkpoint approved |
| PREFIX-03 | 02-01, 02-03 | Persisted custom prefix can never collide with a standard or another custom prefix; collision fails load with clear error | ⚠ PARTIAL | Truth 3 satisfied for every assignment made by orglet (and DB UNIQUE backstop for custom-vs-custom); Truth 5 gap: an already-persisted row vs a standard prefix added later is not re-checked |
| PREFIX-04 | 02-01, 02-02, 02-03 | `check` reports provisional and says so; `reset` keeps assignments unless asked to drop | ✓ SATISFIED | Truth 4; `main.test.ts`; `dropKeyPrefixes` test |

Orphaned requirements: none. REQUIREMENTS.md maps exactly PREFIX-01..04 to Phase 2 and every plan claims a subset of those four.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `packages/schema/src/prefixes.ts` | 104-105 | persisted rows overwrite standard entries in `taken` without a collision check | ⚠ Warning | D-03 "on every up" check missing (the gap above); no effect on the four success criteria |
| `packages/schema/src/prefixes.ts` | 175, 280 | `warnings: []` always empty | ℹ Info | By design (every contradiction throws); kept in the contract for the CLI loop, documented in 02-01-SUMMARY |
| `packages/cli/src/main.ts` | 103, 123 | `return 1` without `pool.end()` | ℹ Info | Mirrors the existing Postgres-unreachable branch; `index.ts` exits the process |

No TODO/FIXME/placeholder markers, no `UNSUPPORTED:*` strings, no stubbed returns in any phase file.

### Human Verification Required

None beyond what Johan already approved (devrandom checkpoint, 02-03-SUMMARY). The Docker Postgres run and the CLI smoke sequence are documented with literal output in 02-03-SUMMARY and were not re-run here because the orchestrator asked that no server be started and the devrandom server on port 8180 be left alone.

### Gaps Summary

The phase goal is achieved: all four ROADMAP success criteria are verified against the code and by green tests on pglite (plus documented Docker Postgres, CLI smoke and real-org evidence). Storage, precedence, transactional rollback, advisory locking, CLI strings, `check`/`reset` semantics and documentation all match CONTEXT D-01..D-18 with one exception.

**One partial gap, D-03 / PREFIX-03:** `planKeyPrefixes` checks every *new* claim against standard prefixes and persisted rows, but never checks the *already-persisted* rows against the standard prefixes of the currently loaded schema. The probe confirms a persisted `01m` for `Foo__c` coexists silently with a standard object using `01m`. This cannot happen through orglet's own `a00..azz` assignment (standard prefixes never start with `a`), so it needs a `--key-prefixes` seed with a non-`a` value or a hand-edited row followed by a baseline that adds that standard prefix — exactly the phase 3 scenario D-03 was written for ("cheap but mandatory"). Fix is a few lines in the planner plus one unit test; no CLI or schema changes needed.

---

_Verified: 2026-10-02T13:42:00Z_
_Verifier: Claude (gsd-verifier)_
