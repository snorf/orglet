# Testing Patterns

**Analysis Date:** 2026-09-29

## Test Framework

**Runner:**
- Vitest 3.2 (`vitest` in root `package.json` devDependencies). Config: `vitest.config.ts` (repo root — there is no per-package vitest config).
- `environment: "node"`, `passWithNoTests: true`, `testTimeout: 30_000`, `hookTimeout: 60_000` — the long timeouts exist because Postgres schema migration in `beforeAll` can take several seconds per file.
- Path aliases for source-level imports: `@orglet/<name>` resolves to `packages/<name>/src/index.ts` (not `dist`), so `pnpm test` never requires a prior `pnpm build`.

**Assertion Library:**
- Vitest's built-in `expect` (Chai-compatible). No separate assertion library.

**Run Commands:**
```bash
pnpm test              # vitest run — all packages, single pass, no watch
pnpm test:watch        # vitest — watch mode
```
There is no `pnpm test:coverage` script and no coverage tool configured (no `@vitest/coverage-*` dependency) — coverage is not measured or enforced.

**Postgres prerequisite:** several test files (see below) need a real Postgres reachable at `ORGLET_DATABASE_URL` (default `postgres://orglet:orglet@localhost:5433/orglet`, see `.env.example`). Start it with `pnpm db:up` (`docker compose up -d postgres`, `docker-compose.yml`) before running `pnpm test`. Tests that need it fail fast in `beforeAll` with an explicit message if it isn't reachable (see Isolation below) rather than hanging or silently skipping.

## Test File Organization

**Location:** co-located with the source they test, inside each package's `src/`, never a separate `test/` directory (though `tsconfig.test.json`'s `include` also allows `packages/*/test/**/*.ts` for future use).

**Naming:** `<name>.test.ts` next to `<name>.ts`, e.g. `packages/engine/src/engine.test.ts` beside `packages/engine/src/engine.ts`, `packages/soql/src/compile.test.ts` beside `packages/soql/src/compile.ts`. `vitest.config.ts` globs `packages/*/src/**/*.test.ts` and `packages/*/src/test/**/*.test.ts`.

**All test files in the repo (12), with line counts and DB dependency:**

| File | Lines | Needs Postgres |
|---|---|---|
| `packages/schema/src/ids.test.ts` | 49 | no |
| `packages/sigha/src/engine/org-conformance.test.ts` | 72 | no |
| `packages/metadata/src/sfdx.test.ts` | 83 | no |
| `packages/formula/src/formula.test.ts` | 117 | no |
| `packages/schema/src/migrate.test.ts` | 119 | **yes** |
| `packages/engine/src/query.test.ts` | 128 | **yes** |
| `packages/soql/src/compile.test.ts` | 138 | no |
| `packages/metadata/src/build.test.ts` | 160 | no |
| `packages/sigha/src/engine/conformance.test.ts` | 208 | no |
| `packages/engine/src/engine.test.ts` | 247 | **yes** |
| `packages/api/src/bulk.test.ts` | 248 | **yes** |
| `packages/api/src/api.test.ts` | 304 | **yes** |

`packages/cli` has no test file — it's exercised end-to-end via manual/conformance runs, not vitest.

## Test Structure

**Suite organization** — a fixture-driven `describe`/`it` structure, schema loaded once per file:
```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadOrgSchema, type OrgSchema } from "@orglet/metadata";
import { compileFormula, FormulaCompileError, type CompiledFormula } from "./compile.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
let schema: OrgSchema;

beforeAll(async () => {
  schema = (await loadOrgSchema({ projectDir: ACME })).schema;
});

const rule = (source: string, objectName = "Account") =>
  compileFormula(source, { schema, objectName, context: "validation_rule" });

describe("compileFormula", () => {
  it("resolves field references case-insensitively to canonical names", () => {
    const c = rule('AND(ISPICKVAL(type, "Customer - Direct"), ISBLANK(WEBSITE))');
    expect(c.references.map((r) => r.key).sort()).toEqual(["Type", "Website"]);
  });
});
```
(`packages/formula/src/formula.test.ts`)

**Patterns:**
- Small local helper functions/closures defined above the `describe` blocks to keep test bodies terse (`rule(...)`, `field(...)`, `run(...)` in `formula.test.ts`; `one(sobject, input)` in `engine.test.ts`; `get/post/patch/del` HTTP helpers in `api.test.ts`).
- `it.each([...])` for table-driven cases over fixed input/output pairs, e.g. known 15↔18-character Salesforce ID conversions in `packages/schema/src/ids.test.ts`.
- Assertions read record data with bracket access (`record["Description"]`) matching the codebase's `Record<string, unknown>` record shape, not dot access.
- No `describe.skip`/`it.skip`/`.only` anywhere in the suite — every test that exists is expected to pass on every run.

## Postgres-Backed Tests: Isolation and Lifecycle

Every Postgres-backed test file (`migrate.test.ts`, `query.test.ts`, `engine.test.ts`, `api.test.ts`, `bulk.test.ts`) follows the same exact pattern:

