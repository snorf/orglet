# Phase 16: Archive Fixture Generator - Context

**Gathered:** 2026-11-07
**Status:** Ready for planning

<domain>
## Phase Boundary

One deterministic script under `scripts/` boots orglet on `examples/acme` with a fixed clock, runs
Bulk 2.0 query per object in Heimdall's field order, and writes `examples/acme-archive/`: the S3 key
layout with two periods and `_deleted` folders, `Period=0/files/` blobs for the fixture's
ContentVersions, and a dump of the `objects`/`csvfiles`/`backup_runs` index. A re-run produces
identical bytes and each blob's MD5 equals its ContentVersion `Checksum` (FIX-01).

Out of scope, already placed elsewhere: the CI regenerate-and-diff job (FIX-02, v2), the hand-written
adversarial CSV set (FIX-03, v2), the archive loader that reads the fixture (Phase 18), the
read-only mode and stub-row policy for archive orgs (Phase 17, Phase 15 D-03), and any S3 or
filesystem object store (Phase 17/18).

</domain>

<decisions>
## Implementation Decisions

### Determinism seam (Ids and clock)
- **D-01:** The generator runs `DmlEngine` in import mode (`EngineOptions.importMode`) and supplies
  every record `Id`, `CreatedDate`, `CreatedById`, `LastModifiedDate`, `LastModifiedById` and
  `SystemModstamp` itself, which import mode already honours (`engine.ts` keeps supplied audit values
  and skips `placeVersion`, so the generator also supplies `ContentDocument` rows and
  `ContentDocumentId`). `generateId` and the module-level clock in `packages/schema/src/ids.ts` are
  not changed. The only engine/schema change is a surgical options bag on `bootstrapOrg`
  (`BootstrapOptions`) that accepts fixed Ids for the rows it mints (Organization, Profile, User,
  BusinessHours, UserLicense, RecordType per developer name) and a fixed `now`; when absent,
  behaviour is unchanged. No process-global seed, no injected `IdGenerator`/`Clock` interfaces.
- **D-02:** Fixture record Ids are sequential per key prefix from a fixed base: prefix + `00` +
  a zero-padded counter in the 10-character body (for example `001000000000001` + case-safe
  suffix via `toCaseSafeId`), allocated in seed order. Readable in diffs, and Id order follows
  insert order as Heimdall's `ORDER BY SystemModstamp ASC, Id ASC` expects. Not hash-derived.
- **D-03:** Timestamps are explicit in the seed data: each seed record states when it was created
  and, for period-2 changes, when it was modified or deleted. The generator has one fixed wall-clock
  instant per period that fills the `Year=/Month=/Date=` key segments, `backup_runs.started_at` /
  `completed_at` and the checkpoint columns.
- **D-04:** A leak guard runs before any file is written: every Id appearing in the Bulk output
  (own `Id` and every reference column) must belong to the generator's allocation set, and every
  datetime cell must fall inside the period's fixed window; a violation aborts with the object and
  field name only, never a cell value. In addition a vitest test runs the generator twice into
  temporary directories and compares the trees byte for byte (success criterion 3).

### Fixture content
- **D-05:** Object selection mirrors Heimdall: the generator lists `/services/data/vXX.X/sobjects/`,
  queries every object with `replicateable: true`, and writes a CSV plus `backup_runs` row only for
  objects that return rows. An object whose query is refused (ContentDocumentLink: the Phase 15
  mandatory-filter rule answers `MALFORMED_QUERY` for an unfiltered query, as a real org does) gets
  a `backup_runs` row with status `Failed` and the error message, no CSV. Bootstrap objects (User,
  Organization, Profile, RecordType, BusinessHours, UserLicense) are therefore in the backup, so
  Phase 18 has User rows to resolve `OwnerId`/`CreatedById` against.
- **D-06:** Volume: roughly 5-20 seed rows per acme object (Account, Contact, Opportunity,
  Project__c, Milestone__c, UpsertTable__c, ContentVersion with ContentDocument), readable in a PR
  diff. `BigTable__c` gets more rows and its query is split into two Bulk jobs per period through
  Heimdall's `LIMIT` plus `(SystemModstamp, Id)` checkpoint, so one object has two CSVs in a period
  and Phase 18 must follow `objects.csv_id -> csvfiles.s3path` rather than assume one file per
  object. Repo growth stays in the hundreds of kilobytes.
