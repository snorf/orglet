# Technology Stack: v1.2 archive mode (additions only)

**Project:** orglet
**Milestone:** v1.2 archive mode
**Researched:** 2026-11-03 (versions and licences checked against the npm registry on this date)
**Scope:** only what the new features need. The v1.1 stack (TypeScript 5.9, Node 22, pnpm, `pg` 8.23, Fastify 5.12, vitest 3, pglite 0.5.8 + pglite-socket 0.2.11, `fast-xml-parser`, `@jetstreamapp/soql-parser-js`) is unchanged; see git history of this file and `.planning/codebase/STACK.md`.

## Summary of decisions

| Question | Decision |
|----------|----------|
| (a) S3 access | `@aws-sdk/client-s3` only, in a new package `@orglet/archive`, behind a tiny `ObjectStore` interface. No `lib-storage`, no presigner. Tests use a filesystem `ObjectStore`, never the SDK. |
| (b) COPY | `pg-copy-streams` 7.0.0 on real Postgres. pglite leg uses a different sink (multi-row `INSERT ... unnest`). Do not try COPY FROM STDIN on pglite. |
| (c) CSV | Add `csv-parse` 7.0.3 for the streaming path. Keep `parseCsv` in `bulk/csv.ts` for small ingest bodies (it is in-memory, string-in). |
| (d) Blobs | Buffers over `pg` for bytea; stream with `reply.send(Readable)`; JSON upload as base64 within the existing 64 MiB `bodyLimit`; no multipart plugin needed. |
| (e) UI | Confirmed: vanilla JS, no new dependency. |
| (f) Second Postgres | A second `pg.Pool` (read-only session) on a separate connection string; a restored dump is just another URL. No new dependency. |

## Recommended additions

### Runtime dependencies

| Library | Version | Licence | Package | Purpose | Why |
|---------|---------|---------|---------|---------|-----|
| `@aws-sdk/client-s3` | 3.1161.0 (2026-10-30), Node >=20 | Apache-2.0 | new `@orglet/archive` only | `GetObject` (CSV + blob stream), `HeadObject`, `ListObjectsV2` if needed | The only S3 client Heimdall itself uses (Java SDK, same key layout, same endpoint-override convention), works with MinIO/LocalStack via `endpoint` + `forcePathStyle`, and `Body` is a Node `Readable` that goes straight into `csv-parse`. Apache-2.0 is OSI and compatible with an Apache-2.0 project. Weight: about 3.3 MB unpacked plus transitive `@smithy/*`; acceptable because it is confined to one package and only imported when `--s3` is used. |
| `pg-copy-streams` | 7.0.0 (2025-05-27) | MIT | `@orglet/schema` (or `archive`, see below) | `COPY ... FROM STDIN` writable stream over a `pg` client | The standard add-on for node-postgres (maintained under the brianc org), pure-JS `pg` only (orglet uses pure-JS). CJS, ships no types. |
| `csv-parse` | 7.0.3 (2026-09-25) | MIT | `@orglet/archive` | Streaming RFC 4180 parser, `columns: true`, `bom: true` | Part of the `node-csv` suite, async-iterator friendly, ESM with bundled types. Needed because the existing parser takes a whole string and builds all rows in memory; Heimdall CSVs hold 50K-200K records each and a bucket holds many. |

### Dev dependencies

| Library | Version | Licence | Purpose |
|---------|---------|---------|---------|
| `@types/pg-copy-streams` | 1.2.5 | MIT | Types for `pg-copy-streams` (it ships none). |

Optional, not required for the milestone: bump `@electric-sql/pglite` 0.5.8 to 0.5.15 and `pglite-socket` to match. The tree already contains 0.5.10/0.2.13 for the `-age` etc. packages, so they are resolvable; do it as a separate chore, because `test/db.ts` carries a workaround for pglite#958 that should be re-verified on the bump.

## (a) S3 from Node 22 ESM

