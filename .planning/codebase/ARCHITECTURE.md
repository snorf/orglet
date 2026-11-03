# Architecture

**Analysis Date:** 2026-11-03

## Pattern Overview

**Overall:** Layered package architecture with dependency flow: metadata → schema → {formula, soql} → engine → api → cli, plus vendored sigha for formula language parsing.

**Key Characteristics:**
- **Single source of truth:** Postgres is the only datastore; no in-memory caches beyond two job-tracking maps (Bulk API 2.0 state).
- **Salesforce semantics:** Order of execution, ID generation, describe shapes, and error envelopes exactly match documented Salesforce behavior.
- **Explicit unsupported:** Anything not implemented surfaces as `UNSUPPORTED:<area>` prefix in error messages rather than being faked.
- **Schema-driven:** All behavior (validation, formulas, triggers) derives from the loaded OrgSchema, not hardcoded logic.

## Layers

**@orglet/metadata — Org Schema builder:**
- Purpose: Parse SFDX source-format XML, load built-in standard-object baseline, merge custom metadata, and build a runtime OrgSchema model.
- Location: `packages/metadata/src`
- Contains:
  - XML parsing from SFDX projects (`sfdx.ts`)
  - Baseline loading and merge logic (`build.ts`)
  - OrgSchema type definitions and builders (`types.ts`, `schema.ts`)
  - Rollup metadata extraction (`rollup.ts`)
  - Diagnostic collection for warnings and info messages (`diagnostics.ts`)
  - Baseline JSON format validation (`xml.ts`)
- Depends on: `fast-xml-parser` (external), nothing in-repo
- Used by: schema, formula, soql, engine, api, cli (every component needs OrgSchema as reference data)
- Public entry: `loadOrgSchema(options)` loads baseline + optional SFDX project, returning `BuildResult` (schema + diagnostics + info + custom metadata definitions)

**@orglet/schema — Postgres DDL, migrations, Salesforce ID generation:**
- Purpose: Compile an OrgSchema to Postgres DDL, diff/migrate a live database, track rollup backfills, manage custom-object key prefixes.
- Location: `packages/schema/src`
- Contains:
  - Salesforce ID generation and key-prefix mapping (`ids.ts`)
  - Table/column naming conventions for Postgres (`columns.ts`)
  - DDL planning: table creates, column adds/drops/alters, index/FK specs (`ddl.ts`)
  - Migration diffing and application (`migrate.ts`)
  - Rollup field support: SQL generation for recompute + backfill tracking (`rollup.ts`, `backfills.ts`)
  - Key-prefix reconciliation: merge supplied prefixes with persisted and record-derived assignments (`prefixes.ts`)
  - Database pool and transaction management (`db.ts`)
  - Internal _orglet schema setup (prefix/backfill/bulk tables) (`internal.ts`)
- Depends on: metadata, `pg` (Postgres driver)
- Used by: soql (for table/column naming), engine (for ID generation, Store, rollup SQL), api (for Bulk API persistence), cli (for migrate + prefix reconciliation)

**@orglet/formula — Salesforce formula language compiler & evaluator:**
- Purpose: Compile formula expressions to a typed AST, evaluate them in record context, handle formula globals ($User, $Organization, $CustomMetadata, $Api).
- Location: `packages/formula/src`
- Contains:
  - Formula compilation: AST building, field reference resolution, type checking (`compile.ts`)
  - Evaluation: recursive visitor for AST execution in record context (`evaluate.ts`)
  - Formula globals and field-reference dependencies (`compile.ts`, `globals.test.ts`)
  - Type coercion (Salesforce string/date/number semantics) (`values.ts`)
  - Rollup admission: deciding which formula fields can be rollup sources (`rollup-admission.ts`)
  - Rollup input ordering: topologically sort formulas for backfill (`rollup-inputs.ts`)
- Depends on: metadata, sigha (vendored formula-language parser: lexer, AST, analyzer)
- Used by: engine (formula field evaluation, rollup recompute), api (describe/formula globals), cli (formula diagnostic collection)
- Exports: `compileFormula(source, options)` returns `CompiledFormula` ready to evaluate in context; `evaluateCompiled(compiled, context)` returns `FormulaResult`