- **D-07:** Period 1 is a full snapshot. Period 2 is an increment containing: updated records (same
  Id, later `SystemModstamp`, so Phase 18 must pick the latest version), deleted records (written
  through `queryAll ... IsDeleted = true` into `<Object>_deleted/`, at least one of which was active
  in period 1), a second version of one ContentVersion (`IsLatest` moves, `VersionNumber` "2", the
  ContentDocument mirror follows), two distinct ContentVersion rows sharing one `Checksum` so one
  blob key is shared (Heimdall's dedup), and one binary blob with non-UTF-8 bytes. Blobs are tiny
  and generated from text or bytes in the seed; no files from the internet.
- **D-08:** Not included: records first created in period 2, a same-second version tie across
  periods, and an `Archive-yyyyMM` run (negative index period). Two normal periods only, as the
  roadmap states; tie and archive-period cases belong to FIX-03 or Phase 18 unit tests.

### Index dump
- **D-09:** The index is one SQL file, `examples/acme-archive/index.sql`, containing `CREATE TABLE`
  for `csvfiles`, `objects` and `backup_runs` followed by `INSERT` statements in a deterministic
  order (table order fixed; rows ordered by primary key). It runs unchanged on Postgres 16 and
  pglite, so Phase 18 tests load it into an empty schema and point the loader at that connection
  URL exactly as at a real Heimdall database. No JSON or CSV form of the index.
- **D-10:** The DDL carries the full documented column set of the three tables
  (`.planning/research/HEIMDALL-FORMAT.md` §3), re-derived from the documentation; no SQL is
  copied from the Heimdall repository (PITFALLS P24). `object_stats` and `restore_log` are not
  written. `objects.metadata` follows Heimdall's rule (non-empty fields ending in `Id`, describe
  reference fields, and for ContentVersion also `Checksum`, `FileType`, `FileExtension`,
  `ContentSize`, `Title`, `PathOnClient`); `objects.name` is the first of Name, Subject, Title,
  CaseNumber, DeveloperName, Label that the object has, else the Id; `objects.version` is
  `SystemModstamp` as epoch seconds; `period` is YYMM as an int (`2601`, `2602`) while the S3 key
  segment is `Period=202601` / `Period=202602`.
- **D-11:** Layout: `examples/acme-archive/store/` mirrors the bucket root
  (`OrgId=<org>/Period=202601/Year=2026/Month=01/Date=<dd>/<Object>[_deleted]/<file>.csv` and
  `OrgId=<org>/Period=0/files/<cs[0:4]>/<cs>.<ext>` built with the existing `blobKey`), with
  `index.sql` and a `README.md` beside `store/`. `csvfiles.s3path` is the bare key without any
  `s3://bucket/` prefix, as Heimdall writes it. The README describes the layout, the two periods'
  story and how to regenerate.

### Generator mechanics
- **D-12:** The generator boots against in-process pglite (the `test/db.ts` pattern, a throwaway
  database per run), never Docker Postgres. It lives under `scripts/gen-archive-fixture/`, runs with
  `tsx` and is type-checked by `tsconfig.scripts.json`, like `scripts/gen-baseline`.
- **D-13:** CSVs come from real Bulk 2.0 query jobs: the generator builds the app with
  `createApiServer` and drives `POST /jobs/query` (operation `query` or `queryAll`, `lineEnding`
  `LF`, comma delimiter), polls to `JobComplete`, and pages `GET /jobs/query/{id}/results` with
  `maxRecords=2000` and `Sforce-Locator` through `app.inject`, concatenating pages with one header
  as Heimdall does. The SOQL per object uses Heimdall's column rule (every describe field in
  describe order minus `address`, `base64`, `Id` and `SystemModstamp`; then `SystemModstamp`, then
  `Id` last; no relationship columns) and Heimdall's `WHERE`/`ORDER BY`/`LIMIT` form with the
  `(SystemModstamp, Id)` checkpoint. Seed rows are written through `DmlEngine` directly, not HTTP.
