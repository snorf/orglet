# Codebase Concerns

**Analysis Date:** 2026-09-29

Orglet is explicitly phase 0 (see `README.md`): a headless REST/SOQL emulator with no UI API,
Flows or Apex yet. Most gaps below are deliberate, declared scope cuts (`UNSUPPORTED:<area>`
warnings rather than silent wrong answers), which is the project's stated design principle.
They are listed here because they will surface as real limitations to anything built on top
of orglet, and some (custom object key-prefix reassignment, in-memory Bulk/session state) are
correctness risks rather than just missing features.

## Tech Debt

**SOQL `TYPEOF` / polymorphic lookups resolve to the first target only:**
- Issue: `Owner`, `What`, `Who` and other polymorphic lookups (`referenceTo` with more than
  one target) always join/resolve against `targets[0]` (e.g. `Owner` always joins `User`,
  never `Group`), both in SOQL compilation and in formula parent-path resolution.
- Files: `packages/soql/src/compile.ts:116` (join comment + join logic), `packages/soql/src/compile.ts:327` (`TYPEOF ... END` throws `unsupported("soql-typeof", ...)` unconditionally — it is parsed but never compiles), `packages/formula/src/compile.ts:97` (same "first target" comment for formula parent traversal), `packages/metadata/src/types.ts:197-200` and `packages/metadata/src/schema.ts:53-60` (`resolveRelationship` returns `target` = `targets[0]`, `targets` = all defined, `polymorphic: defined.length > 1`).
- Impact: a `Task.WhoId` pointing at a `Lead` (not a `Contact`) is joined against the wrong
  table and its fields resolve to `null`/mismatched data instead of an error; `SELECT
  TYPEOF Owner WHEN User THEN ... END` queries fail outright rather than degrading.
- Fix approach: compile `TYPEOF` into a `CASE` over the row's actual key prefix (already
  available via `keyPrefixOf`, see `packages/schema/src/ids.ts:40`) with per-branch joins;
  extend `resolveRelationship` callers to pick the right `targets[]` entry by that prefix
  instead of always taking index 0.

**Roll-up summary fields are parsed then discarded:**
- Issue: `Summary` (roll-up), `ExternalLookup`, `IndirectLookup` and `MetadataRelationship`
  field types are recognized by the SFDX field-type allow-list but immediately skipped with
  an `UNSUPPORTED:field-type` warning; no column, no computation, no dependency tracking.
- Files: `packages/metadata/src/sfdx.ts:78` (type included in `CUSTOM_FIELD_TYPES`), `packages/metadata/src/sfdx.ts:161-165` (skip + warning), test at `packages/metadata/src/sfdx.test.ts:49-56`.
- Impact: any object with a roll-up summary field (e.g. `Opportunity.Total_Line_Items__c`
  style fields) silently loses that field; clients querying it get `INVALID_FIELD` since it
  never entered the schema at all — no data or DML errors, but the field simply does not
  exist in the emulator.
- Fix approach: needs a real design (roll-ups depend on trigger-time recomputation of parent
  aggregates on child DML) rather than a formula — likely belongs in the engine's order of
  execution (`packages/engine/src/engine.ts`) as a post-commit step over
  `childRelationships`, not in `metadata`.

**Standard-object baseline references 14 objects it does not define:**
- Issue: the 21 standard objects in `packages/metadata/standard/objects/*.json` have lookup
  fields (`referenceTo`) pointing at 14 objects that have no JSON file of their own:
  `BusinessHours`, `BusinessProcess`, `CallCenter`, `DandBCompany`, `Entitlement`,
  `ExternalDataSource`, `IdeaTheme`, `Individual`, `OperatingHours`, `OpportunityHistory`,
  `ServiceAppointment`, `ServiceContract`, `SocialPost`, `UserLicense`.
- Files: `packages/metadata/standard/objects/` (21 present objects), reported per-target by
  `packages/metadata/src/build.ts:461-466` as `UNSUPPORTED:reference-target <name> is
  referenced but not defined; lookups to it are unchecked`, test coverage at
  `packages/metadata/src/build.test.ts:158` (asserts the `BusinessProcess` warning exists).
