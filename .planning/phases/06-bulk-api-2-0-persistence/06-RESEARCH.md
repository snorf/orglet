# Phase 6: Bulk API 2.0 Persistence - Research

**Researched:** 2026-10-10
**Domain:** Postgres-backed job store inside `packages/api/src/bulk`, Bulk API 2.0 state machine, AST-based Bulk SOQL restriction check
**Confidence:** HIGH for stack and codebase facts, HIGH for documented states, result columns and query restrictions, MEDIUM for the retention basis, LOW (documentation silent) for the rejection form and error wording

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Storage, reset and scoping (BULK-01)**
- **D-01:** The job tables live in the `_orglet` schema, created through the existing `ensureInternalSchema` helper from `@orglet/schema` (phase 2 D-06, which reserved it for this phase). The DDL and all CRUD stay inside `packages/api/src/bulk` (research ARCHITECTURE Feature 4); nothing outside `packages/api` learns that a job exists. Rows are keyed per `org_schema` exactly like `_orglet.key_prefixes` (phase 2 D-02), so several orgs in one database never see each other's jobs.
- **D-02:** `orglet reset` always deletes that org's rows in the bulk tables, with no flag. Jobs are data that reference the records `DROP SCHEMA <org> CASCADE` just removed (`sf__Id` columns), unlike key prefixes which are identity and survive reset (phase 2 D-07). The `_orglet` schema, the bulk tables and other orgs' rows are untouched. `reset` must not fail when the bulk tables do not exist yet (same `to_regclass` guard style as `dropKeyPrefixes`).
- **D-03:** Visibility is per org and per creating user, as today. Each row stores the creating user's Id; `findJob` keeps returning 404 for another user's job, and the list endpoints show only the caller's jobs. `bulk.test.ts`'s existing expectations stay valid.
- **D-04:** Table creation, the `InProgress` reconciliation (D-07) and the retention purge (D-10) run once in `orglet up()` after `migrate` and before `app.listen`, never inside the synchronous `registerBulkRoutes`. The API server keeps constructing its own store from `ctx.engine.pool`; `ApiOptions`/`ApiContext` need no new fields unless the planner finds a cleaner seam for tests.

**State machine and crash semantics (BULK-02, BULK-03)**
- **D-05:** `PATCH .../jobs/ingest/{id}` with `UploadComplete` stays synchronous from the client's point of view: the handler persists `UploadComplete`, then `InProgress`, runs the existing `processIngestJob` logic, persists the terminal state and only then responds, with the terminal state in the body (today's client-visible behaviour). No processing after the response, no polling needed in tests. A process crash during processing therefore leaves a row at `InProgress`, which is exactly what D-07 reconciles.
- **D-06:** Results are persisted per chunk, not once at the end. After every `CHUNK_SIZE` (200) batch the success rows, failed rows and both counters are written. Consequences: `successfulResults`/`failedResults` of a crash-interrupted job show precisely the records that were committed; `unprocessedrecords` returns the input rows (in input order, original columns) not covered by success + failed. For `JobComplete` it is empty, for `Aborted` it is every input row.
- **D-07:** Boot reconciliation: every row at `InProgress` for the org becomes `Failed` with an `errorMessage` Claude formulates in Salesforce style, stating that the server restarted while the job was in progress and pointing the client at `successfulResults`, `failedResults` and `unprocessedrecords`. Counters are left as persisted by D-06. The exact wording is locked in the plan, logged at boot like key-prefix assignments.
- **D-08:** One guarded transition function is the only writer of `state` (research Pitfall 15). The client may request only `UploadComplete` and `Aborted`; anything else is rejected with `INVALIDJOBSTATE` as today. Server-side transitions (`InProgress`, terminal states, reconciliation) go through the same function with the allowed-transition table in one place.

**Retention (BULK-04)**
- **D-09:** The 7-day clock basis is settled by the researcher from the Bulk API 2.0 and Bulk API Developer Guide (research FEATURES.md could confirm the figure verbatim only for Bulk v1). If the guide is not unambiguous about creation time versus completion time, use `createdDate`, which already exists on the row. The choice and its source are recorded in the plan.
- **D-10:** The purge runs at boot (D-04) and on every `/jobs/*` request through one shared pre-handler, as a single `DELETE ... WHERE <basis> < now() - interval '7 days'` scoped to the org. No timers, no background task. This guarantees a 404 after the window without depending on a restart.
- **D-11:** The window is hard-coded to 7 days. No environment variable or config override: a client must not be able to tell orglet from Salesforce here. Tests exercise the purge by backdating rows in SQL or through an injected clock, never through configuration.
- **D-12:** Non-terminal jobs (an `Open` job whose client never uploaded) age out under the same rule; no exception for open jobs.

**Query jobs and the Bulk SOQL rule set (BULK-05)**
- **D-13:** Query jobs follow the same persisted lifecycle as ingest: the row is written at `UploadComplete`, then `InProgress`, the SOQL runs synchronously, the terminal state is persisted and `POST .../jobs/query` responds with the terminal state. Boot reconciliation (D-07) covers query jobs too. Today's "born `JobComplete`" shortcut goes away, satisfying the roadmap's "query jobs start in UploadComplete".
- **D-14:** Rejection form for unsupported SOQL is settled by the researcher: whether Salesforce answers `400` at job creation or creates the job and fails it, and the documented `errorCode`/message. If the guide is not explicit, keep today's shape: `400` at `POST`, no job created. The current `FEATURE_NOT_ENABLED` / `UNSUPPORTED:bulk-subquery` response is the fallback wording family until research supplies the documented one.
- **D-15:** The rule set is an AST-based check inside `packages/api/src/bulk`, built on the parse output of `@jetstreamapp/soql-parser-js` (the same parser REST uses, not the REST compiler). It rejects `TYPEOF`, `GROUP BY` (including `ROLLUP`/`CUBE`), `OFFSET`, aggregate functions, compound fields and child (parent-to-child) subqueries. The REST compiler in `@orglet/soql` is not changed and gets no "bulk profile"; the existing `/\(\s*select\b/i` regex is replaced. Which fields count as compound (Address- and Geolocation-typed fields, and whatever else the guide lists) is for the researcher to confirm.

### Claude's Discretion
- One table per job kind (`bulk_ingest_jobs`, `bulk_query_jobs`) as research sketches, or a shared table with a discriminator; column types; whether uploaded CSV is one accumulating `text` column (research recommendation) and query results are `jsonb` header/rows so the existing offset-based `Sforce-Locator` paging moves unchanged. Document the Postgres TOAST ceiling instead of streaming (research Pitfall 17).
- Allowed `Aborted` transitions (from `Open`; from `UploadComplete`/`InProgress` is unreachable under D-05 and may stay accepted for fidelity) and whether `DELETE` on a query job keeps today's no-state-check behaviour.
- Boot log lines for reconciled and purged counts, matching the `up()` logging style.
- Restart tests: simulate a restart by closing one `createApiServer` instance and opening a second one over the same pool and org schema, with an `InProgress` row written directly in SQL to drive D-07.
- Where the documentation notes go (README or `packages/api/src/bulk` header comments) for the TOAST ceiling and for the research security note that persisted job data now outlives a restart under the permissive default auth.

