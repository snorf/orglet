# Architecture Patterns: v1.2 archive mode

**Domain:** read-only archive of a former Salesforce org on top of orglet (Heimdall backup + SFDX retrieve)
**Researched:** 2026-11-03
**Scope:** only how the NEW features integrate with the existing architecture (v1.1 file preserved in git).
**Overall confidence:** MEDIUM-HIGH for integration points (read from source), MEDIUM for status-code choice, LOW for pglite COPY behaviour (not verified).

## Recommended Architecture

Package order stays acyclic. One new package, `@orglet/archive`, sits beside `api`, after `engine`:

```
metadata -> schema -> {formula, soql} -> engine -> { api, archive } -> cli
```

- `archive` depends on `metadata`, `schema`, `engine`. It never imports `api`.
- `api` never imports `archive`. It sees blobs only through the `BlobStore` interface that lives in `engine`.
- `cli` wires everything: it builds the concrete `ExternalBlobStore` from `archive` and hands it to `DmlEngine`.

```
Heimdall Postgres index --(IndexSource, SQL)--+
Object store (S3 | fs mirror) --(ObjectStore)--+--> @orglet/archive loader --COPY--> org.<tables>  (+ _orglet.org_mode row)
                                               |
 orglet up (reads _orglet.org_mode) --> freezeCalculatedFields(schema) --> migrate (archive DDL variant)
        --> DmlEngine{mode:"archive", blobs: ExternalBlobStore(ObjectStore)} --> api (REST, Bulk query, UI)
```

### Component Boundaries (NEW vs MODIFIED)

