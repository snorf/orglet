# Architecture

**Analysis Date:** 2026-09-29

## Pattern Overview

**Overall:** Layered pnpm monorepo, one npm package per pipeline stage, wired together by a
thin CLI. Every package is a pure `@orglet/*` library with an `index.ts` barrel export; there
is no shared "core" or "common" package — dependencies point strictly downstream
(`metadata -> schema -> {formula, soql} -> engine -> api -> cli`).

**Key Characteristics:**
- Postgres is the only datastore and the only source of truth (no in-memory record cache);
  each package that touches storage does so through parameterised SQL, never an ORM.
- Salesforce semantics (order of execution, IDs, describe shapes, error envelopes) are
  reproduced deliberately and are heavily commented with *why*, e.g.
  `packages/engine/src/engine.ts:1-7`, `packages/soql/src/compile.ts:1-4`.
- Anything not implemented is surfaced as an `UNSUPPORTED:<area>` warning rather than silently
  faked — see the pattern in `packages/metadata/src/build.ts:430-448` and
  `packages/api/src/routes/misc.ts:66-74` (SOSL).
- One package, `packages/sigha`, is vendored (not authored in this repo) — see
  `packages/sigha/VENDOR.md` and the "do not edit by hand" banner in
  `packages/sigha/src/index.ts:1`.

## Layers

**Metadata (`@orglet/metadata`):**
- Purpose: turn SFDX source-format XML plus the built-in standard-object baseline into an
  in-memory `OrgSchema` (objects, fields, picklists, validation rules, record types).
- Location: `packages/metadata/src`
- Contains: XML parsing (`sfdx.ts`), baseline JSON loading and merge logic (`build.ts`), the
  `OrgSchema` implementation (`schema.ts`), and the type vocabulary (`types.ts`) that every
  downstream package imports.
- Depends on: nothing in-repo (only `fast-xml-parser`).
- Used by: `schema`, `formula`, `soql`, `engine`, `api`, `cli`.

**Schema (`@orglet/schema`):**
- Purpose: compile an `OrgSchema` to Postgres DDL, diff/migrate a live database against it,
  and generate/parse Salesforce-style 18-character record IDs.
- Location: `packages/schema/src`
- Contains: table/column naming (`columns.ts`), DDL planning (`ddl.ts`), migration diffing
  (`migrate.ts`), ID codec (`ids.ts`), and the thin `pg` pool wrapper (`db.ts`).
- Depends on: `metadata`.
- Used by: `soql`, `engine`, `api`, `cli`.

**Formula (`@orglet/formula`):**
- Purpose: compile and evaluate Salesforce formula expressions (formula fields, validation
  rules, default values) against a record context.
- Location: `packages/formula/src`
- Contains: compilation from source to a `CompiledFormula` bound to `FieldDef`s
  (`compile.ts`), context-aware evaluation (`evaluate.ts`), and Salesforce<->JS value
  conversion (`values.ts`, e.g. date/datetime formatting).
- Depends on: `metadata`, `sigha` (the vendored formula-language front end: lexer, parser,
  type checker, evaluator).
- Used by: `engine`.

**SOQL (`@orglet/soql`):**
- Purpose: compile SOQL query strings to parameterised Postgres SQL and shape result rows
  back into nested Salesforce record JSON.
- Location: `packages/soql/src`
- Contains: the compiler (`compile.ts`, built on `@jetstreamapp/soql-parser-js`), date-literal
  range math (`dates.ts`), row->record shaping including parent joins, child subqueries and
  aggregates (`shape.ts`), and SOQL-specific error types (`errors.ts`).
- Depends on: `metadata`, `schema` (for table/column naming).
- Used by: `engine`, `api`.

**Engine (`@orglet/engine`):**
- Purpose: the DML pipeline — insert/update/upsert/delete/undelete implementing Salesforce's
  documented order of execution, plus query execution and org bootstrap.
- Location: `packages/engine/src`
- Contains: the pipeline itself (`engine.ts`), the hook/trigger interface (`hooks.ts`), a
  pub/sub change-event bus (`events.ts`), formula-field/compound-field application
  (`formulas.ts`), parent-record loading for formulas (`parents.ts`), input coercion
  (`coerce.ts`), row-level Postgres access (`store.ts`), SOQL execution + pagination
  (`query.ts`), and first-boot seeding (`bootstrap.ts`).
- Depends on: `metadata`, `schema`, `formula`, `soql`.
- Used by: `api`, `cli`.

