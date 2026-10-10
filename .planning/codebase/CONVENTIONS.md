# Coding Conventions

**Analysis Date:** 2026-09-29

## Naming Patterns

**Files:**
- One word, lowercase, no separators, matching the primary export's concern: `engine.ts`, `errors.ts`, `coerce.ts`, `events.ts`, `hooks.ts`, `parents.ts`, `store.ts`, `bootstrap.ts` (all in `packages/engine/src/`).
- Multi-concept files use a plain compound noun, still lowercase: `build.ts`, `sfdx.ts`, `schema.ts`, `types.ts`, `xml.ts` (`packages/metadata/src/`).
- Test files are co-located and suffixed `.test.ts`: `packages/engine/src/engine.test.ts`, `packages/schema/src/migrate.test.ts`, `packages/soql/src/compile.test.ts`. No separate `test/` or `__tests__/` directory at the package root (the `tsconfig.test.json` `include` also allows `packages/*/test/**/*.ts` but no package currently uses it).
- Subdirectories group a feature's route/module family: `packages/api/src/routes/*.ts` (one file per REST surface: `sobjects.ts`, `query.ts`, `composite.ts`, `bulk.ts`, `login.ts`, `misc.ts`), `packages/api/src/bulk/*.ts` (`csv.ts`, `jobs.ts`).
- Every package has exactly one barrel file, `src/index.ts`, that is the sole public entry point (see Module Design below).

**Functions:**
- `camelCase`, verb-first for actions (`planSchema`, `planTable`, `loadParents`, `applyFormulaFields`, `coerceRecord`, `bootstrapOrg`, `runQuery`), noun/adjective for pure lookups or predicates (`columnName`, `tableName`, `isVirtual`, `keyPrefixOf`).
- Error-constructing helpers read as a short phrase and return a value rather than throwing: `saveError(...)`, `Errors.requiredMissing(...)`, `apiError(...)` (see Error Handling).
- Private helpers inside a file are unexported plain functions, not class methods, even in files that also export a class (e.g. `isDir`, `readXml`-style helpers in `packages/metadata/src/sfdx.ts`).

**Variables:**
- `camelCase` throughout; abbreviations are avoided in public APIs but used freely in tight local scope (`ctx`, `req`, `reply`, `res`, `fk`, `idx`).
- Constants that are effectively enums/lookup tables are `UPPER_SNAKE_CASE` module-level `const`s: `CUSTOM_FIELD_TYPES` (`packages/metadata/src/sfdx.ts`), `DEFAULT_ORG_SCHEMA`, `INTERNAL_SCHEMA` (`packages/schema/src/columns.ts`).
- Test fixtures/paths use `UPPER_SNAKE_CASE` too when they act like a constant: `const ACME = fileURLToPath(...)` in every Postgres-backed test file.

**Types:**
- `PascalCase` for interfaces, types and classes. Interfaces are not prefixed with `I`: `FieldDef`, `SObjectDef`, `OrgSchema`, `EngineOptions`, `SaveError`, `SaveResult`, `ApiContext`.
- Suffix conventions: `*Def` for schema/metadata definitions (`FieldDef`, `SObjectDef`, `PicklistDef`, `ValidationRuleDef`), `*Options` for constructor/function option bags (`EngineOptions`, `DmlOptions`, `CompileOptions`, `MigrateOptions`), `*Result` for return payloads (`SaveResult`, `MigrateResult`, `LoginResult`), `*Error` for `Error` subclasses (`DmlError`, `SoqlError`, `FormulaCompileError`, `UnsupportedMetadataError`).
- Classes are used sparingly, for stateful components with lifecycle or mutable internal state: `DmlEngine`, `Store`, `SessionStore`, `ChangeBus`, `FormulaRegistry`, `OrgSchemaImpl`. Everything else is functions and plain data (interfaces/types), not classes.

## Code Style

**Formatting:**
- No Prettier config in the repo (no `.prettierrc*`, no `prettier` dependency) — formatting is whatever the author/editor produces, constrained only by `.editorconfig` and ESLint. Lines commonly run long (150–250+ chars) where it keeps a logical unit (an import list, an error-message template) on one line; don't wrap for its own sake if it fragments a single expression.
- `.editorconfig` at the repo root sets the baseline: check it (`/Users/johankarlsteen/Development.nosync/local-salesforce/.editorconfig`) for indent/EOL/charset before assuming Prettier-style defaults.