```typescript
import { randomBytes } from "node:crypto";
import { createPool, databaseUrlFromEnv, migrate, quote, type Pool } from "@orglet/schema";

const orgSchema = `test_${randomBytes(4).toString("hex")}`;  // e.g. test_a1b2c3d4
let pool: Pool;

beforeAll(async () => {
  pool = createPool(databaseUrlFromEnv());
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    throw new Error(`Postgres not reachable at ${databaseUrlFromEnv()} (run \`pnpm db:up\`): ${String(err)}`);
  }
  // ... migrate(pool, schema, { orgSchema }) to build this test's own schema
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${quote(orgSchema)} CASCADE`);
  await pool.end();
});
```
(`packages/schema/src/migrate.test.ts`, `packages/engine/src/engine.test.ts`, `packages/api/src/api.test.ts`)

- **One randomly-named Postgres schema per test file** (`test_<8 hex chars>`, via `randomBytes(4)`), created fresh in `beforeAll` and dropped with `CASCADE` in `afterAll`. This is the entire isolation mechanism — tests never share a schema, never touch a developer's own org data, and can run concurrently against the same Postgres instance/database without colliding.
- No transaction-rollback-per-test isolation; state accumulates across `it()` blocks within one file and is asserted incrementally. Isolation is per-file, not per-test.
- Connectivity is checked explicitly (`SELECT 1`) before anything else, with an error message that tells the developer exactly how to fix it (`pnpm db:up`) rather than a raw connection-refused stack trace.
- When adding a new Postgres-backed test file, copy this exact `beforeAll`/`afterAll` shape rather than inventing a new isolation strategy.

## Fixtures

**SFDX fixture project:** `examples/acme/` (`examples/acme/sfdx-project.json` + `examples/acme/force-app/main/default/`) is the one fixture org used by nearly every test file that needs a schema — loaded via `loadOrgSchema({ projectDir: ACME })` where `ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url))`. It defines custom objects (`Project__c`, `Milestone__c`, `BigTable__c`, `UpsertTable__c`), standard object overlays (`Account`, `Contact`, `Opportunity`), a global value set (`Tier`) and a standard value set (`Industry`).
- `BigTable__c` and `UpsertTable__c` were added specifically to satisfy the jsforce conformance suite's pagination and upsert tests (see `conformance/jsforce/README.md`) — when a conformance run needs new fixture metadata, add it here rather than creating a second fixture project.
- There is exactly one fixture project; tests do not maintain per-file or per-package fixture variants — all share `examples/acme`.

**In-code fixtures:** no separate fixture/factory files or libraries (no `factories/`, no `test/fixtures/` directory). Test data is constructed inline as plain object literals passed to `engine.insert(...)`/HTTP helpers within each test.

## Snapshot Tests

Not used anywhere (`toMatchSnapshot`/`toMatchInlineSnapshot` do not appear in the codebase). Assertions are always explicit `expect(...).toBe/toEqual/toMatch(...)` against literal expected values or regexes — prefer this style for new tests over introducing snapshots.

## Golden-Corpus Conformance Tests (internal, `packages/sigha`)

Distinct from the top-level `conformance/` suites (below): `packages/sigha` (the vendored formula engine) has its own two-tier internal conformance tests that run under `pnpm test` like any other vitest file, reading JSON corpora instead of hand-written cases:

- `packages/sigha/src/engine/conformance.test.ts` (208 lines) — runs every row in `packages/sigha/corpus/salesforce-v2.json` (a golden-file oracle corpus) through `runRow(...)` and asserts a **locked baseline** pass rate (`const BASELINE = 1`, i.e. 100% of the comparable subset). Rows the oracle is known to be wrong about are named individually in an `ORG_OVERRULED` set with an inline comment justifying each exclusion, backed by the org-verified corpus.
- `packages/sigha/src/engine/org-conformance.test.ts` (72 lines) — same mechanism against `packages/sigha/corpus/org-verified.json`, rows read back from a real Salesforce org, described as "the top of the trust order" — a failure here is called out in the file's own comment as "a semantics bug, full stop."
- Both use a `NUMERIC_RENDERING_QUARANTINE`-style `Set<string>` escape hatch for rows whose expected rendering isn't pinned down yet; quarantined rows count toward neither pass nor fail, and must never be used to silently absorb a new failure — the comments in both files are explicit that the baseline must only move up, and any new failing row has to be triaged (fixed, overruled with evidence, or quarantined), not have the baseline number lowered.
- When touching formula evaluation semantics, run these two files and treat any drop in `BASELINE` as a regression to investigate, not a number to adjust down.

## Conformance Suites (`conformance/`)

Two **external, manually-run** suites that exercise a live orglet server over HTTP using real upstream Salesforce SDKs, as opposed to vitest unit/integration tests. They are not part of `pnpm test` / CI (there is no CI config in the repo) and require a running orglet instance plus network/tooling setup (Node+Jest for one, a Python venv for the other).

