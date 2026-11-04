# Phase 15: Files Model - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-03
**Phase:** 15-files-model
**Areas discussed:** ContentDocumentId storage and upgrade, Blob bytes (storage, cap, download), Insert rules and derived fields, Scope (external store and link DML)

All four gray areas offered were selected. Advisor mode was off (no USER-PROFILE.md). No pending todos matched the phase.

---

## ContentDocumentId storage and upgrade

### Database column after the nullable override is removed

| Option | Description | Selected |
|--------|-------------|----------|
| NOT NULL in the database | Describe and storage agree; the engine always fills the value | ✓ |
| Nullable in the database, nillable:false only in describe | Lets an archive load without ContentDocument rows work without stubs; describe and table disagree | |

**User's choice:** NOT NULL in the database (recommended).

### Upgrade of a v1.1 database with null rows

| Option | Description | Selected |
|--------|-------------|----------|
| Skip NOT NULL with a counted warning | Phase 8 `schema-fk` pattern; data untouched; re-evaluated each `up` | ✓ |
| Migrate synthesises ContentDocuments for orphan versions | Clean database but breaks the "migrate never creates or rewrites data" rule | |
| Abort migrate with a clear error | Honest but blocking; breaks MIGR-02 | |

**User's choice:** Skip NOT NULL with a counted warning (recommended).

### Archive orgs (P18)

| Option | Description | Selected |
|--------|-------------|----------|
| Defer to Phase 17 together with FK policy D2 | Phase 15 builds NOT NULL for live orgs; archive DDL variant decided with loader research | ✓ |
| Decide now: loader synthesises stub documents | One DDL everywhere; stubs counted as `UNSUPPORTED:archive-stub` | |
| Decide now: archive DDL keeps the column nullable | NOT NULL behind a mode condition; no stubs | |

**User's choice:** Defer to Phase 17 (recommended).
**Notes:** User moved to the next area without further questions.

---

## Blob bytes: storage, cap and download

### Storage shape in normal mode

| Option | Description | Selected |
|--------|-------------|----------|
| One bytea per version, documented cap | Simplest; stream-based interface allows chunking later | ✓ |
| Chunked storage (1-4 MB rows) from the start | Future-proof for multipart up to 2 GB; more code now | |

**User's choice:** One bytea per version (recommended).

### Upload size cap and error

| Option | Description | Selected |
|--------|-------------|----------|
| Salesforce documented limit, code from research | Researcher pins the documented error; fallback 413 + `UNSUPPORTED:content-size`; no env var | ✓ |
| No own cap, only Fastify bodyLimit | Generic 413 without the Salesforce envelope | |
| Configurable cap via env variable | Flexible, another knob to document and test | |

**User's choice:** Salesforce documented limit (recommended).

### Download headers

| Option | Description | Selected |
|--------|-------------|----------|
| Always attachment + nosniff, Accept-Ranges: none | Content-Type from FileExtension, octet-stream fallback; Range declared unsupported | ✓ |
| Inline for a short allow-list (images, pdf), attachment otherwise | Nicer previews; allow-list to maintain, SVG never inline | |
| Attachment + nosniff and Range support (206) | Byte ranges for video/pdf; more code, no SDK needs it | |

**User's choice:** Always attachment + nosniff, Accept-Ranges: none (recommended).

### Checksum verification timing

| Option | Description | Selected |
|--------|-------------|----------|
| Streaming MD5 on every download, logged once per version | Cheap; mismatch logged as diagnostic (no values); no new CLI command | ✓ |
| Never on download; only a future `archive verify --files` | Fastest download; SC5 report deferred to Phase 18/21 | |
| You decide | Claude picks what is simplest to test | |

**User's choice:** Streaming MD5 on every download (recommended).
**Notes:** User moved to the next area without further questions.

---

## Insert rules and derived fields

### Required fields on insert with VersionData

| Option | Description | Selected |
|--------|-------------|----------|
| Title and PathOnClient both required | Follows describe; REQUIRED_FIELD_MISSING with the field name | ✓ |
| PathOnClient required, Title defaults from filename | Convenient but deviates from describe | |
| Nothing required; FileType UNKNOWN without PathOnClient | Most permissive; hides client errors a real org rejects | |

**User's choice:** Title and PathOnClient both required (recommended).

### FileType derivation

