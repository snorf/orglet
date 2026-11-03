# Heimdall backup format (reference for milestone v1.2 archive mode)

Source: the open-source repo `devrandom-se/heimdall` (Java, Apache-2.0 style open source), read on
2026-11-03 at its `main` (d526e54, 2026-10-02). Paths below are relative to that repo. Only source,
SQL, README and docs were read; no backup data, `.env` or credential files. Verify against the repo
before relying on a line number.

## 1. Storage layout

- Two stores used together: S3 (or any S3-compatible endpoint via the AWS SDK with
  `DefaultCredentialsProvider`) for CSVs and blobs, Postgres for the index. No local-filesystem
  backend; CSVs only sit in a temp dir before upload.
- One bucket per org (`AWS_S3_BUCKET_NAME`), keys prefixed `OrgId=<orgId>`.
- Record CSV key (`src/main/java/se/devrandom/heimdall/storage/S3Service.java:124`):

  ```java
  String suffix = queryAll ? "_deleted" : "";
  String key = String.format("OrgId=%s/Period=%s/Year=%s/Month=%s/Date=%s/%s%s/%s",
          orgId, periodOverride, year, month, day, objectName, suffix, fileName);
  ```

  - `Period` in S3 is `yyyyMM` (e.g. `202602`) for normal backups and `Archive-yyyyMM` for archive
    runs (`batchprocessing/ObjectBackupProcessor.java:630`). Year/Month/Date are the upload date.
  - `fileName` is `<bulkJobId>.csv` (`salesforce/BulkQueryResultDownloader.java:123`). The README's
    `Account_20260115_143022.csv` example does not match the code.
  - `text/csv`, no gzip, no client-side encryption (bucket SSE-S3 only).
- Chunking: one CSV per Bulk 2.0 query job. Dynamic batch size 50K-200K records via SOQL `LIMIT`
  plus a SystemModstamp/Id checkpoint; result pages (`maxRecords=2000`, Sforce-Locator) are
  concatenated into one file with one header. An object therefore has many CSVs per day.
- Blob key: `OrgId=<org>/Period=0/files/<checksum[0:4]>/<checksum>.<FileExtension>`
  (`S3Service.java:304-310`). Older builders under `.../ContentVersionFile/<cvId>.<ext>` exist but
  the current download path uses only the checksum key.
- Postgres `period` is YYMM as int (`2602`), archives negative (`-2602`)
  (`storage/PostgresService.java:88-93`, `:840`). Not the same format as the S3 key.

## 2. Record format

- CSV is Bulk API 2.0 query output stored unchanged: job created with
  `{"operation":"query"|"queryAll","contentType":"CSV","lineEnding":"LF","query":...}`, default
  COMMA delimiter (`salesforce/SalesforceService.java:661-666`). Only change: repeated page headers
  dropped (`BulkQueryResultDownloader.java:286-308`). Nulls, booleans, dates, datetimes
  (`2026-01-15T14:30:22.000+0000`) and multi-picklists are whatever Bulk 2.0 emits.
- Ids are 18 characters (validator accepts 15 or 18, `BulkQueryResultDownloader.java:378`).
- Column order (`salesforce/objects/DescribeSObjectResult.java:101-120`): every describe field in
  describe order, except `type=address`, `type=base64`, a field named `Tier`, and `Id` /
  `SystemModstamp`; then `SystemModstamp` (if present), then `Id` last. Header = SOQL field API names.
  No relationship columns.
- Included: formula and roll-up fields (exclusion ignores `calculated`), CreatedDate,
  LastModifiedDate, OwnerId, IsDeleted. Compound address fields excluded, their components included.
- SOQL (`DescribeSObjectResult.java:129-143`):

  ```
  SELECT <fields> FROM X WHERE [IsDeleted = true AND]((SystemModstamp = :ts AND Id > ':id') OR SystemModstamp > :ts)
  ORDER BY SystemModstamp ASC, Id ASC LIMIT n
  ```

  Falls back to CreatedDate when the object has no SystemModstamp.
- Deleted records: phase 2 per object runs `queryAll` with `IsDeleted = true` into
  `<Object>_deleted/` (`ObjectBackupProcessor.java:469-554`).