**`conformance/python/` — simple-salesforce (Python SDK):**
- `conformance/python/run.py` (self-contained script, no test framework) drives `simple_salesforce.Salesforce` against `BASE_URL = "http://localhost:8180"`, `USERNAME = "admin@orglet.local"`, `API_VERSION = "59.0"` (edit constants at the top of the file to point elsewhere).
- Pattern: a `check(name)` context manager wraps each scenario, catches all exceptions, records `(name, "PASS"/"FAIL", detail)`, prints a `[PASS]`/`[FAIL]` line immediately, and never stops the run early — every check attempts to run regardless of earlier failures, ending in a summary table.
- Covers: describe, CRUD, external-id upsert, nested/parent SOQL, `query_more`, validation rules, delete/undelete visibility, limits, search, composite, and error envelopes.
- Dependencies pinned in `conformance/python/requirements.txt` (`simple-salesforce`, `cryptography==43.0.3` pinned for a macOS wheel issue — see the comment in that file).
- Result as of the last documented run (`git log`): 26/26 pass.
- Run manually: start orglet, activate the venv in `conformance/python/.venv`, `python run.py`.

**`conformance/jsforce/` — jsforce (JS/TS SDK), e2e subset:**
- `conformance/jsforce/run.sh` clones/updates upstream `jsforce` `main` into `conformance/jsforce/.cache/jsforce`, installs its deps, builds it, optionally seeds fixture data, then runs a curated subset of jsforce's own Jest e2e test files against a running orglet instance (not orglet's own tests — literally the upstream SDK's test suite, redirected at `orglet` instead of a real scratch org).
- `conformance/jsforce/seed.mjs` seeds fixture rows (`BigTable__c`, Accounts/Contacts/Opportunities) that the upstream tests assume exist, via `POST`/`DELETE /composite/sobjects` (not Bulk API, since seeding predates/avoids that dependency).
- Usage: `./run.sh <base-url> <access-token> [--seed] [-- <jest test paths/args>]` — see the full walkthrough (start server with a scratch `--org-schema`, obtain a bearer token via the password grant, run the suite, tear down) in `conformance/jsforce/README.md`.
- Default file subset (`connection-crud.test.ts`, `query.test.ts`, `connection-meta.test.ts`, `sobject.test.ts`, `connection-session.test.ts`, `bulk.test.ts`) with a Jest `-t` name filter excluding known-out-of-scope tests (bulk, layouts, list views, tabs, theme, identity, search).
- Documented last run (`conformance/jsforce/README.md`, verified 2026-09-25): **51 passed, 2 failed, 58 skipped by the filter**. Both failures depend on Bulk API v1 (`insertAccounts` in `bulk.test.ts` using `/services/async/50.0/job`) — note the top-level git history (`2fcdbc5 Add Bulk API 2.0 ingest and query jobs`) added Bulk API 2.0 support after this README was last verified, so this specific gap may be narrower now; re-run before relying on the exact counts.
- The README documents a Jest/CommonJS import quirk (importing `bulk.test.ts` from another test file re-registers all its `it()`s) and a table of "expected/declared gaps" vs "other findings" — read `conformance/jsforce/README.md` in full before changing anything here; it is the most detailed single doc on what orglet does and doesn't support against a real SDK.

## What Is and Isn't Covered

**Covered by `pnpm test` (vitest, fast, deterministic):**
- Salesforce ID generation/validation (`ids.test.ts`), SFDX metadata parsing and standard-object baseline merge (`sfdx.test.ts`, `build.test.ts`), Postgres DDL generation and migration including idempotency and widen/narrow rules (`migrate.test.ts`), formula compilation and evaluation semantics (`formula.test.ts` + sigha's two corpus suites), SOQL-to-SQL compilation (`compile.test.ts`), the DML engine's order of execution including trigger hooks and change events (`engine.test.ts`), query execution/paging (`query.test.ts`), and the REST API surface end-to-end including Bulk API 2.0 (`api.test.ts`, `bulk.test.ts`).

**Covered only by manual conformance runs, not vitest:**
- Real-SDK-level behavior (jsforce, simple-salesforce) — quirks in HTTP status codes, header shapes, error envelope exact structure, trailing-slash handling, pagination against >2000 rows, composite/collection upsert semantics. These are the source of truth for several documented gaps (see `conformance/jsforce/README.md`'s "Other findings" table) that are not (yet) asserted by any vitest test.
- `packages/cli` has zero automated test coverage of its own — `orglet up`/`check`/`reset` are only exercised indirectly (conformance runs start a real CLI-launched server) or manually.

**Known gaps, called out explicitly in `conformance/jsforce/README.md` (treat as intentional scope boundaries, not bugs, unless asked to close them):**
- SOSL/`/search` (stub, always empty results), `FOR VIEW` SOQL clause, recently-viewed items, `describeLayouts` family, `/tabs`, `/theme`, `explain=` query param handling, Streaming API, Metadata/Tooling API, Apex REST, Chatter.

---

*Testing analysis: 2026-09-29*