| Option | Description | Selected |
|--------|-------------|----------|
| Small built-in table (~15 common) + UNKNOWN | Tokens sourced from public examples; same table gives Content-Type | ✓ |
| Always UNKNOWN except documented cases | Strictest honesty; common files show as UNKNOWN | |
| You decide | Claude picks the table scope from research | |

**User's choice:** Small built-in table + UNKNOWN (recommended).

### Auto-link on FirstPublishLocationId

| Option | Description | Selected |
|--------|-------------|----------|
| Only the V link to FirstPublishLocationId | ShareType V, Visibility AllUsers; what clients and the Phase 20 UI query | ✓ |
| Both the V link and the owner's I link | More faithful; extra row per file and owner-link rules | |
| No auto link | Client creates links itself; breaks SDK upload examples | |

**User's choice:** Only the V link (recommended).

### ContentDocument mirroring on update

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, the document always mirrors the latest version | Update of Title/Description on the IsLatest version updates the document in the same transaction | ✓ |
| Only on insert of a new version | Less code; document Title can drift from the version | |

**User's choice:** Document always mirrors the latest version (recommended).
**Notes:** User moved to the next area without further questions.

---

## Scope: external store and link DML

### How much of the external store in Phase 15

| Option | Description | Selected |
|--------|-------------|----------|
| Interface + Inline + pure key builder | `BlobStore`, `InlineBlobStore`, validated `blobKey`; fs/S3 stores in Phase 17/18; 404 tested inline | ✓ |
| Also FsObjectStore here, S3 in Phase 18 | Runnable external store against a directory now; more scope | |
| Everything including S3 here | Whole FILE-09 in one phase; pulls in the AWS SDK early | |

**User's choice:** Interface + Inline + pure key builder (recommended).

### ContentDocumentLink DML

| Option | Description | Selected |
|--------|-------------|----------|
| Insert, delete, undelete and update of ShareType/Visibility | Picklist-validated; no sharing semantics | ✓ |
| Only insert and delete | Update refused with a real status code | |

**User's choice:** Full DML on the three fields (recommended).

### The `blob-field` token

| Option | Description | Selected |
|--------|-------------|----------|
| Introduce `blob-field` as the token for skipped base64 fields | Generator and check report use it; VersionData leaves the list; Attachment/Document stay unmodelled | ✓ |
| Keep `field-type`, fix the requirement text | No token change; REQUIREMENTS and roadmap SC5 reworded | |

**User's choice:** Introduce `blob-field` (recommended).

### Child subquery on ContentDocumentLinks

| Option | Description | Selected |
|--------|-------------|----------|
| Direct query suffices; the subquery stays UNSUPPORTED | Phase 4 D-08 kept; subquery over polymorphic FK noted for backlog | ✓ |
| Lift the refusal for ContentDocumentLinks in this phase | Implicit LinkedEntityId = parent.Id filter; compiler exception and tests | |

**User's choice:** Direct query suffices (recommended).

---

## Closing

| Option | Description | Selected |
|--------|-------------|----------|
| I'm ready for context | Write CONTEXT.md and DISCUSSION-LOG.md, commit, update STATE.md | ✓ |
| Explore more gray areas | Route collision, versions without VersionData, memory test setup | |

## Claude's Discretion

- Physical placement of the bytea value and exact `BlobStore` signatures (streaming `open`, transactional `put`).
- Routing `GET /:type/:id/VersionData` past the external-id route.
- Mechanism for "every keyed object" in `LinkedEntityId.referenceTo` (build-time expansion including custom objects).
- Whether ContentDocument cascade reuses `deleteBatch` cascade or a dedicated step.
- Memory test strategy (P15).
- Diagnostic area names for the NOT NULL skip and the checksum mismatch beyond those fixed in CONTEXT.md.

## Deferred Ideas

- Owner `ShareType I` link on document creation.
- Child subquery over a polymorphic FK with implicit parent filter (backlog candidate).
- Chunked blob storage together with multipart upload (FILE-10).
- HTTP Range (206) and inline disposition allow-list.
- Configurable upload cap via env variable.
- `archive verify --files` (Phase 18/21).
- Fs/S3 object stores and `ExternalBlobStore` (Phase 17/18).
- Archive-org `ContentDocumentId` nullable versus stub documents (Phase 17, with D2).
- Seeded id/clock seam (Phase 16).