- **Use `@aws-sdk/client-s3` v3 alone.** `GetObjectCommand` returns `Body` as `SdkStreamMixin & Readable` in Node; `for await` or `pipeline(body, parse(...))` streams without buffering. `Body` must be consumed or destroyed, or the socket leaks.
- **`@aws-sdk/lib-storage` is not needed.** It exists for multipart upload (`Upload`). archive load only reads. The only write case is the fixture generator, which writes to a local mirror, not S3. Do not add it.
- **No presigner.** `GET .../VersionData` is streamed through orglet (`Body` piped to the Fastify reply). Presigned URLs would leak the store to clients and break the "client cannot tell the difference" rule.
- **Lighter alternatives rejected.** `aws4fetch` (MIT, 1.0.20, last release 2024-08) is small and fetch-based, but needs hand-written XML for `ListObjectsV2`, hand-rolled credential chain (no `DefaultCredentialsProvider` equivalent: env, shared profile, SSO, IMDS, web identity) and gives a web stream. Heimdall users authenticate with the standard AWS chain, so the SDK's provider chain is the feature. `minio` JS client (Apache-2.0, 8.0.7) is a viable second option but adds a different credential model and nothing the SDK lacks.
- **Endpoint config** for MinIO/LocalStack/R2/other S3-compatible: `new S3Client({ region, endpoint: process.env.ORGLET_S3_ENDPOINT, forcePathStyle: true })`. Region must be set for custom endpoints (any value). `forcePathStyle` is required for MinIO and LocalStack unless using wildcard DNS. Credentials come from the default chain (nothing orglet-specific). [MEDIUM: from SDK v3 documented options and training knowledge; not re-verified against docs this session.]
- **Tests: no S3 at all.** The `ObjectStore` interface has two implementations in v1.2: `FsObjectStore(rootDir)` (key layout `OrgId=.../Period=.../...` mapped to subdirectories; also the documented "local mirror" input of `orglet archive load --from-dir`) and `S3ObjectStore`. All unit, integration and CI tests run on `FsObjectStore`, so CI needs no AWS credentials, no MinIO container and no LocalStack. One optional, non-gating smoke test of `S3ObjectStore` against MinIO can be a separate manual script; do not put it in `pnpm test`.
- **Key safety.** `s3path` values from the index are untrusted input in the `FsObjectStore` case: resolve against the root and reject any path that escapes it (`..`, absolute paths). Strip an optional `s3://bucket/` prefix as Heimdall's reader does.
- **Bucket/prefix** is one bucket per org, keys prefixed `OrgId=<orgId>`; blob key `OrgId=<org>/Period=0/files/<cs[0:4]>/<cs>.<ext>` (HEIMDALL-FORMAT.md section 4).

## (b) COPY with `pg`, and pglite

**Real Postgres 16.** `pg-copy-streams` 7.0.0, `import copy from "pg-copy-streams"` (CJS default import is the safe form under NodeNext; verify the named `from` export compiles before using it). Pattern:

```ts
import { pipeline } from "node:stream/promises";
const stream = client.query(copy.from(`COPY "${table}" (${cols}) FROM STDIN WITH (FORMAT csv, NULL '')`));
await pipeline(rowsToCsvReadable, stream);   // wait for pipeline, not 'finish'
```

- Requires a **dedicated checked-out client** (`pool.connect()`); one COPY at a time per client. Reuse `withTransaction` from `packages/schema/src/db.ts`.
- **Transaction shape:** one transaction per load: `BEGIN; SET CONSTRAINTS ALL DEFERRED; COPY ...(per table, parents and children in any order); COMMIT`. This only defers constraints declared `DEFERRABLE`. **Schema consequence:** orglet's generated FK constraints must be `DEFERRABLE INITIALLY IMMEDIATE` (or the loader must drop/re-add them, or load with `session_replication_role = replica` which needs superuser). Check `packages/schema/src/ddl.ts` in the roadmap's first phase; I did not read it. `SET CONSTRAINTS ALL DEFERRED` also defers FK cycles (A->B->A) because checks run at COMMIT. Unique and primary-key constraints are not deferrable by default and stay immediate; that is wanted here.
- **Batching:** a single COPY can carry the whole file; batching is only needed for progress and memory, and COPY already streams. Use one COPY per (object, CSV file) so a failure names the file. A COPY row error aborts the whole COPY and the transaction (no per-row error recovery); validate/coerce in Node before writing to the stream and report row-level problems as diagnostics. Savepoints (`SAVEPOINT` per object) let one object fail without losing the others only if the caller wants partial loads; default to all-or-nothing per run.
- Coercion: Bulk 2.0 values (`2026-01-15T14:30:22.000+0000`, booleans, multipicklists, 18-char ids) go through the existing import-mode coercion, then are re-serialised to CSV for COPY. Do not feed raw Heimdall CSV to COPY unfiltered: rows must be filtered to the selected `(Id, SystemModstamp)` versions and columns mapped to orglet column names.

