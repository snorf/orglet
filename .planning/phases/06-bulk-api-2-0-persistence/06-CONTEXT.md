# Phase 6: Bulk API 2.0 Persistence - Context

**Gathered:** 2026-10-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Bulk API 2.0 ingest and query jobs, their uploaded CSV data and their results move from the
in-memory `JobStore` (`packages/api/src/bulk/jobs.ts`) to Postgres tables in the `_orglet`
schema, so they are retrievable through the same `/services/data/vXX.X/jobs/*` endpoints after
a server restart. The documented ingest state machine is preserved (Open → UploadComplete →
InProgress → JobComplete | Failed | Aborted; query jobs start in UploadComplete), only
`UploadComplete` and `Aborted` are client-settable, jobs left `InProgress` at boot are
reconciled to `Failed`, result endpoints return the documented `sf__Id` / `sf__Created` /
`sf__Error` CSV from persisted rows, jobs older than 7 days are purged, and Bulk query jobs
reject the SOQL constructs Bulk API 2.0 does not support with a rule set kept apart from REST
SOQL.

Processing stays synchronous and in-process. No worker, no queue, no Bulk API v1, no streaming
of large payloads (requirements BULK-01..05; research SUMMARY.md Phase 6).

</domain>

<decisions>
## Implementation Decisions

### Storage, reset and scoping (BULK-01)
- **D-01:** The job tables live in the `_orglet` schema, created through the existing
  `ensureInternalSchema` helper from `@orglet/schema` (phase 2 D-06, which reserved it for this
  phase). The DDL and all CRUD stay inside `packages/api/src/bulk` (research ARCHITECTURE
  Feature 4); nothing outside `packages/api` learns that a job exists. Rows are keyed per
  `org_schema` exactly like `_orglet.key_prefixes` (phase 2 D-02), so several orgs in one
  database never see each other's jobs.
- **D-02:** `orglet reset` always deletes that org's rows in the bulk tables, with no flag.
  Jobs are data that reference the records `DROP SCHEMA <org> CASCADE` just removed (`sf__Id`
  columns), unlike key prefixes which are identity and survive reset (phase 2 D-07). The
  `_orglet` schema, the bulk tables and other orgs' rows are untouched. `reset` must not fail
  when the bulk tables do not exist yet (same `to_regclass` guard style as `dropKeyPrefixes`).
- **D-03:** Visibility is per org and per creating user, as today. Each row stores the creating
  user's Id; `findJob` keeps returning 404 for another user's job, and the list endpoints show
  only the caller's jobs. `bulk.test.ts`'s existing expectations stay valid.
- **D-04:** Table creation, the `InProgress` reconciliation (D-07) and the retention purge
  (D-10) run once in `orglet up()` after `migrate` and before `app.listen`, never inside the
  synchronous `registerBulkRoutes`. The API server keeps constructing its own store from
  `ctx.engine.pool`; `ApiOptions`/`ApiContext` need no new fields unless the planner finds a
  cleaner seam for tests.

