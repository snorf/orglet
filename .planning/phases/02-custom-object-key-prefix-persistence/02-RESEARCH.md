# Phase 2: Custom-Object Key-Prefix Persistence - Research

**Researched:** 2026-10-01
**Domain:** Postgres-backed persistence of Salesforce custom-object key prefixes inside an existing TypeScript monorepo (`@orglet/schema`, `@orglet/cli`); concurrency via advisory locks; pglite/Postgres parity
**Confidence:** HIGH (every code claim below is from a direct read of the current source; every SQL claim was executed against pglite 0.5.8 through the real `pg` pool during this research)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Storage and reset semantics
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

#### Seeding on first upgrade (PREFIX-02) and external prefixes
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

#### Retirement and rename
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

#### CLI surface (PREFIX-04)
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

### Deferred Ideas (OUT OF SCOPE)
- `--rename Old__c=New__c` on `orglet up` that moves the prefix row and renames the table in
  `migrate()`: a new capability (table renames do not exist today), own phase if ever wanted.
- Accepting raw `sf sobject describe` / `sf sobject list` JSON directly as the
  `--key-prefixes` input instead of a hand-written mapping: nice-to-have, revisit when the
  real-org migration story becomes a milestone.
- Dropping the `_orglet` schema when its last row for the last org is removed: cosmetic,
  reconsider in phase 6 when Bulk tables share the schema.
- Reviewed todos: none pending for this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PREFIX-01 | Prefix assigned the first time `orglet up` sees a custom object, stored in `_orglet`, so reloading with a new/renamed object never changes an existing object's prefix | §Architecture Patterns 1–3 (`planKeyPrefixes` two-pass planner + `reconcileKeyPrefixes` DB wrapper, in-place mutation verified safe in §Q4); §Validation Architecture two-build drift test (Pitfall 8 gate) |
| PREFIX-02 | Existing DB whose prefixes came from the alphabetical scheme keeps those exact assignments on first upgrade | §Architecture Pattern 2 (data scan `SELECT DISTINCT left(id,3)` verified on pglite; table existence via `information_schema.tables`), precedence tier 1; test "seeds from existing rows" |
| PREFIX-03 | Persisted custom prefix never collides with a standard prefix or another custom prefix; collision fails load with a clear error | §Architecture Pattern 1 (taken-set = standard ∪ persisted ∪ assigned-this-run; `KeyPrefixError` with both claims); DB `UNIQUE (org_schema, key_prefix)` as backstop (verified raises 23505) |
| PREFIX-04 | `orglet check` reports provisional prefixes and says so; `orglet reset` keeps rows unless asked to drop | §Code Examples `check()` lines + `main.test.ts` console-spy test; `dropKeyPrefixes` + `--drop-prefixes` option; `_orglet` is outside the dropped schema (D-01) |
</phase_requirements>

## Summary

This phase adds one small persistence module to `@orglet/schema` and threads it through the CLI. Nothing in the existing codebase caches `keyPrefix` anywhere except on the `SObjectDef` itself: `OrgSchemaImpl` indexes fields and child relationships but not prefixes, and all eleven consumers (`engine.ts` lines 302/337/358/497, `bootstrap.ts` 48–50/92, `describe.ts` 196, `composite.ts` 102) read `obj.keyPrefix` at call time. In-place mutation of the loaded `OrgSchema` before `bootstrapOrg`/`new DmlEngine` is therefore safe and is the recommendation (it is also the existing `buildOrgSchema` pattern).

Every Postgres feature the design needs was executed against pglite 0.5.8 (which reports itself as PostgreSQL 18.3) through the real `pg` pool via pglite-socket during this research: `pg_advisory_xact_lock(hashtext($1))` and the two-int form, `CREATE SCHEMA IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS` twice in one transaction, `char(3)` round-tripping as a 3-character string, `UNIQUE (org_schema, key_prefix)` raising SQLSTATE 23505, `SELECT DISTINCT left(id,3)`, `information_schema.tables WHERE table_schema=$1`, `to_regclass($1)` returning NULL for a missing table, and `DELETE ... WHERE org_schema=$1`. All of these are also standard in Postgres 16 (the production target). No Postgres-only skip is needed for any test in this phase except, optionally, a true two-connection concurrency test (pglite-socket serialises connections, so that test must use the existing `skip(usingPglite, ...)` mechanism and is nice-to-have, not a gate).

The one non-obvious design point is ordering inside the planner: data-derived and mapping-derived prefixes (D-08 tiers 1–2) must be resolved for *all* objects before any provisional/next-free prefix (tiers 3–4) is handed out, otherwise object A can grab provisional `a00` and then B's existing records carrying `a00` look like a collision. A pure two-pass `planKeyPrefixes()` function (no DB) makes this testable in milliseconds and keeps `reconcileKeyPrefixes()` a thin read → plan → insert → mutate wrapper.

**Primary recommendation:** Add `packages/schema/src/prefixes.ts` (pure `planKeyPrefixes` + DB `reconcileKeyPrefixes`/`dropKeyPrefixes`/`parseKeyPrefixMapping` + `KeyPrefixError`) and `packages/schema/src/internal.ts` (`ensureInternalSchema`); call `reconcileKeyPrefixes` in `up()` immediately after `SELECT 1` and **before** `migrate()`; take a constant advisory lock for the `_orglet` DDL and the per-org lock for assignment; make the two-build drift test on `examples/acme` plus an in-memory extra `SourceObject` the acceptance gate.

## Standard Stack

No new runtime dependencies. Everything is already in the workspace.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `pg` | 8.23.0 (`packages/schema/package.json` `^8.23.0`) | Only DB driver; `withTransaction(pool, fn)` in `db.ts` is the transaction helper to reuse | Already the single pool seam |
| `@orglet/metadata` | workspace | `OrgSchema`, `SObjectDef.keyPrefix`, `buildOrgSchema`, `SourceProject`/`SourceObject` (for in-memory second builds in tests) | Existing dependency of `@orglet/schema` |
| `node:util` `parseArgs` | Node 22 | `--key-prefixes <file>` (string) and `--drop-prefixes` (boolean) options | Already used in `main.ts` |
| `node:fs/promises` `readFile` | Node 22 | CLI reads the mapping file; `@orglet/schema` stays fs-free | Matches "logging/IO at the edges" convention |

### Supporting (test only, already installed)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 3.2.7 | test runner; `vi.spyOn(console, "log")` for the `check` output test | all new tests |
| `@electric-sql/pglite` + `pglite-socket` | 0.5.8 / 0.2.11 | embedded backend via `test/db.ts` `openTestDb()` | DB-backed tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `pg_advisory_xact_lock(hashtext(k1), hashtext($1))` | `SELECT ... FOR UPDATE` on rows | Row locks cannot serialise the *first* insert for an org (no row yet); advisory lock is the standard answer (D-05 locks this anyway) |
| In-place `SObjectDef.keyPrefix = ...` | Return a new `OrgSchemaImpl` | New-schema approach forces every caller in `up()` to switch references and gains nothing: no consumer caches prefixes (verified §Q4) |
| `char(3)` column | `text` + `CHECK (length = 3)` | `char(3)` was verified to round-trip as exactly `"a02"` (no padding issue because every value is exactly 3 chars); it encodes the invariant in the type. Use `char(3)` |

**Installation:** none.

**Version verification:** `pg` 8.23.0, pglite 0.5.8, pglite-socket 0.2.11, vitest 3.2.7, pnpm 12.6.0 and Node 22.23.3 all confirmed from `pnpm-lock.yaml`/`node_modules` and `pnpm --version` on 2026-10-01.

