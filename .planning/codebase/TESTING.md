# Testing Patterns

**Analysis Date:** 2026-11-03

## Test Framework

**Runner & Config:**
- Vitest 3.2.7 (root devDependency `^3.2.0`).
- Single workspace-wide config: `vitest.config.ts` at the root.
- Test environment: `node` (no browser).
- Configuration:
  ```typescript
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    testTimeout: 30_000,        // Schema migrations against Postgres in Docker take seconds
    hookTimeout: 60_000,        // beforeAll/afterAll for DB setup
    maxWorkers: 3,              // When ORGLET_DATABASE_URL set (real Postgres); pglite is per-file
  }
  ```

**Assertions:**
- `expect` from vitest (no separate assertion library).
- Run command: `pnpm test` (workspace root).

**Type Checking for Tests:**
- `tsconfig.test.json` (non-composite, `noEmit: true`).
- `@orglet/*` path alias to each package's `src/index.ts` for fast source-time imports without a build step.
- Includes: `packages/*/src/**/*.test.ts`, `packages/*/test/**/*.ts`, `test/**/*.ts`, `vitest.config.ts`, `eslint.config.js`, `scripts/**/*.ts`.

## Test File Organization

**Locations:**
- **Co-located:** `packages/*/src/**/*.test.ts` (primary pattern) — test file sits next to the module it tests, e.g. `packages/engine/src/engine.test.ts`, `packages/schema/src/migrate.test.ts`.
- **Shared test utilities:** `packages/*/test/**/*.test.ts` — when a package has reusable fixtures or helpers (currently only `test/db.ts` at the root, which is auto-included in `vitest.config.ts`).

**File Counts:**
- 55 test files across the codebase.
- 841 `it(...)`/`test(...)` calls across those files (counted 2026-11-03; vitest reports ~920 cases including parameterised ones).
- No test files are marked `it.skip`, `it.fails`, or `it.todo` (one historical reference in a comment).

**Naming Convention:**
- Descriptive test names that read as assertions about business logic, not function names.
- Good: `"selects canonical columns with the soft-delete filter and case-insensitive object names"` (tells you what invariant is being checked).
- Bad: `"compiles a query"` (just repeats the function name).

## Test Backend: pglite vs. Postgres

**Default: Embedded pglite (no Docker required)**
- When `ORGLET_DATABASE_URL` is **not** set, each test file gets its own in-memory pglite instance via `openTestDb()`.
- Accessed through the `pg` client pool (so tests use the same interface as production).
- Backend implementation: `@electric-sql/pglite` + `@electric-sql/pglite-socket` (single query queue per server to avoid interleaved-transaction deadlocks).
- Per-file isolation: pglite runs one instance per test file, never shared, so no cross-test pollution.

**Real Postgres (CI only)**
- When `ORGLET_DATABASE_URL` is set, all tests use a real Postgres server.
- Required for matrix conformance tests (`.github/workflows/ci.yml` `conformance` job).
- CI services: `postgres:16-alpine` with health checks.

**Worker Configuration:**
- `maxWorkers: 3` only when `ORGLET_DATABASE_URL` is set (real Postgres).
- Default (pglite): unlimited workers per test file.
- Rationale: A v2 org schema holds ~500 relations and ~190 foreign keys, all created in one transaction (~700 locks). Many files migrating schemas in parallel exhaust Postgres's lock table. pglite is per-file, so no conflict.

**Switching Backends:**
- Implementation in `test/db.ts`:
  - `usingPglite` constant: `true` when `databaseUrlFromEnv() === undefined`.
  - `openTestDb()` returns a `TestDb` with `pool` and `close()` callback.
  - Postgres-only tests skip conditionally with vitest's `skip(usingPglite, "Postgres-only: ...")` inside the test body (e.g. `packages/schema/src/prefixes.test.ts`, `packages/schema/src/pglite-compat.test.ts`); nothing is skipped statically.

## Shared Test Utilities