- **D-14:** A new package `packages/archive` (`@orglet/archive`) is created in this phase holding
  only pure, dependency-free Heimdall-format helpers and the index DDL: CSV key builder, blob key
  reuse (`blobKey` stays in engine), period formatting (`yyyyMM` key segment versus YYMM int),
  `objects.metadata` and `objects.name` rules, column-order rule, index `CREATE TABLE` text. It
  depends on `metadata` (for `FieldDef`/`SObjectDef`) and `schema` at most, never on `api`. The
  generator script imports from it; Phase 18's loader joins the same package so writer and reader
  cannot drift (PITFALLS P23). Root `tsconfig.json`, `vitest.config.ts`, `tsconfig.test.json`
  aliases and `eslint.config.js` are extended for the new package.
- **D-15:** Root scripts `archive-fixture:gen` and `archive-fixture:check`. `--check` regenerates in
  memory and exits 1 listing every differing, missing or stray file under `examples/acme-archive/`,
  mirroring `baseline:check`. Wiring it into CI stays FIX-02 (v2) and is not done here.

### Claude's Discretion
- The seed data module's shape (one TypeScript module with period sections is the expected form),
  the fixed wall-clock dates per period, the fixed Organization Id that becomes `OrgId=` in keys,
  and the realistic-looking names of bootstrap rows.