| Component | New / Modified | Package / path | Responsibility |
|-----------|----------------|----------------|----------------|
| Streaming CSV parser | MODIFIED (moved + extended) | `packages/api/src/bulk/csv.ts` -> `packages/engine/src/csv.ts`, exported from engine | One RFC 4180 state machine, whole-text `parseCsv` kept, new incremental/streaming variant for 50K-200K-row Heimdall files. api imports it from `@orglet/engine` (3 import sites: `routes/bulk.ts`, `bulk/store.ts`, `bulk/jobs.ts`). |
| `FieldType "Base64"`, `FieldDef.frozen?: true` | MODIFIED | `packages/metadata/src/types.ts` | Blob field type; `frozen` marks a formula that is stored in archive mode. |
| `freezeCalculatedFields(schema)` | NEW | `packages/metadata/src/freeze.ts` | Pure transform: returns a new `OrgSchema` where every `formula` field carries `frozen: true`. `formula`/`rollup` stay, so describe keeps `calculated: true` and `calculatedFormula`. |
| `isVirtual` | MODIFIED | `packages/schema/src/columns.ts` | `(formula !== undefined && !frozen) || compound`. Single choke point: DDL (`columnFor`), `Store.storedFields`/`selectList` follow automatically. |
| `sqlTypeFor` / `planTable` archive variant | MODIFIED | `packages/schema/src/columns.ts`, `ddl.ts` | `PlanOptions {archive}`: frozen Text-like formulas -> `text`, frozen Number-like -> unconstrained `numeric` (formula fields have no `length`/`precision`, defaults `varchar(255)`/`numeric(18,0)` would truncate backed-up values); no FKs; unique indexes become plain or partial (`WHERE isdeleted=false`). `migrate(pool, schema, {mode})` passes it through. |
| `_orglet.org_mode` | NEW | `packages/schema/src/mode.ts` (pattern of `backfills.ts`) | Row per org schema: `mode` (`normal`/`archive`), `as_of`, `loaded_at`, `source` label, `blob_store` JSON (kind, root/bucket/endpoint/prefix; never credentials). |
| `BlobStore` interface + `InlineBlobStore` | NEW | `packages/engine/src/blobs.ts` | See "Blob store". |
| Files platform behaviour | NEW + MODIFIED | `packages/engine/src/files.ts`, called from `engine.ts` `saveBatch` next to `applyPlatformRules` and before `checkRequired` | ContentVersion insert: checksum (MD5), size, FileExtension from PathOnClient, auto-create ContentDocument, IsLatest/VersionNumber, ContentDocumentLink for `FirstPublishLocationId`. Needs the DB client, so it cannot be a `TriggerExecutor` (`TriggerContext` has no client). |
| Read-only refusal | MODIFIED | `packages/engine/src/engine.ts` | `EngineOptions.mode`; first statement in `insert/update/upsert/delete/undelete` (before the existing `refuse()`). |
| `DmlEngine` options | MODIFIED | `engine.ts` | `mode?: "normal"\|"archive"`, `blobs?: BlobStore` (default inline). |
| Archive login/bootstrap | MODIFIED | `packages/engine/src/bootstrap.ts` (`bootstrapArchive`: synthetic ids, NO inserts), `packages/api/src/auth.ts` (`loginAs` falls back to a synthetic viewer session when mode is archive and no User row matches) | Today `bootstrapOrg` inserts an admin User/Profile/Organization into the data tables and `loginAs` requires a User row. Both would pollute or break an archive. |
| VersionData route | NEW | `packages/api/src/routes/sobjects.ts` (or `routes/files.ts`) | `GET /sobjects/ContentVersion/:id/VersionData` streams from `engine.blobs`; same for Attachment-style `Body` if ever modelled. |
| SOQL Base64 shaping | MODIFIED | `packages/soql/src/shape.ts`, `compile.ts` | Base64 fields never reach SQL; shape emits the relative VersionData URL (what Salesforce returns for blob fields in a query). |
| Frozen-formula SOQL | MODIFIED | `packages/soql/src/compile.ts` (4 sites test `f.formula === undefined`: ~lines 232, 240, 344, 543) | Replace with `isComputed(f)` = `formula !== undefined && !frozen`. Side effect (archive mode only): WHERE/ORDER BY/parent-relationship selection of formulas works (closes 999.12 for archive). |
| `FormulaRegistry` | MODIFIED | `packages/engine/src/formulas.ts` | Skip frozen formulas (no compile, no warnings); in archive mode also skip rules/defaults (DML is refused). `applyFormulaFields` then no-ops. |
| Index source | NEW | `packages/archive/src/index-source.ts` | `PostgresIndexSource(pool, schemaName)`: version selection SQL (below). One implementation; works on pglite and Postgres, so the fixture index is just those two tables in a scratch schema. |
| Object store | NEW | `packages/archive/src/object-store.ts` | `ObjectStore { open(key): Promise<Readable>; exists(key) }`; `FsObjectStore(root)` and `S3ObjectStore({bucket, endpoint, region, forcePathStyle})` on `@aws-sdk/client-s3` (Apache-2.0; credentials only from the default provider chain). |
| Key builders | NEW | `packages/archive/src/keys.ts` | `blobKey(orgPrefix, checksum, ext)` -> `OrgId=<org>/Period=0/files/<cs[0:4]>/<cs>.<ext>`; `csvKey(...)`; `normalizeS3Path(s3path)` (strip `s3://bucket/`). Used by loader, server read path AND fixture generator, so the three cannot drift. |
| Loader | NEW | `packages/archive/src/load.ts` | Version selection, CSV stream, per-cell coercion, COPY, diagnostics, `org_mode` write. |
| `ExternalBlobStore` | NEW | `packages/archive/src/external-blobs.ts` | Implements engine's `BlobStore` over `ObjectStore` + `blobKey`. |
| Erasure | NEW | `packages/archive/src/erase.ts` | Raw-SQL hard delete + `_orglet.erasure_log`; bypasses `DmlEngine` deliberately. |
| CLI | MODIFIED | `packages/cli/src/main.ts` (+ new `archive.ts`) | `orglet archive load`, `orglet archive erase`; `up` reads `org_mode`. Extract the shared "prepare org" steps of `up` (load schema, reconcile prefixes, migrate) into a function both commands call. |
| Baseline | MODIFIED | `scripts/gen-baseline/overrides.json` (+ `typemap.ts`), regenerated `packages/metadata/standard/objects/*.json` | ContentVersion `VersionData` (Base64) generated instead of omitted; `ContentDocumentLink` added; Phase 10 nullable `ContentDocumentId` override (overrides.json ~line 326) removed. `baseline-gen-check` and the v1-vs-v2 diff gate must stay green. |
| UI | MODIFIED | `packages/api/ui/` | Split into static files, see UI. |
| Fixture generator | NEW | `scripts/gen-archive-fixture/` | See Fixture. |