**API (`@orglet/api`):**
- Purpose: the Salesforce-compatible HTTP surface — a Fastify app exposing REST sobjects,
  SOQL query, describe, composite, Bulk API 2.0, login, and the built-in browser UI.
- Location: `packages/api/src`, routes under `packages/api/src/routes`, Bulk API internals
  under `packages/api/src/bulk`, static UI at `packages/api/ui/index.html`.
- Contains: server bootstrap and cross-cutting hooks (`server.ts`), session/auth
  (`auth.ts`), describe-endpoint JSON shaping (`describe.ts`), and one route module per
  resource family.
- Depends on: `metadata`, `schema`, `formula`, `soql`, `engine`.
- Used by: `cli`.

**CLI (`@orglet/cli`):**
- Purpose: the `orglet` binary — `up` (load metadata, migrate, bootstrap, serve), `check`
  (validate an SFDX project without touching Postgres), `reset` (drop the org schema).
- Location: `packages/cli/src` (`index.ts` is the `#!/usr/bin/env node` entry, `main.ts` holds
  argument parsing and command implementations).
- Depends on: `metadata`, `schema`, `engine`, `api`.
- Used by: end users / `docker-compose.yml` / conformance scripts.

**Sigha (`@orglet/sigha`, vendored):**
- Purpose: the dependency-free Salesforce formula *language* front end that `@orglet/formula`
  wraps: lexer/parser/AST (`syntax/`), function and context registry (`registry/`), static
  type checker (`analysis/`), and the tree-walking evaluator (`engine/`).
- Location: `packages/sigha/src`
- Not edited by hand — resynced from upstream via `scripts/sync-sigha.sh` (see
  `packages/sigha/VENDOR.md`). Excluded from ESLint's type-checked ruleset
  (`eslint.config.js:5`) since it is vendored code.
- Depends on: `decimal.js` only.
- Used by: `formula`.

## Data Flow

**SFDX source -> OrgSchema -> Postgres DDL (startup):**

1. `orglet up --project <dir>` calls `loadOrgSchema()` (`packages/metadata/src/index.ts:18`),
   which loads the built-in baseline (`packages/metadata/standard/objects/*.json` +
   `standardValueSets.json` via `loadBaseline()`) and, if `--project` is given, parses the
   SFDX tree (`readSourceProject()` in `packages/metadata/src/sfdx.ts`).
2. `buildOrgSchema()` (`packages/metadata/src/build.ts:409`) merges the two: standard objects
   from the baseline are extended with project overrides (label, sharing model, custom
   fields, validation rules, record types); files under `objects/*__c/` become new custom
   objects with a stable, name-ordered key prefix (`customKeyPrefix()`,
   `packages/metadata/src/build.ts:401`). Anything unsupported (custom metadata types, object
   history/feed/share objects, unknown standard fields, dangling lookup targets) becomes an
   `UNSUPPORTED:*` warning instead of an error.
3. `planSchema`/`planTable` (`packages/schema/src/ddl.ts`) turn every `SObjectDef` into a
   `TablePlan`: one Postgres table per object (lower-cased API name), one column per stored
   field, foreign keys for single-target lookups/master-details, and indexes for lookups,
   unique fields and external IDs.
4. `migrate()` (`packages/schema/src/migrate.ts`) diffs the plan against the live database and
   applies `CREATE TABLE`/`ALTER TABLE` statements; destructive changes (dropped
   columns/tables, narrowed types) require `--force`.
5. `bootstrapOrg()` (`packages/engine/src/bootstrap.ts`) seeds the Organization row, the
   System Administrator Profile, the admin User, and one RecordType row per metadata record
   type — idempotently, keyed on username.

**REST -> engine DML pipeline (Salesforce order of execution):**

1. A route handler (e.g. `packages/api/src/routes/sobjects.ts`) resolves the session from the
   bearer token and calls `DmlEngine.insert/update/upsert/delete/undelete`
   (`packages/engine/src/engine.ts`).
2. Each call opens one Postgres transaction (`run()`, `engine.ts:207`); every record is
   prepared (`prepareInsert`/`prepareUpdate`/`prepareId`) and, for update/delete/undelete, its
   prior row is attached (`attachOld`).
