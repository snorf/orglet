# Roadmap: orglet

## Milestones

- ✅ **v1.0 hardening** — Phases 1-7 (shipped 2026-10-12) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 real-org fidelity** — Phases 8-14 (shipped 2026-11-01) — [archive](milestones/v1.1-ROADMAP.md)
- 🚧 **v1.2 archive mode** — Phases 15-21 (in progress)

## Phases

<details>
<summary>✅ v1.0 hardening (Phases 1-7) — SHIPPED 2026-10-12</summary>

- [x] Phase 1: Test Infrastructure & CI (4/4 plans) — completed 2026-10-01
- [x] Phase 2: Custom-Object Key-Prefix Persistence (3/3 plans) — completed 2026-10-02
- [x] Phase 3: Thin Standard-Object Baselines (4/4 plans) — completed 2026-10-08
- [x] Phase 4: Polymorphic Lookups & SOQL TYPEOF (7/7 plans) — completed 2026-10-08
- [x] Phase 5: Roll-Up Summary Fields (7/7 plans) — completed 2026-10-09
- [x] Phase 6: Bulk API 2.0 Persistence (6/6 plans) — completed 2026-10-10
- [x] Phase 7: Conformance Re-Run & Milestone Acceptance (6/6 plans) — completed 2026-10-12

Full phase details, goals and success criteria: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md).
Audit: [milestones/v1.0-MILESTONE-AUDIT.md](milestones/v1.0-MILESTONE-AUDIT.md).

</details>

<details>
<summary>✅ v1.1 real-org fidelity (Phases 8-14) — SHIPPED 2026-11-01</summary>

- [x] Phase 8: Upgrade Safety Net & Nullable Key Prefixes (10/10 plans) — completed 2026-10-13
- [x] Phase 9: Baseline Generator, Parity & OwnerId Narrowing (9/9 plans) — completed 2026-10-14
- [x] Phase 10: Business Standard Objects (6/6 plans) — completed 2026-10-16
- [x] Phase 11: Custom Metadata, Custom Settings & Labels (9/9 plans) — completed 2026-10-21
- [x] Phase 12: sigha Resync & Formula Globals (8/8 plans) — completed 2026-10-23
- [x] Phase 13: Roll-Ups over Formula Fields (8/8 plans) — completed 2026-10-24
- [x] Phase 14: Check Report & Enterprise Acceptance (12/12 plans) — completed 2026-10-31

Full phase details, goals and success criteria: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md).
Audit: [milestones/v1.1-MILESTONE-AUDIT.md](milestones/v1.1-MILESTONE-AUDIT.md).

</details>

### 🚧 v1.2 archive mode (Phases 15-21)

Goal: spin up orglet on an SFDX retrieve plus a Heimdall backup and browse the former org read-only, through the Salesforce API and a simple record view, with files served straight from the backup store. Research: `research/SUMMARY.md` (decisions D1-D5).

- [ ] **Phase 15: Files Model** - ContentDocument auto-create, versions, VersionData download, ContentDocumentLink, blob store interface
- [ ] **Phase 16: Archive Fixture Generator** - deterministic Heimdall-shaped backup of `examples/acme` in `examples/acme-archive`
- [ ] **Phase 17: Archive Mode & Read-Only** - persisted org mode, write refusal, no-write `up`, frozen formula storage
- [ ] **Phase 18: Archive Loader** - `orglet archive load` streams the backup into an empty archive org
- [ ] **Phase 19: Erasure** - CLI-only hard delete with a ledger the loader respects
- [ ] **Phase 20: Record Browsing UI** - search, record page, related lists, files, archive banner
- [ ] **Phase 21: Archive Acceptance** - end-to-end proof on public fixtures in CI (pglite and Postgres)