**@orglet/soql — SOQL query compiler:**
- Purpose: Compile SOQL query strings to parameterized Postgres SQL, shape result rows to Salesforce format, handle date literals and polymorphic relationships.
- Location: `packages/soql/src`
- Contains:
  - Query compilation: SOQL AST → SQL WHERE/SELECT/ORDER/LIMIT (`compile.ts`)
  - Result shaping: convert Postgres rows to Salesforce format (arrays, nested objects, nulls) (`shape.ts`)
  - Date literal expansion (TODAY, LAST_N_DAYS, etc.) (`dates.ts`)
  - Polymorphic relationship (typeof) SQL generation (`polymorphic.ts`, `typeof.ts`)
  - Query error builders (`errors.ts`)
- Depends on: metadata (for field/relationship lookup), schema (for table/column naming), `@jetstreamapp/soql-parser-js` (SOQL AST parser)
- Used by: engine (runQuery for data retrieval), api (query routes)

**@orglet/engine — DML pipeline implementing Salesforce order of execution:**
- Purpose: Execute insert, update, upsert, delete, undelete with Salesforce's documented phase order: beforeTriggers → validation → rollups → formulas → afterTriggers → rollup recompute.
- Location: `packages/engine/src`
- Contains:
  - DML pipeline orchestration, per-record savepoints, allOrNone rollback (`engine.ts`)
  - Hook/trigger interface for user-supplied executors (`hooks.ts`)
  - Per-request change event stream (`events.ts`)
  - Store: low-level row access (load/insert/update/delete) (`store.ts`)
  - Compiled-formula cache with dependency ordering (`formulas.ts`)
  - Parent record loading and relationship validation (`parents.ts`)
  - Rollup recompute logic and child collection (`rollups.ts`)
  - Auto-number and external ID seed logic (`seed.ts`)
  - Custom metadata record seeding and seed planning (`seed.ts`)
  - Value coercion and datetime normalization (`coerce.ts`)
  - Query execution for SOQL/SOSL inside formulas/triggers (`query.ts`)
  - Error definitions and factories (`errors.ts`)
  - Org bootstrap (user/profile/organization/setup records) (`bootstrap.ts`)
- Depends on: metadata, schema, formula, soql
- Used by: api (routes call engine for DML), cli (seeding, bootstrap)
- Public API: `DmlEngine` class (one per running server), methods `save()`, `delete()`, `undelete()`, `query()`, `retrieve()`, `backfillFormulaRollups()`; lifecycle: `beforeTriggers` → per-record pipeline → `afterTriggers` (via `TriggerExecutor` hooks)

**@orglet/api — Salesforce-compatible HTTP surface:**
- Purpose: Expose Salesforce REST/SOAP APIs (login, CRUD, query, describe, Bulk API 2.0, limits) so standard clients (jsforce, simple-salesforce) work unchanged.
- Location: `packages/api/src`
- Contains:
  - Server bootstrap and central error handler (`server.ts`)
  - REST routes by concern: login (SOAP/OAuth) (`routes/login.ts`), sObjects CRUD (`routes/sobjects.ts`), SOQL query (`routes/query.ts`), composite batch (`routes/composite.ts`), Bulk API 2.0 (`routes/bulk.ts`), misc (describe, limits) (`routes/misc.ts`)
  - Session store and token generation (`auth.ts`)
  - Describe (globalDescribe, describe sObject) (`describe.ts`)
  - Bulk API 2.0 implementation:
    - Job/batch persistence in `_orglet` schema (`bulk/schema.ts`)
    - CSV parsing and record staging (`bulk/csv.ts`)
    - Job state machine and completion (`bulk/jobs.ts`)
    - SOQL restrictions for bulk ingest (`bulk/soql-rules.ts`)
    - Job storage helpers (`bulk/store.ts`)
  - Built-in UI (object browser, SOQL console) served from `ui/index.html`
- Depends on: metadata, schema, formula, soql, engine
- Routes organized under `/services/data/<version>/` (REST), `/services/Soap/` (login), `/id/` (session + org info), `/services/apexrest/` (stub for external ID testing)
- HTTP status mapping: 4xx for validation/client errors, 500 for engine failures, error body always JSON array of `{message, errorCode, fields?}`

**@orglet/cli — `orglet` command-line binary:**
- Purpose: Three commands (up, check, reset) to bootstrap an org locally, validate metadata readiness, or clean up persisted state.
- Location: `packages/cli/src`
- Entry point: `index.ts` (shebang wrapper) → `main.ts` (command dispatcher) → `report.ts` (check report generation)
- Commands:
  - `orglet up`: Load metadata, reconcile key prefixes, migrate schema, bootstrap org, seed custom metadata, start Fastify API server
  - `orglet check`: Load metadata, validate admissibility (without database), build diagnostic report, optionally exit non-zero on warnings (--strict)
  - `orglet reset`: Drop org schema and associated job tracking, optionally drop key-prefix assignments (--drop-prefixes)