### Deferred Ideas (OUT OF SCOPE)
- True asynchronous Bulk processing (respond `UploadComplete`, process on a worker), PK chunking, parallel results, platform-event subscriptions: out of milestone scope.
- Bulk API v1 (`/services/async/*`): out of scope; `conformance/jsforce`'s v1 suite keeps failing by design.
- Updating `conformance/jsforce/README.md` and `conformance/python` Bulk notes, and un-excluding jsforce's `bulk2.test.ts`: Phase 7.
- Streaming large CSV payloads instead of buffering one column value: documented limit only (research Pitfall 17).

## Project Constraints (from CLAUDE.md)

- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`); relative imports carry `.js`; `import { x, type Y }` mixed style; every source file opens with a `/** ... */` why-block; no `export *`; one barrel `src/index.ts` per package.
- Errors: REST bodies are arrays built with `apiError(...)` / `sendErrors(...)`; never `reply.send([...])` by hand. Row-level errors via the `Errors` factory; do not invent Salesforce status codes.
- `UNSUPPORTED:<area>` marks only what orglet deliberately does not implement; the HTTP/status code stays a real Salesforce code.
- Build only from public documentation and OSS SDK source; never diff against a real org (all findings below come from the public PDFs).
- No new workspace packages; Node 22, pnpm 10+, Postgres 16, Fastify 5, vitest. Existing conformance suites stay green. Only Level 1 data in context.
- GSD workflow: all edits go through a GSD command; commits use repo-local identity Johan Karlsteen <johan@karlsteen.com>.
- Environment note: the shell of this research session had Node v18.20.8 and no `pnpm` on PATH; the project requires Node 22 (`.nvmrc`) and pnpm via Corepack. Execution must activate those first (`nvm use`, `corepack enable pnpm`) or tests will not run.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BULK-01 | Jobs, uploaded CSV and results stored in Postgres (`_orglet`), retrievable after restart | Schema design (4 tables), `ensureBulkSchema` in `up()`, restart-simulation test, per-org keying, reset hook |
| BULK-02 | Documented state machine; only `UploadComplete` and `Aborted` client-settable | Documented states (guide p.6, JobInfo tables), transition table, CAS-update guard, boot reconcile, gap on stuck `UploadComplete` |
| BULK-03 | `successfulResults`/`failedResults`/`unprocessedrecords` CSV from persisted results | Documented result columns, per-chunk `bulk_ingest_results` rows, unprocessed = input minus results |
| BULK-04 | Jobs older than 7 days purged | Guide and Limits Quick Reference text; basis `created_date`; purge SQL and pre-handler |
| BULK-05 | Bulk query rejects unsupported SOQL with documented error, separate rule set | Documented restriction list, parser AST names (verified from `.d.ts` and by execution), compound-field answer, error form not documented |
</phase_requirements>

## Summary

The three delegated questions, answered from the official "Bulk API 2.0 and Bulk API Developer Guide" PDF (Version 68.0, Winter '27, last updated October 9, 2026, `https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_asynch.pdf`) and the "Salesforce Developer Limits and Allocations Quick Reference" PDF (`https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/salesforce_app_limits_cheatsheet.pdf`):

1. **Retention basis (D-09).** The Bulk API 2.0 column of the Limits Quick Reference, "General Limits", row "Batch and job lifespan", says: "Jobs in a terminal state (completed, aborted, or failed) that are older than seven days are deleted. Jobs in a non-terminal state that are older than seven days are periodically cleaned up." "Older than" is job age, with no completion-time basis stated for Bulk 2.0. (The Bulk API v1 column measures from "the youngest batch associated with a job, or the age of the job if there are no batches", which is not applicable: Bulk 2.0 has no user-visible batches.) The v1 developer-guide sentence "job status and batch results sets for completed jobs are available for 7 days" is v1 text only. Result: not unambiguous in favour of completion time, so the fallback applies: **basis = `createdDate`**, no terminal-state exception, which also matches D-12. Confidence MEDIUM (clear on age, silent on "age since what").
2. **Rejection form (D-14).** **Not found.** The guide lists the unsupported constructs (twice, under "SOQL Considerations" and in the Note under "Create a Query Job") but documents neither an HTTP status nor an `errorCode`/message for violating them, and the generic Bulk 2.0 Errors list has no code for it. The fallback applies: **HTTP 400 at `POST /jobs/query`, no job created, `errorCode` `FEATURE_NOT_ENABLED`** (kept so the existing assertion at `bulk.test.ts:222` stays green), message naming the construct. A web search for a quotable official error message found nothing; do not invent one.
3. **Compound fields (D-15).** The guide (two places) names exactly: "compound address fields or compound geolocation fields", and in the Create-a-Query-Job note additionally "compound data, such as compound address fields, compound geolocation fields, and `FIELDS()`". It does **not** list compound Name. Rule: reject a selected field whose `FieldDef.type` is `Address` or `Location`, and reject `FIELDS(...)`; do **not** reject `Name`-typed fields (guide silent; flagged as an open question).

Two things the CONTEXT did not anticipate and the planner must schedule: (a) `@jetstreamapp/soql-parser-js` is **not** a dependency of `@orglet/api` and `@orglet/soql` does not re-export `parseQuery`, so the rule check needs either a dependency line in `packages/api/package.json` plus a lockfile update, or a re-export; (b) with D-04 (tables created in `up()` only), every test that builds an API server must call the exported ensure function in its own setup, or the first `/jobs` request fails with "relation does not exist".

**Primary recommendation:** Add one new module family under `packages/api/src/bulk` (`schema.ts` DDL + `ensureBulkSchema`/`prepareBulk`/`dropBulkJobs`, `store.ts` CRUD + the single CAS `transition`, `soql-rules.ts` AST check), switch the 14 route handlers to `await` the store, and normalise results into row tables (`bulk_ingest_results`, `bulk_query_rows`) instead of rendered CSV or giant jsonb so that per-chunk persistence, `unprocessedrecords` and offset paging are all simple indexed queries.

## Standard Stack

No new libraries. Everything needed is already in the workspace.

### Core
| Library | Version (verified in repo) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pg` via `@orglet/schema` (`createPool`, `withTransaction`, `ensureInternalSchema`, `INTERNAL_SCHEMA`, `quote`) | 8.23.0 | Postgres access | Only DB driver; `packages/api` already uses `ctx.engine.pool` directly (`auth.ts`, `routes/sobjects.ts`) |
| `@jetstreamapp/soql-parser-js` | 8.1.0 (`pnpm-lock`, resolved at `node_modules/.pnpm/@jetstreamapp+soql-parser-js@8.1.0`) | SOQL AST for the Bulk rule check | The same parser REST uses (D-15). **Add `"@jetstreamapp/soql-parser-js": "^8.1.0"` to `packages/api/package.json` `dependencies`** (same range `packages/soql` uses) and commit the updated `pnpm-lock.yaml`; pnpm's strict layout does not expose it to `api` today and CI uses a frozen lockfile |
| Fastify | 5.12.5 | Routes, hooks | Existing |
| vitest + `test/db.ts` `openTestDb()` | 3.2.7, pglite 0.5.8 / Postgres 16 | Tests | Existing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Dependency line in `packages/api/package.json` | Re-export `parseQuery` from `@orglet/soql` index | Touches the REST package barrel (not the compiler); D-15 says the REST compiler gets no Bulk profile, a bare re-export is allowed but couples packages. Prefer the dependency line: single parser version, `@orglet/soql` untouched |
| Rendered CSV blobs per result kind (ARCHITECTURE sketch: `success_csv`/`failed_csv`) | Row tables | CSV blobs cannot be appended per chunk (D-06) and cannot answer "input minus results" |
| `jsonb` array of query rows in the job row | `bulk_query_rows` table | A jsonb array must be read whole to slice a page; a row table pages with `WHERE row_index >= $off ORDER BY row_index LIMIT $n` |

