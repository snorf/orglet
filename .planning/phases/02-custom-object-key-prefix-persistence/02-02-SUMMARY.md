---
phase: 02-custom-object-key-prefix-persistence
plan: 02
subsystem: cli
tags: [cli, key-prefix, readme, vitest, docs]

# Dependency graph
requires:
  - phase: 02-custom-object-key-prefix-persistence
    plan: 01
    provides: "@orglet/schema reconcileKeyPrefixes, dropKeyPrefixes, parseKeyPrefixMapping, KeyPrefixError"
provides:
  - "orglet up: reconcileKeyPrefixes between the Postgres connectivity check and migrate, optional --key-prefixes <file> seeding, D-18 error path"
  - "orglet check: per-custom-object '(provisional)' prefix lines plus closing sentence, suppressed by --quiet"
  - "orglet reset --drop-prefixes: deletes the org's _orglet.key_prefixes rows and logs the count"
  - "README '## Custom-object key prefixes' section and provisional doc comment on customKeyPrefix"
  - "packages/cli/src/main.test.ts: first CLI test file (no database)"
affects: [02-03 API test, 06-bulk-persistence]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CLI user-facing errors: `error: <message>` on stderr followed by exactly one actionable hint line, return 1, never a stack trace (same shape as the Postgres-unreachable branch)"
    - "CLI tests spy on console.log/console.warn and call main([...]) directly; only DB-free commands are exercised"

key-files:
  created:
    - packages/cli/src/main.test.ts
  modified:
    - packages/cli/src/main.ts
    - packages/metadata/src/build.ts
    - packages/metadata/src/build.test.ts
    - README.md

key-decisions:
  - "--key-prefixes is read and validated before createPool so a bad file fails without touching the database"
  - "reconcileKeyPrefixes runs before migrate (D-04) so a prefix conflict on a fresh database leaves no tables behind"
  - "`return 1` after a KeyPrefixError does not call pool.end(), mirroring the existing Postgres-unreachable branch; index.ts exits the process"

patterns-established:
  - "Exact `up` log line: `assigned key prefix <prefix> to <Object>` with suffix ` from existing records` or ` from --key-prefixes`; provisional/next-free assignments carry no suffix; nothing is logged when every custom object already has a row"
  - "Exact `check` line: two-space indent, two spaces between columns: `  <Object>  <prefix>  (provisional)`"

requirements-completed: [PREFIX-01, PREFIX-02, PREFIX-04]

# Metrics
duration: 6min
completed: 2026-10-01
---

# Phase 02 Plan 02: CLI Wiring and Documentation Summary

**`orglet up` now reconciles custom-object key prefixes against `_orglet.key_prefixes` (with `--key-prefixes <file>` seeding and a stack-free `error:` + hint exit on conflict), `check` labels its prefixes provisional, `reset --drop-prefixes` forgets them, and README documents the whole surface**

## Performance

- **Duration:** 6 min
- **Started:** 2026-10-01T12:48:02Z
- **Completed:** 2026-10-01T12:54:00Z
- **Tasks:** 2 (Task 1 TDD: RED commit, then GREEN commit; Task 2 docs)
- **Files modified:** 5

## Accomplishments
- `up` calls `reconcileKeyPrefixes(pool, loaded.schema, { orgSchema, mapping? })` between `SELECT 1` and `migrate(...)`, so `bootstrapOrg`/`DmlEngine`/describe all see the persisted prefixes and a conflict on a fresh database writes nothing
- `--key-prefixes <file>` is parsed and validated with `parseKeyPrefixMapping` before any connection is opened; unreadable file or invalid entry prints `error: ...` plus one hint line and exits 1
- `check` prints one `  <Object>  <prefix>  (provisional)` line per custom object after the summary line and a closing sentence; `--quiet` suppresses all of it; standard objects are not listed
- `reset` keeps the prefix rows; `reset --drop-prefixes` deletes the org's rows and logs `dropped N key prefix assignment(s) for schema "<org>"`
- README gained `## Custom-object key prefixes`; `customKeyPrefix` doc comment and its test title say provisional

## Exact strings (for plan 02-03 and later phases)

`up` stdout (only for objects that got a new row this run, custom-object name order):
```
assigned key prefix a00 to BigTable__c
assigned key prefix a0X to Project__c from --key-prefixes
assigned key prefix a05 to Legacy__c from existing records
```
No `assigned ...` line at all when every custom object already has a persisted row.

