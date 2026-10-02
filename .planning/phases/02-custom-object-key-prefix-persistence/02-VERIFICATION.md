---
phase: 02-custom-object-key-prefix-persistence
verified: 2026-10-02T13:52:00Z
status: passed
score: 5/5 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "A persisted custom prefix that equals a standard-object prefix in the loaded OrgSchema fails `orglet up` with a KeyPrefixError on every run (D-03, PREFIX-03 'can never collide') — fixed in 4ce2fe8"
  gaps_remaining: []
  regressions: []
---

# Phase 02: Custom-Object Key-Prefix Persistence Verification Report

**Phase Goal:** A custom object's key prefix is assigned once and persisted, so adding, removing or renaming custom objects never shifts the Id-meaning of existing records.
**Verified:** 2026-10-02T13:52:00Z
**Status:** passed
**Re-verification:** Yes — after gap closure (commit `4ce2fe8`, branch `gsd/phase-02-custom-object-key-prefix-persistence`). The initial report (2026-10-02T13:42:00Z, `gaps_found`, 4/5) found exactly one partial gap; this run verifies the fix in depth, re-checks the previously passed items for regressions, and keeps their evidence where nothing changed.

## Gap Closure

### Gap: D-03 persisted-vs-standard re-check (Truth 5, PREFIX-03)

**Previous finding:** `planKeyPrefixes` seeded `taken` with standard prefixes and then overwrote with persisted rows without comparing the two sets; a persisted row whose prefix matched a standard prefix added later to the baseline was accepted silently.

**Fix (`git show 4ce2fe8`, 3 files, +20/-2):**

| File | Change | Verified |
| ---- | ------ | -------- |
| `packages/schema/src/prefixes.ts:105-113` | After seeding `taken` with standard prefixes, loops over `input.persisted.values()`; if `taken.get(p.keyPrefix)?.source === "standard"` throws `KeyPrefixError("persisted key prefix <p> of <Obj> collides with standard object <Std> (<p>)", [persistedClaim, standardClaim])`, otherwise sets the persisted claim as before | ✓ Read the code. The loop sits before `const decided = new Map(...)` and before pass 1 (`// Pass 1: claims backed by evidence`, line 118), so a bad persisted row fails the load even when there is no new object to plan. Uses the existing `describe(other)` helper (line 70) for the standard-object wording. |
| `packages/schema/src/prefixes.test.ts:107-115` | New planner test "rejects a persisted prefix that a standard object now carries, naming both": persisted `Foo__c = 003` vs standard `Contact 003`; asserts `KeyPrefixError`, message `/persisted key prefix 003 of Foo__c/` and `/standard object Contact \(003\)/`, claim sources `["persisted", "standard"]` | ✓ Present, green (28 tests in file, 1 Postgres-only skip) |
| `packages/cli/src/main.ts:60` | `KEY_PREFIX_HINT` now also names "the stored assignment in _orglet.key_prefixes" as a place to fix and says "all of the org's assignments can be removed with: orglet reset --drop-prefixes" | ✓ Read; same constant is printed by both existing `instanceof KeyPrefixError` catch sites (lines 99-103 mapping parse, 119-124 reconcile) |

**Transactional safety (D-09):** `reconcileKeyPrefixes` (`prefixes.ts:242-290`) still calls `planKeyPrefixes` inside the `withTransaction` callback (line 264), after `ensureInternalSchema`, `CREATE TABLE IF NOT EXISTS`, the per-org advisory lock, and the persisted/table/observed reads, and before the INSERT loop (line 272). `withTransaction` (`db.ts:39-52`) issues `ROLLBACK` on any thrown error, so the new throw writes nothing and does not mutate `SObjectDef.keyPrefix` (mutation is after the inserts, line 277-281).

**CLI path (D-18):** `main.ts:118-124` catches the error with `if (!(err instanceof KeyPrefixError)) throw err;`, prints `error: <message>` then `KEY_PREFIX_HINT`, returns 1. `grep -c "err.stack"` = 0 and `grep -c UNSUPPORTED` = 0 in `main.ts`, `prefixes.ts`, `prefixes.test.ts`. No changes to the catch sites were needed or made.

