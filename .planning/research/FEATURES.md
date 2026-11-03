# Feature Landscape: v1.2 archive mode

**Domain:** read-only Salesforce org replica fed from a Heimdall backup (files, read-only semantics, archive browsing, GDPR erasure, record UI)
**Researched:** 2026-11-03
**Overall confidence:** MEDIUM. developer.salesforce.com returned HTTP 403 to direct fetches, so Salesforce claims rest on search-result excerpts of the official pages (MEDIUM), SDK source (HIGH for client behaviour) and vendor pages (LOW to MEDIUM). Every claim below carries a source or is marked "orglet's choice" / "undocumented".

Existing orglet features this builds on (not re-researched): import mode, Bulk 2.0 CSV parser and coercion, `DmlError`/`Errors`/`apiError` envelope, `UNSUPPORTED:<area>`, soft-delete and `queryAll`, built-in UI at `/` (login, object list, records table, record panel, SOQL tab), baseline `ContentVersion` and `ContentDocument` JSON in `packages/metadata/standard/objects/`.

Baseline state found in the repo: `ContentVersion.json` has `ContentDocumentId` (nillable override from Phase 10, backlog 999.10), `Checksum`, `ContentSize`, `FileType`, `FileExtension`, `IsLatest`, `VersionNumber`, `PathOnClient`, `FirstPublishLocationId`, but no `VersionData` is verified as a blob column. `ContentDocument.json` exists and is not createable. **`ContentDocumentLink` is not in the baseline** and must be added.

---

## 1. Files (ContentVersion / ContentDocument / ContentDocumentLink)

### Documented Salesforce behaviour orglet must match

| Behaviour | Source | Confidence |
|-----------|--------|------------|
| ContentVersion cannot be updated for file content; a new file revision is a new ContentVersion insert (with `ContentDocumentId` set to add a version) | REST "Insert or Update Blob Data" https://developer.salesforce.com/docs/atlas.en-us.232.0.api_rest.meta/api/dome_sobject_insert_update_blob.htm (via search excerpt) | MEDIUM |
| Multipart upload: JSON part named `entity_content`, binary part named `VersionData` with `filename`; per-part `Content-Type` required; boundary prefixed by `--` | same | MEDIUM |
| Non-multipart (plain JSON with base64 `VersionData`) limited to 37.5 MB base64 (50 MB text); multipart up to 2 GB for ContentVersion in the page version found (an older page said 500 MB generic) | same | MEDIUM (limit varies by API version) |
| `PathOnClient` is a create-only, nillable string; `FileType` is derived from `PathOnClient` (documents) or `ContentUrl` (links); `FileExtension` holds the extension | ContentVersion reference https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/sforce_api_objects_contentversion.htm (search excerpts of v204/v220) | MEDIUM |
| `Checksum` is the MD5 of the file, not createable (system-set) | same | MEDIUM that it is system-set; undocumented whether hex-lowercase (Heimdall stores it as MD5 hex, see HEIMDALL-FORMAT.md section 4) |
| `IsLatest` defaulted on create, flags the newest version of a document | same | MEDIUM |
| `ContentSize` in bytes | same | MEDIUM |
| `FirstPublishLocationId` is create-only and cannot be changed by a later version insert; it is what produces the initial ContentDocumentLink to a record | same | MEDIUM |
| `ContentDocumentLink.ShareType`: `V` Viewer, `C` Collaborator, `I` Inferred; `Visibility`: `AllUsers`, `InternalUsers`, `SharedUsers`; external users can only get `AllUsers` | ContentDocumentLink reference https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_contentdocumentlink.htm | MEDIUM |
| A SOQL query on ContentDocumentLink must filter on `Id`, `ContentDocumentId` or `LinkedEntityId` | same | MEDIUM |
| Deleting a ContentDocument cascade-deletes its ContentDocumentLinks and does not fire ContentDocumentLink triggers | same (v238 page) | MEDIUM |

### Undocumented in the sources I could read (orglet's choice or needs check)

