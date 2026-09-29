# External Integrations

**Analysis Date:** 2026-09-29

## What This Project Is

orglet is a self-hosted emulator of the Salesforce platform REST/SOAP surface, backed by
Postgres. It has no outbound integrations of its own (no third-party SaaS calls, no payment
providers, no cloud SDKs) — its "integration surface" is the Salesforce-compatible API it
exposes to clients, plus the upstream client SDKs used to verify conformance against that
surface. `packages/api/src/server.ts`.

## Data Storage

**Databases:**
- Postgres 16 (`postgres:16-alpine` image) - the only datastore. Single-tenant per schema:
  each "org" is a Postgres schema (`--org-schema` CLI flag), generated/migrated by
  `packages/schema/src` from the parsed metadata (`packages/metadata`).
  - Connection: `ORGLET_DATABASE_URL` env var (see `.env.example`), also `--db` CLI flag
  - Client: `pg` ^8.23.0, wrapped in `packages/schema/src/db.ts` (`createPool`, exports
    `Pool`/`PoolClient`/`Queryable` types)
  - Local dev instance: `docker-compose.yml` (`pnpm db:up` / `pnpm db:down`), host port
    5433 by default

**File Storage:**
- Local filesystem only - SFDX project files are read directly (`--project` flag points at
  an `sf project retrieve` output tree, e.g. `examples/acme/force-app`); no blob/object
  storage integration.

**Caching:**
- None (in-process `Map`s only: session tokens in `SessionStore`
  (`packages/api/src/auth.ts`), query locators for `nextRecordsUrl` pagination in
  `ApiContext.locators` (`packages/api/src/server.ts`) — both ephemeral, in-memory, not
  shared across processes).

## Authentication & Identity (exposed by orglet's API)

orglet implements the client-facing auth flows Salesforce SDKs expect, not calls to an
external identity provider — it *is* the identity provider for connecting clients.

**SOAP login** (`packages/api/src/routes/login.ts`):
- `POST /services/Soap/:api/:version` - parses `username`/`password` out of the raw SOAP XML
  body (regex-based tag extraction, not a full SOAP/WSDL implementation), returns a
  `loginResponse` SOAP envelope with `sessionId`, `serverUrl`, `userInfo`. Used by
  `simple-salesforce` and jsforce's default `Connection.login()`.
- On failure: SOAP fault envelope with `INVALID_LOGIN`.

**OAuth 2.0 token endpoint** (`packages/api/src/routes/login.ts`):
- `POST /services/oauth2/token` - supports `grant_type=password`, `refresh_token`, and
  `client_credentials`. Body parsed via `@fastify/formbody` (form-encoded, as real Salesforce
  expects). Returns `access_token`, `refresh_token`, `instance_url`, `id`, `token_type`.
  - `client_credentials` always logs in as `AuthConfig.clientCredentialsUser` (default
    `admin@orglet.local`).
  - `refresh_token` re-issues a token for the same session without re-checking credentials.

**Session/auth model** (`packages/api/src/auth.ts`, class `SessionStore`):
- Two modes: `"permissive"` (any password accepted — the local-dev default) and `"list"`
  (explicit `{ username, password }` pairs via CLI `--users user:pass,user2:pass2`, with
  Salesforce-style tolerance for a security-token suffix appended to the password).
  Set via `AuthConfig` passed into `createApiServer`.
  - `orglet up` sets `mode: "list"` when `--users` is passed, else `mode: "permissive"`
    (`packages/cli/src/main.ts`).
- Users are ordinary rows in the emulated `User` sObject table (looked up by `Username`
  field via the DML engine), not a separate auth store.
- Tokens: `randomBytes(24)` base64url, prefixed with the organization ID
  (`{orgId}!{random}`), held in an in-memory `Map<token, LoginResult>` — lost on restart, no
  expiry logic beyond process lifetime.
- Bearer extraction: `Authorization: Bearer <token>` or `Authorization: OAuth <token>`
  (`bearerToken()` in `packages/api/src/auth.ts`).
- Identity endpoints: `GET /id/:org/:user` and `GET /services/oauth2/userinfo` return a
  Salesforce-shaped identity document (`urls.rest`, `urls.sobjects`, etc.).

**Auth enforcement:**
- `onRequest` hook in `packages/api/src/server.ts` protects any path matching
  `^/services/data/v\d+\.\d+` or starting with `/id/`; resolves the bearer token via
  `SessionStore.resolve`, 401s with `INVALID_SESSION_ID` if absent/invalid.

## Salesforce REST/SOAP Surface Implemented

