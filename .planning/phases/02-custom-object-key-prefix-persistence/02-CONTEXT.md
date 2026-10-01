# Phase 2: Custom-Object Key-Prefix Persistence - Context

**Gathered:** 2026-10-01
**Status:** Ready for planning

<domain>
## Phase Boundary

A custom object's key prefix is assigned once, the first time `orglet up` sees the object
against a given org database, and persisted in the internal `_orglet` Postgres schema. From
then on the persisted value is the truth: adding, removing or renaming other custom objects
never shifts it, so no existing Id changes meaning. An org database created before this phase
keeps the prefixes its records already carry. Collisions and contradictions between prefix
sources fail `orglet up` with a clear error. `orglet check` (no database) reports its prefixes
as provisional; `orglet reset` keeps prefix assignments unless `--drop-prefixes` is given.
As a small extension agreed in discussion, `orglet up --key-prefixes <file>` lets a user seed
prefixes taken from their own real Salesforce org so imported Ids validate. Requirements
PREFIX-01..04.

Not in this phase: any rename/migration tooling for objects, any connection from orglet to a
Salesforce org, Bulk job persistence (phase 6 reuses the `_orglet` schema helper from here),
changes to how standard-object prefixes are defined.

</domain>

<decisions>
## Implementation Decisions

### Storage and reset semantics
- **D-01:** The mapping lives in a separate Postgres schema `_orglet` (the already-reserved
  `INTERNAL_SCHEMA` constant in `packages/schema/src/columns.ts`), as a sibling of the org
  schema, never inside it. It therefore survives `orglet reset`'s `DROP SCHEMA <org> CASCADE`
  by construction, which is what PREFIX-04 requires. This resolves the contradiction in
  STATE.md ("inside the org's own schema so reset clears them") in favour of PREFIX-04.
- **D-02:** The table is keyed per org: primary key `(org_schema, object_name)` and unique
  `(org_schema, key_prefix)`, so several orgs in one database (`--org-schema`) are independent
  and the same prefix may legitimately appear in two orgs. `org_schema` stores the Postgres
  schema name exactly as passed to `--org-schema`. `object_name` stores the API name as written
  in metadata; matching is case-insensitive like the rest of `OrgSchema`.
- **D-03:** Only custom objects are persisted. Standard-object prefixes stay as documented
  constants in the baseline JSON; the collision check compares persisted custom prefixes
  against every standard prefix in the loaded `OrgSchema` on every `up`.
- **D-04:** Reconciliation runs in `orglet up` after the Postgres connectivity check and before
  `bootstrapOrg` / `new DmlEngine` (whether before or after `migrate()` is Claude's discretion;
  `keyPrefix` does not affect DDL). Assignment and INSERT happen in the same step, inside one
  transaction. `orglet check` never touches the database.
- **D-05:** The reconciliation transaction takes a `pg_advisory_xact_lock` keyed on the org
  schema, then reads, assigns and writes. A second concurrent `orglet up` waits and then reads
  the first one's result. No duplicate assignment, no crash.
- **D-06:** A small shared helper in `@orglet/schema` (working name `ensureInternalSchema`)
  runs `CREATE SCHEMA IF NOT EXISTS "_orglet"`. The prefix module calls it now; phase 6 (Bulk
  persistence) reuses it. Each module owns its own `CREATE TABLE IF NOT EXISTS`.
- **D-07:** `orglet reset --drop-prefixes` additionally runs `DELETE FROM _orglet.key_prefixes
  WHERE org_schema = $1`. Other orgs' rows are untouched and the `_orglet` schema itself is
  left in place. Plain `orglet reset` is unchanged and keeps the rows.

