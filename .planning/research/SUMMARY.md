# Project Research Summary

**Project:** orglet, milestone v1.2 "archive mode"
**Domain:** self-hosted Salesforce emulator, third milestone: read-only replica of a former org from an SFDX retrieve plus a Heimdall backup
**Researched:** 2026-11-03
**Confidence:** MEDIUM. Codebase integration points HIGH (source read). Heimdall format MEDIUM (source read, never run against a real backup). Salesforce status codes and Files semantics MEDIUM-LOW (developer.salesforce.com returned 403, only search excerpts). pglite COPY behaviour MEDIUM (one probe).

Detail is in `STACK.md`, `FEATURES.md`, `ARCHITECTURE.md`, `PITFALLS.md`; backup format facts are in `HEIMDALL-FORMAT.md` (reference, not restated here). This file reconciles them. The v1.1 summary is preserved in git.

## Executive Summary

v1.2 turns orglet into a viewer for a former org: the retrieve gives the schema, a Heimdall backup (Bulk 2.0 query CSVs in S3 plus a Postgres index) gives the data, and orglet serves both through the unchanged Salesforce API, a record-browsing UI and file downloads read straight from the backup store. The shape that all four researchers converge on: one new package `@orglet/archive` (loader, object stores, erasure, depends on `metadata`, `schema`, `engine`, never on `api`), one new persisted per-org mode row (`_orglet.org_mode`), one new `BlobStore` interface owned by `engine`, and a deterministic fixture generator that produces a Heimdall-shaped backup from `examples/acme` through orglet's own Bulk 2.0 output. The loader is a data load, not a save: it bypasses `DmlEngine` (no hooks, no roll-up recompute) and writes backed-up values verbatim.

The recommended approach is to decide the storage representation first and the loader second. Formula fields become stored, frozen columns in archive mode (one `frozen` flag, one `isVirtual` predicate, one `isComputed` in SOQL); the mode is persisted in the database, not a CLI flag, so `orglet up` cannot start an archive as a normal org. Read-only is refused at the single `DmlEngine` choke point with a table-driven route test as the durable guard. Erasure is CLI-only with an append-only ledger that the loader consults so a reload never resurrects erased data. Files get done properly in normal mode first (ContentDocument auto-create, ContentDocumentLink, VersionData download over bytea), then the same interface is backed by a checksum-addressed external store in archive mode.

Top risks: (1) five open design decisions below, two of them (FK policy, frozen storage) shape the loader's tables, so they must be settled before LOAD is planned; (2) the pglite test path cannot run `COPY FROM STDIN`, so the loader needs two sinks and CI proves both; (3) bootstrap, seed and roll-up backfill write into the database on every `up` and would corrupt an archive; (4) real-org data must never reach the repo, tests or Claude context, so loader diagnostics are value-free and counted; (5) version selection has ties across periods and must be a documented total order in SQL.

## Decisions needed before planning

The four files disagree in places. None of these is resolved here. Each lists the options, each file's position, and a leaning for the discuss step.

### D1. Read-only status code (blocks RO; one constant, cheap to change later)

| Option | Position | Evidence |
|--------|----------|----------|
| `INSUFFICIENT_ACCESS_OR_READONLY`, HTTP 403, no `UNSUPPORTED:` prefix | ARCHITECTURE, PITFALLS | Real StatusCode member; but documented in practice as an object/record/FLS permission failure (FEATURES cites Reltio, Revenue.io pages). PITFALLS argues read-only is a deliberate state, not "unsupported", so no prefix. |
| `INSERT_UPDATE_DELETE_NOT_ALLOWED_DURING_MAINTENANCE`, HTTP 403, message prefixed `UNSUPPORTED:archive-readonly` | FEATURES | Exists in restforce's error list; Salesforce maintenance windows put instances in "Read-Only mode". HTTP status unconfirmed. FEATURES keeps the repo convention (real code, marker in the message). |
| `INVALID_TYPE_FOR_OPERATION` | FEATURES (rejected), current backlog 999.11 text | Documented, but means "sObject type invalid for operation"; the type is valid here. |