- Report generation (`report.ts`): Pure function building CheckReport (census, verdict, per-area counts, root-cause groups, diagnostics)
- Depends on: metadata, schema, formula, engine, api

**@orglet/sigha — Salesforce formula language (vendored):**
- Purpose: Lexer, parser, and semantic analyzer for Salesforce formula expressions; vendored from upstream (github.com/rfaulhaber/sigha) to control formula feature set.
- Location: `packages/sigha/src`
- Not edited in this repo; resynced via `scripts/sync-sigha.sh` tracking a specific Git revision
- Exports: lexer, parser, analyzer, corpus (test cases)
- Used by: formula (compile.ts calls sigha to parse and analyze formula ASTs)
- Tracking: `packages/sigha/VENDOR.md` records repository URL and revision; CI verifies reproducible sync with `scripts/sync-sigha.sh`

## Data Flow

**Startup Flow (orglet up):**

```
CLI main()
  ├─ loadOrgSchema(projectDir)  [metadata]
  │   ├─ loadBaseline()                    → Baseline JSON
  │   ├─ readSourceProject(projectDir)     → SFDX XML parsed
  │   └─ buildOrgSchema(baseline, project) → OrgSchema + diagnostics + customMetadata
  │
  ├─ admitFormulaRollups(result)  [formula] → rejects formula rollups if not supported
  │
  ├─ reconcileKeyPrefixes(pool, schema)  [schema]
  │   └─ persists key prefixes to _orglet.key_prefixes
  │
  ├─ migrate(pool, schema)  [schema]
  │   ├─ planSchema(schema) → DDL plan
  │   └─ applies CREATE TABLE / ALTER TABLE statements
  │
  ├─ bootstrapOrg(pool, schema)  [engine]
  │   └─ inserts User, Profile, Organization, UserRole, RecordType setup records
  │
  ├─ planCustomMetadataSeed(schema, customMetadata)  [engine]
  │   └─ builds CustomMetadataPlan (which __mdt records to insert)
  │
  ├─ seedCustomMetadata(pool, schema, plan)  [engine]
  │   └─ inserts __mdt rows via the DmlEngine (fires triggers)
  │
  ├─ prepareBulk(pool, orgSchema)  [api]
  │   └─ creates/reconciles _orglet.bulk_* tables, marks stale jobs Failed
  │
  ├─ new DmlEngine(pool, schema)  [engine]
  │   └─ initializes Hook/Trigger executors, FormulaRegistry
  │
  ├─ engine.backfillFormulaRollups()  [engine]
  │   └─ loads every object's live rows, evaluates formula rollups, inserts backfill marker into _orglet.rollup_backfills
  │
  └─ createApiServer({engine, ...})  [api]
      └─ app.listen(port)
```

**Per-Request Flow (DML Save):**

```
POST /services/data/v59.0/sobjects/{sObject}
  │
  └─ Route handler
     ├─ loginSession(req)             → Session (user, org, profile)
     ├─ engine.save(records, options) [engine]
     │  └─ DmlEngine.save()
     │     ├─ BEFORE_INSERT triggers
     │     ├─ Per-record loop (under savepoint):
     │     │  ├─ coerce values (camelCase → Postgres type)
     │     │  ├─ lookup validation (if not import mode)
     │     │  ├─ duplicate check + external ID uniqueness
     │     │  ├─ required field check
     │     │  ├─ validation rules (if not import mode)
     │     │  ├─ formula field evaluation (async for compound fields)
     │     │  ├─ Store.insert() into Postgres
     │     │  └─ collect errors, retry next record (partial success)
     │     │
     │     ├─ AFTER_INSERT triggers
     │     ├─ RollupRegistry.recompute() (for parents)
     │     │  └─ loads parent rows, evaluates rollup formulas, updates parents under savepoint
     │     │
     │     └─ publish ChangeEvent[] to ChangeBus
     │
     └─ HTTP 201 + SaveResult[] (results: [{id, created}], errors: [{statusCode, message, fields}])
```

**Query Flow (SOQL):**

```
GET /services/data/v59.0/query?q=SELECT...
  │
  └─ route/query.ts
     ├─ session(req)
     ├─ compileSoql(query, {schema})  [soql]
     │  └─ @jetstreamapp/soql-parser-js parses string → AST
     │  └─ walks AST, resolves fields, generates parameterized SQL
     │
     ├─ engine.query(compiled, options)  [engine]
     │  └─ Store.query() executes on Postgres
     │  └─ returns cursor-based result set (locator for nextRecordsUrl)
     │
     ├─ shapeRows(rows, compiled.shape)  [soql]
     │  └─ converts Postgres flattened rows to nested Salesforce format
     │
     └─ HTTP 200 + {records: [...], totalSize, done, nextRecordsUrl?}
```