- Version history: one row per captured version, no diffs. Each CSV row becomes an `objects` row
  keyed `(org_id, period, id, version)` where `version = SystemModstamp` as epoch seconds
  (`PostgresService.java:210-221`). The checkpoint resets each period: every month starts with a full
  snapshot followed by increments. Edits within one second or between two runs collapse into one
  version. Diffs are computed in the GUI.

## 3. Index database (Postgres)

DDL in `src/main/resources/db/init.sql` plus runtime DDL in `PostgresService.initializeDatabase()`
(`storage/PostgresService.java:473-590`); `restore_log` in `web/RestoreService.java:83-94`. Plain
JDBC, no migration tool, no JPA.

```sql
csvfiles(csv_id int identity PK, period int NOT NULL, s3path text NOT NULL)   -- no org_id, no object_name
objects(id text, period int, version int, metadata jsonb, org_id text, csv_id int,
        is_deleted bool default false, object_name text, name text NOT NULL,
        PK (org_id, period, id, version))
backup_runs(run_id bigserial PK, object_name, org_id, period, status, query_all bool,
        started_at, completed_at, last_checkpoint_id, last_checkpoint_modstamp timestamp,
        records_processed, records_failed, bytes_transferred, error_message, archive_expression)
object_stats(org_id, object_name, unique_records, total_versions, deleted_count, archived_count,
        updated_at, PK(org_id, object_name))
restore_log(id serial, original_id, new_id, object_name, period, sandbox_name, restored_at, restored_fields)
```

- No org table; `org_id` is a column. One `backup_runs` row per object, period and active/deleted phase.
- `objects.name` = first of Name, Subject, Title, CaseNumber, DeveloperName, Label that exists, else Id.
- `objects.metadata` is NOT the full record: only non-empty fields ending in `Id`, describe reference
  fields, and for ContentVersion also Checksum, FileType, FileExtension, ContentSize, Title,
  PathOnClient (`PostgresService.java:192-264`). No per-record hash.
- Full field values live only in the CSV: `objects.csv_id -> csvfiles.s3path`, then a streaming scan
  of the CSV for the Id (`web/RestoreService.java:129-162`, `S3Service.selectRecordFromCsv`).
  `s3path` is the bare key; the reader also strips an optional `s3://bucket/` prefix.

## 4. Files / blobs

- Only ContentVersion is backed up: `GET /services/data/vXX/sobjects/ContentVersion/{Id}/VersionData`
  (`salesforce/ContentVersionDownloadTask.java:157`), 10 threads, deleted CVs skipped, optional
  `HEIMDALL_SKIP_FILES_BELOW_KB`. Attachment.Body, Document.Body and other base64 fields are
  excluded from the SOQL and never fetched.
- Deduplication key: Salesforce `Checksum` (MD5 hex) + `FileExtension`. HEAD on the checksum key
  before upload, backed by an in-memory cache from `objects.metadata->>'Checksum'`
  (`PostgresService.loadContentVersionChecksums`, ~line 597). Streamed PUT, no compression.
- S3 user metadata per blob: `checksum`, `salesforce-id` (first CV Id that uploaded it),
  `upload-date`; Content-Type guessed from extension (`S3Service.java:350-417`).
- CV row -> blob: take `Checksum` and `FileExtension` (from `objects.metadata` or the CSV) and build
  `Period=0/files/<cs[0:4]>/<cs>.<ext>`. `/api/download-url?id=<cvId>` does this and returns a
  presigned URL (`web/WebController.java:221-253`).

## 5. Schema snapshot

None. Describe (`/sobjects/`, `/sobjects/X/describe`) is fetched every run and used only to build
SOQL and find reference fields; nothing persists labels, types, picklists or record types
(`salesforce/objects/Field.java` parses name, type, createable, updateable, label, nillable,
defaultValue, referenceTo, picklistValues, length). The CSV header gives API names only.
**orglet needs the SFDX retrieve for the schema; the backup supplies data only.**

## 6. Restore / archive features

