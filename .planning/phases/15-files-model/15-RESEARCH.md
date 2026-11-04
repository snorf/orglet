# Phase 15: Files Model - Research

**Researched:** 2026-11-03
**Domain:** Salesforce Files model (ContentVersion / ContentDocument / ContentDocumentLink) on the existing orglet DML pipeline, REST blob transfer, baseline generator, Postgres migration
**Confidence:** MEDIUM-HIGH (codebase facts HIGH, verified by reading and by small probes; Salesforce behaviour MEDIUM because developer.salesforce.com returns 403 to fetches, so facts come from the vendored sf-skills snapshot, the pinned Object Reference PDF, SDK source and search excerpts)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**ContentDocumentId storage and upgrade**
- **D-01:** `ContentVersion.ContentDocumentId` is `NOT NULL` in the database and `nillable: false` in describe. The Phase 10 nullable override (`scripts/gen-baseline/overrides.json`, "omit it to create a new document") is removed. The engine always fills the column (auto-created document), so no insert in a live org can leave it null; describe and storage say the same thing.
- **D-02:** Upgrading a populated v1.1 database that holds ContentVersion rows with a null `ContentDocumentId` follows the Phase 8 rule: `migrate()` never creates, deletes or rewrites data rows. When the `NOT NULL` constraint cannot be applied because existing rows violate it, migrate skips the constraint with one counted warning per column (same pattern as `UNSUPPORTED:schema-fk`; reuse `schema-narrow` or add a sibling area, planner's call) and re-evaluates the skip on every `up`. Correcting the rows is the user's job. The phase includes an upgrade test on a populated v1.1 database; `EXPECTED_WARNINGS` gains an entry only if that fixture contains such rows.
- **D-03:** The archive-org question (PITFALLS P18: keep the column nullable in archive orgs versus loader-synthesised stub ContentDocuments) is deferred to Phase 17, decided together with the foreign-key policy D2, informed by the loader research on whether Heimdall backs up ContentDocument by default. Phase 15 builds `NOT NULL` for live orgs and must not pre-empt that choice; the ContentDocument mirror logic (D-11) should be callable outside `DmlEngine` so a stub path remains possible.

**Blob bytes: storage, cap and download**
- **D-04:** `InlineBlobStore` stores one `bytea` value per ContentVersion, outside the record table's `selectList` so rows and SOQL never carry bytes. No chunking. The `BlobStore` interface is stream-based (`open` returns a `Readable`) so chunked storage can replace it later without touching callers. The practical cap is documented.
- **D-05:** The base64 JSON upload cap is Salesforce's documented limit for non-multipart blob insert (research: ~37.5 MB file / 50 MB body; the researcher pins the exact documented figure). The researcher looks for the documented Salesforce error for an oversized body; if none is documented, orglet answers HTTP 413 with the standard error envelope and the message prefixed `UNSUPPORTED:content-size`. No environment variable for the cap. Fastify's global `bodyLimit` (64 MiB today) stays; a per-route limit may be used if the planner prefers.
- **D-06:** `GET /services/data/vXX.X/sobjects/ContentVersion/{id}/VersionData` always sends `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Content-Length` from `ContentSize`, and `Content-Type` derived from `FileExtension` through the same table as D-09 with `application/octet-stream` as fallback. No inline allow-list. Range is not supported and is declared with `Accept-Ranges: none`.
- **D-07:** MD5 is computed while streaming on every download and compared with the stored `Checksum`. A mismatch cannot change the status after headers are sent, so it is reported as a diagnostic log line once per version Id (Id, expected and actual checksum; never content). No `archive verify` command in this phase. A ContentVersion without bytes (no blob behind the reference) answers 404 `NOT_FOUND` with a clear message and a diagnostic, never empty bytes.

**Insert rules and derived fields**
- **D-08:** `Title` and `PathOnClient` are both required when inserting a ContentVersion with `VersionData`; a missing one is `REQUIRED_FIELD_MISSING` with the field name. No default Title from the filename. `FileExtension` and `FileType` derive from `PathOnClient`.
- **D-09:** `FileType` comes from a small built-in extension table (about 15 common tokens such as `PDF`, `WORD_X`, `EXCEL_X`, `POWER_POINT_X`, `PNG`, `JPG`, `GIF`, `TEXT`, `CSV`, `ZIP`, `XML`, `JSON`) with `UNKNOWN` as fallback. The researcher sources each token from public Salesforce material; unsourced tokens are left out. The same table supplies the download `Content-Type`.
- **D-10:** An insert with `FirstPublishLocationId` creates exactly one ContentDocumentLink: `LinkedEntityId = FirstPublishLocationId`, `ShareType = V`, `Visibility = AllUsers`. No owner (`ShareType I`) link is created.
- **D-11:** The ContentDocument is a view of its latest version at all times: `Title`, `FileType`, `FileExtension`, `ContentSize` and `LatestPublishedVersionId` are mirrored on document creation, on each new version, and when the version with `IsLatest = true` is updated (ContentVersion is `updateable: true` since Phase 10 D-12). Mirroring runs in the same transaction as the DML.
- **D-12:** Version bookkeeping on a second insert with an existing `ContentDocumentId`: previous latest gets `IsLatest = false`, `VersionNumber` is the ordinal as a string (`"1"`, `"2"`, ...), the document's `LatestPublishedVersionId` moves. System-computed fields (`Checksum`, `ContentSize`, `FileType`, `FileExtension`, `IsLatest`, `VersionNumber`) are never taken from the client body; the engine's existing rule for non-createable fields applies to them.

**Scope: external store and link DML**
- **D-13:** Phase 15 delivers the `BlobStore` interface (owned by `engine`; `api` reads through it), `InlineBlobStore`, and a pure, dependency-free key builder `blobKey(checksum, extension)` that returns `files/<checksum[0:4]>/<checksum>.<extension>` and validates its inputs (lowercase hex `^[0-9a-f]{32}$`, extension `^[A-Za-z0-9]{0,16}$`, reject rather than sanitise; PITFALLS P17). `FsObjectStore`, `S3ObjectStore` and `ExternalBlobStore` are Phase 17/18 work. The 404 path (D-07) is tested with an inline version that has no bytes.
- **D-14:** ContentDocumentLink supports insert, delete, undelete and update of `ShareType` and `Visibility` (picklist-validated). `ContentDocumentId` and `LinkedEntityId` are create-only. No sharing or visibility semantics are enforced (out of scope since v1.0).
- **D-15:** A new diagnostic area `UNSUPPORTED:blob-field` replaces `UNSUPPORTED:field-type` for base64 fields the baseline generator skips (`FeedItem.ContentData`, `EmailMessage.*` and the rest). `ContentVersion.VersionData` leaves that list because it is now modelled as a `base64` field. Attachment and Document stay unmodelled objects exactly as today (they are not among the Phase 10 eighteen), so `Attachment.Body` / `Document.Body` are reached only through the unmodelled-object path; FILE-09's wording is satisfied by the new token. `PROVENANCE.json`, generator tests and the check report are updated accordingly.
- **D-16:** The Phase 4 D-08 refusal of polymorphic relationships in child subqueries is kept: `SELECT (SELECT Id FROM ContentDocumentLinks) FROM Account` stays `UNSUPPORTED`. FILE-07 and the Phase 20 UI use the direct form `SELECT ... FROM ContentDocumentLink WHERE LinkedEntityId = :id`. The SOQL restriction (`MALFORMED_QUERY` without an `Id`, `ContentDocumentId` or `LinkedEntityId` filter) applies to the direct form.

### Claude's Discretion
- Where the bytea value lives (side table versus an excluded column on `contentversion`) and the exact `BlobStore` method signatures, as long as `open` streams and `put` joins the caller's transaction.
- How `GET /:type/:id/VersionData` is routed past the existing external-id route `GET /:type/:field/:value` (`packages/api/src/routes/sobjects.ts`).
- How "every keyed object" for `LinkedEntityId` is expressed given the generator only accepts explicit `referenceTo` lists limited to `objects.json` (a build-time expansion over all objects with a key prefix, including custom objects from the retrieve, is the expected shape).
- Whether ContentDocument delete cascade reuses `deleteBatch`'s `cascadeDelete` child-relationship path (which must bypass ContentVersion's `deletable: false`) or a dedicated step.
- Test strategy for memory (PITFALLS P15 suggests a large generated file with a heap assertion).
- The exact diagnostic area names for D-02 and D-07 beyond those fixed above.