- Impact: lookups to these 14 objects (e.g. `Lead.CompanyDunsNumber`-adjacent
  `DandBCompanyId`, `Case.EntitlementId`, `Opportunity` → `OpportunityHistory`) are accepted
  unchecked by `checkReferences` (`packages/engine/src/engine.ts:487-509`) — any string value
  is stored, there is no FK, no cross-reference validation, and SOQL joins through them are
  not possible since the target object does not exist in the schema.
- Fix approach: either add the missing 14 objects to the baseline (highest fidelity) or, for
  ones unlikely to matter for phase 0/1 (e.g. `CallCenter`, `IdeaTheme`), formally drop the
  dangling `referenceTo` from the source objects so the warning disappears and the field
  becomes a plain non-relationship value.

**No renaming/identity tracking for custom objects or fields on reload:**
- Issue: `migrate.ts` diffs purely by current table/column name against
  `information_schema`; renaming a custom object or field in the SFDX project is
  indistinguishable from deleting the old one and adding a new one.
- Files: `packages/schema/src/migrate.ts:118-143`.
- Impact: a rename produces two `UNSUPPORTED:schema-drop` warnings (old table/column kept
  unless `--force`) plus a new, empty table/column for the "new" name — data is not moved,
  and running with `--force` to clean up actually drops the renamed column's data.
- Fix approach: out of scope for a name-based differ; would need stable object/field IDs
  carried through the SFDX metadata (Salesforce does track these) to detect renames.

## Known Bugs

**`allOrNone` on `/composite` does not roll back earlier successful subrequests:**
- Symptoms: when a later subrequest in a composite batch fails and `allOrNone: true` was
  requested, subsequent subrequests are correctly skipped with
  `PROCESSING_HALTED`, but subrequests that already succeeded (and committed, since each
  subrequest is its own DML transaction via `app.inject`) are never undone.
- Files: `packages/api/src/routes/composite.ts:176-196` (warns once via
  `ctx.unsupported.add("composite-rollback")`, `req.log.warn("UNSUPPORTED:composite-rollback
  ...")`, then proceeds without a transaction wrapper).
- Trigger: `POST /services/data/v*/composite` with `allOrNone: true` where subrequest N
  succeeds and subrequest N+1 fails.
- Workaround: none; callers relying on atomic composite batches will see partial commits.
  (Collection calls like `POST /composite/sobjects` do honor `allOrNone` correctly, since
  the engine wraps the whole batch in one DB transaction — this gap is specific to the
  general `/composite` subrequest endpoint, which dispatches each subrequest as an
  independent HTTP call via `app.inject`.)

**SOSL `/search` always returns an empty result set:**
- Symptoms: `GET /services/data/v*/search?q=...` returns `{"searchRecords": []}` for every
  query, regardless of matches.
- Files: `packages/api/src/routes/misc.ts:66-73` (warns once:
  `UNSUPPORTED:sosl search is not implemented; returning no results for: ${q}`).
- Trigger: any SOSL search call from a connected SDK.
- Workaround: none; clients must use SOQL instead.

## Security Considerations

**Default auth mode accepts any password for any active user:**
- Risk: `AuthConfig.mode` defaults to `"permissive"` unless the CLI is started with
  `--users user:pass,...`; in that mode `passwordAccepted()` returns `true` unconditionally,
  so any request naming a valid, active username (including the bootstrap admin
  `admin@orglet.local`) authenticates with any password.
- Files: `packages/api/src/auth.ts:3-4` (doc comment), `packages/api/src/auth.ts:33-38`
  (`passwordAccepted`), default wiring at `packages/api/src/server.ts:83`
  (`options.auth ?? { mode: "permissive" }`), CLI default at `packages/cli/src/main.ts:144`.
- Current mitigation: documented behavior, intended for local development
  (`packages/cli/src/main.ts:93` prints `", any password"` next to the admin user on `up`).
