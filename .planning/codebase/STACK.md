# Technology Stack

**Analysis Date:** 2026-11-03

## Languages

**Primary:**
- TypeScript 5.8–5.9.3 (devDependency `^5.8.0`, resolved 5.9.3 in pnpm-lock.yaml) - all application and test code under `packages/*/src`, ESM only (`"type": "module"` in every `package.json`)

**Supporting:**
- Bash - `scripts/sync-sigha.sh` (vendoring), `scripts/sync-sfdocs.sh` (documentation sync), `conformance/run-all.sh` (conformance orchestration), `conformance/jsforce/run.sh` (jsforce harness)
- Python 3 - `conformance/python/run.py` (simple-salesforce conformance harness), run under `conformance/python/.venv`
- SQL - Postgres DDL/DML generated from schema in `packages/schema/src` (Postgres 16 dialect)
- HTML/Vanilla JavaScript - `packages/api/ui/index.html` (242 lines, single self-contained object browser/SOQL console, no framework, no build step)

## Runtime

**Environment:**
- Node.js >=22 (`.nvmrc` pins `22`; `package.json` `engines.node` requires `>=22`)
- ESM only (`NodeNext` module resolution throughout; relative imports carry `.js` extension even for `.ts` source)
- Workspace: root `pnpm-workspace.yaml` defines `packages/*` and `conformance/*` with `allowBuilds: { esbuild: true }`

**Package Manager:**
- pnpm >=10 (root `package.json` `engines.pnpm` requires `>=10`, `packageManager` field pins `pnpm@12.6.0`)
- Single workspace-level lockfile: `pnpm-lock.yaml`
- `.npmrc` enforces `engine-strict=true` and `auto-install-peers=true`

**Packages:**
- 8 application packages: `sigha` (vendored), `metadata`, `schema`, `formula`, `soql`, `engine`, `api`, `cli`
- 5 conformance projects under `conformance/`: `jsforce`, `python`, `cmdt-check`, `describe-check`, `poly-check`, `rollup-check`

## Frameworks

**HTTP Server:**
- Fastify 5.12.5 - REST/SOAP API surface, request routing, session management
  - `packages/api/src/server.ts` - server bootstrap, global error handler
  - `packages/api/src/routes/*.ts` - modular REST endpoints (sobjects, query, composite, bulk, login, misc)

**Middleware:**
- `@fastify/formbody` 9.0.0 - parses `application/x-www-form-urlencoded` bodies (OAuth token endpoint, SOAP login)

**Testing:**
- Vitest 3.2.7 (root devDependency `^3.2.0`)
  - Single workspace-wide config: `vitest.config.ts`
  - Test discovery: `packages/*/src/**/*.test.ts` and `packages/*/test/**/*.test.ts`
  - Test environment: Node
  - Timeouts: `testTimeout: 30_000`, `hookTimeout: 60_000` (Postgres migrations require several seconds per file)
  - Pass-through mode: `passWithNoTests: true`
  - Parallel execution: 3 workers max when `ORGLET_DATABASE_URL` is set (Docker Postgres lock table exhaustion at higher concurrency); unlimited otherwise (pglite is per-file)

**Build & TypeScript:**
- TypeScript 5.8+ (root devDependency `^5.8.0`) with composite builds
  - Root `tsconfig.json` references all 8 package tsconfigs; `pnpm build` runs `tsc -b`
  - Base config: `tsconfig.base.json` - `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true` + extra (`noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`)
  - Per-package tsconfigs extend base and declare project references to workspace dependencies; each has its own `dist/tsconfig.tsbuildinfo`
  - Test config: `tsconfig.test.json` (non-composite, used for test files and scripts)
  - Scripts config: `tsconfig.scripts.json` (for linting and running `scripts/gen-baseline/*`)

- tsx 4.23.15 (root devDependency `^4.20.0`) - run TypeScript directly without a build step (`pnpm baseline:gen`, conformance scripts)

**Linting & Code Quality:**
- ESLint 9.30+ (root devDependency `^9.30.0`) with flat config (`eslint.config.js`)
  - Base: `@eslint/js` recommended + `typescript-eslint` `recommendedTypeChecked`
  - Type-aware linting against `packages/*/tsconfig.json` and `tsconfig.test.json`
  - Key rules: `@typescript-eslint/consistent-type-imports: error` (enforce `import type` for type-only imports), `@typescript-eslint/no-unused-vars: error` (allow `^_` prefix)
  - Ignores: `**/dist/**`, `**/node_modules/**`, `conformance/**`, `examples/**`, `packages/sigha/src/**` (sigha is vendored)
  - `*.js` files get `disableTypeChecked`

