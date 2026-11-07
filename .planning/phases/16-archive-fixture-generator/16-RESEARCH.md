# Phase 16: Archive Fixture Generator - Research

**Researched:** 2026-11-07
**Domain:** Internal integration (orglet engine/schema/api/metadata) producing a Heimdall-shaped backup fixture
**Confidence:** HIGH for code facts (read and probed in-process); MEDIUM for Heimdall format details (documented from source reading, never run)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Determinism seam (Ids and clock)**
- **D-01:** The generator runs `DmlEngine` in import mode (`EngineOptions.importMode`) and supplies every record `Id`, `CreatedDate`, `CreatedById`, `LastModifiedDate`, `LastModifiedById` and `SystemModstamp` itself, which import mode already honours (`engine.ts` keeps supplied audit values and skips `placeVersion`, so the generator also supplies `ContentDocument` rows and `ContentDocumentId`). `generateId` and the module-level clock in `packages/schema/src/ids.ts` are not changed. The only engine/schema change is a surgical options bag on `bootstrapOrg` (`BootstrapOptions`) that accepts fixed Ids for the rows it mints (Organization, Profile, User, BusinessHours, UserLicense, RecordType per developer name) and a fixed `now`; when absent, behaviour is unchanged. No process-global seed, no injected `IdGenerator`/`Clock` interfaces.
- **D-02:** Fixture record Ids are sequential per key prefix from a fixed base: prefix + `00` + a zero-padded counter in the 10-character body (for example `001000000000001` + case-safe suffix via `toCaseSafeId`), allocated in seed order. Readable in diffs, and Id order follows insert order as Heimdall's `ORDER BY SystemModstamp ASC, Id ASC` expects. Not hash-derived.
- **D-03:** Timestamps are explicit in the seed data: each seed record states when it was created and, for period-2 changes, when it was modified or deleted. The generator has one fixed wall-clock instant per period that fills the `Year=/Month=/Date=` key segments, `backup_runs.started_at` / `completed_at` and the checkpoint columns.
- **D-04:** A leak guard runs before any file is written: every Id appearing in the Bulk output (own `Id` and every reference column) must belong to the generator's allocation set, and every datetime cell must fall inside the period's fixed window; a violation aborts with the object and field name only, never a cell value. In addition a vitest test runs the generator twice into temporary directories and compares the trees byte for byte (success criterion 3).