Phase order, one line each: 15 first because the fixture cannot hold files and the loader cannot place them until the files model and ContentDocumentLink exist; 16 next because loader tests need the fixture; 17 before the loader because the persisted mode and frozen-formula storage must exist before rows are written (else the next `up` reports schema-drop) and the refusal contract is testable by loading rows through SQL; 18 needs 16 and 17; 19 needs the loader because the ledger is consulted by it; 20 needs files (15) and the read-only mode/banner (17) and is verified last against a loaded fixture (18); 21 is the tail that proves the whole chain.

#### Phase Details

### Phase 15: Files Model
**Goal**: Files work in a normal org as in a real one, and blobs sit behind one store interface that archive mode can later back with the external store
**Depends on**: Nothing in v1.2 (builds on v1.1 Phase 10 baseline objects)
**Requirements**: FILE-03, FILE-04, FILE-05, FILE-06, FILE-07, FILE-08, FILE-09
**Success Criteria** (what must be TRUE):
  1. A client inserts a ContentVersion without `ContentDocumentId` and gets a ContentDocument with `IsLatest = true`, `VersionNumber = "1"` and mirrored title/type/size; describe reports `ContentDocumentId` as `nillable: false`
  2. Inserting a second ContentVersion with an existing `ContentDocumentId` flips the old version to `IsLatest = false`, increments `VersionNumber` and updates the ContentDocument's `LatestPublishedVersionId`
  3. A base64 `VersionData` insert yields a server-computed MD5 `Checksum`, `ContentSize`, `FileType` and `FileExtension`; `GET .../ContentVersion/{id}/VersionData` streams the exact bytes with `Content-Type` and `Content-Length`; records and SOQL carry the URL, never bytes; a multipart body answers `UNSUPPORTED:content-multipart`
  4. A ContentDocumentLink can attach a file to any keyed record, and SOQL on it without an `Id`, `ContentDocumentId` or `LinkedEntityId` filter is rejected with `MALFORMED_QUERY`
  5. Deleting a ContentDocument soft-deletes its versions and links and undelete restores them together; a missing blob answers 404 plus a diagnostic and a checksum mismatch is reported; `Attachment.Body` and `Document.Body` still answer `UNSUPPORTED:blob-field`
**Plans**: 10 plans in 6 waves
Plans:
- [x] 15-01-PLAN.md — Base64 FieldType end to end (bytea, describe, coercion with the D-05 cap, Store exclusion)
- [x] 15-02-PLAN.md — BlobStore interface, InlineBlobStore, blobKey, sourced FileType/Content-Type table
- [x] 15-03-PLAN.md — Baseline regeneration: ContentDocumentLink, VersionData as Base64, required ContentDocumentId, cascades, blob-field area
- [ ] 15-04-PLAN.md — LinkedEntityId expanded to every custom object at load time
- [ ] 15-05-PLAN.md — NOT NULL for ContentVersion.ContentDocumentId, migrate schema-notnull reconcile, v1.1 upgrade test
- [ ] 15-06-PLAN.md — Engine files step: document auto-create, versions, mirror, auto-link, blob put
- [ ] 15-07-PLAN.md — Delete/undelete cascade (set-null fix), update mirror, ContentDocumentLink DML contract
- [ ] 15-08-PLAN.md — SOQL: blob URL instead of bytes, ContentDocumentLink mandatory filter
- [ ] 15-09-PLAN.md — REST: VersionData download with MD5 check, URLs in records, multipart and 413 refusals, README
- [ ] 15-10-PLAN.md — files-check SDK conformance legs and the Postgres/conformance phase gate
**Notes**: Regenerating the baseline must keep `baseline-gen-check` and the v1-vs-v2 diff gate green; include an upgrade test on a populated v1.1 database. Open: archive orgs keep `ContentDocumentId` nullable versus loader-synthesised stub documents (PITFALLS P18).

