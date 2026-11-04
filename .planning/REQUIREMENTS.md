# Requirements: orglet — Milestone v1.2 (archive mode)

**Defined:** 2026-11-03
**Core Value:** A Salesforce client pointed at orglet cannot tell the difference for the surface orglet
claims to support, and anything it does not support is logged as `UNSUPPORTED:<area>` rather than faked.

**Milestone goal:** Spin up orglet on an SFDX retrieve plus a Heimdall backup and browse the former org
read-only, through the Salesforce API and a simple record view, with files served straight from the
backup store. Research: `.planning/research/SUMMARY.md` (five decisions for discuss-phase: read-only
status code, foreign keys in archive mode, COPY on pglite, erasure sub-questions, version retention) and
`.planning/research/HEIMDALL-FORMAT.md` (backup format facts).

ID numbering continues from `milestones/v1.1-REQUIREMENTS.md`: the parked v2 placeholder **FILE-01** is
superseded by FILE-03..FILE-09 below; **FILE-02** stays deferred.

## v1 Requirements

### Files (ContentVersion, ContentDocument, ContentDocumentLink)

- [x] **FILE-03**: Inserting a ContentVersion without `ContentDocumentId` creates its ContentDocument and
  sets `ContentDocumentId`, `IsLatest = true` and `VersionNumber = "1"`; the ContentDocument mirrors
  `Title`, `FileType`, `FileExtension`, `ContentSize` and `LatestPublishedVersionId`. The Phase 10
  nullable override on `ContentDocumentId` is removed, so describe reports `nillable: false` as a real
  org does (archive loads supply the column from the backup)
- [ ] **FILE-04**: Inserting a ContentVersion with an existing `ContentDocumentId` adds a version: the
  previous version gets `IsLatest = false`, `VersionNumber` increments, and the ContentDocument mirrors
  the new latest version
- [x] **FILE-05**: `VersionData` is accepted as base64 in the JSON insert body; the server computes
  `Checksum` (MD5 hex), `ContentSize`, `FileType` and `FileExtension` from the bytes and `PathOnClient`;
  a multipart request body is refused with `UNSUPPORTED:content-multipart`
- [x] **FILE-06**: `GET /services/data/vXX.X/sobjects/ContentVersion/{id}/VersionData` streams the bytes
  with `Content-Type` and `Content-Length`; record JSON and SOQL results carry the `VersionData` URL,
  never bytes; describe lists `VersionData` as type `base64`
- [x] **FILE-07**: `ContentDocumentLink` is a generated baseline object with a polymorphic
  `LinkedEntityId` to every keyed object, `ShareType` and `Visibility`; a SOQL query on it that does not
  filter on `Id`, `ContentDocumentId` or `LinkedEntityId` is rejected with Salesforce's implementation-
  restriction error (`MALFORMED_QUERY`)
- [x] **FILE-08**: Deleting a ContentDocument soft-deletes its ContentVersions and ContentDocumentLinks;
  undelete restores them together
- [x] **FILE-09**: Blobs live behind one store interface: `bytea` in Postgres by default, a checksum-
  addressed external store (key `files/<checksum[0:4]>/<checksum>.<extension>`, local directory or
  S3-compatible endpoint) in archive mode. A missing blob answers 404 plus a diagnostic, never empty
  bytes; a download whose MD5 differs from `Checksum` is reported. `Attachment.Body` and
  `Document.Body` stay `UNSUPPORTED:blob-field`

### Archive mode (read-only)

- [ ] **ARCH-01**: The org mode (`live` | `archive`, with the as-of date and source description) is
  persisted in `_orglet` by `archive load` and read by `up`; an archive org cannot be started writable
  and no flag overrides it. `orglet check`, `/services/data/vXX.X/limits` (or org info) and the UI show
  the mode and as-of date