**Linting:**
- Flat ESLint config: `eslint.config.js`. Base: `@eslint/js` recommended + `typescript-eslint` `recommendedTypeChecked`, type-checked against `packages/*/tsconfig.json` and `tsconfig.test.json`.
- `conformance/**`, `examples/**`, `packages/sigha/src/**` and `**/dist/**` are excluded from linting (sigha is vendored code — see `packages/sigha/VENDOR.md`).
- Explicit project rules: `@typescript-eslint/consistent-type-imports` is an error (always `import type { X }` for type-only imports, see Import Organization) and `@typescript-eslint/no-unused-vars` is an error except for identifiers prefixed `_` (args, vars, and rest-sibling destructuring).
- `*.js` files get `disableTypeChecked` (only `eslint.config.js` itself, in practice).
- Run: `pnpm lint` (root script: `eslint .`).

**TypeScript strictness (`tsconfig.base.json`):**
- `strict: true` plus `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`. Every package extends this — new code must satisfy it, including treating indexed/array access as possibly-`undefined` and never assigning `undefined` to an optional property that doesn't explicitly accept it.
- Module system is `NodeNext`/`NodeNext`: relative imports **must** carry the `.js` extension even though the source is `.ts` (`import { migrate } from "./migrate.js"`), and workspace packages are imported by their `@orglet/*` name, never by relative path across package boundaries.

## Import Organization

**Order (by convention, not enforced by an import-order rule):**
1. Node builtins with the `node:` protocol (`node:fs/promises`, `node:crypto`, `node:url`, `node:path`).
2. Third-party packages (`fastify`, `pg`, `@fastify/formbody`, `@jetstreamapp/soql-parser-js`).
3. `@orglet/*` workspace packages (`@orglet/metadata`, `@orglet/schema`, `@orglet/engine`, `@orglet/formula`, `@orglet/soql`).
4. Relative imports within the same package, always with `.js`, roughly leaf-first (`./errors.js`, `./events.js`, `./hooks.js`) before the file that composes them.

**Type-only imports:**
- Enforced (`consistent-type-imports`): `import type { FieldDef, OrgSchema } from "@orglet/metadata"`, or mixed in one specifier list — `import { createPool, databaseUrlFromEnv, type Pool } from "./db.js"`. Prefer mixing type and value imports in a single statement per module rather than two separate `import`/`import type` lines when both come from the same module.

**Path aliases:**
- No `tsconfig` path aliases in application code — cross-package imports go through the published `@orglet/*` package name (workspace-linked via pnpm), resolved at build time through each package's `exports` map in `package.json` (`"./dist/index.js"`).
- Test-only alias: `vitest.config.ts` and `tsconfig.test.json` map `@orglet/*` to `./packages/*/src/index.ts` directly (not `dist`), so tests run against source without a build step first.
- No barrel re-exports across packages beyond each package's own `src/index.ts` — don't reach into another package's internal files (e.g. `@orglet/engine/src/store.js`); only what `index.ts` exports is the public surface.

## Error Handling

Two parallel error shapes exist, both mirroring documented Salesforce API behavior, and each layer picks the one appropriate to it:

**1. Row-level `SaveError` (DML results), `packages/engine/src/errors.ts`:**
- Shape: `{ statusCode: string, message: string, fields: string[], matchingIds?: string[] }` — one entry per `SaveResult.errors` array, matching Salesforce's per-record SOAP/REST error shape.
- `statusCode` values are real Salesforce `StatusCode` enum members (`REQUIRED_FIELD_MISSING`, `STRING_TOO_LONG`, `INVALID_TYPE_ON_FIELD_IN_RECORD`, `DUPLICATE_VALUE`, `FIELD_CUSTOM_VALIDATION_EXCEPTION`, `ALL_OR_NONE_OPERATION_ROLLED_BACK`, etc.) — do not invent new ones; check `packages/engine/src/errors.ts` (`Errors` object) and Salesforce docs first.
- Build errors through the `Errors` factory object, not by hand-writing objects: `Errors.requiredMissing(fields)`, `Errors.invalidField(field, sobject)`, `Errors.duplicateValue(field, existingId)`. Add new error kinds as new entries on `Errors`, following the existing `saveError(statusCode, message, fields)` helper.
- `failure(errors: SaveError[]): SaveResult` wraps a row's errors into a failed `SaveResult`.