- Archive is configured per object in Salesforce on `Heimdall_Backup_Config__c` (`Archive__c`,
  `Archive_Age_Days__c`, `Archive_Expression__c`, `Archive_Action__c` = "Archive Only" /
  "Archive and Delete"). Archive SOQL: `CreatedDate < threshold AND (expr)`
  (`DescribeSObjectResult.java:156-180`); output under `Period=Archive-yyyyMM` and negative
  Postgres period. The Salesforce delete step is not implemented (`ROADMAP.md:164-175`).
- Restore only through the web GUI (Spring `web` profile): `POST /api/compare`, `POST /api/restore`
  (PATCH chosen fields or POST to recreate) into one configured sandbox
  (`web/SandboxRestoreClient.java`); `GET /api/restore-form`, `/api/lookup-search`,
  `/api/download-url`; pages `/record`, `/records`, `/deleted`, `/archived`, `/objects`.
- "Point-in-time" = picking a `(period, version)` row. No org-wide restore, no CLI, no machine read
  API. **orglet should read Postgres plus S3 directly rather than call Heimdall.**

## 7. Salesforce surface Heimdall uses (for a future end-to-end run, backlog 999.9)

- Auth: `POST /services/oauth2/token` with `client_credentials` (form body, built with
  `fromMultipartData`) or JWT bearer (`SalesforceService.java:1409-1470`, `JWT_AUTH_SETUP.md`).
  Base URL is the fixed `SALESFORCE_BASE_URL` (`config/WebClientConfig.java:53`); `instance_url`
  from the token is not used.
- `GET /limits`; `GET /sobjects/` (uses `replicateable`); `GET /sobjects/X/describe`; REST
  `GET /query/?q=` (`SELECT COUNT() ... WHERE SystemModstamp > ...`, and reading
  `Heimdall_Backup_Config__c`); `PATCH /sobjects/Heimdall_Backup_Config__c/ObjectName__c/{v}`;
  `PATCH /composite/sobjects/Heimdall_Backup_Config__c/ObjectName__c`; Tooling
  `POST /tooling/sobjects/CustomObject` and `/CustomField` for auto-migration
  (`salesforce/SalesforceSchemaManager.java:156,189`, off with `HEIMDALL_METADATA_AUTO_MIGRATE=false`).
- Bulk 2.0: `POST /jobs/query`, `GET /jobs/query/{id}`,
  `GET /jobs/query/{id}/results?maxRecords=2000&locator=`; reads `Sforce-Locator` (string `"null"`
  ends paging), `Sforce-NumberOfRecords` (checked against row count), `Sforce-Limit-Info`.
- `GET /sobjects/ContentVersion/{id}/VersionData`. Default API version `v61.0`. The org must contain
  `Heimdall_Backup_Config__c` (`sf-metadata/template/main/default/objects/`).

## 8. Fixtures

No reusable fixture backup in the repo: no `src/test/resources`, no sample CSVs or blobs.
`config/DemoDataSeeder.java` seeds synthetic Postgres rows with fake `s3path` values and no CSVs
behind them. Inline CSV strings in `BulkQueryResultDownloaderTest.java` and
`PostgresServiceCsvParsingTest.java`. orglet must generate its own fixture (planned: from
`examples/acme` through orglet's own Bulk 2.0 query output).

## Consequences for orglet's archive loader

- Input = Heimdall Postgres index + object store (S3 or a local mirror of the key layout). Pick the
  latest `version` per `(org_id, id)` across periods by default; an as-of date selects the latest
  version with `version <= asOf`. `_deleted` rows carry `IsDeleted = true` and map to soft-deleted.
- Full values come from CSV scans: group `objects` rows by `csv_id`, stream each CSV once, pick the
  rows whose `(Id, SystemModstamp)` match the selected versions, `COPY` into orglet.
- The CSV has no relationship columns and uses API names; orglet's import-mode coercion of Bulk 2.0
  CSV already covers the value formats.
- Blobs: `VersionData` for a CV = object store key from its `Checksum` + `FileExtension`; no copy needed.
- Schema still comes from the SFDX retrieve; fields in the CSV that the retrieve lacks are a
  diagnostic (`UNSUPPORTED:archive-column` or similar), never a silent drop.
