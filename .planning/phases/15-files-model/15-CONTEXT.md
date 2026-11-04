# Phase 15: Files Model - Context

**Gathered:** 2026-11-03
**Status:** Ready for planning

<domain>
## Phase Boundary

In a normal (live) org, ContentVersion, ContentDocument and ContentDocumentLink behave as in a real
org for the surface orglet claims: a ContentVersion insert without `ContentDocumentId` creates its
document; a second insert with `ContentDocumentId` adds a version and flips `IsLatest`; `VersionData`
is accepted as base64 JSON and downloaded through `GET .../ContentVersion/{id}/VersionData`; the
server computes `Checksum`, `ContentSize`, `FileType`, `FileExtension`; ContentDocumentLink is a
generated baseline object with the mandatory-filter SOQL restriction; deleting a ContentDocument
soft-deletes versions and links and undelete restores them together. Bytes sit behind one
`BlobStore` interface owned by `engine`, with an inline `bytea` implementation as the only store in
this phase, plus a pure, validated key builder for Heimdall's `files/<cs[0:4]>/<cs>.<ext>` layout
that Phase 16 (fixture) and Phase 18 (loader) share.

Requirements: FILE-03, FILE-04, FILE-05, FILE-06, FILE-07, FILE-08, FILE-09.

Out of scope here: multipart upload (FILE-10, `UNSUPPORTED:content-multipart`), the external
(filesystem or S3) blob store (Phases 17/18), archive-org DDL variants (Phase 17 with D2), the
record-browsing UI (Phase 20), Attachment/Document bodies (FILE-02), the seeded id/clock seam
(Phase 16).

</domain>

<decisions>
## Implementation Decisions