### Phase 16: Archive Fixture Generator
**Goal**: A public, deterministic Heimdall-shaped backup of the acme org exists in the repo for every later archive test
**Depends on**: Phase 15 (the fixture contains ContentVersions with blobs)
**Requirements**: FIX-01
**Success Criteria** (what must be TRUE):
  1. One script under `scripts/` boots orglet on `examples/acme` with a fixed clock and writes `examples/acme-archive/` from Bulk 2.0 query output in Heimdall's field order
  2. The output has the S3 key layout with two periods, `_deleted` folders, `Period=0/files/` blobs for the fixture's ContentVersions, and a dump of the `objects`/`csvfiles`/`backup_runs` index
  3. Running the script twice produces byte-identical output, and each blob's MD5 equals its ContentVersion `Checksum`
**Plans**: TBD
**Notes**: Needs a seeded id/clock seam in engine/schema (PITFALLS P23); the index dump is written independently of the loader so the loader test is not circular.

### Phase 17: Archive Mode & Read-Only
**Goal**: An org can be marked archive, refuses every write, and starts without writing a single row
**Depends on**: Phase 15 (external blob store plugs in here), Phase 16 only for later tests
**Requirements**: ARCH-01, ARCH-02, ARCH-03, ARCH-04
**Success Criteria** (what must be TRUE):
  1. The org mode (`live` | `archive`, as-of date, source) is persisted in `_orglet`; `up` reads it, no flag starts an archive org writable, and `orglet check`, the limits/org-info endpoint and the UI show mode and as-of date
  2. In an archive org, REST insert/update/upsert/delete/undelete, each composite subrequest, Bulk 2.0 ingest job creation, SOAP and `emptyRecycleBin` all answer one real Salesforce status code with HTTP 403, while query, queryAll, describe, limits and Bulk 2.0 query keep working; jsforce and simple-salesforce surface the code without retrying (a table-driven test covers every non-GET route)
  3. `up` on an archive org writes no data (no bootstrap rows, `__mdt` sync, roll-up backfill or formula roll-up admission) and a second `up` leaves every table's row count unchanged; login works with a synthetic admin session
  4. Formula and roll-up fields are stored columns of backed-up values, selectable, filterable and orderable in SOQL, never recomputed, with describe still `calculated: true`; the next `up` reports no `schema-drop` or `schema-narrow` for them
**Plans**: TBD
**Notes**: Discuss-phase decisions: the read-only status code and whether it carries the `UNSUPPORTED:` marker (D1, owns ARCH-02); the foreign-key policy of archive-mode DDL (D2, shapes the tables the loader writes); frozen-storage naming (`frozen` flag versus storage enum). Audit every `formula !== undefined` site.

### Phase 18: Archive Loader
**Goal**: `orglet archive load` turns a Heimdall index plus object store into a populated archive org without losing or inventing data
**Depends on**: Phase 16, Phase 17
**Requirements**: LOAD-01, LOAD-02, LOAD-03, LOAD-04, LOAD-05, LOAD-06, LOAD-07, LOAD-08
**Success Criteria** (what must be TRUE):
  1. Loading `examples/acme-archive` into an empty org gives the latest version of every record of every modelled object, 15-character Ids normalised to 18, with a documented tie order; loading twice produces identical table contents
  2. `--as-of <date>` loads the latest version with `SystemModstamp <= date` and persists the date; `_deleted` rows appear only through `queryAll`; custom-object key prefixes derived from the data are reconciled before any row is written, and a conflict aborts the load
  3. Values coerce from Bulk CSV conventions; rows the schema cannot hold, CSV columns the retrieve lacks and references to absent records are counted per object and field as `UNSUPPORTED:archive-*` diagnostics (including `archive-dangling-reference`), never echo cell values and are never dropped or nulled silently
  4. Memory stays flat as CSV size grows; the Postgres `COPY` sink and the pglite `INSERT` sink produce identical tables, proved by a test
  5. The report lists per object rows loaded, deleted, versions skipped, dangling counts and blob references resolved/missing; `--summary` and `--json` work like `check`; abort exits non-zero and no record value is printed
