# Pitfalls Research: milestone v1.2 archive mode

**Domain:** adding a Heimdall-backup loader, read-only mode, a pluggable blob store, a record-browsing UI and a public fixture backup to an existing Salesforce emulator (orglet)
**Researched:** 2026-11-03
**Confidence:** MEDIUM-HIGH. Codebase-grounded claims (file paths cited) are HIGH, read directly in this session. Heimdall facts come from `.planning/research/HEIMDALL-FORMAT.md` (MEDIUM, source-read, not re-verified). Postgres/pglite/`pg` behaviour is from training knowledge and flagged LOW where it decides a design (marked **[spike]**: verify with a 1-hour experiment before the phase plan commits to it).

Phase names used below: **LOAD** (archive loader), **RO** (read-only mode, frozen values, erasure), **FILES** (ContentVersion/Document/Link + blob store), **UI** (record browsing), **FIX** (public fixture backup + CI).

---

## Critical Pitfalls

### P1: "FKs deferred" is not one mechanism; the loader inherits an all-or-nothing failure or silent dangling data

**What goes wrong:** orglet has two different FK regimes. Normal DML relies on `DEFERRABLE INITIALLY DEFERRED` constraints (`packages/schema/src/ddl.ts:98-99`), which are *checked at COMMIT*. Import mode instead sets `SET LOCAL session_replication_role = replica` (`packages/engine/src/engine.ts:324`), which turns FK triggers off completely and never checks them again. A loader that picks the first gets one dangling reference (deleted parent, unbacked object, a User outside the backup) aborting a multi-hour load at the final COMMIT with a single `violates foreign key constraint` message. A loader that picks the second silently stores rows whose FK would be violated; later `migrate()` then skips that FK with `UNSUPPORTED:schema-fk` (Phase 8 MIGR-02) or, if the FK exists, any later `UPDATE`/erasure touching the row fails at its commit.

**Why it happens:** the backup is a *sparse* graph. Heimdall backs up only configured objects; deleted parents live in `_deleted` CSVs (or were hard-purged from the recycle bin); `CreatedById`/`OwnerId`/`LastModifiedById` point at Users that were never backed up or are inactive; polymorphic `WhoId`/`WhatId`/`OwnerId` point to unmodelled objects; RecordTypeId rows (`RecordType`) are not in the backup unless configured. Also `session_replication_role` needs superuser (or `GRANT SET ON PARAMETER` in PG15+) so it fails on managed/rootless Postgres **[spike]**.

**How to avoid:** decide once, in the plan, a tri-state contract and test it:
1. Load with FKs *enforced-deferred* inside one transaction per object-batch is wrong; instead run a **pre-flight reference audit** after COPY (a `LEFT JOIN ... WHERE parent.id IS NULL` per FK column, one query per FK, same list `planSchema` already produces) *before* COMMIT, and classify every dangler: parent soft-deleted in backup (fine), parent object unbacked, parent missing.
2. Policy for danglers must be explicit and counted: set the column to NULL **only** for system lookups (`CreatedById`, `LastModifiedById`, `OwnerId`, `RecordTypeId`) to a synthetic archive-user or keep the value and drop the FK for that column with `UNSUPPORTED:archive-dangling-reference` (per-column count, never row-level names, per the stand-alone/Level-1 rule). Never silently null a business lookup. Decision recorded as a Key Decision.
3. Never rely on `session_replication_role` as the loader's *only* path; detect lack of privilege and fail with an actionable message.
4. Self-references and cycles need no ordering under INITIALLY DEFERRED, but verify the load really is a single transaction (the pool must hold one client for the whole COPY batch; `DmlEngine.transaction` is for DML, not COPY).

**Warning signs:** load dies at the last statement; `UNSUPPORTED:schema-fk` appearing on the *next* `orglet up`; `SELECT count(*)` of danglers differs between a pre-flight audit and `orglet check`.

**Phase to address:** LOAD (contract + audit); RO (what a dangling reference means for erasure).

---

### P2: Bulk 2.0 CSV semantics differ from REST JSON semantics; reusing `coerceValue` verbatim corrupts data

**What goes wrong:** `coerceValue` (`packages/engine/src/coerce.ts`) treats `""` as null for every type via `isBlank`, which is right for Bulk *ingest* but not for a **query-output** CSV, where an empty unquoted field is null for every type but a quoted `""` in a text column may be an empty string (Bulk 2.0 query output does not distinguish; assume null, but test). Real traps:
- **Datetime**: `2026-01-15T14:30:22.000+0000` is accepted by `DATETIME_RE` only because the offset group allows `[+-]\d{2}:?\d{2}`; `normalizeDatetime` then reformats via `Date.parse`, so a `+0100` offset silently changes the instant (correct) but a date-only or `T`-less value is rejected and the **whole row errors**. In a bulk loader a row-level `INVALID_TYPE` must become a counted diagnostic, not an abort and not a drop.
- **Boolean**: `coerceValue` accepts only `"true"|"false"`; `"True"`, `"1"`, or `""` (null on a non-nillable checkbox) will error or become null. Postgres `COPY` accepts `t/f/yes/1`, so a direct-COPY path and the coercing path disagree.
- **Numbers with scale**: `Number(raw)` goes through IEEE double. A Currency(18,2) value like `12345678901234.56` or a Number(18,0) Id-like value (`9007199254740993`) loses digits. For `COPY` pass the CSV text straight to a `numeric` column; never round-trip through JS `number`. This is a different and *safer* path than the coercer, which means two code paths for the same field type.
- **Multi-picklist**: stored as `a;b;c`; the CSV may quote it; with restricted picklist `coerceValue` rejects any value no longer active in the *current* retrieve. Archive data legitimately holds retired values, so restricted-picklist validation **must be off** in the loader (import mode already bypasses rules, but `coerceValue` still enforces `restricted` at `case "Picklist"`).
- **Text length**: `field.length` check in the default branch rejects a value longer than the *current* metadata length; fields get narrowed/changed over years. Should be a `varchar` overflow diagnostic, not a lost row (and `migrate` never narrows, so the column may be wider than metadata).
- **Ids**: Id columns arrive as 18 chars (HEIMDALL-FORMAT says validator accepts 15 or 18). `normalizeId` rejects an 18-char Id with a wrong checksum (case-insensitive compare). Archive Ids that came through a spreadsheet may have a lower-cased checksum or be 15-char; normalise through `normalizeId` and treat `undefined` as a diagnostic.
- **Time, Date**: Bulk emits `HH:mm:ss.SSSZ`; `TIME_RE` allows an optional `Z`, ok. Geolocation/Address components arrive as separate `__Latitude__s` columns that may not exist in the retrieve schema (see P4).

**Why it happens:** the shared parser/coercer was built for *ingest from clients*, with REST semantics ("a client sent a bad value, tell them"), not *bulk restore of historical data* ("take what was true then").

**How to avoid:** write a dedicated `archiveCoerce` (or a `lenient: true` mode of `coerceValue` that returns a value plus a diagnostic, never an error object) and share only the *format normalisers* (`normalizeDatetime`, `normalizeId`). Property-test round-trip: orglet's own Bulk 2.0 query writer output → archive loader → SOQL result equals the original, for every field type in `examples/acme` and `examples/enterprise` (this is also the fixture's acceptance test, see P22). Golden-file unit tests per type with the exact strings above, including `+0100`, `-0500`, `Z`, no-ms.

**Warning signs:** row counts in tables < rows in CSV; `check` or loader summary shows `invalid-value` diagnostics clustering on one field type; amounts ending in `.00000001`.

**Phase to address:** LOAD.

---

### P3: The in-repo CSV parser buffers the whole file and mishandles BOM, CR and quoting at archive scale

**What goes wrong:** `packages/api/src/bulk/csv.ts` `parseCsv(text: string)` takes the full text and builds `string[][]` (documented in PROJECT.md as "CSV and results buffered in full"). Heimdall CSVs are 50K-200K records each, with wide rows (hundreds of columns on Account/Contact/Case, long text up to 131 072 chars), many per day. Loading hundreds of such files through it exhausts the Node heap. Specific defects for archive input:
- **No BOM stripping**: a UTF-8 BOM would turn the first header `Id`... into `﻿Id`, and every `Id` lookup would miss silently. Bulk 2.0 query output has no BOM, but a fixture edited in Excel or a mirror copied through a Windows tool does.
- **`\r` handling**: a lone `\r` inside a *quoted* field is preserved (good), but outside quotes it ends a row; Salesforce long-text fields containing bare `\r` are quoted so fine, but a file whose job used `CRLF` would also contain `\r\n` in text fields, which is indistinguishable. Heimdall uses `lineEnding: LF`, so keep LF-strict *inside* the loader and assert it.
- **A quote only opens a quoted field at field start** (`c === '"' && field === ""`): correct RFC 4180, but a stray `"` mid-field is kept literally; Salesforce never emits those, tolerable.
- **Header validation absent**: duplicate header names, empty header, and ragged rows (row length ≠ header length) are not checked; with `COPY` a ragged row aborts the statement with an unhelpful line number.
- **Heimdall concatenates pages "with one header"** (HEIMDALL-FORMAT §2, `BulkQueryResultDownloader.java:286-308`); a truncated upload (killed run) can end mid-quote, which the parser accepts as end-of-file and returns a half-field.