3. `saveBatch()` (`engine.ts:351`) builds the prospective row (system defaults, audit fields,
   owner), then runs, in order: **before** hooks (`runHooks`, skipped in import mode) ->
   Salesforce-derived field rules (`applyPlatformRules`: Opportunity stage
   probability/forecast/IsClosed/IsWon, Case Status -> IsClosed/ClosedDate) -> required-field
   checks (`checkRequired`) -> reference/foreign-key checks (`checkReferences`) -> custom
   validation rules compiled by `@orglet/formula` (`FormulaRegistry.validationRules`) -> the
   actual `INSERT`/`UPDATE` under a savepoint per record (so one unique-constraint violation
   fails only that record) -> **after** hooks.
4. Delete cascades/restricts/nulls child records per `ChildRelationship.cascadeDelete` /
   `restrictedDelete` (`deleteBatch()`, `engine.ts:526`); undelete reverses it
   (`undeleteBatch()`).
5. `allOrNone` rolls the whole transaction back if any record failed; otherwise partial
   success commits and each record reports its own errors (`run()`).
6. On commit, per-object/per-type `ChangeEvent`s are published on `DmlEngine.bus`
   (`packages/engine/src/events.ts`); `ORGLET_EVENTS=stdout` prints them as JSON
   (`packages/cli/src/main.ts:85`) — the seam future change-event delivery (Kafka/SQS) would
   subscribe to.

**SOQL -> SQL compiler and result shaping:**

1. `runQuery()` (`packages/engine/src/query.ts:30`) calls `compileSoql()`
   (`packages/soql/src/compile.ts`), which parses the query with
   `@jetstreamapp/soql-parser-js`, resolves every field/relationship path against the
   `OrgSchema`, and emits one parameterised `SELECT` (parent lookups become joins, child
   relationship subqueries become correlated `json_agg` subqueries) plus a `Shape` describing
   how to turn rows back into nested records.