**Plans**: TBD
**Notes**: Day-1 spike: probe `COPY` on pglite (D3, re-run on 0.5.15) before planning sinks; the sink interface with two implementations is the agreed fallback. Discuss-phase decision: the foreign-key policy of D2 decides how LOAD-06 is detected (post-load anti-join census versus pre-commit audit) and whether stub rows exist; version retention is latest-only (D5). Also open: stage-then-merge, CSV parser choice, lenient coercer.

### Phase 19: Erasure
**Goal**: A data subject's records can be permanently removed from an archive org, and stay removed after a reload
**Depends on**: Phase 18
**Requirements**: ERASE-01, ERASE-02
**Success Criteria** (what must be TRUE):
  1. `orglet archive erase --id` or `--ids-file` (with optional cascade and `--dry-run` first) hard-deletes the named records, and they are invisible to `query` and `queryAll`
  2. No HTTP path erases: `emptyRecycleBin` and Bulk `hardDelete` are refused like every other write
  3. Each erasure appends to a ledger in `_orglet` (object, Id, timestamp, reason, operator) that stores no erased values and survives `reset`
  4. Re-running `archive load` from the unchanged backup skips ledgered Ids, so erased records do not come back
**Plans**: TBD
**Notes**: Open sub-questions: cascade scope (master-detail only versus all children), anonymise versus delete, purge of `_orglet.bulk_*` rows. Blobs in the shared backup store are reported as left, not deleted.

### Phase 20: Record Browsing UI
**Goal**: A non-developer can find a record in the built-in UI, read it, follow its relationships and open its files
**Depends on**: Phase 15, Phase 17; verified against the loaded fixture from Phase 18
**Requirements**: BROWSE-01, BROWSE-02, BROWSE-03, BROWSE-04, BROWSE-05
**Success Criteria** (what must be TRUE):
  1. Typing in the home-page search box lists matches by name, email or phone grouped by object, each linking to its record (SOQL `LIKE` fan-out, no SOSL)
  2. `#/<Object>/<Id>` shows header (name, object label, deleted flag) and every field with its describe label; lookups, including polymorphic ones, are links; values render as text, never as HTML
  3. Related lists appear per child relationship that has rows, show the first N rows lazily and page through "view all"
  4. Files linked via ContentDocumentLink list with title, type, size and version and download through `fetch` with the bearer token, with the token never in a URL
  5. In an archive org every page shows "archive, read-only, data as of <date>" and deleted records are flagged
**Plans**: TBD
**UI hint**: yes