### ContentDocumentId storage and upgrade
- **D-01:** `ContentVersion.ContentDocumentId` is `NOT NULL` in the database and `nillable: false`
  in describe. The Phase 10 nullable override (`scripts/gen-baseline/overrides.json`, "omit it to
  create a new document") is removed. The engine always fills the column (auto-created document),
  so no insert in a live org can leave it null; describe and storage say the same thing.
- **D-02:** Upgrading a populated v1.1 database that holds ContentVersion rows with a null
  `ContentDocumentId` follows the Phase 8 rule: `migrate()` never creates, deletes or rewrites data
  rows. When the `NOT NULL` constraint cannot be applied because existing rows violate it, migrate
  skips the constraint with one counted warning per column (same pattern as `UNSUPPORTED:schema-fk`;
  reuse `schema-narrow` or add a sibling area, planner's call) and re-evaluates the skip on every
  `up`. Correcting the rows is the user's job. The phase includes an upgrade test on a populated
  v1.1 database; `EXPECTED_WARNINGS` gains an entry only if that fixture contains such rows.
- **D-03:** The archive-org question (PITFALLS P18: keep the column nullable in archive orgs versus
  loader-synthesised stub ContentDocuments) is deferred to Phase 17, decided together with the
  foreign-key policy D2, informed by the loader research on whether Heimdall backs up
  ContentDocument by default. Phase 15 builds `NOT NULL` for live orgs and must not pre-empt that
  choice; the ContentDocument mirror logic (D-11) should be callable outside `DmlEngine` so a
  stub path remains possible.

### Blob bytes: storage, cap and download
- **D-04:** `InlineBlobStore` stores one `bytea` value per ContentVersion, outside the record
  table's `selectList` so rows and SOQL never carry bytes. No chunking. The `BlobStore` interface is
  stream-based (`open` returns a `Readable`) so chunked storage can replace it later without
  touching callers. The practical cap is documented.
- **D-05:** The base64 JSON upload cap is Salesforce's documented limit for non-multipart blob
  insert (research: ~37.5 MB file / 50 MB body; the researcher pins the exact documented figure).
  The researcher looks for the documented Salesforce error for an oversized body; if none is
  documented, orglet answers HTTP 413 with the standard error envelope and the message prefixed
  `UNSUPPORTED:content-size`. No environment variable for the cap. Fastify's global `bodyLimit`
  (64 MiB today) stays; a per-route limit may be used if the planner prefers.
- **D-06:** `GET /services/data/vXX.X/sobjects/ContentVersion/{id}/VersionData` always sends
  `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Content-Length` from
  `ContentSize`, and `Content-Type` derived from `FileExtension` through the same table as D-09
  with `application/octet-stream` as fallback. No inline allow-list. Range is not supported and is
  declared with `Accept-Ranges: none`.
- **D-07:** MD5 is computed while streaming on every download and compared with the stored
  `Checksum`. A mismatch cannot change the status after headers are sent, so it is reported as a
  diagnostic log line once per version Id (Id, expected and actual checksum; never content). No
  `archive verify` command in this phase. A ContentVersion without bytes (no blob behind the
  reference) answers 404 `NOT_FOUND` with a clear message and a diagnostic, never empty bytes.

### Insert rules and derived fields
- **D-08:** `Title` and `PathOnClient` are both required when inserting a ContentVersion with
  `VersionData`; a missing one is `REQUIRED_FIELD_MISSING` with the field name. No default Title
  from the filename. `FileExtension` and `FileType` derive from `PathOnClient`.
- **D-09:** `FileType` comes from a small built-in extension table (about 15 common tokens such as
  `PDF`, `WORD_X`, `EXCEL_X`, `POWER_POINT_X`, `PNG`, `JPG`, `GIF`, `TEXT`, `CSV`, `ZIP`, `XML`,
  `JSON`) with `UNKNOWN` as fallback. The researcher sources each token from public Salesforce
  material; unsourced tokens are left out. The same table supplies the download `Content-Type`.
- **D-10:** An insert with `FirstPublishLocationId` creates exactly one ContentDocumentLink:
  `LinkedEntityId = FirstPublishLocationId`, `ShareType = V`, `Visibility = AllUsers`. No owner
  (`ShareType I`) link is created.
- **D-11:** The ContentDocument is a view of its latest version at all times: `Title`, `FileType`,
  `FileExtension`, `ContentSize` and `LatestPublishedVersionId` are mirrored on document creation,
  on each new version, and when the version with `IsLatest = true` is updated (ContentVersion is
  `updateable: true` since Phase 10 D-12). Mirroring runs in the same transaction as the DML.
- **D-12:** Version bookkeeping on a second insert with an existing `ContentDocumentId`: previous
  latest gets `IsLatest = false`, `VersionNumber` is the ordinal as a string (`"1"`, `"2"`, ...),
  the document's `LatestPublishedVersionId` moves. System-computed fields (`Checksum`,
  `ContentSize`, `FileType`, `FileExtension`, `IsLatest`, `VersionNumber`) are never taken from the
  client body; the engine's existing rule for non-createable fields applies to them.

### Scope: external store and link DML
- **D-13:** Phase 15 delivers the `BlobStore` interface (owned by `engine`; `api` reads through
  it), `InlineBlobStore`, and a pure, dependency-free key builder `blobKey(checksum, extension)`
  that returns `files/<checksum[0:4]>/<checksum>.<extension>` and validates its inputs (lowercase
  hex `^[0-9a-f]{32}$`, extension `^[A-Za-z0-9]{0,16}$`, reject rather than sanitise; PITFALLS
  P17). `FsObjectStore`, `S3ObjectStore` and `ExternalBlobStore` are Phase 17/18 work. The 404
  path (D-07) is tested with an inline version that has no bytes.
- **D-14:** ContentDocumentLink supports insert, delete, undelete and update of `ShareType` and
  `Visibility` (picklist-validated). `ContentDocumentId` and `LinkedEntityId` are create-only. No
  sharing or visibility semantics are enforced (out of scope since v1.0).
- **D-15:** A new diagnostic area `UNSUPPORTED:blob-field` replaces `UNSUPPORTED:field-type` for
  base64 fields the baseline generator skips (`FeedItem.ContentData`, `EmailMessage.*` and the
  rest). `ContentVersion.VersionData` leaves that list because it is now modelled as a `base64`
  field. Attachment and Document stay unmodelled objects exactly as today (they are not among the
  Phase 10 eighteen), so `Attachment.Body` / `Document.Body` are reached only through the
  unmodelled-object path; FILE-09's wording is satisfied by the new token. `PROVENANCE.json`,
  generator tests and the check report are updated accordingly.
- **D-16:** The Phase 4 D-08 refusal of polymorphic relationships in child subqueries is kept:
  `SELECT (SELECT Id FROM ContentDocumentLinks) FROM Account` stays `UNSUPPORTED`. FILE-07 and
  the Phase 20 UI use the direct form `SELECT ... FROM ContentDocumentLink WHERE LinkedEntityId =
  :id`. The SOQL restriction (`MALFORMED_QUERY` without an `Id`, `ContentDocumentId` or
  `LinkedEntityId` filter) applies to the direct form.

### Claude's Discretion
- Where the bytea value lives (side table versus an excluded column on `contentversion`) and the
  exact `BlobStore` method signatures, as long as `open` streams and `put` joins the caller's
  transaction.
- How `GET /:type/:id/VersionData` is routed past the existing external-id route
  `GET /:type/:field/:value` (`packages/api/src/routes/sobjects.ts`).
- How "every keyed object" for `LinkedEntityId` is expressed given the generator only accepts
  explicit `referenceTo` lists limited to `objects.json` (a build-time expansion over all objects
  with a key prefix, including custom objects from the retrieve, is the expected shape).
- Whether ContentDocument delete cascade reuses `deleteBatch`'s `cascadeDelete` child-relationship
  path (which must bypass ContentVersion's `deletable: false`) or a dedicated step.
- Test strategy for memory (PITFALLS P15 suggests a large generated file with a heap assertion).
- The exact diagnostic area names for D-02 and D-07 beyond those fixed above.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and roadmap
- `.planning/ROADMAP.md` §Phase 15 — goal, success criteria 1-5, notes (baseline-gen-check and
  v1-vs-v2 diff gate must stay green; upgrade test on a populated v1.1 database)
- `.planning/REQUIREMENTS.md` — FILE-03..FILE-09 (v1), FILE-02 and FILE-10 (deferred), Out of Scope
- `.planning/PROJECT.md` §Current Milestone and §Key Decisions — the Phase 8 migrate rule (never
  rewrites data, FK skipped with one warning per column), Phase 9/10 baseline-generator rules,
  Phase 4 polymorphic rules

### Research (v1.2)
- `.planning/research/SUMMARY.md` — D2 (FK policy, Phase 17), "Further disagreements" on bytea,
  multipart and the ContentDocumentId override; Phase A description
- `.planning/research/FEATURES.md` §1 Files — Salesforce facts with confidence, orglet's choices
  for `VersionNumber`, FileType, PathOnClient; archive-mode contrast table
- `.planning/research/ARCHITECTURE.md` §(d) Blob store — `BlobRef`/`BlobStore` sketch, inline
  versus external, URL-not-bytes rule
- `.planning/research/PITFALLS.md` P15 (bytea memory and bodyLimit), P16 (streaming and
  Content-* contract), P17 (checksum semantics, key validation, path traversal), P18 (content
  model coupling, circular FK, describe shape, VersionData as a field)
- `.planning/research/HEIMDALL-FORMAT.md` §4 Files / blobs — key layout, dedup by
  `Checksum` + `FileExtension`, lowercase MD5 hex

### Prior phase decisions
- `.planning/phases/10-business-standard-objects/10-CONTEXT.md` — D-12 (ContentVersion
  updateable true, deletable false), D-14 (ContentDocumentLink excluded then), D-16 (ContentDocument
  create and ContentVersion delete refused), D-18 (forced-nullable rule and its ContentDocumentId
  exception)
- `.planning/phases/04-polymorphic-lookups-soql-typeof/04-CONTEXT.md` — D-08 (no polymorphic
  relationships in child subqueries), prefix-based target resolution

### Codebase maps and generator
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONVENTIONS.md`,
  `.planning/codebase/TESTING.md`
- `scripts/gen-baseline/overrides.json` (ContentDocument ~281, ContentVersion ~310, nullable
  override ~330, FirstPublishLocationId targets ~335), `scripts/gen-baseline/typemap.ts:50`
  (base64 skip), `scripts/gen-baseline/objects.json`, `scripts/gen-baseline/pipeline.ts:490,536`
- `packages/metadata/test/baseline-gate.ts` and `baseline-gate.test.ts` — the v1-vs-v2 diff gate
- `.github/workflows/ci.yml:129-143` — `baseline-gen-check`

### Salesforce documentation to read manually (automated fetch returns 403)
- ContentVersion object reference (required fields, `PathOnClient`, `VersionNumber`, `Checksum`)
- ContentDocumentLink object reference (`ShareType`, `Visibility`, mandatory-filter rule)
- REST "Insert or Update Blob Data" (JSON base64 limit, error for oversized body)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Baseline generator (`scripts/gen-baseline/`): ContentDocument (`069`) and ContentVersion
  (`068`, 40 fields) are already generated; `FirstPublishLocationId` is polymorphic with 20
  explicit targets; `VersionDataUrl` exists as Text. ContentDocumentLink is absent everywhere
  (only a prose mention in `overrides.json:285`).
- `packages/engine/src/engine.ts` `saveBatch` (:493-560): before hooks, platform rules, required
  check, reference check, validation rules, then `write` with a per-record `SAVEPOINT` and after
  hooks, all on one `PoolClient`; `withRollups` wraps the write. File side effects (document
  creation, version flip, mirror, auto-link, blob put) belong inside this transaction.
- `deleteBatch` (:881-916) walks `schema.childRelationships` with cascade/restrict/null-out;
  `undeleteBatch` (:918-937) restores only `cascadeDelete` children. ContentDocument -> versions
  and links can ride this if the child relationships declare cascade.
- `Store` (`packages/engine/src/store.ts`): `insert`, `update`, `setDeleted`, `childrenOf`,
  `findByField`; `selectList` is where `base64` fields must be excluded.
- Polymorphic machinery: `FieldDef.referenceTo` (`packages/metadata/src/types.ts:123`),
  `resolveRelationship`, `matchTargetByPrefix` (`packages/schema/src/ids.ts:46-59`), one LEFT JOIN
  per target in `packages/soql/src/compile.ts:87`; FK only when `referenceTo` has one target
  (`packages/schema/src/ddl.ts:49`), so `LinkedEntityId` gets no FK.
- Error factories: `Errors.*` in `packages/engine/src/errors.ts`, `apiError`/`sendErrors` in
  `packages/api/src/server.ts`; SOQL errors via `packages/soql/src/errors.ts` (`malformed` exists
  for `MALFORMED_QUERY`).
- Diagnostic areas live in `packages/metadata/src/diagnostics.ts`; no `blob-field` area today.
- Upgrade safety net: `packages/engine/src/upgrade.test.ts` (v1.0 fixture, `NEW_TABLES`,
  `EXPECTED_WARNINGS = []`), `upgrade-owner.test.ts`.
- Test harness: `test/db.ts` (`usingPglite`, `openTestDb`); pglite default, Postgres with
  `ORGLET_DATABASE_URL`.

### Established Patterns
- No streaming replies exist in `api` (all `reply.send(obj)`); `GET .../VersionData` is the first
  streamed response. Fastify `bodyLimit` is 64 MiB globally (`server.ts:88`); parsers: JSON as
  string then parsed, XML as string, `text/csv` in bulk routes. No multipart parser.
- Record GET (`sobjects.ts:106-114`) goes through `ctx.engine.retrieve` and `recordJson`; the
  external-id route `GET /:type/:field/:value` shares the path shape with `/:id/VersionData`.
- Query rows are shaped in `packages/soql/src/shape.ts` (`attributes()` builds the record URL;
  the `VersionData` URL is a sibling concern).
- `generateId` (`packages/schema/src/ids.ts:90-100`) uses `Date.now()` plus a counter; the engine
  stamps `new Date()` directly. No seeded id/clock seam exists (Phase 16 adds it).
- Phase 8 migrate rule: constraints existing rows violate are skipped with one warning and
  re-evaluated each run; migrate never rewrites data.

### Integration Points
- `scripts/gen-baseline/objects.json` and `overrides.json`: add ContentDocumentLink, drop the
  nullable override, widen the base64 handling so `VersionData` is emitted as type `base64`;
  regenerate `packages/metadata/standard/` and keep `baseline-gen-check` plus the v1-vs-v2 diff
  gate green (`diff-allowlist.json` is empty today).
- `packages/schema` DDL: `base64` column mapping in live mode, `NOT NULL` for `ContentDocumentId`
  with the D-02 skip rule.
- `packages/engine`: `BlobStore` interface and `InlineBlobStore`; a files step in `saveBatch` /
  `deleteBatch` / `undeleteBatch`; `blobKey` helper (pure, exported).
- `packages/api/src/routes/sobjects.ts`: base64 body handling on POST, the `VersionData` GET
  route, multipart refusal; `packages/soql/src/shape.ts` and `recordJson`: URL for `base64`
  fields.
- `packages/soql/src/compile.ts`: ContentDocumentLink mandatory-filter check.
- Describe: `VersionData` type `base64`, `ContentDocumentId` `nillable: false`; conformance
  describe checks and `packages/metadata/test/object-reference-snapshot.test.ts` assertions.

</code_context>

<specifics>
## Specific Ideas

- Honesty over convenience throughout: nothing is defaulted or guessed where a real org would
  refuse (D-08), tokens without a public source are left out (D-09), and mismatches are reported
  rather than repaired (D-02, D-07).
- The `BlobStore` interface is the archive seam: Phase 17/18 plug the external store in behind it
  without touching routes or the engine's file step; `blobKey` is the shared contract with the
  Phase 16 fixture generator.
- The download contract is deliberately conservative (attachment + nosniff, no Range) because the
  API and the Phase 20 UI share an origin.

</specifics>

<deferred>
## Deferred Ideas

- Owner link (`ShareType I`) on document creation, as a real org does — revisit if a conformance
  suite or the UI needs it.
- Child subquery over a polymorphic FK (`SELECT (SELECT ... FROM ContentDocumentLinks) FROM
  Account`) with the parent Id as implicit filter — backlog candidate; lifts Phase 4 D-08 for one
  relationship.
- Chunked blob storage and multipart upload (FILE-10) — together, when files larger than the JSON
  limit are needed.
- HTTP Range support (206) and an inline `Content-Disposition` allow-list for images/pdf.
- Configurable upload cap via environment variable.
- `archive verify --files` (full or sampled checksum scan) — Phase 18/21.
- `FsObjectStore`, `S3ObjectStore`, `ExternalBlobStore` — Phase 17/18 per roadmap.
- Archive-org `ContentDocumentId`: nullable column versus loader stub documents — Phase 17, with
  D2.
- Seeded id/clock seam for deterministic fixtures — Phase 16 (PITFALLS P23).

### Reviewed Todos (not folded)
None — no pending todos matched Phase 15.

</deferred>

---

*Phase: 15-files-model*
*Context gathered: 2026-11-03*