2. `runQuery` wraps the compiled SQL in an outer `SELECT ... LIMIT batchSize+1 OFFSET offset`
   to implement stateless pagination (Salesforce's `nextRecordsUrl`) without re-running the
   planner per page; it only pays for a `COUNT(*)` when a page turns out to be non-final.
3. `shapeRows()` (`packages/soql/src/shape.ts`) turns raw rows into Salesforce JSON
   (`attributes`, nested parent objects, child arrays). Formula fields selected in the query
   are computed afterward against the full stored row (`computeFormulaFields`,
   `packages/engine/src/query.ts:69`) since the compiler cannot push them into SQL.
4. SOQL errors (`packages/soql/src/errors.ts`) and DML errors
   (`packages/engine/src/errors.ts`) are both mapped to Salesforce's REST error envelope by
   the Fastify error handler in `packages/api/src/server.ts:135`.

**Formula evaluation:**

1. `compileFormula()` (`packages/formula/src/compile.ts`) parses and type-checks a formula
   with vendored `sigha` (`analyze`, `parse`), resolves every field/relationship/global
   (`$User`, `$Profile`, `$Organization`, `$RecordType`) reference to a `FieldDef`, and
   rewrites `PRIORVALUE`/`ISCHANGED`/`ISNEW` into synthetic references so the evaluator never
   needs special-casing for record state.
2. `evaluateCompiled()` (`packages/formula/src/evaluate.ts`) runs the compiled AST against an
   `EvaluationContext` (`record`, optional `old`, `isNew`, and the loaded globals).
3. `FormulaRegistry` (`packages/engine/src/formulas.ts`) compiles every formula field, default
   value and validation rule once per `OrgSchema` and exposes `parentPaths()` so the engine
   knows which parent records to preload (`loadParents`, `packages/engine/src/parents.ts`)
   before evaluating.

**Hook / trigger interface:**

- `TriggerExecutor.run(ctx: TriggerContext)` (`packages/engine/src/hooks.ts`) is the single
  extension point around every DML event (`before`/`after` x `insert`/`update`/`delete`/
  `undelete`). `DmlEngine` is constructed with a list of executors
  (`EngineOptions.executors`, `engine.ts:21`) and calls all of them for every batch
  (`runHooks()`, `engine.ts:580`); `before` hooks may mutate `records` in place, and
  `addError(index, message, field)` fails an individual record with
  `FIELD_CUSTOM_VALIDATION_EXCEPTION`. This is the documented seam where Apex triggers and
  record-triggered Flow would plug in later; nothing in this repo implements Apex.

**Import mode:**

- `orglet up --import` (or `EngineOptions.importMode`) is data-migration mode: `Id` and audit
  fields on the input are kept as-is, Postgres foreign-key enforcement is disabled for the
  session (`SET LOCAL session_replication_role = replica`, `engine.ts:215`) so parents and
  children can load in any order, and hooks/validation rules/lookup checks are skipped
  (`saveBatch()` gates each of these on `!this.importMode`). It is a deliberate "automation
  off" data-load mode, not a shortcut in the normal path.

**Bulk API 2.0 jobs:**

1. Ingest and query jobs are in-memory only (`JobStore`, `packages/api/src/bulk/jobs.ts`),
   scoped per server instance (a fresh store per `registerBulkRoutes()` call) — there is no
   persistence or background worker.
2. Everything happens synchronously inside the triggering request: ingest data is parsed from
   CSV (`packages/api/src/bulk/csv.ts`) and run through the same `DmlEngine` batch operations
   as the REST surface, in `CHUNK_SIZE = 200` batches (`packages/api/src/routes/bulk.ts:18`);
   `state` transitions straight from `Open` to `JobComplete`/`Failed` on the
   `UploadComplete` call. Query jobs run `runQuery()` eagerly and cache the full CSV result for
   offset-paged download.
3. Success/failure CSVs follow the documented shape (`sf__Id, sf__Created, ...` /
   `sf__Id, sf__Error, ...`).

**State Management:**
- No application-level state beyond Postgres itself and the two in-memory maps for Bulk API
  jobs and query locators (`ApiContext.locators`, `packages/api/src/server.ts:39`, used for
  `nextRecordsUrl`) and the session store (`SessionStore`, `packages/api/src/auth.ts`).
  Nothing is cached across requests; every read goes back to Postgres.

## Key Abstractions

**`OrgSchema` / `OrgSchemaImpl`:**
- Purpose: the org's metadata model — every `SObjectDef`, its `FieldDef`s, picklist value
  sets, and precomputed child-relationship index.
- Examples: `packages/metadata/src/types.ts` (interfaces), `packages/metadata/src/schema.ts`
  (implementation), export surface `packages/metadata/src/index.ts`.
- Pattern: built once at startup (`loadOrgSchema`), then passed by reference (never mutated)
  into `schema`, `soql`, `formula`, `engine`, `api`. `getObject`/`getField` are lower-cased
  lookups; `childRelationships()` is precomputed in the constructor.

**`DmlEngine`:**
- Purpose: the single choke point for all writes and the source of the `Store`/`FormulaRegistry`/
  `ChangeBus` instances a running org needs.
- Examples: `packages/engine/src/engine.ts`, exported via `packages/engine/src/index.ts`.
- Pattern: one instance per running server (constructed once in `packages/cli/src/main.ts:81`),
  holding a `pg` `Pool`, the `OrgSchema`, and the configured `TriggerExecutor[]`.

**`CompiledFormula` / `FormulaRegistry`:**
- Purpose: separates the expensive step (parse + type-check + reference resolution) from the
  cheap step (evaluate against a record), and centralizes "which formulas exist on this
  schema" so the engine and formula default-value/validation-rule logic share one compiled
  set.
- Examples: `packages/formula/src/compile.ts`, `packages/engine/src/formulas.ts`.

**`CompiledQuery` / `Shape`:**
- Purpose: separates "SOQL -> SQL" (pure, testable in `packages/soql/src/compile.test.ts`)
  from "rows -> Salesforce JSON" (`shapeRows`), and carries enough metadata (`computed`,
  `fetchesAllColumns`) for the engine to know it must post-process formula fields.
- Examples: `packages/soql/src/compile.ts`, `packages/soql/src/shape.ts`.

**`TriggerExecutor` / `TriggerContext`:**
- Purpose: the only way code outside `DmlEngine` observes or blocks a DML operation.
- Examples: `packages/engine/src/hooks.ts`.
- Pattern: list of executors run in registration order for every batch; `before` executors
  mutate `records` in place, any executor can call `ctx.addError()` to fail individual rows.

**`Work` (internal to `DmlEngine`):**
- Purpose: per-record pipeline state (index, accumulated errors, `changes` vs. `next` vs.
  `old`) threaded through prepare -> hooks -> validate -> write -> hooks.
- Examples: `packages/engine/src/engine.ts:38-49` (not exported; internal only).

## Entry Points

**CLI `orglet up` / `check` / `reset`:**
- Location: `packages/cli/src/index.ts` (shebang wrapper) -> `packages/cli/src/main.ts`
  (`main(argv)`).
- Triggers: invoked as the `orglet` bin (`packages/cli/package.json` `bin.orglet`) or directly
  via `node packages/cli/dist/index.js up --project <dir>`.
- Responsibilities: `up` loads metadata, connects to Postgres, migrates the schema, bootstraps
  the org, constructs `DmlEngine`, starts the Fastify server and blocks (`return -1` from
  `main.ts:up()` signals "keep running" to `index.ts`); `check` validates an SFDX project
  without touching Postgres; `reset` drops the org's Postgres schema.

**Fastify server (`createApiServer`):**
- Location: `packages/api/src/server.ts:79`.
- Triggers: called once by `orglet up` (`packages/cli/src/main.ts:88`); also called directly
  by tests (`packages/api/src/api.test.ts`, `bulk.test.ts`) and conformance scripts.
- Responsibilities: registers global content-type parsers (permissive JSON, raw XML/SOAP),
  the bearer-auth `onRequest` hook for every `/services/data/v*` and `/id/*` path, the
  `Sforce-Limit-Info` response header, the built-in UI route, the 404/error handlers that
  produce Salesforce's error envelope, and all route modules
  (`registerLoginRoutes`/`registerSobjectRoutes`/`registerQueryRoutes`/
  `registerCompositeRoutes`/`registerBulkRoutes`/`registerMiscRoutes`).

**Built-in page at `/`:**
- Location: served from `packages/api/src/server.ts:145-146`, markup/JS in
  `packages/api/ui/index.html` (single self-contained file, no build step, shipped via the
  `ui` entry in `packages/api/package.json` `files`).
- Responsibilities: an object browser and ad-hoc SOQL console against the running org, talking
  to the same `/services/data/*` REST endpoints external clients use.

## Error Handling

**Strategy:** Every layer defines its own typed error class/constructor set, and only the
Fastify error handler (`packages/api/src/server.ts:135`) knows how to turn them into HTTP +
Salesforce's JSON error-array envelope (`[{ message, errorCode, fields? }]`).

**Patterns:**
- `DmlError` + `Errors.*` factories (`packages/engine/src/errors.ts`) carry an `httpStatus`,
  a Salesforce `statusCode` (e.g. `REQUIRED_FIELD_MISSING`, `INVALID_CROSS_REFERENCE_KEY`,
  `FIELD_CUSTOM_VALIDATION_EXCEPTION`) and optional `fields`. Per-record DML failures are
  collected as `SaveError[]` on a `SaveResult` rather than thrown, so one bad record in a
  batch doesn't abort the others (`saveErrorsToApi()` /`statusFor()` in
  `packages/api/src/routes/sobjects.ts`).