**Formula Evaluation (during save or rollup recompute):**

```
Field value is formula-computed
  │
  └─ FormulaRegistry.apply(record, schema)  [engine/formulas.ts]
     ├─ compiled = FormulaRegistry.get(field)  ← cached CompiledFormula
     │
     ├─ context = EvaluationContext
     │  ├─ user, organization, profile, setup globals (loaded once per save)
     │  ├─ $CustomMetadata lookup (against CustomMetadataPlan)
     │  └─ $Api session + base URL (if request context)
     │
     └─ evaluateCompiled(compiled, context)  [formula]
        ├─ recursive visitor on AST
        ├─ resolves field references from record data
        ├─ applies Salesforce type coercion
        └─ returns FormulaResult (value or error)
```

**State Management:**

- **Postgres tables:** One table per sObject, plus internal `_orglet` schema (key_prefixes, bulk_jobs, bulk_batches, bulk_staged_rows, rollup_backfills)
- **Per-request** Globals (user, organization, profile, role, custom metadata): loaded once and reused in formula evaluation for the entire batch
- **Per-session** ChangeBus: collects change events, published once per commit
- **Per-server** FormulaRegistry: caches compiled formulas across requests; cleared on shutdown
- **In-transaction**: `session_replication_role = replica` set during import mode to disable foreign-key enforcement

## Key Abstractions

**OrgSchema:**
- Purpose: Runtime model of the org's metadata — every SObjectDef, FieldDef, PicklistDef, ValidationRuleDef, FormulaFailure, custom-metadata definitions.
- Examples: `packages/metadata/src/types.ts` (interfaces), `packages/metadata/src/schema.ts` (loader and builder)
- Pattern: Built once at startup (immutable), passed by reference through every layer; never mutated.
- Provides: `schema.getObject(name)`, `schema.list()`, `schema.objects` (Map), `schema.labels` (Set)

**DmlEngine:**
- Purpose: Single choke point for all writes; orchestrates order of execution, manages Store and FormulaRegistry, collects changes.
- Examples: `packages/engine/src/engine.ts`
- Pattern: One instance per running server, attached to ApiContext; methods called by routes and CLI commands
- Exposes: `save()`, `delete()`, `undelete()`, `query()`, `retrieve()`, `backfillFormulaRollups()`, `transaction(callback)`, `bus` (ChangeBus)

**CompiledFormula:**
- Purpose: Separates expensive parsing + type-checking (formula compile) from evaluation (done per-record).
- Examples: `packages/formula/src/compile.ts`
- Pattern: `compileFormula(source, {schema})` → AST + field references + errors; then `evaluateCompiled(compiled, context)` → value or error, reusable across records
- Cached in FormulaRegistry per-field for the lifetime of the server

**Store:**
- Purpose: Low-level Postgres row access: knows column naming, virtual fields, soft-delete, but nothing about validation.
- Examples: `packages/engine/src/store.ts`, used by DmlEngine internals
- Pattern: Methods `loadByIds()`, `insert()`, `update()`, `delete()`, `findByField()`, `existingIds()`, `liveRows()`
- Encapsulates: Table naming (via columnName), schema quoting, IsDeleted filtering

**FormulaRegistry:**
- Purpose: Caches compiled formulas, builds dependency graph for rollup ordering, holds global values (user, org, etc.).
- Examples: `packages/engine/src/formulas.ts`
- Pattern: Constructed once, holds Map<fieldKey, CompiledFormula>; provides `apply()` and `applyFormulaFields()` for evaluation
- Lifecycle: Holds references across all DML calls until server shutdown

**TriggerExecutor / Hook:**
- Purpose: Interface for external code (future Apex/Flow emulator) to observe or block DML operations.
- Examples: `packages/engine/src/hooks.ts` (interfaces), not yet implemented in core
- Pattern: List of executors run in registration order for every batch; `before` executors block with errors, `after` observers publish side effects
- Per-record state: index, accumulated errors, changes (client values), old (previous row), next (final new row to write)

