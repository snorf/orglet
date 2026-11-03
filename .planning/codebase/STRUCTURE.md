# Codebase Structure

**Analysis Date:** 2026-11-03

## Directory Layout

```
project-root/
├── packages/
│   ├── metadata/              # SFDX XML + baseline JSON → OrgSchema
│   ├── schema/                # OrgSchema → Postgres DDL, migrations, IDs
│   ├── formula/               # Salesforce formula compilation + evaluation
│   ├── soql/                  # SOQL → parameterized SQL + result shaping
│   ├── engine/                # DML pipeline, order of execution, rollups
│   ├── api/                   # Fastify REST/SOAP endpoints + Bulk API 2.0
│   ├── cli/                   # orglet up/check/reset commands
│   └── sigha/                 # Vendored: Salesforce formula language parser
│
├── conformance/               # External SDK conformance tests (jsforce, python, describe, rollup, etc.)
│   ├── jsforce/               # jsforce library integration tests
│   ├── python/                # simple-salesforce library integration tests
│   ├── describe-check/        # describe() endpoint conformance (enterprise & acme)
│   ├── poly-check/            # Polymorphic relationship conformance
│   ├── cmdt-check/            # Custom metadata seeding conformance
│   └── rollup-check/          # Rollup field formula conformance
│
├── examples/
│   ├── acme/                  # Simpler fixture: standard objects + custom fields/objects
│   │   └── force-app/main/default/objects/
│   └── enterprise/            # Complex fixture: custom metadata, relationships, rollups
│       └── force-app/main/default/objects/
│
├── scripts/
│   ├── gen-baseline/          # Salesforce standard-object baseline generator
│   │   ├── generate.ts        # Main orchestration
│   │   ├── pipeline.ts        # Multi-stage data transformation
│   │   ├── sources.ts         # PDF/JSON source parsing
│   │   ├── gating.ts          # Feature-gated standard fields
│   │   ├── typemap.ts         # Field type mappings
│   │   ├── overrides.json     # Manual corrections to source data
│   │   ├── objects.json       # Which standard objects to include
│   │   └── source/            # Downloaded Salesforce docs (PDFs, JSON snapshots)
│   ├── sync-sigha.sh          # Re-vendor sigha from upstream Git revision
│   └── run-all.sh             # Conformance harness orchestrator
│
├── .github/
│   └── workflows/
│       └── ci.yml             # GitHub Actions: test, lint, conformance, sync checks
│
├── .planning/                 # GSD planning artifacts
│   ├── codebase/              # These analysis documents
│   │   ├── ARCHITECTURE.md
│   │   └── STRUCTURE.md
│   ├── phases/                # Completed phase specifications
│   ├── milestones/            # Milestone documentation
│   ├── todos/                 # Feature backlog
│   ├── quick/                 # Small-task notes
│   └── research/              # Investigation outcomes
│
├── .editorconfig              # Indent/EOL/charset baseline (2-space, LF)
├── .env.example               # Template for local env vars (ORGLET_DATABASE_URL, ORGLET_PG_PORT)
├── .gitignore                 # Excludes .env, dist/, node_modules/
├── .npmrc                      # engine-strict=true, auto-install-peers=true
├── .nvmrc                     # Node 22
├── docker-compose.yml         # Postgres 16 single-service compose
├── eslint.config.js           # Flat config, TypeScript-aware
├── pnpm-workspace.yaml        # Workspace definition: packages/*, conformance/*
├── pnpm-lock.yaml             # Single lockfile for entire workspace
├── tsconfig.base.json         # Base: strict mode + strict flags, ES2022 target
├── tsconfig.json              # Composite project references (tsc -b entry)
├── tsconfig.test.json         # Non-composite test config with @orglet/* aliases
├── tsconfig.scripts.json      # Baseline generator config
├── vitest.config.ts           # Single workspace test config, @orglet/* aliases
├── package.json               # Root workspace definition + scripts (build, test, lint, baseline:gen, etc.)
└── README.md                  # Public documentation
```

## Directory Purposes

**packages/ (8 packages, ordered by dependency):**