- [ ] **ARCH-02**: In archive mode every write is refused with one real Salesforce status code (chosen
  in discuss-phase) and HTTP 403: REST sobjects insert/update/upsert/delete/undelete, composite (per
  subrequest), Bulk 2.0 ingest at job creation, SOAP, `emptyRecycleBin`. Reads work unchanged: query,
  queryAll, describe, limits, Bulk 2.0 query, `VersionData`. jsforce and simple-salesforce surface the
  code without retrying
- [ ] **ARCH-03**: `up` on an archive org writes no data: no bootstrap rows, no `__mdt` sync, no roll-up
  backfill, no formula roll-up admission removing columns; a second `up` leaves every table's row count
  unchanged. Login still works with a synthetic admin session
- [ ] **ARCH-04**: Formula and roll-up fields of an archive org are stored columns holding the backed-up
  values: selectable, filterable and orderable in SOQL, never recomputed, with describe still reporting
  `calculated: true`. Text formulas use `text`, numeric formulas unconstrained `numeric`; the next `up`
  reports no `schema-drop`/`schema-narrow` for them

### Archive loader

- [ ] **LOAD-01**: `orglet archive load` reads a Heimdall index (Postgres tables `objects`, `csvfiles`,
  `backup_runs`, via a read-only connection URL) and an object store (S3-compatible endpoint or a local
  directory mirroring the key layout) and loads the latest version of every record of every object the
  retrieve models into an empty target org, with a documented total order for ties (period, version,
  csv_id, row); 15-character Ids are normalised to 18
- [ ] **LOAD-02**: `--as-of <ISO date>` loads the latest version with `SystemModstamp <= date` instead;
  the date is persisted in the org mode (ARCH-01)
- [ ] **LOAD-03**: Rows from `<Object>_deleted` folders (`IsDeleted = true`) load as soft-deleted and
  are visible only through `queryAll`
- [ ] **LOAD-04**: Custom-object key prefixes are derived from the loaded Ids and registered through the
  existing prefix reconciliation before any row is written; a prefix conflict aborts the load
- [ ] **LOAD-05**: Values are coerced from Bulk 2.0 CSV conventions (datetime `+0000`, empty vs null per
  type, booleans, multi-picklists, numeric scale) by a lenient archive coercer; rows the schema cannot
  hold and CSV columns the retrieve lacks are counted per object and field as `UNSUPPORTED:archive-*`
  diagnostics that never echo cell values, and are never dropped silently
- [ ] **LOAD-06**: References to records absent from the load (users, deleted parents, unmodelled
  polymorphic targets) are counted per object and field as `UNSUPPORTED:archive-dangling-reference`
  in the load report and never nulled silently (whether foreign keys exist in archive-mode DDL is a
  discuss-phase decision)
- [ ] **LOAD-07**: The load streams: each CSV is read once, rows are written in batches through a sink
  with a `COPY` implementation on Postgres and a portable `INSERT` implementation on pglite, and a test
  proves both produce identical tables; memory does not grow with CSV size
- [ ] **LOAD-08**: The load report lists per object the rows loaded, deleted rows, versions skipped,
  dangling-reference counts and blob references resolved/missing, with `--summary` and `--json` like
  `check`; the command exits non-zero on abort and never prints record values

### Erasure

- [ ] **ERASE-01**: `orglet archive erase` hard-deletes the records named by `--id` or `--ids-file`
  (optional cascade to children, `--dry-run` first) through SQL outside `DmlEngine`; erased rows are
  invisible to `query` and `queryAll`. No HTTP path performs an erasure: `emptyRecycleBin` and Bulk
  `hardDelete` are refused like every other write in archive mode
- [ ] **ERASE-02**: Every erasure is appended to a ledger in `_orglet` (object, Id, timestamp, reason,
  operator) that never stores erased values; `archive load` skips ledgered Ids so a reload from the
  unchanged backup cannot resurrect them; the ledger survives `reset`

### Record browsing (built-in UI)

- [ ] **BROWSE-01**: The home page has a search box over the `Name`, email and phone fields of every
  searchable object (SOQL `LIKE` fan-out, no SOSL); results are grouped by object and link to records