## Architecture Patterns

### Recommended file layout

```
packages/schema/src/
├── internal.ts          # NEW: ensureInternalSchema(client) — D-06 shared helper (phase 6 reuses)
├── prefixes.ts          # NEW: KeyPrefixError, planKeyPrefixes (pure), parseKeyPrefixMapping (pure),
│                        #      reconcileKeyPrefixes (DB), dropKeyPrefixes (DB)
├── prefixes.test.ts     # NEW: pure planner/mapping tests + DB-backed reconcile tests (two-build gate)
├── ids.ts               # unchanged (pure codec, no DB imports)
├── columns.ts           # unchanged (INTERNAL_SCHEMA, quote, tableName already exist)
└── index.ts             # + explicit named exports (values and types on separate lines)
packages/metadata/src/build.ts        # doc comment on customKeyPrefix only (D-15)
packages/metadata/src/build.test.ts   # retitle "assigns provisional custom key prefixes in name order"
packages/cli/src/main.ts              # up(): reconcile step + KeyPrefixError catch; check(): provisional lines;
                                      # reset(): --drop-prefixes; parseArgs options; USAGE text
packages/cli/src/main.test.ts         # NEW: first CLI test — `check` output via console spy (no DB)
packages/api/src/api.test.ts          # + reconcile with a mapping in beforeAll, assert describe keyPrefix
README.md                             # NEW section "Custom-object key prefixes"
```