## (a) Loader placement, reuse, COPY, Ids

**Decision: new package `@orglet/archive`.** Not `schema` (needs engine coercion; would invert the order), not `cli` (untestable without spawning, and `cli` is the leaf), not `api` (the loader must run without HTTP; the only thing it wants from api is the CSV parser, which is pure and moves down to `engine`).

**CSV reuse:** `git mv` `csv.ts` into `packages/engine/src` and extend it with a streaming parser sharing the same state machine. The existing `parseCsv(text)` buffers whole files and cannot be used on Heimdall CSVs. Value coercion reuse: `coerceValue(field, raw)` (already exported from engine) turns Bulk-2.0 strings into canonical values (Id normalised, `true/false`, DateTime normalised to `+0000`). Create one *lenient* `FieldDef` per column up front (`picklist.restricted=false`) because a retired picklist value in old data must not reject a row; length overflow stays an error (see Pitfalls).

**COPY bypasses `DmlEngine` on purpose.** The loader is a data load, not a save: no hooks, rules, roll-up recompute, audit stamping, change events. This is the same contract as `backfillFormulaRollups` ("a data load, not a save"). Consequence to state in docs: the archive tables have exactly the backed-up values; `engine.importMode` is not used.

**FK handling (decision for the roadmap):** requirement text says "FK checks deferred". Recommendation: archive-mode DDL creates **no foreign keys** (and drops uniqueness to plain/partial indexes). Reason: a Heimdall backup is partial (deactivated users, unreplicated objects, purged parents), so dangling references are normal and an FK would be a false claim; no FK also makes cycles and ordering irrelevant and COPY faster. Existing machinery stays valid: SOQL parent joins are LEFT JOINs. Post-load, the loader runs an anti-join census per reference column and prints it as an `info`/warning count (dangling references), never silently. Fallback if FKs are wanted: load under `SET LOCAL session_replication_role = replica` exactly as `DmlEngine.run` does for import mode.

**Target must be empty.** `archive load` requires a fresh org schema (or `--reset`), runs prepare (metadata -> `freezeCalculatedFields` -> prefixes -> `migrate` in archive variant), loads everything in one transaction per object (or one overall), then writes the `org_mode` row last, so a crashed load never looks like a finished archive. Use a dedicated schema (`--org-schema archive`).

**Version selection** (per object, `IndexSource`):

```sql
SELECT DISTINCT ON (id) id, version, csv_id, is_deleted
FROM objects WHERE org_id = $1 AND object_name = $2 [AND version <= $asOfEpoch]
ORDER BY id, version DESC
```

Group the result by `csv_id`; resolve `csvfiles.s3path` (strip `s3://bucket/`); stream each CSV once; keep a row iff `Id` is in that csv's wanted map and `SystemModstamp` epoch-seconds equals the selected `version`. Periods differ between S3 (`202602`, `Archive-202602`) and Postgres (`2602`, `-2602`): never parse periods, only follow `csv_id -> s3path`.

**Columns:** header ∩ stored schema fields -> `COPY org.t (cols) FROM STDIN`. CSV columns the retrieve lacks -> one `UNSUPPORTED:archive-column` diagnostic per object/column (never dropped silently), except a column that matches a *derived compound* field (Contact `Name`), which is skipped quietly. Schema columns absent from the CSV stay NULL (Checkbox gets its `false` default; report it). Frozen formula and roll-up columns load verbatim. COPY transport: `pg-copy-streams` (MIT) on a `pg` client.

**pglite risk (LOW confidence, unverified):** tests use pglite behind `pglite-socket`; support for `COPY FROM STDIN` over that wire path was not confirmed (search found nothing). Day-1 spike in the loader phase. Planned fallback: a `LoadSink` strategy with `copy` (Postgres) and `insert` (batched `INSERT ... SELECT FROM unnest($1::text[], ...)`), CI runs `insert` on pglite and both on Postgres.