- Whether `ContentDocumentId` is required on create. The reference lists it as Create without Nillable, but real orgs accept inserts without it (they create the document). Backlog 999.10 already states this; treat it as the established behaviour, source = community/SDK usage, LOW.
- Exact `VersionNumber` format (a string "1", "2", ...), the `FileType` token table (e.g. `PDF`, `WORD_X`, `UNKNOWN`), and the owner `I` link that real orgs create on first publish. Mark as orglet's choice: generate `VersionNumber` as the ordinal string, `FileType` from a small extension table with `UNKNOWN` fallback, and create the `FirstPublishLocationId` link as `ShareType=V`, `Visibility=AllUsers`.
- Whether `PathOnClient` is mandatory when `VersionData` is present. Community reports a `REQUIRED_FIELD_MISSING` for it. Orglet's choice: require `PathOnClient` and `Title` defaulting from it, because FileType/FileExtension derive from it.

### Table stakes

| Feature | Why expected | Complexity | Depends on |
|---------|--------------|------------|-----------|
| ContentDocument auto-created on ContentVersion insert without `ContentDocumentId`; drop the nillable override so describe says `nillable:false` | Every file upload client does this (backlog 999.10) | Med | engine hooks/DML pipeline, Phase 10 override |
| Insert with `ContentDocumentId` adds a version: previous `IsLatest=false`, new `VersionNumber` increments, `ContentDocument.LatestPublishedVersionId`, `Title`, `FileType`, `FileExtension`, `ContentSize` mirror the latest | Needed for versions and for the ContentDocument list a UI shows | Med | engine, roll-up-like maintenance |
| `VersionData` as a base64 blob field: JSON base64 insert and multipart `entity_content`/`VersionData` insert | jsforce and simple-salesforce uploads use one or the other | Med | `@fastify/multipart` (new) or manual parse; Fastify content-type parsers in `server.ts` |
| `GET /sobjects/ContentVersion/{id}/VersionData` streams the bytes (with `Content-Type`, `Content-Length`) | Download path used by Heimdall itself and by jsforce `blob` | Low to Med | blob store abstraction |
| Server-computed `Checksum` (MD5 hex), `ContentSize`, `FileType`, `FileExtension` on insert | Clients and Heimdall dedup on Checksum | Low | blob store |
| ContentDocumentLink object in baseline (`ContentDocumentId`, `LinkedEntityId` polymorphic, `ShareType`, `Visibility`, `IsDeleted`, `SystemModstamp`) with the mandatory-filter SOQL restriction | The only way to find the files of a record; Heimdall backs it up | Med | `scripts/gen-baseline`, soql compile (new restriction error), polymorphic reference handling |
| ContentDocument delete cascades to ContentVersions and ContentDocumentLinks | Real behaviour; also the building block of GDPR erasure | Low to Med | engine delete cascade |
| Describe for blob field: `VersionData` type `base64`, excluded from queries returning rows (the REST record JSON carries a URL `.../VersionData`, not the bytes) | jsforce expects this | Low | describe, `shape.ts` |

### Archive mode: reproduce vs skip

| Reproduce in archive | Skip in archive (log `UNSUPPORTED:` or simply refuse as read-only) |
|----------------------|------------------------------------------------------------------------|
| Rows exactly as backed up: `ContentDocumentId`, `IsLatest`, `VersionNumber`, `Checksum`, `ContentSize`, `FileType`, `FileExtension`, `Title`, `PathOnClient`, `IsDeleted` | Auto-creating documents, version bumping, Checksum recomputation (the loader imports, it never inserts) |
| `GET .../VersionData` resolved by `Checksum`+`FileExtension` to `files/<cs[0:4]>/<cs>.<ext>` in the backup store | Multipart/base64 upload path (DML refused) |
| ContentDocumentLink rows and the filter restriction | Sharing/visibility enforcement (no security model, out of scope) |
| Delete cascade only inside the erasure path | Malware scan, previews, rendition, thumbnails, `TextPreview` |

