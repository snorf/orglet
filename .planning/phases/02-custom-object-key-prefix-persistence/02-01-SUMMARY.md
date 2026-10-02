---
phase: 02-custom-object-key-prefix-persistence
plan: 01
subsystem: database
tags: [postgres, key-prefix, advisory-lock, schema, vitest, pglite]

# Dependency graph
requires:
  - phase: 01-test-infrastructure-ci
    provides: test/db.ts (openTestDb, usingPglite) so the DB-backed tests run on pglite and on Docker Postgres
provides:
  - "@orglet/schema: planKeyPrefixes (pure two-pass planner), parseKeyPrefixMapping (pure --key-prefixes validator), KeyPrefixError"
  - "@orglet/schema: reconcileKeyPrefixes (one transaction: ensureInternalSchema -> CREATE TABLE IF NOT EXISTS _orglet.key_prefixes -> per-org advisory lock -> read rows -> scan existing tables -> plan -> INSERT -> mutate SObjectDef.keyPrefix)"
  - "@orglet/schema: dropKeyPrefixes(pool, orgSchema) removing one org's rows, safe when the table does not exist"
  - "@orglet/schema: ensureInternalSchema(client) (D-06) for any later _orglet bookkeeping (Bulk jobs, phase 6)"
affects: [02-02 CLI wiring, 02-03 API test, 06-bulk-persistence]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Internal bookkeeping lives in the sibling schema _orglet, created under a constant pg_advisory_xact_lock(hashtext('_orglet')) so concurrent CREATE SCHEMA IF NOT EXISTS cannot race"
    - "Per-org serialisation with pg_advisory_xact_lock(hashtext(table), hashtext(orgSchema)) taken after the constant lock (fixed lock order, deadlock-free)"
    - "Pure planner + thin DB wrapper: every precedence/collision rule is unit-tested without a database"

key-files:
  created:
    - packages/schema/src/internal.ts
    - packages/schema/src/prefixes.ts
    - packages/schema/src/prefixes.test.ts
  modified:
    - packages/schema/src/index.ts

key-decisions:
  - "Task 2 stubs were written as non-async functions returning Promise.reject so lint (@typescript-eslint/require-await) stayed green between tasks"
  - "PREFIX-04 is not marked complete by this plan: its storage half (rows survive DROP SCHEMA, dropKeyPrefixes per org) is done, but the `orglet check` / `reset --drop-prefixes` CLI half lands in plan 02-02"
  - "BigTable__c is inserted with no fields in the record-seeding tests because its Name is an AutoNumber; the plan's { Name: 'legacy' } fixture is rejected by the engine with INVALID_FIELD_FOR_INSERT_UPDATE"

patterns-established:
  - "KeyPrefixError.claims carries every party to a conflict (objectName, keyPrefix, source) so the CLI can name both objects and both values"
  - "planKeyPrefixes assignments are always in custom-object name order regardless of which pass decided them"

requirements-completed: [PREFIX-01, PREFIX-02, PREFIX-03]

# Metrics
duration: 8min
completed: 2026-10-01
---

# Phase 02 Plan 01: Key-Prefix Persistence Module Summary

**Custom-object key prefixes persisted in `_orglet.key_prefixes` via a pure two-pass planner (records > mapping > provisional > next-free) and a single-transaction `reconcileKeyPrefixes` that mutates `SObjectDef.keyPrefix` in place, plus `dropKeyPrefixes` for per-org reset**

## Performance

- **Duration:** 8 min
- **Started:** 2026-10-01T12:36:59Z
- **Completed:** 2026-10-01T12:45:28Z
- **Tasks:** 2 (both TDD: RED commit, then GREEN commit)
- **Files modified:** 4

## Accomplishments
- `planKeyPrefixes` settles every records/mapping claim for every custom object before handing out any provisional prefix, so a newcomer that sorts first (Aardvark__c) cannot steal `a00` from an object whose records already carry it (Pitfall 1 covered by a dedicated test)
- Every D-09 contradiction (mapping vs standard, mapping vs persisted, mapping vs records, ambiguous records, duplicate mapping entries) throws `KeyPrefixError` naming both parties; `withTransaction` rolls the reconcile back so zero rows are written
- `reconcileKeyPrefixes` on an upgraded org with no rows seeds from `SELECT DISTINCT left(id, 3)` of existing tables (source `records`), and existing Ids remain valid for `update`
- Rows survive `DROP SCHEMA <org> CASCADE` because `_orglet` is a sibling schema (D-01); `dropKeyPrefixes` removes exactly one org's rows and returns the count

## Final exported contract (`@orglet/schema`)

```typescript
export { ensureInternalSchema } from "./internal.js";
export { KeyPrefixError, planKeyPrefixes, parseKeyPrefixMapping, reconcileKeyPrefixes, dropKeyPrefixes } from "./prefixes.js";
export type { KeyPrefixSource, KeyPrefixClaim, KeyPrefixAssignment, KeyPrefixPlanInput, KeyPrefixPlan, ReconcileKeyPrefixesOptions, ReconcileKeyPrefixesResult } from "./prefixes.js";

reconcileKeyPrefixes(pool, schema, { orgSchema?, mapping? }): Promise<{ assignments: KeyPrefixAssignment[]; warnings: string[] }>
dropKeyPrefixes(pool, orgSchema): Promise<number>
parseKeyPrefixMapping(raw: unknown, schema: OrgSchema): Record<string, string>   // canonical API-name keys
planKeyPrefixes({ custom, standard, persisted, observed, mapping }): { assignments, warnings }
```