### Deferred Ideas (OUT OF SCOPE)
- Owner link (`ShareType I`) on document creation, as a real org does — revisit if a conformance suite or the UI needs it.
- Child subquery over a polymorphic FK (`SELECT (SELECT ... FROM ContentDocumentLinks) FROM Account`) with the parent Id as implicit filter — backlog candidate; lifts Phase 4 D-08 for one relationship.
- Chunked blob storage and multipart upload (FILE-10) — together, when files larger than the JSON limit are needed.
- HTTP Range support (206) and an inline `Content-Disposition` allow-list for images/pdf.
- Configurable upload cap via environment variable.
- `archive verify --files` (full or sampled checksum scan) — Phase 18/21.
- `FsObjectStore`, `S3ObjectStore`, `ExternalBlobStore` — Phase 17/18 per roadmap.
- Archive-org `ContentDocumentId`: nullable column versus loader stub documents — Phase 17, with D2.
- Seeded id/clock seam for deterministic fixtures — Phase 16 (PITFALLS P23).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FILE-03 | CV insert without `ContentDocumentId` creates the document; nullable override removed; describe `nillable:false` | Generator override removal makes `nillable:false` fall out of the Object Reference properties line (verified, no `Nillable` token). `checkRequired` (engine.ts:830) would reject the insert, so the files step must pre-assign the `069` Id before it. NOT NULL needs a new `columnFor` rule and a new migrate step (neither exists). See Architecture Patterns 1 and 4. |
| FILE-04 | CV insert with existing `ContentDocumentId` adds a version, flips `IsLatest`, increments `VersionNumber`, mirrors | Same files step inside `write()` of `saveBatch`; lock the document row (`FOR UPDATE`), count/max existing versions, flip, insert, mirror. Pattern 1. |
| FILE-05 | Base64 `VersionData` accepted; server computes `Checksum`, `ContentSize`, `FileType`, `FileExtension`; multipart refused `UNSUPPORTED:content-multipart` | New FieldType `Base64`; strict base64 decode in the files step; `node:crypto` MD5; verified Fastify behaviour for a multipart content-type parser and for 413 (currently falls into the 500 branch of the error handler). Cap 50 MiB base64 / 37.5 MiB bytes. Patterns 2 and 6. |
| FILE-06 | `GET .../ContentVersion/{id}/VersionData` streams bytes with `Content-Type`/`Content-Length`; records and SOQL carry the URL; describe `base64` | Verified: a static `.../:id/VersionData` route wins over `/:type/:field/:value` in Fastify 5.12.5 (probe). jsforce `record.blob()` and simple-salesforce `get_base64()` hit exactly this URL (read from SDK source). URL injection points: `recordJson` (3 callers), SOQL select, shape. Pattern 3. |
| FILE-07 | `ContentDocumentLink` generated baseline object, polymorphic `LinkedEntityId`, `ShareType`, `Visibility`, mandatory-filter SOQL rule | ContentDocumentLink exists upstream in sf-skills at the pinned SHA and in the cached pinned PDF (not yet vendored/extracted). Generator Rule 2 would skip the whole `LinkedEntityId` field (200+ documented targets) unless overridden. Error wording found. Patterns 5 and 7. |
| FILE-08 | Deleting a ContentDocument soft-deletes versions and links; undelete restores them together | Rides `deleteBatch`/`undeleteBatch` cascade IF the baseline declares `deleteConstraint: "Cascade"` (no baseline field has any `deleteConstraint` today). A real bug lurks: set-null of `ContentDocument.LatestPublishedVersionId` during the cascade (Pitfall 1). |
| FILE-09 | Blobs behind one store interface; missing blob 404 plus diagnostic; checksum mismatch reported; `Attachment.Body`/`Document.Body` stay `UNSUPPORTED:blob-field` | `BlobStore` + `InlineBlobStore` + pure `blobKey`. Diagnostic area `blob-field` replaces `field-type` for skipped base64 in the generator. Caveat: for the unmodelled Attachment/Document the REST answer is a plain 404, so the "still answer" wording is only verifiable at generator-report level (Open Question 1). |
</phase_requirements>

## Summary

The phase is mostly wiring, not invention. The engine already has the right seams: a single `saveBatch` write loop with a per-record savepoint on one `PoolClient`, cascade delete and undelete through `schema.childRelationships`, deferred foreign keys (so the circular `ContentVersion.ContentDocumentId` / `ContentDocument.LatestPublishedVersionId` pair is no problem), and a polymorphic lookup machinery that already handles the 20-target `FirstPublishLocationId`. What is missing is (a) a `Base64` field type end to end, (b) a files step inside `saveBatch`, (c) two baseline generator changes (add `ContentDocumentLink`, model `VersionData`), (d) a new migrate capability (NOT NULL reconciliation with a skip-and-warn), and (e) the first streamed HTTP response in `api`.

The riskiest parts are not the file semantics but the places where existing generic machinery does the wrong thing for this object family. Three were found by reading code and are written up as pitfalls: the set-null step of `deleteBatch` will null `ContentDocument.LatestPublishedVersionId` while cascading (breaking "undelete restores them together"); `migrate()` has no nullability handling at all today (NOT NULL is emitted only in CREATE/ADD COLUMN, and `columnFor` makes only system fields and MasterDetail NOT NULL, so D-01 needs a new rule in two files); and the generator's Rule 2 will skip `ContentDocumentLink.LinkedEntityId` wholesale. In addition the files step must be switched off in import mode, otherwise the Phase 18 loader and the upgrade fixture would trigger document creation and version flipping.

Salesforce-side facts are good enough to implement: ContentDocumentLink Supported Calls (from the pinned Object Reference PDF) are create, delete, query, retrieve, update, upsert, with no `undelete`, and `ShareType` prose says "Required"; the exact SOQL restriction error text was found in a third-party report; the 37.5 MB / 50 MB limits come from the REST developer guide via search excerpts. FileType tokens can be sourced from the Metadata API enumeration vendored in sf-skills and from Salesforce's own apex-recipes repository.

**Primary recommendation:** Add `Base64` as a stored `bytea` column on `contentversion` that is excluded from `Store.selectList`, SOQL SQL and `Store.insert/update`; implement a `files.ts` step in `packages/engine` called from `saveBatch`/`deleteBatch` (not a TriggerExecutor, off in import mode); fix the set-null cascade bug first; do the generator work (vendor `ContentDocumentLink`, override targets and cascade, new `blob-field` area) as Wave 1 because every later task depends on the regenerated baseline.

## Project Constraints (from CLAUDE.md)

Project `./CLAUDE.md` directives that bind this phase (none contradicted by the recommendations):
- TypeScript strict (plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), Node 22, pnpm, Postgres 16, Fastify 5, vitest; ESM with `.js` extensions on relative imports; cross-package imports only through `@orglet/*` barrels, each package's public surface is its `src/index.ts` with explicit named exports (values and types separate).
- Every source file opens with a short why-comment; inline comments carry Salesforce-specific reasoning only; no obvious-code comments. Tests co-located as `*.test.ts`; test names state the invariant.
- Errors: engine errors through the `Errors.*` factory (add new kinds there), REST errors as a JSON array through `apiError`/`sendErrors`, never `reply.send([...])` by hand; new HTTP status mappings go into the central `app.setErrorHandler`, not into routes.
- `UNSUPPORTED:<area>` prefixes the message, while `errorCode`/`statusCode` stays a real Salesforce code. Warnings use the `pushDiagnostic` sink so the string and the structured `Diagnostic` never drift.
- Build only from public documentation and open-source SDK source; never diff behaviour against a real org. Apache-2.0 project, OSI dependencies only (no new dependency is needed for this phase: `node:crypto`, `node:stream`).
- Legal/data: only Level 1 data; Heimdall-format fixtures use synthetic content only.
- Existing conformance suites must stay green; generated baseline must satisfy `baseline-gen-check` and the v1-vs-v2 diff gate.
- Git: repo-local identity Johan Karlsteen <johan@karlsteen.com> (confirmed set); creating the GitHub repo/push is confirmed with Johan, not a planner concern here.
- GSD workflow: file edits go through a GSD command (this research file is the artifact of one).
- No project skills directory (`.claude/skills`, `.agents/skills`) exists.

## Standard Stack

No new dependencies. Everything needed is already in the repo or in Node 22.

