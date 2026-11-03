# Coding Conventions

**Analysis Date:** 2026-11-03

## TypeScript Configuration

**Strictness:**
- `tsconfig.base.json` enforces `strict: true` plus seven additional flags:
  - `noUncheckedIndexedAccess: true` — array/object indexed access is always `undefined`-unioned
  - `noImplicitOverride: true` — class methods must explicitly `override` base methods
  - `exactOptionalPropertyTypes: true` — optional properties cannot be assigned `undefined` (must remain unset)
  - `noFallthroughCasesInSwitch: true` — all switch branches must return or throw
  - `verbatimModuleSyntax: true` — rewrite `import * as X from "Y"` as named imports for build-time clarity
  - `isolatedModules: true` — every file is independently compilable
- All packages extend `tsconfig.base.json`; every package has its own `tsconfig.json` with project references to its workspace dependencies (`packages/*/tsconfig.json`).
- Test typecheck uses `tsconfig.test.json` (non-composite, with `@orglet/*` path alias to each package's `src/index.ts`).
- Module system: `NodeNext` — ESM only, relative imports must include `.js` extension (e.g. `import { migrate } from "./migrate.js"`).

**Target:**
- `target: ES2022`, `lib: ["ES2022"]` (Node 22+).
- `declaration: true`, `declarationMap: true`, `sourceMap: true` (composite builds with per-package `tsBuildInfoFile` under `dist/`).
- `forceConsistentCasingInFileNames`, `skipLibCheck` for portability.

## ESLint Configuration

**Flat Config:**
- `eslint.config.js` uses TypeScript ESLint's flat config (`@eslint/js` recommended + `typescript-eslint` `recommendedTypeChecked`).
- Type-aware linting scoped to `./packages/*/tsconfig.json` and `./tsconfig.test.json`.

**Ignores (not linted):**
- `**/dist/**`, `**/node_modules/**`, `conformance/**`, `examples/**`, `packages/sigha/src/**` (vendored code — see `packages/sigha/VENDOR.md`).

**Key Rules:**
- `@typescript-eslint/consistent-type-imports: error` — always `import type { X }` for type-only imports, or mix type and values in one statement: `import { createPool, type Pool } from "./db.js"`. Type-only imports on a separate line from values are only when they come from different modules.
- `@typescript-eslint/no-unused-vars: error` with `argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true` — prefix unused arguments or variables with `_`.
- Plain `.js` files are excluded from type checking with `disableTypeChecked` (only `eslint.config.js` in practice).

**Run:**
```bash
pnpm lint  # eslint .
```

## Code Formatting

**No Prettier:**
- No `.prettierrc*` or `prettier` dependency in the repository.
- Baseline constraints only: `.editorconfig` at the root sets `charset=utf-8`, `end_of_line=lf`, `indent_size=2`, `insert_final_newline=true`, `trim_trailing_whitespace=true`.
- Lines commonly run long (150–250+ chars) where it keeps a logical unit on one line (an import list, an error-message template); don't wrap for its own sake.

## Naming Patterns

**File Names:**
- Lowercase, one or two compound nouns, matching the file's primary export's concern: `engine.ts`, `errors.ts`, `coerce.ts`, `events.ts`, `hooks.ts`, `parents.ts`, `store.ts`, `bootstrap.ts`.
- Test files co-located as `.test.ts` suffix: `packages/engine/src/engine.test.ts`, `packages/schema/src/migrate.test.ts`. No separate `test/` or `__tests__/` directory at the package root.
- Subdirectories group feature families: `packages/api/src/routes/*.ts` (one file per REST surface: `sobjects.ts`, `query.ts`, `composite.ts`, `bulk.ts`, `login.ts`, `misc.ts`), `packages/api/src/bulk/*.ts` (`csv.ts`, `jobs.ts`).

**Functions & Variables:**
- `camelCase`, verb-first for actions: `planSchema`, `planTable`, `loadParents`, `applyFormulaFields`, `coerceRecord`, `bootstrapOrg`, `runQuery`.
- Noun/adjective for pure lookups or predicates: `columnName`, `tableName`, `isVirtual`, `keyPrefixOf`.
- Error-constructing helpers read as a short phrase: `saveError(...)`, `Errors.requiredMissing(...)`, `apiError(...)`.
- Private helpers inside a file are unexported plain functions, not class methods, even in files that also export a class (e.g. `isDir`, `readXml`-style helpers in `packages/metadata/src/sfdx.ts`).
- Abbreviations avoided in public APIs but used in tight local scope: `ctx`, `req`, `reply`, `res`, `fk`, `idx`.

**Constants & Enums:**
- `UPPER_SNAKE_CASE` for module-level `const` that act as lookup tables or enums: `CUSTOM_FIELD_TYPES` (`packages/metadata/src/sfdx.ts`), `DEFAULT_ORG_SCHEMA`, `INTERNAL_SCHEMA` (`packages/schema/src/columns.ts`).
- Test fixtures/paths use `UPPER_SNAKE_CASE` when acting like a constant: `const ACME = fileURLToPath(...)`  in every Postgres-backed test file.

**Types & Classes:**
- `PascalCase` for interfaces, types, and classes. Interfaces are **not** prefixed with `I`: `FieldDef`, `SObjectDef`, `OrgSchema`, `EngineOptions`, `SaveError`, `SaveResult`, `ApiContext`.
- Suffix conventions:
  - `*Def` for schema/metadata definitions: `FieldDef`, `SObjectDef`, `PicklistDef`, `ValidationRuleDef`.
  - `*Options` for constructor/function option bags: `EngineOptions`, `DmlOptions`, `CompileOptions`, `MigrateOptions`.
  - `*Result` for return payloads: `SaveResult`, `MigrateResult`, `LoginResult`.
  - `*Error` for `Error` subclasses: `DmlError`, `SoqlError`, `FormulaCompileError`, `UnsupportedMetadataError`.

**Classes (sparse usage):**
- Used only for stateful components with lifecycle or mutable internal state: `DmlEngine`, `Store`, `SessionStore`, `ChangeBus`, `FormulaRegistry`, `OrgSchemaImpl`.
- Everything else is functions and plain data (interfaces/types), not classes.

## Import Organization

**Type vs. Value Imports:**
- Enforced by ESLint `consistent-type-imports`.
- Mix in one specifier list when both come from the same module: `import { createPool, type Pool } from "./db.js"`.
- Prefer mixing rather than two separate lines to reduce noise.

**Module Resolution:**
- Cross-package imports use the `@orglet/*` package name (workspace-linked via pnpm), never relative paths across package boundaries.
- No `tsconfig` path aliases in application code (aliases exist only in `tsconfig.test.json` for test-time source imports).
- Relative imports within a package include the `.js` extension: `import { migrate } from "./migrate.js"`.

**Barrel Files:**
- Exactly one per package: `src/index.ts`, the sole public entry point.
- Explicit named exports only (never `export *`): separate type-only exports from values for clarity.
  ```typescript
  export { DmlEngine } from "./engine.js";
  export type { EngineOptions, DmlOptions } from "./engine.js";
  export { Errors, failure } from "./errors.js";
  export type { SaveError, SaveResult } from "./errors.js";
  ```
- No nested barrels inside subdirectories (`routes/`, `bulk/`); those files are imported directly by relative path from within the same package.
- `package.json` `exports` maps `"."` to `{ "types": "./dist/index.d.ts", "import": "./dist/index.js" }` — ESM-only, no CJS entry.

## File Headers

**Every source file opens with a short `/** ... */` block explaining the file's purpose:**
- One to three sentences of prose, no `@fileoverview` tags.
- Explains *why the file exists* and *what problem it solves*, not a restatement of the filename.
- Examples:
  - `packages/engine/src/engine.ts`: "The save pipeline: Salesforce's documented order of execution for insert, update, upsert, delete and undelete, minus Apex and Flow (which plug in through TriggerExecutor). Per call: one transaction…"
  - `packages/soql/src/compile.ts`: "SOQL -> parameterised Postgres SQL, plus a `Shape` describing how to turn the result rows back into Salesforce records (nested parents, child subquery arrays, aggregates)."
  - `packages/schema/src/columns.ts`: "Maps OrgSchema objects and fields to Postgres tables and columns."
  - `packages/api/src/server.ts`: "The Salesforce-compatible HTTP surface: login (SOAP and OAuth), REST sobjects, query, describe, composite, limits. Everything under /services/data needs a bearer session and answers JSON with Salesforce's error envelopes."

**Package `index.ts` files start with a one-line `//` comment:**
- Format: `// @orglet/[name]: [role in system]`
- Example: `// @orglet/engine: DML pipeline implementing Salesforce order of execution`

## Comments (Strategic)

**When to Comment:**
- Reserve for domain knowledge and non-obvious tradeoffs, never obvious code (simple getters, straightforward loops).
- Inline comments explain *Salesforce-specific reasoning* the code alone wouldn't convey: why a field is virtual, why a schema change is refused, why a value is treated as "leave unchanged".
  - Example: `// Each run gets its own Postgres schema so tests never touch each other or a dev org.` (`packages/schema/src/migrate.test.ts`).
  - Example: `// pglite-socket runs every client message through queryQueue.enqueue with its own response callback…` (workaround comment in `test/db.ts`).

**JSDoc/TSDoc:**
- Applied selectively to exported interfaces/fields/functions where the meaning isn't obvious from the name, especially to flag Salesforce quirks.
  - Example: `/** DUPLICATE_EXTERNAL_ID only: the records that matched. */` on `matchingIds?: string[]` field.
  - Example: `/** Upsert only. */` on a property.
  - Example: `/** queryAll: include IsDeleted rows. */` on an option.
- **Not applied uniformly** to every export — omitted when the name is self-explanatory (e.g. `generateId`, `withTransaction`).

## Error Handling

**Error Shape:**
- Record-level errors: `{ statusCode, message, fields, matchingIds? }`
- `statusCode` values are real Salesforce `StatusCode` enum members (`REQUIRED_FIELD_MISSING`, `STRING_TOO_LONG`, `INVALID_TYPE_ON_FIELD_IN_RECORD`, `DUPLICATE_VALUE`, `FIELD_CUSTOM_VALIDATION_EXCEPTION`, `ALL_OR_NONE_OPERATION_ROLLED_BACK`, etc.).
- Do not invent new `statusCode` values; check `packages/engine/src/errors.ts` and Salesforce docs first.

**Factory Pattern (`Errors` object, `packages/engine/src/errors.ts`):**
- All record-level errors are built through the `Errors` factory, never hand-written:
  ```typescript
  Errors.requiredMissing(fields)
  Errors.stringTooLong(label, field, value, max)
  Errors.invalidType(label, field, value)
  Errors.restrictedPicklist(label, field, value)
  Errors.malformedId(label, field, value)
  Errors.invalidCrossReference(field)
  Errors.entityDeleted()
  Errors.notFound()
  Errors.invalidField(field, sobject)
  Errors.notWritable(fields)
  Errors.duplicateValue(field, existingId)
  Errors.customValidation(message, field?)
  Errors.deleteRestricted(name, childLabelPlural, childIds)
  Errors.rolledBack()
  Errors.missingId()
  Errors.duplicateExternalId(field, value, ids)
  Errors.invalidOperation(message)
  Errors.invalidTypeForOperation(message)
  Errors.unsupported(area, message)  // for UNSUPPORTED:* warnings
  ```
- Add new error kinds as new entries on `Errors`, following the existing `saveError(statusCode, message, fields)` helper.
- Helper: `failure(errors: SaveError[]): SaveResult` wraps a row's errors into a failed `SaveResult`.

**Request-Level Errors (`DmlError`, `packages/engine/src/errors.ts`):**
- Thrown for whole-request failures (unknown sObject, bad session).
- Carries `statusCode`, `message`, `httpStatus` (defaults to 400), and `fields` (defaults to []).
- Built via named factories: `unknownSObject(name)`.
- Class extends `Error` with `this.name = "DmlError"`.

**SOQL Errors (`SoqlError`, `packages/soql/src/errors.ts`):**
- HTTP 400 by convention (the API layer hardcodes 400 for any `SoqlError`).
- Carries `errorCode` and `message`.
- Built via named factories: `malformed(detail)`, `invalidField(field, entity)`, `invalidType(name)`, `unsupported(area, detail)`.
- Example: `unsupported("formula-global", "Globals not implemented")` produces `errorCode: "UNSUPPORTED"`, `message: "UNSUPPORTED:formula-global Globals not implemented"`.

**API Response Errors (`ApiError`, `packages/api/src/server.ts`):**
- Every REST error response body is a JSON **array** of `{ message, errorCode, fields? }` objects — never a single object or a `{ error: ... }` wrapper.
- Built with `apiError(errorCode, message, fields?)`.
- Sent with `sendErrors(reply, status, errors)`.
- Row-level `SaveError`s from the engine are converted to `ApiError`s with `saveErrorsToApi(result: SaveResult)` before being sent.

**Central Error Handler (`packages/api/src/server.ts`):**
- `app.setErrorHandler` maps each error class to an HTTP status and JSON body.
- Route handlers throw (don't `sendErrors` directly); the handler catches them.
- Example mapping:
  ```typescript
  if (err instanceof DmlError) return sendErrors(reply, err.httpStatus, [apiError(err.statusCode, err.message, err.fields)]);
  if (err instanceof SoqlError) return sendErrors(reply, 400, [apiError(err.errorCode, err.message)]);
  ```

## UNSUPPORTED Convention (Mandatory)

**Marker Format:**
- Prefix in the message (not the error code): `UNSUPPORTED:<kebab-or-single-word-area> <human explanation>`.
- Real areas in use: `UNSUPPORTED:formula-global`, `UNSUPPORTED:formula-function`, `UNSUPPORTED:formula`, `UNSUPPORTED:field-type`, `UNSUPPORTED:standard-field`, `UNSUPPORTED:reference-target`, `UNSUPPORTED:schema-drop`, `UNSUPPORTED:schema-narrow`, `UNSUPPORTED:bulk-relationship-column`, `UNSUPPORTED:composite-rollback`, `UNSUPPORTED:sosl`.
- Used to distinguish a deliberately-unimplemented feature from a genuine bug.

**When to Use:**
- **Errors**: `Errors.unsupported(area, message)` returns a `SaveError` with `statusCode: "UNSUPPORTED"` and the prefixed message.
- **SOQL**: `SoqlError.unsupported(area, detail)` produces `errorCode: "UNSUPPORTED"`.
- **Warnings**: `packages/metadata/src/diagnostics.ts` calls `pushDiagnostic(..., { area: "..."})` which appears both as a warning string (prefixed with `warning:`) and as a structured `Diagnostic` for the check report.
- **Warnings vs. Errors**: Use the warnings-array route if the operation can still make partial progress; throw if it cannot.

**Scope:**
- Pick a short `area` name scoped to the package/concern (not the whole repo).
- Reuse an existing area if it's a variant of an existing gap.

## Diagnostics & Check Report

**Structured Diagnostics (`packages/metadata/src/diagnostics.ts`):**
- Every warning string has a structured twin (a `Diagnostic` or `InfoDiagnostic`).
- Two severity levels: `warning` (failure to support a feature) and `info` (counts, statistics, unreferenced items).
- `Diagnostic` fields: `area` (kebab-case category), `message`, optional `object`, `field`, `target`.
- Example: `{ area: "formula", message: "...", object: "Account", field: "Rating__c" }`.

**Info vs Warning Categories:**
- `warning:` lines printed to stdout during `orglet check` only when severity is "warning"; counted under `--strict`.
- `info:` lines not printed by default (only in full report); never counted as failures.
- Example info areas: `custom-setting-no-data`, `reference-target-skipped`, `standard-object-unmodelled`, `unreferenced-field`.

**Check Report Processing (`packages/cli/src/report.ts`):**
- Builds a census (object/field counts), a verdict (warnings/info counts), per-area counts, and root-cause groups.
- Groups dependent diagnostics under the root cause (e.g. a field missing a referenced object).
- Implied standard-field root: when only formulas name a standard field outside the baseline, a synthetic root is created.

## Logging

**Console Output:**
- `console.log` for normal progress, gated by `--quiet` flag: `if (!c.quiet) console.log(...args)`.
- `console.warn` prefixed literally with `"warning: "` for every collected warning (including `UNSUPPORTED:*` ones): `for (const w of warnings) console.warn(\`warning: ${w}\`)`.
- `console.error` for fatal startup failures (e.g. Postgres unreachable), followed by an actionable hint line.
- Uncaught top-level errors print `err.stack` via `console.error` in `packages/cli/src/index.ts` before exiting.

**Fastify / Pino Integration (`packages/api/src/server.ts`):**
- Fastify's built-in logger (pino) accessed via `req.log`, not `console`.
- `req.log.warn(...)` for recoverable/expected gaps surfaced per-request (composite rollback limitation, SOSL stub) — often including an `UNSUPPORTED:<area>` string.
- `req.log.error(err)` only in the catch-all branch of the central error handler, for truly unexpected (500) errors.
- Fastify instance's own `logger` option is off by default (`ApiOptions.logger` defaults to `false`); the CLI enables it explicitly when desired.

**Structured Event Stream (optional):**
- When `ORGLET_EVENTS=stdout` is set, change events logged as one JSON object per line: `console.log(JSON.stringify({ event: "change", ...e }))`.
- One place NDJSON-style logging is used; otherwise logging is human-readable.

## Module Design Patterns

**Stateful Components:**
- Use classes sparingly, only for components with lifecycle or mutable state: `DmlEngine`, `Store`, `SessionStore`, `ChangeBus`, `FormulaRegistry`.
- Export as a single instance or constructor in the barrel.

**Pure Functions & Data:**
- Prefer functions and plain data (interfaces/types) over classes.
- Pack related pure functions into a module: `packages/soql/src/compile.ts` (the `compileSoql` function), `packages/schema/src/columns.ts` (naming and type mapping functions).

**Compiled vs. Evaluation:**
- Split expensive (parse + type-check + reference resolution) from cheap (runtime evaluation):
  - `packages/formula/src/compile.ts` compiles source to a `CompiledFormula` bound to `FieldDef`s.
  - `packages/engine/src/formulas.ts` holds `FormulaRegistry` for batching compilations, and `applyFormulaFields` evaluates them.
  - `packages/soql/src/compile.ts` compiles SOQL to SQL; `packages/soql/src/shape.ts` describes result row shaping.

**Hooks & Triggers:**
- `packages/engine/src/hooks.ts` defines the hook interface (`TriggerExecutor`).
- Every batch runs executors in registration order; `before` executors can add errors and modify records, `after` executors observe but cannot modify.
- List of executors passed to `DmlEngine` constructor.

## Testing Conventions (See TESTING.md)

- Test files co-located as `.test.ts` suffix alongside source.
- `describe`/`it` style with descriptive names explaining business logic, not function names.
- Setup via `beforeAll`, teardown via `afterAll` with a `TestDb` fixture providing pool and close callback.
- Assertions with `expect` from vitest.

---

*Convention analysis: 2026-11-03*
