<!-- GSD:project-start source:PROJECT.md -->
## Project

**orglet**

orglet is a self-hosted, single-tenant emulator of the Salesforce platform: "LocalStack, but for
Salesforce". Point it at an SFDX project (the output of `sf project retrieve`) and it builds the
org in Postgres and speaks the Salesforce REST API, so existing clients such as `jsforce` and
`simple-salesforce` work unchanged. It is Johan's personal open-source side project (Apache-2.0),
built to see how far a well-documented, old platform can be reproduced from public documentation
and SDK source alone. Users are developers who want a local org for development, integration
tests and CI, and eventually a small self-hosted CRM that can be migrated to the real thing.

**Core Value:** A Salesforce client pointed at orglet cannot tell the difference for the surface orglet claims to
support, and anything it does not support is logged as `UNSUPPORTED:<area>` rather than faked.

### Constraints

- **Legal**: Build only from public documentation and open-source SDK source; never diff
  behaviour against a real org — Developer MSA forbids benchmarking and competitive use of
  Developer Edition
- **Trademark**: Nominative "compatible with Salesforce" only; no "-force" naming; README carries
  the non-affiliation notice — Salesforce trademark rules
- **Licensing**: Apache-2.0 project; dependencies must be OSI-licensed (sigha MIT,
  soql-parser-js MIT, formula-engine corpus BSD-3); no SLDS 2, no Salesforce Sans
- **Tech stack**: TypeScript strict, Node 22, pnpm 10+, Postgres 16, Fastify 5, vitest — already
  established, do not fork conventions
- **Data**: Only Level 1 data in the emulator and in Claude context; Tele2 metadata excluded
- **Compatibility**: Existing conformance suites must stay green; the `UNSUPPORTED:<area>`
  convention is mandatory for anything not implemented
- **Identity**: Repo-local git identity Johan Karlsteen <johan@karlsteen.com>; the global config
  is a Tele2 service account and must not leak into commits