**Empirical probe (tsx script against `planKeyPrefixes`, same inputs as the previous report's failing probe):**

| Case | Input | Result |
| ---- | ----- | ------ |
| A — the previous failing probe | custom `Foo__c`, standard `BusinessHours 01m`, persisted `foo__c = 01m` | `KeyPrefixError: persisted key prefix 01m of Foo__c collides with standard object BusinessHours (01m)`, claims `["persisted","standard"]` (previously: `{ assignments: [] }`, no error) |
| B — persisted row for an object no longer in the schema | custom `[]`, standard `BusinessHours 01m`, persisted `gone__c = 01m` | same `KeyPrefixError` — the check runs over every persisted row regardless of whether a new object exists, as D-03 "on every up" requires |
| C — persisted prefix that does not collide | custom `Foo__c`, standard `BusinessHours 01m`, persisted `foo__c = a00` | `{ assignments: [], warnings: [] }` — unchanged behaviour, no false positive |

Case B is a design consequence worth knowing (a stale row for a removed object can block `up` once a later baseline adds that standard prefix); the hint now names the two remedies (`_orglet.key_prefixes` row or `orglet reset --drop-prefixes`), so this is consistent with D-03 + D-13 and not a gap.

**Gap status: RESOLVED** (commit `4ce2fe8`).

## Goal Achievement

### Observable Truths

Truths 1-4 are the ROADMAP success criteria verbatim. Truth 5 is derived from 02-CONTEXT.md D-03 and REQUIREMENTS PREFIX-03.

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1   | A custom object's key prefix, once assigned on first `orglet up`, is unchanged across two consecutive reloads even when other custom objects are added, removed or renamed in between | ✓ VERIFIED (regression check: unchanged) | `reconcileKeyPrefixes` reads persisted rows first, plans only objects without a row, never deletes; tests "two-build", "removal", "rename" green on pglite this run. `main.ts:118` reconcile precedes `migrate` (127), `bootstrapOrg`, `new DmlEngine`. The fix touches only the persisted-vs-standard comparison; persisted rows that do not collide still flow unchanged into `obj.keyPrefix` (probe case C). |
| 2   | An org database whose prefixes were previously assigned by the old alphabetical scheme keeps those exact assignments as its initial persisted state on first upgrade | ✓ VERIFIED (regression check: unchanged) | `prefixes.ts:254-260` records scan; pass 1 precedence untouched by the fix. Tests "seeds from existing records" and "sorts before" green this run. Devrandom checkpoint approved by Johan (02-03-SUMMARY). |
| 3   | Assigning a prefix that would collide with a standard-object prefix or another custom object's persisted prefix fails the load with a clear error instead of silently overlapping | ✓ VERIFIED (regression check: unchanged, plus one more throw site) | Now 6 `KeyPrefixError` throw sites in the planner (ambiguous records, persisted-vs-standard, mapping-vs-records, claim-vs-taken, mapping-vs-own-persisted); all inside `withTransaction`, nothing written. Tests: 6 planner collision cases + "nothing written" DB case green. `UNIQUE (org_schema, key_prefix)` DDL backstop unchanged. |
| 4   | `orglet check` (no database) labels any prefix it reports as provisional, and `orglet reset` preserves persisted prefix assignments unless the user explicitly asks to drop them | ✓ VERIFIED (regression check: unchanged) | `main.ts:72-83` `check` creates no pool, prints `(provisional)` lines; `reset` drops `_orglet` rows only under `--drop-prefixes`. `main.test.ts` 3/3 green this run; "drop: rows survive DROP SCHEMA" green. |
| 5   | A persisted custom prefix that equals a standard-object prefix in the loaded OrgSchema fails `orglet up` on every run (D-03) | ✓ VERIFIED (gap closed) | `prefixes.ts:105-113` loop before pass 1; unit test "rejects a persisted prefix that a standard object now carries, naming both" green; probe cases A and B throw, C does not. Error surfaces through the existing `main.ts:119-124` catch as `error: persisted key prefix ... collides with standard object ... (...)` + widened hint, exit 1, no stack. |

**Score:** 5/5 truths verified

### Required Artifacts

All artifacts passed in the initial verification; only the three files in `4ce2fe8` changed since. Re-checked those three at all levels; the rest got an existence/sanity check.

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `packages/schema/src/prefixes.ts` | `KeyPrefixError`, `planKeyPrefixes`, `parseKeyPrefixMapping`, `reconcileKeyPrefixes`, `dropKeyPrefixes`; D-03 persisted-vs-standard check | ✓ VERIFIED | 298 lines; new loop at 105-113 wired into the existing planner, which `reconcileKeyPrefixes` calls inside the transaction (264); exported from barrel, used by CLI and API test |
| `packages/schema/src/prefixes.test.ts` | T1-T8, T10, T12 + persisted-vs-standard case | ✓ VERIFIED | 399 lines, 28 tests (13 planner, 6 parser, 9 DB); 27 pass + 1 Postgres-only skip on pglite |
| `packages/cli/src/main.ts` | `--key-prefixes`, `--drop-prefixes`, reconcile call, `KeyPrefixError` catch, provisional `check` output, hint covering stored rows | ✓ VERIFIED | hint widened at line 60; catches 99-103 and 119-124 unchanged; `err.stack` 0, `UNSUPPORTED` 0 |
| `packages/schema/src/internal.ts` | `ensureInternalSchema` | ✓ VERIFIED (unchanged) | still the first call inside the transaction (`prefixes.ts:245`) |
| `packages/schema/src/index.ts` | explicit named exports | ✓ VERIFIED (unchanged) | |
| `packages/cli/src/main.test.ts` | T9 console-spy test | ✓ VERIFIED (unchanged) | 3/3 green this run |
| `packages/metadata/src/build.ts` | `customKeyPrefix` doc comment says provisional | ✓ VERIFIED (unchanged) | `build.test.ts` 15/15 green this run |
| `README.md` | `## Custom-object key prefixes` section | ✓ VERIFIED (unchanged) | line 70 already states "A prefix that would collide with a standard object or with another custom object's assignment" fails the load — now true for persisted rows as well |
| `packages/api/src/api.test.ts` | T11 reconcile/drop wiring + `a0Z` describe/Id assertion | ✓ VERIFIED (unchanged) | not re-run here; orchestrator's full `pnpm test` after the fix: 15 files, 154 passed, 2 skipped, 0 failed |

### Key Link Verification

All ten links from the initial report were re-checked by grep; none changed. The one link the fix touches is listed first.

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `prefixes.ts planKeyPrefixes` | `KeyPrefixError` (persisted vs standard) | loop over `input.persisted` before pass 1 | ✓ WIRED | lines 105-113; uses `describe(other)`; thrown inside `withTransaction` via `reconcileKeyPrefixes` → ROLLBACK |
| `main.ts up()` | `KeyPrefixError` | `instanceof` catch, `error:` + hint, return 1 | ✓ WIRED | 99-103, 119-124; hint constant 60 (widened) |
| `prefixes.ts` | `internal.ts` | `ensureInternalSchema` first inside transaction | ✓ WIRED | 245 |
| `prefixes.ts` | `_orglet.key_prefixes` | `CREATE TABLE IF NOT EXISTS` + `INSERT` in same transaction | ✓ WIRED | 246, 272 |
| `prefixes.ts` | `SObjectDef.keyPrefix` | in-place mutation after INSERTs | ✓ WIRED | 277-281 |
| `prefixes.ts` | `pg_advisory_xact_lock` | per-org lock after constant lock, before reads | ✓ WIRED | 247 |
| `main.ts up()` | `reconcileKeyPrefixes` | between `SELECT 1` and `migrate` | ✓ WIRED | 110 / 118 / 127 |
| `main.ts reset()` | `dropKeyPrefixes` | only when `--drop-prefixes` | ✓ WIRED | unchanged |
| `main.ts check()` | `SObjectDef.keyPrefix` | `(provisional)` lines, no pool | ✓ WIRED | 77-79 |
| `api.test.ts` / `describe.ts` | `reconcileKeyPrefixes` / `obj.keyPrefix` | before migrate / read at request time | ✓ WIRED | unchanged |

### Data-Flow Trace (Level 4)

Unchanged from the initial report; the fix adds no data variable. `persisted` (from `SELECT object_name, key_prefix FROM _orglet.key_prefixes WHERE org_schema = $1`) now additionally feeds the D-03 comparison before it feeds `obj.keyPrefix`. ✓ FLOWING.

### CONTEXT Decisions D-01..D-18

| Decision | Status | Change since initial report |
| -------- | ------ | --------------------------- |
| D-03 only custom persisted; standard compared on every up | ✓ (was ⚠ PARTIAL) | persisted rows now compared against every standard prefix on every load (`prefixes.ts:105-113`); probe case B confirms it runs even with no custom objects to plan |
| D-09 every contradiction is a hard error, nothing written | ✓ | one more throw site, same `withTransaction` rollback |
| D-18 `KeyPrefixError`, `error: <msg>` + one hint, exit 1, no stack, not `UNSUPPORTED:*` | ✓ | hint text widened (only user-visible string change in the fix); still one hint line, same catch path |
| D-01, D-02, D-04..D-08, D-10..D-17 | ✓ | untouched by `4ce2fe8` (diff limited to the planner loop, one test, one constant); supporting tests green this run |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Prefix module, CLI and build tests pass after the fix | `pnpm vitest run packages/schema/src/prefixes.test.ts packages/cli/src/main.test.ts packages/metadata/src/build.test.ts` | 3 files, 45 passed, 1 skipped (Postgres-only concurrency test), 0 failed | ✓ PASS |
| D-03 persisted-vs-standard re-check (the previously failing probe) | `tsx` probe calling `planKeyPrefixes` with persisted `Foo__c 01m` + standard `BusinessHours 01m` | `KeyPrefixError: persisted key prefix 01m of Foo__c collides with standard object BusinessHours (01m)` | ✓ PASS (was ✗ FAIL) |
| Non-colliding persisted prefix still silent | same probe, persisted `a00` | `{ assignments: [], warnings: [] }` | ✓ PASS |
| Old hint wording no longer in source | `grep -rn "stale assignments can be removed" --include=*.ts` | 0 hits in code; only in 02-02-PLAN / 02-02-SUMMARY / 02-03-SUMMARY as historical smoke-run output | ✓ PASS |
| Full suite, build, lint | orchestrator-run after the fix: `pnpm test` 15 files / 154 passed / 2 skipped / 0 failed; `pnpm build` 0; `pnpm lint` 0 | accepted as documented | ✓ PASS |
| Docker Postgres suite, CLI smoke, devrandom restart | not re-run (no server start allowed; devrandom on 8180 and the `devrandom`/`org` schemas left alone) | recorded in 02-03-SUMMARY | ? SKIP (documented evidence accepted) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| PREFIX-01 | 02-01, 02-02, 02-03 | Prefix assigned on first `up`, stored in `_orglet`, reload with new/renamed object never changes an existing prefix | ✓ SATISFIED | Truth 1 (unchanged) |
| PREFIX-02 | 02-01, 02-02, 02-03 | Existing org keeps old alphabetical assignments on first upgrade | ✓ SATISFIED | Truth 2 (unchanged) |
| PREFIX-03 | 02-01, 02-03 | Persisted custom prefix can never collide with a standard or another custom prefix; collision fails load with clear error | ✓ SATISFIED (was ⚠ PARTIAL) | Truth 3 + Truth 5: new claims and already-persisted rows are both checked against standard prefixes on every load; custom-vs-custom covered by planner + DB UNIQUE |
| PREFIX-04 | 02-01, 02-02, 02-03 | `check` reports provisional; `reset` keeps assignments unless asked to drop | ✓ SATISFIED | Truth 4 (unchanged) |

Orphaned requirements: none.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| `packages/schema/src/prefixes.ts` | 183, 288 | `warnings: []` always empty | ℹ Info | By design (every contradiction throws); kept in the contract for the CLI loop |
| `packages/cli/src/main.ts` | 103, 123 | `return 1` without `pool.end()` | ℹ Info | Mirrors the existing Postgres-unreachable branch; `index.ts` exits the process |
| `packages/schema/src/prefixes.ts` | 105-113 | persisted row for a *removed* custom object can still block `up` if a later baseline takes its prefix | ℹ Info | Correct per D-03 + D-13; hint names both remedies. Not a gap. |

The previous ⚠ Warning (persisted overwrite without check at 104-105) is gone. No TODO/FIXME/placeholder markers, no `UNSUPPORTED:*` strings, no `err.stack` in any phase file.

### Human Verification Required

None. The devrandom checkpoint and the Docker/CLI smoke evidence from 02-03-SUMMARY remain valid: the fix changes no behaviour for orgs whose persisted prefixes are all in `a00..azz` (devrandom: `a00`, `a01`), which cannot collide with any standard prefix.

### Gaps Summary

No gaps. The single partial gap from the initial verification (D-03 / PREFIX-03: persisted custom prefixes not re-checked against standard prefixes on every load) is closed by commit `4ce2fe8`: a loop in `planKeyPrefixes` placed before pass 1 rejects any persisted row whose prefix a standard object in the loaded schema carries, naming both parties; it throws inside the reconcile transaction so nothing is written; the CLI surfaces it through the existing `KeyPrefixError` path with a hint that now mentions the stored row. A unit test covers the case, the previously failing probe now throws, the non-colliding path is unchanged, and the three affected test files plus the orchestrator's full suite, build and lint are green. All five truths, all artifacts, all key links and all four requirements verified. Phase goal achieved.

---

_Verified: 2026-10-02T13:52:00Z_
_Verifier: Claude (gsd-verifier)_