## Test results

- pglite (`pnpm vitest run packages/schema/src/prefixes.test.ts`): 26 passed, 1 skipped (the Postgres-only "concurrent" test), 0 failed
- Docker Postgres (`ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet`, container already running): 27 passed, 0 skipped, 0 failed
- Full suite on pglite (`pnpm vitest run`): 14 files, 149 passed, 2 skipped
- `pnpm build` and `pnpm lint` exit 0

## Task Commits

Each task was committed atomically (TDD: test commit, then feat commit):

1. **Task 1: Contracts, KeyPrefixError, pure planner and mapping parser, ensureInternalSchema, barrel exports** - `ac5c283` (test, RED) + `0de6836` (feat, GREEN)
2. **Task 2: reconcileKeyPrefixes and dropKeyPrefixes with DB-backed tests** - `c284b26` (test, RED) + `667222a` (feat, GREEN)

## Files Created/Modified
- `packages/schema/src/internal.ts` - `ensureInternalSchema(client)`: constant advisory lock + `CREATE SCHEMA IF NOT EXISTS "_orglet"`
- `packages/schema/src/prefixes.ts` - `KeyPrefixError`, `planKeyPrefixes`, `parseKeyPrefixMapping`, `reconcileKeyPrefixes`, `dropKeyPrefixes`, the `_orglet.key_prefixes` DDL
- `packages/schema/src/prefixes.test.ts` - 12 planner cases, 6 parser cases, 9 DB-backed cases (T1-T8, T10, T12)
- `packages/schema/src/index.ts` - explicit named exports of the new values and types

## Decisions Made
- Task 2 stubs returned `Promise.reject(...)` from non-async functions so `@typescript-eslint/require-await` did not fail lint between tasks (the plan allowed `throw new Error("not implemented")`, which trips that rule inside `async`).
- PREFIX-04 left unchecked in REQUIREMENTS.md: the CLI half (`orglet check` provisional lines, `reset --drop-prefixes`) is plan 02-02's deliverable; only PREFIX-01..03 are marked complete here.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's record-seeding fixture inserted `BigTable__c` with `Name`, which is an AutoNumber**
- **Found during:** Task 2 (RED run of "seeds from existing records" and "sorts before")
- **Issue:** `examples/acme` defines `BigTable__c.Name` as `AutoNumber`, so `engine.insert(..., [{ Name: "legacy" }])` returned `INVALID_FIELD_FOR_INSERT_UPDATE` and `big.id` was undefined — the failure was in the test fixture, not in the module under test
- **Fix:** Insert `BigTable__c` with `[{}]` and update it with `[{ Id }]` only; `UpsertTable__c` (Text `Name`) keeps `{ Name: "legacy" }`
- **Files modified:** packages/schema/src/prefixes.test.ts
- **Verification:** Both tests green on pglite and Postgres; `big.id` matches `/^a00/`
- **Committed in:** 667222a (Task 2 commit)

**2. [Rule 3 - Blocking] Stub shape adjusted for lint**
- **Found during:** Task 1 (`pnpm lint`)
- **Issue:** `async function ... { throw new Error("not implemented") }` fails `@typescript-eslint/require-await`
- **Fix:** Non-async functions returning `Promise.reject(new Error("not implemented"))`; replaced by the real implementation in Task 2
- **Files modified:** packages/schema/src/prefixes.ts
- **Verification:** `pnpm lint` exit 0
- **Committed in:** 0de6836 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug in plan fixture, 1 blocking lint issue)
**Impact on plan:** Neither changes the module contract or the behaviour under test. No scope creep.

## Issues Encountered
None beyond the deviations above.

## Known Stubs
None — `reconcileKeyPrefixes` and `dropKeyPrefixes` are fully implemented; `warnings` is always `[]` by design (every contradiction throws), and the field stays in the contract for plan 02-02's CLI loop.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 02-02 (CLI wiring) can import `reconcileKeyPrefixes`, `dropKeyPrefixes`, `parseKeyPrefixMapping`, `KeyPrefixError` from `@orglet/schema`; `ReconcileKeyPrefixesOptions.mapping` must only be set when defined (`exactOptionalPropertyTypes`).
- Plan 02-03 (API test) can rely on the in-place `SObjectDef.keyPrefix` mutation: construct `DmlEngine`/describe after `reconcileKeyPrefixes`.
- PREFIX-04 completes when 02-02 ships `check` provisional reporting and `reset --drop-prefixes`.

---
*Phase: 02-custom-object-key-prefix-persistence*
*Completed: 2026-10-01*

## Self-Check: PASSED

All 4 created/modified files exist; all 4 task commits (ac5c283, 0de6836, c284b26, 667222a) are in git history.