**2. Whole-request errors (`Error` subclasses), thrown and caught by the API's Fastify error handler:**
- `DmlError` (`packages/engine/src/errors.ts`): `{ statusCode, message, httpStatus, fields }`. Thrown for request-level failures (unknown sObject, bad session) via helpers like `unknownSObject(name)`.
- `SoqlError` (`packages/soql/src/errors.ts`): `{ errorCode, message }`, always HTTP 400 by convention (the API layer hardcodes 400 for any `SoqlError`). Built via named factories: `malformed(detail)`, `invalidField(field, entity)`, `invalidType(name)`, `unsupported(area, detail)`.
- `FormulaCompileError` (`packages/formula/src/compile.ts`) and `UnsupportedMetadataError` (`packages/metadata/src/sfdx.ts`) follow the same pattern: a named `Error` subclass carrying a machine-readable code/area plus a human message that echoes Salesforce's own wording where documented.
- The API's central error handler (`packages/api/src/server.ts`, `app.setErrorHandler`) maps each error class to an HTTP status and JSON body; add new error types there if they need distinct HTTP status mapping, rather than special-casing inside a route.

**JSON error array wire format:**
- Every REST error response body is a JSON **array** of `{ message, errorCode, fields? }` objects (`ApiError`, `packages/api/src/server.ts`), matching Salesforce's REST error envelope exactly — never a single object or a `{ error: ... }` wrapper for `/services/*` and `/id/*` paths.
- Build these with `apiError(errorCode, message, fields?)` and send with `sendErrors(reply, status, errors)` (`packages/api/src/server.ts`) — never `reply.send([...])` by hand in a route.
- Row-level `SaveError`s from the engine are converted to `ApiError`s with `saveErrorsToApi(result: SaveResult)` (`packages/api/src/routes/sobjects.ts`) before being sent.

**The `UNSUPPORTED:<area>` convention:**
- A single, repo-wide textual marker prefixing the *message* (not the status/error code, which stays a real Salesforce code like `UNSUPPORTED`, `INVALID_FIELD`, or `FEATURE_NOT_ENABLED`) whenever orglet recognizes a Salesforce feature it deliberately does not implement, as opposed to a genuine bug.
- Format: `UNSUPPORTED:<kebab-or-single-word-area> <human explanation>`. Real areas in use: `UNSUPPORTED:formula-global`, `UNSUPPORTED:formula-function`, `UNSUPPORTED:formula`, `UNSUPPORTED:field-type`, `UNSUPPORTED:standard-field`, `UNSUPPORTED:reference-target`, `UNSUPPORTED:schema-drop`, `UNSUPPORTED:schema-narrow`, `UNSUPPORTED:bulk-relationship-column`, `UNSUPPORTED:composite-rollback`, `UNSUPPORTED:sosl`.
- Used in three places depending on severity:
  - **Warnings collected in a result object** (non-fatal, load continues): `metadata`'s `SourceProject.warnings` / `OrgSchema` build warnings (`packages/metadata/src/build.ts`, `packages/metadata/src/sfdx.ts`), `MigrateResult.warnings` (`packages/schema/src/migrate.ts`), `engine.warnings` (`packages/engine/src/formulas.ts`). These surface to the CLI operator via `console.warn` (see Logging) and to tests via `expect(result.warnings).toEqual([...])`.
  - **Thrown as part of an error message** (fatal for that one operation): `FormulaCompileError` for `$Setup`/unknown globals (`packages/formula/src/compile.ts`), `UnsupportedMetadataError` for metadata the parser refuses outright.
  - **Returned as a `SaveError`/`SoqlError`/`ApiError` to the caller** (fatal for that one request, others in the batch unaffected): `Errors.unsupported(area, message)`, `soql`'s `unsupported(area, detail)`; Bulk query-SOQL restrictions are rejected with plain `FEATURE_NOT_ENABLED` and no prefix because Salesforce rejects them too (`packages/api/src/bulk/soql-rules.ts`).
- When adding a new deliberately-unimplemented feature: pick a short `area` name scoped to the package/concern (not the whole repo), reuse an existing area if it's a variant of an existing gap, and prefer the warnings-array route over throwing if the surrounding operation can still make partial progress.

## Logging

**No logging framework in the engine/schema/formula/soql layers** — those packages are pure/library code and communicate problems only via return values (`warnings: string[]`) or thrown errors, never `console.*`. Keep it that way for new library code; logging belongs at the edges (CLI, API).

