# Phase 2: Custom-Object Key-Prefix Persistence - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-01
**Phase:** 02-custom-object-key-prefix-persistence
**Areas discussed:** Storage and reset semantics, Seeding on first upgrade, Retirement and rename, CLI surface (check/up/reset)

---

## Storage and reset semantics

### Where the prefix table lives

| Option | Description | Selected |
|--------|-------------|----------|
| Separate `_orglet` schema | `_orglet.key_prefixes` with `org_schema` in the key; survives `DROP SCHEMA org`; multi-org per DB works; matches research and REQUIREMENTS | ✓ |
| Table inside the org schema | e.g. `org._orglet_key_prefixes`; dropped by reset by construction; reset would need rewriting to satisfy PREFIX-04 | |
| One `_orglet` schema per org | `_orglet_org`, `_orglet_devrandom`; no column but schema naming and cleanup to manage | |

**User's choice:** Separate `_orglet` schema
**Notes:** Resolves the contradiction between STATE.md ("reset clears them by construction") and PREFIX-04 ("reset keeps assignments") in favour of PREFIX-04.

### When the persisted prefix is written

| Option | Description | Selected |
|--------|-------------|----------|
| In `orglet up`, before bootstrap | Reconciliation after connectivity check, before `bootstrapOrg`/`DmlEngine`; assign + INSERT in one transaction; `check` never touches DB | ✓ |
| Lazy at first Id generation | Written on first record insert; describe would show an unlocked prefix; DML path gains a DB write | |

**User's choice:** In `orglet up`, before bootstrap

### Reset handling for PREFIX-04

| Option | Description | Selected |
|--------|-------------|----------|
| Delete only that org's rows | `DELETE ... WHERE org_schema = $1` on the drop flag; other orgs untouched; `_orglet` schema left in place | ✓ |
| Also drop `_orglet` when empty | Same, plus drop the schema when no rows remain | |

**User's choice:** Delete only that org's rows

### Table scope

| Option | Description | Selected |
|--------|-------------|----------|
| Custom objects only | Standard prefixes stay as baseline constants; collision check compares against them each `up` | ✓ |
| All objects | Standard prefixes persisted too; UNIQUE catches collisions but table must track baseline changes | |

**User's choice:** Custom objects only

### Ownership of `_orglet` schema creation

| Option | Description | Selected |
|--------|-------------|----------|
| Small shared helper in `@orglet/schema` | `ensureInternalSchema`; prefix module calls it now, Bulk (phase 6) reuses it; each module owns its CREATE TABLE | ✓ |
| Inline in the prefix module | Least code now, refactor in phase 6 | |
| `migrate()` owns all of `_orglet` | One place for DDL but mixes org DDL with internal bookkeeping | |

**User's choice:** Small shared helper in `@orglet/schema`

### Concurrent `orglet up`

| Option | Description | Selected |
|--------|-------------|----------|
| Lock and redo | `pg_advisory_xact_lock` on the org schema inside the reconciliation transaction; second process waits and reads the first result | ✓ |
| Let the PK conflict fail | Unique violation aborts the second `up`; user restarts | |

**User's choice:** Lock and redo

### Mid-discussion addition: prefixes from an existing Salesforce org

Raised by the user ("it would be really cool to bring in prefixes from your existing org").
Tied to import mode: records from a real org carry that org's prefixes.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, minimal: a mapping file | `up --key-prefixes <file.json>` `{ "Foo__c": "a0X" }`; only for objects without a persisted row; collisions fail per PREFIX-03; no Salesforce connection; producing the file is the user's job, documented in README | ✓ |
| Yes, and read describe JSON directly | Also accept raw `sf sobject describe`/`list` output | |
| No, backlog | Defer to a later milestone | |

**User's choice:** Yes, minimal: a mapping file

---

## Seeding on first upgrade (PREFIX-02)

### Initial source for an existing org without a prefix table

| Option | Description | Selected |
|--------|-------------|----------|
| Data wins, alphabetical as fallback | Rows present: freeze `left(id,3)`; no rows: provisional alphabetical | ✓ |
| Alphabetical only | Run the old algorithm once and persist; wrong if the project changed since last `up` | |
| Data only, else error | Empty tables get a fresh prefix via normal assignment | |