- [ ] **BROWSE-02**: A record page at `#/<Object>/<Id>` shows a header (name, object label, deleted
  flag) and every field with its describe label; lookups, including polymorphic ones, render as links;
  booleans, dates and picklists render readably; record values are rendered as text, never as HTML
- [ ] **BROWSE-03**: Related lists are shown per child relationship that has rows, with the first N rows
  and a "view all" list with paging, loaded lazily
- [ ] **BROWSE-04**: Files linked to a record (via ContentDocumentLink) are listed with title, type,
  size and version, and download through `fetch` with the bearer token; the token never appears in a URL
- [ ] **BROWSE-05**: In archive mode every page carries a banner "archive, read-only, data as of
  <date>", and deleted records are flagged

### Public fixture and acceptance

- [ ] **FIX-01**: A deterministic script under `scripts/` boots orglet on `examples/acme` with a fixed
  clock, runs Bulk 2.0 query per object in Heimdall's field order, and writes `examples/acme-archive/`:
  the S3 key layout with two periods and `_deleted` folders, `Period=0/files/` blobs for the fixture's
  ContentVersions, and a dump of the `objects`/`csvfiles`/`backup_runs` index. A re-run produces
  identical bytes
- [ ] **ACC3-01**: End to end on public fixtures in CI (pglite and Postgres): `archive load` of
  `examples/acme-archive` into an empty org, `up`, SOQL and describe through jsforce and
  simple-salesforce answer as the live acme org does (frozen formulas excepted), `VersionData`
  downloads from the fixture's blob store, every write is refused, a second `up` changes no row count

## v2 Requirements

Deferred to later milestones. Tracked but not in the current roadmap.

### Files

- **FILE-02**: Attachment and Document blob fields
- **FILE-10**: Multipart `VersionData` upload (`entity_content` + binary part), the path jsforce and
  simple-salesforce use for large files (`UNSUPPORTED:content-multipart` until then)

### Archive

- **LOAD-09**: Version pointer side table `(id, version, csv_id)` so a later history/diff view can
  re-read the backup CSVs on demand (v1.2 loads latest-only; a different as-of is a reload)
- **ERASE-03**: File erasure: a ContentVersion with all versions of its ContentDocument and its links;
  `bytea` removed when no other version shares the checksum; external-store blobs reported as left in
  the backup store, which orglet does not own
- **ERASE-04**: Erase by person (every row referencing a Contact/Lead Id plus email match) with a
  dry-run report; post-erasure verification report
- **AUTH-01**: OpenID Connect single sign-on for archive readers against a generic OIDC provider
  (authorization code flow for the UI, bearer-token validation for API clients), replacing the permissive
  password emulation when enabled; the prerequisite for BROWSE-06 (raised 2026-11-03, after v1.2 ships)
- **BROWSE-06**: Audit log of who viewed which record (needs AUTH-01)
- **BROWSE-07**: Version history and field diff per record (needs LOAD-09)
- **FIX-02**: Regenerate-and-diff CI job for `examples/acme-archive` (like `baseline-gen-check`)
- **FIX-03**: Hand-written adversarial CSV set (quoted newlines, BOM, 15-char Ids, empty vs null,
  missing columns, duplicates across periods) independent of the generator
- **HEIM-01**: Heimdall end-to-end backup run against orglet (backlog 999.9): `client_credentials`
  grant, `/limits`, tooling API, `Heimdall_Backup_Config__c`

### Events and platform (carried)

- **EVT-01**: Platform events (`__e`) as publish-only objects; CDC / Platform Events to Kafka, SQS,
  webhooks; Pub/Sub API (backlog 999.8)
- **SEC-01**: Profiles, permission sets, custom permissions (`$Permission`), FLS, OWD enforcement
- **FLOW-01**: Flow interpreter
- **APEX-01**: Apex runtime behind `TriggerExecutor`
- **UI-01**: UI API and LWC/SLDS front end

### Headless completeness (carried from v1.0)