Nobody verified any of these against the official StatusCode docs. Agreed regardless of choice: one `Errors.readOnlyArchive()` factory, one `statusFor` mapping in `sobjects.ts`, the same code and shape in REST, composite subrequests (per-subrequest, not whole-request), Bulk results (`sf__Error`) and SOAP faults; both jsforce and simple-salesforce surface any code verbatim and do not retry (FEATURES, HIGH). Sub-question inside D1: does a deliberate read-only state carry the `UNSUPPORTED:` marker (FEATURES yes, PITFALLS no)? Leaning: the maintenance code, because it describes an org-wide write block; a manual read of the official page by Johan settles it in minutes.

### D2. Foreign keys in archive mode (blocks LOAD tables and DDL)

| Option | Position |
|--------|----------|
| FKs kept `DEFERRABLE`, checked at COMMIT (the brief's "FK checks deferred") | STACK assumed it (and flagged `ddl.ts` as unread); the brief |
| No FKs at all in archive-mode DDL (plain or partial unique indexes), post-load anti-join census printed as counts | ARCHITECTURE (a backup is partial: unbacked Users, purged parents, unmodelled polymorphic targets; an FK would be a false claim; also faster and removes ordering) |
| Keep FKs but run a pre-commit dangling-reference audit per FK column, classify danglers, count them as `UNSUPPORTED:archive-dangling-reference`; synthesise labelled stub rows for missing User/RecordType/Group/Profile ids (`_orglet.archive_stubs`) | PITFALLS (P1, P11); also warns `session_replication_role = replica` needs privilege and silently skips checks |

Facts that narrow it: PITFALLS read `ddl.ts:98-99`: normal FKs are already `DEFERRABLE INITIALLY DEFERRED`, which resolves STACK's open item. A real backup will have danglers, so a COMMIT-time FK check would abort a multi-hour load with one message. Compatible core of all three: dangling references are counted and reported, never silently nulled or dropped. Leaning: ARCHITECTURE (no FKs) plus PITFALLS' counted audit; stubs (P11) as a separate small decision (stubs preserve Owner traversal but add rows that are not data).

### D3. COPY on pglite (blocks LOAD test strategy; spike first)

STACK probed on 2026-11-03: `COPY FROM STDIN` over pglite-socket fails (`08P01 protocol synchronization was lost`, MEDIUM: hand-driven client); in-process `COPY ... FROM '/dev/blob'` works but is unreachable from the socket-attached `pg` Pool the harness provides; deferred constraints work. ARCHITECTURE and PITFALLS treat COPY-on-pglite as an unverified spike. **Agreed fallback (all three):** a narrow sink interface (`RowSink` in STACK, `LoadSink` in ARCHITECTURE, `BulkWriter` in PITFALLS) with two implementations: `CopySink` (`pg-copy-streams`, real Postgres, default) and `InsertSink` (batched `INSERT ... SELECT FROM unnest($1::text[], ...)`, portable). The pglite suite runs the loader through `InsertSink`; `test-postgres` also runs `CopySink` plus one `describe.skipIf(usingPglite)` test asserting both sinks produce identical tables (skip reason printed). Both sinks receive identical, already-coerced values. Optional `ORGLET_ARCHIVE_SINK=insert|copy`. Before the phase starts: re-run the probe on pglite 0.5.15, since upstream may have fixed it and the second sink could go. PITFALLS adds stage-then-merge (COPY into an unlogged all-text staging table, then typed `INSERT ... SELECT DISTINCT ON`) to get casting control and dedup in SQL; STACK and ARCHITECTURE do not. Treat staging as an open sub-question for the LOAD plan (costs 2x writes).

### D4. Erasure path (agreed on CLI-only; two sub-questions)

All four agree: CLI only (`orglet archive erase`), never an HTTP route or header, so read-only stays absolute; it runs in `@orglet/archive` as raw SQL hard delete, not through `DmlEngine`; erased rows are invisible to `queryAll`; parent roll-ups stay frozen. FEATURES leaves open whether to also map REST/Bulk `hardDelete`/`emptyRecycleBin` onto it for jsforce parity. Leaning: no (an HTTP path that deletes in a read-only org defeats the mode; PITFALLS P14 notes permissive auth makes it worse); log `UNSUPPORTED:archive-harddelete`.

The erasure ledger is one concept under three names: ARCHITECTURE `_orglet.erasure_log(org_schema, object_name, id, erased_at, reason)`, FEATURES "erasure ledger / audit log", PITFALLS "tombstone list" `_orglet.erasure_tombstones`. Build one append-only table: ids and object names only, never erased values; consulted by the loader selection and by `archive verify`; survives `reset` unless `--drop-erasures`. Blob limit, stated in docs and output: the backup store is shared and checksum-deduplicated, orglet does not own it; erasure removes orglet's reference and lists orphaned checksums for the operator (PITFALLS: store credential read-only). Open: cascade policy (master-detail only vs all children), anonymise vs delete, whether `_orglet.bulk_*` rows are purged.

### D5. Version retention (blocks loader table design, cheap now, expensive later)

STACK and ARCHITECTURE assume latest version per Id (plus optional as-of), which discards history in orglet. FEATURES flags that this rules out version history and field diff later (Heimdall has both) and defers that as a differentiator. Options: (a) latest-only, history stays in the backup and a different `as-of` load is a re-load; (b) keep a side table of `(id, version, csv_id)` pointers (no values) so a future history view can re-read the CSVs on demand. Leaning: (a) for v1.2 with (b) noted as a non-breaking later addition, because the index already holds those pointers. Decide explicitly so `org_mode.as_of` semantics and the "empty target required" rule are not accidentally history-hostile.

### Further disagreements found while synthesising (smaller, resolve in discuss)

- **CSV parser**: STACK adds `csv-parse` in `@orglet/archive` and leaves `parseCsv` in `api` untouched. ARCHITECTURE moves `parseCsv` to `engine` and extends it with a streaming variant (no new dependency, one state machine, three api import sites change). PITFALLS says extend, do not swap. The brief lists `csv-parse`; the dependency direction (archive must not import api) is satisfied by either. Leaning: STACK (boring MIT library, no churn in Bulk ingest), with PITFALLS' differential test against `parseCsv`.
- **Lenient coercion**: ARCHITECTURE reuses `coerceValue` with lenient `FieldDef`s; PITFALLS says write a dedicated `archiveCoerce`/lenient mode returning diagnostics, sharing only `normalizeDatetime` and `normalizeId`. Both require restricted-picklist off and value-free diagnostics. Leaning: PITFALLS.
- **Frozen storage naming**: ARCHITECTURE `FieldDef.frozen` + `isComputed`; PITFALLS `FieldStorage = virtual|stored|frozen`. Same design; pick one name. Both require a persisted mode.
- **Bytea**: ARCHITECTURE/STACK single `bytea` column read whole; PITFALLS wants chunked storage or a size threshold. Matters for normal-org files only; archive mode has no blob column.
- **Multipart upload**: FEATURES lists it as table stakes (jsforce/simple-salesforce); STACK and ARCHITECTURE defer it with `UNSUPPORTED:content-multipart` and no `@fastify/multipart`. Leaning: defer, base64 JSON first.
- **ContentDocumentId override**: dropping the nullable override breaks loading when ContentDocument rows are not in the backup (PITFALLS P18). Decide: archive orgs keep it nullable, or the loader synthesises stub documents.

## Key Findings

### Recommended Stack (from STACK.md; v1.1 stack unchanged) [MEDIUM-HIGH]

New package `@orglet/archive` only; nothing else gains a dependency.

| Library | Version | Licence | Purpose |
|---------|---------|---------|---------|
| `@aws-sdk/client-s3` | 3.1161.0 (Node >=20) | Apache-2.0 | `GetObject`/`HeadObject` behind an `ObjectStore` interface; default credential chain; `endpoint` + `forcePathStyle` for MinIO/R2. Heavy (transitive `@smithy/*`), confined to one package, lazily imported. |
| `pg-copy-streams` | 7.0.0 | MIT | `COPY ... FROM STDIN` on real Postgres; CJS, no types. Needs a dedicated checked-out client. |
| `@types/pg-copy-streams` (dev) | 1.2.5 | MIT | Types. Confirm the import form compiles under NodeNext + `verbatimModuleSyntax`. |
| `csv-parse` | 7.0.3 | MIT | Streaming RFC 4180 parser (`columns`, `bom`, `max_record_size`); see disagreement above. |

UI: no new dependency (vanilla JS, split into static files if the page passes ~600-800 lines, served by an allow-list route, not `@fastify/static`). Second Postgres (Heimdall index): a second read-only `pg.Pool` (`default_transaction_read_only=on`), `HEIMDALL_DATABASE_URL`, keyset pagination instead of `pg-cursor`. Optional chore: bump pglite 0.5.8 to 0.5.15 (re-verify the #958 workaround).

**What not to add:** `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner` (presigned URLs would leak the store), `@fastify/multipart`, `@fastify/static`, MinIO/LocalStack containers in CI, `aws-sdk-client-mock`/`s3rver`, any Heimdall client or JDBC-style dependency, a UI framework/bundler/SLDS 2, `aws4fetch`/`minio` clients, a second CSV parser inside `api`, `pg-cursor` unless profiling demands it.

### Expected Features (from FEATURES.md) [MEDIUM]

- **Table stakes:** read-only gate with reads fully working (query, queryAll, describe, Bulk query), describe unchanged (formula/roll-up still `calculated: true`); frozen formula and roll-up values; ContentDocument auto-created on ContentVersion insert, version bumping (`IsLatest`, `VersionNumber`, `LatestPublishedVersionId`), `ContentDocumentLink` in the baseline with the mandatory-filter SOQL restriction, `VersionData` as `base64` with `GET .../VersionData` streaming, server-computed MD5 `Checksum`; UI search by name and email (SOQL fan-out, no SOSL), record view, related lists, lookup links, deleted records reachable, files list and download, "archive, as of <date>, read-only" banner; erasure by Id with audit ledger.
- **Differentiators (cheap):** checksum integrity check and missing-blob diagnostic (Heimdall skips small and deleted files), per-version file list, mode stored in the database, banner via `/orglet/status`.
- **Defer:** version history and field diff (see D5), audit of who viewed (needs real authentication), erase-by-person, multipart upload, Range requests, `pg_trgm` search index.
- **Anti-features:** copying blobs into Postgres in archive mode, faking Attachment/Document bodies (`UNSUPPORTED:blob-field`), soft delete as erasure, DML-enabled "test" flag in archive mode, ContentDistribution/libraries/previews, enforcing ShareType/Visibility, restore to a live org, SOSL.

### Architecture Approach (from ARCHITECTURE.md; PITFALLS adds guards) [MEDIUM-HIGH]

Order: `metadata -> schema -> {formula, soql} -> engine -> {api, archive} -> cli`. `archive` never imports `api`; `api` sees blobs only through `engine`'s `BlobStore`; `cli` wires the concrete `ExternalBlobStore`.

1. **`@orglet/archive`**: `IndexSource` (version selection via `DISTINCT ON (id)`), `ObjectStore` (`FsObjectStore`, `S3ObjectStore`), shared key builders (`blobKey`, `csvKey`, `normalizeS3Path`, used by loader, server and fixture generator so they cannot drift), loader, `ExternalBlobStore`, erasure. Never derive keys from `period`; always follow `csv_id -> csvfiles.s3path`.
2. **Persisted mode** `_orglet.org_mode` (mode, as_of, loaded_at, source, blob_store config without credentials), written last so a crashed load never looks complete. `up` reads it; there is no `--archive` flag. Archive `up` freezes calculated fields, skips `bootstrapOrg`, `seedCustomMetadata` and `backfillFormulaRollups`, uses a synthetic viewer session, and injects `{mode: "archive"}` into the engine. Import mode and read-only are mutually exclusive.
3. **Frozen formulas**: `frozen` flag, `isVirtual` false for frozen, widened `text`/`numeric` columns, `isComputed` replaces `formula !== undefined` at four SOQL sites, `FormulaRegistry` skips frozen. Audit every `formula !== undefined` meaning with a grep gate; keep every roll-up as a stored frozen column, bypassing `admitFormulaRollups`.
4. **Loader**: bypasses `DmlEngine`; per-file column plan (header intersect schema, extras counted as `UNSUPPORTED:archive-column`, compound `Name` skipped quietly); key prefixes derived from the data and fed to `reconcileKeyPrefixes` before `migrate`; empty target schema required; Ids normalised to 18 chars.
5. **Files**: `files.ts` runs in `saveBatch` (needs the DB client, so not a `TriggerExecutor`); `InlineBlobStore` (bytea) in normal mode, `ExternalBlobStore` in archive (key from the row's own `Checksum` + `FileExtension`, missing blob gives 404 plus one-time `UNSUPPORTED:blob-missing`); queries return the VersionData URL, never bytes.
6. **Fixture**: `scripts/gen-archive-fixture/`, import mode with explicit ids and timestamps, driven through `createApiServer` Bulk 2.0 via `app.inject`, split across CSVs and two periods (full snapshot, then increment with deletes), index dump written independently of the loader, MD5 asserted equal to `Checksum`. Fixture is an approximation of Heimdall, proving the documented shape, not every real backup.
7. **UI**: vanilla JS split into allow-listed static files; text nodes only (grep gate forbids `innerHTML`); download via `fetch` with the Authorization header then a blob URL (no token in the URL).

### Critical Pitfalls (from PITFALLS.md, 25 total; top ones) [MEDIUM-HIGH]

1. **FK and dangling data (P1, P11, P12)**: see D2. Never silently null a business lookup; counts only.
2. **Frozen storage not persisted (P9)**: second `up` shows `schema-drop`, backfills overwrite frozen roll-ups, `applyFormulaFields` recomputes `NOW()` values. Prevent with persisted mode and a "load, up, up" idempotence test.
3. **Read-only side doors (P10)**: upsert-by-external-id, composite, Bulk ingest job creation, `bootstrapOrg` inserting a second Organization/RecordType set, `seedCustomMetadata`, `Store` used directly. Guard in `DmlEngine` entry plus `Store`, table-driven test over every non-GET route, row-count-delta test across `up`.
4. **Coercion and CSV semantics (P2, P3)**: no float round-trip for numerics, restricted picklists and length overflow must not reject history, BOM, streaming, ragged headers; diagnostics never echo cell values.
5. **Version selection ties (P5)**: define a total order (version, deleted wins, archive vs normal period, csv_id) in one SQL `DISTINCT ON`; count resolved ties; load twice gives identical table hashes.
6. **Level 1 data rule (P22)**: redacted by default output, no values or ids in errors, repo guard scan for non-fixture OrgIds, real-backup runs only by Johan in his own shell.
7. **Erasure leaves data behind (P13)**: soft delete is not erasure, reload resurrects, denormalised copies, bulk job rows; generic PII scan test over every text column.

Pitfalls by phase:

| Phase | Topic | Pitfall | Mitigation |
|-------|-------|---------|------------|
| RO (design first) | Frozen storage | P9: mode not persisted, `isVirtual` forks, backfills overwrite | Decide storage and persisted mode before LOAD plans tables; load, up, up test |
| LOAD | Writer path | P19, P7: COPY unverified on pglite; unique violations abort hours-long load | Two sinks, contract tests on both, spike first; unique indexes downgraded with a counted diagnostic |
| LOAD | Parsing | P2, P3: lenient coercion, streaming, BOM, value echo | Streaming path, differential test against `parseCsv`, value-free diagnostics |
| LOAD | Selection | P5, P6: ties, periods, 15/18 Ids | One SQL `DISTINCT ON`, normalised Ids, determinism hash test |
| LOAD | Integrity | P1, P11, P12: danglers, stubs | Post-load audit, counted `UNSUPPORTED:archive-*` |
| LOAD | Prefixes | P6: reconcile before data | Derive mapping from data, run `reconcileKeyPrefixes` first |
| RO | Enforcement | P10: side doors, bootstrap/seed/backfill writes, `--import` bypass | Guard in `DmlEngine` and `Store`, route-table test, row-count-delta test |
| RO | Erasure | P13, P14: soft delete, versions, blobs, resurrection | Ledger, generic PII scan test, CLI-only |
| FILES | Blob store | P15, P16, P17: buffering, inline SVG/HTML XSS, path traversal, missing blobs | Streaming interface, `attachment` + `nosniff`, regex-validated checksum and extension, 404 not 500 |
| FILES | Content model | P18: ContentDocument stubs, nullable override, blob write vs DML order | Decide stub vs override; crash-window test |
| UI | Rendering | P21: XSS via href and rich text, token in URL, SOQL injection in search, huge related lists | Text nodes only + grep gate, header-fetch download, one escaper with `O'Brien` test, lazy capped lists |
| FIX | Determinism | P23: random Ids and clocks, circular fixture | Seeded id/clock seam (touches engine/schema, schedule before fixture), hand-written adversarial CSV set |
| FIX/CI | Licences, no AWS | P19, P24 | Filesystem mirror default, `license-check` allow-list |
| All | Regressions | P25: "just a flag" | Explicit default-off mode object passed down; existing 922/924 tests and conformance legs unchanged |

## Implications for Roadmap

ARCHITECTURE's build order is carried forward unchanged, with PITFALLS' constraint that the storage and mode decision (phase 3 below) precedes any loader table.

### Phase A: Foundations and Files model (normal mode)
Rationale: the fixture needs ContentVersions with Checksum, the loader needs the tables, and Files done properly is independent of archive. Delivers: `Base64` type and `BlobStore`/`InlineBlobStore`, ContentDocumentLink in baseline (regenerate, keep `baseline-gen-check` and the v1-vs-v2 diff gate green), `files.ts` side effects, `GET .../VersionData` streaming, SOQL URL shaping, nullable override decision, streaming CSV (per the CSV decision), seeded id/clock seam. Avoids P15-P18, P24. Research: deeper (Files semantics, ContentDocumentLink over polymorphic `LinkedEntityId`, multipart if kept). Include an upgrade test on a populated v1.1 database.

### Phase B: Fixture generator and `examples/acme-backup`
Rationale: loader tests depend on it; can overlap with C. Delivers: deterministic Heimdall-shaped store mirror and index dump (both period formats, an `Archive-` case, dedup blob pair), plus the committed hand-written adversarial CSV set and the repo guard scan. Avoids P23, P22. Standard patterns; `fixture-gen-check` CI like `baseline-gen-check`.

### Phase C: Archive schema mode and read-only
Rationale: stored formula columns must exist before COPY, and the refusal contract is testable by loading rows through SQL before the loader exists. Delivers: `org_mode`, `frozen`/`isVirtual`/`isComputed`, archive DDL variant per D2, `up` mode detection with bootstrap/seed/backfill skips, synthetic viewer login, engine refusal per D1, `/orglet/status`, route-table and row-count-delta tests. Avoids P9, P10, P25. Research: deeper (status code, audit of every `formula !== undefined`, `rollup-relationship` degrade). Blocked by D1, D2.

### Phase D: Loader
Rationale: needs the tables (C) and the fixture (B). Delivers: `IndexSource` and version selection with as-of, `ObjectStore` (fs first, S3 second), key builders, prefix derivation, per-file column plan, lenient coercion, sinks per D3, diagnostics and dangling census, `ExternalBlobStore`, `orglet archive load`. Avoids P1-P8, P11, P19, P20, P22. Research: deeper (pglite COPY spike on 0.5.15, throughput on large CSVs, staging-table decision, length-overflow policy, whether User/RecordType/ContentDocument/Link are backed up by default). Blocked by D2, D3, D5.

### Phase E: Erasure
Delivers: `archive erase`, one ledger table, loader tombstone check, orphan-checksum listing. Avoids P13, P14. Research: deeper on cascade and anonymise-vs-delete semantics. Blocked by D4.

### Phase F: Conformance leg and CI
Delivers: `archive-check` conformance leg (jsforce and simple-salesforce read the archive server and assert DML refusal), `archive-fixture-check`, `license-check`. S3 path tested against an in-process stub, never MinIO in CI. Standard patterns.

### Phase G: Record-browsing UI
May start after A on normal mode; verified against the archive fixture at the end. Delivers: split static files, search fan-out, record view, lazy capped related lists, lookups, files, banner. Avoids P21. Standard patterns; check `pg_trgm` on pglite only if a search index is wanted.

### Research Flags
Needs deeper research at planning: A (Files semantics), C (status code, `formula` audit), D (COPY spike, scale, backup coverage of supporting objects), E (GDPR semantics). Standard: B, F, G. Re-verify S3 `forcePathStyle`/endpoint semantics against current SDK docs before implementing the S3 store (STACK did not).

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Versions and licences checked against the registry on 2026-11-03; S3 endpoint options and Fastify stream behaviour from training knowledge; pglite probe is MEDIUM |
| Features | MEDIUM | Salesforce pages were 403, claims rest on search excerpts and SDK source (jsforce, simple-salesforce, restforce read directly: HIGH for client behaviour) |
| Architecture | MEDIUM-HIGH | Integration points read from source; COPY-on-pglite claim superseded by STACK's probe; fixture fidelity limited by Heimdall never run |
| Pitfalls | MEDIUM-HIGH | Codebase claims HIGH (file and line cited); Postgres/pglite specifics flagged `[spike]` |

### Gaps to Address

- Official Salesforce wording for the read-only code, ContentVersion required fields (`PathOnClient`, `VersionNumber`), ContentDocumentLink usage notes: need a manual read.
- Heimdall: file naming, header-per-file, `Archive-` handling and whether `User`, `RecordType`, `ContentDocument`, `ContentDocumentLink` are backed up by default were read from source only; this decides stub rows (P11) versus "mostly present". The fixture must not over-trust `fileName = <bulkJobId>.csv`.
- COPY on pglite: re-probe on 0.5.15; may allow dropping `InsertSink`.
- Whether `OwnerId`/audit-field columns, AutoNumber sequences (`setval` after load) and unique indexes behave as P7 assumes; needs a read of `ddl.ts` unique-index rules during LOAD planning.
- Scale: 1M-row timing on Postgres 16 has not been measured.
- `pg_trgm` on pglite and whether search indexing is in scope.

## Sources

### Primary (HIGH)
Repo source read by ARCHITECTURE and PITFALLS (`engine.ts`, `bootstrap.ts`, `coerce.ts`, `ddl.ts`, `columns.ts`, `migrate.ts`, `prefixes.ts`, `ids.ts`, `cli/src/main.ts`, `api/src/routes/*`, `bulk/csv.ts`, `compile.ts`, `ui/index.html`, `test/db.ts`); jsforce `http-api.ts`, simple-salesforce `util.py`, restforce `error_code.rb`; npm registry (2026-11-03); STACK's local pglite probe (reproducible, scripts in session scratchpad only).

### Secondary (MEDIUM)
`HEIMDALL-FORMAT.md` (Heimdall source at d526e54); Salesforce REST/Object Reference pages via search excerpts; Own, Commvault, Odaseva vendor material for archive and GDPR practice.

### Tertiary (LOW)
AWS SDK v3 endpoint options, Fastify 5 stream replies, Postgres 17 versus pglite `pg_input_is_valid`, vendor "forget" workflows, any Salesforce HTTP status mapping.