- Recommendations: fine as a local dev default; if orglet is ever exposed beyond
  `localhost` (e.g. shared CI runner, containerized service reachable from other hosts), the
  `--users` list must be required, not just available. Worth a startup warning/refusal to
  bind on `0.0.0.0` while in permissive mode.

**No field-level security, sharing rules, or record-level access control:**
- Risk: `sharingModel` is parsed from SFDX metadata and stored on `SObjectDef` but never
  consulted by the DML or query engine — every authenticated session can read/write every
  record of every object regardless of profile/owner, and no field is ever blocked from
  read/write based on profile.
- Files: `packages/metadata/src/types.ts:158-159` (doc comment: "ignored by the engine in
  phase 0"), `packages/metadata/src/build.ts:391` and `:436` (`sharingModel` copied through,
  unused downstream). `Errors.notWritable` (`packages/engine/src/errors.ts:44-49`) mentions
  "security settings of this field" in its message text but is only raised for
  non-updatable system/calculated fields, not FLS.
- Current mitigation: none; declared out of scope for phase 0.
- Recommendations: acceptable for a single-tenant local dev/test emulator; document clearly
  for anyone building multi-profile integration tests against orglet that permission
  differences between Salesforce profiles cannot be reproduced yet.

**Session tokens never expire and live only in process memory:**
- Risk: `SessionStore.tokens` (`packages/api/src/auth.ts:25`) is a plain `Map<string,
  LoginResult>` with no TTL/eviction — once issued, a bearer token is valid until the
  process restarts. Restarting the server invalidates every session with no warning to
  connected clients beyond subsequent 401s.
- Files: `packages/api/src/auth.ts:24-80`.
- Current mitigation: none.
- Recommendations: low priority for a local emulator; would matter if orglet's API process
  is expected to run long-lived and shared across many test runs/users.

## Performance Bottlenecks

**Formula fields are recomputed from scratch, per row, on every read:**
- Problem: formula field values are never persisted; every `retrieve()` and every SOQL
  `SELECT` that includes a formula field re-runs the full AST-walking evaluator
  (`@orglet/sigha`, vendored, arbitrary-precision `decimal.js` for numeric ops) for that
  field, for every row, on every request.
- Files: `packages/engine/src/query.ts:69-83` (`computeFormulaFields` — re-fetches the full
  row via `loadByIds` *in addition to* the already-executed SOQL, purely to compute formula
  fields), `packages/engine/src/engine.ts:196-200` (`project()`: `for (const row of rows) {
  applyFormulaFields(...); applyCompoundFields(...); }`), `packages/engine/src/formulas.ts:87-90`
  (`applyFormulaFields`, one `evaluateCompiled` call per formula field per row),
  `packages/sigha/src/engine/evaluator.ts` (841-line tree-walking interpreter),
  `packages/sigha/src/engine/value.ts:17` (`Decimal.set({ precision: 40 })` — all numeric
  formula math allocates arbitrary-precision `Decimal` objects, not native `number`).
- Cause: no caching or invalidation strategy for computed formula values; correct behavior
  (formulas must reflect current parent data) traded directly for a second round trip
  (`loadByIds`) plus per-row interpretation cost on every SOQL query that touches a formula
  field.
- Improvement path: for read-heavy workloads, memoize per (object, field, record version) or
  compute formula values once at write time for fields with no volatile dependencies
  (`TODAY()`, `NOW()`); at minimum, fold the `computeFormulaFields` re-fetch into the
  original query's result set instead of a second `loadByIds` round trip.

**Child relationship subqueries compile to a correlated scalar subquery per outer row:**
- Problem: `SELECT ..., (SELECT Id FROM Contacts) FROM Account` compiles to `(SELECT
  json_agg(row_to_json(sub)) FROM (SELECT ... FROM contact ... WHERE contact.accountid =
  account.id ...) sub) AS c1` — a correlated subquery evaluated once per outer row by
  Postgres.