### State machine and crash semantics (BULK-02, BULK-03)
- **D-05:** `PATCH .../jobs/ingest/{id}` with `UploadComplete` stays synchronous from the
  client's point of view: the handler persists `UploadComplete`, then `InProgress`, runs the
  existing `processIngestJob` logic, persists the terminal state and only then responds, with
  the terminal state in the body (today's client-visible behaviour). No processing after the
  response, no polling needed in tests. A process crash during processing therefore leaves a
  row at `InProgress`, which is exactly what D-07 reconciles.
- **D-06:** Results are persisted per chunk, not once at the end. After every `CHUNK_SIZE`
  (200) batch the success rows, failed rows and both counters are written. Consequences:
  `successfulResults`/`failedResults` of a crash-interrupted job show precisely the records
  that were committed; `unprocessedrecords` returns the input rows (in input order, original
  columns) not covered by success + failed. For `JobComplete` it is empty, for `Aborted` it is
  every input row.
- **D-07:** Boot reconciliation: every row at `InProgress` for the org becomes `Failed` with an
  `errorMessage` Claude formulates in Salesforce style, stating that the server restarted while
  the job was in progress and pointing the client at `successfulResults`, `failedResults` and
  `unprocessedrecords`. Counters are left as persisted by D-06. The exact wording is locked in
  the plan, logged at boot like key-prefix assignments.
- **D-08:** One guarded transition function is the only writer of `state` (research Pitfall
  15). The client may request only `UploadComplete` and `Aborted`; anything else is rejected
  with `INVALIDJOBSTATE` as today. Server-side transitions (`InProgress`, terminal states,
  reconciliation) go through the same function with the allowed-transition table in one place.

### Retention (BULK-04)
- **D-09:** The 7-day clock basis is settled by the researcher from the Bulk API 2.0 and Bulk
  API Developer Guide (research FEATURES.md could confirm the figure verbatim only for Bulk v1).
  If the guide is not unambiguous about creation time versus completion time, use
  `createdDate`, which already exists on the row. The choice and its source are recorded in
  the plan.
- **D-10:** The purge runs at boot (D-04) and on every `/jobs/*` request through one shared
  pre-handler, as a single `DELETE ... WHERE <basis> < now() - interval '7 days'` scoped to the
  org. No timers, no background task. This guarantees a 404 after the window without depending
  on a restart.
- **D-11:** The window is hard-coded to 7 days. No environment variable or config override:
  a client must not be able to tell orglet from Salesforce here. Tests exercise the purge by
  backdating rows in SQL or through an injected clock, never through configuration.
- **D-12:** Non-terminal jobs (an `Open` job whose client never uploaded) age out under the
  same rule; no exception for open jobs.

### Query jobs and the Bulk SOQL rule set (BULK-05)
- **D-13:** Query jobs follow the same persisted lifecycle as ingest: the row is written at
  `UploadComplete`, then `InProgress`, the SOQL runs synchronously, the terminal state is
  persisted and `POST .../jobs/query` responds with the terminal state. Boot reconciliation
  (D-07) covers query jobs too. Today's "born `JobComplete`" shortcut goes away, satisfying
  the roadmap's "query jobs start in UploadComplete".
- **D-14:** Rejection form for unsupported SOQL is settled by the researcher: whether Salesforce
  answers `400` at job creation or creates the job and fails it, and the documented
  `errorCode`/message. If the guide is not explicit, keep today's shape: `400` at `POST`, no
  job created. The current `FEATURE_NOT_ENABLED` / `UNSUPPORTED:bulk-subquery` response is the
  fallback wording family until research supplies the documented one.
- **D-15:** The rule set is an AST-based check inside `packages/api/src/bulk`, built on the
  parse output of `@jetstreamapp/soql-parser-js` (the same parser REST uses, not the REST
  compiler). It rejects `TYPEOF`, `GROUP BY` (including `ROLLUP`/`CUBE`), `OFFSET`, aggregate
  functions, compound fields and child (parent-to-child) subqueries. The REST compiler in
  `@orglet/soql` is not changed and gets no "bulk profile"; the existing `/\(\s*select\b/i`
  regex is replaced. Which fields count as compound (Address- and Geolocation-typed fields,
  and whatever else the guide lists) is for the researcher to confirm.

### Post-research decisions (2026-10-10, after 06-RESEARCH.md)
- **D-16:** Boot reconciliation (D-07) covers rows left at `UploadComplete` as well as
  `InProgress`, for both ingest and query jobs. Under D-05/D-13 `UploadComplete` is only a
  transient step inside one request, so a persisted `UploadComplete` row at boot is always a
  crash trace. Both become `Failed` with the same restart message.
- **D-17:** Rejection of unsupported Bulk query SOQL (D-14): the guide documents the construct
  list but no HTTP status, `errorCode` or wording, so the fallback is locked: `400` at
  `POST .../jobs/query`, no job row created, `errorCode` `FEATURE_NOT_ENABLED`, message names
  the construct (for example `Bulk API 2.0 query jobs do not support GROUP BY`). **No
  `UNSUPPORTED:` prefix**: Salesforce rejects these too, so they are not an orglet gap; the
  existing `UNSUPPORTED:bulk-subquery` text is retired. The wording is orglet's own and the plan
  records it as undocumented.
- **D-18:** Compound fields (D-15) follow the guide literally: a selected field whose
  `FieldDef.type` is `Address` or `Location`, including through a parent relationship path,
  and `FIELDS(...)` are rejected. Compound `Name` is **not** rejected. Retention basis (D-09)
  is confirmed as `createdDate` for every state (Limits Quick Reference: "older than seven
  days", terminal and non-terminal alike).
- **D-19:** The atomicity window between a chunk's engine commit and its result write is
  **fixed in this phase, not documented away**. Each chunk's DML and its `_orglet` result rows
  (and counter update) commit in one Postgres transaction. The engine gains a way to run a DML
  call on a caller-supplied client: research found no existing seam (`DmlEngine.run()` does
  its own `pool.connect()`/`BEGIN`/`COMMIT`, `DmlOptions` has only `allOrNone`). Required
  properties of the seam, exact shape is the planner's: no second `BEGIN` on the caller's
  client; the engine's `allOrNone` rollback and error path must unwind only its own work
  (savepoint) and never the caller's transaction; `ChangeBus` events for that call are
  published only after the caller's `COMMIT`, never before; import mode's `SET LOCAL
  session_replication_role` semantics are unchanged for the existing path; the same client is
  used sequentially for engine work and the result write (never hold one pool client while the
  engine takes another, pglite-socket serialises queries). This is the one deliberate step
  outside `packages/api` in this phase; existing engine tests must stay green and the new
  option must be covered by an engine-level test.
- **D-20:** Heimdall compatibility constraints (see Specific Ideas) are hard requirements on
  the query-job surface: every `GET .../jobs/query/{id}/results` response carries
  `Sforce-Locator` (the literal string `null` on the last page) and an accurate
  `Sforce-NumberOfRecords`; `maxRecords` paging stays offset-based; `Accept: application/json`
  on the results endpoint is tolerated and still yields CSV; `lineEnding: LF` and `queryAll`
  keep working. These hold today and must survive the move to Postgres-backed rows.

### Claude's Discretion
- One table per job kind (`bulk_ingest_jobs`, `bulk_query_jobs`) as research sketches, or a
  shared table with a discriminator; column types; whether uploaded CSV is one accumulating
  `text` column (research recommendation) and query results are `jsonb` header/rows so the
  existing offset-based `Sforce-Locator` paging moves unchanged. Document the Postgres TOAST
  ceiling instead of streaming (research Pitfall 17).
- Allowed `Aborted` transitions (from `Open`; from `UploadComplete`/`InProgress` is unreachable
  under D-05 and may stay accepted for fidelity) and whether `DELETE` on a query job keeps
  today's no-state-check behaviour.
- Boot log lines for reconciled and purged counts, matching the `up()` logging style.
- Restart tests: simulate a restart by closing one `createApiServer` instance and opening a
  second one over the same pool and org schema, with an `InProgress` row written directly in
  SQL to drive D-07.
- Where the documentation notes go (README or `packages/api/src/bulk` header comments) for the
  TOAST ceiling and for the research security note that persisted job data now outlives a
  restart under the permissive default auth.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone research (Bulk-specific sections)
- `.planning/research/ARCHITECTURE.md` §"Cross-Cutting Finding" and §"Feature 4: Bulk API 2.0
  Job Persistence" — `_orglet` placement, `packages/api/src/bulk/store.ts` design, synchronous
  processing, table creation in `up()`, component boundaries.
- `.planning/research/PITFALLS.md` Pitfalls 15, 16, 17 and the "Security Mistakes" table —
  single transition guard, `InProgress`-forever after crash, large CSV in one column, persisted
  job data under permissive auth.
- `.planning/research/FEATURES.md` §"Table Stakes" (Bulk rows), §"Anti-Features" (`TYPEOF` in
  Bulk query SOQL, Bulk v1, distributed store), §"Fidelity Target" retention note, §"Sources"
  (official Bulk API 2.0 and Bulk API Developer Guide PDF link).
- `.planning/research/SUMMARY.md` §"Phase 6: Bulk API 2.0 job persistence" and the retention
  gap note under "Other, lower-priority gaps".

### Prior phase decisions that bind this phase
- `.planning/phases/02-custom-object-key-prefix-persistence/02-CONTEXT.md` D-01, D-02, D-06,
  D-07 — `_orglet` sibling schema, per-org keying, `ensureInternalSchema`, reset semantics
  that D-02 above deliberately diverges from.
- `.planning/phases/04-polymorphic-lookups-soql-typeof/04-CONTEXT.md` D-06 — how invalid SOQL
  forms are rejected (`MALFORMED_QUERY`, message names the restriction); the Bulk rule set
  should read the same way where the guide gives no other wording.

### Phase research
- `.planning/phases/06-bulk-api-2-0-persistence/06-RESEARCH.md` — stack, SQL patterns, AST
  node names for the rule check, four-table storage design, pitfalls, Validation
  Architecture; its "Open Questions" are resolved by D-16..D-19 above.

### Requirements
- `.planning/REQUIREMENTS.md` BULK-01..BULK-05.
- `.planning/ROADMAP.md` §"Phase 6: Bulk API 2.0 Persistence" success criteria 1-4.

### Official documentation (for the researcher)
- Bulk API 2.0 and Bulk API Developer Guide (PDF export from `resources.docs.salesforce.com`,
  link in `.planning/research/FEATURES.md` §Sources) — state table, result CSV columns,
  unsupported query constructs and their error, retention basis. No behaviour may be derived
  from a real org (PROJECT.md legal constraint).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ensureInternalSchema(client)` in `packages/schema/src/internal.ts` (exported from
  `@orglet/schema`): advisory-locked `CREATE SCHEMA IF NOT EXISTS "_orglet"`; header comment
  already says "Bulk jobs later".
- `packages/schema/src/prefixes.ts`: the `CREATE TABLE IF NOT EXISTS` inside `withTransaction`
  pattern, per-org advisory lock, and `dropKeyPrefixes`'s `to_regclass` guard are the templates
  for the bulk store and for the reset hook.
- `packages/api/src/bulk/csv.ts`: `parseCsv`, `writeCsv`, `csvField`, `delimiterChar`,
  `lineEndingChars` are unchanged and reused for both persisted result rendering and
  `unprocessedrecords`.
- `packages/api/src/bulk/jobs.ts`: `IngestJob`/`QueryJob` stay the application-level shapes;
  only `JobStore` (two public Maps, no methods) is replaced. `newJobId()` (`750` prefix) stays.
- `test/db.ts` `openTestDb()` / `usingPglite`: per-file pglite or real Postgres behind one
  `pg` pool, already used by `packages/api/src/bulk.test.ts`.

### Established Patterns
- `packages/api` already queries `ctx.engine.pool` directly (`auth.ts`, `routes/sobjects.ts`);
  a Postgres-backed store in `packages/api/src/bulk` follows that, no new package.
- Errors: REST bodies are arrays of `{ message, errorCode, fields? }` via `apiError` /
  `sendErrors`; Bulk-specific state errors use `INVALIDJOBSTATE`; unsupported areas use the
  `UNSUPPORTED:<area>` message prefix (today `bulk-relationship-column`, `bulk-subquery`).
- `orglet up()` order (`packages/cli/src/main.ts`): loadOrgSchema → createPool + `SELECT 1` →
  `reconcileKeyPrefixes` → `migrate` → `bootstrapOrg` → `new DmlEngine` → `createApiServer` →
  `listen`. D-04's boot step slots between `bootstrapOrg` and `createApiServer`.
- `orglet reset` runs `DROP SCHEMA IF EXISTS <org> CASCADE` and leaves `_orglet` alone;
  `--drop-prefixes` is the only existing `_orglet` cleanup and stays as is.

### Integration Points
- `packages/api/src/routes/bulk.ts`: every handler becomes `await`-based against the store;
  `processIngestJob` (lines ~120-181) gains per-chunk persistence (D-06); the query handler
  (lines ~338-381) gains the persisted lifecycle (D-13) and the AST rule check (D-15); the
  `/\(\s*select\b/i` regex goes.
- `registerBulkRoutes` (`routes/bulk.ts:218`) constructs the store; `createApiServer` and
  `ApiContext` (`server.ts`) are expected to stay shape-compatible.
- `packages/cli/src/main.ts` `up()` and `reset()` each get one call into the bulk store.
- `packages/api/src/bulk.test.ts` (~260 lines: ingest, query, CSV parser) is the regression
  baseline; restart, reconciliation, purge, `unprocessedrecords` and the SOQL rule set need
  new tests.
- Conformance: `conformance/jsforce` runs only jsforce's Bulk **v1** suite (expected to fail)
  and excludes `bulk2.test.ts`; `conformance/python` has no Bulk coverage; both READMEs still
  say "Bulk API is not implemented". Nothing in conformance exercises Bulk 2.0 today.

</code_context>

<specifics>
## Specific Ideas

- Keep the client-visible synchronous contract: a `PATCH UploadComplete` or `POST jobs/query`
  answers with the terminal state, while every intermediate state is still written to
  Postgres so a crash is honest rather than invisible.
- `unprocessedrecords` must be truthful after a crash: "input minus what we actually
  committed", which is why results are persisted per chunk rather than once at the end.
- Retention is deliberately not configurable; fidelity beats dev convenience here.
- The Bulk SOQL rules live beside the Bulk code, not inside the REST compiler, so REST SOQL
  behaviour cannot drift when Bulk rules change.
- **Heimdall** (`../heimdall`, Johan's open-source Salesforce backup tool, Java 21 / Spring
  Batch) is the intended first real Bulk API 2.0 client for orglet. What it does on the wire,
  from a read-only scout: OAuth `client_credentials` (or JWT bearer) against
  `/services/oauth2/token` on the same base URL; `POST /jobs/query` with
  `{operation: query|queryAll, contentType: CSV, lineEnding: LF, query}`; polls
  `GET /jobs/query/{id}` until `JobComplete|Failed|Aborted`; downloads
  `GET /jobs/query/{id}/results?maxRecords=N[&locator=X]` with `Accept: application/json`,
  requires the `Sforce-Locator` header on every page (crashes if absent), stops on the literal
  `null`, and retries a page when its row count differs from `Sforce-NumberOfRecords`; builds
  `SELECT <all describe fields except address/base64>, ..., Id FROM X WHERE
  ((SystemModstamp = ts AND Id > 'id') OR SystemModstamp > ts) ORDER BY SystemModstamp ASC, Id
  ASC LIMIT n` with `Id` as the last column; uses a WHERE semi-join (`IN (SELECT Id ...)`) for
  ContentDocumentLink; never uses TYPEOF, GROUP BY, OFFSET, aggregates, FIELDS() or child
  subqueries; no list/abort/delete calls. Also needs REST `describe`, `sobjects/`, `limits`,
  `query/` and its own `Heimdall_Backup_Config__c` object. Phase 6 must not break any of the
  query-job behaviours above (D-20); running Heimdall against orglet end to end is deferred.

</specifics>

<deferred>
## Deferred Ideas

- True asynchronous Bulk processing (respond `UploadComplete`, process on a worker), PK
  chunking, parallel results, platform-event subscriptions: explicitly out of milestone scope
  (research FEATURES.md "Defer").
- Bulk API v1 (`/services/async/*`): out of scope; `conformance/jsforce`'s v1 suite keeps
  failing by design.
- Updating `conformance/jsforce/README.md` and `conformance/python` Bulk notes, and deciding
  whether jsforce's `bulk2.test.ts` can be un-excluded: Phase 7 (conformance re-run), per
  research Pitfall 21 classify each previously excluded test before broadening the filter.
- Streaming large CSV payloads instead of buffering one column value: documented limit only
  (research Pitfall 17).
- Running Heimdall (`../heimdall`) as an end-to-end backup of an orglet org: a later
  conformance target (Phase 7 or a following milestone). Prerequisites outside this phase:
  `client_credentials` grant on `/services/oauth2/token`, `/limits`, the
  `Heimdall_Backup_Config__c` custom object and its tooling-API schema check, `ContentVersion`
  `VersionData` download.

### Reviewed Todos (not folded)
- "Narrow baseline OwnerId referenceTo per object" (metadata) — matched only on the keyword
  "api"; belongs to baseline metadata, not Bulk.
- "Reword ROADMAP phase 7 to validate against the DE retrieve, not the org" (planning) —
  belongs to Phase 7.
- "Support Relationship:Object.Field colon syntax for polymorphic formula references"
  (formula) — phase 4 D-16 follow-up against sigha, unrelated to Bulk.

</deferred>

---

*Phase: 06-bulk-api-2-0-persistence*
*Context gathered: 2026-10-10*