**How to avoid:** add a **streaming** record iterator (async generator over `Readable`, incremental state machine, same quoting rules as `parseCsv`) in `packages/api/src/bulk/csv.ts` or a new `packages/archive/src/csv-stream.ts`; keep `parseCsv` untouched (conformance). Strip a BOM, validate header uniqueness and row width (fail the *file*, with file key and line number, not the load), detect EOF-inside-quotes as `truncated-csv`. Differential test: stream-parser output === `parseCsv` output on every Bulk query fixture in the repo (`bulk.test.ts` data) plus generated adversarial CSVs (quoted newlines, `""` escapes, 100-column, 1 MB fields).

**Warning signs:** Node `JavaScript heap out of memory` in the loader; first column "missing" in every row; a 1-in-a-million row with shifted columns.

**Phase to address:** LOAD.

---

### P4: Header ≠ schema: backup columns come from describe-at-backup-time, orglet's schema from the retrieve-now

**What goes wrong:** CSV columns are *every describe field at backup time* (HEIMDALL-FORMAT §2), including formula/roll-up fields and fields since deleted, plus components of compound fields. orglet's tables come from the retrieve (plus baseline). Cases:
1. CSV column not in retrieve (field deleted/managed package not retrieved/`UNSUPPORTED:field-type` skipped, e.g. `ExternalLookup`): silently dropping loses data; HEIMDALL-FORMAT proposes `UNSUPPORTED:archive-column`. Make it a **per-object, per-column count** (names allowed, they're schema not data, but this repo is a public project and the author's org names stay private: print them to the CLI, never persist into repo docs).
2. Retrieve field not in CSV (field added after the last backup, or one Heimdall excludes: `type=address`, `base64`, `Tier`): column stays NULL; **required** fields (`nillable=false`, NOT NULL in DDL?) must not make `COPY` fail. Check what `columnDdl` emits for required fields; if NOT NULL, the loader's INSERT into a required column with no data fails. Required-ness in DDL is a REST-validation concern in orglet today, so check `ddl.ts` before assuming.
3. Case: Salesforce API names are case-insensitive; CSV header `Foo__C` vs retrieve `Foo__c`. Table columns are lowercase (`columnName`), so match on `.toLowerCase()`, but two fields differing only by case (not allowed in SF) is not a concern.
4. Compound fields: `BillingAddress` excluded, components `BillingStreet` etc. included; orglet's `Address` type is virtual (`isVirtual`, `columns.ts:44`) with component columns; verify the component names match orglet's naming (`BillingStreet`...), and `Location__Latitude__s` naming for custom geolocation.
5. **Order**: never assume column order equals retrieve order; build `COPY table (col list)` from the header intersected with schema, per file, not per object (headers vary across periods when fields were added mid-year).
6. Field type changed since the backup (Text → Number, Picklist → Text, Lookup retargeted): per-row diagnostics, counted.

**How to avoid:** the loader plans per CSV file: `header → [matched | extraInCsv | missingInCsv | typeMismatch]`, prints one summary per object, and refuses (non-zero exit) on `--strict`. Tests: fixture with a CSV that has an extra column, a missing column, reordered columns, a different-case column; all four must load and each produce the right diagnostic, none may drop a row.

**Warning signs:** two files of the same object with different column counts; loader summary says `0 diagnostics` on a real backup (suspicious).

**Phase to address:** LOAD.

---

### P5: "Latest version per record" is nondeterministic when two captures share a SystemModstamp second; periods reset the checkpoint

**What goes wrong:** `objects` PK is `(org_id, period, id, version)` with `version = SystemModstamp` epoch **seconds** (HEIMDALL-FORMAT §2). Heimdall collapses same-second edits/runs into one version, but across *periods* (each month restarts with a full snapshot) the same Id appears with the same version in several periods, and the CSV rows may differ (e.g. a roll-up/formula recomputed without bumping SystemModstamp, or `IsDeleted` flipping, or a field-level edit that does not touch SystemModstamp: formula fields and roll-ups change when a *related* record changes without the parent's SystemModstamp moving). `ORDER BY version DESC LIMIT 1` per id then picks an arbitrary one of the ties.
- Also `IsDeleted`: a record that was deleted appears in `<Object>_deleted` CSVs with a version possibly *equal to or newer than* the last live row; or a live row appears in a later period after undelete.
- Archive periods are negative (`-2602`); `period` orderings: `ORDER BY period DESC` puts `-2602` *after* `2602`, and `2512 < 2601` is fine but is the only chronological accident of YYMM (year 2099 not a worry). Treat `period` as `(archive?, yymm)`, not an int to sort on.
- Same record in `objects` with **different Id casing/length** between runs (15 vs 18) would not collide on PK but are the same record (P6).

**How to avoid:** define a total order and document it: `(version DESC, is_deleted DESC?, period_is_archive ASC, period DESC, csv_id DESC)` with an explicit stated choice for tie-breaks (prefer the most recent period, then the highest `csv_id`, i.e. the latest-written CSV); `IsDeleted = true` wins a tie, because Salesforce does not undelete a purged row without bumping SystemModstamp. Compute selection in SQL with `DISTINCT ON (id) ... ORDER BY id, <order>`, not in JS. As-of date: compare in the **same unit** (epoch seconds; `asOf` is user-given date or timestamp → convert at day end UTC, document it). Log counts of ties resolved (`n ties`), so they're visible. Test: synthetic index with ties across periods, an archive period, a deleted row newer than live, 15-char duplicate.

**Warning signs:** two loads of the same backup give different checksum of a table (add a `--verify` that hashes the table: determinism test); counts of `is_deleted` differ between runs.

**Phase to address:** LOAD (selection query is the heart of it).

---

### P6: Id identity: 15 vs 18 chars, duplicates, and collisions with orglet's own generator and prefix table

**What goes wrong:**
- `objects.id` may hold 15 or 18 (validator accepts both, `BulkQueryResultDownloader.java:378`). Join between `objects` and CSV rows on string equality misses matches; the PK on orglet's tables is the text Id, so `001...A` and `001...AAA` become two rows. Normalise *both sides* with `normalizeId` (`packages/schema/src/ids.ts:33`) before join and COPY.
- **Prefix consistency**: orglet's `_orglet.key_prefixes` assigns custom-object prefixes (`a00..`) from provisional or from *existing records* (`planKeyPrefixes` pass 1). A backup's custom objects have real prefixes (`a0X`, `a1B`...). If the loader COPYs rows **before** `reconcileKeyPrefixes` runs, the next `up` reads them via `SELECT DISTINCT left(id,3)` and adopts them ("records" source), which is right; but if `up` already ran with provisional prefixes and persisted rows, the loader hits `KeyPrefixError` or, worse, writes Ids whose prefix maps to a *different* object. Archive load must pass the real prefix per object as a `--key-prefixes` mapping derived from the data (first 3 chars of any Id from the CSV) **before** `reconcileKeyPrefixes`, and refuse on contradiction. `prefixes.ts` already supports mapping + contradiction detection; reuse it, don't reimplement.
- Standard objects: baseline prefixes are "confirmed by two sources or null" (Phase 8 BASE2-05). Real data on a null-prefix object has a prefix orglet doesn't know; polymorphic matching ignores null-prefix targets (`matchTargetByPrefix`), so `WhatId` pointing at such a record resolves to a `null` parent plus `UNSUPPORTED:reference-target`. Expected, but test it, and let the loader report "prefix X seen on object Y whose baseline prefix is null" as information.
- Prefix collisions across `__mdt` (`m` pool): the data may contain no `__mdt` rows (they are in the retrieve), but `seedCustomMetadata` runs on every `up` and *deletes* removed records ("full sync per type"); verify it can't delete archive rows of an `__mdt` type (it shouldn't: Heimdall does not back up `__mdt` rows normally; if it does, skip them and warn).
- **Collisions with `generateId`**: generated Ids are `prefix + "00" + 7-char ts + 3 counter` (`ids.ts:90`). Historic Salesforce Ids use instance chars (`"0X"`, `"1Y"`, ...). A collision is astronomically unlikely, but the real risk is *monotonic ordering*: `ORDER BY Id`/`Id > :x` pagination (Bulk query uses Id order) assumes later = greater; archive Ids aren't monotonic relative to new ones. Matters only if a GDPR/new-row path inserts rows; in read-only mode nothing is generated except bootstrap (P12).
- **Duplicate Ids in one load** (same Id in two CSVs, selected twice due to P5 bug) → `COPY` fails on the PK mid-stream, rolling back everything. Select exactly one row per Id *before* streaming; keep a defensive `ON CONFLICT` strategy impossible with COPY → load into `UNLOGGED` staging then `INSERT ... SELECT DISTINCT ON`, which also fixes P1/P2 (see P7).