**File naming (Claude's discretion, deviating from the CONTEXT working name):** the schema package uses one-word lowercase file names (`ids.ts`, `ddl.ts`, `columns.ts`, `migrate.ts`, `db.ts`; CONVENTIONS.md "One word, lowercase, no separators"). `keyPrefixes.ts` would be the first camelCase file in the repo. Use `prefixes.ts`. Export names keep the descriptive form (`reconcileKeyPrefixes`), matching `planSchema`/`migrate` verb-first style.

### Pattern 1: Pure two-pass planner, thin DB wrapper

**What:** Separate "decide" from "persist", exactly as `planSchema()` (pure, `ddl.ts`) is separated from `migrate()` (DB). The planner receives plain data and returns assignments or throws `KeyPrefixError`; it never sees a `Pool`.

**When to use:** always — it is what makes every D-09 collision case a sub-millisecond unit test.

**Shape (recommended, names at planner's discretion):**

```typescript
// packages/schema/src/prefixes.ts  (sketch — verified against the real types in types.ts / sfdx.ts)
import type { OrgSchema, SObjectDef } from "@orglet/metadata";
import { INTERNAL_SCHEMA, quote, tableName } from "./columns.js";
import { withTransaction, type Pool, type PoolClient } from "./db.js";
import { ensureInternalSchema } from "./internal.js";

export type KeyPrefixSource = "persisted" | "records" | "mapping" | "provisional" | "next-free";

export interface KeyPrefixClaim { objectName: string; keyPrefix: string; source: KeyPrefixSource }

export class KeyPrefixError extends Error {
  constructor(readonly claims: KeyPrefixClaim[], message: string) {
    super(message);
    this.name = "KeyPrefixError";
  }
}

export interface KeyPrefixPlanInput {
  /** Custom objects in the loaded schema with their provisional (buildOrgSchema) prefix. */
  custom: { name: string; provisional: string }[];
  /** Every standard object's fixed prefix (D-03). */
  standard: { name: string; keyPrefix: string }[];
  /** Rows already in _orglet.key_prefixes for this org, keyed by lower-cased object name. */
  persisted: Map<string, { name: string; keyPrefix: string }>;
  /** Distinct `left(id,3)` values found per custom table that exists, keyed by lower-cased name. */
  observed: Map<string, string[]>;
  /** Parsed --key-prefixes file, keyed by lower-cased object name. */
  mapping: Map<string, string>;
}

export interface KeyPrefixAssignment extends KeyPrefixClaim { source: Exclude<KeyPrefixSource, "persisted"> }

/** Pure. Returns only the NEW rows to insert; throws KeyPrefixError on any D-09 contradiction. */
export function planKeyPrefixes(input: KeyPrefixPlanInput): { assignments: KeyPrefixAssignment[]; warnings: string[] }
```

**Algorithm (the two passes matter):**

1. `taken: Map<prefix, KeyPrefixClaim>` ← every standard prefix (`source: "persisted"` is wrong for these; use a 6th label or reuse `"persisted"` with the standard name — planner picks; message must say "standard object Account (001)") plus every persisted row for this org.
2. **Pass 1 — fixed sources (D-08 tiers 1–2), for every custom object without a persisted row, in `schema.list()` order:**
   - `observed.get(name)`: 0 values → no data claim; 1 value → data claim; ≥2 values → `KeyPrefixError` ("table project__c carries records with prefixes a02 and a07").
   - `mapping.get(name)`: if present and a data claim exists and they differ → `KeyPrefixError` (D-09). If equal → source stays `"records"`.
   - The resulting claim (records or mapping): if `taken.has(prefix)` → `KeyPrefixError` naming both claims (this covers standard collision, another object's persisted prefix, and the D-14 `Old__c`/`New__c` case). Else add to `taken` and to `assignments`.
3. **Pass 2 — derived sources (tiers 3–4), for the remaining objects, same order:** provisional prefix if `!taken.has(provisional)` (source `"provisional"`), else lowest `a00`..`azz` not in `taken` (source `"next-free"`); add to `taken` and `assignments`. Exhausting `azz` throws a plain `Error` (3844 custom objects; unreachable in practice, matches `customKeyPrefix`'s existing throw).
4. Mapping entries for objects that already have a persisted row with the **same** prefix: no-op. With a **different** prefix: D-11 says the mapping "can never override or steal a persisted prefix" and is "consulted only for objects without a persisted row", so do not throw — push a `warnings` entry (`--key-prefixes: Foo__c already has persisted prefix a01; mapping value a0X ignored`). This keeps D-11 literal while honouring the "say it loud" principle. (Claude's discretion, within the mapping-validation remit.)

**Why two passes:** with a single pass in name order, `Aardvark__c` (new, no rows) would take provisional `a00` before `BigTable__c`'s existing rows (which carry `a00` from the old scheme) are consulted, turning a legitimate PREFIX-02 upgrade into a false collision. The two-build/upgrade tests in §Validation Architecture catch this; name the pitfall in the plan.

### Pattern 2: `reconcileKeyPrefixes` transaction (read → scan → plan → insert → mutate)

**What:** The DB wrapper. One `withTransaction`, locks first, DDL second, then data.

```typescript
export interface ReconcileKeyPrefixesOptions {
  orgSchema?: string;                 // default DEFAULT_ORG_SCHEMA, like MigrateOptions
  mapping?: Record<string, string>;   // already parsed + validated by parseKeyPrefixMapping
}
export interface ReconcileKeyPrefixesResult {
  /** New rows written this run, in assignment order (empty when every object already had a row). */
  assignments: KeyPrefixAssignment[];
  warnings: string[];
}

export async function reconcileKeyPrefixes(pool: Pool, schema: OrgSchema, options: ReconcileKeyPrefixesOptions = {}): Promise<ReconcileKeyPrefixesResult> {
  const orgSchema = options.orgSchema ?? DEFAULT_ORG_SCHEMA;
  return withTransaction(pool, async (client) => {
    // 1. Locks, always in this order (global DDL lock, then per-org lock) so two `up`s cannot deadlock.
    await ensureInternalSchema(client);                                   // takes the constant lock + CREATE SCHEMA IF NOT EXISTS
    await client.query(`CREATE TABLE IF NOT EXISTS ${T} (...)`);          // still under the constant lock (xact locks persist to COMMIT)
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", ["orglet.key_prefixes", orgSchema]);
    // 2. Read persisted rows for this org.
    // 3. Which custom tables exist? SELECT table_name FROM information_schema.tables WHERE table_schema = $1   (same query migrate.ts/pglite-compat use)
    // 4. For each custom object with no row AND an existing table: SELECT DISTINCT left(id, 3) AS p FROM "<org>"."<table>"   (D-10: once per object, ever)
    // 5. plan = planKeyPrefixes(...)  — throws KeyPrefixError → withTransaction ROLLBACKs → nothing written (D-09)
    // 6. INSERT one row per assignment (parameterised; 23505 here means a bug in the planner, let it throw)
    // 7. Mutate: for every custom object, obj.keyPrefix = persisted ?? assigned   (in place; see §Q4)
    return { assignments: plan.assignments, warnings: plan.warnings };
  });
}
```

**Table DDL (recommended; columns are Claude's discretion):**

```sql
CREATE TABLE IF NOT EXISTS "_orglet"."key_prefixes" (
  org_schema  text        NOT NULL,
  object_name text        NOT NULL,
  key_prefix  char(3)     NOT NULL,
  source      text        NOT NULL,                 -- 'records' | 'mapping' | 'provisional' | 'next-free' (debuggability, costs nothing)
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_schema, object_name),
  UNIQUE (org_schema, key_prefix)
)
```
Verified verbatim on pglite 0.5.8 inside a transaction, twice (idempotent), with a following INSERT and a second INSERT that correctly failed with `duplicate key value violates unique constraint "key_prefixes_org_schema_key_prefix_key"`. Case-insensitive matching (D-02) is done in the planner (`Map` keyed by `name.toLowerCase()`); since `reconcileKeyPrefixes` is the only writer and always writes the canonical name from metadata, two casings of one object never coexist. Do not add a `lower(object_name)` index (YAGNI).

**Mutation step detail:** write `obj.keyPrefix = value` directly on the `SObjectDef` from `schema.getObject(name)`. `SObjectDef.keyPrefix` is a plain mutable `string` (types.ts:148, not `readonly`). `buildOrgSchema` already mutates `target.label` etc. in place after construction.

### Pattern 3: Order inside `up()` — reconcile BEFORE `migrate()`

**Recommendation (Claude's discretion): reconcile first, then migrate.**

Reasons:
- D-09 says a conflict "aborts `up` with nothing written". With reconcile first, a conflicting mapping file against a brand-new database leaves no org schema behind at all; with migrate first, DDL has already been committed before the error (harmless since DDL is idempotent and prefix-independent, but it is "something written").
- It is the call site ARCHITECTURE.md §Feature 3 and CONTEXT.md §Integration Points already name ("right after `SELECT 1`").
- The only cost is a table-existence check before the data scan, and that is one query the codebase already uses (`information_schema.tables WHERE table_schema = $1`, see `pglite-compat.test.ts` line 54). On a fresh org no table exists → no scan → tiers 3–4. On an upgraded org every table exists → tier 1 seeds exactly the old alphabetical values (PREFIX-02).
- If a custom object was removed from metadata (D-13) its table may still exist, but it is not in `schema.list()` and is therefore never scanned — correct, its row (if any) just stays.

Resulting `up()` sequence: `loadOrgSchema` → warnings → `createPool` → `SELECT 1` (existing) → **`reconcileKeyPrefixes` (new, with `KeyPrefixError` catch → `error:` + hint, `return 1`)** → log D-16 lines → `migrate` → `bootstrapOrg` → `new DmlEngine` → ... (rest unchanged).

### Pattern 4: `ensureInternalSchema` with a constant advisory lock (D-06, race-safe)

```typescript
// packages/schema/src/internal.ts
/**
 * The `_orglet` schema holds orglet's own bookkeeping (key prefixes now, Bulk jobs in phase 6) next
 * to, never inside, an org schema, so `orglet reset` cannot drop it. Callers hold the transaction-
 * scoped lock for the rest of their transaction, so their own CREATE TABLE IF NOT EXISTS is serialised too.
 */
import { INTERNAL_SCHEMA, quote } from "./columns.js";
import type { PoolClient } from "./db.js";

export async function ensureInternalSchema(client: PoolClient): Promise<void> {
  // IF NOT EXISTS is not safe under concurrent callers (two sessions can both pass the existence check
  // and one then fails on the pg_namespace/pg_type unique index); the lock makes it so.
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [INTERNAL_SCHEMA]);
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${quote(INTERNAL_SCHEMA)}`);
}
```
Why this matters now: on the CI `test-postgres` job vitest runs test files in parallel forked workers against **one** shared Postgres, so `prefixes.test.ts` and `api.test.ts` can both run `CREATE SCHEMA IF NOT EXISTS "_orglet"` in the same instant with *different* per-org locks. The constant lock closes that race for 1 line of code. Deadlock-free because every caller acquires the constant lock first and the per-org lock second. (Postgres `IF NOT EXISTS` concurrency: MEDIUM confidence that it can fail with 23505 under contention — widely reported on pgsql lists; the lock is cheap insurance regardless.)

### Pattern 5: Mapping-file parsing split (D-11)

- **CLI (`main.ts`)**: `const raw: unknown = JSON.parse(await readFile(resolve(values["key-prefixes"]), "utf8"))` — the only place `node:fs` is touched. A missing/unreadable file or invalid JSON is reported with the same `error:` + hint pattern, exit 1.
- **Schema (`prefixes.ts`)**: `export function parseKeyPrefixMapping(raw: unknown, schema: OrgSchema): Record<string, string>` — pure, throws `KeyPrefixError` (reuse the class; `claims` holds the offending entry) when: not a plain object; a value is not a string matching `/^[0-9A-Za-z]{3}$/` (same regex `generateId` enforces, ids.ts:64); a key names an object that is not in the loaded schema **or is not custom** (recommendation: **error**, consistent with D-09 and CONTEXT's lean; an unknown name is almost always a typo that would silently do nothing); two keys map to the same prefix. Returns keys in canonical metadata casing (`schema.getObject(k)!.name`), so the planner's `Map` can be keyed by lower-case uniformly.
- Why in `@orglet/schema` and not `@orglet/cli`: keeps validation unit-testable in `prefixes.test.ts` next to the planner it feeds, and `@orglet/schema` already owns the prefix regex semantics. `@orglet/schema` stays fs-free (CONVENTIONS "logging/IO belongs at the edges").

### Pattern 6: `dropKeyPrefixes` for `reset --drop-prefixes` (D-07)

```typescript
/** Returns the number of rows removed. Safe on a database that never ran `up` (no table yet). */
export async function dropKeyPrefixes(pool: Pool, orgSchema: string): Promise<number> {
  const exists = await pool.query<{ t: string | null }>("SELECT to_regclass($1)::text AS t", [`${INTERNAL_SCHEMA}.key_prefixes`]);
  if (exists.rows[0]?.t === null) return 0;
  const res = await pool.query(`DELETE FROM ${quote(INTERNAL_SCHEMA)}.${quote("key_prefixes")} WHERE org_schema = $1`, [orgSchema]);
  return res.rowCount ?? 0;
}
```
`to_regclass` returning `NULL` for a missing relation was verified on pglite. Putting this in the schema package (rather than inline SQL in `reset()`) makes it callable from `afterAll` in tests (see §Q6) and testable without spawning the CLI.

### Anti-Patterns to Avoid
- **Recompute-then-persist (Pitfall 8):** any code path where `customKeyPrefix(i)` output is written to the table for an object that already has a row. The planner must receive `persisted` and never emit an assignment for a persisted name.
- **Single-pass assignment** (see Pattern 1): provisional before data/mapping claims are collected.
- **Scanning tables that are not in the loaded schema**, or scanning before checking existence (42P01 on a fresh org when reconciling before migrate).
- **`UNSUPPORTED:*` for prefix conflicts.** These are real errors (`KeyPrefixError`), per D-18 and the task brief.
- **Reaching into `_orglet` from `packages/metadata`.** `orglet check` must remain DB-free; only `@orglet/schema` and above touch Postgres.
- **Relying on the `UNIQUE` constraint for the user-facing message.** The planner detects collisions first so the message can name both objects (D-09); the constraint is a backstop against planner bugs.
- **Using `pool.query` for the reconcile steps.** All steps must run on the one `client` inside `withTransaction` or the advisory lock and the rollback guarantee are meaningless.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Transaction + rollback-on-throw | manual BEGIN/COMMIT in `prefixes.ts` | `withTransaction(pool, fn)` (`db.ts`) | Already handles ROLLBACK-on-error and `client.release()`; `migrate()` and `bootstrapOrg()` use it |
| Identifier quoting / table names | string concat | `quote()`, `tableName(obj)`, `INTERNAL_SCHEMA` (`columns.ts`) | Handles `"` escaping and the 63-byte identifier hash truncation that long custom names hit |
| Cross-process serialisation | a lock table / sentinel row | `pg_advisory_xact_lock` (D-05) | Released automatically at COMMIT/ROLLBACK, no cleanup on crash |
| Test DB bootstrap | per-file pglite code | `openTestDb()` + `usingPglite` (`test/db.ts`) | Phase 1's single seam; D-09/D-21 of phase 1 |
| Prefix shape validation | new regex | the `/^[0-9A-Za-z]{3}$/` rule already in `generateId` (extract to a shared const or duplicate the literal; do not invent a different rule) | Keeps mapping validation and Id generation in agreement |
| Provisional prefix list for `check` | re-implementing `customKeyPrefix` in the CLI | `schema.list().filter(o => o.custom)` and read `o.keyPrefix` | `buildOrgSchema` already set it; the CLI just labels it |

**Key insight:** the whole feature is ~150 lines because the repo already has the transaction helper, the quoting helpers, the reserved `_orglet` constant, the in-place-mutation pattern and the test seam. The planner should resist adding abstractions beyond the pure planner + thin wrapper.

## Runtime State Inventory

This phase is not a rename, but it changes how an existing database is interpreted, so the inventory is answered explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Johan's running devrandom org (`--org-schema devrandom`, port 8180): two custom objects with records under `a00`/`a01` from the alphabetical scheme (CONTEXT §Specifics). Any other existing orglet DB has the same shape. | **Data-derived seeding (D-08 tier 1), not a migration script**: first `up` after upgrade scans each custom table once and inserts the rows it finds. Expected log: exactly two `assigned key prefix ... from existing records` lines for devrandom. No manual step. |
| Live service config | None — orglet has no external services; `docker-compose.yml` only runs Postgres. | none |
| OS-registered state | None — verified: no launchd/systemd/pm2 artefacts in repo; CLI is run by hand. | none |
| Secrets/env vars | `ORGLET_DATABASE_URL`, `ORGLET_PG_PORT`, `PORT`, `ORGLET_EVENTS` — none reference prefixes. | none |
| Build artifacts | `packages/*/dist` from `tsc -b` — rebuilt by `pnpm build`; no installed global binary (`bin.orglet` is only linked in the workspace). CI runs `pnpm build` before lint/test. | run `pnpm build` locally before `node packages/cli/dist/index.js up` |

## Common Pitfalls

### Pitfall 1: Single-pass assignment turns a PREFIX-02 upgrade into a false collision
**What goes wrong:** New object sorting first takes provisional `a00`; then an existing object's rows carrying `a00` are read and the planner reports a collision — or worse, with reversed checks, assigns the existing object a *new* prefix, breaking every stored Id.
**Why it happens:** Mixing tiers 1–2 (facts) and tiers 3–4 (choices) in one loop.
**How to avoid:** Two passes in `planKeyPrefixes` (Pattern 1). Test: org with `BigTable__c`/`Milestone__c`/`Project__c` rows at `a00`/`a01`/`a02`, then load a schema that adds `Aardvark__c` (provisional now `a00`, shifting others to `a01`..`a03`); expect persisted `a00/a01/a02` kept from records and `Aardvark__c = a03` (next-free; its provisional `a00` is taken).
**Warning signs:** a test that only ever adds objects sorting *after* existing ones passes while the "sorts before A" case fails.

### Pitfall 2: Recompute-then-persist (Pitfall 8 from PITFALLS.md)
**What goes wrong:** Second build with a changed object set rewrites or re-derives prefixes for existing names.
**How to avoid:** The planner never emits an assignment for a name in `persisted`; the mutate step uses persisted values first. The two-build drift test is the gate (§Validation Architecture, T1).

### Pitfall 3: `IF NOT EXISTS` DDL racing on the shared CI Postgres
**What goes wrong:** Two parallel vitest workers (or two `orglet up` processes) hit `CREATE SCHEMA IF NOT EXISTS "_orglet"` at once; one fails with a `pg_namespace`/`pg_type` unique violation (23505) → flaky `test-postgres` job.
**How to avoid:** constant advisory lock inside `ensureInternalSchema` before the DDL (Pattern 4); per-org lock after. Both inside the same transaction. Confidence MEDIUM on how often it bites; cost of prevention is one line.

### Pitfall 4: Scanning a table that does not exist yet
**What goes wrong:** Reconcile runs before `migrate()` on a fresh org; `SELECT ... FROM org.project__c` raises 42P01 and the whole `up` fails.
**How to avoid:** One `information_schema.tables WHERE table_schema = $1` query first; scan only intersection(custom objects without row, existing tables). Table names must go through `tableName(obj)` (lower-case + 63-byte hashing) to match what `migrate()` created.

### Pitfall 5: `_orglet` rows leaking between test files on real Postgres
**What goes wrong:** On pglite each file has its own instance, so `_orglet` is naturally isolated. On the CI `test-postgres` job the service container is shared by all files; `afterAll` drops `test_<hex>` but leaves `_orglet.key_prefixes` rows for that schema. Harmless for correctness (rows are keyed by the random schema and never match again) but accumulates garbage and would confuse any future "list all orgs" query.
**How to avoid:** every test file that calls `reconcileKeyPrefixes` also calls `await dropKeyPrefixes(pool, orgSchema)` in `afterAll` before dropping the schema. Recommend yes, for the new/changed files only (`prefixes.test.ts`, `api.test.ts`); the other DB tests never create rows.

### Pitfall 6: `pg` returns `rowCount: number | null`
**What goes wrong:** `exactOptionalPropertyTypes`/strict null checks reject `res.rowCount` as a `number`.
**How to avoid:** `res.rowCount ?? 0` in `dropKeyPrefixes`.

### Pitfall 7: `exactOptionalPropertyTypes` and option bags
**What goes wrong:** `reconcileKeyPrefixes(pool, schema, { orgSchema, mapping: maybeUndefined })` fails to compile when `mapping` is `Record<string,string> | undefined`.
**How to avoid:** build the options object conditionally (`...(mapping ? { mapping } : {})`), the same idiom `fromSourceObject` uses for `sharingModel` (build.ts:389).

### Pitfall 8: Forgetting to end the pool on the error path
**What goes wrong:** `up()` currently `return 1` on Postgres-unreachable without `pool.end()`; the process exits via `index.ts` `process.exit(code)` so it does not hang. The new `KeyPrefixError` path can follow the same pattern, but if the planner adds a `pool.end()` it must be `await`ed before `return 1`, or the test for `up` (if any) would hang. Keep it symmetrical with the existing branch.

### Pitfall 9: Node version in the shell
**What goes wrong:** The developer shell's default nvm Node is **18.20.8**; `pnpm` is only on the Node 22 path. `pnpm test`/`tsx` fail with odd syntax errors under Node 18.
**How to avoid:** `nvm use` (reads `.nvmrc` = 22) before any command in this phase. Verified during research.

## Code Examples

### Existing `up()` insertion point (current code, `packages/cli/src/main.ts` lines 66–77)
```typescript
  const pool = createPool(c.db);
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    console.error(`cannot reach Postgres at ${c.db}: ${(err as Error).message}`);
    console.error("start one with: docker compose up -d postgres   (or pass --db)");
    return 1;
  }
  // >>> INSERT HERE: reconcileKeyPrefixes + KeyPrefixError catch + D-16 log lines  <<<
  const migration = await migrate(pool, loaded.schema, { orgSchema: c.orgSchema, force });
```

### Recommended new block in `up()`
```typescript
  let prefixes: ReconcileKeyPrefixesResult;
  try {
    prefixes = await reconcileKeyPrefixes(pool, loaded.schema, { orgSchema: c.orgSchema, ...(mapping ? { mapping } : {}) });
  } catch (err) {
    if (!(err instanceof KeyPrefixError)) throw err;
    console.error(`error: ${err.message}`);
    console.error("fix the conflicting --key-prefixes entry, or remove stale rows with: orglet reset --drop-prefixes   (drops the org's records too)");
    return 1;
  }
  for (const w of prefixes.warnings) console.warn(`warning: ${w}`);
  for (const a of prefixes.assignments) log(c, `assigned key prefix ${a.keyPrefix} to ${a.objectName}${sourceSuffix(a.source)}`);
```
with `sourceSuffix` mapping `"records"` → `" from existing records"`, `"mapping"` → `" from --key-prefixes"`, `"provisional"`/`"next-free"` → `""` (D-16 wording is Claude's discretion; keep it on one line each).

`up()`'s signature gains one parameter (`mapping: Record<string, string> | undefined`) or, cleaner, `main()` reads and parses the file and passes it in; `main()` already builds `auth` and `port` from `values` the same way.

### `check()` (current, lines 56–63) and the D-15 addition
```typescript
async function check(c: Common): Promise<number> {
  const result = await loadOrgSchema(c.project ? { projectDir: c.project } : {});
  const objects = result.schema.list();
  log(c, `${objects.length} objects (${objects.filter((o) => o.custom).length} custom), ${objects.reduce((n, o) => n + o.fields.length, 0)} fields`);
  // D-15: one line per custom object, then one closing line. list() already sorts custom objects by name.
  for (const o of objects.filter((o) => o.custom)) log(c, `  ${o.name}  ${o.keyPrefix}  (provisional)`);
  if (objects.some((o) => o.custom)) log(c, "custom-object key prefixes are provisional here; `orglet up` assigns them once and reads them from the database thereafter");
  for (const w of result.warnings) console.warn(`warning: ${w}`);
  ...
```

### `reset()` (current, lines 118–127) and the D-07 addition
```typescript
async function reset(c: Common, dropPrefixes: boolean): Promise<number> {
  const pool = createPool(c.db);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${quote(c.orgSchema)} CASCADE`);
    log(c, `dropped schema "${c.orgSchema}"`);
    if (dropPrefixes) {
      const n = await dropKeyPrefixes(pool, c.orgSchema);
      log(c, `dropped ${n} key prefix assignment(s) for schema "${c.orgSchema}"`);
    }
    return 0;
  } finally {
    await pool.end();
  }
}
```

### `parseArgs` options block (current, lines 130–145) — two additions
```typescript
    options: {
      project: { type: "string" },
      port: { type: "string" },
      db: { type: "string" },
      "org-schema": { type: "string" },
      force: { type: "boolean" },
      import: { type: "boolean" },
      users: { type: "string" },
      "key-prefixes": { type: "string" },   // NEW (D-11)
      "drop-prefixes": { type: "boolean" }, // NEW (D-17)
      quiet: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
```
`USAGE` (lines 16–33) and the file header comment (lines 1–7) list every option; add `--key-prefixes <file>` under `up` and `--drop-prefixes` under `reset` in both.

### Verified SQL (all executed on pglite 0.5.8 via `pg` during research)
```sql
SELECT pg_advisory_xact_lock(hashtext($1));                 -- single-key form, in and outside a txn
SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2));    -- two-key form (namespace, org schema)
CREATE SCHEMA IF NOT EXISTS "_orglet";                        -- twice in one txn: OK
CREATE TABLE IF NOT EXISTS "_orglet"."key_prefixes" (...);   -- twice in one txn: OK
SELECT DISTINCT left(id, 3) AS p FROM "test_abc"."project__c";            -- includes isdeleted=true rows (no WHERE)
SELECT table_name FROM information_schema.tables WHERE table_schema = $1; -- works for org schema and for '_orglet'
SELECT to_regclass($1)::text AS t;                           -- NULL for a missing relation
DELETE FROM "_orglet"."key_prefixes" WHERE org_schema = $1;
```
Note: `pg_advisory_xact_lock(int, int)` requires `int4`; `hashtext()` returns `int4`, so no cast is needed. Postgres 16 has identical semantics for all of the above (HIGH confidence; all are long-standing core functions).

### Two-build drift test fixture without a second directory on disk
`readSourceProject(ACME)` returns a plain `SourceProject`; `buildOrgSchema(baseline, project)` is exported and pure. A second build with an extra object needs only:
```typescript
import { buildOrgSchema, loadBaseline, readSourceProject, type SourceObject } from "@orglet/metadata";
const baseline = await loadBaseline();
const project = await readSourceProject(ACME);
const aardvark: SourceObject = { name: "Aardvark__c", fields: [], validationRules: [], recordTypes: [] }; // minimal; label/nameField default (build.ts:342-345, 378)
const first = buildOrgSchema(baseline, project).schema;                                                   // BigTable a00, Milestone a01, Project a02, UpsertTable a03
const second = buildOrgSchema(baseline, { ...project, objects: [...project.objects, aardvark] }).schema;  // Aardvark a00, BigTable a01, ... (provisional shift)
const removed = buildOrgSchema(baseline, { ...project, objects: project.objects.filter((o) => o.name !== "BigTable__c") }).schema; // Milestone a00, Project a01, ...
```
`fromSourceObject` handles the minimal object: `hasOwner` true (no MasterDetail), label defaults to the name minus `__c`, Name field defaults to Text. `migrate.test.ts` lines 85–100 show the alternative of cloning `schema.objects` into a new `OrgSchemaImpl`; prefer `buildOrgSchema` here because the test must prove behaviour against *real* provisional shifting. Reconciling `second` against the same `orgSchema` after `first` is exactly Pitfall 8's two-build case. (`examples/acme` has four custom objects: `BigTable__c`, `Milestone__c`, `Project__c`, `UpsertTable__c`; the existing build test asserts only the first three.)

### Pre-seeding rows for the PREFIX-02 case
Simplest: `migrate(pool, first, { orgSchema })`, then `INSERT INTO "<org>"."bigtable__c" (id, isdeleted, createddate, ...)` — the system columns are `NOT NULL` (`SYSTEM_NOT_NULL` in columns.ts), so insert via `bootstrapOrg` + `DmlEngine.insert` instead (as `engine.test.ts` does), which also proves the rows carry the provisional prefix. Then `reconcileKeyPrefixes` with the *same* schema must report `source: "records"` for those objects and write identical values. For "two different prefixes in one table" (D-09), insert one row with `DmlEngine` and one raw row with a hand-built Id (`toCaseSafeId("a0Z00000000000A")` style — `toCaseSafeId` is exported) and only the NOT NULL system columns.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `customKeyPrefix(i)` by alphabetical index, recomputed each build (build.ts:400–424) | Same function kept as the *provisional* source; truth moves to `_orglet.key_prefixes` | this phase | `orglet check` output must say "provisional"; `build.test.ts` title/comment updated, assertions unchanged |
| `INTERNAL_SCHEMA = "_orglet"` reserved but unused | First consumer (`ensureInternalSchema` + `key_prefixes`) | this phase | Phase 6 Bulk tables reuse the helper |
| STATE.md: "persist inside the org's own schema so reset clears them" | D-01: sibling schema, survives reset | CONTEXT 2026-10-01 | planner must not follow STATE.md's wording |

**Deprecated/outdated:** nothing in the toolchain; pglite 0.5.8 (reports PostgreSQL 18.3) and Postgres 16 both support every statement used.

## Open Questions

1. **Standard-prefix label in `KeyPrefixError.claims`**
   - What we know: D-18 wants both object names and both prefixes; standard objects have no row.
   - What's unclear: whether `KeyPrefixSource` needs a `"standard"` member.
   - Recommendation: add `"standard"` to the union; the message reads `key prefix 001 for Foo__c (from --key-prefixes) collides with standard object Account (001)`. Cheap and unambiguous.

2. **Mapping entry contradicting an existing persisted row for the same object**
   - What we know: D-11 says the mapping is consulted only for objects without a row and can never override.
   - Recommendation (above): warning, not error, not silent. Planner may choose error if it prefers strictness; either is within D-11.

3. **`sf` recipe wording in README**
   - What we know: `sf sobject describe --sobject <Name> --json` exists (verified against the locally installed `@salesforce/cli` 2.150.6 help text; `--target-org` is required unless configured); the JSON has `.result.keyPrefix`.
   - Recommendation: document `sf sobject describe --sobject Foo__c --json | jq -r '.result.keyPrefix'` as the manual recipe (MEDIUM confidence on the exact JSON path; it is the standard `sf --json` envelope).

4. **Concurrency test for D-05**
   - What we know: pglite-socket serialises connections, so two concurrent `reconcileKeyPrefixes` calls cannot be observed interleaving on pglite; `pglite-compat.test.ts` already skips its concurrency test with `skip(usingPglite, ...)`.
   - Recommendation: one Postgres-only test (`Promise.all` of two reconciles on a fresh org → identical rows, no 23505) using the same skip; it is a nice-to-have, not a PREFIX-0x gate. The lock ordering is the real protection and is verified by code review.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 22 | everything (`engines >=22`) | ✓ via `nvm use` (shell default is 18.20.8 — see Pitfall 9) | 22.23.3 | — |
| pnpm | scripts | ✓ (on the Node 22 nvm path only) | 12.6.0 | `corepack pnpm` |
| pglite + pglite-socket | `pnpm test` default backend | ✓ | 0.5.8 / 0.2.11 | — |
| Docker / Postgres 16 | `orglet up` manual verification, `ORGLET_DATABASE_URL` test run | ✓ Docker Engine 29.7.2 running | postgres:16-alpine via `pnpm db:up` | pglite for tests |
| `sf` CLI | README recipe only (user's job, D-11) | ✓ locally | 2.150.6 | not needed by orglet |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none.

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json`.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.7, single root `vitest.config.ts` (`@orglet/*` aliased to `src/index.ts`, `testTimeout` 30 s, `hookTimeout` 60 s) |
| Config file | `vitest.config.ts` (exists); DB seam `test/db.ts` (exists) |
| Quick run command | `pnpm vitest run packages/schema/src/prefixes.test.ts` |
| Full suite command | `pnpm test` (pglite) and `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` (real Postgres, after `pnpm db:up`) |
| Also required | `pnpm build && pnpm lint` (type-aware ESLint covers `packages/*/src` incl. new tests via `tsconfig.test.json`; `consistent-type-imports` is an error) |

### Test files to add or change

| File | Backend | Purpose |
|------|---------|---------|
| `packages/schema/src/prefixes.test.ts` (NEW) | pure `describe` blocks (planner, mapping parser) + DB-backed `describe` (reconcile, drop) in one file, standard `openTestDb`/`test_<hex>`/`afterAll` pattern plus `dropKeyPrefixes` in `afterAll` | the phase's main suite; T1 is the gate |
| `packages/metadata/src/build.test.ts` (CHANGE) | pure | retitle the existing test "assigns provisional custom key prefixes in name order"; assertions unchanged (documents tier 3) |
| `packages/cli/src/main.test.ts` (NEW, first CLI test) | pure (no DB: `check` never connects) | `main(["check", "--project", ACME])` with `vi.spyOn(console, "log")`; assert a `Project__c  a02  (provisional)` line and the closing sentence; assert `--quiet` suppresses them |
| `packages/api/src/api.test.ts` (CHANGE) | DB | in `beforeAll`, before `migrate`: `await reconcileKeyPrefixes(pool, schema, { orgSchema, mapping: { Project__c: "a0Z" } })`; add one `it`: global describe shows `Project__c` with `keyPrefix: "a0Z"` and an inserted `Project__c` Id starts with `a0Z`; `afterAll` adds `dropKeyPrefixes` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PREFIX-01 | **T1 (gate, Pitfall 8):** reconcile `first` (acme) → record 4 rows; reconcile `second` (+`Aardvark__c`, provisional shift) → BigTable/Milestone/Project/UpsertTable unchanged, Aardvark = `a04` (next free; its provisional `a00` is taken), 1 assignment logged; reconcile `second` again → 0 assignments (silent) | integration (pglite/Postgres) | `pnpm vitest run packages/schema/src/prefixes.test.ts -t "two-build"` | ❌ Wave 0 |
| PREFIX-01 | **T2 removal:** reconcile `removed` (no BigTable) → remaining three unchanged, BigTable row still present (D-13); reconcile `first` again → BigTable gets `a00` back, 0 new rows | integration | same file `-t "removal"` | ❌ Wave 0 |
| PREFIX-01 | **T3 rename:** `Project__c` removed + `Projekt__c` added → `Projekt__c` gets next free, `Project__c` row kept (D-14) | integration | same file `-t "rename"` | ❌ Wave 0 |
| PREFIX-02 | **T4 upgrade:** migrate + bootstrap + `DmlEngine.insert` rows into BigTable/Milestone (prefixes a00/a01 from provisional) with **no** prior rows in `_orglet`; reconcile → sources `records` for those two, `provisional` for the rest; values equal the old scheme; Ids of inserted rows still validate on a later update | integration | same file `-t "existing records"` | ❌ Wave 0 |
| PREFIX-02 | **T5 upgrade + newcomer (Pitfall 1):** as T4 then reconcile `second` → records win (`a00`/`a01` kept), Aardvark gets next free, no error | integration | same file `-t "sorts before"` | ❌ Wave 0 |
| PREFIX-03 | **T6 planner collisions (pure):** (a) mapping prefix = standard prefix `001` → `KeyPrefixError` naming `Account`; (b) mapping prefix = another object's persisted prefix → error naming both objects; (c) table rows with two prefixes → error; (d) mapping differs from rows → error; (e) two mapping keys same prefix → error; (f) provisional taken by persisted row → falls to next free, no error | unit | same file `-t "planKeyPrefixes"` | ❌ Wave 0 |
| PREFIX-03 | **T7 DB collision leaves nothing written:** reconcile with a colliding mapping on a fresh org → rejects with `KeyPrefixError`; `SELECT count(*) FROM _orglet.key_prefixes WHERE org_schema=$1` is 0 | integration | same file `-t "nothing written"` | ❌ Wave 0 |
| PREFIX-03/D-11 | **T8 mapping parser (pure):** rejects non-object, non-3-char, non-alphanumeric, unknown object, standard object; canonicalises casing (`project__c` → `Project__c`) | unit | same file `-t "parseKeyPrefixMapping"` | ❌ Wave 0 |
| PREFIX-04 | **T9 `check` output:** provisional lines + closing sentence; `--quiet` prints nothing | unit (console spy) | `pnpm vitest run packages/cli/src/main.test.ts` | ❌ Wave 0 |
| PREFIX-04 | **T10 reset semantics:** after reconcile, `DROP SCHEMA <org> CASCADE` leaves rows (count unchanged); `dropKeyPrefixes(pool, org)` returns n and leaves another org's rows intact; `dropKeyPrefixes` on a DB with no table returns 0 | integration | `prefixes.test.ts -t "drop"` | ❌ Wave 0 |
| PREFIX-01 (API-level) | **T11 describe shows persisted prefix:** `/sobjects` global describe `Project__c.keyPrefix === "a0Z"` after mapping seed | integration | `pnpm vitest run packages/api/src/api.test.ts -t "describe"` | ✅ file exists, assertion added |
| D-05 | **T12 concurrency (optional):** two concurrent reconciles on a fresh org → identical rows, no 23505; `skip(usingPglite, "...")` | integration, Postgres-only | `ORGLET_DATABASE_URL=... pnpm vitest run packages/schema/src/prefixes.test.ts -t "concurrent"` | ❌ optional |

pglite vs Postgres: T1–T11 run on both backends unchanged (every statement verified on pglite 0.5.8). Only T12 is Postgres-only, via the phase-1 `skip(usingPglite, reason)` mechanism.

### Sampling Rate
- **Per task commit:** `pnpm vitest run packages/schema/src/prefixes.test.ts packages/cli/src/main.test.ts` (+ `pnpm lint` after CLI edits)
- **Per wave merge:** `pnpm build && pnpm lint && pnpm test`, then `pnpm db:up && ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test`
- **Phase gate:** both CI jobs (`test-pglite`, `test-postgres`) green on the phase branch `gsd/phase-02-custom-object-key-prefix-persistence` (already checked out); plus a manual `node packages/cli/dist/index.js up --project examples/acme` twice against Docker Postgres showing 4 assignment lines then silence, and `orglet check --project examples/acme` showing the provisional lines.

### Wave 0 Gaps
- [ ] `packages/schema/src/prefixes.test.ts` — T1–T8, T10, T12
- [ ] `packages/cli/src/main.test.ts` — T9 (first test in `packages/cli`; vitest glob `packages/*/src/**/*.test.ts` and `tsconfig.test.json` already cover it; `packages/cli/tsconfig.json` already excludes `src/**/*.test.ts` from the build)
- [ ] No framework install, no new fixtures on disk (second schema built in memory via `buildOrgSchema`)

## Answers to the planner's concrete questions

**Q1 — `main.ts` exact structure.** 156 lines. `USAGE` lines 16–33; `Common`/`common()` 35–49 (`db` default `postgres://orglet:orglet@localhost:5433/orglet`, `orgSchema` default `DEFAULT_ORG_SCHEMA`, `quiet`, optional `project`); `log(c, ...args)` 51–53; `check()` 55–62; `up(c, port, force, auth, importMode)` 64–116 with `SELECT 1` try/catch at 68–74 and `migrate` at 75; `reset(c)` 118–127; `main(argv)` 129–156 with `parseArgs` options 130–145 and the `switch` 149–156. `up` returns `-1` to keep running; `index.ts` only `process.exit`s for `code >= 0`. Insert the reconcile block between line 74 (`}` closing the catch) and 75. Add `KeyPrefixError`, `reconcileKeyPrefixes`, `dropKeyPrefixes`, `parseKeyPrefixMapping` to the `@orglet/schema` import on line 11; add `import { readFile } from "node:fs/promises"`.

**Q2 — `migrate()` transaction structure.** `withTransaction(pool, async (client) => { const run = async (sql) => { statements.push(sql); await client.query(sql); }; ... })`. Table discovery is via `information_schema.columns WHERE table_schema = $1` (grouped into a `Map<table, Map<column>>`), and `pglite-compat.test.ts` line 54 uses `information_schema.tables WHERE table_schema = $1` — use the latter for the prefix module (only table names are needed). Match table names against `tableName(obj)` (lower-cased API name, 63-byte-safe). `migrate.ts` has no `run`-style helper to import; the module-local closure is the house style, so write the same 3-line helper or just call `client.query` directly (the prefix module has no "statements executed" result to collect).

**Q3 — Postgres/pglite specifics.** All verified live on pglite 0.5.8 via `pg` (see §Code Examples "Verified SQL"): `hashtext`, both `pg_advisory_xact_lock` arities, `CREATE SCHEMA/TABLE IF NOT EXISTS` repeated inside a transaction, `char(3)` returning exactly `"a02"` (`pg_typeof` = `character`, `length` = 3), `UNIQUE` → 23505, `left(id,3)`, `information_schema.tables`, `to_regclass`, `DELETE ... WHERE org_schema=$1`. `test/db.ts` drives pglite via `PGlite.create()` + `PGLiteSocketServer({ port: 0, maxConnections: 10 })` and a normal `pg.Pool` — the production SQL path is identical. The one pglite limitation (single query queue across connections) only affects a true concurrency test (T12).

**Q4 — `keyPrefix` consumers.** `OrgSchemaImpl` (schema.ts) builds `fieldIndex` and `children` in its constructor; **no prefix index**. Consumers, all reading `obj.keyPrefix`/`t.keyPrefix` at call time: `engine.ts` 302 (`prepareInsert` Id check), 337 (`attachOld`), 358 (`generateId(obj.keyPrefix)` in `saveBatch`), 497 (`checkReferences` polymorphic target match); `bootstrap.ts` 48–50 and 92 (`generateId`); `api/src/describe.ts` 196 (`objectSummary`); `api/src/routes/composite.ts` 102 (collection delete routing). `soql` and `formula` packages: **zero** references (grep of `packages/*/src`). `DmlEngine`'s constructor (engine.ts 68–78) builds `Store` and `FormulaRegistry` from the schema but neither reads prefixes. Conclusion: in-place mutation before `bootstrapOrg`/`new DmlEngine` is safe; even mutation afterwards would be seen, but D-04's ordering is still the right contract.

**Q5 — `buildOrgSchema` loop and fixture.** build.ts 400–407 `customKeyPrefix(index)` (doc comment to update, D-15); 421–424 `customObjects.filter(isCustomObjectName).sort(localeCompare).forEach((o,i) => objects.set(..., fromSourceObject(o, customKeyPrefix(i), sets)))`. `isCustomObjectName` = `/__c$/i`. Existing test build.test.ts 71–75 asserts BigTable `a00`, Milestone `a01`, Project `a02` (UpsertTable `a03` is unasserted). A second schema needs **no second fixture dir**: `buildOrgSchema(await loadBaseline(), { ...await readSourceProject(ACME), objects: [...] })` — `loadBaseline`, `readSourceProject`, `buildOrgSchema`, `SourceObject` are all exported from `@orglet/metadata` (index.ts). A minimal `SourceObject` is `{ name, fields: [], validationRules: [], recordTypes: [] }`.

**Q6 — DB test pattern.** All six DB-backed files: `const orgSchema = \`test_${randomBytes(4).toString("hex")}\``; `beforeAll`: `testDb = await openTestDb(); pool = testDb.pool; schema = (await loadOrgSchema({ projectDir: ACME })).schema; await migrate(pool, schema, { orgSchema }); ...`; `afterAll`: `DROP SCHEMA IF EXISTS ${quote(orgSchema)} CASCADE; await testDb.close()`. Import path for the helper from `packages/schema/src`: `"../../../test/db.js"`. `_orglet` rows keyed by the random schema never collide between files; on real Postgres they outlive the file, so **yes**: call `dropKeyPrefixes(pool, orgSchema)` in `afterAll` of every file that reconciles (Pitfall 5).

**Q7 — describe surface.** `packages/api/src/describe.ts` line 196 `keyPrefix: obj.keyPrefix` inside `objectSummary(obj, version)`, used by both global describe (`GET /services/data/vXX.X/sobjects` → `sobjects[]`) and per-object describe. `api.test.ts` line 134 already asserts `Account.keyPrefix === "001"` from the global describe — mirror that assertion for `Project__c` after seeding (T11).

**Q8 — CLI testability.** No test exists for `packages/cli` (TESTING.md confirms). `main()` is already exported and `check` is DB-free, so the minimal seam is **no new seam**: a `main.test.ts` that calls `main(["check", "--project", ACME])` with `vi.spyOn(console, "log").mockImplementation(() => {})` and inspects the calls. `up` (listens on a port, process signal handlers) and `reset` are not unit-tested; their DB logic lives in `reconcileKeyPrefixes`/`dropKeyPrefixes` which are tested directly. Do not spawn the CLI.

**Q9 — Mapping-file parsing.** Pattern 5: CLI does `readFile` + `JSON.parse`; `@orglet/schema` exports pure `parseKeyPrefixMapping(raw: unknown, schema: OrgSchema): Record<string, string>` that validates shape, `/^[0-9A-Za-z]{3}$/`, object exists **and is custom** (error, not warning), duplicate prefixes within the file (error), and canonicalises key casing. `@orglet/schema` stays fs-free (only `node:crypto` today), matching conventions.

**Q10 — README structure.** Sections in order: title + CI badge, intro + trademark notice, `## Status` (milestone table), `## Quick start`, `## Layout`, `## Development`, `## License`. There is no CLI reference section. Add `## Custom-object key prefixes` immediately after `## Quick start` (it is a user-facing behaviour of `up`/`check`/`reset`), containing: how prefixes are assigned and stored (`_orglet.key_prefixes`, survives `reset`), that `orglet check` shows provisional values, `orglet reset --drop-prefixes`, and the `--key-prefixes <file>` JSON format with the `sf sobject describe --sobject Foo__c --json` recipe and a one-line note that orglet never connects to Salesforce. (Separately, `## Layout` still says `orglet up / reload / reset` — pre-existing drift; leave it unless the planner wants a one-word fix in the same README task.)

## Project Constraints (from CLAUDE.md)

- TypeScript strict with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` (Pitfall 7), `verbatimModuleSyntax`; relative imports carry `.js`; cross-package imports only via `@orglet/*` and only what `src/index.ts` exports (new exports: `reconcileKeyPrefixes`, `dropKeyPrefixes`, `parseKeyPrefixMapping`, `planKeyPrefixes`, `KeyPrefixError`, `ensureInternalSchema` as values; `KeyPrefixAssignment`, `KeyPrefixClaim`, `KeyPrefixSource`, `ReconcileKeyPrefixesOptions`, `ReconcileKeyPrefixesResult`, `KeyPrefixPlanInput` as types, on separate `export type` lines).
- `consistent-type-imports` is an ESLint error; `no-unused-vars` except `_`-prefixed. No Prettier; long lines are fine when they keep one logical unit together; `.editorconfig` 2-space, LF, final newline.
- File header: every new source file opens with a `/** ... */` block saying why it exists; comments reserved for Salesforce-specific reasoning.
- Errors: named `Error` subclass with machine-readable data (`KeyPrefixError` with `claims`), thrown for whole-operation aborts; library packages (`schema`) never `console.*` — they return `warnings: string[]` and throw; the CLI prints `warning: ` lines and `error: ` + hint lines. `UNSUPPORTED:<area>` is only for deliberately unimplemented features — **not** for prefix conflicts.
- Only Level 1 data; `examples/acme` is the only fixture; no Tele2 metadata.
- Git: repo-local identity `Johan Karlsteen <johan@karlsteen.com>` is set (verified `git config user.email`); work on branch `gsd/phase-02-custom-object-key-prefix-persistence` (checked out); commits imperative English; PR to `main` requires both CI checks.
- GSD workflow: edits happen via `/gsd:execute-phase`.
- Conformance suites must stay green: they do not reference custom prefixes (grep of `conformance/` found none), and `seed.mjs` creates records through the API, so persisted prefixes are transparent to them.

## Sources

### Primary (HIGH confidence)
- Direct reads (2026-10-01): `packages/cli/src/main.ts`, `packages/schema/src/{migrate,columns,ids,db,index,pglite-compat.test,migrate.test}.ts`, `packages/metadata/src/{schema,build,build.test,index,types,sfdx}.ts`, `packages/engine/src/{engine,bootstrap,engine.test}.ts`, `packages/api/src/{describe,api.test}.ts`, `packages/api/src/routes/composite.ts`, `test/db.ts`, `vitest.config.ts`, `tsconfig.test.json`, `eslint.config.js`, `.github/workflows/ci.yml`, `README.md`, `packages/metadata/standard/objects/*.json` (21 standard prefixes, all digit-initial).
- Live probe on pglite 0.5.8 + pglite-socket 0.2.11 + pg 8.23.0 + Node 22.23.3 (script run from a throw-away dir under `node_modules/.cache`, removed afterwards; `git status` clean): every statement in §Code Examples "Verified SQL".
- `.planning/phases/02-.../02-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/research/ARCHITECTURE.md` §Feature 3, `.planning/research/PITFALLS.md` §Pitfall 8–9, `.planning/phases/01-.../01-CONTEXT.md`, `.planning/codebase/{TESTING,CONVENTIONS}.md`.

### Secondary (MEDIUM confidence)
- `sf sobject describe --help` from the locally installed `@salesforce/cli` 2.150.6: flags `--sobject/-s` (required), `--target-org/-o`, `--json`. JSON path `.result.keyPrefix` inferred from the standard `sf --json` envelope, not executed against an org (and must not be — no org access in this project).
- Postgres `CREATE ... IF NOT EXISTS` not being safe under concurrent sessions: long-standing community knowledge (pgsql-hackers/-general threads); not re-verified against a live race during this research. The constant advisory lock is recommended as cheap insurance regardless.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; versions read from the lockfile and `node_modules`.
- Architecture: HIGH — every integration point and consumer verified by reading current source; SQL verified by execution on the test backend; Postgres 16 parity for these core functions is not in doubt.
- Pitfalls: HIGH for 1, 2, 4–9 (derived from code/tests); MEDIUM for 3 (IF NOT EXISTS race frequency).

**Research date:** 2026-10-01
**Valid until:** 2026-10-31 (stable domain; re-check only if pglite/pg versions bump or `main.ts` changes before planning)