- **Outward-facing actions**: Creating the GitHub repository and the first push are confirmed
  with Johan before they happen
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.9.3 (root devDependency pinned `^5.8.0`, resolved 5.9.3 in `pnpm-lock.yaml`) - all packages under `packages/*/src`, ESM (`"type": "module"` in every `package.json`)
- Bash - `scripts/sync-sigha.sh` (vendoring), `conformance/jsforce/run.sh` (conformance harness)
- Python 3 - `conformance/python/run.py` (simple-salesforce conformance harness)
- SQL - generated DDL/DML in `packages/schema/src` (Postgres dialect)
- HTML/vanilla JS - `packages/api/ui/index.html` (242 lines, single self-contained built-in object browser/SOQL console page, no framework, no build step)
## Runtime
- Node.js >=22 (`.nvmrc` pins `22`; `package.json` `engines.node` requires `>=22`)
- ESM only (`NodeNext` module resolution throughout)
- pnpm >=10, `packageManager` field pins `pnpm@12.6.0` (`package.json`)
- Workspace defined in `pnpm-workspace.yaml`: `packages/*` and `conformance/*`, with `allowBuilds: { esbuild: true }`
- Lockfile: present, `pnpm-lock.yaml` (root, single lockfile for the whole workspace)
- `.npmrc`: `engine-strict=true`, `auto-install-peers=true`
## Frameworks
- Fastify 5.12.5 - HTTP server for the Salesforce-compatible REST/SOAP API, `packages/api/src/server.ts`
- `@fastify/formbody` 9.0.0 - parses `application/x-www-form-urlencoded` bodies (OAuth token endpoint, SOAP login), `packages/api/package.json`
- Vitest 3.2.7 (root devDependency `^3.2.0`) - single workspace-wide config `vitest.config.ts`, runs `packages/*/src/**/*.test.ts` and `packages/*/test/**/*.test.ts`
- Test environment: `node`; `testTimeout: 30_000`, `hookTimeout: 60_000` (schema migrations against a real Postgres in Docker take several seconds per file)
- `passWithNoTests: true`
- TypeScript project references / composite builds - root `tsconfig.json` references all 8 packages (`sigha`, `metadata`, `schema`, `formula`, `soql`, `engine`, `api`, `cli`); `pnpm build` runs `tsc -b`
- `tsx` 4.23.15 (root devDependency `^4.20.0`) - TS execution without a build step (dev workflow)
- ESLint 9.39.5 (root devDependency `^9.30.0`) with `typescript-eslint` 8.70.1 - flat config, `eslint.config.js`
## Key Dependencies
- `pg` ^8.23.0 (resolved 8.23.0) - Postgres client, `packages/schema/src/db.ts`, only DB driver in the codebase
- `@jetstreamapp/soql-parser-js` ^8.1.0 - SOQL parsing, `packages/soql`
- `fast-xml-parser` ^5.11.1 - parses SFDX source-format XML metadata, `packages/metadata`
- `decimal.js` ^10.6.0 - arbitrary-precision decimal math for the formula engine, `packages/sigha` (vendored)
- `fastify` ^5.12.5 - REST/SOAP HTTP surface, `packages/api`
- `@types/pg` ^8.23.1 (dev) - types for `pg`
- `@types/node` ^22.15.0 (dev, root) - Node 22 typings
## Configuration
- `tsconfig.base.json` (root): `target: ES2022`, `module`/`moduleResolution: NodeNext`, `strict: true` plus extra strictness (`noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`), composite builds with per-package `tsBuildInfoFile` under `dist/`
- `tsconfig.json` (root): no files of its own, only `references` to all 8 package tsconfigs (drives `tsc -b`)
- `tsconfig.test.json` (root): non-composite variant used for typechecking test files and config files, with a `@orglet/*` path alias to each package's `src/index.ts`
- Each package has its own `tsconfig.json` (e.g. `packages/api/tsconfig.json`) extending the base and declaring project references to its workspace dependencies
- `eslint.config.js` (flat config): `@eslint/js` recommended + `typescript-eslint` `recommendedTypeChecked`, type-aware linting scoped to `./packages/*/tsconfig.json` and `./tsconfig.test.json`
- Ignores: `**/dist/**`, `**/node_modules/**`, `conformance/**`, `examples/**`, `packages/sigha/src/**` (vendored code excluded from lint)
- Key rules: `@typescript-eslint/consistent-type-imports: error`, `@typescript-eslint/no-unused-vars: error` (with `^_` ignore pattern for args/vars)
- Plain `.js` files (e.g. `eslint.config.js` itself) get `disableTypeChecked`
- `vitest.config.ts` (root, single config for the whole monorepo, no per-package configs): aliases `@orglet/<name>` to each package's `src/index.ts` for fast in-repo cross-package testing without a build
- No Prettier config detected; `.editorconfig` enforces `lf`, 2-space indent, trailing-newline, trimmed trailing whitespace for all files
- `docker-compose.yml` (root, single service): `postgres:16-alpine`, container name `orglet-postgres`, DB/user/password all `orglet`, host port `${ORGLET_PG_PORT:-5433}` mapped to container `5432`, healthcheck via `pg_isready`, named volume `orglet-pgdata`
- `.env.example` (root, two vars): `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet`, `ORGLET_PG_PORT=5433`
- `.gitignore` excludes `.env` and `.env.*` but keeps `!.env.example`
- No `.env` file present in the working tree (only `.env.example`)
## Platform Requirements
- Node 22, pnpm via Corepack (`corepack enable pnpm`), Docker (for Postgres 16)
- Setup per `README.md`: `pnpm install` → `pnpm db:up` → `pnpm build` → `pnpm test` / `pnpm lint`
- No deployment target defined; this is a local/dev/CI tool (`README.md` describes it as "LocalStack, but for Salesforce"), run via `packages/cli` (`orglet up/check/reset`) against a self-hosted Postgres
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- One word, lowercase, no separators, matching the primary export's concern: `engine.ts`, `errors.ts`, `coerce.ts`, `events.ts`, `hooks.ts`, `parents.ts`, `store.ts`, `bootstrap.ts` (all in `packages/engine/src/`).
- Multi-concept files use a plain compound noun, still lowercase: `build.ts`, `sfdx.ts`, `schema.ts`, `types.ts`, `xml.ts` (`packages/metadata/src/`).
- Test files are co-located and suffixed `.test.ts`: `packages/engine/src/engine.test.ts`, `packages/schema/src/migrate.test.ts`, `packages/soql/src/compile.test.ts`. No separate `test/` or `__tests__/` directory at the package root (the `tsconfig.test.json` `include` also allows `packages/*/test/**/*.ts` but no package currently uses it).
- Subdirectories group a feature's route/module family: `packages/api/src/routes/*.ts` (one file per REST surface: `sobjects.ts`, `query.ts`, `composite.ts`, `bulk.ts`, `login.ts`, `misc.ts`), `packages/api/src/bulk/*.ts` (`csv.ts`, `jobs.ts`).
- Every package has exactly one barrel file, `src/index.ts`, that is the sole public entry point (see Module Design below).
- `camelCase`, verb-first for actions (`planSchema`, `planTable`, `loadParents`, `applyFormulaFields`, `coerceRecord`, `bootstrapOrg`, `runQuery`), noun/adjective for pure lookups or predicates (`columnName`, `tableName`, `isVirtual`, `keyPrefixOf`).
- Error-constructing helpers read as a short phrase and return a value rather than throwing: `saveError(...)`, `Errors.requiredMissing(...)`, `apiError(...)` (see Error Handling).
- Private helpers inside a file are unexported plain functions, not class methods, even in files that also export a class (e.g. `isDir`, `readXml`-style helpers in `packages/metadata/src/sfdx.ts`).
- `camelCase` throughout; abbreviations are avoided in public APIs but used freely in tight local scope (`ctx`, `req`, `reply`, `res`, `fk`, `idx`).
- Constants that are effectively enums/lookup tables are `UPPER_SNAKE_CASE` module-level `const`s: `CUSTOM_FIELD_TYPES` (`packages/metadata/src/sfdx.ts`), `DEFAULT_ORG_SCHEMA`, `INTERNAL_SCHEMA` (`packages/schema/src/columns.ts`).
- Test fixtures/paths use `UPPER_SNAKE_CASE` too when they act like a constant: `const ACME = fileURLToPath(...)` in every Postgres-backed test file.
- `PascalCase` for interfaces, types and classes. Interfaces are not prefixed with `I`: `FieldDef`, `SObjectDef`, `OrgSchema`, `EngineOptions`, `SaveError`, `SaveResult`, `ApiContext`.
- Suffix conventions: `*Def` for schema/metadata definitions (`FieldDef`, `SObjectDef`, `PicklistDef`, `ValidationRuleDef`), `*Options` for constructor/function option bags (`EngineOptions`, `DmlOptions`, `CompileOptions`, `MigrateOptions`), `*Result` for return payloads (`SaveResult`, `MigrateResult`, `LoginResult`), `*Error` for `Error` subclasses (`DmlError`, `SoqlError`, `FormulaCompileError`, `UnsupportedMetadataError`).
- Classes are used sparingly, for stateful components with lifecycle or mutable internal state: `DmlEngine`, `Store`, `SessionStore`, `ChangeBus`, `FormulaRegistry`, `OrgSchemaImpl`. Everything else is functions and plain data (interfaces/types), not classes.
## Code Style
- No Prettier config in the repo (no `.prettierrc*`, no `prettier` dependency) — formatting is whatever the author/editor produces, constrained only by `.editorconfig` and ESLint. Lines commonly run long (150–250+ chars) where it keeps a logical unit (an import list, an error-message template) on one line; don't wrap for its own sake if it fragments a single expression.
- `.editorconfig` at the repo root sets the baseline: check it (`/Users/johankarlsteen/Development.nosync/local-salesforce/.editorconfig`) for indent/EOL/charset before assuming Prettier-style defaults.
- Flat ESLint config: `eslint.config.js`. Base: `@eslint/js` recommended + `typescript-eslint` `recommendedTypeChecked`, type-checked against `packages/*/tsconfig.json` and `tsconfig.test.json`.
- `conformance/**`, `examples/**`, `packages/sigha/src/**` and `**/dist/**` are excluded from linting (sigha is vendored code — see `packages/sigha/VENDOR.md`).
- Explicit project rules: `@typescript-eslint/consistent-type-imports` is an error (always `import type { X }` for type-only imports, see Import Organization) and `@typescript-eslint/no-unused-vars` is an error except for identifiers prefixed `_` (args, vars, and rest-sibling destructuring).
- `*.js` files get `disableTypeChecked` (only `eslint.config.js` itself, in practice).
- Run: `pnpm lint` (root script: `eslint .`).
- `strict: true` plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`. Every package extends this — new code must satisfy it, including treating indexed/array access as possibly-`undefined` and never assigning `undefined` to an optional property that doesn't explicitly accept it.
- Module system is `NodeNext`/`NodeNext`: relative imports **must** carry the `.js` extension even though the source is `.ts` (`import { migrate } from "./migrate.js"`), and workspace packages are imported by their `@orglet/*` name, never by relative path across package boundaries.
## Import Organization
- Enforced (`consistent-type-imports`): `import type { FieldDef, OrgSchema } from "@orglet/metadata"`, or mixed in one specifier list — `import { createPool, databaseUrlFromEnv, type Pool } from "./db.js"`. Prefer mixing type and value imports in a single statement per module rather than two separate `import`/`import type` lines when both come from the same module.
- No `tsconfig` path aliases in application code — cross-package imports go through the published `@orglet/*` package name (workspace-linked via pnpm), resolved at build time through each package's `exports` map in `package.json` (`"./dist/index.js"`).
- Test-only alias: `vitest.config.ts` and `tsconfig.test.json` map `@orglet/*` to `./packages/*/src/index.ts` directly (not `dist`), so tests run against source without a build step first.
- No barrel re-exports across packages beyond each package's own `src/index.ts` — don't reach into another package's internal files (e.g. `@orglet/engine/src/store.js`); only what `index.ts` exports is the public surface.
## Error Handling
- Shape: `{ statusCode: string, message: string, fields: string[], matchingIds?: string[] }` — one entry per `SaveResult.errors` array, matching Salesforce's per-record SOAP/REST error shape.
- `statusCode` values are real Salesforce `StatusCode` enum members (`REQUIRED_FIELD_MISSING`, `STRING_TOO_LONG`, `INVALID_TYPE_ON_FIELD_IN_RECORD`, `DUPLICATE_VALUE`, `FIELD_CUSTOM_VALIDATION_EXCEPTION`, `ALL_OR_NONE_OPERATION_ROLLED_BACK`, etc.) — do not invent new ones; check `packages/engine/src/errors.ts` (`Errors` object) and Salesforce docs first.
- Build errors through the `Errors` factory object, not by hand-writing objects: `Errors.requiredMissing(fields)`, `Errors.invalidField(field, sobject)`, `Errors.duplicateValue(field, existingId)`. Add new error kinds as new entries on `Errors`, following the existing `saveError(statusCode, message, fields)` helper.
- `failure(errors: SaveError[]): SaveResult` wraps a row's errors into a failed `SaveResult`.
- `DmlError` (`packages/engine/src/errors.ts`): `{ statusCode, message, httpStatus, fields }`. Thrown for request-level failures (unknown sObject, bad session) via helpers like `unknownSObject(name)`.
- `SoqlError` (`packages/soql/src/errors.ts`): `{ errorCode, message }`, always HTTP 400 by convention (the API layer hardcodes 400 for any `SoqlError`). Built via named factories: `malformed(detail)`, `invalidField(field, entity)`, `invalidType(name)`, `unsupported(area, detail)`.
- `FormulaCompileError` (`packages/formula/src/compile.ts`) and `UnsupportedMetadataError` (`packages/metadata/src/sfdx.ts`) follow the same pattern: a named `Error` subclass carrying a machine-readable code/area plus a human message that echoes Salesforce's own wording where documented.
- The API's central error handler (`packages/api/src/server.ts`, `app.setErrorHandler`) maps each error class to an HTTP status and JSON body; add new error types there if they need distinct HTTP status mapping, rather than special-casing inside a route.
- Every REST error response body is a JSON **array** of `{ message, errorCode, fields? }` objects (`ApiError`, `packages/api/src/server.ts`), matching Salesforce's REST error envelope exactly — never a single object or a `{ error: ... }` wrapper for `/services/*` and `/id/*` paths.
- Build these with `apiError(errorCode, message, fields?)` and send with `sendErrors(reply, status, errors)` (`packages/api/src/server.ts`) — never `reply.send([...])` by hand in a route.
- Row-level `SaveError`s from the engine are converted to `ApiError`s with `saveErrorsToApi(result: SaveResult)` (`packages/api/src/routes/sobjects.ts`) before being sent.
- A single, repo-wide textual marker prefixing the *message* (not the status/error code, which stays a real Salesforce code like `UNSUPPORTED`, `INVALID_FIELD`, or `FEATURE_NOT_ENABLED`) whenever orglet recognizes a Salesforce feature it deliberately does not implement, as opposed to a genuine bug.
- Format: `UNSUPPORTED:<kebab-or-single-word-area> <human explanation>`. Real areas in use: `UNSUPPORTED:formula-global`, `UNSUPPORTED:formula-function`, `UNSUPPORTED:formula`, `UNSUPPORTED:field-type`, `UNSUPPORTED:standard-field`, `UNSUPPORTED:reference-target`, `UNSUPPORTED:schema-drop`, `UNSUPPORTED:schema-narrow`, `UNSUPPORTED:bulk-relationship-column`, `UNSUPPORTED:bulk-subquery`, `UNSUPPORTED:composite-rollback`, `UNSUPPORTED:sosl`.
- Used in three places depending on severity:
- When adding a new deliberately-unimplemented feature: pick a short `area` name scoped to the package/concern (not the whole repo), reuse an existing area if it's a variant of an existing gap, and prefer the warnings-array route over throwing if the surrounding operation can still make partial progress.
## Logging
- `console.log` for normal progress output, gated by a `--quiet` flag (`if (!c.quiet) console.log(...args)`).
- `console.warn` prefixed literally with `"warning: "` for every collected warning string (including `UNSUPPORTED:*` ones): `for (const w of result.warnings) console.warn(\`warning: ${w}\`)`.
- `console.error` for fatal startup failures (e.g. Postgres unreachable), followed by an actionable hint line (`"start one with: docker compose up -d postgres..."`).
- Optional structured event stream: when `ORGLET_EVENTS=stdout` is set, change events are logged as one JSON object per line: `console.log(JSON.stringify({ event: "change", ...e }))` — this is the one place NDJSON-style logging is used.
- Uncaught top-level errors print `err.stack` via `console.error` in `packages/cli/src/index.ts` before exiting.
- Uses Fastify's built-in logger (pino) via `req.log`, not `console`. `req.log.warn(...)` for recoverable/expected gaps surfaced per-request (composite rollback limitation, SOSL stub) — often including an `UNSUPPORTED:<area>` string in the warn message. `req.log.error(err)` only in the catch-all branch of the central error handler, for truly unexpected (500) errors.
- The Fastify instance's own `logger` option is off by default (`ApiOptions.logger`, defaults to `false`); the CLI enables it explicitly when desired.
## Comments
- Every source file (not just barrels) opens with a short `/** ... */` block explaining *why the file exists / what problem it solves*, not a restatement of its filename. See the header excerpts in `packages/engine/src/engine.ts`, `packages/soql/src/compile.ts`, `packages/schema/src/ddl.ts`, `packages/metadata/src/build.ts` — one to three sentences, prose, no `@fileoverview` tags.
- Inline comments explain *Salesforce-specific reasoning* the code alone wouldn't convey: why a field is virtual, why a schema change is refused, why a value is treated as "leave unchanged". Example: `// Each run gets its own Postgres schema so tests never touch each other or a dev org.` (`packages/schema/src/migrate.test.ts`).
- Package `index.ts` files start with a one-line `//` comment stating the package's role in the system: `// @orglet/schema: OrgSchema -> Postgres DDL, migrations, Salesforce ID generation`.
- Do not comment obvious code (simple getters, straightforward loops) — comments are reserved for domain knowledge and non-obvious tradeoffs.
- Used on exported interfaces/fields/functions where the meaning isn't obvious from the name alone, especially to flag Salesforce quirks: `/** DUPLICATE_EXTERNAL_ID only: the records that matched. */`, `/** Upsert only. */`, `/** queryAll: include IsDeleted rows. */`. Not applied uniformly/mechanically to every export — omitted when the name is self-explanatory (e.g. `generateId`, `withTransaction`).
## Function Design
## Module Design
- Every package's public surface is exactly its `src/index.ts`, using explicit named exports (never `export *`): values and types are listed separately, e.g. `export { DmlEngine } from "./engine.js";` followed by `export type { EngineOptions, DmlOptions } from "./engine.js";`. This keeps the type-only/value-only distinction visible at the barrel and satisfies `verbatimModuleSyntax`.
- `package.json` `exports` maps `"."` to `{ "types": "./dist/index.d.ts", "import": "./dist/index.js" }` — packages are ESM-only (`"type": "module"`), no CJS `require` entry point anywhere.
- Exactly one per package, at `src/index.ts`; no nested barrels inside subdirectories like `routes/` or `bulk/` — those are imported directly by relative path from within the same package (`import { registerSobjectRoutes } from "./routes/sobjects.js"`).
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Postgres is the only datastore and the only source of truth (no in-memory record cache);
- Salesforce semantics (order of execution, IDs, describe shapes, error envelopes) are
- Anything not implemented is surfaced as an `UNSUPPORTED:<area>` warning rather than silently
- One package, `packages/sigha`, is vendored (not authored in this repo) — see
## Layers
- Purpose: turn SFDX source-format XML plus the built-in standard-object baseline into an
- Location: `packages/metadata/src`
- Contains: XML parsing (`sfdx.ts`), baseline JSON loading and merge logic (`build.ts`), the
- Depends on: nothing in-repo (only `fast-xml-parser`).
- Used by: `schema`, `formula`, `soql`, `engine`, `api`, `cli`.
- Purpose: compile an `OrgSchema` to Postgres DDL, diff/migrate a live database against it,
- Location: `packages/schema/src`
- Contains: table/column naming (`columns.ts`), DDL planning (`ddl.ts`), migration diffing
- Depends on: `metadata`.
- Used by: `soql`, `engine`, `api`, `cli`.
- Purpose: compile and evaluate Salesforce formula expressions (formula fields, validation
- Location: `packages/formula/src`
- Contains: compilation from source to a `CompiledFormula` bound to `FieldDef`s
- Depends on: `metadata`, `sigha` (the vendored formula-language front end: lexer, parser,
- Used by: `engine`.
- Purpose: compile SOQL query strings to parameterised Postgres SQL and shape result rows
- Location: `packages/soql/src`
- Contains: the compiler (`compile.ts`, built on `@jetstreamapp/soql-parser-js`), date-literal
- Depends on: `metadata`, `schema` (for table/column naming).
- Used by: `engine`, `api`.
- Purpose: the DML pipeline — insert/update/upsert/delete/undelete implementing Salesforce's
- Location: `packages/engine/src`
- Contains: the pipeline itself (`engine.ts`), the hook/trigger interface (`hooks.ts`), a
- Depends on: `metadata`, `schema`, `formula`, `soql`.
- Used by: `api`, `cli`.
- Purpose: the Salesforce-compatible HTTP surface — a Fastify app exposing REST sobjects,
- Location: `packages/api/src`, routes under `packages/api/src/routes`, Bulk API internals
- Contains: server bootstrap and cross-cutting hooks (`server.ts`), session/auth
- Depends on: `metadata`, `schema`, `formula`, `soql`, `engine`.
- Used by: `cli`.
- Purpose: the `orglet` binary — `up` (load metadata, migrate, bootstrap, serve), `check`
- Location: `packages/cli/src` (`index.ts` is the `#!/usr/bin/env node` entry, `main.ts` holds
- Depends on: `metadata`, `schema`, `engine`, `api`.
- Used by: end users / `docker-compose.yml` / conformance scripts.
- Purpose: the dependency-free Salesforce formula *language* front end that `@orglet/formula`
- Location: `packages/sigha/src`
- Not edited by hand — resynced from upstream via `scripts/sync-sigha.sh` (see
- Depends on: `decimal.js` only.
- Used by: `formula`.
## Data Flow
- `TriggerExecutor.run(ctx: TriggerContext)` (`packages/engine/src/hooks.ts`) is the single
- `orglet up --import` (or `EngineOptions.importMode`) is data-migration mode: `Id` and audit
- No application-level state beyond Postgres itself and the two in-memory maps for Bulk API
## Key Abstractions
- Purpose: the org's metadata model — every `SObjectDef`, its `FieldDef`s, picklist value
- Examples: `packages/metadata/src/types.ts` (interfaces), `packages/metadata/src/schema.ts`
- Pattern: built once at startup (`loadOrgSchema`), then passed by reference (never mutated)
- Purpose: the single choke point for all writes and the source of the `Store`/`FormulaRegistry`/
- Examples: `packages/engine/src/engine.ts`, exported via `packages/engine/src/index.ts`.
- Pattern: one instance per running server (constructed once in `packages/cli/src/main.ts:81`),
- Purpose: separates the expensive step (parse + type-check + reference resolution) from the
- Examples: `packages/formula/src/compile.ts`, `packages/engine/src/formulas.ts`.
- Purpose: separates "SOQL -> SQL" (pure, testable in `packages/soql/src/compile.test.ts`)
- Examples: `packages/soql/src/compile.ts`, `packages/soql/src/shape.ts`.
- Purpose: the only way code outside `DmlEngine` observes or blocks a DML operation.
- Examples: `packages/engine/src/hooks.ts`.
- Pattern: list of executors run in registration order for every batch; `before` executors
- Purpose: per-record pipeline state (index, accumulated errors, `changes` vs. `next` vs.
- Examples: `packages/engine/src/engine.ts:38-49` (not exported; internal only).
## Entry Points
- Location: `packages/cli/src/index.ts` (shebang wrapper) -> `packages/cli/src/main.ts`
- Triggers: invoked as the `orglet` bin (`packages/cli/package.json` `bin.orglet`) or directly
- Responsibilities: `up` loads metadata, connects to Postgres, migrates the schema, bootstraps
- Location: `packages/api/src/server.ts:79`.
- Triggers: called once by `orglet up` (`packages/cli/src/main.ts:88`); also called directly
- Responsibilities: registers global content-type parsers (permissive JSON, raw XML/SOAP),
- Location: served from `packages/api/src/server.ts:145-146`, markup/JS in
- Responsibilities: an object browser and ad-hoc SOQL console against the running org, talking
## Error Handling
- `DmlError` + `Errors.*` factories (`packages/engine/src/errors.ts`) carry an `httpStatus`,
- `SoqlError` + helpers (`malformed`, `invalidField`, `invalidType`, `invalidRelationship`,
- Unsupported-but-tolerated input (metadata the parser can't represent, SOSL search) logs an
- Postgres unique-constraint violations (`23505`) are caught per-record inside a savepoint and
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
