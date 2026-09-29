# Codebase Structure

**Analysis Date:** 2026-09-29

## Directory Layout

```
local-salesforce/                          # pnpm workspace root, package name "orglet"
├── packages/
│   ├── metadata/          # SFDX + standard-object baseline -> OrgSchema
│   │   ├── src/            # build.ts, sfdx.ts, schema.ts, types.ts, xml.ts (+ *.test.ts)
│   │   └── standard/       # baseline data: objects/*.json, standardValueSets.json
│   ├── schema/             # OrgSchema -> Postgres DDL/migration, Salesforce IDs
│   │   └── src/             # columns.ts, ddl.ts, migrate.ts, ids.ts, db.ts (+ *.test.ts)
│   ├── formula/            # Salesforce formula language bound to record context
│   │   └── src/             # compile.ts, evaluate.ts, values.ts (+ formula.test.ts)
│   ├── soql/               # SOQL AST -> parameterised SQL, result shaping
│   │   └── src/             # compile.ts, shape.ts, dates.ts, errors.ts (+ compile.test.ts)
│   ├── engine/              # DML pipeline: order of execution, hooks, bootstrap, query
│   │   └── src/             # engine.ts, hooks.ts, store.ts, formulas.ts, query.ts, ...
│   ├── api/                # Salesforce-compatible REST + login + built-in UI
│   │   ├── src/
│   │   │   ├── routes/       # one file per resource family (sobjects, query, composite, bulk, login, misc)
│   │   │   └── bulk/         # Bulk API 2.0 internals: csv.ts, jobs.ts
│   │   └── ui/              # index.html — the built-in object browser / SOQL console, served at "/"
│   ├── cli/                # orglet command line
│   │   └── src/             # index.ts (bin entry), main.ts (arg parsing + up/check/reset)
│   └── sigha/               # VENDORED formula-language engine (do not hand-edit)
│       └── src/             # syntax/, registry/, analysis/, engine/, i18n/
├── examples/
│   └── acme/                # SFDX fixture project (force-app/main/default/...) used by tests + conformance
├── conformance/
│   ├── jsforce/             # runs upstream jsforce e2e suite against orglet (run.sh, seed.mjs)
│   └── python/               # runs a Python client suite against orglet (run.py)
├── scripts/                 # repo maintenance scripts (e.g. sync-sigha.sh)
├── docker-compose.yml        # Postgres 16 on localhost:5433 for local dev
├── eslint.config.js          # flat ESLint config, typed lint over packages/*/tsconfig.json
├── vitest.config.ts           # workspace-wide test runner config
├── tsconfig.json / tsconfig.base.json / tsconfig.test.json   # TS project references
└── pnpm-workspace.yaml        # workspace globs: packages/*, conformance/*
```

## Directory Purposes

**`packages/metadata`:**
- Purpose: everything about turning declarative metadata (SFDX XML on disk, or the built-in
  JSON baseline) into the in-memory `OrgSchema` every other package consumes.
- Contains: XML parsing (`xml.ts`, `sfdx.ts`), baseline loading + merge (`build.ts`), the
  `OrgSchema` implementation (`schema.ts`), shared type vocabulary (`types.ts`).
- Key files: `packages/metadata/src/index.ts` (barrel + `loadOrgSchema()`), `packages/metadata/standard/objects/*.json` (one file per built-in standard object).

**`packages/schema`:**
- Purpose: the only package that knows how OrgSchema concepts map to Postgres (table/column
  names, SQL types, DDL, migrations) and how Salesforce record IDs are generated/parsed.
- Key files: `packages/schema/src/columns.ts` (naming + `ColumnSpec`), `packages/schema/src/ddl.ts` (`planSchema`/`planTable`), `packages/schema/src/migrate.ts`, `packages/schema/src/ids.ts`.

**`packages/formula`:**
- Purpose: the Salesforce-formula-to-record-context bridge: compiles source text (resolving
  field/relationship/global references against an `OrgSchema`) and evaluates compiled formulas.
- Key files: `packages/formula/src/compile.ts`, `packages/formula/src/evaluate.ts`, `packages/formula/src/values.ts`.

**`packages/soql`:**
- Purpose: SOQL query compilation and result shaping, decoupled from the engine so it can be
  unit-tested purely against strings (`packages/soql/src/compile.test.ts`).
- Key files: `packages/soql/src/compile.ts`, `packages/soql/src/shape.ts`, `packages/soql/src/dates.ts` (date-literal ranges), `packages/soql/src/errors.ts`.

**`packages/engine`:**
- Purpose: the write/read choke point — DML order of execution, query execution + pagination,
  trigger hook interface, org bootstrap.
- Key files: `packages/engine/src/engine.ts` (`DmlEngine`), `packages/engine/src/hooks.ts` (`TriggerExecutor`), `packages/engine/src/store.ts` (row-level Postgres access), `packages/engine/src/query.ts` (`runQuery`), `packages/engine/src/bootstrap.ts`.