**CLI (`packages/cli/src/main.ts`, `packages/cli/src/index.ts`):**
- `console.log` for normal progress output, gated by a `--quiet` flag (`if (!c.quiet) console.log(...args)`).
- `console.warn` prefixed literally with `"warning: "` for every collected warning string (including `UNSUPPORTED:*` ones): `for (const w of result.warnings) console.warn(\`warning: ${w}\`)`.
- `console.error` for fatal startup failures (e.g. Postgres unreachable), followed by an actionable hint line (`"start one with: docker compose up -d postgres..."`).
- Optional structured event stream: when `ORGLET_EVENTS=stdout` is set, change events are logged as one JSON object per line: `console.log(JSON.stringify({ event: "change", ...e }))` — this is the one place NDJSON-style logging is used.
- Uncaught top-level errors print `err.stack` via `console.error` in `packages/cli/src/index.ts` before exiting.

**API (`packages/api/src/*`):**
- Uses Fastify's built-in logger (pino) via `req.log`, not `console`. `req.log.warn(...)` for recoverable/expected gaps surfaced per-request (composite rollback limitation, SOSL stub) — often including an `UNSUPPORTED:<area>` string in the warn message. `req.log.error(err)` only in the catch-all branch of the central error handler, for truly unexpected (500) errors.
- The Fastify instance's own `logger` option is off by default (`ApiOptions.logger`, defaults to `false`); the CLI enables it explicitly when desired.

## Comments

**When to comment:**
- Every source file (not just barrels) opens with a short `/** ... */` block explaining *why the file exists / what problem it solves*, not a restatement of its filename. See the header excerpts in `packages/engine/src/engine.ts`, `packages/soql/src/compile.ts`, `packages/schema/src/ddl.ts`, `packages/metadata/src/build.ts` — one to three sentences, prose, no `@fileoverview` tags.
- Inline comments explain *Salesforce-specific reasoning* the code alone wouldn't convey: why a field is virtual, why a schema change is refused, why a value is treated as "leave unchanged". Example: `// Each run gets its own Postgres schema so tests never touch each other or a dev org.` (`packages/schema/src/migrate.test.ts`).
- Package `index.ts` files start with a one-line `//` comment stating the package's role in the system: `// @orglet/schema: OrgSchema -> Postgres DDL, migrations, Salesforce ID generation`.
- Do not comment obvious code (simple getters, straightforward loops) — comments are reserved for domain knowledge and non-obvious tradeoffs.

**JSDoc/TSDoc:**
- Used on exported interfaces/fields/functions where the meaning isn't obvious from the name alone, especially to flag Salesforce quirks: `/** DUPLICATE_EXTERNAL_ID only: the records that matched. */`, `/** Upsert only. */`, `/** queryAll: include IsDeleted rows. */`. Not applied uniformly/mechanically to every export — omitted when the name is self-explanatory (e.g. `generateId`, `withTransaction`).

## Function Design

**Size:** Small and single-purpose for pure helpers (a handful of lines); route handlers and the DML pipeline's per-phase steps are larger but still one logical operation each. No enforced line-count limit, but multi-hundred-line functions are rare — logic is split into named private helpers within the file instead.

**Parameters:** Positional for 1–3 required args in factory/helper functions (`saveError(statusCode, message, fields)`, `invalidField(field, entity)`). An `options` object (typed `*Options` interface) is used once a function needs more than ~3 params or has optional configuration (`EngineOptions`, `CompileOptions`, `MigrateOptions`). Object destructuring in the signature is common for options bags.

**Return values:** Prefer returning a typed result over throwing where the caller needs to keep going (warnings arrays, `SaveResult`/`SaveError`). Throw only for conditions that should abort the current request/operation entirely (`DmlError`, `SoqlError`, `FormulaCompileError`). Async functions return `Promise<T>` explicitly typed, not inferred, on exported functions.

## Module Design

**Exports:**
- Every package's public surface is exactly its `src/index.ts`, using explicit named exports (never `export *`): values and types are listed separately, e.g. `export { DmlEngine } from "./engine.js";` followed by `export type { EngineOptions, DmlOptions } from "./engine.js";`. This keeps the type-only/value-only distinction visible at the barrel and satisfies `verbatimModuleSyntax`.
- `package.json` `exports` maps `"."` to `{ "types": "./dist/index.d.ts", "import": "./dist/index.js" }` — packages are ESM-only (`"type": "module"`), no CJS `require` entry point anywhere.

**Barrel files:**
- Exactly one per package, at `src/index.ts`; no nested barrels inside subdirectories like `routes/` or `bulk/` — those are imported directly by relative path from within the same package (`import { registerSobjectRoutes } from "./routes/sobjects.js"`).

---

*Convention analysis: 2026-09-29*