**User's choice:** Data wins, alphabetical as fallback
**Notes:** Recorded precedence: persisted row > existing rows > mapping file > provisional alphabetical if free > lowest free.

### Conflicts between sources

| Option | Description | Selected |
|--------|-------------|----------|
| Error, abort `up` | Any contradiction is a hard error naming both values; nothing written | ✓ |
| Existing Ids win, warn | Rows win, file ignored for that object with a warning; mixed prefixes in one table still an error | |

**User's choice:** Error, abort `up`

### Depth of the data scan

| Option | Description | Selected |
|--------|-------------|----------|
| `SELECT DISTINCT left(id,3)` per table | Detects both the prefix and mixed prefixes; runs only for objects without a row | ✓ |
| `LIMIT 1` per table | Cheapest; misses mixed prefixes | |

**User's choice:** `SELECT DISTINCT left(id,3)` per table

---

## Retirement and rename

### Object removed from project, table kept

| Option | Description | Selected |
|--------|-------------|----------|
| Row kept untouched | Same prefix if the object returns; nobody else can take it | ✓ |
| Row deleted immediately | Prefix freed although the table with Ids remains | |

**User's choice:** Row kept untouched

### Table dropped with `--force`

| Option | Description | Selected |
|--------|-------------|----------|
| Row kept, never reused | Prefix permanent per object name until `reset --drop-prefixes`; like Salesforce | ✓ |
| Row dropped with the table | Prefix freed; recreated object gets a new one | |

**User's choice:** Row kept, never reused

### Next prefix for a new object

| Option | Description | Selected |
|--------|-------------|----------|
| Lowest free in `a00`..`azz` | Skip persisted rows and standard prefixes; deterministic | ✓ |
| Always highest + 1 | Strictly monotonic, never fills gaps | |

**User's choice:** Lowest free in `a00`..`azz`

### Rename

| Option | Description | Selected |
|--------|-------------|----------|
| No, new name = new prefix | `Old__c` keeps its row, `New__c` gets the next free; mapping file + removing the old row is the manual route | ✓ |
| Yes, `--rename Old__c=New__c` | Moves the row and renames the table; new capability, own phase | |

**User's choice:** No, new name = new prefix

---

## CLI surface (check/up/reset)

### `orglet check` output

| Option | Description | Selected |
|--------|-------------|----------|
| One line per custom object + explanation | e.g. `Project__c  a02  (provisional)` and a closing note that `up` assigns for real | ✓ |
| Single summary note | One line, no per-object prefixes | |
| All objects, standard and custom | Full list of 23+ objects | |

**User's choice:** One line per custom object + explanation

### `orglet up` logging

| Option | Description | Selected |
|--------|-------------|----------|
| Log only new assignments and seeding | `assigned key prefix a03 to Foo__c` with source; silent when all persisted; respects `--quiet` | ✓ |
| Always list all custom prefixes | Full mapping every `up` | |
| Silent | Visible via describe only | |

**User's choice:** Log only new assignments and seeding

### Reset flag name

| Option | Description | Selected |
|--------|-------------|----------|
| `--drop-prefixes` | Says exactly what happens | ✓ |
| `--all` | Shorter, unclear once Bulk tables join `_orglet` | |
| `--purge` | Generic, could grow to cover Bulk jobs | |

**User's choice:** `--drop-prefixes`

### Error presentation

| Option | Description | Selected |
|--------|-------------|----------|
| Clean message, exit 1, no stack | Dedicated error class caught in `main.ts`, `error: ...` plus a hint line; same pattern as Postgres-unreachable | ✓ |
| Throw `Error`, top-level prints stack | Least code; stack trace for a config error | |

**User's choice:** Clean message, exit 1, no stack

---

## Claude's Discretion

- File/export names in `@orglet/schema`; in-place mutation vs new schema; table column details;
  `migrate()` vs reconciliation order; test setup for the prefix table on pglite; exact wording
  of output, errors and README; mapping-file validation details.

## Deferred Ideas

- `--rename` flag with table rename in `migrate()`.
- Accepting raw `sf sobject describe`/`list` JSON as `--key-prefixes` input.
- Dropping `_orglet` when empty (revisit in phase 6).