**`packages/api`:**
- Purpose: the HTTP surface. `src/server.ts` is the composition root; everything
  resource-specific lives in `src/routes/*`; Bulk API 2.0's job model lives in `src/bulk/*`
  because it's stateful and specific to that one feature.
- Key files: `packages/api/src/server.ts` (`createApiServer`), `packages/api/src/describe.ts` (describe-endpoint JSON), `packages/api/src/auth.ts` (`SessionStore`), `packages/api/ui/index.html`.

**`packages/cli`:**
- Purpose: user-facing entry point; wires `metadata` -> `schema` -> `engine` -> `api` together
  and owns process lifecycle (signal handling, exit codes).
- Key files: `packages/cli/src/main.ts` (all three subcommands), `packages/cli/src/index.ts` (bin shebang).

**`packages/sigha`:**
- Purpose: vendored, dependency-free Salesforce formula-language engine (lexer, parser, type
  checker, evaluator) that `@orglet/formula` wraps with schema-aware field resolution.
- Not modified by hand — see `packages/sigha/VENDOR.md` for the sync process. Excluded from
  ESLint's typed rules (`eslint.config.js`) and from most "where do I add code" guidance below.

**`examples/acme`:**
- Purpose: an SFDX source-format fixture project used by package tests, the CLI quick-start,
  and the conformance suites. Not a template to copy verbatim — extend it when a test needs a
  new object/field/validation rule/record type.

**`conformance/jsforce`, `conformance/python`:**
- Purpose: run real upstream Salesforce SDK test suites (`jsforce`, `simple-salesforce`)
  against a live orglet instance instead of a real org, to prove wire-level compatibility.
  Excluded from the TS project build and from ESLint's typed lint.

## Key File Locations

**Entry Points:**
- `packages/cli/src/index.ts`: `orglet` bin shebang, process exit-code handling.
- `packages/cli/src/main.ts`: `up`/`check`/`reset` command implementations.
- `packages/api/src/server.ts`: `createApiServer()`, Fastify app composition root.

**Configuration:**
- `docker-compose.yml`: local Postgres 16, port 5433.
- `tsconfig.base.json` / `tsconfig.json` / `packages/*/tsconfig.json`: TS project references,
  one composite project per package, `packages/*/dist` build output.
- `eslint.config.js`: flat config, typed linting against every package's `tsconfig.json`.
- `vitest.config.ts`: workspace test runner config.
- `.nvmrc`: pinned Node version (engines require Node >=22).

**Core Logic:**
- `packages/engine/src/engine.ts`: DML order of execution (the most load-bearing file in the
  repo — read it before touching insert/update/delete/upsert behavior).
- `packages/soql/src/compile.ts`: SOQL -> SQL compilation.
- `packages/metadata/src/build.ts`: standard-baseline + SFDX merge into `OrgSchema`.

**Testing:**
- Co-located `*.test.ts` next to the code they exercise in every package's `src/` (e.g.
  `packages/engine/src/engine.test.ts`, `packages/soql/src/compile.test.ts`).
- `packages/api/src/api.test.ts` and `packages/api/src/bulk.test.ts` spin up a real
  `createApiServer()` instance for HTTP-level tests.
- `conformance/*` runs external SDK suites, invoked separately from `pnpm test` (see each
  `README.md`/`run.sh`/`run.py`).

## Naming Conventions

**Files:**
- One file per concern, `camelCase`/`lowercase.ts`, e.g. `columns.ts`, `ddl.ts`, `hooks.ts`.
- Tests are co-located as `<name>.test.ts` next to the file under test, not in a separate
  `test/` or `__tests__/` directory.
- Route modules are named after the Salesforce resource they implement:
  `packages/api/src/routes/sobjects.ts`, `query.ts`, `composite.ts`, `bulk.ts`, `login.ts`,
  `misc.ts` (catch-all for `/services/data`, `/limits`, `/search`).
- Every package's public surface is re-exported from a single `src/index.ts` barrel; nothing
  outside a package imports a package's internal files directly (enforced by convention, not
  tooling) — always import from `@orglet/<package>`.

**Standard-object baseline data:**
- `packages/metadata/standard/objects/<ObjectName>.json`, one file per standard object, exact
  Salesforce API name (e.g. `Account.json`, `OpportunityLineItem.json`).

**SFDX fixture data (`examples/acme`):**
- Standard Salesforce SFDX source format: `force-app/main/default/objects/<Object>/...`.
- Custom objects/fields end in `__c` (`Project__c`, `Account__c`); custom relationship names
  end in `__r`. One `fields/<Field__c>.field-meta.xml` file per custom field, one
  `validationRules/<Name>.validationRule-meta.xml` per rule, one
  `recordTypes/<Name>.recordType-meta.xml` per record type — this is the on-disk shape any new
  fixture metadata must follow.

**Database identifiers:**
- Table name = lower-cased object API name; column name = lower-cased field API name
  (`columnName()`/`tableName()` in `packages/schema/src/columns.ts`). Identifiers over 63
  bytes are truncated with a stable hash suffix (`identifier()`).