- No Prettier (formatting governed by `.editorconfig` alone)

## Key Dependencies

**Critical:**
- `pg` ^8.23.0 (resolved 8.23.0) - only Postgres driver in the codebase, used by `packages/schema/src/db.ts`
  - Integrates with custom type parsers to render Postgres values in Salesforce-compatible format (dates, numerics, timestamps as ISO 8601 strings)

**SOQL & Query:**
- `@jetstreamapp/soql-parser-js` ^8.1.0 (resolved 8.1.0) - SOQL parsing and AST
  - Used by `packages/soql/src/compile.ts` for SOQL→SQL compilation
  - Also used by `packages/api/src/routes/bulk.ts` for bulk query operations

**Metadata:**
- `fast-xml-parser` ^5.11.1 - parses SFDX source-format XML metadata into OrgSchema
  - Used by `packages/metadata/src/sfdx.ts` to read CustomObject.xml, CustomField.xml, ValidationRule.xml, etc.

**Formula Engine:**
- `decimal.js` ^10.6.0 (resolved 10.6.0) - arbitrary-precision decimal math for formula evaluation
  - Used by sigha (vendored, `packages/sigha/src`), available at `@orglet/sigha`

**HTTP Server:**
- `fastify` ^5.12.5 - web framework for REST/SOAP API
  - Router, request/response handling, error handler, plugin system

**Testing:**
- `@electric-sql/pglite` 0.5.8 (root devDependency, exact) - embedded in-memory Postgres for tests when no Docker instance is available
  - Per-test-file instance via `test/db.ts` to avoid shared-instance lock contention
  - Reached through the standard `pg` client library (via `@electric-sql/pglite-socket`)

- `@electric-sql/pglite-socket` 0.2.11 (root devDependency, exact) - socket server wrapper for pglite to allow multiple pg connections

**Type Definitions:**
- `@types/node` ^22.15.0 (root devDependency) - Node 22 type definitions
- `@types/pg` ^8.23.1 (devDependency in `packages/schema`) - pg driver types

## Configuration

**TypeScript:**
- `tsconfig.base.json` - shared baseline with strict flags and ES2022 target
- `tsconfig.json` (root) - composite build driver, references all 8 packages, no files of its own
- `tsconfig.test.json` - test-specific config with `@orglet/*` path aliases to package `src/index.ts` for fast in-repo import without a build step
- Per-package `packages/*/tsconfig.json` - extend base, declare `references` to workspace dependencies, route to `dist/` output

**ESLint:**
- `eslint.config.js` (flat config) - base + TypeScript rules, type-aware linting, per-file `disableTypeChecked` for `.js`

**Testing:**
- `vitest.config.ts` - aliases `@orglet/<name>` to `packages/<name>/src/index.ts`, sets timeouts and worker limits

**Editor & Formatting:**
- `.editorconfig` (root) - enforces LF line endings, 2-space indents, trailing newlines, trimmed whitespace across all file types
- No `.prettierrc` - formatting handled by ESLint + `.editorconfig`

**Database:**
- `docker-compose.yml` (root) - single Postgres 16 Alpine service
  - Container: `orglet-postgres`
  - Credentials: user `orglet`, password `orglet`, database `orglet`
  - Port: `${ORGLET_PG_PORT:-5433}` → container `5432`
  - Named volume: `orglet-pgdata`
  - Healthcheck: `pg_isready`

**Environment:**
- `.env.example` (root, not committed; `.gitignore` excludes `.env` and `.env.*` but includes `!.env.example`)
  - `ORGLET_DATABASE_URL` - Postgres connection string (default fallback in CLI: `postgres://orglet:orglet@localhost:5433/orglet`)
  - `ORGLET_PG_PORT` - host port for docker-compose (default: `5433`)
  - When unset, tests use embedded pglite

## Scripts

**Build & Validation:**
- `pnpm build` → `tsc -b` (composite TypeScript build)
- `pnpm clean` → `tsc -b --clean && rm -rf packages/*/dist`
- `pnpm typecheck` → `tsc -b --noEmit false` (full typecheck)
- `pnpm typecheck:scripts` → `tsc -p tsconfig.scripts.json` (check generator and vendor scripts)
- `pnpm lint` → `eslint .`