**pglite (verified by experiment on 2026-11-03, repo-pinned pglite 0.5.8 / PostgreSQL 18.3 / pglite-socket 0.2.11, Node 22.23.3, probes kept in the session scratchpad only):**

| Path | Result |
|------|--------|
| `COPY ... FROM STDIN` through pglite-socket with a `pg` client (hand-driven CopyInResponse/CopyData/CopyDone, which is what `pg-copy-streams` does) | FAILS: server returns `FATAL 08P01 terminating connection because protocol synchronization was lost`. pglite-socket forwards each client message as an independent unit, so the COPY sub-protocol does not survive. Same class of problem as pglite#958 handled in `test/db.ts`. |
| In-process `db.query("COPY t FROM '/dev/blob'", [], { blob })` (pglite's own API) | Works, including bytea (`\x6869`) and `SET CONSTRAINTS ALL DEFERRED` with a deferred FK. But the orglet test harness hands code a `pg` Pool over the socket, not the `PGlite` object, so this path is unreachable from product code without a harness change. |
| `SET CONSTRAINTS ALL DEFERRED` + insert child before parent + COMMIT | Works on pglite. |

Confidence: the failure is MEDIUM (my hand-rolled driver could be at fault, but it uses pg's own `sendCopyFromChunk`/`endCopyFrom`, and the error is protocol-level); the `/dev/blob` success is HIGH (observed). Do not spend phase time making STDIN work on pglite.

**Design that keeps the pglite leg green:** a narrow `RowSink` interface in the loader (`write(table, columns, rows)`), two implementations selected by capability, not by `usingPglite` leaking into product code:

1. `CopySink` (pg-copy-streams) for real Postgres. Selected when `SHOW server_version`/a probe says COPY works; default.
2. `InsertSink` (portable): batched `INSERT INTO t (cols) SELECT * FROM unnest($1::text[], $2::int[], ...)` or multi-row `VALUES` in 1000-row batches, inside the same transaction, same deferred constraints. Works on both. CLI flag/env `ORGLET_ARCHIVE_SINK=insert|copy` (default `copy`). The pglite suite runs the full loader through `InsertSink`; the Postgres 16 CI job (`test-postgres`) additionally runs the same loader test with `CopySink`. Add one `describe.skipIf(usingPglite)` test in the existing style (`usingPglite` export in `test/db.ts`) that asserts COPY equals INSERT results on the fixture, so the two sinks cannot drift. Skip reason must be printed, per project rules ("tests skipped" must be reported).
3. Insist that both sinks receive identical, already-coerced values so the only difference under test is transport.

## (c) CSV parsing

- **What exists:** `packages/api/src/bulk/csv.ts` is a hand-written RFC 4180 parser: `parseCsv(text: string, delimiter)` over a complete string, building `string[][]`. It is **not streaming**, is character-by-character string concatenation, and accepts CR/LF/CRLF. Fine for Bulk ingest bodies (bounded by `bodyLimit`), wrong for backup CSVs (up to 200K rows per file, unbounded count, possibly large long-text fields).
- **Add `csv-parse` 7.0.3** (MIT, ESM, types bundled) in `@orglet/archive`: `parse({ columns: true, bom: true, relax_column_count: false, skip_empty_lines: true })` and consume with `for await`. Reasons over alternatives: handles quoted newlines and doubled quotes per RFC 4180, bounded memory via async iteration with backpressure, header-as-keys gives the column mapping the loader needs, and the same suite has `csv-stringify` (MIT) if the COPY side needs a vetted writer (not required: `csvField` in `csv.ts` already escapes correctly; reuse it to avoid a dependency).
- **Do not replace `parseCsv`** in the Bulk path (surgical changes; its lenient CR handling is tested). Do not move it either; the archive package must not import from `@orglet/api` (dependency direction: api depends downward). If both need shared CSV utilities later, extract in a separate refactor.
- Encoding: Heimdall writes UTF-8 `text/csv`, no gzip. Pass `bom: true` anyway. Ignore gzip support (YAGNI; log `UNSUPPORTED:archive-compression` if a `.gz` key shows up).
- Large-field guard: set `max_record_size` (e.g. 64 MiB) so a corrupt file with an unterminated quote fails with a clear error instead of consuming memory.

## (d) Binary and blob handling

- **Postgres bytea:** `pg` maps `Buffer` to bytea on write and returns `Buffer` on read, no type parser change needed (`db.ts` only overrides date/numeric/int8/time/timestamptz). Hex input in COPY CSV is `\x...`.
- **Blob store interface** (placement: define `BlobStore` in `@orglet/engine`, next to `Store`, because the engine owns record persistence and `GET VersionData` needs it; implementations in `@orglet/schema`/`engine` for Postgres, in `@orglet/archive` for external): `put(meta, stream|Buffer) -> ref`, `get(ref) -> { stream, size, contentType }`, `has(ref)`. Two implementations: `PgBlobStore` (bytea column on a content table, normal org) and `ObjectBlobStore` (wraps `ObjectStore`, key `OrgId=<org>/Period=0/files/<cs[0:4]>/<cs>.<ext>`, read-only, no copy at load time). The archive-mode CV row stores `Checksum` + `FileExtension` and the store derives the key; no blob bytes are loaded.
- **Upload via REST:** Salesforce REST creates ContentVersion with `VersionData` as base64 in the JSON body (for the `sobjects` endpoint) or multipart. Base64 JSON works inside the existing `bodyLimit: 64 * 1024 * 1024` (Salesforce's real limit is about 37.5 MB raw / 50 MB for the base64 body for this route; keep orglet at the existing limit and document it). Multipart upload (`@fastify/multipart` 10.1.7, MIT) is a Salesforce feature for large files; defer as `UNSUPPORTED:content-multipart` and do not add the dependency in v1.2. Note this is a read-only-archive milestone: upload only matters for the normal-org file path.
- **Checksum:** compute MD5 hex (`node:crypto`, no dependency) on write for `Checksum`, matching Salesforce and Heimdall's dedup key. Verify after read in archive mode only on request (a `--verify-blobs` flag), not by default.
- **Download:** Fastify 5 streams when `reply.send(readable)` is given a Node `Readable`; set `Content-Type`, `Content-Length` (from `ContentSize` or the store), and `Content-Disposition`. For bytea, a `Readable.from(buffer)` is fine (the value is already in memory from `pg`); for S3, pipe `Body`. Handle client aborts by destroying the S3 `Body` on `reply.raw` close. Do not use `@fastify/static` (MIT, 10.1.8): the source is not a directory. Range requests: not needed in v1.2; add later if browsers need video seeking.
- **Size:** a `pg` bytea read is whole-value in memory (about 1 GB hard limit in Postgres, practical limit far lower). Acceptable for a normal org's dev files; this is why archive mode uses the external store. If large files in a normal org become a need, `lo_*` large objects or chunked rows are the upgrade, not in scope.

## (e) UI

Confirmed: no framework, build step or new dependency. `packages/api/ui/index.html` is already a single self-contained page using `fetch` against orglet's own REST and query endpoints. Search (SOQL `LIKE`/SOSL stub), record view (describe + record GET), related lists (child-relationship describe + subqueries) and file download (an anchor to `.../VersionData`, which sends a session cookie or token as the page already does for queries) are all expressible with the existing REST surface. Growth risk is file size (242 lines today); if the page passes roughly 800 lines, split into several static files served by the existing static handler rather than introducing a bundler. [HIGH for "no dependency required", MEDIUM on the file-size threshold, which is a judgement.]

## (f) Second Postgres (Heimdall index)

- Use a second `pg.Pool` from `createPool(url)` with a distinct connection string, e.g. `--heimdall-db <url>` / `HEIMDALL_DATABASE_URL`. Keep it separate from `ORGLET_DATABASE_URL`; never share a pool, the target is writable and the source must not be.
- **Read-only:** pass `options: "-c default_transaction_read_only=on -c statement_timeout=0"` in the pool config (or `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY` on connect) so a bug cannot write to the index. Set `application_name: "orglet-archive-load"`.
- A restored `pg_dump` loaded into any local Postgres is just another URL; orglet needs only `SELECT` on `objects`, `csvfiles` and `backup_runs` (and `object_stats` optionally). No Heimdall code and no dump parsing in orglet.
- Reading `objects` for a large backup: use a cursor (`pg-cursor` 2.22.1, MIT, a `pg` sibling) or keyset pagination on `(csv_id, id)` rather than loading all rows; the plan is to group by `csv_id`, so `ORDER BY csv_id, id` with keyset pages of about 50K rows avoids the extra dependency. Prefer keyset pagination; add `pg-cursor` only if profiling demands.
- The index DB has no org table; `org_id` is a filter column; `period` is YYMM int (negative = archive), unlike the S3 key's `yyyyMM` / `Archive-yyyyMM`. Do not derive keys from `period`; always use `csvfiles.s3path`.
- pglite as the Heimdall index in tests: not needed. The public fixture backup should ship as SQL/CSV seed data inserted into a table set created by test code (Heimdall-shaped DDL, copy of HEIMDALL-FORMAT.md section 3 minus unused columns) in the same per-file pglite or Postgres the test already has, i.e. a second *schema* in the test database, so the "second Postgres" is just a second pool onto the same server in tests.

## Integration points in existing packages

| Concern | Where | Notes |
|---------|-------|-------|
| `ObjectStore` interface, `FsObjectStore`, `S3ObjectStore`, CSV streaming, Heimdall index reader, version selection, `RowSink`s, `archive load` orchestration | **new package `@orglet/archive`** (depends on `metadata`, `schema`, `engine`) | Keeps the AWS SDK and `csv-parse` out of `api`/`engine`/`schema`. One barrel `src/index.ts`, explicit named exports, matches conventions. Add to root `tsconfig.json` references and `vitest.config.ts` aliases. |
| `CopySink` (pg-copy-streams) | `@orglet/archive` | `@orglet/schema` stays free of the dependency; it exposes `createPool`, `withTransaction`. |
| `BlobStore` interface and `PgBlobStore` | `@orglet/engine` (interface), `@orglet/schema` (bytea table DDL via OrgSchema/ddl) | DDL for the content table must go through the existing planner so migrations stay diff-based. |
| `ObjectBlobStore` | `@orglet/archive`, injected into `ApiOptions` by `@orglet/cli` | `api` depends only on the `BlobStore` interface. |
| `archive load` command | `@orglet/cli` | New subcommand beside `up/check/reset`; `--from-dir`, `--s3-bucket`, `--s3-endpoint`, `--heimdall-db`, `--as-of`, `--org-id`. |
| Read-only mode | `@orglet/engine` (`EngineOptions.readOnly`) + `@orglet/api` | Refuse DML with a Salesforce-shaped error; GDPR erase is an explicit separate engine method. No dependency. |
| `UNSUPPORTED:` areas to register | `archive-column`, `archive-compression`, `content-multipart` | Per mandatory convention. |

## Alternatives considered

| Category | Recommended | Alternative | Why not |
|----------|-------------|-------------|---------|
| S3 client | `@aws-sdk/client-s3` | `aws4fetch` | No credential chain, hand-rolled XML, web streams |
| S3 client | `@aws-sdk/client-s3` | `minio` 8.0.7 (Apache-2.0) | Different credential model, no benefit; Heimdall users already hold AWS-style credentials |
| Multipart upload | not added | `@aws-sdk/lib-storage` | No S3 writes in scope |
| COPY | `pg-copy-streams` | `INSERT` only everywhere | 5-20x slower on large loads; COPY is the requirement. Kept as the pglite sink |
| COPY | `pg-copy-streams` | pglite `/dev/blob` | Unreachable from a socket-attached `pg` Pool; would fork product code for tests |
| CSV | `csv-parse` | extend `parseCsv` to stream | A second hand-written streaming RFC 4180 state machine to test; `csv-parse` is MIT and boring |
| CSV | `csv-parse` | `papaparse` (MIT), `fast-csv` (MIT) | Larger/older APIs; `csv-parse` has the cleanest async iterator and strict mode |
| Upload | base64 JSON | `@fastify/multipart` | Out of scope, deferred |
| UI | vanilla JS | React/Vite/etc. | Violates "no build step"; unneeded |

## Installation

```bash
# archive package (new): run from repo root
pnpm --filter @orglet/archive add @aws-sdk/client-s3@3.1161.0 pg-copy-streams@7.0.0 csv-parse@7.0.3 pg
pnpm --filter @orglet/archive add -D @types/pg-copy-streams@1.2.5
```

(For the roadmap, not executed by research: pin exact versions; the existing repo uses carets for runtime libs, so carets are also acceptable.) After install, confirm `pnpm-lock.yaml` licence set is all OSI (`@aws-sdk/*` and `@smithy/*` are Apache-2.0).

## What NOT to add

- `@aws-sdk/lib-storage`, `@aws-sdk/s3-request-presigner`, `@fastify/multipart`, `@fastify/static`: no use case in v1.2.
- MinIO or LocalStack containers in `docker-compose.yml` or CI: the filesystem `ObjectStore` covers the tests; adding services makes CI heavier and re-introduces credentials.
- Any Heimdall client or JDBC-ish dependency: orglet reads the index and the bucket directly (HEIMDALL-FORMAT.md, consequences).
- A UI framework, bundler or CSS dependency (no SLDS 2, per licensing constraint).
- `aws-sdk-client-mock` or `s3rver`-style mocks: the interface seam makes them unnecessary.
- A second CSV parser in `api`: leave Bulk ingest on `parseCsv`.

## Open items for the roadmap

1. Read `packages/schema/src/ddl.ts` and decide whether FKs are already `DEFERRABLE`; if not, a schema change plus migration is needed before COPY ordering stops mattering. I did not read ddl.ts this session.
2. Confirm `import copy from "pg-copy-streams"` compiles under NodeNext + `verbatimModuleSyntax` with `@types/pg-copy-streams` (types describe CJS `export function from`); fall back to `createRequire` only if not.
3. Re-run the pglite COPY-STDIN probe on pglite 0.5.15 / pglite-socket current before the phase starts; the upstream may have fixed the sub-protocol and then the second sink can be dropped. Licence of pglite is Apache-2.0 (0.5.15 verified).
4. Re-verify S3 client options (`forcePathStyle`, endpoint override) against current AWS SDK v3 docs before implementing; this session verified versions and licences only, not the option semantics.
5. Heimdall source says Postgres `period` and S3 key `Period` differ; the loader must trust `csvfiles.s3path` only.

## Sources

- npm registry, checked 2026-11-03: `@aws-sdk/client-s3` 3.1161.0 Apache-2.0 (engines node >=20); `@aws-sdk/lib-storage` 3.1161.0 Apache-2.0; `pg-copy-streams` 7.0.0 MIT (2025-05-27); `@types/pg-copy-streams` 1.2.5 MIT; `csv-parse` 7.0.3 MIT (2026-09-25); `pg-cursor` 2.22.1 MIT; `aws4fetch` 1.0.20 MIT; `minio` 8.0.7 Apache-2.0; `@fastify/multipart` 10.1.7 MIT; `@fastify/static` 10.1.8 MIT; `fastify` 5.12.8 MIT; `@electric-sql/pglite` 0.5.15 Apache-2.0.
- Repo reads: `packages/api/src/bulk/csv.ts`, `packages/schema/src/db.ts`, `test/db.ts`, `package.json`, `pnpm-workspace.yaml`, `.planning/research/HEIMDALL-FORMAT.md`.
- Local experiments (this session, Node 22.23.3, repo-pinned pglite 0.5.8): COPY FROM STDIN via socket fails; `/dev/blob` COPY and deferred FKs work. [Reproducible; scripts are in the session scratchpad, not the repo.]
- `pg-copy-streams` README (github.com/brianc/node-pg-copy-streams): usage pattern, pure-JS `pg` only, completion signalled by `end`. [MEDIUM]
- Not verified this session (training knowledge, LOW-MEDIUM): AWS SDK v3 endpoint/`forcePathStyle` semantics; Fastify 5 stream reply behaviour; Salesforce REST ContentVersion upload limits.
