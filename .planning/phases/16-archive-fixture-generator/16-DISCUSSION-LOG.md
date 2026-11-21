# Phase 16: Archive Fixture Generator - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-07
**Phase:** 16-archive-fixture-generator
**Areas discussed:** Determinism seam (Ids and clock), Fixture content, Index dump format, Generator mechanics

---

## Determinism seam (Ids and clock)

### Where the seam lives

| Option | Description | Selected |
|--------|-------------|----------|
| Import mode + fixed bootstrap Ids | Generator supplies every Id and timestamp through import mode; only `bootstrapOrg` gets an options bag with fixed Ids and a fixed now; `generateId` untouched | ✓ |
| Process-global seed in ids.ts | `seedIdGenerator({ seed, now })` making `generateId` and the engine clock deterministic for the whole process; allows normal DML but introduces global state | |
| Injected IdGenerator/Clock | Typed interfaces on `EngineOptions` and `bootstrapOrg`, threaded through engine, files.ts, store and bootstrap | |

**User's choice:** Import mode + fixed bootstrap Ids (recommended)

### Id derivation

| Option | Description | Selected |
|--------|-------------|----------|
| Sequential per prefix from a fixed base | `001000000000001AAA`-style Ids in seed order, readable, Id order follows insert order | ✓ |
| Hash-derived like deriveCustomMetadataId | SHA-256 of (object, logical key), stable under reordering but unreadable | |
| Explicit Ids in seed data | Each seed record carries a hand-written Id | |

**User's choice:** Sequential per prefix from a fixed base (recommended)

### Timestamps

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit in seed data | Each record states creation and modification times; one fixed wall clock per period for key segments and backup_runs | ✓ |
| Derived from fixed base + sequence | Base instant per period plus n seconds in seed order | |
| You decide | Claude picks | |

**User's choice:** Explicit in seed data (recommended)

### Leak guard

| Option | Description | Selected |
|--------|-------------|----------|
| Guard in generator + double-run test | Verify every Id is in the allocation set and every datetime inside the period window before writing; plus a vitest double-run byte comparison | ✓ |
| Only the double-run test | Byte-identical output is the only check | |
| You decide | Claude picks the guard level | |

**User's choice:** Guard in generator + double-run test (recommended)

---

## Fixture content

### Object selection

| Option | Description | Selected |
|--------|-------------|----------|
| Like Heimdall: all replicateable, empty skipped | List `/sobjects/`, query every replicateable object, write CSV + backup_runs only for objects with rows; ContentDocumentLink becomes a Failed backup_runs row | ✓ |
| Explicit allow-list in the generator | A fixed list of objects in the script | |
| Only objects with seed data | Query only seeded objects; bootstrap objects left out | |

**User's choice:** Like Heimdall (recommended)

### Volume

| Option | Description | Selected |
|--------|-------------|----------|
| Tens of rows per object, one object split into two CSVs | 5-20 rows per object; BigTable__c larger and split into two jobs per period | ✓ |
| Minimal: a handful of rows, one CSV per object | Smallest fixture meeting the criteria | |
| Larger: hundreds of rows, several CSVs per object | Closer to reality, unreadable diffs, MBs of repo growth | |

**User's choice:** Tens of rows per object, one object split into two CSVs (recommended)

### Period 2 contents (multi-select)

| Option | Description | Selected |
|--------|-------------|----------|
| Updated records (new version, same Id) | Same Id in both periods with different version | ✓ |
| Deleted records (_deleted folders) | queryAll IsDeleted = true into `<Object>_deleted/` | ✓ |
| New ContentVersion version + dedup blob pair | Second version of one CV, two CVs sharing a Checksum, one binary blob | ✓ |
| New records + a version tie | Records first created in period 2 and a same-second tie across periods | |

**User's choice:** Updated records, deleted records, new CV version + dedup pair. New records and the tie case left out.

### Archive-yyyyMM period case