### Seeding on first upgrade (PREFIX-02) and external prefixes
- **D-08:** Precedence when an object has no persisted row yet, highest first:
  1. Existing records in the object's table (`SELECT DISTINCT left(id, 3)` on that table,
     including soft-deleted rows). A table with rows is the only source that guarantees no
     existing Id changes meaning.
  2. The `--key-prefixes <file>` mapping, if given and it names the object.
  3. The provisional alphabetical prefix from `buildOrgSchema`, if it is not already taken by
     a persisted row or a standard object.
  4. Otherwise the lowest free prefix in `a00`..`azz` (D-12).
  Once a row exists it is the truth unconditionally; nothing is ever recomputed from position.
- **D-09:** Any contradiction between sources is a hard error that aborts `up` with nothing
  written: a table whose rows carry two different prefixes, a mapping-file prefix that differs
  from what existing rows carry, a mapping-file or data-derived prefix that collides with a
  standard-object prefix or with another object's persisted prefix (PREFIX-03). The message
  names both objects and both values.
- **D-10:** The data scan is one `SELECT DISTINCT left(id, 3)` per custom table and runs only
  for objects that have no persisted row, so an upgraded org pays it once per object.
- **D-11:** `orglet up --key-prefixes <file>` takes a JSON object `{ "Foo__c": "a0X", ... }`
  mapping API name to 3-character prefix. It is consulted only for objects without a persisted
  row (D-08 step 2); it can never override or steal a persisted prefix. orglet never connects
  to Salesforce; producing the file (for example from `sf sobject describe --json`, which
  exposes `keyPrefix`) is the user's job and is documented in `README.md`. Reading one's own
  org's describe is metadata, not behaviour-diffing, so the Developer MSA constraint is not
  touched.

### Retirement and rename
- **D-12:** A new object gets the lowest prefix in `a00`..`azz` that is not held by a
  persisted row for that org and is not a standard-object prefix. Deterministic and readable;
  because rows are never removed except by `--drop-prefixes`, nothing is reused in practice.
- **D-13:** A row is never removed by `orglet up`. If a custom object disappears from the SFDX
  project (table kept, `UNSUPPORTED:schema-drop` warning) the row stays, so the object gets
  the same prefix back if it returns and nobody else can take it meanwhile. If the table is
  dropped with `--force` the row still stays: a prefix is permanent per object name in that
  org until `reset --drop-prefixes`, matching Salesforce where a deleted object's prefix does
  not come back.
- **D-14:** Rename is not a concept: `Old__c` → `New__c` is a new object that gets a new
  prefix, and `Old__c` keeps its row. There is no `--rename` flag. A user who wants `New__c` to
  inherit the prefix uses the mapping file for `New__c` after removing the old row
  (`reset --drop-prefixes`, or manual SQL on `_orglet.key_prefixes`); a mapping entry that
  collides with a still-persisted `Old__c` row fails per D-09.

### CLI surface (PREFIX-04)
- **D-15:** `orglet check` prints, after the existing summary line, one line per custom
  object with its provisional prefix, for example `Project__c  a02  (provisional)`, and ends
  with one line stating that custom-object prefixes are assigned for real by `orglet up` and
  read from the database thereafter. Standard objects are not listed. The doc comment on
  `customKeyPrefix` in `build.ts` is updated to say the scheme is provisional.
- **D-16:** `orglet up` logs only new assignments and seeding, with the source, for example
  `assigned key prefix a03 to Foo__c`, `... from existing records`, `... from --key-prefixes`.
  Silent when every custom object already has a row. Respects `--quiet` via the existing
  `log()` helper.
- **D-17:** The reset flag is `--drop-prefixes`.
- **D-18:** Prefix collisions and conflicts are raised as a dedicated error class (working
  name `KeyPrefixError`, carrying the two object names and prefixes) that `main.ts` catches
  and prints as `error: <message>` plus one actionable hint line, exit code 1, no stack
  trace. Same pattern as the Postgres-unreachable message today. These are genuine errors,
  not `UNSUPPORTED:*` warnings.

### Claude's Discretion
- Exact file and export names in `@orglet/schema` (research suggests
  `packages/schema/src/keyPrefixes.ts` with `reconcileKeyPrefixes`; `ids.ts` stays a pure
  codec with no DB imports).