| Package | Purpose | Key exports |
|---|---|---|
| `metadata` | Parse SFDX XML, load baseline JSON, build OrgSchema model | `loadOrgSchema()`, `OrgSchemaImpl`, `buildOrgSchema()`, `readSourceProject()` |
| `schema` | DDL planning, Postgres migration, ID generation, key-prefix management | `migrate()`, `planSchema()`, `generateId()`, `reconcileKeyPrefixes()`, `Store` |
| `formula` | Compile & evaluate Salesforce formula expressions | `compileFormula()`, `evaluateCompiled()`, `FormulaRegistry` |
| `soql` | Compile SOQL to SQL, shape results, handle date literals | `compileSoql()`, `shapeRows()` |
| `engine` | DML pipeline (save/delete/undelete), order of execution, rollups, hooks | `DmlEngine`, `bootstrapOrg()`, `store.ts`, `rollups.ts`, `seed.ts` |
| `api` | Fastify HTTP server: REST/SOAP login, CRUD routes, query, describe, Bulk API 2.0 | `createApiServer()`, SessionStore, routes/* |
| `cli` | `orglet up|check|reset` commands, check report generation | `main()` (entry), `report.ts` (check report builder) |
| `sigha` | Vendored formula-language parser (lexer, AST, analyzer) from upstream | (not edited; re-synced via `scripts/sync-sigha.sh`) |

**conformance/:**
- **jsforce/**: Run jsforce test suite against orglet (seed.mjs fixture, run.sh harness)
- **python/**: Run simple-salesforce test suite (run.py, requirements.txt)
- **describe-check/**: Compare describe() output with real Salesforce snapshot (JSON contract)
- **poly-check/**: Polymorphic relationship (typeof) correctness checks
- **cmdt-check/**: Custom metadata record seeding correctness (compare with real org)
- **rollup-check/**: Rollup field formula evaluation (compare with real org results)
- All use `.venv/` (Python virtual envs) and `.cache/` (downloaded fixtures); not committed

**examples/:**
- **acme/**: Simpler SFDX project (Account, Contact, Opportunity, custom objects Project__c/Milestone__c)
- **enterprise/**: More complex (custom metadata Service_Level__mdt/Service_Region__mdt, org defaults, service orders with rollups)
- Used by: CLI tests, conformance suite, CI check runs
- Format: Standard SFDX with `sfdx-project.json`, `force-app/main/default/objects/`

**scripts/:**
- **gen-baseline/**: Generates `packages/metadata/standard/*.json` from Salesforce public docs
  - Input sources: `source/` subdirectory (PDFs, JSON snapshots from describe APIs)
  - Output: One JSON file per standard object (Account.json, Contact.json, etc.) with field definitions
  - CI check: Verifies regeneration reproduces committed baseline exactly
- **sync-sigha.sh**: Clones sigha repo at recorded Git revision, copies src/corpus/LICENSE into `packages/sigha/`
  - Idempotent: Safe to run multiple times
  - CI check: Verifies committed sigha exactly matches regeneration

**.github/workflows/:**
- **ci.yml**: Four jobs: test-pglite (no Docker), test-postgres (integration), conformance (jsforce + python), sigha-sync-check, baseline-gen-check
- Runs on: push, pull_request to main
- Concurrency: Cancel in-progress runs for the same ref

## Key File Locations

**Entry Points:**

| File | Purpose |
|---|---|
| `packages/cli/src/index.ts` | Shebang wrapper (`#!/usr/bin/env node`) + error handler |
| `packages/cli/src/main.ts` | Command dispatcher (up, check, reset) |
| `packages/api/src/server.ts` | `createApiServer()` function (Fastify app) |
| `packages/api/src/routes/*.ts` | Route handlers by concern (login, sobjects, query, composite, bulk, misc) |
| `packages/api/ui/index.html` | Built-in browser UI (242 lines, no framework) |

**Configuration:**

| File | Purpose |
|---|---|
| `package.json` | Root workspace + scripts (build, test, lint, baseline:gen) |
| `pnpm-workspace.yaml` | Workspace packages + conformance/* |
| `tsconfig.base.json` | Compiler options: strict mode, ES2022, NodeNext |
| `tsconfig.test.json` | Test-only variant with `@orglet/*` path alias |
| `.editorconfig` | Indent/EOL/charset (2-space, LF, UTF-8) |
| `.eslintrc` → `eslint.config.js` | Flat config, type-checked linting |
| `vitest.config.ts` | Test runner config: node environment, 30s timeout |

**Core Logic:**

| File | Purpose |
|---|---|
| `packages/metadata/src/build.ts` | `buildOrgSchema()` loader + merger |
| `packages/metadata/src/sfdx.ts` | SFDX XML parser (fast-xml-parser) |
| `packages/metadata/src/types.ts` | OrgSchema, SObjectDef, FieldDef interfaces |
| `packages/schema/src/ddl.ts` | `planSchema()` → DDL plan |
| `packages/schema/src/migrate.ts` | Apply DDL to Postgres |
| `packages/schema/src/columns.ts` | Table/column naming, SQL type mapping |
| `packages/engine/src/engine.ts` | `DmlEngine` class + order of execution |
| `packages/engine/src/formulas.ts` | `FormulaRegistry` + formula field application |
| `packages/engine/src/rollups.ts` | Rollup recompute logic |
| `packages/engine/src/store.ts` | Low-level Postgres row access |
| `packages/api/src/auth.ts` | `SessionStore`, login token generation |
| `packages/api/src/describe.ts` | globalDescribe, objectDescribe builders |
| `packages/api/src/bulk/jobs.ts` | Bulk API 2.0 job state machine |
| `packages/soql/src/compile.ts` | SOQL AST → SQL compiler |
| `packages/formula/src/compile.ts` | Formula parser → AST + field dependencies |

**Testing:**

| Pattern | Location |
|---|---|
| Per-package tests | `packages/*/src/**/*.test.ts` (co-located with source) |
| Test config | `vitest.config.ts` (root) — single config for all packages |
| Test database | Postgres container (conformance, integration tests) or pglite (pure unit tests) |
| Test aliases | `vitest.config.ts` + `tsconfig.test.json` map `@orglet/*` to `packages/*/src/index.ts` for build-less test runs |
| Total test files | ~80 test.ts files across all packages |

## Naming Conventions

**Files:**

- **Single-concept files (one function/class/concern):** Lowercase, no separators: `engine.ts`, `errors.ts`, `store.ts`, `bootstrap.ts`, `hooks.ts`, `seed.ts`, `coerce.ts`, `query.ts`, `parents.ts`, `events.ts`, `rollups.ts`
- **Multi-concept files:** Lowercase compound noun: `build.ts`, `sfdx.ts`, `schema.ts`, `types.ts`, `xml.ts`, `columns.ts`, `ddl.ts`, `migrate.ts`, `db.ts`, `internal.ts`, `prefixes.ts`, `compile.ts`, `evaluate.ts`, `values.ts`, `shape.ts`, `describe.ts`, `auth.ts`, `server.ts`
- **Sub-package organization:** Directories group a feature family by route/module: `routes/*.ts` (one file per REST surface), `bulk/*.ts` (Bulk API 2.0 implementation)
- **Test files:** Suffixed `.test.ts`, co-located with source (same directory as what they test)
- **Barrel files:** `src/index.ts` — one per package, only public entry point

**Functions & Constants:**

- **Functions:** `camelCase`, verb-first for actions: `planSchema()`, `planTable()`, `loadParents()`, `applyFormulaFields()`, `coerceRecord()`, `bootstrapOrg()`, `runQuery()`, `compileFormula()`, `evaluateCompiled()`
- **Error-constructing helpers:** Read as short phrase, return value not throw: `saveError()`, `Errors.requiredMissing()`, `apiError()`, `unknownSObject()`
- **Pure lookups/predicates:** Noun or adjective: `columnName()`, `tableName()`, `isVirtual()`, `keyPrefixOf()`, `matchLookupTarget()`
- **Private helpers within a file:** Unexported plain functions, not class methods: `isDir()`, `readXml()`, etc.
- **Constants (enums/lookup tables):** `UPPER_SNAKE_CASE`: `CUSTOM_FIELD_TYPES`, `DEFAULT_ORG_SCHEMA`, `INTERNAL_SCHEMA`
- **Test fixtures/paths:** `UPPER_SNAKE_CASE` when acting as a constant: `const ACME = fileURLToPath(...)`

**Types & Interfaces:**

- **Interfaces, types, classes:** `PascalCase`
- **Interfaces:** Not prefixed with `I` (e.g., `FieldDef`, `SObjectDef`, `OrgSchema`, not `IFieldDef`)
- **Suffix conventions:**
  - `*Def`: Schema/metadata definitions (`FieldDef`, `SObjectDef`, `PicklistDef`, `ValidationRuleDef`)
  - `*Options`: Constructor/function option bags (`EngineOptions`, `DmlOptions`, `CompileOptions`, `MigrateOptions`)
  - `*Result`: Return payloads (`SaveResult`, `MigrateResult`, `LoginResult`, `BuildResult`)
  - `*Error`: Error subclasses (`DmlError`, `SoqlError`, `FormulaCompileError`, `UnsupportedMetadataError`)

## Where to Add New Code

**New REST Route:**
- File: `packages/api/src/routes/{concern}.ts` (e.g., `composite.ts`, `bulk.ts`, `query.ts`)
- Register: Call from `createApiServer()` in `packages/api/src/server.ts` (line ~145)
- Tests: Co-located `packages/api/src/{concern}.test.ts`
- Pattern: Export `register{Concern}Routes(app, ctx)`, use `sendErrors(reply, status, errors)` for error responses

**New Field Type:**
- File: Add type definition to `packages/metadata/src/types.ts`
- Coercion: Add case to `packages/engine/src/coerce.ts` (if special handling needed)
- DDL: Add mapping in `packages/schema/src/columns.ts` → `sqlTypeFor(field)`
- Tests: Add to existing `*.test.ts` in the affected packages

**New Validation Rule Type:**
- File: Add parsing to `packages/metadata/src/sfdx.ts` (`parseValidationRule()`)
- Evaluation: Engine already evaluates formulas; add syntax to formula parser (sigha) if needed
- Tests: `packages/metadata/src/sfdx.test.ts`, `packages/engine/src/engine.test.ts`

**New Formula Global ($X):**
- File: Add to `packages/formula/src/compile.ts` (GlobalRoot type and `resolveGlobal()`)
- Availability: Define when global is available (DML context, query context, always)
- Tests: `packages/formula/src/globals.test.ts`
- Engine integration: Add to Globals interface in `packages/engine/src/engine.ts` if it needs per-request setup

**New CLI Command:**
- File: `packages/cli/src/main.ts` (add function like `async function myCommand(c: Common, ...): Promise<number>`)
- Dispatcher: Add case to `main()` function (line ~280+)
- Usage: Update `USAGE` string at top of `main.ts`
- Tests: `packages/cli/src/main.test.ts`

**New Package (rare):**
- Create `packages/newname/` with:
  - `package.json` (name: `@orglet/newname`, type: `module`, exports, main, types)
  - `src/index.ts` (barrel: export all public APIs)
  - `tsconfig.json` (extends `../../tsconfig.base.json`, project references to dependencies)
  - `README.md` if module-level docs needed
- Update `pnpm-workspace.yaml` if not in `packages/*` glob
- Update root `tsconfig.json` references
- Add to CI job in `.github/workflows/ci.yml` if it needs testing

## Special Directories

**packages/sigha/ (Vendored):**
- Purpose: Salesforce formula-language front end (lexer, parser, analyzer)
- Source: Synced from upstream git repository (github.com/rfaulhaber/sigha)
- Tracking: `packages/sigha/VENDOR.md` records Repository URL and Revision
- Sync script: `scripts/sync-sigha.sh <revision>`
- CI check: `sigha-sync-check` job verifies reproducible sync
- Not edited by hand; any improvements go upstream → resync
- License: BSD-3 (see packages/sigha/LICENSE)

**packages/metadata/standard/ (Generated):**
- Purpose: Built-in baseline JSON for standard Salesforce objects
- Format: One file per object (Account.json, Contact.json, etc.)
- Generated from: `scripts/gen-baseline/` (sources/, overrides.json, v1-pins.json)
- CI check: `baseline-gen-check` verifies regeneration is reproducible
- Committed to repo; do not hand-edit
- Generator inputs: PDFs/snapshots in `scripts/gen-baseline/source/`

**conformance/ (Integration Tests):**
- Not part of the build
- Run separately via `conformance/run-all.sh` (CI job)
- Each subdirectory runs against a live orglet instance + real org (or snapshot)
- Languages: Bash (harness), JavaScript (jsforce), Python (simple-salesforce)
- Outputs: Pass/fail per suite, human-readable comparison on mismatch

**examples/ (Test Fixtures):**
- **acme/**: Used by CI test-pglite job (check --strict --project examples/acme)
- **enterprise/**: Used by conformance job (higher complexity, exercises more features)
- Format: SFDX projects (valid sfdx-project.json + force-app/ directory)
- Committed; updated when adding new metadata support

**.planning/ (GSD Workflow Artifacts):**
- **codebase/**: Analysis documents (ARCHITECTURE.md, STRUCTURE.md, CONVENTIONS.md, TESTING.md, STACK.md, INTEGRATIONS.md, CONCERNS.md)
- **phases/**: One spec per completed phase (phase-N.md with requirements, acceptance criteria, test plan)
- **milestones/**: Milestone documentation (v1.0-complete, v1.1-audit, etc.)
- **todos/**: Feature backlog + known limitations
- **quick/**: Small task notes and decisions
- **research/**: Investigation outcomes (why X, comparison of approaches, etc.)

---

*Structure analysis: 2026-11-03 (v1.1 tag, main branch)*