**RollupRegistry:**
- Purpose: Tracks rollup parent-child relationships, collects affected parents during DML, recomputes their rollup fields after the batch completes.
- Examples: `packages/engine/src/rollups.ts`
- Pattern: Built from schema at engine startup; `affected(records)` collects parent IDs, `recompute(affectedIds)` loads parents and updates their rollup fields
- Circular dependencies: Prevented by depth-order SQL (no infinite loops)

## Entry Points

**CLI Binary:**
- Location: `packages/cli/src/index.ts` (shebang) → `packages/cli/src/main.ts` (dispatcher)
- Triggers: Invoked as `orglet up|check|reset` or directly via `node packages/cli/dist/index.js`
- Responsibilities: Argument parsing, common setup (DB connection, org schema), delegating to command handlers

**API Server:**
- Location: `packages/api/src/server.ts:87` (createApiServer function)
- Triggers: Called once by `orglet up` (packages/cli/src/main.ts:199); can be instantiated directly for integration tests
- Responsibilities: Fastify app setup, route registration, global error handler, content-type negotiation, authentication hook

**Built-in UI:**
- Location: `packages/api/src/server.ts:145-146`, markup/JS in `packages/api/ui/index.html`
- Serves: Single-page HTML/JS (242 lines, no framework, no build step)
- Provides: Object browser (describe), ad-hoc SOQL console, token copy-to-clipboard
- API: Calls server's /services/data and /id endpoints, parses JSON responses

## Error Handling

**Error Classes and HTTP Mapping:**

| Error Class | HTTP Status | Usage | Example |
|---|---|---|---|
| `DmlError` | error.httpStatus (401/403/400/409/404) | Record-level or request-level validation failures | Unknown sObject, required field missing, duplicate external ID |
| `SoqlError` | 400 (always) | Query compilation/execution failures | Invalid SOQL syntax, unknown field, invalid relationship |
| `FormulaCompileError` | Wrapped by DML/Soql error | Formula parsing or type-check failure | Invalid formula syntax, unknown global variable |
| `UnsupportedMetadataError` | Wrapped in diagnostic (cli check) or logged (api) | Unsupported metadata type during parse | Custom Permission, Platform Event |

**Error Shape (per-record SaveError):**

```typescript
{
  statusCode: "REQUIRED_FIELD_MISSING" | "INVALID_TYPE_ON_FIELD_IN_RECORD" | ...,
  message: string,
  fields: string[]
}
```

Real Salesforce StatusCode enum values only; never invented. Built via `Errors.*` factory (e.g., `Errors.requiredMissing(fields)`).

**UNSUPPORTED Marker:**

Prefix on *message text* (not statusCode) when the system recognizes a Salesforce feature it deliberately does not implement, vs. a genuine bug.

Format: `UNSUPPORTED:<kebab-or-single-word-area> <explanation>`

Examples in use: `UNSUPPORTED:formula-global`, `UNSUPPORTED:field-type`, `UNSUPPORTED:composite-rollback`, `UNSUPPORTED:schema-drop`

Logged at three severity levels:
1. Per-record warning (save may continue): `console.warn()`
2. Per-request warning (operation may complete): `req.log.warn()`
3. Metadata-level diagnostic (collected into check report): `formatDiagnostic()` → `warning:` prefix

## Cross-Cutting Concerns

**Logging:**

- `console.log`: Normal progress output (gated by `--quiet` flag)
- `console.warn`: Every warning string including `UNSUPPORTED:*` ones (never gated)
- `console.error`: Fatal startup failures (DB unreachable, config invalid) followed by hint
- `req.log.warn()` (Fastify pino): Per-request expected gaps (composite rollback limitation, SOSL stub)
- Optional `ORGLET_EVENTS=stdout`: One JSON object per line when set, format `{event: "change", ...changeEvent}`

**Validation:**

- Lookup target validation: `matchLookupTarget()` against schema (before insert/update, skipped in import mode)
- Uniqueness: External ID fields checked via `Store.findByField()` before insert/update
- Required fields: `Errors.requiredMissing()` for any non-null, non-auto field without a value
- Validation rules: Evaluated as formulas after coercion, field-level and cross-field rules run in sequence

**Authentication:**

- SOAP login: Parse username/password, issue session token (stored in SessionStore)
- OAuth2 (password grant): Same token issuance, format compatible with jsforce
- Bearer token: Extracted from `Authorization: Bearer <token>` header
- Session TTL: Tokens persist for the lifetime of the server (no expiration in v1.0)
- Import mode: Special session marker allows Ids and audit fields to be written; disables lookups, validation, hooks

---

*Architecture analysis: 2026-11-03 (v1.1 tag, main branch)*