**How to avoid:** normalise Ids at the CSV boundary; derive prefixes before reconcile; a loader unit test per bullet; an `archive verify` command that re-reads the DB and asserts: every Id is 18 chars, valid checksum, prefix matches the object's `keyPrefix` (or the object is null-prefix), no duplicate.

**Phase to address:** LOAD.

---

### P7: Direct `COPY` into live tables skips everything orglet's invariants depend on

**What goes wrong:** Four things the DML pipeline guarantees that `COPY` doesn't:
1. **Column defaults and derived fields**: orglet stores audit fields, `isdeleted`, auto-number sequences (`ddl.ts` creates sequences: `AutoNumber`). Loaded AutoNumber values are real historical ones; the sequence must be advanced past the max loaded value (`setval`) or a later (GDPR/new) insert collides or restarts at 1. Same for any `Name` autonumber formats.
2. **Unique indexes** (`ddl.ts:56-62`): `externalId` unique, `lower()` for case-insensitive unique text. Historic data may violate them (a field made unique after rows existed does not enforce retroactively; Salesforce lets unique fields have blanks, and some orgs have duplicates in soft-deleted rows). One duplicate kills the COPY. Non-reference unique indexes are **not** partial on `isdeleted=false` (only reference types are), so a soft-deleted duplicate blocks the load.
3. **Roll-up and formula columns**: roll-up columns are *stored* (so COPY loads backup values directly: desired), formula fields are *virtual* (no column): see P9.
4. **Triggers on tables**: orglet has none (business rules are app-side), good, so `COPY` is safe there; note that `session_replication_role` therefore only affects FKs.