- Files: `packages/soql/src/compile.ts:335-359` (`compileChildSubquery`).
- Cause: simplest correct translation of SOQL child relationships; there is no batching via
  `LATERAL JOIN` + aggregation or a separate query keyed by parent ID set.
- Improvement path: for large parent result sets with child subqueries, Postgres's planner
  can usually turn this into a reasonably efficient nested loop with an index on the FK
  column, but it will not scale the way a single batched query (e.g. one `array_agg` query
  keyed by all parent IDs, joined back in application code) would for very wide pages.

## Fragile Areas

**Custom object key prefixes (`a00`, `a01`, ...) are recomputed from scratch on every schema build, keyed by alphabetical position:**
- Files: `packages/metadata/src/build.ts:1-8` (`customKeyPrefix`), `:20-24` (assignment loop:
  `customObjects.sort((a, b) => a.name.localeCompare(b.name))` then `.forEach((o, i) =>
  ...customKeyPrefix(i))`).
- Why fragile: the comment at `build.ts:5` claims this is "stable across reloads for the
  same project" — true only if the *set* of custom objects never changes. Adding a new
  custom object whose name sorts earlier than existing ones shifts every later object's
  index, and therefore its `a__` key prefix, on the very next reload/build. Existing record
  IDs already stored in Postgres keep their old prefix. `checkReferences`
  (`packages/engine/src/engine.ts:487-509`) matches a lookup's target object by
  `target.keyPrefix === keyPrefixOf(id)` — after a reload that reassigns prefixes, valid
  existing lookup values can start failing `INVALID_CROSS_REFERENCE_KEY` (if no object now
  claims that prefix) or, worse, silently resolve against the *wrong* custom object if
  another one now claims the old prefix.
- Safe modification: adding new custom objects whose names sort after all existing ones is
  safe; adding/removing/renaming anything earlier in the alphabet is not. There is no
  detection or warning when this happens.
- Test coverage: none found exercising add-then-reload prefix stability (`packages/metadata/src/build.test.ts`
  covers baseline+project merge but not multi-build prefix drift).

**Record ID generation is in-process, unsynchronized, global mutable state:**
- Files: `packages/schema/src/ids.ts:54-72` (`lastMillis`, `counter` module-level
  variables; `generateId` mutates them without a lock).
- Why fragile: safe under Node's single-threaded execution model (no interleaving within one
  process), but the whole scheme (`prefix + "00" + millis(7) + counter(3)`) assumes exactly
  one process generates IDs for a given org schema. Running two `orglet` server processes
  (e.g. blue/green during a deploy, or a worker process) against the same Postgres org
  schema without coordination can produce colliding IDs if their clocks/counters align,
  since there is no DB-side uniqueness check beyond the `id` primary key (which will reject
  the insert, surfacing as an opaque `DUPLICATE_VALUE`/`_pkey` constraint error rather than
  a clear "ID collision" message).
- Safe modification: fine for the documented single-process local-dev use case; flag before
  any multi-instance deployment.