**Types/interfaces:**
- `PascalCase` for types/interfaces/classes (`SObjectDef`, `FieldDef`, `DmlEngine`,
  `CompiledQuery`); `Def`/`Spec` suffix for schema-shaped data (`FieldDef`, `ColumnSpec`,
  `ForeignKeySpec`); `Options`/`Result` suffix for function parameter/return bags
  (`EngineOptions`, `SaveResult`, `BuildResult`).

## Where to Add New Code

**New REST route / resource:**
- Add a `register<Name>Routes(app, ctx)` function in a new file under
  `packages/api/src/routes/`, following the pattern in `packages/api/src/routes/misc.ts` or
  `sobjects.ts` (signature: `(app: FastifyInstance, ctx: ApiContext) => void`). Register the
  call in `createApiServer()` (`packages/api/src/server.ts:148-153`). Reuse `apiError`,
  `sendErrors`, `session()`, `NOT_FOUND`/`INVALID_SESSION` from `packages/api/src/server.ts`
  for Salesforce-shaped error envelopes.

**New field type:**
- `packages/metadata/src/types.ts`: add to the `FieldType` union and any new `FieldDef`
  properties it needs.
- `packages/metadata/src/build.ts`: handle it in `fromStandardJson()` and/or
  `fromSourceField()` (the `switch (sf.type)` block) for baseline/SFDX conversion.
- `packages/schema/src/columns.ts`: add its SQL type mapping in `columnFor()`/`sqlTypeFor()`.
- `packages/engine/src/coerce.ts`: add client-value coercion rules.
- `packages/soql/src/compile.ts`: add to the relevant type-classification sets (e.g.
  `TEXT_TYPES`) if it affects filtering/sorting SQL generation.
- If formula-relevant: `packages/formula/src/values.ts` (`sfTypeOf`, `toSfValue`/`fromSfValue`).

**New standard object:**
- Add `packages/metadata/standard/objects/<ObjectName>.json` following the shape of an
  existing file (e.g. `packages/metadata/standard/objects/Contact.json`): `name`, `label`,
  `labelPlural`, `keyPrefix` (must be unique), `hasOwner`, `fields[]`.
- No code changes needed elsewhere — `loadBaseline()` (`packages/metadata/src/build.ts:34`)
  picks up every `*.json` file in that directory automatically; schema/DDL/API all derive from
  `OrgSchema`.

**New SOQL feature (function, operator, clause):**
- `packages/soql/src/compile.ts`: the `Compiler` class methods (e.g. condition/function
  handling) are the place to extend; add a unit test in
  `packages/soql/src/compile.test.ts` asserting the emitted SQL string/params.
- If it changes what a row looks like after execution (e.g. a new aggregate shape), also touch
  `packages/soql/src/shape.ts` and the `Shape`/`SObjectShape`/`AggregateShape` types in
  `compile.ts`.
- Unsupported SOQL should raise through `packages/soql/src/errors.ts` (`unsupported()`), not
  silently produce wrong SQL.

**New DML hook / trigger behavior:**
- Implement `TriggerExecutor` (`packages/engine/src/hooks.ts`) and pass it in
  `EngineOptions.executors` when constructing `DmlEngine` (currently only
  `packages/cli/src/main.ts` constructs one, with no executors configured — this is the seam
  for future Apex/Flow support).

**Bulk API 2.0 behavior:**
- Job model and state machine: `packages/api/src/bulk/jobs.ts`.
- CSV parsing/writing: `packages/api/src/bulk/csv.ts`.
- HTTP surface: `packages/api/src/routes/bulk.ts`.

**Utilities:**
- Shared helpers live inside the package that owns the concern (e.g. datetime formatting in
  `packages/schema/src/db.ts` `formatSalesforceDatetime`, value coercion in
  `packages/formula/src/values.ts`) — there is no repo-wide `utils`/`shared` package; do not
  create one for a single new helper. Add it to the most specific existing package instead.

## Special Directories

**`packages/*/dist`:**
- Purpose: TypeScript project-reference build output (`tsc -b`).
- Generated: Yes. Committed: No.

**`packages/*/node_modules`, root `node_modules`:**
- Purpose: pnpm-managed dependencies (workspace uses symlinked `workspace:*` deps between
  packages).
- Generated: Yes. Committed: No.

**`packages/metadata/standard`:**
- Purpose: the built-in standard-object baseline (data, not code) — `files` entry in
  `packages/metadata/package.json` ships it alongside `dist`.
- Generated: No (hand-authored JSON). Committed: Yes.

**`conformance/jsforce/.cache`, `conformance/python/.venv`, `conformance/python/__pycache__`:**
- Purpose: local checkouts/dependencies for running upstream SDK suites.
- Generated: Yes. Committed: No.

**`.planning/`:**
- Purpose: GSD planning artifacts (this document's home: `.planning/codebase/`).
- Generated: By GSD tooling. Committed: project-dependent.

---

*Structure analysis: 2026-09-29*