**Testing:**
- `pnpm test` → `vitest run` (one-time run against pglite or `$ORGLET_DATABASE_URL`)
- `pnpm test:watch` → `vitest` (watch mode)

**Baseline Metadata:**
- `pnpm baseline:gen` → `tsx scripts/gen-baseline/generate.ts` (regenerate `packages/metadata/standard/objects/*.json` from inputs)
- `pnpm baseline:check` → `tsx scripts/gen-baseline/generate.ts --check` (CI gate: verify committed objects match generation)
- `pnpm baseline:snapshot` → `tsx scripts/gen-baseline/snapshot-pdf.ts` (snapshot Salesforce docs to PDF)
- `pnpm baseline:sync` → `bash scripts/sync-sfdocs.sh` (pull latest Salesforce docs)

**Database (Docker):**
- `pnpm db:up` → `docker compose up -d postgres`
- `pnpm db:down` → `docker compose down`

## Vendored Package: sigha

**Location:** `packages/sigha/src` (not edited, synced via script)

**What it is:** Dependency-free Salesforce formula language front end (lexer, parser, syntax tree, analysis layers)

**Source:** GitHub fork `snorf/sigha` (upstream: `rfaulhaber/sigha`, MIT licensed)

**Pinned revision:** `ff6c108786e086168c4e70797d23162fbab7e614` (integration branch with two pending upstream changes; see `packages/sigha/VENDOR.md`)

**Synced:** 2026-10-23

**Sync script:** `scripts/sync-sigha.sh <rev>` - clones the repo at the pinned revision, extracts engine layers (`syntax/`, `registry/`, `analysis/`, `engine/`, `i18n/`) and corpus, copies to `packages/sigha/src`

**CI check:** `.github/workflows/ci.yml` job `sigha-sync-check` verifies reproducibility (vendored copy matches re-sync from committed revision)

**Contains:**
- Formula parsing and type analysis (no edits)
- Golden corpus (`corpus/salesforce-v2.json`, `corpus/org-verified.json`) with 6312+ passing test cases
- LICENSE and NOTICE (MIT)

**Used by:** `packages/formula` (formula field evaluation, validation rules, default values)

## Generator: Baseline Metadata

**Location:** `scripts/gen-baseline/` (offline, reads inputs only)

**What it does:** Generates `packages/metadata/standard/objects/*.json` from committed inputs (Salesforce documentation snapshots, overrides, type mappings)

**Inputs:**
- `scripts/gen-baseline/source/` - Salesforce docs snapshots (structured JSON per object)
- `scripts/gen-baseline/v1-pins.json` - field definitions pinned from v1.0 baseline to ensure backward compatibility
- `scripts/gen-baseline/overrides.json` - manual fixes for conflicting or ambiguous documentation
- `scripts/gen-baseline/objects.json` - object list and gating (which objects are included)

**Output:** `packages/metadata/standard/objects/*.json` (one per standard sObject)

**CI checks:** 
- `baseline-gen-check` verifies committed objects are reproducible from inputs (no stray files, no uncommitted diffs)

**Run modes:**
- `--check` (CI gate): verify without writing; exit 1 if any diff
- `--report` (review step): run full mode with conflict collection, print JSON, write nothing
- `--bootstrap-pins` (one-off maintenance): derive v1-pins from frozen v1.0 fixture

## Platform Requirements

**Development:**
- Node 22 (via `.nvmrc`, installed via `nvm install` or Corepack)
- pnpm 10+ (via Corepack: `corepack enable pnpm`)
- Docker (for Postgres 16 in dev and CI conformance tests; optional for local tests via pglite)

**Setup:**
1. `pnpm install --frozen-lockfile`
2. `pnpm build`
3. `pnpm db:up` (start Docker Postgres, optional)
4. `pnpm test` (run tests against pglite or Docker Postgres if available)

**Deployment/Usage:**
- `orglet up` binary (entry: `packages/cli/dist/index.js`) - standalone CLI tool for local development, CI testing, self-hosted CRM use
- Requires Postgres 16 (or pglite for ephemeral test instances)
- Points at SFDX source-format project directory and serves Salesforce-compatible REST/SOAP API on a local port

---

*Stack analysis: 2026-11-03*
