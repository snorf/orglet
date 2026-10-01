---
phase: 01-test-infrastructure-ci
plan: 01
subsystem: testing
tags: [pglite, pglite-socket, vitest, postgres, pg, ci]

# Dependency graph
requires: []
provides:
  - "test/db.ts: openTestDb()/usingPglite, the single per-file test backend switch (pglite when ORGLET_DATABASE_URL is unset, real Postgres otherwise)"
  - "packages/schema/src/db.ts: databaseUrlFromEnv() with no default (string | undefined)"
  - "packages/cli/src/main.ts: the relocated postgres://orglet:orglet@localhost:5433/orglet default"
  - "packages/schema/src/pglite-compat.test.ts: the D-19 compatibility check, outcome recorded PASS"
  - "All five DB-backed test files (migrate, engine, query, api, bulk) running on openTestDb()"
affects: [01-02-github-actions-ci, 01-03-real-postgres-preflight]

# Tech tracking
tech-stack:
  added: ["@electric-sql/pglite@0.5.8 (root devDependency, exact pin)", "@electric-sql/pglite-socket@0.2.11 (root devDependency, exact pin)"]
  patterns:
    - "Per-test-file embedded pglite instance (not a shared globalSetup instance), reached through the existing pg pool over pglite-socket bound to port 0"
    - "One backend-detection signal (usingPglite in test/db.ts, D-21) used everywhere a Postgres-only test needs a runtime skip(condition, reason)"

key-files:
  created: [test/db.ts, packages/schema/src/pglite-compat.test.ts]
  modified: [package.json, pnpm-lock.yaml, tsconfig.test.json, packages/schema/src/db.ts, packages/cli/src/main.ts, packages/schema/src/migrate.test.ts, packages/engine/src/engine.test.ts, packages/engine/src/query.test.ts, packages/api/src/api.test.ts, packages/api/src/bulk.test.ts, .planning/codebase/TESTING.md]

key-decisions:
  - "D-19 outcome: PASS (2026-09-30) — session_replication_role and information_schema queries all work correctly on pglite 0.5.8; no production or test-assertion workaround needed."
  - "Per-file pglite instance, not a shared globalSetup instance, per Claude's Discretion in 01-CONTEXT.md — matches the research recommendation and avoids the measured single-query-queue serialization hazard of a shared instance."

patterns-established:
  - "New DB-backed test files should call openTestDb() from test/db.ts in beforeAll and testDb.close() in afterAll, keeping the existing test_<hex> schema-per-file pattern as-is."

requirements-completed: [INFRA-01, INFRA-02, INFRA-03]

# Metrics
duration: 11min
completed: 2026-09-30
---

# Phase 1 Plan 1: pglite Test Backend Summary

**`pnpm test` runs the full 13-file suite with zero Docker dependency via a per-file embedded pglite (0.5.8) behind pglite-socket (0.2.11), with the D-19 `session_replication_role`/`information_schema` compatibility question settled PASS in a dedicated test committed before any DB-backed file was migrated.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-09-30T19:25:00Z (approx.)
- **Completed:** 2026-09-30T19:35:30Z
- **Tasks:** 3
- **Files modified:** 11 (2 created, 9 modified)

## Accomplishments
- Added pinned `@electric-sql/pglite@0.5.8` / `@electric-sql/pglite-socket@0.2.11` as root-only devDependencies (no production package depends on pglite — verified by static grep)
- `test/db.ts`: `openTestDb()`/`usingPglite`, one pglite instance per test file over pglite-socket on `port: 0`, or the real Postgres pool when `ORGLET_DATABASE_URL` is set
- `databaseUrlFromEnv()` no longer defaults to `localhost:5433`; the CLI (`packages/cli/src/main.ts`) now owns that fallback (D-10)
- `packages/schema/src/pglite-compat.test.ts`: dedicated D-19 test — passed 4/5 with the fifth (concurrent transactions) visibly skipped on pglite with its reason string; outcome recorded in `.planning/codebase/TESTING.md` **before** any of the five DB-backed files were touched
- All five DB-backed test files (`migrate`, `engine`, `query`, `api`, `bulk`) moved from `createPool(databaseUrlFromEnv())` to `openTestDb()`/`testDb.close()` — pool lifecycle only, no assertion or timeout changes
- Full suite green on pglite with no Docker running: `Test Files 13 passed (13)`, `Tests 123 passed | 1 skipped (124)`; `pnpm lint` and `pnpm build` both green

## Task Commits

Each task was committed atomically (`--no-verify`, parallel-executor protocol):

1. **Task 1: Add pinned pglite deps, the test backend helper, and move the 5433 default to the CLI** - `dd98b1f` (feat)
2. **Task 2: D-19 compatibility test on pglite, and record the outcome before any file migration** - `4baf848` (test)
3. **Task 3: Move the five DB-backed test files onto openTestDb() and run the full suite on pglite** - `519fec7` (refactor)

Ordering proof: `4baf848` (compat test + TESTING.md) contains none of the five migrated test files (`git show --stat 4baf848` lists only `pglite-compat.test.ts` and `TESTING.md`); the migration commit `519fec7` lists exactly the five DB-backed files and nothing else (`git diff HEAD~1 --stat` after `519fec7`).