**How to avoid:** stage-then-merge. `COPY` into an `UNLOGGED`/`TEMP` staging table per object (all text columns), then one `INSERT INTO target SELECT cast(...) FROM stage` with typed casts and a diagnostic query for failed casts (`pg_input_is_valid` is PG16: available on the project's PG16, *but pglite 0.5.8 embeds PG 17? check*, **[spike]**). Staging gives P2 casting control, P5 dedup and P6 normalisation in SQL, at the cost of 2x writes. Alternatively COPY directly for typed columns when the preflight shows clean data. After load: `setval` every AutoNumber sequence from `max(...)`, `ANALYZE`, then create/rebuild unique indexes; on conflict downgrade the unique index to non-unique with `UNSUPPORTED:archive-unique-violated` (read-only archive does not need uniqueness; count it).

**Warning signs:** `duplicate key value violates unique constraint "ux_..."` after hours; new records get AutoNumber `A-0001` colliding.

**Phase to address:** LOAD.

---

### P8: Soft-deleted rows: queryAll, `emptyRecycleBin`, undelete and SystemModstamp-ordering assumptions

**What goes wrong:** `_deleted` CSVs carry `IsDeleted=true` with the full field values. orglet's tables use `isdeleted` for soft delete and SOQL adds an `isdeleted = false` filter by default (`soql/compile.ts`). Mistakes: (a) loading `_deleted` rows but with the live row of the same Id also present (P5), (b) a deleted *child* of a live parent counting in roll-ups: stored roll-up values are frozen, so ignoring is correct, but `recompute` in the **save pipeline** would exclude them (RO covers), (c) `deleted` REST resource (`/sobjects/X/deleted?start&end`) needs a deletion timestamp: orglet probably uses `SystemModstamp`/a column; verify what it reads, archived rows must give a plausible `deletedDate`, (d) **partial unique indexes** exist only for references; a deleted row and a live one with the same unique value are tolerated only for those.

**How to avoid:** the selection query (P5) yields exactly one row per Id and sets `isdeleted` from the winning row; include a test where the winner is the `_deleted` row and `SELECT` (live), `queryAll` (both) and `/deleted` behave as Salesforce documents (use the existing `soft-delete.test.ts` patterns).

**Phase to address:** LOAD; RO for `emptyRecycleBin`/undelete.

---

### P9: Frozen formula and roll-up fields: orglet's engine assumes formulas are virtual and recomputes everywhere

**What goes wrong:** `isVirtual(field)` (`packages/schema/src/columns.ts:44`) returns true for every formula; no column exists, values are computed per row after fetch (`engine.ts:292-304`, `applyFormulaFields`). SOQL's formula handling is `UNSUPPORTED:soql-formula` in WHERE/ORDER BY (`packages/soql/src/compile.ts:240,345,543`) and formulas through parents (999.12). The backup contains *Salesforce's computed formula values*; "frozen" requires a **second storage representation** and every consumer to know about it:
1. **Where to store**: adding real columns for formulas (frozen mode) changes `columnDdl`/`isVirtual`, hence the schema diff. The *next* `orglet up` without archive mode (or with a different mode flag) sees a column in `information_schema` that the plan doesn't expect → `UNSUPPORTED:schema-drop` warning on every run (data is preserved, but noisy and `check --strict` fails), or the reverse: archive mode on a database loaded without frozen columns. The mode must be a **persisted property of the org** (a row in `_orglet`, like `rollup_backfills`) that `planTable`/`isVirtual` consult, not a CLI flag read at startup; `isVirtual` takes `(field, mode)` or the plan carries `frozen: true` per field.
2. **Consumers of `isVirtual`/`formula`**: `coerceRecord` forbids writing formulas even in import mode (`field.formula === undefined` in `writable`, `coerce.ts` last function), so `orglet up --import` can never load a formula value: archive loader must bypass `coerceRecord` entirely (it should anyway, P2) and the engine must **skip `applyFormulaFields` in archive mode** or it overwrites the frozen value with a freshly computed one (`$User`, `NOW()`, `TODAY()`, `$Setup`, cross-object formulas whose parents are not loaded all give different answers: that is precisely the point of freezing).
3. **Describe**: field must stay `calculated: true`, and `updateable/createable: false`. If describe derives `calculated` from "has no column" or from `isVirtual`, flipping storage breaks it. Conformance `describe-check` must stay 32/32.
4. **SOQL**: with a stored column, WHERE/ORDER BY on a formula becomes *possible*; the compiler's `UNSUPPORTED:soql-formula` guard must be relaxed for frozen fields (a user will filter on them in the UI search) but still refused in non-archive orgs, otherwise parity with real Salesforce (which allows it) is arguably improved but tests asserting UNSUPPORTED would fail. Child subqueries/parent traversal of a frozen formula (`Account.FormulaField__c` from Contact) now trivially works with a column, which means 999.12 gets accidentally half-fixed in archive mode only: document, test.
5. **Roll-up dependency graph**: Phase 13 builds a formula→roll-up dependency graph and *removes* ineligible roll-ups with `UNSUPPORTED:rollup-formula|rollup-cycle|rollup-target` **at schema build** (`admitFormulaRollups` in `@orglet/formula`). In archive mode those removals drop the *column the backup has data for* (CSV column → `UNSUPPORTED:archive-column`, data lost though Salesforce had it). Archive mode must keep every roll-up and formula-roll-up as a stored, frozen, read-only column regardless of admission, bypassing admission (admission is about recomputability; frozen values never recompute).
6. **Backfill at `up`**: `backfillFormulaRollups` (`engine.ts:693`, `cli/main.ts:188`) and `migrate()`'s roll-up backfill ("added roll-up column backfilled once", `migrate.ts:222`) will **overwrite frozen roll-up values** with locally recomputed ones the first time a roll-up column is considered "new" or has no `_orglet.rollup_backfills` marker. Archive load must write the markers (or archive mode must skip both backfills) *and* a test: load → `up` → values identical.
7. **Validation rules / defaults referencing formula fields**: irrelevant in read-only mode (no DML runs rules), but the GDPR erasure path (P13) is DML: it must not run validation rules (they might block erasing a field), and must not recompute formulas/roll-ups of parent records (a delete of a child normally recomputes its parent's roll-ups: in frozen mode the parent total must stay at the original value, or it would leak/contradict the archive).
8. **Stale-by-design values** (`$User`, `NOW()`, `TODAY()`, age-in-days): frozen, not "fixed"; document in the UI ("as of backup") and never present them as live.
9. **Mixed**: a formula referencing a field that is not in the backup (new field) → frozen value is whatever the CSV had; the formula **definition** in metadata may now compile to something else; show the frozen value, not the recomputed.

**How to avoid:** introduce an explicit `FieldStorage = "virtual" | "stored" | "frozen"` decision in one place (`columns.ts`), persisted org mode, consumed by ddl/migrate/engine/soql/describe; write one contract test per consumer (list above) on a 3-object fixture, plus the "load → up → up" idempotence test (silent second `up`, same discipline as Phase 8/13).

**Warning signs:** `schema-drop` warnings on the second `up`; a formula value in the UI changing between page loads (live evaluation leaking in); `describe` `calculated:false` on a frozen field.

**Phase to address:** RO (design must be decided before LOAD writes any table; flag as a **cross-phase dependency: LOAD cannot be planned before the storage decision**).

---

### P10: Read-only enforcement by "refuse in the engine" leaves side doors

**What goes wrong:** orglet has a single write choke point, `DmlEngine` (`packages/engine/src/engine.ts`), but DML is also reachable via paths that bypass it or that call the pool directly. A flag check in only `sobjects.ts` leaves holes. Audit list (all must be tested):
- REST: `POST/PATCH/DELETE /sobjects/:type[/:id]`, **upsert by external Id** `PATCH /sobjects/:type/:field/:value` (`routes/sobjects.ts:161`) and `DELETE .../:field/:value` (`:179`) — separate handlers.
- Composite: `/composite`, `/composite/batch`, `/composite/tree/:type`, `/composite/sobjects` (POST/PATCH/DELETE and the upsert variant `:field`); `/composite` subrequests call back into sobject handlers or the engine directly, a read-only check must be in the engine or every inner path.
- Bulk 2.0 **ingest**: `POST /jobs/ingest`, `PUT .../batches`, `PATCH .../ingest/:id` (UploadComplete triggers processing in-request), delete jobs; **job creation itself writes `_orglet.bulk_*` rows** (jobs are persisted, Phase 6). A "read-only org" still needs those tables writable for *query* jobs (Bulk query is a read). Decide: ingest refused at job creation (not at processing, otherwise a job is created then fails per-row: observable difference), query allowed.
- SOAP: `/services/Soap/:api/:version` (login) and any SOAP data calls; `login.ts` writes nothing? verify; session creation is in-memory.
- Engine ops beyond create/update/delete: `undelete`, `upsert`, `emptyRecycleBin` (is it implemented? if present it is a **hard delete** path), merge, `convertLead`? (check), `composite/tree`.
- **Custom settings and `__mdt`**: `seedCustomMetadata` runs on every `up` ("full sync per type, `--import` included", `main.ts:175`) and *deletes/rewrites rows*. If the archive contains `__mdt` rows (it shouldn't) or the retrieve changed, `up` mutates a read-only database. Likewise `customSetting` rows are normal DML targets and in a real backup they may be present.
- **Bootstrap writes** (`packages/engine/src/bootstrap.ts`): `bootstrapOrg` runs on every `up` (`main.ts:174`): it inserts a User `admin@orglet.local`, a Profile, an Organization row, a default BusinessHours, a UserLicense, and **a RecordType row per metadata record type** — *into the archive database*, with generated Ids (prefixes `005`, `00e`, `00D`, `012`...), next to loaded Users/Profiles/RecordTypes. Consequences: duplicate Organization row (the archive's `00D` plus orglet's); `RecordType` rows keyed `Object.DeveloperName` already present from the backup are reused (`existingTypes` map) — good — but the backup's RecordType rows exist only if Heimdall backed up `RecordType` (not default) so orglet *invents new* RecordType Ids that differ from the `RecordTypeId` values stored in records → record type shown wrong/none (P11). The admin user is also needed for the session and `CreatedById`, so it can't just be skipped. Plan: bootstrap in archive mode inserts only the *session* user into a clearly separate marker (or a `read-only` session that has no User row at all and `$User` resolved from a synthetic object), must never touch `UserLicense`/`BusinessHours`/`RecordType` rows, and tests assert **zero row-count delta on every table** across a repeated `up` after a load (`SELECT count(*)` before/after, all tables, except `_orglet.*` allow-list).
- **Roll-up backfill** (P9 item 6) and `migrate()` DDL additive changes (adding a column while archive mode is on is a schema write; allowed but must be an explicit user action).
- **`orglet reset`** drops data: in archive mode require `--force` + the org name typed, because the archive is the only copy *in orglet* (the real source is the backup store, so recoverable, but the load takes hours).
- The `Store` class is used directly by `bootstrap`, `seed` and `rollups` (not through `DmlEngine.refuse`); a guard only in `DmlEngine.refuse` doesn't cover them. `refuse` itself has an `importMode` escape (`engine.ts:150`) — **import mode and read-only mode must be mutually exclusive** (`up --import --read-only` = error), otherwise import bypasses the refusal.

**Which status code:** Salesforce has no "org is read-only" code for data API; closest real codes: `INSUFFICIENT_ACCESS_OR_READONLY` (HTTP 403, documented REST error for read-only users/org state) for REST, `INVALID_TYPE_FOR_OPERATION` is already used for object-flag refusal (custom convention). Pick **one** (`INSUFFICIENT_ACCESS_OR_READONLY`, since it is a documented status code and the project rule is "do not invent StatusCodes") and give the same code/shape in REST (JSON array, `errorCode`), composite subrequest bodies (per-subrequest 403 not whole-request), Bulk results (`sf__Error`), and SOAP faults. Include the `UNSUPPORTED:` rule: read-only mode is not "unsupported", it is a deliberate state, so no `UNSUPPORTED:` prefix (precedent: Bulk query restrictions, Key Decisions).

**How to avoid:** implement the guard as **one** `assertWritable(operation, obj)` called at the top of `DmlEngine.run` (the `run` wrapper is the single entry for all DML, `engine.ts:309`) **and** in `Store` write methods as a defensive second layer (constructed with `readOnly`), plus a Fastify `onRequest` hook for Bulk ingest job creation. Then a **table-driven test** that enumerates *every registered route with a non-GET/HEAD method* (Fastify `app.printRoutes` / `onRoute` hook) and asserts either "refused with the read-only code" or "in an explicit allow-list" (token endpoint, Bulk query jobs, composite batch with only GET subrequests, erasure endpoint). A route added later without classification fails the test: this is the only durable defence.

**Warning signs:** row counts change across `up`; `LastModifiedDate` drifts; a second `Organization` row; a Bulk ingest job in `_orglet.bulk_jobs` for an archive org.

**Phase to address:** RO.

---

### P11: RecordTypeId, OwnerId, CreatedById point outside the backup

**What goes wrong:** (1) `bootstrapOrg` seeds `RecordType` rows with *new* Ids (above) so `RecordTypeId` on loaded records (real `012...`) dangles; describe/UI show no record type name; picklists dependent on record type break. (2) `OwnerId` → User or Group(Queue). Users are backed up only if configured; inactive users included? (`User` is queryable with inactive). If absent, every record's `Owner.Name` is null in SOQL/UI and FK fails (P1). (3) Polymorphic `OwnerId` `ownerTargets` (Phase 9): a prefix for an object orglet doesn't model → null parent plus one warning per query: with 200k rows that's expected; ensure the warning is **per query, not per row** (already: "warning logged once per query") but UI-driven queries on every page would repeat; dedupe in `ctx.unsupported` (set; ok).

**How to avoid:** archive loader contract: "if `RecordType`/`User`/`Group`/`Profile` objects are not in the backup, the loader synthesises *stub rows* for every distinct referenced Id (Name `Unknown <prefix> <last 4 chars>`, `isdeleted=false`, flagged via a column or `_orglet.archive_stubs` table so they can be listed and are never mistaken for data)", counted in the summary. Stub RecordType rows need `SobjectType` and `DeveloperName`: not derivable from an Id; derive `SobjectType` from the referring object and give `DeveloperName = "Archived_<Id>"`. This preserves referential integrity and honesty (labelled, counted, reversible) and is preferable to nulling (changes data) or dropping FKs (loses Owner traversal). Bootstrap in archive mode then uses the loaded RecordType rows and creates none (P10).

**Phase to address:** LOAD (stubs), RO (bootstrap).

---

## Moderate Pitfalls

### P12: Polymorphic and unmodelled references (WhoId, WhatId, ParentId on feeds, attachments)

Task/Event/ContentDocumentLink `LinkedEntityId`, `FeedItem.ParentId`, `Note.ParentId`: targets may be objects orglet does not model. Schema stores polymorphic fields as plain text Ids with FK only for modelled targets? Check `foreignKeys` in `planTable`: for polymorphic lookups there is probably **no FK** (cannot FK to many tables) — verify in `ddl.ts`; if so P1 doesn't apply to them but SOQL joins use prefix filters (`matchTargetByPrefix`), so unmodelled prefixes yield a null parent plus `UNSUPPORTED:reference-target`. Test with a fixture where `WhatId` points at an unmodelled prefix and one with a deleted parent. The UI must render the raw Id as plain text (not a link) when the prefix resolves to no object.
**Phase:** LOAD (test), UI (render).

### P13: GDPR erasure path leaves data behind, or breaks read-only invariants

**What goes wrong:** erasing a person means, in this model: the record row (hard delete? soft delete is **not erasure**; `isdeleted=true` rows still hold PII and appear in `queryAll`), all **versions** (orglet loads only the latest version, but the *Heimdall index/CSVs/blobs* hold every historic version: erasure in orglet's DB does not erase the source; a reload resurrects the data), `ContentVersion` rows and **blobs in the object store** (checksum-addressed and *deduplicated*: one blob is shared by many ContentVersions; deleting the blob when only one referrer is erased destroys others, not deleting leaves PII), `ContentDocumentLink`/`FeedItem`/`Task` text containing the person's name, **denormalised copies** (frozen formulas like `Contact.Name__c` on children, `Name` pseudo-field on Contact stored? `objects.name`), `_orglet.bulk_*` job rows (CSV uploads/results *include record content*; jobs live 7 days), the Bulk query job results (contain query results = PII copies) and `locators`, and Postgres WAL/dead tuples (needs `VACUUM`; mention, not solved).
**How to avoid:** specify the erasure contract in one sentence in the requirements ("erasure removes the record and everything orglet itself stored that derives from it; the backup store is out of scope and a **tombstone list** is consulted by `archive load` so a re-load does not resurrect"): persist `_orglet.erasure_tombstones(org_schema, id, object, erased_at)` (Ids only, no PII), consulted by the loader selection (P5) and by `archive verify`. Hard-delete (not soft) the row; cascade by the FK delete constraints already modelled (cascade/restrict/set-null) but **in frozen mode do not recompute parent roll-ups/formula** (P9.7) and *do* null `Name`-like denormalised fields of children? (policy decision; document, don't improvise). For files: reference-count by checksum within orglet; if count reaches 0 the blob is *listed* for operator deletion (`archive gdpr --print-blobs`), never auto-deleted from the shared store (orglet does not own it; read-only access to S3 is the safe default, and the key insight: the store credential in orglet should be **read-only**). Purge `_orglet.bulk_*` rows that mention the Id (or all jobs, simpler). Tests: after erasure, `grep`-style query across every table in the org schema and `_orglet` for the Id and for a unique marker string in the PII fields returns zero rows (scan `information_schema.columns` for text columns: the test is generic, so it survives schema growth).
**Warning signs:** the erased name found in `FeedItem.Body`, `ContentVersion.Title`, `_orglet.bulk_ingest_rows`.
**Phase:** RO (path), FILES (blob refcount), LOAD (tombstone consult).

### P14: Erasure endpoint design: auth, mode, and the "except erasure" allow-list becoming a general write path

An explicit erasure endpoint (CLI-only vs REST) with a permissive default auth (CONCERNS: any password works, tokens never expire) means anyone who can reach the port can erase. **Prefer CLI-only (`orglet archive erase <Id>…`)** that connects to the database directly, not an HTTP route; no new attack surface, no REST contract to invent, and easier to audit-log. If REST is required, bind to an admin credential distinct from the (permissive) users and print a startup warning when archive mode runs with `auth.mode = permissive` and a non-loopback bind.
**Phase:** RO.

### P15: Blob storage in `bytea`: memory, size, and base64 bloat (normal-org mode)

`pg` returns `bytea` as a full `Buffer`; a 100 MB file doubles in memory (hex text on the wire for text protocol: `bytea` in text format is hex-encoded = 2x on the wire; plus Fastify reply buffering). Postgres caps a single field at 1 GB; `max_allowed_packet` doesn't exist but pg-protocol messages are buffered. Salesforce `VersionData` upload via REST JSON is **base64 in the body** (+33%) with a ~37.5 MB practical limit and multipart/form-data up to 2 GB; Fastify's default `bodyLimit` is 1 MiB, so uploads fail with 413 unless raised for exactly those routes, and raising it globally weakens the server.
**How to avoid:** BlobStore interface with `put(stream, meta) → ref`, `get(ref) → Readable`, `stat`, `delete`; never `Buffer`-typed in the interface. For `bytea` mode store in chunks (Large Objects `lo_*` or fixed 1-4 MB rows in a `_orglet.blob_chunks(blob_id, seq, data)` table) so reads stream with a cursor; a single `bytea` for files ≤ configurable threshold is acceptable if documented. Per-route `bodyLimit` for the file routes; reject beyond configured max with the Salesforce error (`STORAGE_LIMIT_EXCEEDED`? use documented code `FILE_SIZE_LIMIT_EXCEEDED` only if documented; check before use). Test with a 50 MB generated file and a heap-usage assertion (`process.memoryUsage().heapUsed` delta < size/2).
**Phase:** FILES.

### P16: Streaming vs buffering on download and the Content-* contract

`GET /sobjects/ContentVersion/:id/VersionData` must stream (`reply.send(readable)`), set `Content-Length` (from `ContentSize`/`stat`), `Content-Type` (from `FileExtension`/Heimdall guessed type; not user-controlled HTML), `Content-Disposition: attachment` (or `inline` only for safe types: **serving user-uploaded `text/html` or `image/svg+xml` inline from the same origin as the API and UI is stored XSS**; force `attachment` + `X-Content-Type-Options: nosniff` for everything except a short allow-list of raster images and pdf), support `Range` (jsforce/simple-salesforce don't need; browsers do for PDF/video; implement or document `Accept-Ranges: none`). Fastify error after headers sent (S3 mid-stream failure) cannot become a JSON error: log and destroy the socket so the client sees a truncated transfer rather than a corrupted-but-200 file.
**Phase:** FILES.

### P17: Checksum semantics: Salesforce `Checksum` is MD5 of the file; orglet must not trust or recompute blindly

- Heimdall dedups by `Checksum` + `FileExtension` and builds the key from them; `Checksum` is **MD5 hex** (32 chars). The key prefix is `checksum[0:4]`: case: S3 keys are case-sensitive; Salesforce returns lowercase hex; a CSV edited by hand may be uppercase. Lowercase before key building. A CV with an empty `Checksum` (external `ContentLocation = E/L`, or Salesforce `S` with zero-size) yields key `files//.ext` or `files/null/null.ext`: guard: missing checksum → no blob, `VersionData` returns 404 `NOT_FOUND` with a clear message, not a crash.
- **MD5 collisions / verification**: verify integrity on download in `archive verify --files` by streaming MD5 (cheap), not on every request. A mismatch must be reported as a diagnostic, not "fixed".
- The Salesforce MD5 is of the *original* bytes; if a mirror tool altered line endings or gzip'd, it differs.
- `ContentVersion` created **in orglet** (normal mode, FILES): orglet computes the MD5 itself and stores it in `Checksum` (stored, writable only by the system) — compute while streaming the upload, one pass.
- **Missing blobs**: `HEIMDALL_SKIP_FILES_BELOW_KB` skipped small files; deleted CVs were skipped; failed downloads. So "CV row exists, blob does not" is the normal case: `HEAD` per CV at load time is too slow for 1M CVs; do it lazily (on download) and via an optional `archive verify --files` sampling/complete scan. Describe's `ContentSize` stays; the download returns `404` with `errorCode: NOT_FOUND`. In the UI show "file not in backup" rather than a broken link.
- `FileExtension` casing: key uses the extension *as stored*; Heimdall wrote it as Salesforce returned (usually lowercase, but `PDF` possible). Try the exact value, then lowercase, then (if cheap) a prefix listing; do not guess more.
- **Path traversal**: for the **local-mirror backend** the key is built from CSV values (`Checksum`, `FileExtension`, and `s3path` from the index!). `FileExtension` `../../etc/passwd`, an absolute path, NUL bytes, or `s3path` with `..` segments escape the mirror root. Rules: validate `Checksum` against `/^[0-9a-f]{32}$/` (reject, don't sanitise), `FileExtension` against `/^[A-Za-z0-9]{0,16}$/`, and for `s3path` resolve with `path.resolve(root, key)` then assert `startsWith(root + path.sep)`; deny symlinks that escape (`fs.realpath`) — a unit test with traversal vectors (`..%2f`, `....//`, backslashes on Windows, absolute, NUL) per backend. For S3: keys are opaque so no traversal, but a `s3://` prefix strip (HEIMDALL-FORMAT §3) must not allow a different bucket than configured.
**Phase:** FILES (+ LOAD for `s3path`).

### P18: ContentDocument/ContentVersion/ContentDocumentLink done "properly" has hidden coupling

- **Auto-create ContentDocument on CV insert**: the CV insert without `ContentDocumentId` creates a Document (new `069` Id) and sets `LatestPublishedVersionId` and `ContentDocumentId` on the CV, plus (if `FirstPublishLocationId`) a `ContentDocumentLink` with `ShareType='V'`, `Visibility`. Subsequent CV with `ContentDocumentId` set = new version: sets `IsLatest` false on the previous one, `VersionNumber` increments (text "1","2"), `LatestPublishedVersionId` on the document moves. Order within a transaction, and rollback if the blob write fails (blob write is *outside* the DB transaction: write blob first, then DML, and orphan-sweep on failure; or the reverse with a pending marker; pick one and test the crash window, same discipline as Bulk `unprocessedrecords`).
- **Circular FK**: CV → ContentDocument (`ContentDocumentId`) and ContentDocument → CV (`LatestPublishedVersionId`): the existing deferred FKs handle it, but in the archive the `ContentDocument` CSV is a separate object: if not backed up (Heimdall only dedicates blob-download to CV; whether `ContentDocument` and `ContentDocumentLink` are configured is the user's choice) the CV's `ContentDocumentId` dangles: **v1.1 stopgap makes it nullable** (CONCERNS: "ContentDocumentId is nullable as an override, should be required"). Dropping the override while archive data lacks documents breaks the loader (NOT NULL). Archive mode must either synthesise stub ContentDocuments (P11 mechanism) or keep the override on for archive orgs; the plan must say which. `ContentDocumentLink` has no `Id` semantic key: Id is the composite-ish `06A`; `LinkedEntityId` is polymorphic with a *large* set of targets (every object with sharing); modelled as plain text without FK (P12).
- **ContentDocumentLink is not DML-able for all combos** (`ShareType` rules, Document owner link cannot be deleted); scope to insert/delete of the common cases and `UNSUPPORTED:content-link-*` for the rest.
- **Describe changes**: removing the nullable override flips `ContentVersion.ContentDocumentId` to `nillable:false`? In Salesforce it's nillable on insert (system-populated), so the right shape is "not required in input, always populated in storage": check what describe says; `conformance/describe-check` may assert.
- **VersionData as a field**: baseline omits blob fields (Phase 10); adding `VersionData` (type `base64`) to describe/`FIELDS()`/SOQL: `SELECT VersionData` returns a **URL** (`/services/data/vXX/sobjects/ContentVersion/<id>/VersionData`) in REST query results, not the content, and Bulk query rejects blob fields. Don't store the blob in the record table column; keep metadata and bytes separate. Check `Attachment.Body`, `Document.Body`: out of scope (Heimdall has none), keep `UNSUPPORTED:blob-field` for them.
- `ContentSize` vs `ContentSizeLong`, `PathOnClient`, `Title` extension rules, `IsLatest`, `MalwareScanStatus`: system-set fields; set deterministically (fixtures, P21).
**Phase:** FILES; LOAD for the stub decision.

### P19: pglite vs Postgres divergence for the loader, and no AWS in CI

- **COPY over pglite-socket** **[spike]**: pglite supports `COPY ... FROM '/dev/blob'` through its JS API (`query(..., {blob})`), but the project's tests reach pglite through `pg` over `pglite-socket` (`test/db.ts`). `COPY FROM STDIN` over the extended/copy sub-protocol (`CopyInResponse`, `CopyData`) through pglite-socket, plus the project's custom filter that rewrites message ordering (`installExtendedProtocolErrorFilter` discards messages after an `E` until `S`), is untested territory; `pg-copy-streams` (MIT, the usual helper) is not in the dependency list. If COPY doesn't work on pglite, the loader needs a **second code path** (multi-row `INSERT ... VALUES` / `unnest($1::text[], ...)`) that CI exercises, plus a `test-postgres`-only COPY test: so the COPY path is verified only on the Postgres job. Decide up front whether the `unnest` bulk-insert path is *the* path (portable, ~3-10x slower than COPY, fine for fixtures; real archive loads of millions of rows want COPY). Recommended: abstract `BulkWriter` with two implementations, `CopyWriter` (Postgres) and `UnnestWriter` (fallback/pglite), identical contract tests run against both on `test-postgres`, and the fixture path on pglite uses only the fallback.
- **Deferred constraints / large transactions**: pglite is single-connection-queue, in-memory WASM; a very large single transaction is memory-bound, CI fixtures are small so fine; document the maximum.
- **bytea**: hex output on both; pglite's `bytea` through `pg` returns Buffer like Postgres, but `lo_*` large-object functions on pglite are less certain **[spike]**: another reason for the chunk-table design (P15).
- **`session_replication_role`** works on pglite 0.5.8 (verified, PROJECT.md); `pg_input_is_valid` needs PG16+; pglite embeds PG17 in current releases (training knowledge, **[spike]**).
- **pglite premature ReadyForQuery bug (#958)**: a loader that deliberately triggers per-row constraint failures (diagnostics) will hit it: use `SAVEPOINT` per batch or validate in SQL before inserting; the test filter helps only after an `E` message in extended protocol; COPY errors use a different message path (`CopyFail`/`ErrorResponse` in simple protocol, which the filter passes untouched, "Simple Query ... pass through untouched"): untested, add a test.
- **No AWS in CI**: use a **filesystem mirror backend as the default in tests** (the fixture's `examples/.../` tree) behind the same `ObjectStore` interface (`get(key)`, `list(prefix)`, `head(key)`) and S3 backend tested with a **fake S3 server** only if a dependency is justified (MinIO via docker in the `test-postgres` job is heavier; an in-process stub of `GetObject/HeadObject/ListObjectsV2` with `aws-sdk-client-mock` (Apache-2.0) avoids network). `@aws-sdk/client-s3` is Apache-2.0 (OSI OK) but heavy (large transitive tree, ~10+ MB); consider the lazy `import()` so users of normal mode don't load it, and it must not be an unconditional dependency of `@orglet/api`. Credentials come from the standard AWS provider chain only; **never read or log** keys; `--endpoint-url`/`forcePathStyle` flags for S3-compatible.
- Heimdall's **index Postgres** is read by orglet: connect read-only (`default_transaction_read_only=on` / a role with `SELECT`), separate connection string from orglet's own DB (`HEIMDALL_DATABASE_URL`), and a fixture for it: a `.sql` dump of the three tables (`csvfiles`, `objects`) restored into the *test* DB (pglite) in a throwaway schema, or a JSON index file when no Postgres is used. Don't require Heimdall's schema DDL file from its repo in CI.
**Phase:** LOAD (writer abstraction), FIX (CI), FILES (store interface).

### P20: Memory and time at archive scale

Loader on 10M rows: per-row JS objects are the cost; stream, batch (e.g., 5k rows per `unnest` insert), backpressure with `pipeline`, a **checkpoint per CSV file** (`_orglet.archive_loads(org_schema, csv_s3path, rows, finished_at)`) so a killed load resumes instead of restarting, and idempotent re-run (second `archive load` of the same backup is a no-op with identical table hashes). Progress output via `--quiet`-respecting `log`. Indexes: create FK/unique/secondary indexes **after** the data (drop and recreate, or load before `migrate` index step); `ANALYZE` at the end; `maintenance_work_mem` hint in docs. Single-transaction (P1) vs resumability (this) conflict: resolve by making the transaction per object-file with FKs deferred *per transaction* is wrong (cross-file refs): choose "FK checks off during load + audit before enabling" (P1 option) — record this as the headline architectural decision of LOAD.
**Phase:** LOAD.

---

## UI Pitfalls

### P21: Record browsing UI (vanilla JS in `packages/api/ui/index.html`)

- **XSS**: today's page builds DOM with `h()` + `document.createTextNode` (`index.html:54-60`), which is safe by construction; keep that rule: **never** `innerHTML`/template-literal HTML for record values, picklist labels, error messages or filenames (grep-gate in CI: forbid `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` in `ui/`). Real exposure points: (1) `Url`/`Email`/`Phone` fields rendered as `<a href>`: allow only `http:`, `https:`, `mailto:`, `tel:` (a stored `javascript:` URL is exploitable); add `rel="noopener noreferrer"`. (2) Rich text / HTML-formatted long-text (`Description`, `Body`, FeedItem HTML, Email bodies, `<img onerror>`): render as **text**, never as HTML (label "HTML source"); if rendering rich text is ever wanted, sandboxed iframe with CSP, not in this milestone. (3) `SVG`/`HTML` file previews (P16). (4) Add a CSP header on `/`: `default-src 'self'; script-src 'self' 'unsafe-inline'` (inline script is how the page is built; hash it) — `frame-ancestors 'none'`, `base-uri 'none'`.
- **Token exposure**: the page stores the bearer token in `sessionStorage` (`index.html:64,82`) and sends it as `Authorization` header: fine, but file download via `<a href=".../VersionData">` cannot carry the header, tempting a `?access_token=` query param or cookie. **Don't**: query tokens leak into logs/Referer/history. Fetch with the header, `blob()`, `URL.createObjectURL` (memory-bound for big files; acceptable at the UI scale, or a short-lived single-use download ticket route). Also never print the token in an error message; `api()` error path prints server messages (text only, fine).
- **N+1 describe**: each record view needs describe for the object *and* for each lookup target (to find `Name` field and label); caching per session in a `Map` keyed by object; global describe once; use the *composite* describe (`/sobjects` global) sparingly. For related lists: `describe.childRelationships` of the parent gives child object + field; one SOQL per related list, `LIMIT 25` + "show all" with `nextRecordsUrl`.
- **Related lists on thousands of children**: `SELECT ... FROM Child WHERE ParentId = :id ORDER BY ... LIMIT 25 OFFSET?` — offset on a frozen archive is okay, but **COUNT(*)** per related list per page view on a 10M-row child table is slow without an index: orglet indexes reference columns (`ix_..._col` for lookups, `ddl.ts:61`: `reference || externalId` → yes), so `WHERE parent = x` is indexed, but `ORDER BY CreatedDate DESC` is not: a parent with 100k children sorts 100k rows. Use `ORDER BY Id` (indexed PK) or cap with `LIMIT`; do not render counts as exact beyond 1000 (`1000+`). Related lists load **lazily on expand**, not all at once; polymorphic children (`Task.WhatId`) need `TYPEOF`/prefix filters — skip in v1.2, show only lookups with a single target.
- **Search**: "search over name and email fields" with SOQL `LIKE '%x%'` is a sequential scan (leading wildcard cannot use a btree) and SOQL `LIKE` is case-insensitive in Salesforce: orglet's translation must use `ILIKE`/`lower()`; on millions of rows add `pg_trgm` (extension available in Postgres; **pglite ships `pg_trgm`? [spike]**; contrib license is PostgreSQL license, OSI) or restrict to prefix search (`LIKE 'x%'` plus a `lower()` btree index) and say so in the UI. `%` and `_` in the user's term must be escaped (`\%`, `\_`) and quotes escaped in SOQL string literals — **SOQL injection** from the search box (`'` closes the literal): build via a single `soqlString()` escaper reused from the soql package, with a test on `O'Brien` and `%`.
- **Wide rows**: Account with 300+ fields: render by page layout groups? orglet has no layouts; show non-null fields first, collapse empties, truncate long text with expand; a 131k-char field in a table cell freezes the DOM.
- **Clickable lookups**: resolve by Id prefix → object via global describe (`keyPrefix`), same rule as the server; unknown prefix → plain text. Deleted parents (IsDeleted) → still navigable via `queryAll` (the record view must use `queryAll`/`/queryAll` for archive, or the deleted-row links 404), mark with a "deleted" badge.
- **"Frozen" honesty**: show an "archive, as of <date>, read-only" banner; hide edit affordances (the current UI has none beyond SOQL console; its SOQL console is read-only by nature).
- **No framework / no build step** is a project convention; resist adding one (licence, and conformance of "page is a single file"). If the file exceeds ~600 lines split into a few `ui/*.js` served statically; keep the Fastify static route minimal and path-traversal-safe (`@fastify/static` is MIT, or hand-serve a fixed allow-list — prefer the allow-list).
**Phase:** UI.

---

## Process Pitfalls (project-specific)

### P22: Level 1 data rule: the author's real backup must never enter the repo, tests or Claude context

**What goes wrong:** the natural way to validate the loader is to run it on the real backup, then paste the failure, a CSV row, a diagnostic with field values, or an Id list into an issue, a test fixture, a commit message, or the chat. Per global policy a real-org backup is at minimum Level 2-3 and likely contains personal data (Level 4); per project convention real-org findings go into the repo and backlog only as generic Salesforce areas and counts, never as names of organisations, records or people.
**How to avoid (enforceable):**
1. All loader/diagnostic output designed **redacted by default**: counts, object *kinds* (standard names OK, custom API names can be client-identifying → print only in an opt-in `--verbose-local`), no field values, no Ids, no file names; `--summary`-style output like `orglet check --summary` (Phase 14 precedent).
2. Error messages from the CSV parser must **never echo the offending cell or row**: use `file key, line number, column index, reason code` only. (Today `Errors.invalidType(field.label, field.name, raw)` echoes the raw value into the message: fine for REST clients, **a leak vector for a bulk loader** whose output goes to a terminal that is then pasted into a chat.) The archive path must use value-free diagnostics.
3. `.gitignore` additions (`/archive-local/`, `*.heimdall.env`, `.env*` already) and a **repo guard test/CI step**: scan tracked files for the S3 key shape `OrgId=00D` followed by non-fixture org Ids, for 15/18-char Ids with prefixes outside the fixture's, and for email-like strings outside an allow-list (`@example.com`, `@orglet.local`); the fixture generator uses a reserved synthetic OrgId (e.g. `00D000000000FIX`) that the guard allows. (Cheap `git grep` test in `scripts/` run in CI; fail with the rule, not the match.)
4. Process: runs against the real backup happen in a shell the author runs; output redirected to a local file never opened by Claude; only the redacted summary is shared. Add this to the phase's CONTEXT as a standing rule. Subagent/Claude tools must never read the mirror directory or the index DB; configure the real-backup path only via env vars outside the repo.
5. Hard-stops stay: credentials (AWS keys) never in files read by tools; use the provider chain.
**Phase:** all, enforced first in LOAD (output design) and FIX (guard).

### P23: Fixture generation leaks non-determinism, or is circular

- **Non-determinism**: the fixture is generated through orglet's own Bulk 2.0 query output (PROJECT.md). `generateId` uses `Date.now()` and a random-seeded counter (`ids.ts:78`), so two generations produce different Ids, `CreatedDate`/`SystemModstamp` are "now", AutoNumbers are sequence-based, `bootstrapOrg` mints User/Org/RecordType Ids at random. Committed fixture would churn on every regeneration and the CI drift check (`baseline-gen-check` style) would fail forever. **Need**: a deterministic mode: seeded ID generator (`ORGLET_ID_SEED` or an injectable `IdGenerator` in `EngineOptions`, noting `generateId` is a module-level function with module-level state: needs a seam, a **surgical** change), a frozen clock (injectable `now`), deterministic ordering (`ORDER BY Id`), and a fixture builder script that **does not call the live API with randomness at all**: derive from `examples/acme` data files with `deriveCustomMetadataId`-style hash-based Ids (the project already has the precedent, `ids.ts:108`, Phase 11 D-01). Add a CI job `fixture-gen-check` (regenerate, `git diff --exit-code`), mirroring `baseline-gen-check`.
- **Circularity**: if the fixture is made by the same CSV writer/coercer the loader reads with, a symmetric bug (e.g., wrong datetime format both ways) passes. Add a **hand-written** adversarial CSV set (committed, tiny) with Bulk 2.0 quirks from P2/P3 written *independently of the writer*: `+0000` datetimes, quoted newlines, empty vs null, BOM, ragged header, 15-char Id, multi-picklist, a `_deleted` file, a tie in version, a dangling OwnerId, a missing blob, a traversal `FileExtension`. Fixture = realistic; adversarial set = tests.
- **Fixture index format**: Heimdall's index is a Postgres DB. Fixture ships it as a SQL/JSON seed + the S3-key-layout directory tree with **Period formats of both kinds** (`Period=202602` in keys, `2602` in the index, and one `Archive-` + negative case) so the period-format mismatch (P5, HEIMDALL-FORMAT §1/§3) is exercised.
- **Blobs in fixture**: tiny (a few hundred bytes), generated from text, MD5 computed by the generator and **asserted equal** to the CV `Checksum`; include a binary one with non-UTF-8 bytes; keep repo size small (no PDFs from the internet: licence/trademark).
- **Fidelity to Heimdall**: the HEIMDALL-FORMAT facts are from source reading, not a real run: **don't over-trust** `fileName = <bulkJobId>.csv`, the page-header-dropped claim, or line-number citations; build the loader against the *index* (`s3path`), never against assumed file names, and keep a "format version" assertion that fails loudly if a header isn't what's expected.
**Phase:** FIX (generator + guard), but the **ID/clock seam** is a prerequisite touching engine/schema: schedule it before the fixture phase and keep it minimal.

### P24: Licence and dependency creep

Candidates: `@aws-sdk/client-s3` (Apache-2.0, OK, large), `pg-copy-streams` (MIT), `csv-parse` (MIT) / `fast-csv` (MIT) / `papaparse` (MIT) if the in-repo parser is replaced (don't: the repo has a documented "no external dependency" CSV parser and conformance is tied to it; extend, don't swap), `@fastify/static` (MIT), `@fastify/multipart` (MIT; needed for multipart VersionData upload: busboy MIT), `mime-types` (MIT) or a hand table (smaller), `better-sqlite3`/`zip` libs not needed. **Check every transitive licence** (`pnpm licenses list --prod` in CI as a `license-check` step with an allow-list: MIT, Apache-2.0, BSD-2/3, ISC, 0BSD, BlueOak, PostgreSQL; **fail on GPL/AGPL/LGPL/SSPL/BUSL/"UNLICENSED"**); AWS SDK pulls `@smithy/*` (Apache-2.0) fine. Don't vendor Heimdall code (read as reference only; its licence label in `HEIMDALL-FORMAT.md` is vague: "Apache-2.0 style": verify the actual `LICENSE` file before copying even a SQL snippet; re-derive from the documented format, which is also what the Developer-MSA-clean-room spirit of the project suggests). No SLDS/Salesforce Sans/icons in the UI.
**Phase:** all; gate in FIX/CI.

### P25: Existing-suite regressions from "just a flag"

`orglet up` startup is a long, order-sensitive sequence (`cli/src/main.ts:160-189`: reconcile prefixes → migrate → bootstrap → seed `__mdt` → bulk reconcile → formula roll-up backfill → listen). Archive mode inserts a mode switch at several points; the safest pattern is **an explicit `ArchiveMode` object created once and passed down** (like `EngineOptions.importMode`) with default off, so all 922/924 existing tests and 10/10 conformance legs run with the same code path as today. Add a CI assertion that the default build is byte-identical in behaviour: run the existing conformance with archive code present (it already is the existing job). Do not touch `conformance/` harnesses or exclude tests to make room. Any new `UNSUPPORTED:` areas must be documented in the same list the CONVENTIONS file keeps (`archive-column`, `archive-dangling-reference`, `archive-unique-violated`, `blob-field`, `content-link-*`).
**Phase:** all.

---

## Minor Pitfalls

- **Timezones**: `TimeZoneSidKey` on User is irrelevant to stored UTC; the UI formats datetimes in browser TZ; show UTC explicitly in the record view (archive "as of" semantics).
- **Locale/encoding**: CSV is UTF-8; `\u0000` in text breaks Postgres `text` (rejects NUL); strip/replace with diagnostic. Lone surrogates from truncated emoji (Heimdall/Java) → invalid UTF-8; decode with `TextDecoder('utf-8', {fatal:false})` and count replacements.
- **Very long text**: Postgres `varchar(n)` from `field.length`; long text areas up to 131 072 chars fit `text`; Rich Text 131 072 incl. markup; fine.
- **Boolean `IsDeleted`** column name case in CSV (`IsDeleted`) vs table `isdeleted`: via `columnName()`.
- **`Name` pseudo-field**: `Name` on Contact/Lead/User is a *compound* (virtual in orglet: `type === "Name"`) while CSV has `Name` as real column (Heimdall excludes only `address`/`base64`): the loader must **drop CSV `Name` for compound-name objects silently** (it's derived from First/Last) — not an `archive-column` diagnostic, or it'd be noise on every Contact/Lead/User. Salutation etc. components exist as columns.
- **Auto-number `Name`** (Account Number, Case Number): stored text in CSV, `AutoNumber` type field in orglet: load as text, advance sequence (P7).
- **`SystemModstamp` at load**: preserve from CSV; do not let the store stamp "now" (import mode semantics, `engine.ts:512-548`); `attributes.url` unaffected.
- **Currency**: `CurrencyIsoCode` column only if multi-currency; present in CSV, may be missing in retrieve → P4.
- **Sandbox/prod Id prefix**: archive data Ids have the real instance chars; `orglet`'s `Organization.Id` fixed `00D...` from generateId; `$Organization.Id` in frozen formulas is the *original* (frozen) — fine, but the UI/`userinfo` org Id differ from record data: acceptable, note it.
- **Windows path separators** in local mirror keys: `OrgId=…/Period=…` use `/` always; build with `path.posix.join` for keys, convert at the filesystem boundary.
- **Heimdall schema drift**: `objects.metadata` jsonb keys, `is_deleted`, `object_name` exist in current main only; check the column set on connect and fail with "unsupported Heimdall index version" listing missing columns, rather than a SQL error.
- **Time-zone of `asOf`**: document as UTC; accept date or ISO datetime.
- **The `updated`/`deleted` REST resources** compute from `SystemModstamp` windows over a static dataset: fine, but their 30-day limit behaviours (if modelled) will return nothing for old data: consistent with Salesforce.

---

## Phase-Specific Warnings

| Phase | Topic | Likely Pitfall | Mitigation |
|-------|-------|----------------|------------|
| RO (design first) | Frozen storage representation | P9: mode not persisted, `isVirtual` forks, second `up` shows `schema-drop`; backfills overwrite frozen roll-ups | Decide `FieldStorage` + persisted org mode before LOAD plans tables; load → up → up idempotence test |
| LOAD | Writer path | P19/P7: COPY unverified on pglite; unique/enum failures abort hours-long load | `BulkWriter` abstraction, stage-then-merge, contract tests on both writers; spike COPY over pglite-socket first |
| LOAD | Parsing | P2, P3: lenient coercion, streaming parser, BOM, no value echo | New lenient/streaming path, differential test against `parseCsv` |
| LOAD | Selection | P5, P6: ties, periods, 15/18 Ids | One SQL `DISTINCT ON` with documented total order, normalised Ids, determinism hash test |
| LOAD | Integrity | P1, P11, P12: danglers, stubs | Post-load audit, stubs table, counted `UNSUPPORTED:archive-*` |
| LOAD | Prefixes | P6: reconcile before data | Derive mapping from data, run `reconcileKeyPrefixes` with it first |
| RO | Enforcement | P10: side doors, bootstrap/seed/backfill writes, `--import` bypass | Guard in `DmlEngine.run` + `Store` + route-table test, row-count-delta test over `up` |
| RO | Erasure | P13, P14: soft delete, versions, blobs, bulk job rows, resurrection on reload | Tombstones, generic PII scan test, CLI-only |
| FILES | Blob store | P15, P16, P17: buffering, XSS via inline SVG/HTML, traversal, missing blobs, checksum | Streaming interface, `attachment`, regex-validated keys, 404 not 500 |
| FILES | Content model | P18: ContentDocument stubs, nullable override, circular FKs, blob write vs DML order | Decide stub vs override for archive; crash-window test |
| UI | Rendering/queries | P21: XSS via href/rich text, token in URL, SOQL injection in search, N+1 describe, huge related lists | Text nodes only + grep gate, header-fetch download, escaper, lazy capped related lists |
| FIX | Determinism | P23: random Ids/timestamps, circular fixture, period-format coverage | Seeded Id/clock seam, `fixture-gen-check`, hand-written adversarial CSV set |
| FIX/CI | No AWS, licences | P19, P24 | Filesystem mirror default, mocked S3, `license-check` allow-list |
| All | Level 1 data | P22 | Redacted, value-free diagnostics, repo guard scan, real-backup runs by the author only |

## Needs deeper phase research (flags for the roadmapper)

1. **LOAD**: COPY over pglite-socket vs `pg-copy-streams`; staging table cast strategy; a spike with a 1M-row synthetic table on Postgres 16 for timing (Confidence on COPY/pglite behaviour: LOW).
2. **RO**: exact Salesforce error code for read-only org (documented set: verify `INSUFFICIENT_ACCESS_OR_READONLY` use in Salesforce REST/SOAP docs before committing; MEDIUM from training).
3. **FILES**: Salesforce `ContentVersion`/`ContentDocument` auto-create semantics (IsLatest, VersionNumber, LatestPublishedVersionId, ContentDocumentLink ShareType/Visibility) from the public Object Reference, plus multipart upload format for `VersionData` (documented in REST API Developer Guide).
4. **UI**: `pg_trgm` availability on pglite; whether a search index is in scope.
5. **Heimdall format re-verification**: confirm file naming, header-per-file, `Archive-` period handling, and that `ContentDocument`/`ContentDocumentLink`/`User`/`RecordType` are or are not backed up by default (changes P11/P18 from "stubs" to "mostly present").

## Sources

- `.planning/research/HEIMDALL-FORMAT.md` (Heimdall source read 2026-11-03; MEDIUM, not re-verified)
- Codebase, read this session (HIGH): `packages/engine/src/engine.ts` (importMode, `refuse`, `run`, formula/roll-up paths), `packages/engine/src/bootstrap.ts`, `packages/engine/src/coerce.ts`, `packages/api/src/bulk/csv.ts`, `packages/schema/src/ids.ts`, `packages/schema/src/prefixes.ts`, `packages/schema/src/ddl.ts` (deferred FKs, unique indexes), `packages/schema/src/columns.ts` (`isVirtual`), `packages/cli/src/main.ts` (startup order), `packages/api/src/routes/*.ts` (write routes), `packages/api/ui/index.html` (DOM builder, sessionStorage token), `test/db.ts` (pglite socket + #958 filter), `.planning/PROJECT.md`, `.planning/codebase/CONCERNS.md`, `.planning/codebase/TESTING.md`
- Postgres/pglite/`pg`/Fastify/S3 behaviour: training knowledge, not re-verified online in this pass (LOW-MEDIUM; items marked **[spike]**)