**Ids, audit fields, key prefixes:**
- Ids and audit fields (`CreatedDate`, `SystemModstamp`, `IsDeleted`, `OwnerId`, ...) are copied as backed up; 15-char Ids go through `normalizeId`.
- Custom-object key prefixes are **derived from the data** before `migrate`: `objects.object_name` + first three characters of any `id` -> a mapping fed to the existing `reconcileKeyPrefixes({mapping})` (same path as `--key-prefixes`). Conflicts with standard or persisted prefixes fail the load through the existing `KeyPrefixError`. `--key-prefixes` still overrides/seeds.
- Standard objects with `keyPrefix: null`: no check, load as is, report the observed prefix in the summary (do not adopt it; honesty rule from Phase 8). Non-null prefix mismatch -> row reject, counted.
- `_deleted` CSVs: rows already carry `IsDeleted=true`; `is_deleted` from the index decides nothing beyond selection.

## (b) Archive mode representation and write refusal

**Persist in `_orglet.org_mode`, detect in `up`.** Not a CLI/env flag: archive-ness is a property of the data (stored formula columns, no FKs, external blobs). A flag would let `up` start an archive as a normal org (formulas silently virtual, columns ignored, `backfillFormulaRollups` and `seedCustomMetadata` writing) or start a normal org as archive. `reset` deletes the org's row (like `rollup_backfills`). `up` has no `--archive` flag; it reads the row before `loadOrgSchema` post-processing:

1. mode archive -> `freezeCalculatedFields(schema)`; skip `admitFormulaRollups` removal (rejected roll-ups would lose backed-up columns; verify the `rollup-relationship` degrade path too); skip `bootstrapOrg`, `backfillFormulaRollups`; use `bootstrapArchive`; construct `ObjectStore` from the persisted `blob_store` config and `ExternalBlobStore`; engine `{mode:"archive"}`.
2. `/orglet/status` (new, outside `/services`) returns `{mode, asOf, loadedAt}` for the UI banner.