All routes are mounted under `/services/data/v:version/...` unless noted; `:version` is a
free-form path segment (e.g. `59.0`) captured into `req.apiVersion`.

**Discovery / meta** (`packages/api/src/routes/misc.ts`):
- `GET /services/data` - list of API versions (`v30.0`..`v65.0`, synthesized with season/year
  labels)
- `GET /services/data/v:version` - resource map (sobjects, query, composite, limits, jobs,
  identity, etc. — some entries like `tooling`, `chatter`, `tabs`, `theme` are advertised in
  this map but not actually implemented as routes)
- `GET /services/data/v:version/limits` - static, hardcoded org limits payload
- `GET /services/data/v:version/search` - SOSL stub; always returns `{ searchRecords: [] }`
  and logs `UNSUPPORTED:sosl` once

**sObjects** (`packages/api/src/routes/sobjects.ts`):
- `GET /sobjects` - global describe (all object names/labels)
- `GET /sobjects/:type` - basic object describe
- `GET /sobjects/:type/describe` - full describe (fields, etc.), `packages/api/src/describe.ts`
- `POST /sobjects/:type` - create record
- `GET /sobjects/:type/:id` - retrieve record
- `PATCH /sobjects/:type/:id` - update record
- `DELETE /sobjects/:type/:id` - delete record
- `GET|PATCH|DELETE /sobjects/:type/:field/:value` - external-ID based get/upsert/delete
  (upsert returns Salesforce's `300 Multiple Choices` shape on duplicate external IDs)
- `GET /sobjects/:type/updated`, `GET /sobjects/:type/deleted` - change-window endpoints

**Query** (`packages/api/src/routes/query.ts`):
- `GET /query`, `GET /queryAll` - SOQL execution (`compileSoql` + `runQuery` from
  `@orglet/soql` / `@orglet/engine`), Salesforce paging shape (`totalSize`, `done`, `records`,
  `nextRecordsUrl`)
- `GET /query/:locator`, `GET /queryAll/:locator` - `queryMore` pagination; locators are
  server-side, in-memory, 15-minute TTL (`ApiContext.locators`), formatted to look like real
  Salesforce locators (`01g...-<offset>`)

**Composite** (`packages/api/src/routes/composite.ts`):
- `POST|PATCH|DELETE /composite/sobjects` - SObject Collections (batch create/update/delete)
- `POST /composite/sobjects/:type`, `PATCH /composite/sobjects/:type/:field` - collection
  create / collection upsert by external ID
- `POST /composite` - Composite API (sub-request graph with reference resolution)
- `POST /composite/batch` - Batch API
- `POST /composite/tree/:type` - SObject Tree (nested record graphs)

**Bulk API 2.0** (`packages/api/src/routes/bulk.ts`, `packages/api/src/bulk/jobs.ts`,
`packages/api/src/bulk/csv.ts`):
- Ingest jobs: `POST /jobs/ingest`, `PUT /jobs/ingest/:id/batches` (CSV upload), `PATCH
  /jobs/ingest/:id` (state transition, e.g. UploadComplete), `GET /jobs/ingest[/:id]`, `DELETE
  /jobs/ingest/:id`, `GET /jobs/ingest/:id/successfulResults|failedResults|unprocessedrecords`
- Query jobs: `POST /jobs/query`, `GET /jobs/query[/:id]`, `GET /jobs/query/:id/results`,
  `PATCH /jobs/query/:id`, `DELETE /jobs/query/:id`
- Note: this is Bulk API **2.0** only. Bulk API **v1** (`/services/async/*`) is not
  implemented — see Gaps below.

**Built-in UI:**
- `GET /` - serves `packages/api/ui/index.html`, a single self-contained page (object
  browser + SOQL console), no separate frontend build/deploy pipeline.

## Known Gaps (declared, not accidental)

Documented in `conformance/jsforce/README.md` as explicit phase-1 scope, verified against a
real upstream client suite:
- SOSL search always empty (stub, not a real search)
- Bulk API **v1** (`/services/async/*`) not implemented (Bulk 2.0 is)
- Describe layouts family (`layouts`, named/compact/approval layouts), list views, `/tabs`,
  `/theme`, `/recent` (recently viewed) — all 404
- `FOR VIEW` SOQL clause — explicit `UNSUPPORTED:soql-for` error
- Streaming API, Metadata API, Tooling API, Apex REST, Chatter — not implemented at all
- `explain=<soql>` query param on `GET /query` is ignored rather than answered or rejected
  cleanly

## Vendored Third-Party Code

**sigha** (`packages/sigha/`):
- Upstream: https://github.com/rfaulhaber/sigha (MIT License), a Salesforce formula
  debugger/evaluator
- Vendored via `scripts/sync-sigha.sh <git rev>`, which clones upstream, copies the
  dependency-free engine layers (`syntax/`, `registry/`, `analysis/`, `engine/`, `i18n/`) plus
  the golden test corpus (`corpus/salesforce-v2.json`, `corpus/org-verified.json`), rewrites
  `decimal.js` default imports to named imports and adds explicit `.js` extensions for
  NodeNext resolution
- Current pin: revision `2abe5dbb3ca0ab17b7aa1443024562041336ca5f`, synced 2026-09-25
  (`packages/sigha/VENDOR.md`)
- Rule: nothing under `packages/sigha/src` is hand-edited (excluded from ESLint via
  `eslint.config.js` ignores); behavior changes go upstream and get re-synced
- Sub-vendored inside sigha's NOTICE (`packages/sigha/NOTICE`): the golden formula corpus is
  derived from Salesforce's own open-source `salesforce/formula-engine` (BSD-3-Clause), and
  function implementations are informed by `formulon` (MIT)
- `@orglet/formula` (`packages/formula/`) is orglet's own code that binds sigha's evaluator
  to orglet's record/field model — not vendored itself, but depends on `@orglet/sigha`
  (workspace dependency)

## Conformance Suites (upstream SDKs tested against orglet)

Not runtime dependencies of orglet — external harnesses in `conformance/` that clone/install
real Salesforce client SDKs and run their own test suites against a locally running orglet
instance, to verify wire-compatibility.

**jsforce** (`conformance/jsforce/`):
- `run.sh` clones jsforce `main` into `.cache/jsforce` (git submodule-free, plain clone+build
  each run), `npm ci`, `tsc` build, then runs a subset of jsforce's own Jest e2e suite
  (`test/connection-crud.test.ts`, `test/query.test.ts`, `test/connection-meta.test.ts`,
  `test/sobject.test.ts`, `test/connection-session.test.ts`, `test/bulk.test.ts`) against a
  running orglet server via `SF_LOGIN_URL`/`SF_ACCESS_TOKEN` env vars
- `seed.mjs` seeds fixture data (2500 `BigTable__c` rows for pagination tests, 8 Accounts x 2
  Contacts x 2 Opportunities) via orglet's own `/composite/sobjects` REST endpoint, standing
  in for the Bulk API v1 seeding the upstream harness normally uses
- Requires two custom objects added to the fixture org (`examples/acme/force-app/main/default/objects/`):
  `BigTable__c`, `UpsertTable__c`
- Last verified result (phase 0, 2026-09-25, `conformance/jsforce/README.md`): 51 passed, 2
  failed (both dependent on Bulk API v1), 58 skipped by an explicit Jest `-t` filter excluding
  declared phase-1 gaps (bulk, layouts, list views, tabs, theme, SOSL, identity `https://`
  assertion, one jsforce-only-satisfiable upsert assertion)

**simple-salesforce** (`conformance/python/`):
- `conformance/python/requirements.txt`: `simple_salesforce` (unpinned) plus `cryptography==43.0.3`
  pinned specifically to avoid a macOS wheel/build issue
- `conformance/python/run.py` - custom PASS/FAIL harness (not the SDK's own test suite,
  unlike jsforce): logs in via `SalesforceLogin` (SOAP), exercises `Salesforce`/`SFType`
  against `BASE_URL = http://localhost:8180`, `USERNAME = admin@orglet.local`, `API_VERSION =
  59.0`
  - Includes an `HttpRewriteSession` shim that rewrites `https://` back to `http://`, because
    simple-salesforce hardcodes `https://` URL construction and orglet is served over plain
    HTTP locally
- README.md reports `simple-salesforce` conformance as 26/26 passing (phase 0 milestone M7)

## Environment Configuration

**Required env vars:**
- `ORGLET_DATABASE_URL` - Postgres connection string used by the engine, CLI, and tests
  (default in `.env.example`: `postgres://orglet:orglet@localhost:5433/orglet`)
- `ORGLET_PG_PORT` - host port for the docker-compose Postgres service (default `5433`)

**Secrets location:**
- None committed. `.env.example` contains only non-secret local-dev defaults (fixed
  dev-only Postgres credentials `orglet`/`orglet`). No `.env` file present in the repo.
  `.gitignore` excludes `.env` / `.env.*` (keeping `.env.example`).

## Webhooks & Callbacks

**Incoming:** None - orglet is a synchronous REST/SOAP server, no webhook receivers.

**Outgoing:** None - no outbound HTTP calls to third parties from orglet's own runtime code.

---

*Integration audit: 2026-09-29*