- **HEAD-01**: Task and Event as full objects with polymorphic `WhoId`/`WhatId`
- **HEAD-02**: SOSL search
- **HEAD-03**: Metadata API zip import
- **HEAD-04**: Compound fields (Address, Name) selectable in SOQL
- **HEAD-05**: Record types per picklist value sets
- **CHECK-03**: `orglet check --baseline <report.json>` diff and `--max-warnings N`
- **CMDT-05**: Queues loaded as Group rows with owner-eligibility checks
- **CSET-03**: `$Setup` on list custom settings, `$Label` translations, per-user language
- **ROLLX-01**: Force-recalculation helper (`orglet rollup --recompute`) for definition changes
- **ROLLX-02**: More than 25 roll-ups per object
- **BULKX-01**: Asynchronous Bulk processing; **BULKX-02**: PK chunking
- **SOQLF-01**: Formula fields through parent relationships in SOQL (backlog 999.12)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Any DML override flag "for tests" in archive mode | The point of the mode is that the data cannot change; use a live org for tests |
| Erasure over REST or Bulk (`hardDelete`, `emptyRecycleBin`) | An HTTP path that deletes in a read-only org with permissive auth defeats the mode; CLI only |
| Silent success on refused writes | Never; a client must see the refusal (`UNSUPPORTED` honesty rule) |
| Restore to a live Salesforce org | Heimdall's job, not orglet's |
| Serving queries straight from the S3 CSVs | Decided: Postgres is a rebuildable cache fed by `archive load`; a CSV query engine beside the SOQL compiler is a second execution path |
| Editing or scrubbing the Heimdall backup store from orglet | Separate system; erasure removes orglet's rows and reports blobs left in the store |
| SOSL, full-text index, sharing/FLS for readers | Out of scope since v1.0; UI search uses SOQL `LIKE`, one reader role |
| Running validation rules or triggers before refusing a write | Refuse first, so no side effect can leak |
| Real-org backup data in the repo, tests, CI or Claude context | Level 1 rule; the author runs the loader on the real backup privately and feeds back generic areas and counts only |
| Behaviour-diffing against a real Salesforce org | Developer MSA (unchanged) |
| Scraping developer.salesforce.com HTML | Pages return 403 to tools; published datasets, PDFs and SDK source are the public sources |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FILE-03 | Phase 15 | Complete |
| FILE-04 | Phase 15 | Pending |
| FILE-05 | Phase 15 | Complete |
| FILE-06 | Phase 15 | Complete |
| FILE-07 | Phase 15 | Complete |
| FILE-08 | Phase 15 | Complete |
| FILE-09 | Phase 15 | Complete |
| ARCH-01 | Phase 17 | Pending |
| ARCH-02 | Phase 17 | Pending |
| ARCH-03 | Phase 17 | Pending |
| ARCH-04 | Phase 17 | Pending |
| LOAD-01 | Phase 18 | Pending |
| LOAD-02 | Phase 18 | Pending |
| LOAD-03 | Phase 18 | Pending |
| LOAD-04 | Phase 18 | Pending |
| LOAD-05 | Phase 18 | Pending |
| LOAD-06 | Phase 18 | Pending |
| LOAD-07 | Phase 18 | Pending |
| LOAD-08 | Phase 18 | Pending |
| ERASE-01 | Phase 19 | Pending |
| ERASE-02 | Phase 19 | Pending |
| BROWSE-01 | Phase 20 | Pending |
| BROWSE-02 | Phase 20 | Pending |
| BROWSE-03 | Phase 20 | Pending |
| BROWSE-04 | Phase 20 | Pending |
| BROWSE-05 | Phase 20 | Pending |
| FIX-01 | Phase 16 | Pending |
| ACC3-01 | Phase 21 | Pending |

**Coverage:**
- v1 requirements: 28 total
- Mapped to phases: 28
- Unmapped: 0 ✓

---
*Requirements defined: 2026-11-03*
*Last updated: 2026-11-03 after roadmap creation (Phases 15-21)*