**Installation:** `pnpm --filter @orglet/api add @jetstreamapp/soql-parser-js@^8.1.0` (or edit `package.json` and run `pnpm install`), then commit `pnpm-lock.yaml`. Version already pinned in the lockfile (8.1.0), so no network resolution change.

## Architecture Patterns

### Recommended Project Structure
```
packages/api/src/
├── bulk/
│   ├── csv.ts           # unchanged
│   ├── jobs.ts          # keep IngestJob/QueryJob/newJobId; delete JobStore; add TRANSITIONS table + JobState helpers
│   ├── schema.ts        # NEW: DDL, ensureBulkSchema, prepareBulk (ensure + reconcile + purge), dropBulkJobs
│   ├── store.ts         # NEW: BulkStore (CRUD, transition(), appendCsv, addResults, addQueryRows, purge)
│   └── soql-rules.ts    # NEW: checkBulkQuery(soql, schema): BulkQueryViolation | undefined (pure; no DB)
├── routes/bulk.ts       # handlers become await-based; processIngestJob persists per chunk
└── index.ts             # export ensureBulkSchema/prepareBulk/dropBulkJobs for @orglet/cli and tests
packages/cli/src/main.ts # up(): prepareBulk after bootstrapOrg; reset(): dropBulkJobs after DROP SCHEMA
```
No other package changes. `ApiOptions`/`ApiContext` stay shape-compatible; `registerBulkRoutes` builds `new BulkStore(ctx.engine.pool, ctx.engine.orgSchema)` (`DmlEngine.orgSchema` is a public readonly field, `engine.ts:76`).

### Pattern 1: Tables (Postgres 16 and pglite safe)
All keyed by `(org_schema, id)`; DDL created inside `withTransaction` after `ensureInternalSchema(client)` (the advisory lock it takes also serialises the `CREATE TABLE IF NOT EXISTS`, exactly as `prefixes.ts` does).