**`test/db.ts` — Test Database Factory:**
- Provides `openTestDb(): Promise<TestDb>` — returns pool + close callback.
- Handles the pglite-socket workaround (extended-protocol error filter) to work around a pglite bug present in ≤0.5.10/pglite-socket ≤0.2.13.
  - Issue: When an extended-protocol message fails, pglite sends `ErrorResponse + ReadyForQuery` immediately instead of waiting for a `Sync`, causing the client to think the query is done and send the next query, leaving the protocol desynchronized.
  - Solution: Install a filter on the pglite-socket server to drop premature `ReadyForQuery` messages until the client's `Sync`.
  - Removable once upstream fix (pglite PR #1144) is released.
- Export: `usingPglite: boolean` for conditional test skipping.

**Test Fixtures:**
- Paths to example projects: `const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url))`.
- Used in every Postgres-backed test file to load schema: `await loadOrgSchema({ projectDir: ACME })`.

## Test Structure

**Setup & Teardown:**
```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openTestDb, type TestDb } from "../../../test/db.js";

let testDb: TestDb;
let pool: Pool;
let schema: OrgSchema;

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  schema = (await loadOrgSchema({ projectDir: ACME })).schema;
  await migrate(pool, schema, { orgSchema });
  // ... additional setup
});

afterAll(async () => {
  await testDb.close();
});

describe("moduleName", () => {
  it("describes the business logic being tested", async () => {
    // test body
  });
});
```

**Suite Organization:**
- `describe(module or feature name, () => { ... })` groups related tests.
- `it(invariant description, async () => { ... })` for individual test cases.
- Tests are `async` because all DB operations are async (`await`).

**Assertions Pattern:**
- Use `expect(...)` from vitest for all assertions.
- Assertions verify the critical path, not every detail:
  ```typescript
  expect(q.sobject.name).toBe("Account");
  expect(q.sql).toContain('FROM "org"."account" t0');
  expect(q.shape.kind === "sobject" && q.shape.fields.map(f => f.name)).toEqual(["Id", "Name", "Industry"]);
  ```

## Mocking & Stubbing

**No Mocking Framework:**
- No mock library imported or used in the test suite (vitest has built-in mock support but it's not used).
- Tests call real code paths and hit real Postgres (via pglite or CI Postgres).

**Testing Real Behavior:**
- Stubs are achieved through dependency injection (passing test doubles as constructor arguments or function parameters).
- Example: custom executor passed to `DmlEngine` constructor to capture hook execution order:
  ```typescript
  const hookLog: string[] = [];
  const engine = new DmlEngine(pool, schema, {
    executors: [
      {
        run: (ctx: TriggerContext) => {
          hookLog.push(`${ctx.timing}:${ctx.operation}:${ctx.sobject.name}`);
          // test assertions on hookLog
          return Promise.resolve();
        },
      },
    ],
  });
  ```

## Test Types

**Unit Tests:**
- Pure function tests (e.g., SOQL compilation, formula evaluation).
- Located in the package where the function lives.
- Example: `packages/soql/src/compile.test.ts` tests `compileSoql(soql: string): CompiledQuery` against many SOQL variants (joins, children, date literals, aggregates, polymorphic references).

**Integration Tests:**
- DML pipeline tests (end-to-end from insert/update/upsert/delete to Postgres and triggers).
- Schema migration tests (DDL planning and execution).
- Located in the engine and schema packages: `packages/engine/src/engine.test.ts`, `packages/schema/src/migrate.test.ts`.
- Hit real Postgres and exercise the full order of execution (before-hooks, coercion, validation, after-hooks, roll-ups, parent/child recomputation).

**E2E Conformance Tests (Not in Core Test Suite):**
- Run against a live orglet server by real client SDKs (jsforce, simple-salesforce).
- Located under `conformance/`: jsforce, python, describe-check, poly-check, rollup-check, cmdt-check.
- CI job: `.github/workflows/ci.yml` `conformance` job (matrix over `examples/acme` and `examples/enterprise`).
- See CONFORMANCE section below.

## Baseline Fixtures & Snapshots

**Baseline Standard Objects:**
- Stored in `packages/metadata/standard/` (DDL, field metadata, picklist values, validation rules as JSON).
- Auto-generated from Salesforce public documentation via `packages/metadata/standard/generate.mjs` (sourced from the official Salesforce describe call specs).
- Committed to the repo; committed baseline == regeneration from committed inputs is verified in CI (`baseline-gen-check` job).
- Not manually edited; changes require updating the generation script.

**Upgrade Fixtures:**
- `packages/metadata/standard/baseline-v1.0/` snapshots the baseline state at release v1.0, used in test comparisons to verify forward compatibility.

## Conformance Tests

**Scope:**
- Run real client SDKs against a locally-hosted orglet instance against `examples/acme` and `examples/enterprise` fixtures.
- Verifies that clients cannot tell the difference for the surface orglet claims to support.

**Suites under `conformance/`:**

1. **jsforce core & Bulk API 2.0** (`conformance/jsforce/`)
   - Harness: `conformance/jsforce/run.sh` (bash script).
   - SDK: jsforce pinned at commit `JSFORCE_SHA=9bae14ea...` (3.10.26, 2026-09-22).
   - Runs Jest test suite on core CRUD, metadata, sobject, query tests + Bulk v2 tests.
   - Results: acme 51/60 passed (9 excluded), enterprise 50/61 passed (1 additional enterprise-only exclusion).
   - Exclusions documented in `conformance/jsforce/README.md` (Bulk v1, SOSL, UI API, etc.).

2. **simple-salesforce** (`conformance/python/`)
   - Harness: `conformance/python/run.py` (Python script).
   - Version: simple-salesforce 1.12.10.
   - Results: 29/29 passed.
   - Runs Python scripts against the running orglet instance.

3. **describe-check** (`conformance/describe-check/`)
   - Verifies `describe` calls (object and field metadata) match expected schema.
   - Tests both jsforce and simple-salesforce implementations.
   - Results: 32/32 (acme), 38/38 (enterprise) per SDK.

4. **poly-check** (`conformance/poly-check/`)
   - Polymorphic relationship tests (Owner field across Account, Case, etc.).
   - Results: 5/5 (acme), 6/6 (enterprise) per SDK.

5. **rollup-check** (`conformance/rollup-check/`)
   - Roll-up summary field tests.
   - Results: 5/5 (acme), 6/6 (enterprise) per SDK.

6. **cmdt-check** (`conformance/cmdt-check/`)
   - Custom metadata type CRUD tests.
   - Results: 8/8 per SDK.
   - Runs against a separate server and schema (`cmdt-check/project`).

**Running Conformance Tests:**
- Manual: `PORT=8094 ORG_SCHEMA=final7 conformance/run-all.sh` (starts its own orglet server, runs all checks, stops server).
- CI: `.github/workflows/ci.yml` `conformance` job (matrix over projects, real Postgres service).
- Both `examples/acme` and `examples/enterprise` tested in CI (matrix-driven).

## CI Jobs

**`.github/workflows/ci.yml` — Full Pipeline:**

1. **`test-pglite` job:**
   - Runs without a Postgres service (uses embedded pglite).
   - Steps: checkout → install deps → build → lint → typecheck scripts → run unit/integration tests.
   - Includes `orglet check --strict --project examples/enterprise` (diagnostics check).

2. **`test-postgres` job:**
   - Uses a real postgres:16-alpine service.
   - Steps: checkout → install deps → build → lint → run tests (against real Postgres).
   - Verifies behavior on real Postgres (not just pglite).
   - Confirms `maxWorkers: 3` doesn't cause issues.

3. **`conformance` job (matrix):**
   - Matrix over `examples/acme` and `examples/enterprise`.
   - Uses real postgres:16-alpine service.
   - Steps: checkout → install deps → build → cache jsforce binary → venv Python → run `conformance/run-all.sh`.
   - Runs 8 conformance checks per project (jsforce core, Bulk v2, jsforce describe, simple-salesforce describe, poly, rollup, cmdt).

4. **`sigha-sync-check` job:**
   - Verifies the vendored formula-language package (sigha) is bit-for-bit reproducible from the pinned commit.
   - Runs `scripts/sync-sigha.sh` into a temp dir, diffs against committed `packages/sigha/src`.
   - Fails if the vendored copy would diverge on re-sync.
   - No manual edits to `packages/sigha/src/**` are allowed (Phase 1 D-18).

5. **`baseline-gen-check` job:**
   - Verifies committed baseline == regeneration from committed inputs (D-18/SC1).
   - Runs `pnpm baseline:gen`, diffs against committed `packages/metadata/standard/`.
   - Fails if any untracked files appear in the standard objects directory.

## Test Coverage

**Coverage Metrics:**
- Not explicitly required (`coverage` option not set in vitest config).
- ~840 `it(...)` cases covering core DML, SOQL, formulas, schema, API routes, and conformance.

**High-Coverage Areas:**
- DML pipeline: `packages/engine/src/engine.test.ts` plus the per-feature engine test files (`rollup*.test.ts`, `null-prefix.test.ts`, polymorphic and formula tests) cover order of execution, triggers, validation, roll-ups.
- SOQL compilation: `packages/soql/src/compile.test.ts` (100+ test cases covering joins, parents, children, date literals, aggregates, polymorphic references, TYPEOF).
- Formulas: `packages/formula/src/compile.test.ts` (formula parsing, type inference, function calls).
- Schema: `packages/schema/src/migrate.test.ts` (DDL planning, type widening, virtual fields).

**Conformance (Real SDKs):**
- Hundreds of additional test cases through jsforce and simple-salesforce against the full API surface.
- Real client libraries exercise paths that unit tests may miss.

## No Skipped or Failing Tests

- Current test suite has no `it.skip`, `it.fails`, or `it.todo` markers.
- One historical reference in `packages/formula/src/expectations.test.ts` comment (formerly `it.fails`, D-05, fixed by Phase 12 sigha resync).
- All test cases are active; none is marked skip, fails or todo.

---

*Testing analysis: 2026-11-03*