**Refusal point: one check at the choke point.** Every writer (REST sobjects, composite, composite/tree, Bulk ingest chunks via `{transaction}`, upsert) reaches `DmlEngine.insert/update/upsert/delete/undelete`, which already begin with `this.refuse(...)`. Add `if (this.mode === "archive") return Array.from({length: count}, () => failure([Errors.readOnlyArchive()]))` ahead of it. No new executor (executors are skipped for refused work and run after validation; wrong place). Optional cheap guard at Bulk ingest job creation so no job rows are created.
- Status code: use real StatusCode `INSUFFICIENT_ACCESS_OR_READONLY` (documented Apex StatusCode member) with a message naming archive mode; extend `statusFor` in `sobjects.ts` to map it to 403. **MEDIUM-LOW confidence**: verify against the StatusCode enum docs in the phase; no document found that says what a read-only org returns. Describe is NOT altered (flags remain the retrieve's truth); refusal is behavioural.
- Other writers that must not run in archive mode: `bootstrapOrg`, `seedCustomMetadata` (decide: keep only for types absent from the backup; its hash-derived Ids differ from the real org's), `backfillFormulaRollups`, Bulk reconcile/purge (those write only `_orglet.bulk_*`, fine).

**GDPR erasure: CLI only, never over HTTP.** An HTTP header or scope that bypasses read-only defeats the mode. `orglet archive erase --object X (--id ... | --ids-file f)` runs in-process in `@orglet/archive/erase.ts`: raw `DELETE` through `Store`/SQL (not `DmlEngine`; the engine remains the sole writer in a running server, the archive package is the documented second writer), optional master-detail cascade, writes `_orglet.erasure_log(org_schema, object_name, id, erased_at, reason)`. The loader consults the log so a re-load never resurrects erased records (the log survives `reset` unless `--drop-erasures`). Parent roll-ups stay at their frozen values by design. **Honest limit:** blobs are deduplicated by checksum in the backup store and orglet never owns that store; erasing the row removes orglet's reference only. State in docs and logs.

## (c) Frozen formula and roll-up fields

Today: formula = `isVirtual` -> no column, evaluated per row in `Engine.project()` by `applyFormulaFields`; roll-up = stored column recomputed by the pipeline.

Change in archive mode only, through one flag and one predicate:
1. `freezeCalculatedFields` sets `frozen: true` (metadata, pure, called by cli after `loadOrgSchema`).
2. `isVirtual` returns false for frozen formulas -> `columnFor` creates the column, `Store` selects/inserts it, `migrate` adds it additively. Type comes from the formula return `type` through `sqlTypeFor`, with the archive text/numeric widening described above.
3. SOQL: `isComputed` replaces `formula !== undefined` (4 sites) so the column is selectable, filterable, sortable, usable through parent relationships. Normal-mode behaviour unchanged (frozen absent).
4. Engine: registry ignores frozen formulas, so there is nothing to evaluate and `project()` loads no parents for them.
5. Describe: `calculated: f.formula !== undefined || f.rollup !== undefined` (`describe.ts:114`) needs no change because `formula` is retained. Add a test pinning it.
6. Roll-ups need nothing structural (already columns); they simply never recompute because DML is refused; keep them out of `admitFormulaRollups` removal.
7. Never mix: any code that checks `field.formula !== undefined` to mean "not stored" must be audited (known: `coerce.ts` writability, `engine.ts checkRequired`, `soql/compile.ts`, `describe.ts`, `store.ts` via `isVirtual`). Grep gate in the phase.

## (d) Blob store

Interface (owned by `engine`, because engine performs writes and api reads through `engine.blobs`):

```ts
export interface BlobRef { object: string; id: string; field: string; checksum: string | null; extension: string | null }
export interface BlobStore {
  readonly kind: "inline" | "external";
  /** inline only; external stores throw (archive mode never writes). Joins the caller's transaction. */
  put(client: Queryable, ref: BlobRef, bytes: Buffer): Promise<{ checksum: string; size: number }>;
  /** undefined when the record has no blob. */
  open(client: Queryable, ref: BlobRef): Promise<{ stream: Readable; size?: number; contentType?: string } | undefined>;
}
```

- `InlineBlobStore` (engine, default): `bytea` column `versiondata` created in normal mode, written in the insert transaction (`put`), read by `open` with a dedicated `SELECT`. `Store.selectList` excludes `Base64` fields so rows and SOQL never carry bytes.
- `ExternalBlobStore` (archive): `open` builds `blobKey(orgPrefix, ref.checksum, ref.extension)` from the record's own `Checksum` and `FileExtension` columns (read by the route/`open` caller) and returns `ObjectStore.open(key)`. Missing key -> 404 `NOT_FOUND` plus a one-time `UNSUPPORTED:blob-missing` log (a Heimdall skip-below-KB or deleted CV is expected).
- Archive DDL: `VersionData` has no column in archive mode (external), so `columnFor` returns undefined for `Base64` when `archive`.
- REST: JSON body with base64 `VersionData` first; multipart (`entity_content` + binary part, needs `@fastify/multipart`, MIT) is a second step; large uploads otherwise flagged `UNSUPPORTED:blob-multipart`.
- Fixture parity: the generator calls the same `blobKey` to write `examples/<fixture>/store/OrgId=.../Period=0/files/ab12/ab12....txt`; `FsObjectStore(root)` mirrors the bucket key layout 1:1.
- Credentials are never persisted in `org_mode`; S3 uses the SDK default chain, fs needs none.

## (e) Fixture generation and CI

`scripts/gen-archive-fixture/` (tsx, `tsconfig.scripts.json`), same pattern as `scripts/gen-baseline`; output `examples/acme-backup/` (`store/` mirror, `index/` dump).
1. Boot in process on pglite/Postgres: `loadOrgSchema(examples/acme)`, migrate, `DmlEngine` in **import mode** with explicit Ids/timestamps/org id for byte-for-byte determinism. Seed data from a checked-in JSON seed.
2. Import mode skips roll-up recompute: generator runs `rollupBackfillSql` per roll-up (ordered by `rollupDepth`) and `engine.backfillFormulaRollups()`.
3. Start `createApiServer` and drive Bulk 2.0 with `app.inject` (no port): `POST jobs/query` per object with Heimdall's field order (describe order, minus address/base64/`Tier`/Id/SystemModstamp, then `SystemModstamp`, then `Id`), `operation: queryAll` + `IsDeleted = true` for `<Object>_deleted/`, page `maxRecords=2000` following `Sforce-Locator`, concatenating pages under one header; split across several CSVs and two periods (full snapshot, then an increment after mutations and deletes) so latest-version and as-of are exercised.
4. Write CSVs under `OrgId=<fake>/Period=<yyyymm>/Year=/Month=/Date=/<Object>[_deleted]/<deterministic-job-id>.csv` (job ids rewritten to a fixed sequence).
5. Write the index dump independently of the loader (its own small CSV scan): `index/schema.sql` (Heimdall `csvfiles`/`objects` DDL), `csvfiles.csv`, `objects.csv` (`version` = SystemModstamp epoch seconds, `metadata` per Heimdall rules, `name`, `is_deleted`).
6. ContentVersion: few small deterministic blobs, two CVs sharing one checksum (dedup), `Checksum` stored.
7. Constraint: acme formulas must not use `NOW()/TODAY()` (volatile output breaks determinism); check before relying on it, else inject a clock.

CI: loader tests live in `packages/archive/src/*.test.ts` on `test/db.ts`, so they run on **pglite in `test-pglite` and on Postgres 16 in `test-postgres`** with no new job. The test helper creates a scratch schema, applies `index/schema.sql`, `\copy`-equivalent loads the dump (plain INSERT from parsed CSV), then runs the real loader into an org schema. Add `archive-fixture-check` (regenerate + `git diff --exit-code`, like `baseline-gen-check`) and a conformance leg `archive-check` (jsforce + simple-salesforce read the archive-mode server, assert DML refusal). S3 path tested against an in-process Fastify stub speaking path-style `GET /bucket/key`, no MinIO.

Caveat to document: the fixture is orglet's *approximation* of Heimdall's output derived from the documented format, so it proves the loader parses the documented shape, not that every real backup loads.

## (f) UI

Stay vanilla JS, but **split the single 242-line `index.html`** into a few static files, served by a manual allowlist route in `server.ts` (`GET /ui/:file` for `app.css`, `api.js`, `browse.js`, `soql.js`, `main.js`; read once at startup; no `@fastify/static`). `<script type="module">`. The existing record tab/SOQL console move into `soql.js` unchanged.
- **Search without SOSL:** per object, from describe: fields with `nameField` or type `Email`/`Phone`; `SELECT Id, <name> FROM X WHERE <name> LIKE '%q%' OR Email LIKE '%q%' LIMIT 50`, with SOQL LIKE escaping. Cross-object search is a bounded fan-out over the objects the user picked; document that `LIKE '%q%'` is a sequential scan on big tables. Optional later: `pg_trgm` GIN indexes at archive load (extension availability must be reported, not assumed).
- **Record view:** describe fields in order, null fields hidden; lookups render as links `#/r/<Type>/<Id>` where Type is resolved by key prefix from global describe (polymorphic included); formula/roll-up values come straight from stored columns.
- **Related lists:** `childRelationships` from the object describe; each list lazy-loads `SELECT Id, <name field> FROM Child WHERE <field> = '<id>' LIMIT 10` plus `SELECT COUNT()`. Files list: `ContentDocumentLink` where `LinkedEntityId = id`, traversing `ContentDocument.Title` and `LatestPublishedVersionId`.
- **File download:** the bearer token is in sessionStorage, so a plain `<a href>` cannot authenticate. `fetch` with the header, then a blob URL with the filename. Large files are held in browser memory (documented limit).
- Archive banner from `/orglet/status`; write controls hidden.

## Data flow changes

| Flow | Before | After |
|------|--------|-------|
| Startup | schema -> prefixes -> migrate -> bootstrap -> seed -> engine | + read `org_mode`; archive: freeze, archive DDL, no bootstrap/seed/backfill, external blobs |
| Write | any route -> `DmlEngine` | archive: refused at `DmlEngine` entry with a Salesforce StatusCode; only `archive load`/`erase` write |
| Formula read | evaluated in `project()` | archive: stored column, SQL-selectable |
| Blob | omitted | normal: bytea via `InlineBlobStore`; archive: key from Checksum+FileExtension via `ExternalBlobStore` |
| Query of a Base64 field | n/a | URL string, never bytes |

## Anti-Patterns to Avoid

- Putting the archive bypass behind an HTTP header or token scope (defeats read-only).
- Routing the loader through `DmlEngine` import mode (per-record savepoints, no COPY, roll-ups/hooks semantic confusion).
- A CLI-only `--archive` flag at `up` with no persisted mode.
- Implementing Files side effects as a `TriggerExecutor` (no DB client in `TriggerContext`).
- Copying blobs into Postgres in archive mode (requirement is to read from the backup store).
- Inventing prefixes or objects for data the retrieve lacks: always `UNSUPPORTED:archive-*` diagnostics.
- Keeping two CSV parsers (api copy and archive copy).

## Suggested Build Order

Dependencies: Files model and Base64 precede the fixture (CVs with Checksum) and the loader (tables must exist); archive DDL precedes the loader (stored formula columns); the fixture precedes loader tests; UI needs only REST plus the VersionData route.

1. **Foundations + Files model (normal mode):** move/extend CSV parser, `Base64`, `BlobStore`/`InlineBlobStore`, ContentDocumentLink baseline (+ LinkedEntityId polymorphism over all keyed objects, resolved by prefix, no FK), ContentVersion bytea, auto ContentDocument/Link/Checksum in `files.ts`, VersionData route, SOQL URL shaping, nullable override dropped, baseline regenerated, upgrade test on a populated v1.1 DB.
2. **Fixture generator + committed `examples/acme-backup`** (can overlap with 3).
3. **Archive schema mode:** `org_mode`, `frozen`/`isVirtual`/`isComputed`, archive DDL variant (no FK, plain uniques, text/numeric widening), `up` mode detection and skips, synthetic bootstrap/login, engine refusal + status code mapping, `/orglet/status`. Testable by loading rows through SQL before the loader exists.
4. **Loader:** `IndexSource`, `ObjectStore` (fs first, S3 second), key builders, prefix derivation, version selection and as-of, streaming COPY (with the pglite spike and `insert` fallback), diagnostics/rejects/dangling census, `ExternalBlobStore`, `archive load` CLI.
5. **Erasure:** `archive erase`, `erasure_log`, loader tombstone check.
6. **Conformance leg `archive-check`** and `archive-fixture-check` CI job.
7. **UI** (may start after step 1 on normal mode, final verification against the archive fixture).

## Research flags for phases

| Phase | Flag |
|-------|------|
| 1 | Deeper: ContentDocumentLink (LinkedEntityId over all objects), Files side-effect semantics (versions, IsLatest, sharing), multipart upload |
| 3 | Deeper: StatusCode for read-only; audit of every `formula !== undefined` meaning; `rollup-relationship` degrade vs archive columns |
| 4 | Deeper: pglite COPY spike, memory/throughput on 100s-MB CSVs, S3 SDK footprint, length-overflow reject policy, real-world dangling refs |
| 5 | Deeper: GDPR semantics (cascade, anonymise vs delete), blob dedup limit |
| 2, 6, 7 | Standard patterns |

## Scalability

| Concern | Fixture | 1M records | 50M records |
|---------|---------|------------|-------------|
| Load | seconds | one CSV pass per file, COPY; fine | hours; per-file transactions, resumable by `org_mode` last |
| Search `LIKE '%q%'` | instant | seq scan seconds | needs `pg_trgm` or restrict to name prefix |
| Blobs | local fs | S3 GET per download | same; no copy |

## Sources

- Repo files read (HIGH): `packages/engine/src/engine.ts`, `hooks.ts`, `formulas.ts`, `bootstrap.ts`, `store.ts`, `coerce.ts`; `packages/schema/src/ddl.ts`, `columns.ts`, `migrate.ts`, `backfills.ts`, `internal.ts`; `packages/api/src/server.ts`, `auth.ts`, `routes/sobjects.ts`, `routes/bulk.ts`, `bulk/csv.ts`; `packages/soql/src/compile.ts`; `packages/cli/src/main.ts`; `packages/api/ui/index.html`; `.planning/research/HEIMDALL-FORMAT.md`.
- pglite COPY FROM STDIN behaviour: not found in docs (LOW; spike required).