### Phase 21: Archive Acceptance
**Goal**: The whole archive chain is proven end to end on public fixtures in CI
**Depends on**: Phases 15-20
**Requirements**: ACC3-01
**Success Criteria** (what must be TRUE):
  1. In CI on pglite and on Postgres, `archive load` of `examples/acme-archive` into an empty org followed by `up` succeeds, and a second `up` changes no row count
  2. jsforce and simple-salesforce SOQL and describe against the archive org answer as the live acme org does, frozen formulas excepted
  3. `VersionData` downloads the fixture's bytes from the fixture's blob store, and every write attempt is refused
  4. Existing conformance suites stay green
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Test Infrastructure & CI | v1.0 | 4/4 | Complete | 2026-10-01 |
| 2. Custom-Object Key-Prefix Persistence | v1.0 | 3/3 | Complete | 2026-10-02 |
| 3. Thin Standard-Object Baselines | v1.0 | 4/4 | Complete | 2026-10-08 |
| 4. Polymorphic Lookups & SOQL TYPEOF | v1.0 | 7/7 | Complete | 2026-10-08 |
| 5. Roll-Up Summary Fields | v1.0 | 7/7 | Complete | 2026-10-09 |
| 6. Bulk API 2.0 Persistence | v1.0 | 6/6 | Complete | 2026-10-10 |
| 7. Conformance Re-Run & Milestone Acceptance | v1.0 | 6/6 | Complete | 2026-10-12 |
| 8. Upgrade Safety Net & Nullable Key Prefixes | v1.1 | 10/10 | Complete | 2026-10-13 |
| 9. Baseline Generator, Parity & OwnerId Narrowing | v1.1 | 9/9 | Complete | 2026-10-14 |
| 10. Business Standard Objects | v1.1 | 6/6 | Complete    | 2026-10-16 |
| 11. Custom Metadata, Custom Settings & Labels | v1.1 | 9/9 | Complete    | 2026-10-21 |
| 12. sigha Resync & Formula Globals | v1.1 | 8/8 | Complete    | 2026-10-23 |
| 13. Roll-Ups over Formula Fields | v1.1 | 8/8 | Complete    | 2026-10-24 |
| 14. Check Report & Enterprise Acceptance | v1.1 | 12/12 | Complete    | 2026-10-31 |
| 15. Files Model | v1.2 | 3/10 | In Progress|  |
| 16. Archive Fixture Generator | v1.2 | 0/0 | Not started | - |
| 17. Archive Mode & Read-Only | v1.2 | 0/0 | Not started | - |
| 18. Archive Loader | v1.2 | 0/0 | Not started | - |
| 19. Erasure | v1.2 | 0/0 | Not started | - |
| 20. Record Browsing UI | v1.2 | 0/0 | Not started | - |
| 21. Archive Acceptance | v1.2 | 0/0 | Not started | - |

## Backlog

Unsequenced ideas captured for a later milestone. 999.1-999.7 (the gaps observed after v1.0) were promoted into v1.1 and shipped; the items below remain. 999.10 (file upload) and 999.11 (archive mode) were promoted into v1.2 and removed from this list. Promote with `/gsd:review-backlog`.

### Phase 999.8: Platform events as publish-only objects (BACKLOG)

**Goal:** Load __e platform events as objects that accept POST /sobjects (publish) and describe correctly but store nothing queryable, with an optional change-event stream, as groundwork for EVT-01 (CDC/Platform Events to Kafka/SQS). Removes UNSUPPORTED:object-kind for __e.
**Requirements:** TBD
**Plans:** 3/10 plans executed

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.9: Heimdall end-to-end backup run against orglet (BACKLOG)

**Goal:** Run the Java Salesforce backup tool (Bulk 2.0 query-only client) against an orglet org as a conformance target: needs client_credentials grant on /services/oauth2/token, /limits, the backup-config custom object through the tooling-API schema check, and ContentVersion VersionData download (baseline v2). Deferred since phase 6.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.12: Formula fields through parent relationships in SOQL (BACKLOG)

**Goal:** Selecting a formula field through a parent relationship (`Parent__r.Formula__c`, or a `Parent.*` expansion that includes formula fields) currently throws `UNSUPPORTED:soql-formula` in `packages/soql/src/compile.ts`; the same area also refuses formula fields in WHERE, ORDER BY and GROUP BY and in child subqueries. Formulas are evaluated app-side over the root record today, so a parent-context evaluation needs the parent row (and its own parent traversals) loaded or pushed into SQL. Found by the enterprise fixture in Phase 14 through jsforce's `Opportunity.select('*, Account.*, Owner.Name')`, where `Account.*` expands to the fixture's Account formula fields; excluded enterprise-only in conformance/jsforce until implemented. Raised 2026-10-29.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.13: OIDC single sign-on for archive readers (BACKLOG)

**Goal:** Let an archive org be read behind a company's identity provider: OpenID Connect authorization-code login for the built-in UI and bearer-token validation for API clients, against any standard OIDC provider, replacing the permissive password emulation when configured. Together with a per-reader audit log (BROWSE-06) this is what makes an archive of personal data usable beyond a single developer's machine. Raised 2026-11-03 during v1.2 planning; deferred until the archive chain (Phases 15-21) works.
**Requirements:** AUTH-01, BROWSE-06
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)