Caveat from HEIMDALL-FORMAT.md: only ContentVersion has blobs. Attachment.Body and Document.Body are never fetched, so the archive must answer those with a clear `UNSUPPORTED:blob-field` rather than empty bytes. Heimdall does back up ContentDocumentLink as a normal object (its `init.sql` indexes it by `LinkedEntityId` and `ContentDocumentId`, and `RestoreService.java` joins link -> latest version for a record's files), so the UI can use the same join. Source: Heimdall repo, `src/main/resources/db/init.sql`, `web/RestoreService.java:578-633`.

### Differentiators

- Blob store pluggable (bytea in a normal org, checksum-addressed external store in archive): not a Salesforce feature, orglet's choice; Med.
- Integrity check on download (recompute MD5 against `Checksum`) and a loader diagnostic for missing blobs: Low; valuable because Heimdall skips deleted CVs and small files (`HEIMDALL_SKIP_FILES_BELOW_KB`).
- Per-version file listing in the UI (all ContentVersions of a ContentDocument): Low.

### Anti-features

| Anti-feature | Why avoid | Instead |
|--------------|-----------|---------|
| Copying blobs into Postgres in archive mode | Defeats "served straight from the backup store", duplicates GBs | External store reads |
| Faking Attachment/Document bodies | Silently wrong | `UNSUPPORTED:blob-field` |
| ContentDistribution, ContentFolder, ContentWorkspace, libraries, previews | Large surface, not needed to browse | Not modelled |
| Enforcing ShareType/Visibility semantics | Needs the security model (out of scope) | Store and return values only |

---

## 2. Read-only semantics (what DML returns)

### Candidate status codes

| Code | Evidence | Fit |
|------|----------|-----|
| `INSERT_UPDATE_DELETE_NOT_ALLOWED_DURING_MAINTENANCE` | Exists as a Salesforce error code (restforce `ERROR_EXCEPTION_CLASSES`, https://github.com/restforce/restforce/blob/master/lib/restforce/error_code.rb and https://rubydoc.info/gems/restforce/Restforce/ErrorCode/InsertUpdateDeleteNotAllowedDuringMaintenance). Marketo docs describe it for an instance in maintenance mode. Salesforce status notices state the instance is "available in Read-Only mode" during some maintenance windows (https://status.salesforce.com/maintenances/720740). Official wording and HTTP status not confirmed (403 blocked) | Best semantic match: it is what Salesforce itself returns for "the whole org is read-only" |
| `INVALID_READ_ONLY_USER_DML` | Exists (restforce list); meaning not confirmed by official source | Plausible but about a read-only user, not org |
| `INSUFFICIENT_ACCESS_OR_READONLY` | Documented in practice as object/record/FLS permission failure (Reltio, Revenue.io pages found); not maintenance | Misleading: suggests fixable by permissions |
| `INVALID_TYPE_FOR_OPERATION` | SOAP API doc: "The specified sObject type is invalid for the specified operation" (https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/sforce_api_calls_concepts_core_data_objects.htm, via search excerpt). Current backlog 999.11 text proposes it | Semantically wrong: the type is valid, the org is not writable |
| `ENTITY_IS_LOCKED`, `ENTITY_IS_ARCHIVED`, `ENTITY_IS_DELETED` | In restforce list; locked = approval lock, archived = archived activities/cases | Per-record, not org-wide; `ENTITY_IS_ARCHIVED` is thematically nice but wrong scope |
| `CANNOT_EXECUTE_FLOW_TRIGGER`, `READ_ONLY` | Not found in any source I could reach as org-read-only codes | Do not use |

**Recommendation (orglet's choice, MEDIUM):** `INSERT_UPDATE_DELETE_NOT_ALLOWED_DURING_MAINTENANCE` as `errorCode`, message prefixed `UNSUPPORTED:archive-readonly ` (the repo convention keeps the code real and puts the marker in the message), HTTP 403 consistent with how simple-salesforce maps it (see below) - the real HTTP status is unverified, so keep it one constant. Alternative if Johan prefers a documented-meaning code: `INVALID_TYPE_FOR_OPERATION` (already in the backlog text). Decision for the discuss phase.

### Client behaviour

| Client | Behaviour | Source |
|--------|-----------|--------|
| jsforce | Any status >= 400 throws `HttpApiError` with `name`/`errorCode` = the code from the body; single-element error arrays unwrapped, several give `MULTIPLE_API_ERRORS`; no retry on error codes; only 401 triggers refresh. Unknown codes are fine | https://github.com/jsforce/jsforce/blob/main/src/http-api.ts (read) HIGH |
| simple-salesforce | 400 `SalesforceMalformedRequest`, 401 `SalesforceExpiredSession`, 403 `SalesforceRefusedRequest`, 404 `SalesforceResourceNotFound`, other `SalesforceGeneralError`; body kept parsed | https://github.com/simple-salesforce/simple-salesforce/blob/master/simple_salesforce/util.py HIGH |
| restforce (reference) | Maps the error code to a typed class; unknown codes fall back to generic | restforce error_code.rb HIGH |

Consequence: both main clients surface the code and message verbatim and do not retry, so any code works; the code only matters for human readability and for clients that switch on it. 403 makes simple-salesforce raise `SalesforceRefusedRequest`, which reads as "refused", the right idea.

### Table stakes

| Feature | Complexity | Notes |
|---------|------------|-------|
| One gate in `DmlEngine` (not per route) so REST sobjects, composite, Bulk ingest, SOAP, Apex-less hooks are all covered | Med | Bulk ingest job creation should fail at job creation or each row fails, orglet's choice: refuse at job create |
| Reads fully work: query, queryAll, describe, limits, Bulk query | Low | Existing |
| Describe unchanged: formula/roll-up still `calculated:true`; writable flags unchanged (orglet's choice, so tools do not break) | Low | |
| Formula and roll-up fields read stored values, never recomputed | Med | Disable `applyFormulaFields` and roll-up maintenance for archive-loaded rows; `$User`/`NOW()` results frozen as in CSV |
| Explicit erasure path (section 4) | Med | |
| Mode visible: `/limits` or a banner on `/` and in `orglet check` | Low | |

### Differentiators

- Per-request `Sforce-` style response header or `/services/data/vXX/` org info flag saying archive mode: Low (orglet's choice).
- Mode stored in the database so a loaded archive cannot be started writable by accident: Low.

### Anti-features

- Silent success on DML (looks like it worked): never.
- Allowing DML "for tests" via flag in archive mode: the whole point is it cannot be changed; use a normal org for tests.
- Running validation rules/triggers before refusing: refuse first.

---

## 3. Archive browsing (what archive/replica products show)

Sources: Own archive guide table of contents (search excerpt of https://portal.ownbackup.com/sys/document/open/7Ot00000000002n00mA): archived data displayed on the object record layout via a widget, a Search Widget, Global Search with rules, permission set "Archive View Archived Records". Odaseva Archive Viewer data sheet (https://go.odaseva.com/hubfs/Data%20Sheets/Odaseva%20-%20Archiving%20Agent%20-%20Data%20Sheet.pdf.pdf): search via an index, full details of an archived record, related archived records, files and attachments. Heimdall README: browse, search, version history, field-by-field diff, deleted records, related records and files on the record page. Commvault Compliance Manager keeps an audit trail of all actions (https://documentation.commvault.com/11.46/software/managing_salesforce_gdpr_requests_using_compliance_manager.html). Own/Odaseva audit-of-viewers features were not found: LOW, unverified.

### Table stakes

| Feature | Why expected | Complexity | Depends on |
|---------|--------------|------------|-----------|
| Search by name and email across objects | First question an archive gets (backlog 999.11) | Med | SOQL on `Name`/`Email` fields; no SOSL (out of scope), so UI fans out `LIKE` queries per searchable object |
| Record view with all fields, labels from describe | Core | Low (partly present: `openRecord`, `renderRecord`) | describe |
| Related lists | Core | Med | child relationships from describe |
| Lookup navigation | Core | Low | `referenceTo` |
| File list and download | Core to "archive" | Low to Med | section 1 |
| Deleted records reachable (flagged "Deleted") | Archives exist to hold these | Low | `queryAll`, soft-delete |
| Visible "as of" date and "archive, read-only" banner | Avoid mistaking archive for live | Low | loader metadata |

### Differentiators

| Feature | Value | Complexity | Notes |
|---------|-------|------------|-------|
| Version history and field diff per record | Heimdall has it; loader keeps latest only by default | High | Needs all versions stored; defer, as-of selection covers point-in-time |
| Audit log of who viewed which record | Compliance for non-developer readers (backlog 999.11 open item) | Med | Needs real authentication per reader (today password-flow emulation) |
| As-of date picker | Point-in-time | Low in UI, depends on loader | Loader option exists |
| Global search that includes ContentDocument titles | Nice | Low | |

### Anti-features

- Restore to a live org (Heimdall does it; out of scope).
- SOSL emulation or full-text index now (SOSL is out of scope; `LIKE` is enough).
- Security model/sharing for readers (out of scope; one reader role plus the audit log is the substitute).

---

## 4. GDPR erasure in an archive

### What Salesforce does (reference behaviour)

- Delete moves records to the Recycle Bin for 15 days; `emptyRecycleBin()` purges immediately, up to 200 ids per call, cannot be undeleted afterward; purged rows can still show in `queryAll` for roughly 24 hours (https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/sforce_api_calls_emptyrecyclebin.htm, via search excerpt). MEDIUM.
- Bulk API 2.0 `hardDelete` bypasses the bin and needs the "Bulk API Hard Delete" permission, off by default (HULFT adapter page and Data Loader docs found via search). MEDIUM.
- ContentDocument delete cascades to its links (section 1).

### What backup vendors do

Own recommends "scrub on restore" with a deletion blacklist and transparency toward the controller (https://www.owndata.com/blog/gdpr-balance-salesforce-backups). Druva, AutoRABIT and Commvault offer a "forget" workflow by record id that deletes from the backup files, Commvault with an audit trail. Odaseva behaviour not found. LOW to MEDIUM.

### Table stakes for orglet

| Feature | Complexity | Notes |
|---------|------------|-------|
| Erasure by record Id (and by list/CSV of Ids): hard delete of the row, with the option to cascade children | Med | An explicit CLI command, e.g. `orglet archive erase`, orglet's choice - not an HTTP DML route, so the read-only gate stays absolute. Optionally also `emptyRecycleBin`/hardDelete mapped to it for jsforce parity (decide at discuss) |
| Erase ContentVersion: row, all versions of its ContentDocument, ContentDocumentLinks, and the blob reference | Med | Blob in the external store is shared by checksum across CVs: delete the blob only when no remaining row has that checksum; Heimdall's own store is not touched by orglet (read-only mount), so report "blob still present in backup store" |
| Erasure audit log: who/when/what/why, containing ids and object names, never the erased values | Low to Med | Append-only table in Postgres, orglet's choice |
| Erasure ledger / tombstone list that survives a reload | Med | Without it, `orglet archive load` from the unchanged Heimdall backup resurrects erased data. This is the central hazard, same as Own's "scrub on restore" blacklist: the loader must consult the ledger |
| Hard-deleted rows invisible to `queryAll` | Low | Unlike Salesforce's ~24 h residue; orglet's choice |

### Differentiators

- Erase by person: find all rows referencing a Contact/Lead id plus email match, dry-run report first: Med to High.
- Verification report after erasure (no remaining rows, no remaining blobs for these ids): Low.

### Anti-features

- Soft-delete as "erasure" (data stays).
- Editing the Heimdall backup from orglet (separate system; document that backup must be scrubbed there too).
- Logging erased values in the audit trail (defeats the purpose).

---

## 5. Minimal record-browsing UI for non-developers

Reference (Salesforce Lightning): highlights panel from a compact layout shows up to the first 7 fields, the first styled as the title (https://trailhead.salesforce.com/content/learn/modules/lex_customization/lex_customization_compact_layouts, via search). Related tab shows the first few fields of each related list with "View All" (admin.salesforce.com, via search). Rows-per-related-list count was not confirmed; orglet's choice: 6 rows with a "View all" link. Section layout comes from page layouts in the retrieve, not currently modelled in orglet.

### Table stakes

| Feature | Complexity | Notes |
|---------|------------|-------|
| Header with record name, object label, deleted flag, 4 to 7 key fields | Low | Fields chosen by orglet's rule (nameField + first populated non-system fields); no compact layout parsing |
| Detail section: all fields, label/value pairs, booleans as checkbox text, dates local, picklist labels, lookups as links | Low to Med | Present partly in `renderRecord`; add label rendering and `referenceTo` links |
| Related lists per child relationship with first N rows + "View all" (list view with paging) | Med | Child relationships via describe; only those with rows |
| Lookup links, including polymorphic (`Owner`, `WhatId`) using key prefix | Low | `keyPrefixOf` exists |
| Search box on the home page: name/email, results grouped by object | Med | See section 3 |
| Files list on record (title, type, size, version) with download link; bytes via `VersionData` with bearer token | Low | Download needs the token: use fetch-to-blob since the UI sends Authorization headers |
| Back/forward works (hash routing) and records are linkable | Low | `#/Account/001...` |

### Omit

Page layouts and record types, SLDS 2/LWC (out of scope; SLDS 1 or system fonts), inline edit, list-view builder, charts, activity timeline, chatter feed, mobile layout, internationalised labels.

---

## Feature dependencies

```
Loader (Heimdall -> tables) -> frozen formulas needs read-only gate -> UI trustworthy
ContentDocumentLink in baseline -> files list in UI
Blob store abstraction -> VersionData download -> UI file download
Blob store abstraction -> checksum-addressed external store -> archive files
ContentDocumentLink SOQL filter restriction -> UI uses LinkedEntityId filter
Erasure ledger -> loader consults ledger (no resurrection)
Real reader authentication -> audit of who looked
```

## MVP recommendation

1. Read-only gate, frozen formulas (small, protects everything else).
2. Files model: ContentDocumentLink in baseline, auto-created ContentDocument, VersionData bytea store and download endpoint, then the external store behind the same interface.
3. Loader, then UI search + record + related lists + file download.
4. Erasure CLI with audit table and ledger that the loader respects.

Defer: version history and diff, audit of readers (needs auth), erase-by-person, response banner extras.

## Open questions for discuss/plan

- Which status code (INSERT_UPDATE_DELETE_NOT_ALLOWED_DURING_MAINTENANCE vs INVALID_TYPE_FOR_OPERATION) and which HTTP status; official page for the first could not be fetched.
- Does `orglet archive load` store only the latest version, so history is gone? Needed if version history is wanted later.
- Erasure as CLI only or also as hard-delete over REST/Bulk.
- Official ContentVersion/ContentDocumentLink usage-note pages need a manual read (403 for automated fetch): required-field list, `PathOnClient`, `VersionNumber`.

## Sources

- https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/sforce_api_objects_contentversion.htm (excerpts via search)
- https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_contentdocumentlink.htm (excerpts via search)
- https://developer.salesforce.com/docs/atlas.en-us.232.0.api_rest.meta/api/dome_sobject_insert_update_blob.htm (excerpts via search)
- https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/sforce_api_calls_emptyrecyclebin.htm (excerpts via search)
- https://developer.salesforce.com/docs/atlas.en-us.api.meta/api/sforce_api_calls_concepts_core_data_objects.htm (excerpts via search)
- https://status.salesforce.com/maintenances/720740
- https://github.com/jsforce/jsforce/blob/main/src/http-api.ts
- https://github.com/simple-salesforce/simple-salesforce/blob/master/simple_salesforce/util.py
- https://github.com/restforce/restforce/blob/master/lib/restforce/error_code.rb
- https://www.owndata.com/blog/gdpr-balance-salesforce-backups
- https://documentation.commvault.com/11.46/software/managing_salesforce_gdpr_requests_using_compliance_manager.html
- https://go.odaseva.com/hubfs/Data%20Sheets/Odaseva%20-%20Archiving%20Agent%20-%20Data%20Sheet.pdf.pdf
- Heimdall repo (local, source only): `README.md`, `src/main/resources/db/init.sql`, `web/RestoreService.java`
- orglet repo: `.planning/research/HEIMDALL-FORMAT.md`, `.planning/ROADMAP.md` backlog 999.10 and 999.11, `packages/metadata/standard/objects/Content*.json`, `packages/api/ui/index.html`