`up` stderr on a KeyPrefixError (exit code 1, no stack trace):
```
error: key prefix a0Y for Project__c (from --key-prefixes) contradicts persisted prefix of Project__c (a0X)
fix the conflicting --key-prefixes entry or the records that carry the prefix; stale assignments can be removed with: orglet reset --drop-prefixes   (this also drops the org's records)
```

`up` stderr on an unreadable `--key-prefixes` file (exit 1):
```
error: cannot read --key-prefixes file /path/key-prefixes.json: ENOENT: no such file or directory, open '/path/key-prefixes.json'
expected a JSON object mapping custom-object API names to 3-character key prefixes, e.g. { "Project__c": "a0X" }
```

`check --project examples/acme` stdout:
```
25 objects (4 custom), 852 fields
  BigTable__c  a00  (provisional)
  Milestone__c  a01  (provisional)
  Project__c  a02  (provisional)
  UpsertTable__c  a03  (provisional)
custom-object key prefixes are provisional here; `orglet up` assigns them once and reads them from the database thereafter
```

`reset --drop-prefixes` stdout:
```
dropped schema "org"
dropped 4 key prefix assignment(s) for schema "org"
```

## Test results

- `pnpm vitest run packages/cli/src/main.test.ts`: 3 passed (RED run before implementation: 2 failed, 1 passed — the `--quiet` case was already silent)
- `pnpm vitest run packages/metadata/src/build.test.ts`: 15 passed
- Full suite on pglite (`pnpm test`): 15 files, 152 passed, 2 skipped, 0 failed
- `pnpm build` and `pnpm lint` exit 0
- Manual end-to-end against Docker Postgres in an isolated schema `p0202smoke` (cleaned up afterwards with `reset --drop-prefixes`): fresh `up` logged four `assigned key prefix ...` lines; second `up` logged none; plain `reset` left 4 rows in `_orglet.key_prefixes`; `up` after that logged none; `reset --drop-prefixes` reported `dropped 4 key prefix assignment(s)` and left 0 rows; `up --key-prefixes {"Project__c":"a0X"}` logged `assigned key prefix a0X to Project__c from --key-prefixes`; a second `up` with `{"Project__c":"a0Y"}` printed the `error:` + hint lines and exited 1 without a stack trace
- `git diff --stat d853ac5..HEAD` touches exactly the five files in `files_modified`

## Task Commits

1. **Task 1: Wire up/check/reset in main.ts and add main.test.ts (T9)** - `95986a7` (test, RED) + `515cc0a` (feat, GREEN)
2. **Task 2: Mark the build.ts scheme provisional and document key prefixes in README** - `58e5130` (docs)

## Files Created/Modified
- `packages/cli/src/main.ts` - `--key-prefixes`/`--drop-prefixes` options, `KEY_PREFIX_HINT`, `sourceSuffix`, reconcile call, two `KeyPrefixError` catches, provisional `check` output, `reset(c, dropPrefixes)`
- `packages/cli/src/main.test.ts` - console-spy tests for `check` (provisional lines, `--quiet`) and `--help`
- `packages/metadata/src/build.ts` - `customKeyPrefix` doc comment only; algorithm untouched
- `packages/metadata/src/build.test.ts` - test title says provisional; assertions unchanged
- `README.md` - new `## Custom-object key prefixes` section between Quick start and Layout; Layout line `orglet up / check / reset`

## Decisions Made
- `--key-prefixes` is read and validated before `createPool`, so a bad file fails fast without a database connection.
- `reconcileKeyPrefixes` runs before `migrate` (D-04): a conflict on a fresh database leaves no tables behind.
- The `return 1` after a `KeyPrefixError` does not `pool.end()`, symmetrical with the existing Postgres-unreachable branch (`index.ts` exits the process).

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## Known Stubs
None. `prefixes.warnings` is always `[]` by design (every contradiction throws); the CLI loop over it is kept per plan 02-01's contract.

## User Setup Required
None.

## Next Phase Readiness
- Plan 02-03 (API test) can rely on the exact `up` log and error strings above and on the in-place `SObjectDef.keyPrefix` mutation happening before `bootstrapOrg`/`DmlEngine` construction in `up`.
- PREFIX-04 is now complete (storage half in 02-01, CLI half here).

---
*Phase: 02-custom-object-key-prefix-persistence*
*Completed: 2026-10-01*

## Self-Check: PASSED

All 5 created/modified files exist; all 3 task commits (95986a7, 515cc0a, 58e5130) are in git history.