- Whether reconciliation mutates `SObjectDef.keyPrefix` in place on the loaded `OrgSchema`
  (the existing pattern in `buildOrgSchema`) or returns a new schema, as long as
  `bootstrapOrg`, `DmlEngine`, describe and the SOQL/formula layers all see the persisted
  values.
- Column names and types of `_orglet.key_prefixes`, an `assigned_at` timestamp, and whether
  the table records the source of each assignment.
- Order of `migrate()` versus reconciliation inside `up()`.
- How the existing DB-backed tests obtain a prefix table on pglite (the per-file
  `test_<hex>` schema pattern from phase 1 applies to `org_schema`; `_orglet` is shared
  within an instance and per-file instances keep it isolated).
- Exact wording of `check` output, `up` log lines, the error hint lines and the README
  section for `--key-prefixes`.
- Validation of the mapping file (shape, 3-character alphanumeric prefix, unknown object
  names: Claude decides between error and warning, leaning error for consistency with D-09).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` §"Phase 2" — goal and the four success criteria
- `.planning/REQUIREMENTS.md` — PREFIX-01..PREFIX-04 (the acceptance statements this phase
  closes); "Out of Scope" table for what must not be built
- `.planning/PROJECT.md` — Key Decisions ("Persist custom-object key prefixes"), constraints
  (no behaviour-diffing, Level 1 data only, conformance suites stay green)
- `.planning/STATE.md` — note the "inside the org's own schema" wording is superseded by D-01

### Research for this phase
- `.planning/research/ARCHITECTURE.md` §"Feature 3: Custom-Object Key-Prefix Persistence" —
  layering argument (metadata stays DB-free), finding that `keyPrefix` does not affect DDL,
  proposed `reconcileKeyPrefixes` design and call site; D-08..D-14 refine its step 3/4
- `.planning/research/PITFALLS.md` §"Pitfall 8" — persist-then-assign-new, never
  recompute-then-persist; the two-build drift test is the acceptance gate
- `.planning/research/SUMMARY.md` — `_orglet` reserved-but-unused finding

### Prior phase context
- `.planning/phases/01-test-infrastructure-ci/01-CONTEXT.md` — D-09..D-12 (pglite per file,
  `ORGLET_DATABASE_URL` auto-detect, `test_<hex>` schema per file) and D-20/D-21 (Postgres-only
  skip mechanism) which any new DB-backed test must follow

### Existing code this phase changes or depends on
- `packages/metadata/src/build.ts` — `customKeyPrefix` (line ~401) and the alphabetical
  assignment loop (line ~421); doc comment to be updated, algorithm kept as the provisional
  source
- `packages/metadata/src/types.ts` — `SObjectDef.keyPrefix`
- `packages/schema/src/columns.ts` — `INTERNAL_SCHEMA = "_orglet"`, `quote`, `tableName`
- `packages/schema/src/ids.ts` — `generateId`, `keyPrefixOf` (pure codec, keep DB-free)
- `packages/schema/src/migrate.ts` — transaction/`run` pattern, `information_schema` queries,
  `UNSUPPORTED:schema-drop` handling that D-13 interacts with
- `packages/schema/src/db.ts` — `createPool`, the single pool seam
- `packages/engine/src/bootstrap.ts`, `packages/engine/src/engine.ts` (`saveBatch` around
  line 358, `checkReferences`) — consumers of `keyPrefix` that must run after reconciliation
- `packages/cli/src/main.ts` — `check()`, `up()`, `reset()`, `USAGE`, `parseArgs` options,
  the Postgres-unreachable error pattern D-18 mirrors
- `packages/metadata/src/build.test.ts` — existing "assigns custom key prefixes in name
  order" test (documents the provisional scheme)
- `examples/acme` — fixture with three custom objects (`BigTable__c`, `Milestone__c`,
  `Project__c`, plus `UpsertTable__c`) for the two-build drift test
- `README.md` — gains the `--key-prefixes` documentation (D-11)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `INTERNAL_SCHEMA` and `quote()` in `packages/schema/src/columns.ts` already exist for this
  purpose; no new naming needed for the schema itself.
- `migrate()` in `packages/schema/src/migrate.ts` shows the house pattern for a client
  transaction with a local `run()` helper and `information_schema` lookups; the data scan in
  D-08/D-10 can discover custom tables the same way.
- `keyPrefixOf(id)` in `packages/schema/src/ids.ts` is the existing "first three characters"
  helper; the data scan should agree with it.
- `log(c, ...)` and the `console.error` + hint-line pattern in `packages/cli/src/main.ts`
  are the output conventions D-16 and D-18 reuse.
- Phase 1's `test/db.ts` helper gives every DB-backed test a pool on pglite or Postgres.

### Established Patterns
- `packages/metadata` has no in-repo dependencies and must stay DB-free, which is why
  `orglet check` can run without Postgres; persistence lives in `packages/schema` or above.
- `keyPrefix` is consumed only by `generateId` and prefix-based Id validation, never by DDL,
  so reconciliation needs to precede `bootstrapOrg`/`DmlEngine` only.
- In-place mutation of `SObjectDef` after load is already how `buildOrgSchema` merges
  project overrides (`target.label = o.label`).
- Errors with distinct user-facing handling are named `Error` subclasses with a
  machine-readable code (`DmlError`, `SoqlError`, `UnsupportedMetadataError`); D-18 follows
  this.
- Standard prefixes in the baseline today all start with a digit; `a0x` collisions are
  only possible once phase 3 adds objects or through hand-edited rows, which is why D-03's
  check is cheap but mandatory.
- Every DB-backed test isolates itself in a `test_<hex>` schema; `_orglet` rows must be keyed
  by that schema (D-02) for tests to stay independent on a shared Postgres.

### Integration Points
- `up()` in `packages/cli/src/main.ts`: new step between `SELECT 1` and `bootstrapOrg`.
- `check()`: new per-object output after the summary line.
- `reset()`: new `--drop-prefixes` option; `parseArgs` options and `USAGE` text.
- `@orglet/schema` `index.ts` barrel: new exports for the reconcile function, the error class
  and the internal-schema helper (explicit named exports, value and type lines separate).
- Phase 3 (14 thin standard objects with fixed prefixes) relies on D-03's collision check;
  phase 6 (Bulk persistence) relies on D-06's helper.

</code_context>

<specifics>
## Specific Ideas

- Johan's running devrandom org (port 8180, `--org-schema devrandom`) is the real-world
  PREFIX-02 case: two custom objects assigned `a00`/`a01` by the old scheme, with records.
  After upgrade, `up` must log two "from existing records" lines and nothing else.
- "It would be really cool to bring in prefixes from your existing org": the motivating case
  is import mode, where records from a real org already carry that org's `a0X` prefixes and
  must validate against the same prefix in orglet. `--key-prefixes` exists for that.
- The acceptance test is two-build, per Pitfall 8: build with [A, B], record prefixes; build
  again with an object that sorts before A; A and B unchanged, only the newcomer gets a new
  prefix. Add the mirror case for removal and for a mapping-file seed.

</specifics>

<deferred>
## Deferred Ideas

- `--rename Old__c=New__c` on `orglet up` that moves the prefix row and renames the table in
  `migrate()`: a new capability (table renames do not exist today), own phase if ever wanted.
- Accepting raw `sf sobject describe` / `sf sobject list` JSON directly as the
  `--key-prefixes` input instead of a hand-written mapping: nice-to-have, revisit when the
  real-org migration story becomes a milestone.
- Dropping the `_orglet` schema when its last row for the last org is removed: cosmetic,
  reconsider in phase 6 when Bulk tables share the schema.
- Reviewed todos: none pending for this phase.

</deferred>

---

*Phase: 02-custom-object-key-prefix-persistence*
*Context gathered: 2026-10-01*