```sql
-- Source: modelled on packages/schema/src/prefixes.ts CREATE_TABLE
CREATE TABLE IF NOT EXISTS "_orglet".bulk_ingest_jobs (
  org_schema            text        NOT NULL,
  id                    text        NOT NULL,
  user_id               text        NOT NULL,   -- flattened Session (D-03)
  organization_id       text        NOT NULL,
  profile_id            text        NOT NULL,
  operation             text        NOT NULL,
  object                text        NOT NULL,
  external_id_field     text,
  line_ending           text        NOT NULL,
  column_delimiter      text        NOT NULL,
  api_version           text        NOT NULL,
  state                 text        NOT NULL,
  created_date          timestamptz NOT NULL DEFAULT now(),
  system_modstamp       timestamptz NOT NULL DEFAULT now(),
  csv_data              text        NOT NULL DEFAULT '',
  input_header          jsonb,                  -- parsed once at processing time
  input_row_count       integer,
  number_records_processed bigint   NOT NULL DEFAULT 0,
  number_records_failed    bigint   NOT NULL DEFAULT 0,
  total_processing_time    bigint   NOT NULL DEFAULT 0,
  error_message         text,
  PRIMARY KEY (org_schema, id)
);
CREATE INDEX IF NOT EXISTS bulk_ingest_jobs_age ON "_orglet".bulk_ingest_jobs (org_schema, created_date);

CREATE TABLE IF NOT EXISTS "_orglet".bulk_ingest_results (
  org_schema text NOT NULL, job_id text NOT NULL, row_index integer NOT NULL,
  success    boolean NOT NULL,
  record_id  text,                 -- sf__Id, '' for failures
  created    boolean,              -- sf__Created (success rows)
  error      text,                 -- sf__Error text (failure rows)
  PRIMARY KEY (org_schema, job_id, row_index),
  FOREIGN KEY (org_schema, job_id) REFERENCES "_orglet".bulk_ingest_jobs (org_schema, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "_orglet".bulk_query_jobs (
  org_schema text NOT NULL, id text NOT NULL, user_id text NOT NULL, organization_id text NOT NULL, profile_id text NOT NULL,
  operation text NOT NULL, object text NOT NULL, query text NOT NULL,
  line_ending text NOT NULL, column_delimiter text NOT NULL, api_version text NOT NULL,
  state text NOT NULL,
  created_date timestamptz NOT NULL DEFAULT now(), system_modstamp timestamptz NOT NULL DEFAULT now(),
  result_header jsonb, number_records_processed bigint NOT NULL DEFAULT 0, total_processing_time bigint NOT NULL DEFAULT 0,
  error_message text,
  PRIMARY KEY (org_schema, id)
);
CREATE TABLE IF NOT EXISTS "_orglet".bulk_query_rows (
  org_schema text NOT NULL, job_id text NOT NULL, row_index integer NOT NULL, cells jsonb NOT NULL,
  PRIMARY KEY (org_schema, job_id, row_index),
  FOREIGN KEY (org_schema, job_id) REFERENCES "_orglet".bulk_query_jobs (org_schema, id) ON DELETE CASCADE
);
```
- `created_date` is a database default so the 7-day clock and the age index use one clock (the DB's), and tests backdate with `UPDATE ... SET created_date = now() - interval '8 days'`. `pg` already renders `timestamptz` as `2024-01-31T13:45:00.000+0000` via the type parser in `packages/schema/src/db.ts`, so `createdDate`/`systemModstamp` in job info need no formatting code; `bigint` is parsed to JS `number` (OID 20 parser), so counters come back as numbers.
- Results store only `(row_index, success, record_id, created, error)`; the original columns are re-read from `csv_data` (parsed with `parseCsv` and the job's delimiter). `GET successfulResults` = join persisted rows with the parsed input by `row_index`; `unprocessedrecords` = parsed input rows whose index has no results row. This is what makes D-06 truthful after a crash with no duplicated cell data.
- `Aborted` leaves zero results rows, so `unprocessedrecords` returns every input row (D-06) with no extra code.
- `cells jsonb` holds an array of strings; insert a page with `INSERT ... SELECT $1, $2, ($3::int) + ord - 1, elem FROM jsonb_array_elements($4::jsonb) WITH ORDINALITY AS t(elem, ord)` in blocks of about 1000 rows (works on Postgres 16 and pglite 0.5.8; ordinary SQL, no extensions).

### Pattern 2: One guarded transition (D-08, Pitfall 15)
`jobs.ts` owns the table; `store.ts` is the only code that writes `state`. A compare-and-set UPDATE makes the guard race-safe and removes read-then-write windows (two concurrent `PATCH UploadComplete` calls: exactly one wins):

```ts
// jobs.ts: single source of truth for allowed server and client moves
export const TRANSITIONS: Record<"ingest" | "query", Partial<Record<JobState, readonly JobState[]>>> = {
  ingest: {
    Open: ["UploadComplete", "Aborted"],
    UploadComplete: ["InProgress", "Aborted", "Failed"],   // Failed: boot reconcile of a stuck row
    InProgress: ["JobComplete", "Failed"],
  },
  query: {
    UploadComplete: ["InProgress", "Aborted", "Failed"],
    InProgress: ["JobComplete", "Failed", "Aborted"],
  },
};
export const CLIENT_SETTABLE: ReadonlySet<JobState> = new Set(["UploadComplete", "Aborted"]);

// store.ts
async transition(kind, id, to, extra?: { errorMessage?: string }): Promise<boolean> {
  const from = Object.entries(TRANSITIONS[kind]).filter(([, tos]) => tos?.includes(to)).map(([f]) => f);
  const res = await this.pool.query(
    `UPDATE ${table(kind)} SET state = $3, system_modstamp = now(), error_message = COALESCE($4, error_message)
      WHERE org_schema = $1 AND id = $2 AND state = ANY($5::text[])`,
    [this.orgSchema, id, to, extra?.errorMessage ?? null, from]);
  return (res.rowCount ?? 0) === 1;      // false -> INVALIDJOBSTATE (or already purged)
}
```
The client-facing PATCH handlers check `CLIENT_SETTABLE.has(requested)` first (anything else: `INVALIDJOBSTATE`, as today), then call `transition`; the handlers never build an UPDATE of their own. A lint-level safeguard worth one test: grep that `state =` appears in exactly one file under `packages/api/src`.

### Pattern 3: Ingest PATCH UploadComplete (D-05, D-06)
1. `transition("ingest", id, "UploadComplete")`; false -> 400 `INVALIDJOBSTATE` with the existing wording.
2. `transition(..., "InProgress")`.
3. Load `csv_data`, parse, persist `input_header` and `input_row_count` (one short UPDATE).
4. For each 200-row chunk: call the engine (no DB client held open across the call), then ONE short `withTransaction` that inserts the chunk's `bulk_ingest_results` rows and increments the counters (`number_records_processed = number_records_processed + $n`, `number_records_failed = number_records_failed + $f`). Counters become exactly `success + failed` rows persisted.
5. Terminal `transition(..., "JobComplete")` plus `total_processing_time`; an empty header goes `InProgress -> Failed` with the existing `errorMessage`. A thrown engine error must be caught, persisted as `Failed` with `errorMessage`, and then rethrown or answered as the Failed job info (today an exception would have left the in-memory job in `Open` forever).
6. Re-read the row and respond with `ingestJobInfo` of the terminal state.

Deliberately preserved from today: relationship columns (`UNSUPPORTED:bulk-relationship-column`) fail every row at chunk level; `buildRecord` semantics; `formatSaveError`; `JobComplete` even when `numberRecordsFailed > 0`.

### Pattern 4: Query job lifecycle (D-13)
1. `checkBulkQuery(soql, schema)` (pure) -> violation => `400`, no row (below).
2. Validate the query compiles before inserting anything: call `compileSoql` from `@orglet/soql` (already exported, already a dependency) or simply keep today's behaviour where `runQuery` throws `SoqlError` (central error handler gives 400 `MALFORMED_QUERY`/`INVALID_FIELD`). Recommended: compile first so a bad query never creates a row (matches today's observable behaviour and the test at `bulk.test.ts:222-228`).
3. Insert the row at `UploadComplete` (object name from `ast.sObject`, replacing the regex), `transition -> InProgress`, run `runQuery` pages exactly as today, write `result_header` + rows via `bulk_query_rows` blocks, `transition -> JobComplete` with `number_records_processed`; any runtime failure => `Failed` + `error_message`. Respond with the terminal job info (`state: JobComplete`).
4. `GET .../results`: `locator`/`maxRecords` map to `OFFSET`/`LIMIT` on `bulk_query_rows`; keep the integer `Sforce-Locator` and the literal string `null` when exhausted (guide: "If there are no more sets of query results, this value is the string 'null'"). Fetch `LIMIT max+1` to know whether more exist without a count.

### Pattern 5: Purge and boot (D-04, D-10)
```sql
-- purge: one statement per job table, FK cascade removes results/rows
DELETE FROM "_orglet".bulk_ingest_jobs WHERE org_schema = $1 AND created_date < now() - interval '7 days';
DELETE FROM "_orglet".bulk_query_jobs  WHERE org_schema = $1 AND created_date < now() - interval '7 days';
-- reconcile (boot only)
UPDATE "_orglet".bulk_ingest_jobs SET state = 'Failed', system_modstamp = now(), error_message = $2
 WHERE org_schema = $1 AND state = 'InProgress';
```
- `prepareBulk(pool, orgSchema)` = `withTransaction(ensureInternalSchema + 4x CREATE TABLE IF NOT EXISTS)`, then reconcile both tables, then purge; returns `{ reconciled, purged }` for the `up()` log lines ("reconciled N bulk job(s) left in progress by a previous run", "purged N expired bulk job(s)"), printed only when non-zero, like key-prefix assignments.
- Per-request purge: register the `/jobs/*` routes inside an encapsulated plugin (or use `app.addHook("preHandler", ...)` inside `registerBulkRoutes`) with a hook that awaits `store.purge()`. It must run after the global auth `onRequest` hook and for the `text/csv` PUT too. Fastify applies hooks to routes of the same encapsulation context regardless of declaration order, but this is exactly the kind of thing a test must prove (see Validation: backdate then GET -> 404).
- `dropBulkJobs(pool, orgSchema)`: `to_regclass('_orglet.bulk_ingest_jobs')` guard, `DELETE ... WHERE org_schema = $1` on both job tables (cascade clears results), return the count; `reset()` calls it unconditionally after `DROP SCHEMA` and logs the count.

### Pattern 6: Bulk SOQL rule check (D-15)
Pure function in `soql-rules.ts`, `parseQuery` from `@jetstreamapp/soql-parser-js`, walking the AST. Names below were read from `node_modules/.pnpm/@jetstreamapp+soql-parser-js@8.1.0/.../dist/types/api/api-models.d.ts` and confirmed by running `parseQuery` on sample queries.

| Restriction (guide) | AST evidence (parser 8.1.0) | Check |
|---|---|---|
| TYPEOF | `fields[]` item `{ type: "FieldTypeof", field, conditions[] }` | `fields.some(f => f.type === "FieldTypeof")` |
| GROUP BY (incl. ROLLUP/CUBE) | `groupBy: GroupByClause[]`; `GROUP BY ROLLUP(x)` parses to `groupBy: [{ fn: { functionName: "ROLLUP", parameters:[..] } }]`; `GroupByType = 'CUBE' \| 'ROLLUP'` | `q.groupBy !== undefined` (covers all forms). `HAVING` without `GROUP BY` is a parse error and surfaces as malformed; with GROUP BY the first check already fired |
| OFFSET | `offset?: number` on the query (`OFFSET 2` -> `offset: 2`) | `q.offset !== undefined` (so `OFFSET 0` is rejected too) |
| Aggregate functions | `fields[]` item `{ type: "FieldFunctionExpression", functionName: "COUNT", parameters: [], isAggregateFn: true }` | Match `functionName` case-insensitively against `COUNT, COUNT_DISTINCT, SUM, AVG, MIN, MAX`. **Do not use `isAggregateFn`**: the parser also sets it `true` for date functions such as `CALENDAR_YEAR` (observed), which are legal in Bulk SELECT/WHERE |
| Parent-to-child subquery | `fields[]` item `{ type: "FieldSubquery", subquery: { relationshipName, fields.. } }` | `fields.some(f => f.type === "FieldSubquery")`. A subquery inside `WHERE` is `valueQuery` on a condition (`literalType: "SUBQUERY"`): a semi-join, NOT a parent-to-child relationship query; the guide's list does not include it, so do not reject |
| Compound address / geolocation | `{ type: "Field", field: "BillingAddress" }` or `{ type: "FieldRelationship", field, relationships: ["Account"] }` | Resolve against `OrgSchema`: for `Field`, `schema.getField(object, field)?.type`; for `FieldRelationship`, walk `schema.resolveRelationship(obj, rel)` (returns `{ target }`, `OrgSchema` at `metadata/src/types.ts:233`) through `relationships`, then `getField(target.name, field)`. Reject when type is `"Address"` or `"Location"` |
| `FIELDS()` | `{ type: "FieldFunctionExpression", functionName: "FIELDS", parameters: ["ALL"] }` | Reject `functionName` `FIELDS` (guide: Create-a-Query-Job note, "compound data ... and FIELDS()") |

`FieldType` metadata values come from `packages/metadata/src/types.ts` (`"Address" | "Location" | "Name"`; component fields carry `compoundFieldName`). Violations return `{ construct: string }`; the route turns it into `sendErrors(reply, 400, [apiError("FEATURE_NOT_ENABLED", message)])`. A parse failure in this pre-check should become `SoqlError` `MALFORMED_QUERY` exactly as REST reports it (reuse `malformed(detail)` from `@orglet/soql`).

### Anti-Patterns to Avoid
- **Holding a pool client across an engine call.** pglite-socket serialises all connections through one query queue (STATE.md, phase 1 decision). An open transaction on client A while the engine runs on client B can block indefinitely on pglite. Use autocommit `pool.query` for single statements and a short `withTransaction` strictly around the per-chunk result write.
- **Wrapping the whole ingest job in one transaction.** Defeats D-06 (a crash would roll back the evidence of committed records).
- **Using `isAggregateFn` as the aggregate test** (see table above).
- **Lazy `CREATE TABLE` inside `registerBulkRoutes` or on first request.** Contradicts D-04.
- **Reading `csv_data` for every request.** Select `csv_data` only in processing, `successfulResults`, `failedResults` and `unprocessedrecords`; job-info and list queries must name columns explicitly (never `SELECT *`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SOQL tokenising for restrictions | Regexes over the query string (current `/\(\s*select\b/i` rejects legal semi-joins and misses everything else) | `parseQuery` AST walk | Strings, comments, nested parens, aliases defeat regexes |
| Concurrency-safe `CREATE TABLE IF NOT EXISTS` | Own locking | `ensureInternalSchema(client)` inside `withTransaction` | Already advisory-locked (`internal.ts`); parallel test files and two servers can race on the catalog |
| State guard | `if (job.state !== ...)` in each handler | Single `transition()` CAS + `TRANSITIONS` table | Race-free and the only writer (Pitfall 15) |
| CSV rendering/parsing | New code | `parseCsv`, `writeCsv`, `delimiterChar`, `lineEndingChars` | Unchanged and already tested |
| Job ids | Own generator | `newJobId()` (`750` prefix) | Unchanged |
| Retention scheduler | `setInterval` / background task | Purge in boot + `/jobs/*` pre-handler | D-10; no timers keeps tests deterministic |
| Date formatting for `createdDate` | Manual `toISOString` | `timestamptz` + existing pg type parser | `formatSalesforceDatetime` already applied at the driver |

**Key insight:** every behaviour here (guard, paging, purge, unprocessed) becomes one indexed SQL statement once results are normalised into row tables; the in-memory arrays were only convenient because the data was never persisted.

## Runtime State Inventory

Not a rename/refactor phase, but there are two migration-like facts to record.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None existing: the in-memory `JobStore` was never persisted, so there are no legacy jobs to migrate. New `_orglet.bulk_*` rows appear on first `up` | Code only; `CREATE TABLE IF NOT EXISTS` is the migration. Jobs created by an older orglet process are simply gone (as before) |
| Live service config | None - verified: no external service holds Bulk job state | None |
| OS-registered state | None - verified: no scheduler, service or task embeds job data | None |
| Secrets/env vars | None. D-11 forbids adding a retention env var | None |
| Build artifacts | `packages/api/dist` stale until `pnpm build` (project references; cross-package types resolve from `dist`); `pnpm-lock.yaml` importer entry for `packages/api` must change when the parser dependency is added | `pnpm build` before `pnpm lint`/typecheck of `cli`; commit lockfile |

## Common Pitfalls

### Pitfall 1: Tables not created in test and embedded setups
**What goes wrong:** `createApiServer` no longer creates tables (D-04), so `bulk.test.ts` (and any test or script that builds a server) fails with `relation "_orglet.bulk_ingest_jobs" does not exist`.
**How to avoid:** Export `prepareBulk`/`ensureBulkSchema` from `@orglet/api`; call it in `beforeAll` of `bulk.test.ts` after `migrate`+`bootstrapOrg`; `afterAll` also calls `dropBulkJobs(pool, orgSchema)` so test orgs do not leave rows in a shared real Postgres.
**Warning signs:** 500s on `POST /jobs/ingest` in an otherwise green suite.

### Pitfall 2: A restart invalidates sessions, not just jobs
**What goes wrong:** `SessionStore` is in-memory (`auth.ts`). A restart-simulation test that reuses the old bearer token against the second server gets 401, which looks like "job lost".
**How to avoid:** After building the second `createApiServer`, log in again (`/services/oauth2/token`, same user) to get a fresh token. The admin user Id comes from the persisted user row, so `user_id` matches and the job is visible (D-03).

### Pitfall 3: Job stuck at `UploadComplete` after a crash
**What goes wrong:** D-05 persists `UploadComplete` then `InProgress`. A crash between those two writes (or for a query job between insert and `InProgress`) leaves `UploadComplete`; nothing ever advances it, and the client cannot re-send `UploadComplete` (400). D-07 only reconciles `InProgress`.
**How to avoid / recommendation:** reconcile **both** `UploadComplete` and `InProgress` to `Failed` at boot, with the same message family ("interrupted by a server restart before processing completed"). It is a strict superset of D-07's intent (success criterion 2 is satisfied). Flag to the plan as an extension of D-07 for Johan's approval; the alternative is to merge the two writes into one statement (`Open -> InProgress` stamping `UploadComplete` first is not observable), which departs from D-05's wording.

### Pitfall 4: Engine commit and result write are not atomic
**What goes wrong:** `DmlEngine.insert/update/...` commit in their own transaction; the chunk's result rows are written afterwards. A crash in that gap leaves records committed in the org but absent from both result sets, so `unprocessedrecords` lists rows that were in fact inserted.
**How to avoid:** Cannot be fixed without passing a client into the engine (out of scope). Document the window (one chunk, milliseconds) in the `store.ts` header comment and in the reconcile `errorMessage` ("rows listed as unprocessed may have been committed"). Do not claim stronger guarantees in docs.

### Pitfall 5: `Sforce-Locator` and `maxRecords` semantics
**What goes wrong:** the documented locator is an opaque "pseudo random string", the exhausted value is the literal string `null`, and `locator` must stay valid "as long as the associated job exists". An integer row offset satisfies all three; do not change it to something stateful.
**How to avoid:** keep today's integer offset (jsforce/simple-salesforce treat it as opaque), but validate it (`Number.isInteger`, `>= 0`) because it now goes into SQL parameters; never interpolate it.

### Pitfall 6: Delete-state rules differ from the code
**What goes wrong:** the guide says an ingest job can be deleted in `UploadComplete`, `JobComplete`, `Aborted` or `Failed` (not `Open`); a query job in `JobComplete`, `Aborted` or `Failed`. Today ingest omits `UploadComplete`, query has no check.
**How to avoid:** implement the documented sets in one constant (`DELETABLE`); ingest `UploadComplete` (reachable only after a crash before reconcile, or if Pitfall 3's reconcile is not adopted), query gets the check with `INVALIDJOBSTATE`.

### Pitfall 7: Query-job abort message and states
Documented: abort allowed only from `UploadComplete` and `InProgress`; failure example `HTTP/1.1 400`, `errorCode: "INVALIDJOBSTATE"`, `message: "Aborting already Completed Job not allowed"` (guide, "Abort a Query Job"). Current message is `InvalidJobState : cannot abort a job in state X`; reuse the documented text for the query abort (and keep ingest wording).

### Pitfall 8: pglite specifics
`pg_advisory_xact_lock`, `to_regclass`, `jsonb_array_elements ... WITH ORDINALITY`, `interval '7 days'`, `now()`, `ON DELETE CASCADE` composite FKs and `= ANY($n::text[])` are all plain SQL available in pglite 0.5.8 (Postgres 17 core); `ensureInternalSchema` and `to_regclass` are already exercised on pglite by phase 2 tests. Not used and not needed: `LISTEN`, `pg_notify`, row-level locking hints (`FOR UPDATE SKIP LOCKED`), `pg_sleep`-based tests. `now()` is transaction-start time; tests that backdate must use an explicit `UPDATE` (not rely on wall-clock sleeps).

### Pitfall 9: Behavioural change of the semi-join
The old regex rejected any `(select` including WHERE semi-joins (`WHERE Id IN (SELECT ...)`). The guide restricts only parent-to-child relationship queries, so the AST check will newly accept semi-joins. This is correct, but REST-compile support must hold (it does: `compile.ts` handles `ValueQueryCondition`). Add one positive test so the change is intentional, not accidental.

### Pitfall 10: Ingest rows with `Id` casing, blanks and `#N/A`
Unchanged logic, but because input is re-parsed from `csv_data` on every result download, the parse must use the job's `column_delimiter` char each time; store the delimiter, never assume comma.

## Code Examples

### Job-info mapping (columns map 1:1 to documented fields)
Documented ingest JobInfo (guide pp.36-38): `id, operation, object, createdById, createdDate, systemModstamp, state, concurrencyMode, contentType, apiVersion, jobType, contentUrl, lineEnding, columnDelimiter, numberRecordsProcessed, numberRecordsFailed, retries, totalProcessingTime, apiActiveProcessingTime, apexProcessingTime, errorMessage, externalIdFieldName`. Documented query JobInfo (pp.57-59): `id, operation, object, createdById, createdDate, systemModstamp, state, concurrencyMode, contentType, apiVersion, jobType (V2Query), lineEnding, columnDelimiter, numberRecordsProcessed, retries, totalProcessingTime, isPkChunkingSupported`. The existing `ingestJobInfo`/`queryJobInfo` already emit these; keep them as pure functions over the application-level `IngestJob`/`QueryJob` and add a `rowToIngestJob(row)` mapper in `store.ts`. Notes: `errorMessage` is documented for ingest jobs; the query JobInfo table has no `errorMessage`, so emit it for query jobs only when set (extra field on `Failed`, harmless; flagged LOW). `isPkChunkingSupported` is documented but absent today; emit `false` is optional (PK chunking is out of scope), not required by BULK-01..05.

### Documented states (guide p.6 "Job States"; JobInfo `state` tables)
| State | Ingest | Query | Meaning (doc) |
|---|---|---|---|
| Open | yes (initial) | no | "An ingest job was created and is open for data uploads." |
| UploadComplete | yes | yes (initial) | Ingest: "All job data has been uploaded and the job is ready to be processed"; Query: "The job is ready to be processed." |
| InProgress | yes | yes | "The job is being processed by Salesforce." |
| JobComplete | yes | yes | "The job was processed." |
| Failed | yes | yes | "The job couldn't be processed successfully." Ingest JobInfo: "Some records in the job failed. Job data that was successfully processed isn't rolled back." |
| Aborted | yes | yes | "canceled by the job creator, or by a user with the Manage Data Integrations permission." |

The "Failed ... isn't rolled back" sentence is the primary-source basis for D-07 (counters and per-chunk results are kept; nothing is undone).

### Reconcile message (wording proposal for the plan to lock, D-07)
`ServerRestarted : The server restarted while this job was in progress. Records already processed are listed in successfulResults and failedResults; records not yet processed are listed in unprocessedrecords (a record in the last processed batch may have been committed without being listed).` Format mirrors the existing `InvalidBatch : ...` prefix style in `processIngestJob`. Keep the code token (`ServerRestarted`) out of the Salesforce error list; it only appears inside `errorMessage`.

### Unprocessed-records semantics (guide pp.40-41)
Documented: "Retrieves a list of unprocessed records for failed or aborted jobs." Response is CSV of "all the records that were not processed by the job"; "Unprocessed rows are not the same as failed rows. Failed rows are processed but encounter an error during processing"; columns are only "Fields from the various original CSV request data" (no `sf__*` columns); "The order of records in the response is not guaranteed to match the ordering of records in the original job data." So: header = original `input_header`, rows = input rows without a results row, in input order (a valid, stronger-than-required ordering). `successfulResults` columns: `sf__Created` (boolean) and `sf__Id` then original fields; `failedResults`: `sf__Error` and `sf__Id` ("Available in API version 53 and later") then original fields. Existing code already orders `sf__Id, sf__Created` and `sf__Id, sf__Error`; the guide's example CSV shows `"sf__Id","sf__Created",Name,...`.

### Boot wiring in `up()` (after `bootstrapOrg`, before `createApiServer`)
```ts
// packages/cli/src/main.ts  (illustrative)
const bulk = await prepareBulk(pool, c.orgSchema);
if (bulk.reconciled > 0) log(c, `bulk: marked ${bulk.reconciled} job(s) left in progress by a previous run as Failed`);
if (bulk.purged > 0) log(c, `bulk: purged ${bulk.purged} job(s) older than 7 days`);
```
`reset()`: after the `DROP SCHEMA`, `const n = await dropBulkJobs(pool, c.orgSchema); log(c, \`dropped ${n} bulk job(s) for schema "${c.orgSchema}"\`);` and update the USAGE/`--drop-prefixes` text only if it mentions what reset keeps.

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Query jobs born `JobComplete` | Born `UploadComplete`, advance through `InProgress` (D-13) | Matches guide ("Create a Query Job" response shows `"state" : "UploadComplete"`) |
| Regex subquery guard | AST rule set | Accepts semi-joins, rejects every documented construct |
| Whole-job results at end | Per-chunk rows (D-06) | Crash-honest results |

**Doc currency:** both PDFs are the current release (API 68.0, guide last updated 2026-10-09). The guide describes state `Failed` and retention in the Limits Quick Reference, not in the Bulk 2.0 chapters.

## Open Questions

1. **Does Salesforce 400 or Fail a job on an unsupported construct, and with what code?**
   - What we know: construct list is documented; no HTTP status, `errorCode` or message is. The generic Bulk 2.0 error list (`FeatureNotEnabled`, `InvalidJob`, `InvalidJobState`, ...) has no matching entry. "Bulk API 2.0 uses the same status codes and exception codes as SOAP API."
   - What's unclear: everything about the wire shape.
   - Recommendation: apply D-14 fallback (400 at POST, no job), `errorCode: "FEATURE_NOT_ENABLED"`, message names the construct, e.g. `Bulk API 2.0 query jobs do not support GROUP BY`. Decision for the plan/Johan: whether to prefix `UNSUPPORTED:bulk-query`. Recommendation: **no prefix** (Salesforce rejects these too, so they are not an orglet gap; the marker would make log scans mistake faithful rejections for missing features). Record the wording as "orglet's choice, undocumented" in the plan.
2. **Is a compound `Name` field rejected by Salesforce Bulk query?** Guide lists only address and geolocation (plus `FIELDS()`). Recommendation: do not reject `Name`; revisit only if a documented source appears. LOW.
3. **Retention for non-terminal jobs measured from what?** Guide: "older than seven days ... periodically cleaned up". `created_date` used for all states (D-12).
4. **Extend D-07 to `UploadComplete` rows?** See Pitfall 3. Needs a yes/no in the plan.
5. **Atomicity window between engine commit and result write** (Pitfall 4): accepted and documented, or out of scope? Recommend accept and document.

### Resolution (2026-10-10, recorded in 06-CONTEXT.md)

1. Rejection shape: D-17 — `400` at `POST`, no job row, `FEATURE_NOT_ENABLED`, message names
   the construct, **no** `UNSUPPORTED:` prefix.
2. Compound `Name`: D-18 — not rejected; only `Address`/`Location` field types and `FIELDS()`.
3. Retention basis: D-18 — `created_date` for all states.
4. `UploadComplete` rows at boot: D-16 — reconciled to `Failed` together with `InProgress`.
5. Atomicity window: D-19 — **fixed in this phase**, not documented away. Each chunk's DML and
   its result rows commit in one transaction through a new engine seam (caller-supplied
   client; see D-19 for the required properties). Pitfall 4's "document it" recommendation is
   superseded.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 22 | build, tests | shell has v18.20.8 (project needs >=22) | 18.20.8 | `nvm use` / `.nvmrc`; not a phase blocker, an executor setup step |
| pnpm 10+ via Corepack | install, run tests | not on PATH in this shell | - | `corepack enable pnpm` |
| Docker | real-Postgres test leg, `pnpm db:up` | yes | 29.7.2 | pglite default run needs no Docker (INFRA-01) |
| Postgres 16 / pglite 0.5.8 | store tests | pglite via `devDependencies`; Postgres via `ORGLET_DATABASE_URL` | - | - |
| Official PDFs (research only) | - | fetched successfully with `curl` | - | - |

**Missing dependencies with no fallback:** none. **With fallback:** Node 22 / pnpm activation (executor must run them before `pnpm test`).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.7 (single root `vitest.config.ts`, alias `@orglet/*` -> `src/index.ts`) |
| Config file | `/Users/johankarlsteen/Development.nosync/local-salesforce/vitest.config.ts` |
| Quick run command | `pnpm vitest run packages/api/src/bulk` (pglite, Docker-free) |
| Full suite command | `pnpm test` (pglite) and `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` (real Postgres 16, after `pnpm db:up`); plus `pnpm build && pnpm lint` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BULK-01 | Job created, CSV uploaded and processed via server A is fully retrievable (info, list, all three result endpoints, query results with locator) through a fresh server B on the same pool after re-login | integration | `pnpm vitest run packages/api/src/bulk-persistence.test.ts -t "survives a restart"` | Wave 0 |
| BULK-01 | Two org schemas in one database never see each other's jobs; another user's job is 404 and absent from lists | integration | `... -t "per org and per user"` | Wave 0 |
| BULK-01 | `dropBulkJobs` removes only that org's rows (incl. results via cascade), is a no-op returning 0 when the tables do not exist, and leaves `_orglet.key_prefixes` untouched | integration | `... -t "reset"` | Wave 0 |
| BULK-02 | Full ingest path persists `UploadComplete` then `InProgress` then `JobComplete` (observe intermediate states by wrapping `engine.insert` with a spy that reads the row mid-chunk); query job row first exists at `UploadComplete` | integration | `... -t "state machine"` | Wave 0 |
| BULK-02 | Client requests for `InProgress`, `JobComplete`, `Failed`, `Open`, garbage all 400 `INVALIDJOBSTATE`; second `UploadComplete` 400; two concurrent `UploadComplete` PATCHes: exactly one 200 | integration | `... -t "client settable"` | existing `rejects invalid job state transitions` extends |
| BULK-02 | `prepareBulk` turns SQL-inserted `InProgress` (ingest and query) rows into `Failed` with the locked message, leaves counters, returns `{reconciled}`; a `JobComplete` row is untouched; a second call reconciles 0 | integration | `... -t "reconcile"` | Wave 0 |
| BULK-03 | Crash simulation: engine spy throws on chunk 2 of 3 (500 rows): results of chunk 1 persisted, `numberRecordsProcessed` = 200, `unprocessedrecords` = rows 200..499 in order with original columns only | integration | `... -t "per chunk"` | Wave 0 |
| BULK-03 | `Aborted` job: `unprocessedrecords` = every input row; `JobComplete`: empty; headers exactly `sf__Id,sf__Created,...`, `sf__Id,sf__Error,...`, original-only | integration | `... -t "result csv"` | partly existing (`inserts records through a CSV upload`) |
| BULK-04 | Backdate `created_date` by 8 days via SQL: next `GET /jobs/ingest/{id}` returns 404 with no restart; 6 days stays 200; `prepareBulk` purge count; results rows gone (cascade); open (never-uploaded) job also purged | integration | `... -t "retention"` | Wave 0 |
| BULK-05 | Table-driven: each of TYPEOF, GROUP BY, GROUP BY ROLLUP, OFFSET, COUNT(), COUNT(Id), SUM/AVG/MIN/MAX, compound Address field (`BillingAddress`), custom Location field, `Account.BillingAddress` via relationship, `FIELDS(ALL)`, child subquery returns a violation naming the construct; legal queries pass: plain, `Account.Name` parent traversal, WHERE semi-join, `CALENDAR_YEAR(CreatedDate)` in WHERE/SELECT, `toLabel`, `ORDER BY`, `LIMIT` | unit (no DB) | `pnpm vitest run packages/api/src/bulk/soql-rules.test.ts` | Wave 0 |
| BULK-05 | `POST /jobs/query` with each violation: 400, `errorCode FEATURE_NOT_ENABLED`, message names construct, and no row created (`SELECT count(*)`); REST `/query` still accepts the same SOQL where REST allows it (rule set separate) | integration | `... -t "bulk query rules"` | existing `rejects child subqueries and invalid SOQL` extends |
| Regression | Whole existing `bulk.test.ts` (ingest, upsert, delete, state errors, query paging, queryAll, CSV parser) passes unchanged except the added `prepareBulk` call | integration | `pnpm vitest run packages/api/src/bulk.test.ts` | exists |

Restart simulation recipe: build `engine` once; `appA = createApiServer({...})`, log in, create/process jobs, `await appA.close()`; `appB = createApiServer({...same engine/pool/organizationId/auth})`, `await appB.ready()`, log in again for a fresh token (Pitfall 2), assert. Drive D-07 with `pool.query("UPDATE \"_orglet\".bulk_ingest_jobs SET state='InProgress' WHERE ...")` or a direct `INSERT`, then `await prepareBulk(pool, orgSchema)` before building `appB`. The test file must never close the shared pool between servers.

### Sampling Rate
- **Per task commit:** `pnpm vitest run packages/api/src/bulk` (pure rule tests are millisecond-fast; DB tests few seconds on pglite)
- **Per wave merge:** `pnpm vitest run packages/api packages/cli` plus `pnpm build && pnpm lint`
- **Phase gate:** full `pnpm test` on pglite AND on Postgres 16 (CI runs both jobs), `tsc -b`, `eslint .`; conformance suites untouched in this phase (nothing in them exercises Bulk 2.0; Phase 7 re-runs them)

### Wave 0 Gaps
- [ ] `packages/api/src/bulk/soql-rules.test.ts` - BULK-05 pure table tests (needs the parser dependency wired into `packages/api/package.json` first)
- [ ] `packages/api/src/bulk-persistence.test.ts` - BULK-01..04 restart/reconcile/retention/per-chunk/reset tests (shared fixture with `bulk.test.ts`: `examples/acme`, `openTestDb`, per-file `test_<hex>` org schema)
- [ ] `bulk.test.ts` setup edit: call `prepareBulk(pool, orgSchema)` in `beforeAll`, `dropBulkJobs` in `afterAll`
- [ ] No framework install needed

## Sources

### Primary (HIGH confidence)
- Bulk API 2.0 and Bulk API Developer Guide, Version 68.0 (Winter '27), last updated October 9, 2026, official PDF export `https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_asynch.pdf` (read via `pdftotext`): "Job States" table (p.6); "Get Information About an Ingest Job" state and field tables (pp.36-38); "Get Job Successful/Failed/Unprocessed Record Results" (pp.39-41); "Delete a Job" (p.41); "Abort a Job" (pp.42-43); "Bulk API 2.0 Query" Availability, URIs and "SOQL Considerations" (p.53); "Create a Query Job" note and response (pp.54-56); "Get Information About a Query Job" (pp.57-59); "Get Results for a Query Job" locator/header text (pp.61-62); "Delete a Query Job" state note; "Abort a Query Job" states and `INVALIDJOBSTATE` example (pp.68-70); "Errors" (p.50). Bulk API (v1) "Job status in job history ... 7 days" sentence and v1 SOQL restrictions (v1 chapter; not applied to 2.0).
- Salesforce Developer Limits and Allocations Quick Reference PDF `https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/salesforce_app_limits_cheatsheet.pdf`, "Bulk API and Bulk API 2.0 Limits and Allocations", General Limits, "Batch and job lifespan" row, Bulk API 2.0 column (the retention rule).
- `@jetstreamapp/soql-parser-js` 8.1.0 type definitions `dist/types/api/api-models.d.ts` and direct execution of `parseQuery` on sample queries (outputs recorded in Pattern 6).
- Repo files read: `packages/api/src/routes/bulk.ts`, `bulk/jobs.ts`, `bulk/csv.ts`, `server.ts`, `index.ts`, `package.json`; `packages/schema/src/internal.ts`, `prefixes.ts`, `db.ts`, `index.ts`; `packages/cli/src/main.ts`; `packages/engine/src/query.ts`; `packages/metadata/src/types.ts`, `build.ts`; `packages/soql/src/index.ts`, `errors.ts`; `packages/api/src/bulk.test.ts`; `test/db.ts`; `vitest.config.ts`; `.planning/config.json`, research ARCHITECTURE/PITFALLS excerpts.

### Secondary (MEDIUM confidence)
- Web search results listing the developer.salesforce.com "Limits and Allocations" pages (which returned 403 to fetch) summarising the same "Batch and job lifespan" text; consistent with the PDF.

### Tertiary (LOW confidence)
- None used for decisions. A search for a documented unsupported-construct error string returned only the construct list again; no error wording found.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries; one dependency declaration verified against lockfile/layout
- Architecture: HIGH - follows `prefixes.ts` and `auth.ts` precedents; SQL is plain and pglite-safe
- Documented behaviour (states, result columns, query restrictions, retention figure): HIGH
- Retention basis (creation vs completion): MEDIUM - guide says "older than seven days", no explicit anchor
- Rejection form and wording: LOW (documentation silent; fallback applied)
- Pitfalls: HIGH for code-derived ones (pool/pglite queue, token loss, delete-state mismatch), MEDIUM for the atomicity window

**Research date:** 2026-10-10
**Valid until:** 2026-11-10 (docs are the Winter '27 release; the Spring '27 guide may reword retention or add error text, re-check the Limits Quick Reference row if planning slips)