**Fixture content**
- **D-05:** Object selection mirrors Heimdall: the generator lists `/services/data/vXX.X/sobjects/`, queries every object with `replicateable: true`, and writes a CSV plus `backup_runs` row only for objects that return rows. An object whose query is refused (ContentDocumentLink: the Phase 15 mandatory-filter rule answers `MALFORMED_QUERY` for an unfiltered query, as a real org does) gets a `backup_runs` row with status `Failed` and the error message, no CSV. Bootstrap objects (User, Organization, Profile, RecordType, BusinessHours, UserLicense) are therefore in the backup, so Phase 18 has User rows to resolve `OwnerId`/`CreatedById` against.
- **D-06:** Volume: roughly 5-20 seed rows per acme object (Account, Contact, Opportunity, Project__c, Milestone__c, UpsertTable__c, ContentVersion with ContentDocument), readable in a PR diff. `BigTable__c` gets more rows and its query is split into two Bulk jobs per period through Heimdall's `LIMIT` plus `(SystemModstamp, Id)` checkpoint, so one object has two CSVs in a period and Phase 18 must follow `objects.csv_id -> csvfiles.s3path` rather than assume one file per object. Repo growth stays in the hundreds of kilobytes.
- **D-07:** Period 1 is a full snapshot. Period 2 is an increment containing: updated records (same Id, later `SystemModstamp`, so Phase 18 must pick the latest version), deleted records (written through `queryAll ... IsDeleted = true` into `<Object>_deleted/`, at least one of which was active in period 1), a second version of one ContentVersion (`IsLatest` moves, `VersionNumber` "2", the ContentDocument mirror follows), two distinct ContentVersion rows sharing one `Checksum` so one blob key is shared (Heimdall's dedup), and one binary blob with non-UTF-8 bytes. Blobs are tiny and generated from text or bytes in the seed; no files from the internet.
- **D-08:** Not included: records first created in period 2, a same-second version tie across periods, and an `Archive-yyyyMM` run (negative index period). Two normal periods only, as the roadmap states; tie and archive-period cases belong to FIX-03 or Phase 18 unit tests.

**Index dump**
- **D-09:** The index is one SQL file, `examples/acme-archive/index.sql`, containing `CREATE TABLE` for `csvfiles`, `objects` and `backup_runs` followed by `INSERT` statements in a deterministic order (table order fixed; rows ordered by primary key). It runs unchanged on Postgres 16 and pglite, so Phase 18 tests load it into an empty schema and point the loader at that connection URL exactly as at a real Heimdall database. No JSON or CSV form of the index.
- **D-10:** The DDL carries the full documented column set of the three tables (`.planning/research/HEIMDALL-FORMAT.md` section 3), re-derived from the documentation; no SQL is copied from the Heimdall repository (PITFALLS P24). `object_stats` and `restore_log` are not written. `objects.metadata` follows Heimdall's rule (non-empty fields ending in `Id`, describe reference fields, and for ContentVersion also `Checksum`, `FileType`, `FileExtension`, `ContentSize`, `Title`, `PathOnClient`); `objects.name` is the first of Name, Subject, Title, CaseNumber, DeveloperName, Label that the object has, else the Id; `objects.version` is `SystemModstamp` as epoch seconds; `period` is YYMM as an int (`2601`, `2602`) while the S3 key segment is `Period=202601` / `Period=202602`.
- **D-11:** Layout: `examples/acme-archive/store/` mirrors the bucket root (`OrgId=<org>/Period=202601/Year=2026/Month=01/Date=<dd>/<Object>[_deleted]/<file>.csv` and `OrgId=<org>/Period=0/files/<cs[0:4]>/<cs>.<ext>` built with the existing `blobKey`), with `index.sql` and a `README.md` beside `store/`. `csvfiles.s3path` is the bare key without any `s3://bucket/` prefix, as Heimdall writes it. The README describes the layout, the two periods' story and how to regenerate.

**Generator mechanics**
- **D-12:** The generator boots against in-process pglite (the `test/db.ts` pattern, a throwaway database per run), never Docker Postgres. It lives under `scripts/gen-archive-fixture/`, runs with `tsx` and is type-checked by `tsconfig.scripts.json`, like `scripts/gen-baseline`.
- **D-13:** CSVs come from real Bulk 2.0 query jobs: the generator builds the app with `createApiServer` and drives `POST /jobs/query` (operation `query` or `queryAll`, `lineEnding` `LF`, comma delimiter), polls to `JobComplete`, and pages `GET /jobs/query/{id}/results` with `maxRecords=2000` and `Sforce-Locator` through `app.inject`, concatenating pages with one header as Heimdall does. The SOQL per object uses Heimdall's column rule (every describe field in describe order minus `address`, `base64`, `Id` and `SystemModstamp`; then `SystemModstamp`, then `Id` last; no relationship columns) and Heimdall's `WHERE`/`ORDER BY`/`LIMIT` form with the `(SystemModstamp, Id)` checkpoint. Seed rows are written through `DmlEngine` directly, not HTTP.
- **D-14:** A new package `packages/archive` (`@orglet/archive`) is created in this phase holding only pure, dependency-free Heimdall-format helpers and the index DDL: CSV key builder, blob key reuse (`blobKey` stays in engine), period formatting (`yyyyMM` key segment versus YYMM int), `objects.metadata` and `objects.name` rules, column-order rule, index `CREATE TABLE` text. It depends on `metadata` (for `FieldDef`/`SObjectDef`) and `schema` at most, never on `api`. The generator script imports from it; Phase 18's loader joins the same package so writer and reader cannot drift (PITFALLS P23). Root `tsconfig.json`, `vitest.config.ts`, `tsconfig.test.json` aliases and `eslint.config.js` are extended for the new package.
- **D-15:** Root scripts `archive-fixture:gen` and `archive-fixture:check`. `--check` regenerates in memory and exits 1 listing every differing, missing or stray file under `examples/acme-archive/`, mirroring `baseline:check`. Wiring it into CI stays FIX-02 (v2) and is not done here.

### Claude's Discretion
- The seed data module's shape (one TypeScript module with period sections is the expected form), the fixed wall-clock dates per period, the fixed Organization Id that becomes `OrgId=` in keys, and the realistic-looking names of bootstrap rows.
- How Bulk job Ids are made deterministic for the `<bulkJobId>.csv` file names (the generator may name files itself; PITFALLS P23 says not to over-trust Heimdall's naming) as long as `csvfiles.s3path` is the only path the loader follows.
- Exact `BootstrapOptions` field names for D-01 and how RecordType Ids are keyed.
- Which seed field values exercise multi-picklists, `+0000` datetimes, empty-versus-null, formula and roll-up columns (Heimdall includes calculated fields), as long as every acme field type appears at least once.
- Whether `backup_runs.records_processed`/`bytes_transferred` are exact counts (preferred) or omitted as NULL where the documented semantics are unclear.

### Deferred Ideas (OUT OF SCOPE)
- `Archive-yyyyMM` run with negative index period in the fixture (P23 suggestion) - FIX-03 or a Phase 18 unit case.
- Same-second version tie across periods and records first created in period 2 - FIX-03 / Phase 18.
- `fixture-gen-check` CI job - FIX-02 (v2).
- Hand-written adversarial CSV set - FIX-03 (v2).
- `ContentVersion.FirstPublishLocationId` not expanded to custom objects (Phase 15 residual) - if the seed wants an auto-link to Project__c it must insert the ContentDocumentLink explicitly.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FIX-01 | Deterministic script under `scripts/` boots orglet on `examples/acme` with a fixed clock and writes `examples/acme-archive/` from Bulk 2.0 query output in Heimdall's field order (two periods, `_deleted`, blobs, index dump, byte-identical re-run, blob MD5 == Checksum) | Probe-verified in-process flow (pglite + `createApiServer` + import-mode engine + `app.inject` Bulk jobs, ~2 s end to end for all 58 replicateable objects); determinism hazard table; import-mode gaps the seed must fill (Checksum, ContentSize, mirror, roll-ups, delete stamps); package wiring checklist; validation plan |
</phase_requirements>

## Summary

Everything the generator needs already exists and works in-process. I ran throwaway probes (deleted afterwards, `git status` clean) that boot pglite, `migrate` the acme schema, `bootstrapOrg`, build the Fastify app, log in over `/services/oauth2/token`, list `/sobjects/` (58 objects, all `replicateable: true`), and drive `POST /jobs/query` plus `GET .../results` through `app.inject`. All 58 objects accept the Heimdall-style `SELECT <cols> ... ORDER BY SystemModstamp ASC, Id ASC LIMIT n` query; the only refusal is `ContentDocumentLink` (HTTP 400 `MALFORMED_QUERY` at job creation, not a `Failed` job). Whole setup plus 58 queries took about 2 s. The `WHERE ((SystemModstamp = <datetime literal> AND Id > '<id>') OR SystemModstamp > <literal>)` form and `queryAll ... IsDeleted = true` compile and run (verified on an empty table; non-empty behaviour must be asserted by the generator's own tests).

The work is mostly seed design and bookkeeping, not new machinery. Five things in the code differ from what CONTEXT.md assumes and must be planned around: (1) in import mode `prepareVersion` returns early, so `Checksum`, `ContentSize`, `ContentSizeLong`, `FileExtension`, `FileType`, `VersionNumber`, `IsLatest` and the whole ContentDocument mirror are NOT derived: the seed/generator must supply them (CONTEXT says `finishVersion` "still computes Checksum"; it does not); (2) `DmlEngine.delete` stamps `SystemModstamp`/`LastModifiedDate` with wall-clock `new Date()` even in import mode (`engine.ts:942` via `Store.setDeleted`), so deletes must go through `Store.setDeleted` with a fixed stamp (or be re-stamped by SQL); (3) import mode skips roll-up recompute, so stored roll-up columns (`Milestone_Count__c` etc.) stay 0 after seeding children (probe-verified); (4) `tsx` cannot resolve `@orglet/*` from `scripts/` without `TSX_TSCONFIG_PATH=tsconfig.test.json` (probe-verified; no root `node_modules/@orglet`); (5) the interactive shell's default Node is 18.20.8, on which `tsx` 4.23 crashes (`toReversed`); Node 22 (`.nvmrc`) is required.

**Primary recommendation:** Split into `scripts/gen-archive-fixture/{seed.ts, build.ts, generate.ts}` where `build.ts` exports `buildFixture(): Promise<Map<string, string | Buffer>>` (pure of the filesystem, used by gen, `--check` and the vitest test), seed rows through `DmlEngine` in import mode with fixed Ids/stamps, re-stamp deletes with `Store.setDeleted`, drive Bulk jobs through `app.inject`, and put every format rule (keys, periods, metadata, name, column order, DDL) in `@orglet/archive` as pure functions.

## Project Constraints (from CLAUDE.md)

- TypeScript strict; `NodeNext` ESM: relative imports carry `.js`; cross-package imports by `@orglet/*` name only; one barrel `src/index.ts` per package with explicit named exports (values and `export type` listed separately, never `export *`); `import type` for type-only (enforced by lint); no unused vars except `_`-prefixed.
- Every source file opens with a `/** ... */` block explaining why it exists; package `index.ts` starts with a one-line `// @orglet/<pkg>: ...` comment.
- Tests: co-located `*.test.ts`; test names state the invariant (`test_refund_blocked_after_30_days` style); `vitest.config.ts` include globs are `packages/*/src/**/*.test.ts` and `packages/*/test/**/*.test.ts` (a test in `scripts/` would NOT run; put the generator test under `packages/archive/src/` or `packages/archive/test/`).
- `UNSUPPORTED:<area>` convention for deliberate gaps; diagnostics never echo cell values (P22).
- Legal/licence: no Heimdall SQL or code copied (re-derive from HEIMDALL-FORMAT.md); Apache-2.0; deps OSI-licensed; no new third-party deps are needed for this phase.
- Level 1 data only: fixture data is synthetic (Acme names, tiny text blobs); no Tele2 names; do not put Tele2 or non-public terms in web searches (none were needed).
- Git: repo-local identity Johan Karlsteen <johan@karlsteen.com>; commits end with the attribution lines from the session reminder. Branch `gsd/phase-16-archive-fixture-generator`.
- GSD workflow: all file edits go through a GSD command (this phase is executed via `/gsd:execute-phase`).
- Surgical changes, match existing style, read before writing; "done" requires a verification run actually executed.

## Standard Stack

No new external dependencies. Everything is already in the workspace.

### Core
| Library | Version (repo) | Purpose | Why |
|---------|---------|---------|-----|
| `@electric-sql/pglite` + `@electric-sql/pglite-socket` | 0.5.8 / 0.2.11 (root devDeps, exact pins) | In-process Postgres for the throwaway org DB | Locked D-12; same pattern as every test file |
| `fastify` (via `@orglet/api`) | 5.12.5 | `app.inject` drives Bulk 2.0 jobs without a socket | Locked D-13 |
| `tsx` | 4.23.15 | Runs the script | `baseline:gen` precedent; needs `TSX_TSCONFIG_PATH` (see Pitfall 1) |
| `vitest` | 3.2.7 | Determinism + MD5 + structure tests | Existing |
| `node:crypto` (`createHash("md5")`) | Node 22 | Blob MD5 / checksum | Same call the engine uses in `files.ts:60` |
| `node:fs`, `node:path`, `node:os` (`mkdtemp`) | Node 22 | Writing the tree, temp dirs in tests | `gen-baseline/generate.ts` precedent |

### In-repo building blocks (cite when planning tasks)
| Asset | Location | Use |
|-------|----------|-----|
| `blobKey(checksum, ext)` | `packages/engine/src/blobs.ts:41` | Returns `files/<cs[0:4]>/<cs>.<ext>`; throws on bad input; empty ext gives no trailing dot. Prefix with `OrgId=<org>/Period=0/` in `@orglet/archive` |
| `fileTypeFor`, `fileExtensionOf` | `packages/engine/src/filetypes.ts` (exported from engine barrel) | Derive `FileType`/`FileExtension` for seed ContentVersions exactly as the engine would |
| `toCaseSafeId` | `packages/schema/src/ids.ts:16` | `toCaseSafeId("001000000000001")` gives `001000000000001AAA` (probe-verified) |
| `formatSalesforceDatetime` | `packages/schema/src/db.ts:19` | `2026-01-10T09:00:00.000+0000`; the pg `timestamptz` type parser uses it, so Bulk output is already in this form |
| `parseCsv` / `writeCsv` | `packages/api/src/bulk/csv.ts` | NOT exported from the api barrel. For CSV parsing in the leak guard/tests either import via relative path inside the `packages/api` test (existing precedent, `bulk.test.ts`) or, preferably for scripts, write a tiny parse in `@orglet/archive` (Phase 18 needs a reader anyway) |
| `reconcileKeyPrefixes`, `migrate`, `prepareBulk`, `createApiServer`, `bootstrapOrg`, `DmlEngine`, `Store`, `loadOrgSchema` | package barrels | Boot sequence (see Code Examples); all are barrel-exported |

## Architecture Patterns

### Recommended Project Structure
```
packages/archive/                      # NEW @orglet/archive (pure, dependency-light)
├── package.json                       # copy engine's; deps: @orglet/metadata (+ @orglet/schema if used)
├── tsconfig.json                      # copy engine's; references ../metadata (+ ../schema)
└── src/
    ├── index.ts                       # one barrel, explicit named exports
    ├── keys.ts                        # csvKey(), blobObjectKey(), period segment vs int
    ├── columns.ts                     # heimdallColumns(fields), objectName(), objectMetadata()
    ├── indexsql.ts                    # CREATE TABLE text + INSERT rendering (deterministic)
    └── *.test.ts                      # unit tests for every rule + the generator determinism test
scripts/gen-archive-fixture/
├── seed.ts                            # data module: period sections, narrative comments
├── build.ts                           # buildFixture(): boots pglite/engine/app, returns Map<relPath, content>
└── generate.ts                        # CLI: gen (write) | --check (diff in memory); mirrors gen-baseline/generate.ts
examples/acme-archive/                 # GENERATED, committed
├── README.md  (generated text, part of the Map so --check covers it)
├── index.sql
└── store/OrgId=<org>/Period=202601/... and Period=202602/... and Period=0/files/...
```
`blobKey` stays in engine (D-14): `@orglet/archive` cannot import engine if it must stay below it. Either the generator composes `OrgId=<org>/Period=0/` + `blobKey(...)` itself, or `archive` takes the `files/...` string as an argument. Pick the former: the script already imports both.

### Pattern 1: Boot sequence (probe-verified, matches `packages/cli/src/main.ts:160-180` and `files.test.ts`)
```typescript
// Source: packages/cli/src/main.ts, packages/api/src/files.test.ts, verified by probe on 2026-11-07
const db = await openPgliteDb();                          // see Pitfall 6 (new always-pglite export)
const schema = (await loadOrgSchema({ projectDir: ACME })).schema;
await reconcileKeyPrefixes(db.pool, schema, { orgSchema: "org", mapping: { BigTable__c: "a00", Milestone__c: "a01", Project__c: "a02", UpsertTable__c: "a03" } });
await migrate(db.pool, schema, { orgSchema: "org" });
const boot = await bootstrapOrg(db.pool, schema, { orgSchema: "org", /* + new fixed ids / now, D-01 */ });
await prepareBulk(db.pool, "org");                         // Bulk job tables; required before POST /jobs/query
const engine = new DmlEngine(db.pool, schema, { orgSchema: "org", importMode: true });
const app = createApiServer({ engine, organizationId: boot.session.organizationId, recordTypeIds: boot.recordTypeIds });
await app.ready();
const login = await app.inject({ method: "POST", url: "/services/oauth2/token",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  payload: "grant_type=password&username=admin%40orglet.local&password=x" }); // permissive auth: any password
const H = { authorization: `Bearer ${JSON.parse(login.body).access_token}`, "content-type": "application/json" };
```
Auth: default `AuthConfig` is `permissive` (`server.ts:96`), so no password setup; the token is `${orgId}!${random}` (random, never written to output). Use the bootstrap admin username (default `admin@orglet.local`, or the fixed one passed through `options.admin`).

### Pattern 2: One Bulk query to CSV (probe-verified request/response shapes)
- `POST /services/data/v59.0/jobs/query` body `{operation:"query"|"queryAll", query, contentType:"CSV", lineEnding:"LF"}` (column delimiter defaults to COMMA). Response `200` job info with `state:"JobComplete"` already set (queries run synchronously inside the request: no polling needed in practice; still read `state` and fail on anything else; keep a bounded poll of `GET /jobs/query/{id}` to stay faithful to D-13 and tolerate a future async change).
- A refused query is NOT a `Failed` job: the POST itself returns HTTP 400 with a JSON array `[{message, errorCode}]` and no job row is left behind (`bulk.ts:355-359`). The generator maps a 400 to a `backup_runs` row with status `Failed` and `error_message` = the `errorCode` plus orglet's own message (no values in it, fine for P22). A job that does start and throws gets `state:"Failed"` with `errorMessage` `InternalServerError : ...` (`bulk.ts:385`); treat that as a generator failure, not a `Failed` backup run.
- `GET /services/data/v59.0/jobs/query/{id}/results?maxRecords=2000[&locator=<n>]`: response headers `Sforce-NumberOfRecords` and `Sforce-Locator` (offset as a decimal string; the string `"null"` ends paging). Content type `text/csv;charset=UTF-8`. Every page repeats the header row; the generator keeps the first and drops the header from later pages (`readQueryPage` + `writeCsv` per page, `bulk.ts:403-410`). Check `Sforce-NumberOfRecords` summed equals data rows.
- Empty result: body is the single string `"\n"` (no header row at all, probe-verified). The generator must treat a body with no data rows as "object returned nothing: no CSV, no `backup_runs` row" (D-05) and never write the lone newline.
- LF endings and `\n` inside quoted cells survive (probe: a Notes__c value with a newline and an embedded `"` came out RFC-4180 quoted). `writeCsv` quotes only when needed.
- The per-job `id` is `generateId("750")` (`jobs.ts:51`), i.e. time-based and random-seeded: never use it in output. Generator names files itself (Claude's discretion, recommended: `<object lowercase or as-is>-<period>-<seq>.csv`, or a fixed synthetic Bulk-looking Id like `750000000000001AAA` sequential per file so the key keeps Heimdall's `<bulkJobId>.csv` shape; recommended since it matches the documented shape and is deterministic).

### Pattern 3: Checkpoint paging for the split object (BigTable__c, D-06)
Heimdall's loop: first query has no checkpoint (use `WHERE` omitted or the epoch form), then `WHERE [IsDeleted = true AND] ((SystemModstamp = :ts AND Id > ':id') OR SystemModstamp > :ts) ORDER BY SystemModstamp ASC, Id ASC LIMIT n` using the last row of the previous CSV (its `SystemModstamp` and `Id` columns, last two columns of the header by construction) until a job returns no rows. Use a tiny `n` (for example 4 with 9 seed rows) so BigTable__c produces 3 CSVs; document in the README that real Heimdall uses 50K-200K. The datetime literal in SOQL is `2026-01-10T09:00:00.000Z` form (compile verified with a `Z` literal on an empty table); convert the CSV's `+0000` to `Z`. Use `>` on Id as a string compare: safe here because the sequential Ids are digit bodies plus `AAA` (no case-collation difference between pglite and Postgres 16).

### Anti-Patterns to Avoid
- **Relying on `/sobjects/` order for output order**: `globalDescribe` sorts with `localeCompare` (`describe.ts:globalDescribe`), which is ICU/locale dependent in principle. Sort object names yourself with code-unit comparison (`gen-baseline` uses a `codeUnit` comparator in `sources.ts`).
- **Deleting through `engine.delete` and trusting the stamp**: it stamps wall-clock time (Pitfall 2).
- **Letting the leak guard print offending values**: object and field name only.
- **Importing `test/db.ts`'s `openTestDb` in the generator**: it switches to the Docker Postgres when `ORGLET_DATABASE_URL` is set; a generator run with that variable in the environment would silently hit a different engine (Pitfall 6).
- **Writing files incrementally**: build the whole `Map<string, string | Buffer>` in memory, run the leak guard, then write; `--check` reuses the same Map.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CSV production | A CSV writer in the generator | The Bulk route's own output (`writeCsv` behind `GET .../results`) | Locked D-13; the fixture is meant to be orglet's own Bulk output |
| Case-safe Id suffix | A checksum routine | `toCaseSafeId` | Exists, exact |
| `FileType`/`FileExtension`/`Checksum` derivation | New tables | `fileTypeFor`, `fileExtensionOf`, `createHash("md5")` | Same code path as the engine's non-import insert, so the fixture agrees with what orglet would store |
| Blob key | New string builder | `blobKey()` | Validates and is the Phase 15 D-13 contract |
| Describe field order / `replicateable` | Re-reading metadata JSON | `GET .../sobjects/` and `.../sobjects/X/describe` through the app | Locked D-05/D-13 and it exercises the real surface |
| Postgres in-process | A second pglite wiring | Factor `openPgliteDb()` out of `test/db.ts` (Pitfall 6) | Includes the pglite#958 extended-protocol workaround; copying it would fork it |
| Directory diff for `--check` | A tree-diff library | The `existsSync/readFileSync` + stray scan from `scripts/gen-baseline/generate.ts:40-66` | Existing pattern, no deps |

**Key insight:** the new code is formatting rules and seed data. Anything that touches record semantics (Ids, audit fields, picklist validation, coercion) already exists and should be used through the engine.

## Heimdall format: rules the generator must implement, and ambiguities (HEIMDALL-FORMAT.md, MEDIUM: source reading, never run)

| Item | Rule (section) | Status / ambiguity for Claude's Discretion |
|------|----------------|--------------------------------------------|
| CSV key | `OrgId=<org>/Period=<yyyyMM>/Year=<yyyy>/Month=<MM>/Date=<dd>/<Object>[_deleted]/<file>.csv` (s1) | `Year/Month/Date` are the upload date; zero-padding of Month/Date is not stated in the doc. Decision: two-digit (D-11 example shows `Month=01`). Record in README. `Period` for a normal run is `yyyyMM` of the run (`202601`, `202602`). |
| `Date=` and `Period=` consistency | Period is "yyyyMM" of the backup run | Choose period-1 run on 2026-01-DD and period-2 on 2026-02-DD so key period equals the Year/Month segments; index `period` int `2601`/`2602` = YYMM (s1, s3). |
| File name | `<bulkJobId>.csv` (s1) | Doc itself says README example contradicts code; PITFALLS P23 says do not over-trust. Loader follows `csvfiles.s3path` only. Use sequential synthetic Bulk-style Ids (deterministic). |
| `_deleted` | suffix on the object folder when `queryAll` (s1, s2) | Only objects with deleted rows get a `_deleted` CSV (a `queryAll IsDeleted = true` run that returns rows). Heimdall's one `backup_runs` row per object, period and phase: write a `queryAll=true` row only when that phase ran; decision: run the deleted phase for every object that has rows in the active phase, write CSV/`backup_runs` row only if it returned rows (consistent with D-05). |
| Column rule | all describe fields in order except type `address`/`base64`, a field named `Tier`, and `Id`/`SystemModstamp`; then `SystemModstamp` (if present), then `Id` (s2) | D-13 omits the `Tier` exclusion; the doc lists it. acme has only custom `Tier__c` so it makes no difference to the fixture; implement the exact-name exclusion in `@orglet/archive` for fidelity and unit-test it. Describe type names are lowercase (`address`, `base64`) in orglet's describe output (probe-verified). |
| Datetime / booleans / nulls | Bulk output unchanged (`2026-01-15T14:30:22.000+0000`, `true/false`, empty cell for null) (s2) | Empty vs null are indistinguishable in Bulk CSV (empty). Probe: `IsDeleted` false, booleans `true/false`, dates `YYYY-MM-DD`, currency `100.5` (no trailing zeros). |
| `objects` columns | `id text, period int, version int, metadata jsonb, org_id text, csv_id int, is_deleted bool default false, object_name text, name text NOT NULL, PK(org_id, period, id, version)` (s3) | `version int` is epoch seconds: fits int4 until 2038, fine. `id` text: write the 18-char Id as in the CSV (P5/P6; Heimdall validator accepts 15 or 18). |
| `csvfiles` | `csv_id int identity PK, period int NOT NULL, s3path text NOT NULL` (s3) | No `object_name`/`org_id` columns. `GENERATED ALWAYS AS IDENTITY` vs `BY DEFAULT`: the inserts must supply `csv_id` explicitly so use `GENERATED BY DEFAULT AS IDENTITY` (an explicit value into `ALWAYS` needs `OVERRIDING SYSTEM VALUE`); also emit `ALTER TABLE ... ALTER COLUMN csv_id RESTART WITH <max+1>` or `setval` so a later insert works. Not stated in the doc: re-derive and note it in the README. |
| `backup_runs` | `run_id bigserial PK, object_name, org_id, period, status, query_all bool, started_at, completed_at, last_checkpoint_id, last_checkpoint_modstamp timestamp, records_processed, records_failed, bytes_transferred, error_message, archive_expression` (s3) | Column TYPES for most are not given in the doc (only names). Decide: `object_name text, org_id text, period int, status text, query_all boolean, started_at timestamp, completed_at timestamp, last_checkpoint_id text, last_checkpoint_modstamp timestamp, records_processed int, records_failed int, bytes_transferred bigint, error_message text, archive_expression text`. Status vocabulary is NOT documented: use `Completed` and `Failed` (D-05 uses `Failed`); record in README as an orglet choice. `timestamp` (without time zone) holding fixed UTC instants. |
| Checkpoint columns | `last_checkpoint_id`, `last_checkpoint_modstamp` | Fill with the last row of the last CSV of that run (the `(SystemModstamp, Id)` pair); NULL for `Failed` runs. Exact semantics undocumented; the loader should ignore them (state that in README). |
| `objects.metadata` | non-empty fields ending in `Id`, describe reference fields, and for ContentVersion also `Checksum, FileType, FileExtension, ContentSize, Title, PathOnClient` (s3) | Ambiguous: does "fields ending in Id" include `Id` itself and `OwnerId`, `CreatedById`? Doc says non-empty fields ending in `Id` plus describe reference fields (union), so `Id`, `OwnerId`, `CreatedById`, `LastModifiedById` ARE included; `IsDeleted` is not. Decision: include `Id` itself only if it ends in `Id` (it does); unit-test with one explicit expected JSON. Values are the CSV strings (text, not typed). Key order: CSV column order (deterministic). `jsonb` normalises key order on read, so the SQL dump may write any order; keep column order for readable diffs. |
| `objects.name` | first of Name, Subject, Title, CaseNumber, DeveloperName, Label that exists, else Id (s3) | "that the object has": ambiguity between "field exists on the object" and "value non-empty". Decision: field exists on the object AND value non-empty; if the first existing field is empty fall through to the next, finally the Id (NOT NULL must hold). Document. For objects whose Name is a compound `Name` type (Individual/Lead) the CSV has `Name`? Probe on Account showed `Name` column present; fine. |
| `objects.version` | `SystemModstamp` as epoch seconds (s2) | Floor of ms to seconds; two rows within one second for the same Id collapse (D-08: do not create ties). |
| `objects.is_deleted` | true for rows from `_deleted` CSVs (s8 consequences) | Set from the CSV phase, not from the `IsDeleted` cell (they agree for `_deleted`). |
| Same Id in both active and `_deleted` CSV of one period | Not covered | Do not create this: a record deleted in period 2 appears in `Period=202602/.../Contact_deleted/` only; its period-1 row stays in `Period=202601`. The PK `(org_id, period, id, version)` stays unique. |
| Blob key | `OrgId=<org>/Period=0/files/<cs[0:4]>/<cs>.<FileExtension>` (s1, s4) | Empty `FileExtension`: `blobKey` omits the dot; the `blobKey` doc says "must be confirmed against Heimdall in Phase 16/18". Avoid the question: give every blob a non-empty extension in the seed and note the unverified case in the README. Only ContentVersion is backed up as blobs; deleted CVs skipped. |
| Which blobs | every non-deleted ContentVersion (including `IsLatest=false` older versions) | Heimdall downloads per CV row; the old version in period 1 is a different Checksum (blob exists). Two rows sharing a Checksum map to one blob file. |
| `Period=0/files/` shared | not per period | Single copy; the README must state it. |

## Seed data design (examples/acme inventory, probe-verified)

### Objects and key prefixes
- 58 objects are `replicateable: true` in `/sobjects/`; custom acme objects and their (provisional name-order) prefixes: `BigTable__c` a00, `Milestone__c` a01, `Project__c` a02, `UpsertTable__c` a03. Pin them with `reconcileKeyPrefixes(..., {mapping})` so the fixture does not depend on the provisional rule.
- Standard prefixes needed for Ids: Account 001, Contact 003, Opportunity 006, ContentVersion 068, ContentDocument 069, ContentDocumentLink 06A, User 005, Organization 00D, Profile 00e, RecordType 012, BusinessHours 01m, UserLicense 100.
- Sequential Id shape confirmed: `toCaseSafeId("001" + "00" + "0000000001")` = `001000000000001AAA`. Because 15-char bodies are all digits after the prefix the case-safe suffix is always `AAA` for digit-only prefixes; prefixes with uppercase letters (`00D`, `06A`, `00e`) yield different suffixes: compute, never hand-write.

### acme custom fields (from the metadata XML) and what the seed must cover
| Object | Field | Type | Seed note |
|--------|-------|------|-----------|
| Account | `Customer_Number__c` | Text | set on some rows |
| Account | `Tier__c` | Picklist (global value set `Tier`, restricted) | use only values in `globalValueSets/Tier.globalValueSet-meta.xml` |
| Account | `Total_Budget__c`, `Open_Project_Milestones__c`, `Last_Active_Project_Created__c` | Summary sum/sum/max | stored columns, see roll-up pitfall |
| Account | standard `Industry` | Picklist (standard value set) | |
| Contact | `Preferred_Language__c` | Picklist | |
| Opportunity | `Weighted_Amount__c` | Currency formula (`Amount * Probability / 100`) | not writable in import mode (coerce skips formula fields); verify the stored/virtual value in the CSV after seeding (Account/Opportunity formula result must appear in the CSV: check in the generator test) |
| Project__c | `Account__c` (MasterDetail), `Manager__c` (Lookup), `Status__c` (restricted Picklist Planned/Active/Done, required), `Budget__c` (Currency), `Code__c` (Text), `Start_Date__c`/`End_Date__c` (Date), `Notes__c` (LongTextArea 32768), `Is_Overdue__c` (Checkbox formula), `Milestone_Count__c`/`Open_Milestones__c`/`Next_Due_Date__c` (Summary count/count/min) | RecordTypes `Internal`, `External` (bootstrap mints the RecordType rows; `RecordTypeId` in CSV must be the fixed ids) |
| Milestone__c | `Project__c` (MasterDetail), `Due_Date__c` (required Date), `Done__c` (Checkbox), `Sort_Order__c` (Number; probe showed an unset value came back as `1`, i.e. a default) | |
| UpsertTable__c | `ExtId__c` (Text, external id) | |
| BigTable__c | AutoNumber Name `{00000000}` | `Name` is an AutoNumber; in import mode supply `Name` explicitly (coerce `writable` excludes type `Name`/`AutoNumber`? the import-mode writable test excludes `Name` type, not AutoNumber: verify in a spike; if the engine would otherwise assign from a sequence, sequence-based AutoNumber is non-deterministic across runs only if the sequence is shared; a fresh pglite per run resets it, so it is deterministic either way) |
| standard Contact | `BuyerAttributes` | MultiselectPicklist, restricted | The only multi-picklist reachable: values must come from its picklist list (`BusinessUser`, `Buyer`, `Champion`, `DecisionMaker`, `Detractor`, ...; the probe's `A;B` was rejected with `INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST`). Use `"Buyer;Champion"` (semicolon-separated). acme itself defines no multi-picklist, so this field is the multi-picklist coverage. |
| Standard fields worth setting for type coverage | Account: `Phone`(Phone), `Website`(Url), `Description`(LongTextArea), `NumberOfEmployees`(Number), `AnnualRevenue`(Currency); Contact: `Email`, `Birthdate`(Date), `LeadSource`; Opportunity: `Amount`, `CloseDate`, `StageName`, `Probability`(Percent) | One datetime other than audit fields is optional (`LastReferencedDate` etc. are system) |

Baseline types present: Text, Picklist, MultiselectPicklist, Checkbox, Currency, Date, DateTime, Time, Number, Percent, Email, Phone, Url, TextArea, LongTextArea, Lookup, AutoNumber, Name, Address (excluded), Base64 (excluded). Cover each at least once across acme + standard fields; `Time` fields exist on BusinessHours (bootstrap-minted; leave unset).

### Bootstrap-minted rows (what `bootstrapOrg` creates, `bootstrap.ts`)
- User (Id minted at `:46`; username default `admin@orglet.local`, `Alias`, `TimeZoneSidKey`, etc.), Profile ("System Administrator", `:60`), Organization (`:61`), BusinessHours "Default" (`:98`), UserLicense "Salesforce" (`:104`), RecordType rows for every `obj.recordTypes` entry (`:119-136`: Project__c Internal and External only in acme), then `UPDATE profile SET userlicenseid` (a SQL UPDATE that does not touch SystemModstamp).
- All use `generateId(...)` and one `now = formatSalesforceDatetime(new Date())` (`bootstrap.ts:51`); `existing` check is by username, so a rerun with an existing DB reuses rows (irrelevant on a fresh pglite).
- Sessions: `bootstrapOrg` returns `session.userId/profileId/organizationId`. The seed's `CreatedById`/`OwnerId` should be the fixed admin User Id; a second User row (for ownership variety) is not needed: keep the single admin, or insert 1-2 extra User rows through the import-mode engine if period-2 "updated by someone else" is wanted (optional).
- Minimal surgical change for D-01, three additions to the existing `BootstrapOptions` interface and `generateId` call sites: `now?: string`, `ids?: { organization?: string; profile?: string; user?: string; businessHours?: string; userLicense?: string; recordTypes?: Record<string, string> }` where `recordTypes` is keyed by lower-cased `"Project__c.Internal"` (the same key `recordTypeIds` already uses, `bootstrap.ts:114`). Replace `generateId(prefixOf(x))` with `options.ids?.x ?? generateId(prefixOf(x))` and `new Date()` with `options.now ?? formatSalesforceDatetime(new Date())`. Add one unit test that fixed ids are honoured and that absent options leave behaviour unchanged (existing bootstrap tests stay green).

### Import-mode gaps the seed must fill (code-verified)
1. **ContentVersion**: `prepareVersion` (`files.ts:33-45`) deletes `VersionData` from the record, stores the blob, and `return`s before deriving anything when `importMode`. Supply in the seed: `Checksum` (md5 hex of the bytes), `ContentSize`, `ContentSizeLong`, `FileExtension`, `FileType`, `PathOnClient`, `Title`, `ContentDocumentId`, `VersionNumber`, `IsLatest`, `IsMajorVersion`, `VersionData` (base64 string). `finishVersion` (`files.ts:98-107`) then calls `blobs.put` with `checksum`/`extension` taken from `next` and returns without mirroring or linking. Probe-verified: an import-mode CV insert stored `Checksum` as supplied and left `ContentSizeLong` empty when not supplied.
2. **ContentDocument**: insert explicitly (own prefix 069, `Title`, `OwnerId`, audit fields) AND supply the mirrored fields `LatestPublishedVersionId`, `FileType`, `FileExtension`, `ContentSize`, `ContentSizeLong` (probe: they were empty). For the period-2 second version, `UPDATE` the document through `engine.update` in import mode (changes honoured, supplied `SystemModstamp` kept because `stamps = {}` in import mode, `engine.ts:526`) and flip the old version's `IsLatest` to false the same way. `mirrorDocument(client, store, version, {now, userId})` is exported and takes the stamp, but it writes LastModifiedDate only (verify it also leaves SystemModstamp deterministic) so prefer explicit seed values.
3. **Updates in import mode**: `w.next = {...old, ...changes}` with no stamps added, so the seed must include the new `SystemModstamp` and `LastModifiedDate` in every update's changes; otherwise the row keeps the old SystemModstamp and would not appear in the period-2 incremental query at all.
4. **Deletes** (see Pitfall 2): `Store.setDeleted(client, obj, ids, true, {at, by})` is exported from engine (class `Store`) and writes `isdeleted`, `lastmodifieddate`, `lastmodifiedbyid` and `systemmodstamp` with the stamp you give. Use it directly for period-2 deletes, restricted to leaf-ish records (no cascade) so no child needs handling; ContentVersion is `deletable: false` in normal mode but this bypasses the engine anyway. If the story deletes a ContentDocument, also mark its versions deleted by hand with the same stamp (the engine cascade is not run).
5. **Roll-ups** (probe-verified stale): `withRollups` returns `body()` untouched in import mode (`engine.ts:599`), so after inserting a Milestone the parent's `Milestone_Count__c` stayed `0`. Roll-up columns are stored. Plan: supply roll-up values in the seed so they are internally consistent (the real Heimdall CSV carries correct ones), and add a generator-test assertion that they equal values recomputed from the seed rows. Whether coerce accepts Summary-type fields in import mode is not confirmed (the import-mode writable test is `field.formula === undefined && type not in {Address, Name, Location}`, `coerce.ts:145`; a Summary field defined with a `rollup` property but no `formula` should pass, unverified). First task of the seed work: a 5-line spike inserting a Project with `Milestone_Count__c: 1`. If it is rejected, fall back to a post-seed SQL `UPDATE` of the roll-up columns on the stored tables with the fixed stamp, or leave roll-ups at their computed zeros and document it as a known simplification (acceptable for the loader tests, which treat them as opaque strings).
6. **Formula fields** (`Weighted_Amount__c`, `Is_Overdue__c`): `applyFormulaFields` runs for query results/inserts; formula columns are read-only in import mode. The CSV still includes them (probe: `Is_Overdue__c` printed `false`). Seed inputs must make formula inputs deterministic: `Is_Overdue__c` depends on today's date (it compares `End_Date__c` to `TODAY()`, per the XML formula start `AND(NOT(ISPICKVAL(Status__c,"Done")), NO...`): a wall-clock dependency in the OUTPUT. Read the formula in `Project__c/fields/Is_Overdue__c.field-meta.xml`; if it uses `TODAY()`/`NOW()`, either choose dates so the result is stable for decades (End_Date in 2020, or blank) or the output is time-bombed (a leak the datetime window guard will NOT catch because the cell is boolean). Flag as Pitfall 4.
7. **Defaults**: probe showed `Sort_Order__c` defaulting to `1` and `CurrencyIsoCode`, `Status__c` default `Planned`: defaults are applied in import mode too (`defaults()` before changes). Supply values explicitly where the story needs them.

## Common Pitfalls

### Pitfall 1: `tsx` cannot resolve `@orglet/*` from `scripts/`; wrong Node on the shell
**What goes wrong:** `tsx scripts/...` fails with module-not-found for `@orglet/engine`, or crashes with `E.toReversed is not a function`.
**Why:** Root `node_modules` has no `@orglet` links and root `tsconfig.json` has no `paths`; `tsconfig.test.json` has `"@orglet/*": ["./packages/*/src/index.ts"]`. `gen-baseline` only imports types, so it never hit this. The default `node` in this environment is 18.20.8 (nvm); `.nvmrc` pins 22 and `tsx` 4.23 needs it.
**How to avoid:** root scripts `"archive-fixture:gen": "tsx --tsconfig tsconfig.test.json scripts/gen-archive-fixture/generate.ts"` (the env-var form `TSX_TSCONFIG_PATH=tsconfig.test.json tsx ...` is what was probe-verified; verify the `--tsconfig` flag form in the first task, and fall back to `cross-env`-free env prefix, which is fine on macOS/Linux/CI). Executor runs everything under Node 22 (`nvm use` or prepend `~/.nvm/versions/node/v22.23.3/bin`). `pnpm` itself obeys `engine-strict`.
**Warning signs:** `ERR_MODULE_NOT_FOUND`, `toReversed`.

### Pitfall 2: Wall-clock stamps in delete (and bootstrap, events)
**What goes wrong:** deleted rows carry `SystemModstamp = now`, making the `_deleted` CSV and `objects.version` differ per run.
**Why:** `deleteBatch` builds `stamp = {at: formatSalesforceDatetime(new Date()), ...}` (`engine.ts:942`) regardless of import mode; `undeleteBatch` likewise (`:955`); `eventsFor` stamps events (`:379`, never persisted); `bootstrap.ts:51` uses `new Date()`.
**How to avoid:** `Store.setDeleted` with the seed's fixed stamp for deletes; `BootstrapOptions.now`; the leak guard's datetime-window check catches any miss. `ChangeBus` events are not persisted: ignore.

### Pitfall 3: Datetime window guard needs generous but exact bounds
The guard (D-04) checks every datetime cell in `[period window]`. Audit fields of period-1 rows lie in January, period-2 changes in February. Define the window per CSV as `[first seed instant, period run instant]`; bootstrap rows use the fixed `now` (before period 1's run). Do not apply the window to Date-only cells. Only flag cells matching `^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+0000$`.

### Pitfall 4: Formula output that depends on the real date
`Is_Overdue__c` and any `TODAY()`-based formula evaluates at query time, so the committed CSV changes the day an `End_Date__c` passes. Read the formula text first and choose seed dates that make the result fixed (far past or blank end dates), or accept and document. The datetime guard will not see a boolean. Add a test that re-runs the generator with `Date`/`Date.now` faked to a different year (`vi.useFakeTimers` + `vi.setSystemTime`) and still gets identical bytes: that catches every wall-clock dependency at once, including formulas. Caveat: fake timers can interfere with pglite/socket timers: use `vi.useFakeTimers({ toFake: ["Date"] })` so only `Date` is faked.

### Pitfall 5: Non-determinism sources checklist (all confirmed in code)
| Source | Where | Neutralised by |
|--------|-------|----------------|
| `generateId` (time + random-seeded counter) | `ids.ts:88-104`; engine insert when no Id supplied; `eventsFor` (`0e1` key); `newJobId` (`750`); `finishVersion` auto-link; `prepareVersion` doc Id | Seed supplies every `Id` incl. ContentDocument; job Ids and event keys never reach output; generator names CSV files itself |
| `new Date()` in bootstrap, delete/undelete, `saveBatch` `now` (overridden by supplied audit in import mode), `seed.ts:198` custom metadata seed | listed lines | `BootstrapOptions.now`; fixed stamps in seed; `setDeleted`; acme has no custom metadata records (`seedCustomMetadata` not called by the generator) |
| Bulk job `created_date`/`system_modstamp` (`now()` in `_orglet`) | `bulk/schema.ts` | Not in CSVs; the generator never writes job info |
| Session token `randomBytes` | `auth.ts` | Not in output |
| pglite identity values | `csv_id` etc. are assigned by the generator's own counters, not DB sequences | Index rows are rendered from in-memory records, never selected back from a live DB |
| Object/field order | `globalDescribe` `localeCompare`; describe `fields` order = schema build order (deterministic: baseline JSON order then custom) | Sort object names by code unit; field order is taken as is |
| Row order | `ORDER BY SystemModstamp ASC, Id ASC` | Total order if Ids are unique |
| AutoNumber | sequences per fresh pglite DB | Fresh DB per run restarts at 1; seed insert order fixed |
| Map/Set/`Object.keys` iteration | JS preserves insertion order; the leak-guard set is only read | Render index rows sorted by primary key explicitly |
| File system | listing order of `readdirSync` | `--check` stray scan sorts |
| Line endings / trailing newline | Bulk `LF`; generator writes `index.sql`/README with `\n` | `.editorconfig` has `lf`; write explicit strings |
| Binary blobs | Buffers from fixed bytes | Use `Buffer.from([...])`, never random |

### Pitfall 6: `openTestDb()` honours `ORGLET_DATABASE_URL`
`test/db.ts:67` switches to a real Postgres when that env var is set. A developer or CI with it set would run the generator on a different engine and, worse, write seed rows into the dev DB. Resolution (surgical): extract the pglite branch (`PGlite.create`, `PGLiteSocketServer`, the #958 filter) into an exported `openPgliteDb(): Promise<TestDb>` in `test/db.ts`, have `openTestDb` call it, and import it from the generator (`../../test/db.js`; precedent: `packages/api/src/*.test.ts` import `../../../test/db.js`; `tsconfig.test.json` includes `test/**/*.ts`). The vitest determinism test should also call `openPgliteDb()` so it is independent of the env var.

### Pitfall 7: pglite parallelism and shutdown
Each `openPgliteDb()` is its own in-memory instance and takes ~1-2 s. Close in order: `await app.close()` then `db.close()` (the existing `close` waits for socket detach, see its comment). Two generator runs inside one vitest test are sequential; total expected ~5-10 s, inside `testTimeout: 30_000` (give the test an explicit longer timeout, e.g. 60_000, because of CI variance).

### Pitfall 8: ContentDocumentLink in the backup
`replicateable` includes it, query 400s: record the `Failed` run. Honest-reporting note: real Heimdall behaviour for a refused object (a `Failed` row vs skipped) is not documented; the README must say the `Failed` row is orglet's choice and Phase 18 must tolerate it. Do not try to back up ContentDocumentLink via a filtered query: a link-less backup is the stated fixture story (D-05, D-16 of Phase 15).

### Pitfall 9: Describe includes columns the loader may not know
The describe-driven column list for ContentVersion includes `VersionDataUrl`, `ContentUrl`, `TextPreview` etc. (48 columns probe-verified). They appear in the CSV as empty cells. That is faithful to Heimdall (all non-excluded describe fields). Standard-object columns the retrieve (the acme SFDX project) does not model do not matter for orglet's own baseline: the baseline defines them. Do not trim the column list to "fields that have data".

### Pitfall 10: Lockfile and workspace
Adding `packages/archive` changes `pnpm-lock.yaml` importers (CI uses `--frozen-lockfile`). Run `pnpm install` (ask Johan: installs are in the "ask first" class per global CLAUDE.md, although this one is workspace-link only) and commit the lockfile diff.

## Package wiring checklist for `packages/archive` (all verified against the files)
1. `packages/archive/package.json`: copy `packages/engine/package.json` shape (`name @orglet/archive`, `type module`, `exports "."` types/import to `./dist/index.*`, `files: ["dist"]`, `scripts.build: "tsc -b"`, `dependencies` `@orglet/metadata: workspace:*` and only what is used).
2. `packages/archive/tsconfig.json`: copy engine's (`extends ../../tsconfig.base.json`, `rootDir src`, `outDir dist`, `include src`, `exclude src/**/*.test.ts`, `references ../metadata` etc.).
3. Root `tsconfig.json`: add `{ "path": "packages/archive" }` to `references` (position anywhere after its dependencies; `tsc -b` orders by references).
4. `vitest.config.ts`: add `"archive"` to the alias name list (line 10 array).
5. `tsconfig.test.json`: no edit needed (wildcard `@orglet/*` path, and `include` already covers `packages/*/src/**/*.test.ts` and `scripts/**/*.ts`).
6. `eslint.config.js`: no edit needed (`project: ["./packages/*/tsconfig.json", "./tsconfig.test.json"]` globs). `examples/**` is already ignored by lint, so the generated `examples/acme-archive` is never linted.
7. `pnpm-workspace.yaml`: `packages/*` already covers it.
8. Add the root scripts `archive-fixture:gen` / `archive-fixture:check` to `package.json` next to `baseline:*`.
9. Does the new package need `@orglet/schema`? Not if `archive` only takes plain data (field descriptors) and strings. Prefer depending on `metadata` types only (`FieldDef`), and keep `toCaseSafeId` etc. in the script.
10. The generator imports `@orglet/api`, `@orglet/engine` etc. at runtime, which means `tsconfig.scripts.json` (extends `tsconfig.test.json` with `include scripts/**/*.ts`) type-checks it through the path aliases; `pnpm typecheck:scripts` must stay green (CI runs it).
11. `.gitignore`: nothing (the fixture must be committed). Check `.gitattributes`/`.editorconfig`: CSV with `\n` embedded and `.csv` files must not get LF-to-CRLF conversion; add `examples/acme-archive/** -text` to `.gitattributes` if one exists, and a binary blob file requires `-text` regardless (check `git config core.autocrlf` is irrelevant on the CI Linux runner, but byte-identical expectation on contributors' Windows is a README note).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.7 (root `vitest.config.ts`, `environment: node`, `testTimeout 30_000`, `hookTimeout 60_000`) |
| Config file | `/Users/johankarlsteen/Development.nosync/local-salesforce/vitest.config.ts` (add `archive` to aliases) |
| Quick run command | `pnpm vitest run packages/archive` (run under Node 22) |
| Full suite command | `pnpm test` (plus `pnpm lint`, `pnpm typecheck:scripts`, `pnpm build`) |
| Fixture gate (new) | `pnpm archive-fixture:check` (exit 1 on any difference) |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FIX-01 (SC1) | Key layout: two periods, `_deleted` folder, `Period=0/files/<cs[0:4]>/<cs>.<ext>`; period segment `202601`/`202602` vs index int `2601`/`2602` | unit | `pnpm vitest run packages/archive/src/keys.test.ts` | Wave 0 |
| FIX-01 (SC1) | Column order rule: describe order minus address/base64/`Tier`/`Id`/`SystemModstamp`, then `SystemModstamp`, then `Id` | unit | `pnpm vitest run packages/archive/src/columns.test.ts` | Wave 0 |
| FIX-01 (SC1) | `objects.name` fallback chain; `objects.metadata` rule incl. ContentVersion extras | unit | same file | Wave 0 |
| FIX-01 (SC1) | Generated tree matches committed `examples/acme-archive` | integration | `pnpm archive-fixture:check` and `pnpm vitest run packages/archive/src/fixture.test.ts` | Wave 0 |
| FIX-01 (SC2) | Index dump contains the three tables with the documented columns; loads and queries on pglite; `csv_id` joins resolve to existing files; every `objects` row's Id appears in its CSV | integration | `fixture.test.ts` (loads `index.sql` into a fresh pglite from the committed fixture, independent of the generator code path for reading) | Wave 0 |
| FIX-01 (SC2/D-06/D-07) | Story assertions: BigTable__c has 2+ CSVs in a period; a `_deleted` CSV with a record active in period 1; ContentVersion second version (`VersionNumber` 2, `IsLatest`), two CVs share a Checksum and one blob key; one blob is non-UTF-8; ContentDocumentLink `Failed` run, no CSV | integration | `fixture.test.ts` | Wave 0 |
| FIX-01 (SC3) | Two runs into temp dirs are byte-identical (file set and contents); also identical under a faked different system date | integration | `fixture.test.ts` (calls `buildFixture()` twice, writes to `mkdtemp` dirs, compares sorted `readdir` trees and `Buffer.equals`) | Wave 0 |
| FIX-01 (SC3) | Every blob's MD5 equals its ContentVersion `Checksum` (parse the CV CSV, recompute from the file at the key) | integration | `fixture.test.ts` | Wave 0 |
| FIX-01 (D-04) | Leak guard aborts naming object and field only, never a value | unit | `pnpm vitest run packages/archive/src/guard.test.ts` or inside fixture test with a poisoned input | Wave 0 |
| D-01 | `bootstrapOrg` honours fixed ids/`now`; unchanged when absent | unit | `pnpm vitest run packages/engine/src/bootstrap.test.ts` (extend existing if present) | check |

Place the generator-facing test under `packages/archive/src/` (vitest's include glob does not cover `scripts/`), importing `buildFixture` from `../../../scripts/gen-archive-fixture/build.js` (type-checked via `tsconfig.test.json`; the package's own `tsconfig.json` excludes `*.test.ts` so the build does not drag `scripts/` into `rootDir`). Note: `packages/archive/tsconfig.json` has `rootDir: src`; a test importing outside is only compiled by vitest/tsconfig.test.json, never by `tsc -b`, which excludes tests.

### Sampling Rate
- **Per task commit:** `pnpm vitest run packages/archive` (pure-function tests, a few seconds) and, once the seed exists, `pnpm archive-fixture:check`.
- **Per wave merge:** `pnpm build && pnpm lint && pnpm typecheck:scripts && pnpm test`.
- **Phase gate:** full suite green, `pnpm archive-fixture:check` exits 0, `git status` clean after `pnpm archive-fixture:gen` (committed output equals regenerated output), Node 22.

### Wave 0 Gaps
- [ ] `packages/archive/` (package.json, tsconfig.json, src/index.ts) and root wiring (tsconfig reference, vitest alias)
- [ ] `test/db.ts`: export `openPgliteDb()` (Pitfall 6)
- [ ] `packages/archive/src/{keys,columns,indexsql}.test.ts` for the pure rules
- [ ] `packages/archive/src/fixture.test.ts` (determinism, MD5, structure, index load)
- [ ] `BootstrapOptions` extension + test
- [ ] Spike: tsx `--tsconfig` flag form; Summary field acceptance in import mode; AutoNumber `Name` behaviour in import mode; `Is_Overdue__c` formula inputs
- [ ] Independent index expectation: the test must not recompute expected `csvfiles`/`objects` rows with the same `@orglet/archive` function the generator used (circularity, P23/D-09): assert against hand-written expected values for a handful of rows (period ints, one `metadata` JSON, one `name`, one key string) and against structural invariants of the committed files (every `s3path` exists; every `objects.id` occurs in its CSV; counts per CSV equal data rows).

## Code Examples

### Fixed-Id helper (D-02)
```typescript
// Source: probe 2026-11-07; toCaseSafeId from packages/schema/src/ids.ts:16
const next = new Map<string, number>();
export function fixtureId(prefix: string): string {
  const n = (next.get(prefix) ?? 0) + 1;
  next.set(prefix, n);
  return toCaseSafeId(`${prefix}00${String(n).padStart(10, "0")}`); // 3 + 2 + 10 = 15 chars
}
// Allocation set for the leak guard: collect every returned Id in a Set<string>.
```
Keep the counter inside `buildFixture` (not module-level) so two runs in one process start fresh: a module-level counter would make the second run's Ids differ and silently break the determinism test in-process.

### Import-mode insert (probe-verified with supplied audit fields)
```typescript
// Source: probe; engine.ts import-mode path (engine.ts:518-520 keeps supplied audit values)
const sys = { IsDeleted: false, CreatedDate: T, CreatedById: admin, LastModifiedDate: T, LastModifiedById: admin, SystemModstamp: T };
const r = await engine.insert(session, "Project__c", [{ Id: id, Name: "Website relaunch", Account__c: acct, Status__c: "Active", ...sys }]);
if (!r[0]?.success) throw new Error(`seed insert failed for Project__c row ${i}: ${r[0]?.errors[0]?.statusCode}`); // statusCode only, no values
```
Check every `SaveResult.success`; the probe showed a restricted-picklist failure comes back as `success:false` and not an exception, so unchecked seed inserts would silently drop rows.

### Import-mode blob insert
```typescript
// Source: files.ts:33-107 (import mode returns before deriving), blobs.ts:41, probe
const bytes = Buffer.from("Acme onboarding notes\n", "utf8");
const checksum = createHash("md5").update(bytes).digest("hex");
const ext = fileExtensionOf("notes.txt");               // "txt"
await engine.insert(session, "ContentVersion", [{
  Id: cvId, ContentDocumentId: docId, Title: "Onboarding notes", PathOnClient: "notes.txt",
  VersionData: bytes.toString("base64"), VersionNumber: "1", IsLatest: true, IsMajorVersion: true,
  Checksum: checksum, ContentSize: bytes.length, ContentSizeLong: bytes.length,
  FileExtension: ext, FileType: fileTypeFor(ext), ...sys,
}]);
```
The generator keeps its own map `cvId -> bytes` (the seed) to write `Period=0/files/...` files: do NOT read blobs back through the app (keeps the writer independent and fast); then assert `md5(bytes) === Checksum column in the CSV`. The deduped blob: two CVs with identical `bytes` have the same `Checksum` and one file.

### Delete with fixed stamp
```typescript
// Source: engine.ts:90 Store.setDeleted signature (stamp {at, by}); exported via @orglet/engine
const store = new Store(schema, "org");
const client = await pool.connect();
try { await store.setDeleted(client, schema.getObject("Contact")!, [contactId], true, { at: T2_DELETE, by: admin }); }
finally { client.release(); }
```
Verify with the `queryAll ... WHERE IsDeleted = true` job that the row appears and a plain `query` omits it (the probe confirmed the `queryAll`/`IsDeleted = true` SOQL compiles).

### `--check` (mirror of `gen-baseline`)
Compare the in-memory `Map<relPath, string | Buffer>` with the tree under `examples/acme-archive/`: `missing:`, `differs:` (use `Buffer.compare`, not utf8 string equality, for blobs), `stray (not generated):` from a sorted recursive directory scan; exit 1 with a regenerate hint, print counts, never print contents.

## State of the Art

| Old / assumed | Actual in this repo (verified) | Impact |
|---------------|-------------------------------|--------|
| P23 proposed a seeded `IdGenerator`/injectable clock in engine | D-01 chose import mode plus `BootstrapOptions` | The only engine change is the bootstrap options bag; but import mode has the gaps above |
| CONTEXT: "`finishVersion` still ... computes `Checksum`/`ContentSize`" | `prepareVersion` returns before deriving in import mode; `finishVersion` only stores bytes | Seed must supply Checksum etc. |
| CONTEXT/D-13: "polls to `JobComplete`" | Query jobs are complete when `POST /jobs/query` returns | Polling loop is trivially one call; keep it for fidelity |
| CONTEXT: refused object gets a `Failed` backup run | Refusal is HTTP 400 at creation, no job | Map the 400 to the run row |
| `engine.delete` for the deleted story | stamps wall clock | Use `Store.setDeleted` |

## Open Questions

1. **Are Summary (roll-up) fields writable in import mode?**
   - Known: columns are stored; import mode skips recompute; supplied values untested.
   - Recommendation: 5-line spike first; fallback SQL `UPDATE` post-seed or accept zeros and document.
2. **`Is_Overdue__c` formula and `TODAY()`**
   - Known: formula text starts `AND(NOT(ISPICKVAL(Status__c, "Done")), NO...` (truncated in my read; likely `NOT(ISBLANK(End_Date__c))` and `End_Date__c < TODAY()`).
   - Recommendation: read the XML in the seed task; pick dates giving a stable value; the faked-`Date` test proves it.
3. **`backup_runs` status vocabulary and column types, `csv_id` identity flavour, `Month=`/`Date=` zero padding, blob extension empty case**
   - Not specified by HEIMDALL-FORMAT.md; decisions above are orglet choices to be recorded in the README as "documented shape, orglet's re-derivation". Phase 18's loader reads only `csvfiles.s3path`, `objects.*`, and `backup_runs` for diagnostics.
4. **Does a `queryAll` job with `IsDeleted = true` plus checkpoint return only deleted rows with non-empty data?**
   - Compiles and returns an empty body on an empty table. Verify with real deleted rows in the first generator test.
5. **`Tier` exclusion**: the doc lists it, D-13 does not. Include it (no effect on acme).
6. **AutoNumber `Name` on BigTable__c in import mode**: supply `Name` explicitly or rely on the sequence? Spike; either is deterministic on a fresh DB.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 22 | tsx, vitest, pglite-socket (needs Node 19+ `CustomEvent`) | yes, but NOT the default `node` | 22.23.3 at `~/.nvm/versions/node/v22.23.3/bin` (default on PATH is 18.20.8) | none: executor must select Node 22 (`nvm use`) |
| pnpm 12.x (packageManager pin) | install/scripts | assumed (not probed; `pnpm` runs repo scripts today) | pin `pnpm@12.6.0` | none |
| pglite 0.5.8 / pglite-socket 0.2.11 | generator DB | yes (root devDeps; probe ran) | 0.5.8 / 0.2.11 | none needed |
| tsx 4.23.15 | running the script | yes (`node_modules/.bin/tsx`) | 4.23.15 | none |
| Docker / Postgres 16 | NOT used by the generator (D-12); only optional for running `index.sql` against real Postgres 16 | not checked | n/a | `ORGLET_DATABASE_URL` Docker path is optional validation of D-09 (index.sql on PG 16); pglite is the required path |

**Missing dependencies with no fallback:** none (Node 22 exists; it just must be selected).

## Sources

### Primary (HIGH confidence): repository code read and exercised in-process on 2026-11-07
- `packages/engine/src/bootstrap.ts` (whole), `engine.ts` (`:40-54`, `:120-170`, `:240-275`, `:370-385`, `:495-590`, `:905-995`), `files.ts` (whole), `blobs.ts` (whole), `filetypes.ts`, `store.ts:90`
- `packages/schema/src/ids.ts` (whole), `db.ts:14-24`
- `packages/api/src/routes/bulk.ts` (whole), `bulk/jobs.ts`, `bulk/csv.ts`, `bulk/soql-rules.ts`, `server.ts` (whole), `auth.ts`, `describe.ts` (`objectSummary`, `globalDescribe`, `objectDescribe`), `index.ts`
- `test/db.ts`, `vitest.config.ts`, `tsconfig.json`, `tsconfig.test.json`, `tsconfig.scripts.json`, `eslint.config.js`, `package.json`, `packages/{engine,api}/{package,tsconfig}.json`, `scripts/gen-baseline/generate.ts`, `.github/workflows/ci.yml`
- `examples/acme/**` object and field XML; `packages/metadata/standard/objects/*.json` (54 baseline objects, field type census, Contact.BuyerAttributes)
- Probes (deleted after use): boot sequence, 58-object Heimdall-style query sweep, seed insert probe with Account/Project/Milestone/ContentDocument/ContentVersion/Contact, CSV output of Bulk results

### Secondary (MEDIUM)
- `.planning/research/HEIMDALL-FORMAT.md` (source reading of the Heimdall repo, never run; not re-fetched, per the licence constraint)
- `.planning/research/PITFALLS.md` P22-P24

### Tertiary (LOW)
- Behaviour of Summary fields in import mode, the `Is_Overdue__c` formula body, `AutoNumber` in import mode: inferred from code reading, not run.

## Metadata

**Confidence breakdown:**
- Standard stack / wiring: HIGH (read, and the full boot ran)
- Architecture (script split, test placement): HIGH
- Import-mode gaps and determinism hazards: HIGH (code-cited; two probe-confirmed: stale roll-ups, missing mirror/size fields)
- Heimdall specifics (status vocabulary, column types, padding, `Tier`, checkpoint semantics): MEDIUM/LOW (doc silent; orglet decisions flagged)
- Seed/roll-up/formula interplay: MEDIUM (spikes listed)

**Research date:** 2026-11-07
**Valid until:** 30 days (internal code; re-check if Phase 17 changes `blobs.ts`, `test/db.ts` or the Bulk routes before planning executes)
