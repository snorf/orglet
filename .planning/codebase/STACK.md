# Technology Stack

**Analysis Date:** 2026-09-29

## Languages

**Primary:**
- TypeScript 5.9.3 (root devDependency pinned `^5.8.0`, resolved 5.9.3 in `pnpm-lock.yaml`) - all packages under `packages/*/src`, ESM (`"type": "module"` in every `package.json`)

**Secondary:**
- Bash - `scripts/sync-sigha.sh` (vendoring), `conformance/jsforce/run.sh` (conformance harness)
- Python 3 - `conformance/python/run.py` (simple-salesforce conformance harness)
- SQL - generated DDL/DML in `packages/schema/src` (Postgres dialect)
- HTML/vanilla JS - `packages/api/ui/index.html` (242 lines, single self-contained built-in object browser/SOQL console page, no framework, no build step)

## Runtime

**Environment:**
- Node.js >=22 (`.nvmrc` pins `22`; `package.json` `engines.node` requires `>=22`)
- ESM only (`NodeNext` module resolution throughout)

**Package Manager:**
- pnpm >=10, `packageManager` field pins `pnpm@12.6.0` (`package.json`)
- Workspace defined in `pnpm-workspace.yaml`: `packages/*` and `conformance/*`, with `allowBuilds: { esbuild: true }`
- Lockfile: present, `pnpm-lock.yaml` (root, single lockfile for the whole workspace)
- `.npmrc`: `engine-strict=true`, `auto-install-peers=true`

## Frameworks

**Core:**
- Fastify 5.12.5 - HTTP server for the Salesforce-compatible REST/SOAP API, `packages/api/src/server.ts`
- `@fastify/formbody` 9.0.0 - parses `application/x-www-form-urlencoded` bodies (OAuth token endpoint, SOAP login), `packages/api/package.json`

**Testing:**
- Vitest 3.2.7 (root devDependency `^3.2.0`) - single workspace-wide config `vitest.config.ts`, runs `packages/*/src/**/*.test.ts` and `packages/*/test/**/*.test.ts`
- Test environment: `node`; `testTimeout: 30_000`, `hookTimeout: 60_000` (schema migrations against a real Postgres in Docker take several seconds per file)
- `passWithNoTests: true`

**Build/Dev:**
- TypeScript project references / composite builds - root `tsconfig.json` references all 8 packages (`sigha`, `metadata`, `schema`, `formula`, `soql`, `engine`, `api`, `cli`); `pnpm build` runs `tsc -b`
- `tsx` 4.23.15 (root devDependency `^4.20.0`) - TS execution without a build step (dev workflow)
- ESLint 9.39.5 (root devDependency `^9.30.0`) with `typescript-eslint` 8.70.1 - flat config, `eslint.config.js`

## Key Dependencies

**Critical:**
- `pg` ^8.23.0 (resolved 8.23.0) - Postgres client, `packages/schema/src/db.ts`, only DB driver in the codebase
- `@jetstreamapp/soql-parser-js` ^8.1.0 - SOQL parsing, `packages/soql`
- `fast-xml-parser` ^5.11.1 - parses SFDX source-format XML metadata, `packages/metadata`
- `decimal.js` ^10.6.0 - arbitrary-precision decimal math for the formula engine, `packages/sigha` (vendored)
- `fastify` ^5.12.5 - REST/SOAP HTTP surface, `packages/api`

**Infrastructure:**
- `@types/pg` ^8.23.1 (dev) - types for `pg`
- `@types/node` ^22.15.0 (dev, root) - Node 22 typings

## Configuration

**TypeScript:**
- `tsconfig.base.json` (root): `target: ES2022`, `module`/`moduleResolution: NodeNext`, `strict: true` plus extra strictness (`noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`), composite builds with per-package `tsBuildInfoFile` under `dist/`
- `tsconfig.json` (root): no files of its own, only `references` to all 8 package tsconfigs (drives `tsc -b`)
- `tsconfig.test.json` (root): non-composite variant used for typechecking test files and config files, with a `@orglet/*` path alias to each package's `src/index.ts`
- Each package has its own `tsconfig.json` (e.g. `packages/api/tsconfig.json`) extending the base and declaring project references to its workspace dependencies

**Linting:**
- `eslint.config.js` (flat config): `@eslint/js` recommended + `typescript-eslint` `recommendedTypeChecked`, type-aware linting scoped to `./packages/*/tsconfig.json` and `./tsconfig.test.json`
- Ignores: `**/dist/**`, `**/node_modules/**`, `conformance/**`, `examples/**`, `packages/sigha/src/**` (vendored code excluded from lint)
- Key rules: `@typescript-eslint/consistent-type-imports: error`, `@typescript-eslint/no-unused-vars: error` (with `^_` ignore pattern for args/vars)
- Plain `.js` files (e.g. `eslint.config.js` itself) get `disableTypeChecked`

**Testing:**
- `vitest.config.ts` (root, single config for the whole monorepo, no per-package configs): aliases `@orglet/<name>` to each package's `src/index.ts` for fast in-repo cross-package testing without a build

**Formatting:**
- No Prettier config detected; `.editorconfig` enforces `lf`, 2-space indent, trailing-newline, trimmed trailing whitespace for all files

**Containers:**
- `docker-compose.yml` (root, single service): `postgres:16-alpine`, container name `orglet-postgres`, DB/user/password all `orglet`, host port `${ORGLET_PG_PORT:-5433}` mapped to container `5432`, healthcheck via `pg_isready`, named volume `orglet-pgdata`

**Environment:**
- `.env.example` (root, two vars): `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet`, `ORGLET_PG_PORT=5433`
- `.gitignore` excludes `.env` and `.env.*` but keeps `!.env.example`
- No `.env` file present in the working tree (only `.env.example`)

## Platform Requirements

**Development:**
- Node 22, pnpm via Corepack (`corepack enable pnpm`), Docker (for Postgres 16)
- Setup per `README.md`: `pnpm install` → `pnpm db:up` → `pnpm build` → `pnpm test` / `pnpm lint`

**Production:**
- No deployment target defined; this is a local/dev/CI tool (`README.md` describes it as "LocalStack, but for Salesforce"), run via `packages/cli` (`orglet up/check/reset`) against a self-hosted Postgres

---

*Stack analysis: 2026-09-29*