- How Bulk job Ids are made deterministic for the `<bulkJobId>.csv` file names (the generator may
  name files itself; PITFALLS P23 says not to over-trust Heimdall's naming) as long as
  `csvfiles.s3path` is the only path the loader follows.
- Exact `BootstrapOptions` field names for D-01 and how RecordType Ids are keyed.
- Which seed field values exercise multi-picklists, `+0000` datetimes, empty-versus-null, formula
  and roll-up columns (Heimdall includes calculated fields), as long as every acme field type
  appears at least once.
- Whether `backup_runs.records_processed`/`bytes_transferred` are exact counts (preferred) or
  omitted as NULL where the documented semantics are unclear.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Heimdall format and archive research
- `.planning/research/HEIMDALL-FORMAT.md` — storage layout (§1), CSV record format and column
  order rule (§2), index DDL and `metadata`/`name` rules (§3), blob keys and dedup (§4), fixtures
  gap (§8), consequences for the loader. Line-number citations are from source reading, not a run.
- `.planning/research/PITFALLS.md` — P23 (fixture determinism and circularity), P22 (Level 1 data
  rule: value-free diagnostics), P24 (licence: re-derive, never copy Heimdall SQL), P5/P6 (period
  formats, 15/18-char Ids).
- `.planning/research/SUMMARY.md` — recommended fixture shape (item 6 under architecture) and
  Phase B description; D-08 above narrows it to two normal periods.

### Requirements and roadmap
- `.planning/REQUIREMENTS.md` — FIX-01 (this phase), FIX-02 and FIX-03 (v2, out of scope),
  LOAD-01..LOAD-07 and ACC3-01 (consumers of the fixture; the fixture must let them be met).
- `.planning/ROADMAP.md` — Phase 16 goal, success criteria and notes; Phase 18 success criterion 1
  (loading `examples/acme-archive` twice gives identical tables).

### Prior phase decisions carried forward
- `.planning/phases/15-files-model/15-CONTEXT.md` — D-03 (archive ContentDocument policy deferred
  to Phase 17), D-07 (MD5 verification and 404 for a missing blob), D-09 (FileType table),
  D-12 (version bookkeeping), D-13 (`blobKey` validation rules), D-16 (ContentDocumentLink
  mandatory filter).
- `.planning/phases/11-custom-metadata-custom-settings-labels/11-CONTEXT.md` D-01 — derived Ids
  precedent (`deriveCustomMetadataId`); this phase chose sequential Ids instead (D-02).
- `.planning/phases/09-baseline-generator-parity-ownerid-narrowing/09-CONTEXT.md` — the
  generator/`--check` drift-gate pattern this phase mirrors (D-15).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/engine/src/blobs.ts`: `blobKey(checksum, extension)` validates and builds
  `files/<cs[0:4]>/<cs>.<ext>`; `InlineBlobStore` holds the fixture's bytes during generation.
- `packages/engine/src/filetypes.ts`: `fileTypeFor`, `fileExtensionOf`, `contentTypeFor` derive
  `FileType`/`FileExtension` from `PathOnClient` exactly as the engine stores them.
- `packages/engine/src/engine.ts`: import mode (`importMode`) keeps supplied `Id` and audit fields,
  skips hooks, reference checks, validation rules and `placeVersion`; `finishVersion` still stores
  bytes and computes `Checksum`/`ContentSize` from the supplied `VersionData`.
- `packages/engine/src/bootstrap.ts`: `bootstrapOrg(pool, schema, options)` mints Organization,
  Profile, User, BusinessHours, UserLicense and RecordType rows with `generateId` and one `now`; the
  D-01 options bag goes here.
- `packages/schema/src/ids.ts`: `toCaseSafeId`, `normalizeId`, `keyPrefixOf`; `generateId` stays.
- `packages/schema/src/db.ts`: `formatSalesforceDatetime` (the `+0000` form Bulk emits).
- `packages/api/src/routes/bulk.ts`: `POST /jobs/query`, `GET /jobs/query/{id}/results` with
  `Sforce-Locator` / `Sforce-NumberOfRecords`, 2000-row pages; `packages/api/src/bulk/csv.ts`
  `writeCsv` is the in-repo writer (no external CSV dependency, PITFALLS P24).
- `packages/api/src/describe.ts`: `/sobjects/` reports `replicateable: !mdt`; describe field order
  is the column order Heimdall uses.
- `test/db.ts`: `openTestDb()` opens pglite through pglite-socket with a per-run schema and a
  `close` that waits for detach; the generator reuses the pattern (not the test helper itself if
  it cannot be imported from `scripts/`).
- `scripts/gen-baseline/generate.ts`: `--check` mode listing differing, missing and stray files;
  `tsconfig.scripts.json` type-checks `scripts/**`.

### Established Patterns
- Diagnostics never echo cell values (PITFALLS P22, `UNSUPPORTED:*` convention); the leak guard
  (D-04) names object and field only.
- Generated artefacts are committed with a `--check` regenerate gate (`baseline:check`,
  `baseline-gen-check` CI job); the fixture gets the script-level gate now and the CI job later.
- One barrel `src/index.ts` per package with explicit named exports; packages depend downward
  (`metadata -> schema -> ... -> engine -> api -> cli`); `@orglet/archive` sits beside `api`, below
  `cli`, and never imports `api`.
- Standard-object DML flags come from the generated baseline; ContentVersion is `deletable: false`
  and ContentDocument delete cascades (Phase 15), which matters for the period-2 delete story.

### Integration Points
- New package `packages/archive` registered in root `tsconfig.json` references, `vitest.config.ts`
  and `tsconfig.test.json` aliases, `eslint.config.js` project list, `pnpm-workspace.yaml` (already
  `packages/*`).
- New root scripts in `package.json` (`archive-fixture:gen`, `archive-fixture:check`).
- `bootstrapOrg` option bag (D-01) used by `scripts/gen-archive-fixture` only; `orglet up` passes
  nothing new.
- `examples/acme-archive/` is read by Phase 18 (`archive load`), Phase 21 (ACC3-01) and the
  Phase 20 UI checks; its README is the contract for those consumers.

</code_context>

<specifics>
## Specific Ideas

- The fixture is an approximation of Heimdall proving the documented shape, not every real backup;
  a format-version assertion in the generator (header and key shape) should fail loudly if the
  documented rules change.
- Period-2 story should read as a small narrative in the seed module ("account X renamed, contact
  Y deleted, file Z got a second version") so a reviewer can predict the CSV diff.
- ContentDocumentLink's `Failed` backup run (D-05) is deliberate evidence that orglet refuses the
  unfiltered query like a real org; Phase 18 must tolerate `Failed` runs without a CSV.

</specifics>

<deferred>
## Deferred Ideas

- `Archive-yyyyMM` run with negative index period in the fixture (P23 suggestion) — FIX-03 or a
  Phase 18 unit case.
- Same-second version tie across periods and records first created in period 2 — FIX-03 / Phase 18.
- `fixture-gen-check` CI job — FIX-02 (v2).
- Hand-written adversarial CSV set — FIX-03 (v2).
- `ContentVersion.FirstPublishLocationId` not expanded to custom objects (Phase 15 residual) — if
  the seed wants an auto-link to Project__c it must insert the ContentDocumentLink explicitly.

</deferred>

---

*Phase: 16-archive-fixture-generator*
*Context gathered: 2026-11-07*
