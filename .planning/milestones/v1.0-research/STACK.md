# Stack Research — Hardening Milestone (Additions Only)

**Domain:** Test infrastructure (Docker-free Postgres for a TS/Node 22/Fastify 5/Postgres 16 monorepo), CI, Bulk API 2.0 persistence, SOQL parser capability check
**Researched:** 2026-09-29
**Confidence:** HIGH

This file covers only what the hardening milestone *adds* on top of the existing stack
documented in `.planning/codebase/STACK.md` (pnpm 12.6.0, TypeScript 5.9, Fastify 5.12.5,
`pg` 8.23.0, `@jetstreamapp/soql-parser-js` 8.1.0, vitest 3.2.7, Postgres 16 via Docker Compose).
Nothing below replaces anything in that file.

## Recommended Stack

### Core Additions

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|------------------|
| `@electric-sql/pglite` | **0.5.8** (npm registry, published from GitHub `electric-sql/pglite`, last push 2026-08-26) | Embedded Postgres for tests, no Docker | It is real Postgres source compiled to WASM and run in single-user mode — not a reimplementation. Every feature the codebase actually exercises in Postgres-backed tests (`SAVEPOINT` per record in `engine.ts`, `SET LOCAL session_replication_role = replica` for import mode, `ILIKE` in compiled SOQL, `numeric`/`timestamptz`/`char(18)`/`varchar` column types, `CREATE SEQUENCE` for AutoNumber fields, correlated child subqueries, `ALTER TABLE` in `migrate.ts`, real `information_schema` for the diff-based migrator) is genuine Postgres 16-family behavior, not a JS approximation. Apache-2.0/PostgreSQL dual license, OSI-compliant. |
| `@electric-sql/pglite-socket` | **0.2.11** (peer-pins `@electric-sql/pglite` to exactly `0.5.8` — install both together) | Exposes a PGlite instance over the real Postgres wire protocol on a local TCP port | Lets the **existing, unmodified** `createPool()` in `packages/schema/src/db.ts` (`new pg.Pool({ connectionString })`) talk to PGlite exactly as it talks to Docker Postgres today. No new driver, no adapter shim, no change to the production code path the running server uses — only the test bootstrap changes what `ORGLET_DATABASE_URL` points at. MIT license. |

**No new library is needed for Bulk API 2.0 persistence or for SOQL `TYPEOF`** — see "What NOT to Use" and "Verified: no new dependency needed" below.

### CI (GitHub Actions)

| Action | Version | Purpose | Why This Version |
|--------|---------|---------|-------------------|
| `actions/checkout` | **v7** (latest release `v7.0.1`, 2026-07-20) | Checkout the repo | Current major; `v6.1.0` still receives patches but `v7` is the actively recommended line as of this research date. |
| `actions/setup-node` | **v7** (latest release `v7.0.0`, 2026-07-14) | Install Node 22, provide `cache: pnpm` | Current major. Requires pnpm to already be on `PATH` before it can compute a pnpm cache key — install pnpm first (below), then this step. |
| `pnpm/action-setup` | **v6** (latest release `v6.1.0`, 2026-09-05, i.e. this week) | Install the pnpm version pinned in `package.json` (`packageManager: pnpm@12.6.0`) | Reads `packageManager` automatically, no version to hand-maintain in the workflow file. Actively maintained; the pnpm docs note `pnpm/action-setup` remains the supported path "for pnpm v12 and earlier when used with `actions/setup-node`" — exactly this project's version. |

**Order matters:** `actions/checkout` → `pnpm/action-setup` (puts pnpm on `PATH`, matching the pinned `12.6.0`) → `actions/setup-node` with `cache: pnpm` (needs pnpm present to fingerprint the lockfile) → `pnpm install --frozen-lockfile` → `pnpm build` (`tsc -b`) → `pnpm lint` → `pnpm test`.

```yaml
- uses: actions/checkout@v7
- uses: pnpm/action-setup@v6
- uses: actions/setup-node@v7
  with:
    node-version: 22
    cache: pnpm
- run: pnpm install --frozen-lockfile
- run: pnpm build
- run: pnpm lint
- run: pnpm test
```