**Schema reload treats any drop as a warning, not a hard stop, by default:**
- Files: `packages/schema/src/migrate.ts:1-6` (doc comment: destructive changes are
  "reported as an `UNSUPPORTED:schema-*` warning, so a reload never loses data by
  accident"), `:130-143` (`--force` required to actually drop/narrow).
- Why fragile: this protects against accidental data loss, but it also means a schema that
  drifted from the metadata (e.g. a field type was narrowed in SFDX source, or a table
  should have been dropped) is silently left in its old, wider/broader state indefinitely
  unless someone notices the warning and re-runs with `--force`. There is no persisted
  record of pending warnings between runs beyond stdout/log output
  (`packages/schema/src/migrate.ts` returns `warnings: string[]` per call; callers are
  responsible for surfacing them — see `packages/cli/src/main.ts`).

## Scaling Limits

**Bulk API 2.0 jobs are in-memory, per-process, and processed synchronously:**
- Current capacity: bounded entirely by one Node process's heap and single request/response
  cycle; `PUT .../batches` (upload) and job creation both do the full CSV parse + DML (or
  SOQL execution for query jobs) synchronously inside the HTTP request handler.
- Files: `packages/api/src/routes/bulk.ts:1-6` (doc comment: "Everything is processed
  synchronously within the request that triggers it"), `packages/api/src/bulk/jobs.ts:1-4`
  (doc comment: in-memory store, "each call to `registerBulkRoutes()` gets its own store"),
  `:60-63` (`JobStore` = two `Map`s, `ingest` and `query`), `CHUNK_SIZE = 200` at
  `packages/api/src/routes/bulk.ts:17` (DML batching size within a job).
- Limit: (1) a process restart loses every open/completed job and its result CSVs — clients
  polling job state or downloading results after a restart get 404s with no indication the
  job ever existed; (2) very large ingest/query jobs block the event loop / hold the whole
  CSV and result set in memory for the duration of the request, with no streaming to disk;
  (3) jobs are not shared across multiple `orglet` processes (no distributed job store), so
  horizontal scaling of the API tier is not possible while Bulk API is in use.
- Scaling path: back the job store with Postgres (a `jobs` table) or Redis, move CSV
  ingestion/result generation to a background worker so `UploadComplete` returns
  immediately and jobs transition `InProgress -> JobComplete` asynchronously, and stream
  CSV I/O instead of buffering full `csvChunks`/`successRows`/`failedRows` arrays in memory
  (`packages/api/src/bulk/jobs.ts:29,35,37`).

**Query result pagination re-executes the full compiled query for `COUNT(*)` on every page boundary:**
- Current capacity: fine for typical result sets; each page beyond the batch size issues a
  `SELECT count(*) FROM (<full compiled query>) q` in addition to the page's own `LIMIT
  n+1 OFFSET`.
- Files: `packages/engine/src/query.ts:48-55`.
- Limit: for expensive queries (multiple joins, child subqueries) with large result sets,
  every paged response after the first re-runs the whole query plan a second time just to
  get `totalSize`.
- Scaling path: cache `totalSize` on the query locator (`packages/api/src/routes/query.ts`'s
  `Locator` already carries `q`/`all`/`created` — a `total` field could be added there) so
  subsequent pages skip the count query.

## Dependencies at Risk

**`@orglet/sigha` is a vendored, MIT-licensed fork of an external formula evaluator with no tracked upstream:**
- Risk: `packages/sigha/VENDOR.md` and `packages/sigha/package.json` describe it as
  "Vendored engine layers of sigha, the Salesforce formula evaluator" — a large (`packages/sigha/src/registry/functions.ts` 1125 lines, `packages/sigha/src/engine/builtins.ts` 1075 lines, `packages/sigha/src/engine/evaluator.ts` 841 lines) internalized dependency. Bug fixes or
  formula-function additions upstream (if any upstream project exists) will not flow in
  automatically, and any bugs found in the vendored copy must be fixed locally with no
  clear process for contributing back.
- Impact: formula language correctness for orglet is entirely dependent on this one vendored
  package continuing to be maintained in-repo; whoever touches formula evaluation needs to
  understand both `@orglet/formula` (the thin Salesforce-schema-aware binding layer) and the
  larger vendored engine underneath it.
- Migration plan: none needed unless upstream sigha reappears with incompatible changes;
  worth confirming `packages/sigha/NOTICE` / `VENDOR.md` are kept current if the vendored
  code is ever patched locally.

## Missing Critical Features

**Bulk API v1 (`/services/async/*`) is not implemented:**
- Problem: only Bulk API 2.0 routes exist (`packages/api/src/routes/bulk.ts`, registered
  under `/services/data/v*/jobs/ingest` and `/jobs/query`); there is no
  `/services/async/<version>/job` surface, so SDKs that default to Bulk v1 for large loads
  (older `jsforce`/`simple-salesforce` code paths) will 404.
- Blocks: any test suite or client hard-coded to Bulk API v1.

**`WITH SECURITY_ENFORCED` / `WITH DATA CATEGORY` / `WITH USER_MODE` SOQL clauses are rejected outright:**
- Problem: `compileSoql` throws `UNSUPPORTED:soql-with` for any `WITH` clause rather than
  ignoring or degrading it.
- Files: `packages/soql/src/compile.ts:176`.
- Blocks: queries written defensively with `WITH SECURITY_ENFORCED` (a common Salesforce
  best practice) fail entirely against orglet instead of just not enforcing FLS.

**UI API surface (describeLayouts, list views, tabs, theme, recently-viewed) is entirely absent:**
- Problem: no routes exist for `/sobjects/<Type>/describe/layouts`, `/describe/compactLayouts`,
  `/describe/approvalLayouts`, `/sobjects/<Type>/listviews` (and its `/describe`, `/results`,
  `/explain` sub-paths), `/tabs`, `/theme`, or `/recent` — confirmed by
  `ls packages/api/src/routes/` containing only `bulk.ts`, `composite.ts`, `login.ts`,
  `misc.ts`, `query.ts`, `sobjects.ts`.
- Blocks: any client or admin UI relying on Salesforce's UI API metadata (explicitly a later
  milestone per `README.md`: "Later phases: UI API + LWC/SLDS front end").

## Test Coverage Gaps

**All tests require a live Docker Postgres instance; there is no in-memory/embedded fallback:**
- What's not tested without Docker: everything — `packages/schema`, `packages/metadata`,
  `packages/engine`, `packages/soql`, `packages/api` and `packages/cli` tests all exercise
  real DDL/DML against Postgres (`docker-compose.yml` defines `orglet-postgres` on port
  5433; `vitest.config.ts` sets `testTimeout: 30_000` / `hookTimeout: 60_000` specifically
  because "Schema migrations against Postgres in Docker take a few seconds per test file").
  No `pglite`, `sqlite`-compat layer, or mock `Pool`/`PoolClient` exists anywhere in the
  tree (`grep -rn "pglite"` across the repo returns nothing).
- Files: `vitest.config.ts:14-21`, `docker-compose.yml`.
- Risk: `pnpm test` fails outright (connection refused) on any machine without Docker
  running `pnpm db:up` first; there is no fast unit-test-only subset for pure logic
  (formula parsing, SOQL AST compilation) that skips the DB, which also means CI (once
  added) must provision Postgres before running anything.
- Priority: High for enabling CI (see below); a `pglite`-backed or fully mocked `Store`
  layer would let compiler/formula-only packages (`soql`, `formula`, `metadata`) run without
  Docker.

**No CI pipeline of any kind:**
- What's not tested: nothing runs automatically on push/PR. `.github` has no workflow files
  (`find .github -type f` returns nothing), and no `.gitlab-ci.yml`/`.circleci`/other CI
  config exists anywhere in the repo root.
- Risk: `pnpm build`, `pnpm typecheck`, `pnpm lint` and `pnpm test` are only ever run
  locally/manually; a regression can be committed and pushed without any automated check,
  and there is no branch protection signal to rely on.
- Priority: High — straightforward to add now that `pnpm test` works given a Postgres
  service container (`docker-compose.yml` already defines the exact image or a GitHub
  Actions `services:` Postgres 16 container could substitute for it).

**SOSL and Bulk API v1 have no automated tests by construction (nothing to test):**
- What's not tested: `/search` always returning `[]}` and the absence of `/services/async/*`
  are both unverified by any test beyond "the route returns the stub shape"
  (`packages/api/src/api.test.ts` likely covers the stub response, not real search
  semantics — the moment SOSL is implemented, none of the matching logic will have prior
  regression coverage to build on).
- Files: `packages/api/src/routes/misc.ts:66-73`.
- Risk: low today (feature does not exist), but worth flagging so SOSL implementation work
  budgets test-writing from scratch rather than assuming partial coverage exists.

---

*Concerns audit: 2026-09-29*