_Note: this plan ran as a parallel executor alongside 01-02 (GitHub Actions CI / docs); commits `e1c77d3`, `2a7e09d`, `49354bc` visible between `dd98b1f`/`4baf848`/`519fec7` in `git log` belong to that plan and touch no files shared with this one._

## Files Created/Modified
- `test/db.ts` (new) - `openTestDb()`/`usingPglite`/`TestDb`, the one test-backend switch (D-09, D-21)
- `packages/schema/src/pglite-compat.test.ts` (new, 95 lines) - D-19 compatibility check; PASS, one Postgres-only test skipped with reason
- `packages/schema/src/db.ts` - `databaseUrlFromEnv(): string | undefined`, default removed
- `packages/cli/src/main.ts` - server path now supplies the `localhost:5433` fallback
- `package.json`, `pnpm-lock.yaml` - pinned `@electric-sql/pglite`/`@electric-sql/pglite-socket` as root devDependencies
- `tsconfig.test.json` - `test/**/*.ts` added to `include` so `test/db.ts` gets type-aware lint
- `packages/schema/src/migrate.test.ts`, `packages/engine/src/engine.test.ts`, `packages/engine/src/query.test.ts`, `packages/api/src/api.test.ts`, `packages/api/src/bulk.test.ts` - pool lifecycle moved to `openTestDb()`/`testDb.close()`
- `.planning/codebase/TESTING.md` - database-backend description rewritten, file count 12→13, D-19 outcome section added, isolation section updated, "no CI config" line corrected

## Decisions Made
- Per-file pglite instance (each test file starts and tears down its own `PGlite`/`PGLiteSocketServer`), not a shared `globalSetup` instance — matches the pre-verified plan and the research's measured finding that a shared instance serialises/hangs across vitest's parallel forked workers.
- D-19 resolved PASS with no production-code or assertion changes; the one Postgres-only test (two interleaved open transactions) uses the D-20 runtime-skip mechanism via `usingPglite`, never a static `.skip`.

## Deviations from Plan

None - plan executed exactly as written. All file contents, greps, and expected test counts matched the plan's pre-verification exactly (`Test Files 13 passed (13)`, `Tests 123 passed | 1 skipped (124)`).

## Issues Encountered

**Full-suite `pnpm test` failed under load with `ECONNRESET` in the compatibility test's `afterAll` (5 of 5 runs at load average 8-13; isolated runs always green). Root-caused and fixed by the orchestrator in `a8e411f`.**

The Task 3 gate passed at commit time (`Test Files 13 passed (13)`, `Tests 123 passed | 1 skipped (124)`, lint and build green). A later re-run failed reproducibly in `packages/schema/src/pglite-compat.test.ts`: all tests pass, then `afterAll`'s `DROP SCHEMA` throws `read ECONNRESET`.

Root cause (verified with stress probes in the scratchpad): `PGLiteSocketServer` accepts **one** connection by default (`maxConnections ?? 1`). `pg-pool` destroys a client after a failed `pool.query` and opens a new connection immediately; the compat test's FK-violation assertion is exactly such a failed query, and it is the last real test before `afterAll`. When the server processes the new connection before the old socket's `close` event (both are deferred with `setImmediate`, ordering depends on event-loop lag), it answers `Too many connections` and ends the socket, and the next query fails with `ECONNRESET`. With `maxConnections: 1`, 3 parallel stress runs of 200 destroy-and-reconnect cycles gave 7-9 failures each; with `maxConnections: 8`, 0 of 600.

Fix: `test/db.ts` passes `maxConnections: 10` (the `pg.Pool` default `max`) to `PGLiteSocketServer`, with a comment. Queries are still served one at a time. After the fix: 3 of 3 full-suite runs green at load average up to 19.5, `pnpm lint` and `pnpm build` green. Machine load was a trigger, not the cause.

## User Setup Required

None - no external service configuration required. (Real-Postgres verification and `orglet up` smoke test are explicitly deferred to plan 01-03 per the plan's `<success_criteria>`.)

## Next Phase Readiness

- `test/db.ts` and the `openTestDb()` pattern are ready for plan 01-03's real-Postgres pre-flight run (`pnpm db:up && ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test`), not yet executed as part of this plan.
- CI workflow (plan 01-02, running in parallel) can reference `test/db.ts` and the `ORGLET_DATABASE_URL`-unset/-set split directly; no coordination needed since no files overlap.
- No blockers.

---
*Phase: 01-test-infrastructure-ci*
*Completed: 2026-09-30*

## Self-Check: PASSED

All files referenced above (`test/db.ts`, `packages/schema/src/pglite-compat.test.ts`, `packages/schema/src/db.ts`, `packages/cli/src/main.ts`, `tsconfig.test.json`, `.planning/codebase/TESTING.md`, this SUMMARY) confirmed present on disk. All three task commit hashes (`dd98b1f`, `4baf848`, `519fec7`) confirmed present in `git log`.