**Note on `pnpm/setup` (a separate, newer action at `github.com/pnpm/setup`):** the pnpm project's own CI docs now lead with this action (it installs pnpm *and* the Node runtime in one step, `cache: true`, no `actions/setup-node` needed) for pnpm v11+. It's a legitimate, simpler alternative — but it's a newer action (`v2.0.0` current release) with a smaller install base than the well-established `pnpm/action-setup` + `actions/setup-node` combo this table recommends. For a solo/small-team repo where the pair above already matches the project's pinned versions exactly and is the pattern most existing GitHub Actions examples and troubleshooting content assume, stick with the established pair; revisit `pnpm/setup` later if the two-step setup becomes a maintenance annoyance. MEDIUM confidence on this specific recommendation (both are reasonable; this just isn't a place to be an early adopter).

**Second job with a real Postgres 16 service container — optional, not required for correctness:** since PGlite *is* Postgres, a service-container job is a belt-and-braces sanity check (catches any WASM-build-specific quirk), not a substitute for pglite in the main fast job. If added:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    env:
      POSTGRES_USER: orglet
      POSTGRES_PASSWORD: orglet
      POSTGRES_DB: orglet
    ports: ["5433:5432"]
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```
then run `pnpm test` with `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet` and no PGlite substitution, mirroring `docker-compose.yml` exactly. HIGH confidence — this is the standard, long-stable GitHub Actions `services:` pattern, unchanged for years.

## Verified: no new dependency needed

### 1. Bulk API 2.0 persistence — plain tables via the existing `pg` driver

Confirmed by reading `packages/api/src/bulk/jobs.ts`: the current store is two in-memory
`Map`s (`JobStore.ingest`, `JobStore.query`) holding plain objects (`IngestJob`, `QueryJob`)
with string/string[][] fields. **Nothing here needs an ORM, query builder, or job-queue
library.** The rest of the codebase has zero ORM/query-builder dependency anywhere — `pg`
with hand-written SQL is the established, consistent pattern in `packages/schema`,
`packages/engine` and `packages/api`. Two plain tables (or one table with a `kind`
discriminator), columns matching the existing interfaces, `jsonb`/`text[]` for
`csvChunks`/`successRows`/`failedRows`, migrated the same way every other table in the org
schema is migrated, is the only recommendation that fits the codebase's own conventions.
Confidence: HIGH (this is a direct reading of the current implementation, not a library
search finding).

### 2. SOQL `TYPEOF` — the parser already supports it; the gap is orglet's own compiler

`@jetstreamapp/soql-parser-js` **8.1.1** (current latest, released 2026-09-26 — three days
before this research) does parse `TYPEOF ... WHEN ... THEN ... ELSE ... END`. Evidence: the
package's own changelog documents *formatting* behavior for `TYPEOF` fields as far back as
version `3.2.0` (2021), meaning parse-level support for the construct predates that — it is
long-standing, stable functionality, not a recent or experimental addition. This matches
`.planning/codebase/CONCERNS.md`'s own description: `packages/soql/src/compile.ts:327`
throws `unsupported("soql-typeof", ...)` **unconditionally**, i.e. the AST node already
arrives from the parser and orglet's own compiler simply refuses to compile it. No
parser upgrade or replacement is needed to build `TYPEOF` support — only new compilation
logic in `packages/soql/src/compile.ts` (and the parallel "first target" logic in
`packages/formula/src/compile.ts` / `packages/metadata/src/schema.ts`'s
`resolveRelationship`). Confidence: HIGH for "the parser supports it" (multiple years of
stable behavior, current release), HIGH for "the gap is compile-time" (direct code read).

### 3. Roll-up summary fields — no library gap either

Not a parsing or library problem: `packages/metadata/src/sfdx.ts` already recognizes the
`Summary` field type and only skips *loading* it; the recomputation itself is a save-pipeline
concern (aggregate SQL executed by the engine on child insert/update/delete/undelete,
consistent with the project's existing rule that "business rules live in the app, not DB
triggers" — see Key Decisions in `PROJECT.md`). Plain `pg` queries (`SELECT COUNT(*)/SUM(...)
FROM ... WHERE parent_id = $1 [AND <filter>]`) executed inside the existing DML transaction
are sufficient; no aggregation/rules-engine library is needed or appropriate here.

## Alternatives Considered

| Recommended | Alternative | When the Alternative Would Make Sense |
|-------------|-------------|-----------------------------------------|
| `@electric-sql/pglite` + `@electric-sql/pglite-socket` | `pg-mem` (`oguimbal/pg-mem`, npm `pg-mem` **3.0.14**, MIT) | If the project's Postgres-backed tests only used a small, well-supported SQL subset with no `ALTER TABLE`, no `SAVEPOINT`, no `session_replication_role`, and correctness of exact type/DDL semantics didn't matter. That is not this codebase: `migrate.ts` does non-trivial `ALTER TABLE`/widen-narrow diffing against `information_schema`, `engine.ts` uses per-record `SAVEPOINT`, and import mode flips `session_replication_role`. `pg-mem` is a **hand-written JS SQL engine with its own parser** (its own README: "best effort to replicate PG... keep an eye on your query results if you perform complex queries"), last pushed 2026-02-26 (~7 months stale at research time) with 206 open issues — a real reimplementation-fidelity risk for exactly the features this milestone depends on. See "What NOT to Use" below. |
| Bootstrap PGlite directly per test file with a ~20-line local helper (spin up `new PGlite()` + `PGLiteSocketServer` on port 0, build the URL, call the existing `createPool()`) | `pglite-pool` (npm, third-party, wraps the same `pglite-server` CLI that ships inside `@electric-sql/pglite-socket`) | If the team wants a ready-made, off-the-shelf wrapper instead of a few lines of glue code owned in-repo. Given the codebase's stated preference for minimal dependencies (no ORM, no query builder anywhere) and that the underlying primitive (`PGLiteSocketServer`) is a five-line usage in its own README, a small local helper is more in keeping with "enkelhet först" than adding a third-party dependency for what the official package already exposes directly. |
| `pnpm/action-setup@v6` + `actions/setup-node@v7` | `pnpm/setup@v2` (separate, newer GitHub Action, replaces both steps) | If/when a simpler one-step pnpm+Node install becomes worth adopting; it is legitimate but newer/less battle-tested than the pair recommended here. Not worth switching to for this milestone. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| `pg-mem` as the embedded-Postgres solution for tests | Hand-rolled SQL engine/parser, not real Postgres — explicit upstream disclaimer about correctness on complex queries, "basic index implementations", last GitHub push 2026-02-26 (~7 months before this research), 206 open issues. The exact features this milestone's tests rely on (`SAVEPOINT`, `session_replication_role`, `information_schema`-diff-driven `ALTER TABLE`, real sequence/numeric/timestamptz semantics) are precisely the kind of edge behavior a reimplementation is most likely to get subtly wrong, silently, in a way that only real Postgres in CI/prod would catch — defeating the point of a "test without Docker" story that must still trust the tests. | `@electric-sql/pglite` |
| `@middle-management/pglite-pg-adapter` (npm **0.0.4**) as the pg↔pglite bridge | Very early version (0.0.4), and its usage pattern (`new Pool({ pglite: appDB, max: 10 })`) requires changing `createPool()`'s call signature/shape in `packages/schema/src/db.ts` — touching the production code path the running server also uses, for a test-only concern. `@electric-sql/pglite-socket` achieves the same goal (existing tests talk to PGlite) with **zero** changes to `db.ts`. | `@electric-sql/pglite-socket`, pointed at by an unchanged `ORGLET_DATABASE_URL`/`createPool()` |
| Any ORM or SQL query builder (Drizzle, Kysely, Prisma, TypeORM, Knex) for Bulk API 2.0 job persistence | The entire codebase — `packages/schema`, `packages/engine`, `packages/api` — uses raw `pg` with hand-written SQL and zero query-builder dependency. Introducing one for two small job tables breaks that convention for no benefit and adds a dependency whose surface (migrations, connection handling, type generation) the project doesn't otherwise use. | Plain `CREATE TABLE` DDL + `pg` `Pool`/`PoolClient` queries, same as every other table in the schema |
| `better-sqlite3` / any SQLite-family "embedded DB" as the Docker-free test backend | Different SQL dialect entirely: no `session_replication_role`, no real Postgres `information_schema`, different `ILIKE`/`numeric`/`timestamptz` semantics, no `SAVEPOINT` behaving identically to Postgres's MVCC model. Using it would mean tests validate different behavior than what the Postgres-16-backed server actually does — the opposite of what "hardening" is for. The milestone's own framing ("embedded **Postgres**") already rules this out; noted here only to close the door explicitly. | `@electric-sql/pglite` |

## pglite Limitations That Concretely Affect This Codebase

| Concern (from the milestone prompt) | Verdict | Detail |
|---|---|---|
| `session_replication_role` (import mode, `engine.ts:215`) | Works | Real Postgres GUC, not an extension; PGlite runs genuine Postgres backend code. |
| `SAVEPOINT` (per-record write in `engine.ts:403-411`) | Works | Real Postgres `SAVEPOINT`/`RELEASE`/`ROLLBACK TO`. Fine as used here because each record's savepoint dance happens sequentially on one `PoolClient`, not concurrently across multiple connections — see "concurrent connections" row below. |
| `information_schema` (schema diffing in `migrate.ts`) | Works | Real Postgres system catalogs/views, not simulated. |
| `numeric`, `timestamptz`, `ILIKE`, sequences, `char(18)` (column types in `columns.ts`/`ddl.ts`, SOQL text comparison in `compile.ts:552`) | Works | All core Postgres, not extensions; PGlite ships the same type system and operators. |
| Correlated subqueries (`compile.ts:335-359`, child relationship subqueries) | Works | Same Postgres planner/executor, single-user mode doesn't change SQL semantics. |
| DDL `ALTER TABLE` (`migrate.ts` add/widen columns, drop with `--force`) | Works | This is one of the specific areas where "real Postgres in WASM" beats a reimplementation like `pg-mem`, whose DDL/ALTER fidelity is much less certain. |
| Multiple schemas (`test_<hex>` per file) | Works, but reconsider the pattern | PGlite supports `CREATE SCHEMA` fully. However: PGlite is **single-connection per WASM instance**, and vitest runs test files in parallel workers/processes (no `pool`/`isolate` override in `vitest.config.ts`, so vitest's default per-file worker isolation applies) — a single shared PGlite instance can't be handed across separate worker processes. **Recommendation:** give each Postgres-backed test file its own fresh, in-memory `PGlite` instance in `beforeAll` (via its own `pglite-socket` server on port `0`) instead of trying to share one instance across files. The existing `test_<hex>` schema-within-one-instance trick becomes unnecessary for isolation (each file already gets a fully separate database) but can be kept unchanged to minimize the diff to `migrate.test.ts`/`engine.test.ts`/`api.test.ts`/`bulk.test.ts`/`query.test.ts` — only the `beforeAll`/`afterAll` plumbing that creates `pool` needs to change, not the schema-per-file logic itself. |
| Concurrent connections (bulk/composite batch processing) | Real limitation, low practical risk here | PGlite is fundamentally single-user/single-connection (Postgres WASM can't fork processes; it runs Postgres's "single user mode"). `pglite-socket` multiplexes multiple TCP clients onto that one connection and its own README warns "this is different from a normal Postgres installation, so not all use cases are guaranteed to work." This *would* matter if a test exercised true concurrent multi-connection behavior (e.g. two `pool.connect()` clients racing on the same row to test lock contention) — grep of the current test suite shows no such pattern today (bulk records are written in a sequential per-record savepoint loop, not `Promise.all`-fanned across multiple clients), so this is a latent constraint to document, not a blocker for the tests that exist now. Flag it explicitly in code comments near the test `pool` setup so a future contributor adding a real concurrency test knows to reach for the Docker Postgres path (`pnpm db:up`) instead. |
| Extension support | Not applicable to this codebase | `grep -rn "CREATE EXTENSION"` across `packages/schema` and `packages/engine` returns nothing — orglet uses zero Postgres extensions today. PGlite does support official extension packages (pgvector, PostGIS, pg_ivm, age, pgtap, pg_uuidv7, pg_hashids, pg_textsearch, each as a separate `@electric-sql/pglite-<ext>` npm package) if that ever changes, but none are needed for this milestone. |
| Status | Honest caveat | The `electric-sql/pglite` README itself still carries a `status: alpha` badge despite 16k GitHub stars and an active release cadence (pushed 2026-08-26). Treat pglite as "very widely used, still labeled alpha by its own maintainers" — reasonable for a test-only dependency that never touches production data, worth reassessing if the project ever considers it for anything beyond tests. |

## Installation

```bash
# Core hardening additions (dev-only — tests, not the running server)
pnpm add -D -w @electric-sql/pglite@0.5.8 @electric-sql/pglite-socket@0.2.11

# No other new runtime or dev dependency is required for this milestone's stack changes
# (Bulk API 2.0 persistence and SOQL TYPEOF both build on libraries already in the project).
```

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| `@electric-sql/pglite-socket@0.2.11` | `@electric-sql/pglite@0.5.8` (exact peer dependency pin, verified via npm registry metadata — not a range) | Install both at these exact versions together; a `pnpm` peer-dependency mismatch warning here should be treated as a real problem, not noise. |
| `@electric-sql/pglite@0.5.8` | Node 22 | No `engines` field declared by the package (verified via npm registry metadata) — no documented floor above what a WASM-capable modern Node provides; Node 22 (already required by this project) is well within its normal usage range. |
| `pnpm/action-setup@v6` | `packageManager: "pnpm@12.6.0"` in `package.json` | Action reads this field automatically; no version needs to be duplicated into the workflow file. README explicitly states this action line is the supported path for pnpm v12 and earlier used together with `actions/setup-node`. |
| `actions/setup-node@v7` `cache: pnpm` | pnpm already on `PATH` | Must run `pnpm/action-setup` (or any pnpm install step) before `actions/setup-node`, or the pnpm cache key computation fails/no-ops. |

## Sources

- npm registry metadata (`registry.npmjs.org`) fetched directly for exact published versions: `@electric-sql/pglite` (0.5.8), `@electric-sql/pglite-socket` (0.2.11, peer deps), `pg-mem` (3.0.14), `@jetstreamapp/soql-parser-js` (8.1.1) — HIGH confidence, primary source
- GitHub REST API (`api.github.com/repos/...`) fetched directly for `pushed_at`/`archived`/commit history: `electric-sql/pglite` (pushed 2026-08-26, active), `oguimbal/pg-mem` (pushed 2026-02-26, not archived but ~7 months stale, commit log confirms sparse recent activity), `actions/checkout` (latest `v7.0.1`), `actions/setup-node` (latest `v7.0.0`), `pnpm/action-setup` (latest `v6.1.0`) — HIGH confidence, primary source
- `github.com/electric-sql/pglite` main README (fetched raw) — PGlite API (`new PGlite()`, `.query()`), "single user/connection" limitation stated by the maintainers themselves, alpha status badge — HIGH confidence
- `github.com/electric-sql/pglite` `packages/pglite-socket/README.md` (fetched raw) — `PGLiteSocketServer`/`PGLiteSocketHandler` API, explicit multiplexer caveat ("not all use cases are guaranteed to work") — HIGH confidence
- `pglite.dev/docs/pglite-socket` (WebFetch) — corroborates the raw README — MEDIUM/HIGH confidence (secondary rendering of the same source)
- `github.com/jetstreamapp/soql-parser-js` CHANGELOG.md (fetched raw) — `TYPEOF` formatting behavior documented since v3.2.0 (2021), confirming long-standing parse-level support; current release 8.1.1 dated 2026-09-26 — HIGH confidence
- `oguimbal/pg-mem` GitHub repo page (WebFetch) and README/wiki content (WebSearch) — "best effort", limitation list, no maintenance/archived notice either way — MEDIUM confidence (repo not archived, but low recent commit velocity is a documented fact, not training-data speculation)
- `pnpm.io/continuous-integration` (WebFetch) — current official pnpm CI guidance, including the newer `pnpm/setup` action — MEDIUM/HIGH confidence (official docs, but reflects the newest recommendation rather than the most battle-tested one)
- `github.com/pnpm/action-setup` README (WebFetch) — confirms it remains supported for pnpm v12 and earlier alongside `actions/setup-node`, reads `packageManager` field automatically — HIGH confidence
- Direct repo reads (`Read`/`Bash grep`) of this project's own source: `packages/schema/src/db.ts`, `packages/schema/src/ids.ts`, `packages/schema/src/migrate.ts`, `packages/schema/src/columns.ts`, `packages/schema/src/ddl.ts`, `packages/engine/src/engine.ts`, `packages/soql/src/compile.ts`, `packages/api/src/bulk/jobs.ts`, `vitest.config.ts`, `package.json` — used to ground every limitation/recommendation in what this codebase actually does, not generic PGlite documentation — HIGH confidence (primary source: the code itself)

---
*Stack research for: hardening milestone (pglite test infra, CI, Bulk API 2.0 persistence, SOQL TYPEOF parser check)*
*Researched: 2026-09-29*