| Option | Description | Selected |
|--------|-------------|----------|
| No, only two normal periods | Roadmap says two periods; archive runs never verified against a real run | ✓ |
| Yes, a small case for one object | One object also under `Period=Archive-202602` with period -2602 in the index | |

**User's choice:** No, only two normal periods (recommended)

---

## Index dump format

### Format

| Option | Description | Selected |
|--------|-------------|----------|
| One SQL file: DDL + INSERT | `index.sql` runnable on psql and pglite; Phase 18 tests load it and point the loader at the URL | ✓ |
| JSON per table | Readable, but Phase 18 needs a seed function | |
| CSV per table (COPY format) | Compact, jsonb hard to read, DDL separate anyway | |

**User's choice:** One SQL file (recommended)

### Fidelity to Heimdall's tables

| Option | Description | Selected |
|--------|-------------|----------|
| Full documented column set | All columns from HEIMDALL-FORMAT §3, re-derived; metadata and name rules followed | ✓ |
| Only the columns the loader needs | Minimal subset | |
| You decide | Claude picks | |

**User's choice:** Full documented column set (recommended)

### Directory layout and s3path

| Option | Description | Selected |
|--------|-------------|----------|
| store/ + index.sql, s3path = bare key | `examples/acme-archive/store/OrgId=.../` mirrors the bucket root, `index.sql` and README beside it | ✓ |
| Flat: keys directly under acme-archive/ | One level less, bucket root and dump mixed | |
| You decide | Claude picks layout; bare key | |

**User's choice:** store/ + index.sql, s3path = bare key (recommended)

---

## Generator mechanics

### Database backend

| Option | Description | Selected |
|--------|-------------|----------|
| pglite in process | test/db.ts pattern, no Docker, throwaway database | ✓ |
| Postgres via ORGLET_DATABASE_URL | Docker Postgres like `orglet up` | |
| Both, pglite default | Flag for Postgres | |

**User's choice:** pglite in process (recommended)

### CSV production

| Option | Description | Selected |
|--------|-------------|----------|
| Real Bulk 2.0 jobs via createApiServer + app.inject | Seed through DmlEngine in import mode, then Bulk query jobs with Heimdall's SOQL form and Sforce-Locator paging | ✓ |
| Engine + writeCsv directly | Skip the HTTP layer | |

**User's choice:** Real Bulk 2.0 jobs via createApiServer + app.inject (recommended)

### Shared Heimdall-format helpers

| Option | Description | Selected |
|--------|-------------|----------|
| New package @orglet/archive with only the helpers | packages/archive born now with pure format functions and index DDL; Phase 18 adds the loader there | ✓ |
| In @orglet/engine beside blobKey | No new package yet | |
| Local to scripts/gen-archive-fixture/ | Phase 18 would copy them | |

**User's choice:** New package @orglet/archive with only the helpers (recommended)

### --check mode

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, --check now; CI job stays FIX-02 | `archive-fixture:gen` / `archive-fixture:check` mirroring the baseline scripts | ✓ |
| No, only gen + the double-run test | Smallest surface | |
| Yes, and the CI job too (pull in FIX-02) | Scope change | |

**User's choice:** Yes, --check now; CI job stays FIX-02 (recommended)

---

## Claude's Discretion

- Seed module shape, fixed wall-clock dates per period, fixed Organization Id, bootstrap row names.
- Deterministic Bulk job Ids / CSV file names.
- `BootstrapOptions` field names and RecordType Id keying.
- Which seed values exercise which field types.
- Exactness of `backup_runs` counters.

## Deferred Ideas

- Archive-yyyyMM case, version tie, period-2-only records (FIX-03 / Phase 18 unit tests).
- `fixture-gen-check` CI job (FIX-02, v2).
- Hand-written adversarial CSV set (FIX-03, v2).
- `FirstPublishLocationId` expansion to custom objects (Phase 15 residual).