### Core
| Library | Version (verified in repo) | Purpose | Why standard |
|---------|---------|---------|--------------|
| `node:crypto` (`createHash("md5")`) | Node 22.23.3 (local `~/.nvm`, `.nvmrc` = 22) | `Checksum` on insert, streaming verification on download | Built in; MD5 hex lowercase matches Heimdall's key (HEIMDALL-FORMAT.md section 4) |
| `node:stream` (`Readable`, `Transform`/`pipeline`) | Node 22 | `BlobStore.open` result, MD5-while-streaming | Built in |
| `pg` | ^8.23.0 | `bytea` read/write | A `Buffer` parameter is sent natively; probe: 30 MiB round-trip through pglite-socket + pg in ~1.9 s, bytes equal (scratchpad probe, run on Node 22) |
| `fastify` | 5.12.5 (resolved in `node_modules/.pnpm`) | Static `.../VersionData` route, multipart content-type parser, stream reply | Already the HTTP layer; behaviour probed below |
| `@electric-sql/pglite` / `pglite-socket` | 0.5.8 / 0.2.11 (root devDependencies) | Default test DB | bytea probe passed |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pdftotext` (poppler 26.04.0, `/opt/homebrew/bin`) | 26.04.0 | `pnpm baseline:snapshot -- --pdf <cached pdf>` to extract `ContentDocumentLink` into `source/object-reference/` | One-off, local only; the pinned PDF is cached at `~/.cache/orglet/object_reference-6b9d37316f09.pdf` and its sha256 equals the pin in `VENDOR.md` |
| `gh` CLI | present | `scripts/sync-sfdocs.sh <pinned sha>` to vendor `ContentDocumentLink.json` from sf-skills at revision `4bbae5c421e51b40e4169afa72c4496372a602a7` (file confirmed to exist there) | One-off |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `bytea` column on `contentversion` (excluded from select lists) | Side table inside the org schema | Side table must be added to `planSchema` or `migrate` reports it as `schema-drop` on every `up` (migrate.ts "tables no longer in the metadata" loop). Column needs only an `ADD COLUMN`. Column recommended; matches ARCHITECTURE.md sketch (d). |
| `@fastify/multipart` | Content-type parser that refuses | Multipart is FILE-10, deferred; a refusal parser needs no dependency |
| Chunked `lo_*` / chunk table | Single `bytea` | Deferred by D-04; cap keeps single value at <= 37.5 MiB |

**Installation:** none.

**Version verification:** `node -v` under nvm gives v22.23.3 (the default shell node is v18.20.8, so every command must put `~/.nvm/versions/node/v22.23.3/bin` first); `pnpm -v` 12.6.0; Fastify 5.12.5 read from `node_modules`.

## Architecture Patterns

### Recommended Project Structure
```
packages/metadata/src/types.ts          # FieldType += "Base64"
packages/schema/src/columns.ts          # sqlTypeFor Base64 -> bytea; notNull rule for ContentVersion.ContentDocumentId
packages/schema/src/migrate.ts          # NOT NULL reconciliation step with skip-and-warn
packages/engine/src/blobs.ts            # BlobStore, BlobRef, InlineBlobStore, blobKey (pure)
packages/engine/src/files.ts            # files step (decode, derive, document create, version flip, mirror, auto-link)
packages/engine/src/filetypes.ts        # extension -> { fileType, contentType } table (sourced)
packages/engine/src/engine.ts           # call sites in saveBatch / deleteBatch / undeleteBatch; Work gets `blob?`
packages/api/src/routes/sobjects.ts     # static VersionData GET route; recordJson URLs
packages/api/src/server.ts              # multipart parser refusal; 413 mapping in setErrorHandler
packages/soql/src/compile.ts, shape.ts  # Base64 select -> URL; ContentDocumentLink mandatory-filter check
scripts/gen-baseline/                   # objects.json, overrides.json, typemap.ts, pipeline.ts, sources (vendor CDL)
packages/metadata/test/fixtures/baseline-v1.1/   # frozen copy of `git archive v1.1 packages/metadata/standard` (about 1.2 MB)
conformance/files-check/                # jsforce.mjs + sf_files.py (new leg in run-all.sh)
```

### Pattern 1: Files step inside `saveBatch` (not a TriggerExecutor)
**What:** A `files.ts` module the engine calls at three points of the existing pipeline. It needs the `PoolClient`, so it cannot be a `TriggerExecutor` (hooks.ts has no client) — consistent with ARCHITECTURE.md and SUMMARY item 5.
**Where (engine.ts, current line numbers):**
1. After `w.next` is built and audit fields stamped (`:511-519`), before `runHooks "before"` (`:526`): `prepareFile(obj, w)`.
   - If `obj.name === "ContentVersion"` and not `importMode`.
   - Take `VersionData` out of `w.changes`/`w.next` into `w.blob` (a `Buffer`), so hooks, validation rules and `store.insert` never carry up to 37.5 MiB of data or a 50 MiB base64 string.
   - Enforce D-08 (`PathOnClient` required with `VersionData`; `Title` is already `nillable:false` so `checkRequired` covers it). Compute `Checksum` (MD5 lowercase hex), `ContentSize`, `ContentSizeLong`, `FileExtension`, `FileType`.
   - When `ContentDocumentId` is absent: set `w.next.ContentDocumentId = generateId("069")` now (before `checkRequired` at `:536`, which would otherwise raise REQUIRED_FIELD_MISSING because the baseline field becomes `nillable:false`) and remember `w.newDocument = true`.
2. Inside `write()` (`:546-560`) for each record, after the `SAVEPOINT rec` and before `store.insert`: `SELECT ... FROM contentdocument WHERE id = $1 FOR UPDATE` (existing document) or INSERT the new `ContentDocument` row (owner = session user, audit stamps, `IsDeleted=false`); then flip previous `IsLatest`, set `VersionNumber = max+1` as a string, set `IsLatest=true` on the new row; insert the CV row via `Store.insert`; `blobs.put(client, ref, bytes)`; update document mirror (`LatestPublishedVersionId`, `Title`, `FileType`, `FileExtension`, `ContentSize`, `ContentSizeLong`); then the auto-link for `FirstPublishLocationId` (D-10) as a `ContentDocumentLink` row. All inside the same savepoint, so a unique violation or an error only fails that record.
3. Update path (D-11): when a CV with `IsLatest=true` has `Title` changed, mirror to the document in the same transaction (place next to `store.update`).
**Order matters:** FKs are `DEFERRABLE INITIALLY DEFERRED` (ddl.ts `foreignKeySql`), so inserting the CV before the document, or the document with `LatestPublishedVersionId` pointing at a not-yet-inserted CV, is fine inside one transaction.
**Reasons to keep it callable outside `DmlEngine` (D-03):** write `files.ts` as functions taking `(client, store, ...)`, not engine privates, so a Phase 17 stub-document path can reuse the mirror function.
**Import mode:** the step must be a no-op when `this.importMode` (the Phase 18 loader and the Phase 16 fixture supply `ContentDocumentId`, `IsLatest`, `VersionNumber`, `Checksum` themselves; running the step would invent documents and flip flags). Also required to build "v1.1 rows with null ContentDocumentId" for the upgrade test (use import mode or raw SQL, because the normal path now always fills the column).

### Pattern 2: `Base64` FieldType, column and select-list exclusion
**What:** One predicate in `@orglet/schema` columns.ts, e.g. `isBlob(field)` (`field.type === "Base64"`), used by:
- `sqlTypeFor`: `bytea` (the switch is exhaustive, so adding the union member forces the compile error that finds every site: `describe.ts:describeType`, `columns.ts:sqlTypeFor`, `formula/src/values.ts:45`, `coerce.ts`).
- `Store.selectList`/`storedFields` (store.ts:21-30): exclude blobs from reads; `Store.insert`/`update` iterate `storedFields`, so excluding there also protects writes.
- `columnFor`: keep a column (nullable) in live mode; Phase 17 can return `undefined` for archive.
- `compile.ts`: select `alias.id` for a blob field and let `shape.ts` build `/services/data/v{ver}/sobjects/{Type}/{id}/{Field}` (so the bytes column is never in any SQL select). WHERE/ORDER/GROUP on a blob field must be refused (set `filterable/sortable/groupable: false` on the generated field and add a guard in `expr()` at compile.ts:240).
- `describe.ts`: `type: "base64"`, `soapType: "xsd:base64Binary"` (the current `soapType()` default returns `xsd:string`), `length: 0`, `filterable/sortable/groupable: false`.
- `rollup.ts:89` uses `SELECT c0.*` on a child table for formula roll-ups; the table has a `versiondata` column now. Only affects a formula roll-up whose child is ContentVersion; note it, do not fix.
**Migration:** `ADD COLUMN "versiondata" bytea` on the existing `contentversion` table; `normalizeType` in migrate.ts already passes `bytea` through (`information_schema.data_type` is `bytea`), so no spurious `schema-narrow`.

### Pattern 3: Download route and routing
**What:** `app.get("/services/data/v:version/sobjects/:type/:id/VersionData", ...)` registered in `registerSobjectRoutes` **before or after**, order is irrelevant: probe on Fastify 5.12.5 shows a static trailing segment beats the parametric `/:type/:field/:value` route (`/ContentVersion/068abc/VersionData` hit the blob route; `/Account/Name/Acme` and `/Account/VersionData/x` still hit the external-id route).
**Handler outline:**
```typescript
// Source: probe against fastify 5.12.5 in this repo; header contract from D-06
app.get<{ Params: { type: string; id: string } }>("/services/data/v:version/sobjects/:type/:id/VersionData", async (req, reply) => {
  const obj = objectOr404(req.params.type, reply);   // only ContentVersion has a Base64 field today
  if (!obj) return;
  const id = normalizeId(req.params.id);
  if (!id) return sendErrors(reply, 404, [NOT_FOUND]);
  const cv = (await ctx.engine.retrieve(session(req), obj.name, [id])).get(id);   // live rows only
  if (!cv) return sendErrors(reply, 404, [NOT_FOUND]);
  const opened = await ctx.engine.blobs.open(client, ref(cv));                      // undefined -> no bytes
  if (!opened) { req.log.warn(`... no blob for ${id}`); return sendErrors(reply, 404, [apiError("NOT_FOUND", "...no data for VersionData")]); }
  reply.header("content-type", ctype).header("content-length", String(size))
       .header("content-disposition", 'attachment; filename="..."')   // encode filename; never raw PathOnClient
       .header("x-content-type-options", "nosniff").header("accept-ranges", "none");
  return reply.send(opened.stream.pipe(md5Verifier(cv.Checksum, id, req.log)));
});
```
**Details the planner must carry into tasks:**
- The `onSend` hook (server.ts) sets JSON content-type only when none is set; stream payloads pass through it unchanged (hook receives the stream as `payload`). Set `content-type` explicitly.
- A mismatch is detected only at end of stream, after headers (D-07): log once per version Id (a `Set` on the route closure), include Id, expected, actual; never content. Truncated/short stream with a set `Content-Length`: destroy the reply socket on error (PITFALLS P16) instead of trying to send JSON.
- D-06 says `Content-Length` from `ContentSize`. If the inline value's `octet_length` differs (corrupted import), Node will either truncate or stall. Recommendation: `BlobStore.open` returns `size`; use it as the authority for the header when present and fall back to `ContentSize`. Flag to the planner as a small deviation from the literal D-06 text; the integrity check still compares MD5 against `Checksum`.
- `Content-Disposition` filename: derive from `PathOnClient` basename, strip control characters and quotes, add RFC 5987 `filename*=UTF-8''...`; or omit filename. Never echo raw user input.
- Deleted CV: `retrieve` excludes deleted rows, so a soft-deleted version answers 404. Acceptable and consistent with record GET.
- API version path param `v:version` matches the other routes.

### Pattern 4: NOT NULL for `ContentVersion.ContentDocumentId` and migrate (D-01, D-02)
**Facts (read):** `columnFor` sets `notNull` only for the system columns and `MasterDetail` (columns.ts:99-103); generic `nillable:false` does NOT produce NOT NULL (that would break many baseline fields that are `nillable:false` but system-filled). `migrate()` never alters nullability of an existing column; NOT NULL is emitted only inside `CREATE TABLE`/`ADD COLUMN` (`columnDdl`). So D-01 needs:
1. A targeted rule in `columnFor`. Simplest explicit form: a small set of "structurally required" fields in columns.ts (`ContentVersion.ContentDocumentId`) with a comment, or a generic `FieldDef.notNull?: true` hint carried from the baseline JSON. Prefer the explicit hint if a second case is foreseeable; the minimal change is the set. (Planner's call; must not become "nillable:false implies NOT NULL".)
2. A migrate step "step 1b" after columns exist: for each planned column with `notNull` that is currently nullable in the DB (read `information_schema.columns.is_nullable`), count NULL rows; if zero run `ALTER TABLE ... ALTER COLUMN ... SET NOT NULL`; if non-zero push a diagnostic and skip, mirroring the `schema-fk` block (migrate.ts:162-184) including `existingTables.has(plan.table)`. New area name recommendation: `schema-notnull` (sibling of `schema-fk`; `schema-narrow` is about type width, so reusing it would mislead). Message like `column contentversion.contentdocumentid holds N row(s) with NULL; NOT NULL not applied; correct them and run orglet up again`.
3. `ADD COLUMN ... NOT NULL` on a populated table fails in Postgres; this only matters if the column were new. Here `contentdocumentid` already exists in v1.1 DBs, so the rule is a separate `SET NOT NULL`. For a brand-new `contentdocumentlink` table both link columns can be created NOT NULL directly.
4. Step ordering inside migrate's single transaction: place before the roll-up backfills (those must stay last: pending deferred FK trigger events block DDL on a table, comment at migrate.ts:188-193). The counting query is a plain SELECT, safe.
5. Diff gate: the v1-vs-v2 gate (`packages/metadata/test/baseline-gate.ts`) compares only v1.0 fields at SQL-type level; ContentVersion is a Phase 10 object, so none of this is gated, and `diff-allowlist.json` stays empty. `Base64` in `sqlTypeFor` must not throw (the gate calls it on regenerated v2 fields; blob fields are new so only "present" matters, but `columnType` is evaluated for all fields of v1 objects that also exist in v2).

### Pattern 5: Baseline generator work (Wave 1)
1. **Vendor `ContentDocumentLink`**: add to `scripts/gen-baseline/objects.json` (alphabetical, between `ContentDocument` and `ContentVersion`); run `bash scripts/sync-sfdocs.sh 4bbae5c421e51b40e4169afa72c4496372a602a7` (re-copies every listed object at the same pin; unchanged files stay byte-identical; updates the sha list in VENDOR.md) — upstream file confirmed present at that SHA. Then `pnpm baseline:snapshot -- --pdf ~/.cache/orglet/object_reference-6b9d37316f09.pdf` (needs `pdftotext`, available); the cached PDF matches the pin so existing extractions should not change. Check `git diff --stat scripts/gen-baseline/source` afterwards: only `ContentDocumentLink.json` and the VENDOR.md lists should change. If other files change, stop and re-plan.
2. **`overrides.json`** entries, each needs a `reason` (validateOverrides, BASE2-01):
   - New object `ContentDocumentLink`: `keyPrefix` (see Open Question 3), `labels` (`Content Document Link` / `Content Document Links`), no flags override needed if the Supported Calls win: PDF says create/delete/update/upsert, **no undelete** (so `undeletable: false` — conflicts with D-14, Open Question 2).
   - `ContentDocumentLink.LinkedEntityId`: `set.referenceTo` = the modelled intersection (the same 20 as `FirstPublishLocationId`: Account, Asset, Campaign, Case, Contact, Contract, EmailMessage, Event, Lead, Location, OperatingHours, Opportunity, Order, OrderItem, Organization, Product2, ServiceAppointment, SocialPost, Task, User), `set.relationshipName: "LinkedEntity"`, `set.deleteConstraint: "Cascade"`. Without the `set.referenceTo`, Rule 2 (pipeline.ts:~535-546) skips the whole field because the documented list contains targets outside `objects.json`.
   - `ContentDocumentLink.ContentDocumentId`: `set.deleteConstraint: "Cascade"`, `set.childRelationshipName: "ContentDocumentLinks"` (the field is `Lookup` per the PDF; cascade is behaviour, see below). `set.updateable: false` is implied by the sources (properties `Create, Filter, Group, Sort`, no Update) — D-14 create-only — so nothing to add.
   - `ContentVersion.ContentDocumentId`: **remove** the `nillable:true` entry; add `set.deleteConstraint: "Cascade"`, `set.childRelationshipName: "ContentVersions"`.
   - `ContentDocumentLink.ShareType`: `set.picklistValues` V/C/I and `restrictedPicklist: true`; `Visibility`: `AllUsers`, `InternalUsers`, `SharedUsers`. Rule 6 deletes per-org picklist keys unless `key in set`, so they must be in the override. Values are from the Object Reference prose (read from the PDF text above).
   - `ContentVersion.VersionData`: modelled as `Base64`, `filterable/sortable/groupable: false`; decide `updateable` (Open Question 4).
   - Consider `ContentDocument.LatestPublishedVersionId` stays as generated (non-createable, non-updateable Lookup).
3. **`typemap.ts`:** `base64` is currently `{ kind: "skip", reason: "unsupported" }` (line 50). Change to a distinct reason (`"blob"`) so `pipeline.ts:490` reports `UNSUPPORTED:blob-field Object.Field (base64)` instead of `field-type`, and let a single allow-listed field (`ContentVersion.VersionData`) map to `type: "Base64"`. The PROVENANCE `skipped.fieldType` bucket splits (new `blob` key) and `baseline-generator.test.ts:291`, `build.test.ts:194` (`VersionData` no longer absent) and the report test must be updated. `D-15` says `FeedItem.ContentData` and `EmailMessage.*` stay skipped; note `EmailMessage.BccIds/CcIds/ToIds/ContentDocumentIds` are `JunctionIdList`, not base64: D-15's "and the rest" reads loosely, so decide whether only `base64`-typed skips move to `blob-field` (recommended: yes, strictly base64-typed; junction lists keep `field-type`).
4. **Build-time expansion for custom objects** (`buildOrgSchema`, build.ts after the custom/standard merge loops, before the `referenced` scan at `:704`): if `ContentDocumentLink` exists, append to `LinkedEntityId.referenceTo` every custom object (`__c` incl. custom settings excluded? see below) that has a key prefix, sorted by name, so `checkReferences`/`matchLookupTarget` accept their Ids and describe lists them. Do not add `__mdt` types (not feed-trackable) and keep it deterministic (Phase 3 sort order: `schema.list()` style). Because the expansion runs after the objects exist, the "referenced but not defined" diagnostics stay clean. Standard objects outside the generator's 20 (Quote, Pricebook2, ...) are not in the documented target list; do not add them. Records linked to an unmodelled prefix: `checkReferences` accepts unknown targets only when `targets.length !== declaredTargets`; with an explicit list a wrong prefix gives `INVALID_CROSS_REFERENCE_KEY` (same stance as `FirstPublishLocationId`, overrides.json comment).
5. **Gates:** `pnpm baseline:gen` then `git diff --exit-code -- packages/metadata/standard` (CI `baseline-gen-check`, ci.yml:129-143); `packages/metadata/test/baseline-gate.test.ts` (28 tests, currently green: verified); `documented-fields.test.ts` header notes a field-ratio budget ("53 objects ... 0.0865") which will shift when 7 CDL fields and VersionData are added; re-measure.

### Pattern 6: Insert body handling in `api`
- **Multipart refusal (FILE-05):** `app.addContentTypeParser("multipart/form-data", (req, payload, done) => done(<error>))` registered next to the XML parser, before the server starts. Probe: Fastify routes a custom error with `statusCode: 400` through `setErrorHandler`; without any multipart parser Fastify answers 415 `FST_ERR_CTP_INVALID_MEDIA_TYPE`, which `setErrorHandler` currently maps to `UNSUPPORTED_MEDIA_TYPE` "Unsupported media type" (server.ts error handler) — not the required token. Use a small `Error` subclass or the existing `errorCode` pattern (`JSON_PARSER_ERROR` precedent) and map it in the central handler to `[apiError("UNSUPPORTED", "UNSUPPORTED:content-multipart ...")]`. Status: 415 or 400; no documented value, orglet's choice (recommend 415 since it is a media-type refusal; keep one constant). jsforce multipart (`multipartFileFields`) sends `multipart/form-data` with parts named after the sObject type and the field name (jsforce `connection.ts:1004-1029`), so detection must be on the `Content-Type` header only, never on part names. The stream is never read, so no memory is spent.
- **Oversize (D-05):** a JSON body > Fastify `bodyLimit` (64 MiB) raises `FST_ERR_CTP_BODY_TOO_LARGE` with `statusCode: 413` — probe confirms. The central error handler has no branch for it and would answer **500 UNKNOWN_EXCEPTION** (and `req.log.error`). Add a 413 branch. Separately the engine must enforce the 50 MiB base64 / 37.5 MiB decoded cap itself (so composite and sobject-collection paths are protected too) and report it as a per-record `SaveError`; map that to HTTP 413 in `statusFor` (sobjects.ts:12-17 maps only NOT_FOUND/ENTITY_IS_DELETED today).
- **Documented error for oversize:** none found. The REST guide only states the limit ("50 MB of text data or 37.5 MB of base64-encoded data"), and a community thread reports a plain HTTP 400 near 35 MB. The partner-WSDL StatusCode enum (via a Teiid 7.6 Javadoc mirror, old, MEDIUM-LOW) has `MAXIMUM_SIZE_OF_ATTACHMENT`, `MAXIMUM_SIZE_OF_DOCUMENT` and `STORAGE_LIMIT_EXCEEDED`, but nothing documented binds them to ContentVersion. Follow D-05: HTTP 413, message prefixed `UNSUPPORTED:content-size`; for the code use one of those real members, recommended `MAXIMUM_SIZE_OF_DOCUMENT` (semantically closest; LOW), via a new `Errors.contentTooLarge(...)`.
- **Limit constants (D-05 pin):** base64 string length <= 50 MiB (52,428,800) which decodes to <= 37.5 MiB (39,321,600 bytes). The docs say "MB"; whether decimal or binary is not stated (LOW). Using MiB is the lenient reading; record the choice in a code comment.
- **JSON parse path:** the global `application/json` parser is `parseAs: "string"` then `JSON.parse` (server.ts:98-106). A 50 MiB body therefore exists as Buffer, string and parsed string transiently (about 3x). Acceptable with the cap; the memory test (below) should measure the whole request, not only the decode.
- **Strict base64:** `Buffer.from(s, "base64")` silently ignores invalid characters. Validate before decoding (alphabet `A-Za-z0-9+/`, optional `=` padding, length % 4 == 0 after stripping CR/LF which MIME-style encoders emit) and answer `INVALID_TYPE_ON_FIELD_IN_RECORD` via `Errors.invalidType` for `VersionData`. `coerceValue` (coerce.ts:44-117) needs a `Base64` case: keep the raw string (no length check against `field.length`) and let the files step decode; otherwise the default text branch would reject it or apply `STRING_TOO_LONG`.

### Pattern 7: SOQL mandatory filter for `ContentDocumentLink` (FILE-07)
**Rule (documented):** "a query must include a filter on Id, ContentDocumentId, or LinkedEntityId" (Object Reference, summarised in sf-skills/search). The exact error text found in a third-party report (Perficient/Coveo, 2022, MEDIUM-LOW because not from Salesforce): `Implementation restriction: ContentDocumentLink requires a filter by a single Id on ContentDocumentId or LinkedEntityId using the equals operator or multiple Id's using the IN operator.` with errorCode `MALFORMED_QUERY`. Two details to carry: the filter must use `=` or `IN` (the reported workaround was `LinkedEntityId IN (SELECT Id FROM Opportunity)`, i.e. a semi-join counts), and the shorter documented rule names `Id` too. Special Access Rules in the PDF: from API 59.0 the "Query All Files" permission lifts the requirement; orglet has no permission model, so enforce always and document it as the deviation.
**Where:** `soql/src/compile.ts`: add a `requireLinkFilter(obj, whereClause)` helper and call it in both places a query on the object is compiled: the top-level `compile` (around the `compileWhere` call at :~303) and the semi-join inner query (:~694-710, which builds its own scope and calls `inner.compileWhere`), and for `COUNT()`/aggregates (all go through the same entry). Child subqueries (`SELECT (SELECT ... FROM ContentDocumentLinks) FROM ContentDocument`) get the parent link as implicit filter (compile.ts:545-555) and must be exempt; the polymorphic child direction stays refused by Phase 4 D-08 (D-16).
**Parsing detail:** the soql-parser-js `WhereClause` is a flat chain `{left, operator, right}` with parentheses encoded as `openParen`/`closeParen` counts on the conditions (see `compileWhere`, compile.ts:~607-631), not a tree. A pragmatic and testable rule (orglet's choice, LOW on edge semantics): the query passes when, at paren depth 0, the AND-connected conditions include one on `Id`, `ContentDocumentId` or `LinkedEntityId` with operator `=` or `IN` (value list or semi-join); if depth-0 connectors include `OR`, every OR branch must carry such a condition. `LinkedEntityId != null`, `LIKE`, ranges and filters only on other fields are rejected. Error built with a new factory next to `malformed` in soql/src/errors.ts, e.g. `contentDocumentLinkFilter()` returning `SoqlError("MALFORMED_QUERY", ...)`.

### Pattern 8: Delete/undelete cascade (FILE-08)
- `deleteBatch` (engine.ts:881-916) cascades only where `child.cascadeDelete`, i.e. `FieldDef.deleteConstraint === "Cascade"`. **No baseline lookup carries a `deleteConstraint` today** (grep over `packages/metadata/standard/objects/*.json`: zero hits), so the three overrides in Pattern 5 are what activate the cascade (ContentVersion.ContentDocumentId, ContentDocumentLink.ContentDocumentId, ContentDocumentLink.LinkedEntityId).
- Cascaded children are processed with `this.deleteBatch(childObj...)` directly, not `this.delete(...)`, so `refuse()` (the `deletable:false` flag of ContentVersion) is bypassed. `engine.test.ts:338` (direct CV delete is refused) stays valid. No dedicated step is needed.
- `undeleteBatch` (:918-937) restores `cascadeDelete` children with `IsDeleted = true`; it needs no change once the cascade flags exist.
- **LinkedEntityId cascade side effect:** because `LinkedEntityId` lists ~20 targets plus every custom object, every `deleteBatch` on those objects now also runs one `childrenOf` query on `contentdocumentlink` (index `ix_contentdocumentlink_linkedentityid` is created automatically for reference fields). With `Cascade` the link rows are soft-deleted with the record, which matches the documented behaviour that a record's file links go with it; without `Cascade` the default branch would run `UPDATE ... SET linkedentityid = NULL` (see Pitfall 1) and fail a NOT NULL column.
- `ChangeEvent`s: cascaded children publish no events today either (events are built from the top-level `work` only); unchanged.
- Documented Salesforce behaviour to keep in a test comment: deleting the ContentDocument cascades to links and does not fire ContentDocumentLink triggers (Object Reference usage text); orglet's cascade calls `runHooks` for the child via `deleteBatch`, so executors would see the cascaded link delete. Note, do not change (no triggers exist in the live engine yet).

### Pattern 9: Describe/conformance changes
- `describe.ts`: types above; `nillable` for `ContentVersion.ContentDocumentId` flows from the field (`nillable:false`). Success criterion 1 is therefore satisfied by the generator change alone.
- `conformance/describe-check/objects.txt` gains `ContentDocumentLink` (33/33 per SDK); `packages/api/src/api.test.ts:382-384` asserts `toHaveLength(32)` and its object table at :58-74 needs a `ContentDocumentLink` row; `engine.test.ts:72-78` flag table and `build.test.ts:55` BUSINESS table (`ContentVersion` lookups) need updates; `object-reference-snapshot.test.ts:119-128` expects flags per object. `report.test.ts:300` uses a hard-coded synthetic census, unaffected.
- New conformance leg `conformance/files-check/` (see Validation Architecture) wired into `run-all.sh`.

### Anti-Patterns to Avoid
- **Making files a `TriggerExecutor`:** hooks get no `PoolClient`; they also run in different order and are skipped in import mode (which is correct here, but the document/version logic must be inside the transaction).
- **Letting `nillable:false` imply NOT NULL generically:** breaks every system-filled `nillable:false` field.
- **Carrying the base64 string through `w.changes`/`w.next`:** it reaches hooks, `eventsFor`, validation-rule evaluation, and `Store.insert` (which would try to write it to a bytea column as text).
- **`Buffer.from(x, "base64")` without validation:** silently corrupts input.
- **Serving user-supplied filenames or types:** always `attachment` + `nosniff`; `Content-Type` only from the table (inline SVG/HTML from a same-origin API is stored XSS, PITFALLS P16).
- **Trusting `Checksum`/`FileExtension` from a client body:** they are non-createable; `coerceRecord` already rejects them with `INVALID_FIELD_FOR_INSERT_UPDATE` (notWritable) rather than ignoring them, which is the "existing rule" D-12 refers to. A client that re-posts a retrieved record with `IsLatest` will get that error, same as a real org.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MD5 / streaming hash | own digest code | `node:crypto` `createHash("md5")`, `update` per chunk in a `Transform` | Built in; one pass while streaming |
| Cascade delete/undelete of versions and links | a bespoke "delete document" routine | existing `deleteBatch`/`undeleteBatch` + `deleteConstraint: "Cascade"` | Already handles hooks, roll-ups, savepoints, restrict/set-null semantics; only fix the set-null bug |
| Polymorphic target resolution for `LinkedEntityId` | custom prefix lookup | `matchTargetByPrefix`/`matchLookupTarget`, `checkReferences` | Same rule the compiler, parent loader and write path already share (ids.ts:46-59) |
| Version-number race | ad hoc in-memory counter | `SELECT ... FOR UPDATE` on the ContentDocument row inside the savepoint, then `max(versionnumber::int)+1` | Two concurrent inserts for one document would otherwise share a number |
| Deferred circular FK handling | extra phases/stubs | existing `DEFERRABLE INITIALLY DEFERRED` FKs | Verified in `foreignKeySql` |
| Multipart parsing | any parser | refusal parser (FILE-10 deferred) | No dependency, nothing buffered |
| Content-Type guessing | `mime` package | the small sourced table of D-09, `application/octet-stream` fallback | Dependency-free, deterministic, shared with FileType |
| Path/key safety | string sanitising | `blobKey` that rejects (`^[0-9a-f]{32}$`, `^[A-Za-z0-9]{0,16}$`) | P17: reject, never sanitise |

**Key insight:** the phase should add almost no new mechanism. The recurring failure mode is generic machinery (set-null cascade, `SELECT c0.*`, Rule 2 skip, nillable semantics, the 500 branch for 413) doing something wrong for this one object family, so the plan needs a check for each, not new abstractions.

## Runtime State Inventory

> Not a rename phase, but it changes the stored shape of an existing table in populated databases, so the equivalent question is answered.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | v1.1 databases may hold `contentversion` rows with NULL `contentdocumentid` (nullable override, no document auto-creation in v1.1). No blob data exists (VersionData was never modelled). `contentdocument` rows can only exist through import mode in v1.1 (non-createable). | Data migration NOT done by migrate (D-02). Code: new `schema-notnull` step. Test: populated v1.1 fixture with null rows (warning expected) and without (constraint applied). |
| Live service config | None. Verified: orglet holds no external service config for these objects. | None |
| OS-registered state | None. | None |
| Secrets/env vars | None; no new variables (cap is a constant, D-05). | None |
| Build artifacts / installed packages | `packages/*/dist` are rebuilt by `pnpm build` (`tsc -b`); the conformance legs run `packages/cli/dist/index.js`, so `pnpm build` must precede `conformance/run-all.sh`. `packages/metadata/standard` is a published asset (`files: dist, standard`). | Rebuild before conformance; commit regenerated `standard/` and `PROVENANCE.json` together with the generator inputs. |

Existing `_orglet` bookkeeping (key_prefixes, rollup_backfills, bulk jobs) is unaffected; the blob lives in the org schema so `orglet reset` (drops the schema) removes it.

## Common Pitfalls

### Pitfall 1: The cascade nulls `ContentDocument.LatestPublishedVersionId` (breaks undelete)
**What goes wrong:** Deleting a ContentDocument cascades to its ContentVersions via `deleteBatch(childObj ...)`. Inside that nested call `this.schema.childRelationships("ContentVersion")` includes `ContentDocument.LatestPublishedVersionId` (a Lookup to ContentVersion without `deleteConstraint`). The default branch runs `UPDATE contentdocument SET latestpublishedversionid = NULL WHERE latestpublishedversionid = ANY(<cv ids>)` (engine.ts ~:909) on the still-live document, so after undelete the document no longer knows its latest version.
**Why:** The set-null branch does not exclude rows that are themselves being deleted up the cascade stack (`deleting` is passed down but only used for roll-ups).
**How to avoid:** In `deleteBatch`, for the set-null branch skip child rows whose Id is in `deleting` (they are about to be soft-deleted) and skip the `UPDATE` when nothing remains; the general rule "do not null a pointer held by a row that is going away in the same cascade". Add an engine test: insert CV, delete document, assert `LatestPublishedVersionId` unchanged, undelete, assert all three objects live and the pointer intact.
**Warning signs:** `LatestPublishedVersionId` is NULL after a delete/undelete round trip.

### Pitfall 2: Removing the nullable override makes the insert fail before the engine can fill the column
**What goes wrong:** With `nillable:false` and not `defaultedOnCreate`, `checkRequired` (engine.ts:830) reports `REQUIRED_FIELD_MISSING: ContentDocumentId` for the very insert FILE-03 must accept.
**How to avoid:** Pre-assign the `069...` Id in the files step before `checkRequired` (Pattern 1 step 1), or alternatively mark the field `defaultedOnCreate: true` in the override (changes describe, not recommended: the describe contract is `nillable:false`, `defaultedOnCreate:false` unless a source says otherwise). A pre-assigned Id also means `checkReferences` (which only checks fields present in `w.changes`) does not try to validate the not-yet-existing document.

### Pitfall 3: `migrate()` has no nullability handling
**What goes wrong:** Changing `columnFor` alone changes nothing for existing databases (no `SET NOT NULL` is ever issued), and a naive `SET NOT NULL` aborts the whole migrate transaction on populated v1.1 data.
**How to avoid:** Pattern 4 (count first, skip with a counted diagnostic, retry each `up`). Put the diagnostic through `pushDiagnostic` so `warnings` and `diagnostics` stay 1:1; the CLI report groups by area (cli/src/report.ts), so confirm a new area prints sensibly in `orglet check --summary`.

### Pitfall 4: Generator Rule 2 silently drops `LinkedEntityId`
**What goes wrong:** The documented target list has 200+ names outside `objects.json`, so `pipeline.ts` (Rule 2) skips the entire field and `ContentDocumentLink` is generated without its link target; the `Lookup without referenceTo` check at pipeline.ts:~567 throws only if the field is kept. `baseline:gen` output lists it under `skipped.referenceTarget`.
**How to avoid:** the `set.referenceTo` override of Pattern 5; add an assertion in `baseline-generator.test.ts` next to the existing polymorphic counts (`"ContentVersion.FirstPublishLocationId": 20`, :342) for `ContentDocumentLink.LinkedEntityId: 20`.

### Pitfall 5: `FileType`/`FileExtension` required-ness and `MalwareScanStatus`
**What goes wrong:** `ContentVersion.FileType` is `nillable:false, createable:false` and `MalwareScanStatus` is `nillable:false, createable:false` with no default. `checkRequired` skips non-createable fields, so a NULL `FileType` row would pass silently while describe claims required.
**How to avoid:** the files step always sets `FileType` (`UNKNOWN` fallback, D-09). Leave `MalwareScanStatus`/`PublishStatus` as generated defaults; do not invent values (no source for the picklist). Note it, do not fix.

### Pitfall 6: Content-Length versus truncated or corrupt blob
See Pattern 3. A header that promises more bytes than the stream delivers leaves the client hanging; destroy the socket on stream error.

### Pitfall 7: Memory with a 37.5 MiB upload
The body exists as raw Buffer, parsed string and decoded Buffer, plus the pg parameter. Do not hold `VersionData` in `w.changes` (events, hooks), release `w.blob` after `put`. Test with a generated 36 MiB payload and assert peak RSS growth stays below a stated bound (not `heapUsed`, which excludes Buffers; use `process.memoryUsage().rss` or `arrayBuffers`), and do it once on pglite, not in a loop.

### Pitfall 8: `ContentDocumentLink` has audit columns a real backup will not supply
`fromStandardObject` always appends `CreatedDate`, `CreatedById`, `LastModifiedDate`, `LastModifiedById`, `SystemModstamp` (build.ts `systemFields`), and `columnFor` makes them NOT NULL. The documented ContentDocumentLink has only Id, IsDeleted, SystemModstamp, ContentDocumentId, LinkedEntityId, ShareType, Visibility (sf-skills `field_reference`). Heimdall CSVs for it will lack the four audit columns, so the Phase 18 loader must synthesise them (e.g. from `SystemModstamp`) or Phase 15 must add an object-level opt-out. This is a Phase 15 decision point because it fixes the DDL the loader writes into (Open Question 5).

### Pitfall 9: Existing tests encode the old baseline
`baseline-generator.test.ts:36` (`fixtureFiles` length 35), `:228`, `:282-291`, `:342`; `build.test.ts:55,157,174,194,205,833`; `api.test.ts:58-74,382`; `engine.test.ts:72-78,337-338`; `object-reference-snapshot.test.ts:119-128`; `documented-fields.test.ts` ratio. Budget a task for these; they will fail loudly, which is good.

## Code Examples

### blobKey (pure, validated)
```typescript
// Source: D-13 and PITFALLS P17; layout from HEIMDALL-FORMAT.md section 4
const CHECKSUM = /^[0-9a-f]{32}$/;
const EXTENSION = /^[A-Za-z0-9]{0,16}$/;

export function blobKey(checksum: string, extension: string): string {
  if (!CHECKSUM.test(checksum)) throw new RangeError("blobKey: checksum must be 32 lowercase hex characters");
  if (!EXTENSION.test(extension)) throw new RangeError("blobKey: extension must be 0-16 alphanumeric characters");
  return `files/${checksum.slice(0, 4)}/${checksum}${extension === "" ? "" : `.${extension}`}`;
}
```
Open sub-question (planner): with an empty extension, Heimdall's own key is probably `<cs>.` or `<cs>`; HEIMDALL-FORMAT.md does not say. Choose one, test it, and note it for Phase 16/18.

### BlobStore shape (matches ARCHITECTURE.md (d), D-04)
```typescript
// Source: .planning/research/ARCHITECTURE.md section (d), adjusted to D-04 (stream-based open)
export interface BlobRef { object: "ContentVersion"; id: string; field: "VersionData"; checksum: string | null; extension: string | null }
export interface BlobStore {
  readonly kind: "inline" | "external";
  /** Joins the caller's transaction (inline). */
  put(client: Queryable, ref: BlobRef, bytes: Buffer): Promise<{ checksum: string; size: number }>;
  /** undefined when there is no blob behind the reference. */
  open(client: Queryable, ref: BlobRef): Promise<{ stream: Readable; size: number } | undefined>;
}
```
`InlineBlobStore.open`: `SELECT versiondata FROM <org>.contentversion WHERE id = $1 AND versiondata IS NOT NULL`, `Readable.from([buffer])`, `size = buffer.length`. The client must not be released before the stream is consumed, or read the Buffer fully first (it is already fully in memory) and release immediately; recommended.

### Static route probe result (reproduce in a test)
```typescript
// Source: probe run in this repo, Fastify 5.12.5
// /v59.0/sobjects/ContentVersion/068abc/VersionData -> blob route
// /v59.0/sobjects/Account/Name/Acme                  -> external-id route
// /v59.0/sobjects/Account/VersionData/x              -> external-id route (field="VersionData")
```

### Multipart refusal and 413 (probed behaviours)
```typescript
// Source: probes with app.inject on Fastify 5.12.5
// A parser for "multipart/form-data" that calls done(Object.assign(new Error(...), { statusCode: 400, errorCode: "..." }))
//   -> reaches setErrorHandler with those properties (verified).
// No multipart parser -> 415 FST_ERR_CTP_INVALID_MEDIA_TYPE (verified); current handler turns it into UNSUPPORTED_MEDIA_TYPE.
// Body over bodyLimit -> statusCode 413, code FST_ERR_CTP_BODY_TOO_LARGE (verified); current handler falls to the 500 branch.
```

### FileType / Content-Type table (sourced tokens only, D-09)
| Extension(s) | FileType | Source |
|---|---|---|
| pdf | PDF | sf-skills Metadata API `FileTypeDispositionAssignmentBean` enumeration (AVI EXCEL EXCEL_X EXE FLASH HTML INSIGHT MOV MP3 MP4 MPEG PDF POWER_POINT POWER_POINT_X RFC822 SVG TXML UNKNOWN WAV WEBVIEW WMA WMV WORD WORD_X XHTML XML; described as "more filetypes exist"); apex-recipes `FilesRecipes.cls:191` |
| docx / doc | WORD_X / WORD | same enumeration; Salesforce developer blog "CodeLive: creating, finding and publishing files" (2020) states a .docx gives `WORD_X` |
| xlsx / xls | EXCEL_X / EXCEL | enumeration; apex-recipes line 191 for `EXCEL_X` |
| pptx / ppt | POWER_POINT_X / POWER_POINT | enumeration; apex-recipes line 191 for `POWER_POINT_X` |
| png / jpg / gif | PNG / JPG / GIF | trailheadapps/apex-recipes `FilesRecipes.cls:188` (`FileType IN ('JPG','GIF','PNG','JPEG')`); PNG also in the 2014 SimplySfdc list |
| txt | TEXT | SimplySfdc "Salesforce: Content Architecture" (2014, MEDIUM-LOW, dated) |
| csv | CSV | same 2014 list |
| zip | ZIP | same 2014 list |
| xml | XML | enumeration |
| html / htm | HTML | enumeration (security-risk list: serve as attachment) |
| svg | SVG | enumeration (security-risk list) |
| mp3, mp4, mov, avi, wav, wma, wmv, mpeg | same | enumeration |
| anything else | UNKNOWN | enumeration contains `UNKNOWN` |

Left out (unsourced): `JSON` (named in D-09 but no public source found for a `JSON` token, so `.json` -> `UNKNOWN`), `jpeg` (apex-recipes shows both `JPG` and `JPEG` in an IN list but no source says which one a `.jpeg` file gets; recommend leaving `.jpeg` -> `UNKNOWN`, or have Johan decide; do not guess), `LINK` (links are out of scope). `Content-Type` values come from the IANA media type registry (standard, not Salesforce) and are independent of the Salesforce token. Confidence MEDIUM overall; the enumeration is Salesforce material but the extension-to-token mapping is inferred from the token names for everything except the explicit WORD_X, PDF, JPG, GIF, PNG usages.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `ContentSize` only | `ContentSizeLong` recommended from API 65/66.0 | per sf-skills field text | Baseline already has `ContentSizeLong` (non-createable); set both on insert and mirror both on the document |
| Query without filter on ContentDocumentLink | "Query All Files" permission lifts the requirement from API 59.0 | Object Reference special access rules | orglet has no permission model: always enforce, document the deviation |
| Multipart `entity_content` naming in REST docs | jsforce sends parts named after the sObject type and the field | SDK source | Detect multipart by Content-Type only |

**Deprecated/outdated:** the 2014 file-type list (no `*_X` tokens); the REST guide's "500 MB for other objects / 2 GB for ContentVersion" multipart limits (irrelevant, multipart deferred).

## Open Questions

1. **Success criterion 5, last clause: "`Attachment.Body` and `Document.Body` still answer `UNSUPPORTED:blob-field`".**
   - What we know: neither object is modelled (D-15), so REST returns a plain 404 `NOT_FOUND`; the generator never sees them (not in `objects.json`).
   - What's unclear: whether the verifier will accept "the area token exists and base64 skips use it" or expects a runtime answer.
   - Recommendation: verify at generator-report and PROVENANCE level (`blob-field` entries for FeedItem.ContentData etc.), and ask Johan in plan review whether a one-line REST hint is wanted for `/sobjects/Attachment` and `/sobjects/Document` (404 with `UNSUPPORTED:blob-field` message). Not in scope under D-15 as written.

2. **D-14 says undelete of ContentDocumentLink; the Object Reference Supported Calls for it are create, delete, query, retrieve, update, upsert (no undelete).**
   - What we know: `undeletable` is derived from Supported Calls; cascade undelete from the document bypasses `refuse()` and works regardless. Direct `POST .../undelete` on a link would be refused with `INVALID_TYPE_FOR_OPERATION`, which matches the documentation.
   - Recommendation: keep `undeletable:false` (honest to the source) and implement "undelete" as the cascade from ContentDocument; if Johan wants direct link undelete, it needs a `flags` override with a reason. Surface to the planner as a decision, default = source wins (same stance as Phase 10 D-12).

3. **Key prefix for ContentDocumentLink.**
   - What we know: orglet memory and PITFALLS refer to `06A`; a web search could not confirm it (a search answer even suggested `05T`, unverified and probably wrong); no public prefix list was found; ContentDocument `069` and ContentVersion `068` are cited from the author's own describe in overrides.json.
   - Recommendation: `06A` with `source: "unverified"` (the schema's provenance enum allows it) and flag it in the plan; do not claim `doc`.

4. **`VersionData.updateable`.** sf-skills and the Object Reference both list `Create, Nillable, Update`, while the REST developer guide (cited in overrides.json for D-12) says ContentVersion does not support updates and the file-content change is a new version.
   - Recommendation: override `updateable: false` on `VersionData` with that reason (an update that silently replaced bytes would invalidate `Checksum`/`ContentSize` and the document mirror), and note describe will differ from the Object Reference on this one flag.

5. **Audit columns on ContentDocumentLink (Pitfall 8).** Recommendation: accept the four extra audit columns in Phase 15 (consistent with every other generated object; zero generator work) and record in the Phase 18 notes that the loader must synthesise them for this object; alternatively add an object-level opt-out. Needs a decision before the loader plan.

6. **`ShareType` required-ness.** The Object Reference prose says "Required." while its properties line lists `Nillable`. Recommendation: override `nillable: false` for `ShareType` (prose is explicit), default nothing, so an insert without it gets `REQUIRED_FIELD_MISSING`. LOW-MEDIUM; the auto-link of D-10 supplies `V` itself. `Visibility` stays nillable.

7. **Updating `ContentDocument.Title` directly.** ContentDocument `Title` is `updateable:true` and `createable:false`. D-11 defines mirroring only from version to document. A direct PATCH of the document title would diverge from the latest version's title. Recommendation: allow it as a plain update (document-only) and document the gap; or mirror downward. Needs a one-line decision; low risk either way.

8. **Duplicate links.** A real org rejects a second link of the same document to the same entity (error text not found). Recommendation: do nothing in Phase 15 (no partial unique index); revisit with the UI.

9. **`blobKey` with empty extension** (see Code Examples): `files/ab12/<cs>` versus `files/ab12/<cs>.`; check Heimdall source text before Phase 16 freezes the fixture layout (HEIMDALL-FORMAT.md says only `<cs>.<ext>`).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 22 | everything (`.nvmrc`) | yes, but not the default | v22.23.3 at `~/.nvm/versions/node/v22.23.3/bin`; default `node` is v18.20.8 | Prefix PATH in every command; the repo scripts assume 22 |
| pnpm | build/test | yes | 12.6.0 (under Node 22) | none needed |
| pglite + pglite-socket | default test DB | yes | 0.5.8 / 0.2.11; bytea 30 MiB probe passed | n/a |
| Postgres 16 (Docker) | `ORGLET_DATABASE_URL` legs, conformance | Docker client present, daemon not confirmed; `pg_isready` no response on 5432 | Docker 29.7.2 client | Default tests run on pglite; run the Postgres leg in CI; ask Johan before starting containers |
| pdftotext (poppler) | `pnpm baseline:snapshot` | yes | 26.04.0 | none (needed once) |
| Pinned Object Reference PDF | same | yes, cached | sha256 `6b9d37316f09...` equals `VENDOR.md` pin | re-download would change the pin (avoid) |
| `gh` CLI / network | `scripts/sync-sfdocs.sh` | yes | authenticated (API calls worked) | none (needed once) |
| jsforce clone for conformance | conformance legs | yes | `conformance/jsforce/.cache/jsforce` (jsforce 3.10.26) | n/a |
| Python venv for simple-salesforce | conformance legs | yes | `conformance/python/.venv` (Python 3.12 inside; system Python is 3.14.8) | n/a |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** a running Postgres for the optional real-Postgres test leg (pglite default covers the suite; CI covers Postgres).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.7 (root `vitest.config.ts`, `@orglet/*` aliased to `src/index.ts`) |
| Config file | `/Users/johankarlsteen/Development.nosync/local-salesforce/vitest.config.ts` |
| DB harness | `test/db.ts` (`openTestDb`, `usingPglite`); pglite default, Postgres with `ORGLET_DATABASE_URL`; per-run schema `test_<hex>` |
| Quick run command | `PATH=~/.nvm/versions/node/v22.23.3/bin:$PATH pnpm vitest run packages/engine/src/files.test.ts` (single file, < 30 s) |
| Full suite command | `pnpm build && pnpm test && pnpm lint && pnpm baseline:check` (then `conformance/run-all.sh` with a throwaway `ORG_SCHEMA`) |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FILE-03 | CV insert without `ContentDocumentId` creates document, `IsLatest=true`, `VersionNumber="1"`, mirrored Title/FileType/ContentSize; describe `ContentDocumentId.nillable === false`; column NOT NULL | engine integration (pglite) + metadata unit | `pnpm vitest run packages/engine/src/files.test.ts -t "creates its document"`; `pnpm vitest run packages/metadata/test/baseline-generator.test.ts` | Wave 0 (files.test.ts new) |
| FILE-03 | Insert as import mode does not run the files step | engine | `... files.test.ts -t "import mode"` | Wave 0 |
| FILE-03 / D-02 | Upgrade of a populated v1.1 DB: NOT NULL applied when no null rows; skipped with exactly one counted `schema-notnull` warning when null rows exist; rerun re-evaluates; rows untouched | upgrade integration | `pnpm vitest run packages/engine/src/upgrade-v11.test.ts` | Wave 0 (new, modelled on `upgrade.test.ts`, with new fixture `packages/metadata/test/fixtures/baseline-v1.1`) |
| FILE-04 | Second CV with existing `ContentDocumentId`: old `IsLatest=false`, `VersionNumber="2"`, document `LatestPublishedVersionId` moves, mirror updated; two inserts in one batch get 2 and 3 | engine | `... files.test.ts -t "adds a version"` | Wave 0 |
| FILE-04 | Update of latest version's Title mirrors to document; update of an old version does not | engine | `... -t "mirror"` | Wave 0 |
| FILE-05 | base64 `VersionData` yields lowercase MD5 `Checksum`, `ContentSize`, `FileType`, `FileExtension`; missing `PathOnClient` -> `REQUIRED_FIELD_MISSING`; non-base64 -> `INVALID_TYPE_ON_FIELD_IN_RECORD`; client-supplied `Checksum`/`IsLatest` -> `INVALID_FIELD_FOR_INSERT_UPDATE`; oversized -> 413 `UNSUPPORTED:content-size` | engine + api | `... files.test.ts`, `pnpm vitest run packages/api/src/files.test.ts` | Wave 0 |
| FILE-05 | multipart body -> `UNSUPPORTED:content-multipart`, nothing buffered | api (`app.inject`) | `... api/src/files.test.ts -t "multipart"` | Wave 0 |
| FILE-05 | 36 MiB upload does not blow memory (RSS bound) | api/engine perf | `... -t "large upload"` | Wave 0 |
| FILE-06 | GET streams exact bytes; headers `Content-Type`, `Content-Length`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Accept-Ranges: none`; record GET, `fields=VersionData`, composite GET and SOQL carry the URL not bytes; describe `type: "base64"`; WHERE on VersionData refused | api | `... api/src/files.test.ts` | Wave 0 |
| FILE-06 | SDK round trip: jsforce `create` with base64 and `record(id).blob('VersionData')`; simple-salesforce `ContentVersion.create` and `get_base64(id, 'VersionData')` | conformance | `conformance/run-all.sh` leg `files-check-jsforce` / `files-check-python` | Wave 0 (new `conformance/files-check/`) |
| FILE-07 | CDL baseline: fields, `LinkedEntityId` 20 targets plus custom objects, ShareType/Visibility restricted picklists; insert links to Account, Case and a custom object; unmodelled prefix -> `INVALID_CROSS_REFERENCE_KEY` | metadata + engine | `pnpm vitest run packages/metadata/src/build.test.ts packages/engine/src/files.test.ts -t "link"` | build.test.ts exists (extend); files.test.ts Wave 0 |
| FILE-07 | SOQL without `Id`/`ContentDocumentId`/`LinkedEntityId` `=`/`IN` filter (incl. `COUNT()`, `!=`, semi-join inner query) -> `MALFORMED_QUERY` with the restriction text; with filter -> passes; child subquery under ContentDocument passes | soql unit | `pnpm vitest run packages/soql/src/compile.test.ts -t "ContentDocumentLink"` | compile.test.ts exists (extend) |
| FILE-08 | Delete document soft-deletes versions and links; `LatestPublishedVersionId` unchanged (Pitfall 1); undelete restores all; delete of a linked Account soft-deletes its links; direct CV delete still refused | engine | `... files.test.ts -t "delete"`, `engine.test.ts` (existing refusal test stays green) | Wave 0 |
| FILE-09 | `blobKey` accepts valid, rejects uppercase hex, 31 chars, `../`, NUL, backslash, absolute, extension > 16 chars | pure unit | `pnpm vitest run packages/engine/src/blobs.test.ts` | Wave 0 |
| FILE-09 | Version without bytes -> 404 `NOT_FOUND` + diagnostic (not empty body); stored bytes differing from `Checksum` -> one diagnostic line per version Id, never content, response still 200 with the stored bytes | api | `... api/src/files.test.ts -t "missing blob" -t "checksum mismatch"` | Wave 0 |
| FILE-09 | Generator report lists skipped base64 fields under `blob-field`; PROVENANCE updated; `VersionData` modelled | generator | `pnpm vitest run packages/metadata/test/baseline-generator.test.ts packages/metadata/test/baseline-gate.test.ts` and `pnpm baseline:check` | exist (update) |

### Sampling Rate
- **Per task commit:** the single new/changed test file via `pnpm vitest run <file>`; `pnpm baseline:check` after any generator input change; `pnpm lint` on touched packages.
- **Per wave merge:** `pnpm build && pnpm test` (pglite) and `pnpm lint`.
- **Phase gate:** full suite green on pglite, plus `ORGLET_DATABASE_URL` Postgres 16 run (CI `test-postgres`) and `conformance/run-all.sh` green (expected describe-check total 33/33 per SDK, files-check legs PASS) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `packages/engine/src/files.test.ts` — FILE-03/04/05/07/08 engine behaviour, import-mode exemption, set-null cascade regression
- [ ] `packages/engine/src/blobs.test.ts` — `blobKey` vectors (traversal, case, length, NUL), `InlineBlobStore` put/open/no-bytes
- [ ] `packages/engine/src/upgrade-v11.test.ts` + `packages/metadata/test/fixtures/baseline-v1.1/` (from `git archive v1.1 packages/metadata/standard`, about 1.2 MB, with a README line like the v1.0 one) — D-02 both branches; null rows created via import mode or raw SQL because the live engine no longer allows them
- [ ] `packages/api/src/files.test.ts` — download headers/bytes, URL-not-bytes in record/composite/SOQL/describe, multipart refusal, 413, missing blob 404, mismatch diagnostic, memory bound
- [ ] `packages/soql/src/compile.test.ts` — CDL filter cases (extend existing file)
- [ ] `packages/schema/src/migrate.test.ts` — NOT NULL reconcile unit cases (extend existing file)
- [ ] `conformance/files-check/{jsforce.mjs,sf_files.py,README.md}` + a `leg files-check-*` pair in `conformance/run-all.sh`, plus `ContentDocumentLink` in `conformance/describe-check/objects.txt` (jsforce `record.blob()` and simple-salesforce `get_base64()` are the same URL; this is the proof that the clients "cannot tell the difference")
- [ ] Update list: `baseline-generator.test.ts`, `build.test.ts`, `api.test.ts`, `engine.test.ts`, `object-reference-snapshot.test.ts`, `documented-fields.test.ts` (Pitfall 9)
- Framework install: none.

## Sources

### Primary (HIGH confidence)
- Repository code read directly: `packages/engine/src/{engine,store,coerce,errors,hooks,query,upgrade.test}.ts`, `packages/schema/src/{columns,ddl,migrate,ids,db}.ts`, `packages/metadata/src/{build,schema,types,diagnostics}.ts`, `packages/api/src/{server,describe}.ts` and `routes/sobjects.ts`, `packages/soql/src/{compile,shape,errors}.ts`, `scripts/gen-baseline/{pipeline,sources,typemap,overrides.json,objects.json}`, `.github/workflows/ci.yml`, `conformance/run-all.sh`, `test/db.ts`
- Probes run in this session on Node 22.23.3: Fastify 5.12.5 route precedence, multipart content-type parser error flow, 413 behaviour; bytea 30 MiB round trip over pglite-socket and `pg`
- Pinned Object Reference PDF (cached, sha256 matches `VENDOR.md`): ContentDocumentLink section (Supported Calls, special access rules, ShareType/Visibility text, `LinkedEntityId` target list)
- Vendored sf-skills (Apache-2.0, Salesforce): ContentVersion/ContentDocument field descriptions; `ContentDocumentLink.json` at pinned SHA `4bbae5c421e51b40e4169afa72c4496372a602a7` via `gh api`
- jsforce 3.10.26 source in `conformance/jsforce/.cache` (`record-reference.ts:70-84` blob URL, `connection.ts:985-1030` multipart create); simple-salesforce `api.py` `get_base64` (conformance venv)
- sf-skills `FileUploadAndDownloadSecuritySettings.json` (Metadata API FileType enumeration): https://github.com/forcedotcom/sf-skills
- trailheadapps/apex-recipes `FilesRecipes.cls` (FileType tokens in queries): https://github.com/trailheadapps/apex-recipes

### Secondary (MEDIUM confidence)
- REST "Insert or Update Blob Data" limits (50 MB text / 37.5 MB base64, multipart sizes, ContentVersion update note) via search excerpts of https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/dome_sobject_insert_update_blob.htm (page returns 403 to fetch)
- ContentDocumentLink object reference (filter requirement, cascade delete does not fire link triggers), search excerpts of https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_contentdocumentlink.htm
- Salesforce developer blog, CodeLive creating/finding/publishing files (WORD_X for .docx): https://developer.salesforce.com/blogs/2020/09/codelive-creating-finding-and-publishing-files (search excerpt)
- Previous milestone research: `.planning/research/{FEATURES,PITFALLS,ARCHITECTURE,SUMMARY,HEIMDALL-FORMAT}.md`

### Tertiary (LOW confidence, flagged)
- Exact SOQL restriction error text: Perficient/Coveo blog https://blogs.perficient.com/2022/07/13/coveo-how-to-fix-contentdocumentlink-requires-a-filter-by-a-single-id (third party, search excerpt; the page itself did not render the text on fetch)
- StatusCode members `MAXIMUM_SIZE_OF_DOCUMENT`, `STORAGE_LIMIT_EXCEEDED`: Teiid 7.6 Javadoc mirror of the partner WSDL, https://docs.jboss.org/teiid/7.6.0.Final/apidocs/com/sforce/soap/partner/StatusCode.html (old)
- `.csv`/`.txt`/`.zip` FileType tokens: SimplySfdc 2014 "Salesforce: Content Architecture" (dated)
- Key prefix `06A`: not confirmed by any public source found

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; versions read from the repo; bytea and Fastify behaviour probed.
- Architecture: HIGH for integration points and pitfalls (read from code with line numbers, three bugs found by reading and cross-checking), MEDIUM for the SOQL filter edge semantics and Content-Length handling.
- Salesforce facts: MEDIUM — official pages unreachable (403); claims rest on the vendored Apache-2.0 sf-skills data, the pinned Object Reference PDF, SDK source and search excerpts. Items marked LOW above need Johan's confirmation (key prefix, oversize StatusCode, `.jpeg`/`.json` tokens, decimal vs binary MB).
- Pitfalls: HIGH — each is tied to a concrete code location.

**Research date:** 2026-11-03
**Valid until:** 2026-12-03 for codebase facts as long as Phase 15 is the next change to the engine, baseline and migrate code; the Salesforce-doc items do not decay quickly.