- `SoqlError` + helpers (`malformed`, `invalidField`, `invalidType`, `invalidRelationship`,
  `unsupported` in `packages/soql/src/errors.ts`) are thrown during compilation and caught by
  the same top-level handler.
- Unsupported-but-tolerated input (metadata the parser can't represent, SOSL search) logs an
  `UNSUPPORTED:*` warning once and degrades gracefully instead of throwing — see
  `ApiContext.unsupported` (`packages/api/src/server.ts:37`) and
  `packages/api/src/routes/misc.ts:66-74`.
- Postgres unique-constraint violations (`23505`) are caught per-record inside a savepoint and
  translated back into a Salesforce `DUPLICATE_VALUE` error with the conflicting field name
  (`duplicateError()`, `packages/engine/src/engine.ts:514`); every other Postgres error
  propagates and rolls back the whole transaction.

## Cross-Cutting Concerns

**Logging:** Fastify's built-in logger, enabled via `ApiOptions.logger` (wired to `!quiet` in
`packages/cli/src/main.ts:88`). Structured change events are optionally printed as JSON to
stdout when `ORGLET_EVENTS=stdout` (`packages/cli/src/main.ts:85`). No external log/metrics
sink.

**Validation:** Layered, matching Salesforce's own order — schema-level (required/type
coercion in `packages/engine/src/coerce.ts`), referential (`checkReferences`), then
declarative validation rules compiled by `@orglet/formula` and run per-record
(`packages/engine/src/engine.ts:387-401`). All three run inside the same transaction as the
write and can each add per-record errors.

**Authentication:** `SessionStore` (`packages/api/src/auth.ts`) issues and resolves bearer
tokens for both SOAP login (`/services/Soap/u/*`) and OAuth password grant
(`/services/oauth2/token`). Two modes: `permissive` (any password accepted, default for local
dev) and `list` (fixed `username:password` pairs from `orglet up --users`). Every
`/services/data/v*` and `/id/*` request is gated by the `onRequest` hook in
`packages/api/src/server.ts:106-120`, which attaches `req.login` and the resolved API version.
