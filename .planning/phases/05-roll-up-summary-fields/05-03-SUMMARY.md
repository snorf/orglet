---
phase: 05-roll-up-summary-fields
plan: 03
subsystem: database
tags: [salesforce, rollup, postgres, sql, migrate, pglite, vitest]

requires:
  - phase: 05-roll-up-summary-fields (plans 01, 02)
    provides: FieldDef.rollup (childObject, foreignKey, summarizedField, operation, filters) with canonical names and typed values; resolved roll-ups as stored read-only columns
provides:
  - rollupSelectSql / rollupBackfillSql / rollupDepth in @orglet/schema (packages/schema/src/rollup.ts), pure SQL builders for every operation and filter shape the resolver admits
  - migrate() backfills newly added roll-up columns once, lower chain levels first, inside the migrate transaction (D-10)
  - Filter SQL semantics fixed (case-insensitive text, NULL-inclusive notEqual/notContain, blank handling, ILIKE escaping, valueField comparisons)
affects: [05-05 engine recompute, 05-06 SOQL/REST surface, 05-07 DE check]

tech-stack:
  added: []
  patterns:
    - "Roll-up aggregate as a correlated scalar subquery per field: COUNT(*) / COALESCE(SUM, 0) / plain MIN,MAX over `c.<fk> = p.id AND c.isdeleted = false AND <filters>`; same expression serves SELECT (engine) and UPDATE (backfill)"
    - "Every filter literal is a positional parameter with an explicit cast (`$n::numeric[]`, `$n::date`, `$n::boolean`, `$n::text[]`), identifiers only through quote/tableName/columnName"
    - "migrate step 3 (backfill) is the last step of the transaction: DML on a table must not precede DDL on the same table in one transaction when the table has deferred foreign keys"

key-files:
  created:
    - packages/schema/src/rollup.ts
    - packages/schema/src/rollup.test.ts
  modified:
    - packages/schema/src/index.ts
    - packages/schema/src/migrate.ts
    - packages/schema/src/migrate.test.ts

key-decisions:
  - "Backfill runs after step 2 (indexes/FKs), not between step 1 and 2 as planned: a second UPDATE of the same row in one transaction queues a deferred FK check and Postgres then refuses CREATE INDEX on that table (pending trigger events); reproduced on pglite and Postgres 16"
  - "Blank notEqual on text is `(col IS NOT NULL AND col <> '')`; blank equals on text is `(col IS NULL OR col = '')`; on other types IS NULL / IS NOT NULL"
  - "The builder's type family falls back to text for anything that is not Number/Currency/Percent/Date/DateTime/Checkbox; the resolver (05-02) already rejects everything else"
  - "ROLL-03 marked complete (aggregates and every documented operator incl. valueField computed over non-deleted children, executed on both backends); ROLL-06 and ROLL-08 withheld until the engine recompute (05-05) and SOQL surface (05-06) exist"

patterns-established:
  - "Pure SQL builder tests assert exact strings and parameter arrays (compile.test.ts style); one DB-backed integration test proves the SQL executes"

requirements-completed: [ROLL-03]  # plan frontmatter also lists ROLL-06, ROLL-08: withheld, see Next Phase Readiness

duration: 9 min
completed: 2026-10-09
---

# Phase 5 Plan 03: Roll-up SQL builder and migrate backfill Summary

**One pure SQL builder turns a roll-up FieldDef into a parameterised correlated aggregate (COUNT/SUM -> 0, MIN/MAX -> NULL on an empty child set) with every documented filter operator, and migrate() uses it to backfill newly added roll-up columns once, bottom-up through chains, proven on pglite and Postgres 16.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-10-09T07:31:22Z
- **Completed:** 2026-10-09T07:40:33Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- `rollupSelectSql(orgSchema, schema, parent, fields, parentIds)` builds the engine's recompute query (parent ids at `$1`, one aggregate per field aliased by API name); `rollupBackfillSql` builds the D-10 `UPDATE`; `rollupDepth` gives chain depth for ordering.
- Filter semantics per the plan: `lower(col) = ANY($n::text[])`, `col = ANY($n::numeric[]|date[]|timestamptz[])`, `col = $n::boolean`, ranges `col < $n::type`, `col ILIKE ANY($n::text[])` with `\`, `%`, `_` backslash-escaped, `notEqual`/`notContain` as `(col IS NULL OR NOT (...))`, blank as `IS NULL` (text also `= ''`), valueField as `col <op> other` / `lower(a) = lower(b)` / `IS DISTINCT FROM`.
- `migrate()` collects every column it adds whose FieldDef carries `rollup`, sorts by `rollupDepth` and runs the backfill as the final step of the transaction; a second `migrate()` runs no backfill; tables created in the same run are empty and untouched.
- Integration test over `Grand__c <- Parent__c <- Child__c` with seven parent roll-ups and one chained sum: 8 `UPDATE`s, `grand_total__c` after `total__c`, soft-deleted child excluded, `x_` matches `x_1` but not `xa`, empty parent gets 0/0/0/0/0/0/NULL.
- 16 pure tests + 2 DB tests added; full suite 296 passed / 2 skipped (pre-existing); the two schema files also pass against Docker Postgres 16 (`ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet`, 24 passed).

## Generated SQL (verbatim, COUNT + filtered SUM)

`rollupSelectSql("org", schema, Parent__c, [Child_Count__c, Open_Total__c], ["a01000000000001AAA"])` where `Open_Total__c` is SUM over `Child__c.Amount__c` with filters `Done__c equals False` and `Status__c equals "Open, Pending"`:

```sql
SELECT p."id" AS "Id", (SELECT COUNT(*) FROM "org"."child__c" c WHERE c."parent__c" = p."id" AND c."isdeleted" = false) AS "Child_Count__c", COALESCE((SELECT SUM(c."amount__c") FROM "org"."child__c" c WHERE c."parent__c" = p."id" AND c."isdeleted" = false AND c."done__c" = $2::boolean AND lower(c."status__c") = ANY($3::text[])), 0) AS "Open_Total__c" FROM "org"."parent__c" p WHERE p."id" = ANY($1) AND p."isdeleted" = false
```

```json
params: [["a01000000000001AAA"], false, ["open", "pending"]]
```

## Task Commits

1. **Task 1: pure roll-up SQL builder (select, backfill, chain depth)** - `1c4eb68` (feat)
2. **Task 2: migrate() backfills newly added roll-up columns once, bottom-up** - `ad9124e` (feat)

_TDD note: RED was run and observed for both tasks (missing module; then "expected [] to have a length of 8") before implementing; test and implementation were committed together because the environment requires green lint + tests for every commit (same as 05-01/05-02)._

## Files Created/Modified
- `packages/schema/src/rollup.ts` - `rollupSelectSql`, `rollupBackfillSql`, `rollupDepth`, `RollupStatement`; private `aggregate`, `filterSql`, `likeEscape`, `familyOf`
- `packages/schema/src/rollup.test.ts` - exact-string assertions for every operation/operator/type family, backfill shape, chain depth, non-roll-up throw
- `packages/schema/src/index.ts` - named exports for the three functions and the `RollupStatement` type
- `packages/schema/src/migrate.ts` - `run(sql, params?)`, `backfills` collection in step 1, new step 3 backfill, header sentence
- `packages/schema/src/migrate.test.ts` - `describe("roll-up backfill")` with in-memory three-object schema, plain-SQL row seeding via `generateId`, two tests

## Decisions Made
- Backfill is step 3, after indexes and foreign keys, instead of between step 1 and step 2 (see deviation 1). Ordering requirement "all columns exist" still holds.
- `familyOf` in the builder maps unknown types to `text` rather than throwing; the resolver already guarantees only the five families reach it, and text is the only family whose SQL is safe for an unexpected type.
- Kept one `UPDATE` per newly added column (plan shape, 8 statements asserted) rather than one `UPDATE` per table; simpler, and the deferred-FK issue is solved by placement, not by statement count.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Backfill moved to the end of the migrate transaction**
- **Found during:** Task 2 (migrate backfill)
- **Issue:** With the backfill between step 1 and step 2 as planned, `migrate()` failed on both pglite and Postgres 16 with `cannot CREATE INDEX "parent__c" because it has pending trigger events`. Root cause (verified with a psql experiment): one UPDATE on a table with a `DEFERRABLE INITIALLY DEFERRED` FK is fine, but the second UPDATE of the same row in one transaction sees an old tuple whose xmin is the current transaction, and `RI_FKey_fk_upd_check_required` then queues a deferred FK check regardless of key equality. Step 2's idempotent `CREATE INDEX IF NOT EXISTS` on that table is refused while events are pending.
- **Fix:** Backfill runs as step 3 after sequences/indexes/FKs; nothing follows it, and the queued checks fire (and pass) at commit. Comment in migrate.ts explains why the step must stay last.
- **Files modified:** packages/schema/src/migrate.ts
- **Verification:** `pnpm vitest run packages/schema/src` green on pglite; the same two files green on Docker Postgres 16
- **Committed in:** ad9124e

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Behaviour identical to the plan (same statements, same ordering between backfills, same transaction); only the position relative to step 2 changed.

## Issues Encountered
- Test helper initially passed `isdeleted` twice in the seeding INSERT (fixed in the helper before the real RED was observed).

## Known Stubs

None. The engine does not call `rollupSelectSql` yet; that is plan 05-05 by design.

## Requirements

- **ROLL-03** marked complete: COUNT/SUM/MIN/MAX with every documented operator (equals, notEqual, ranges, contains, notContain, startsWith, valueField) over non-deleted children, executed on both backends.
- **ROLL-06** withheld: the backfill orders chains bottom-up, but "recompute upward" on child DML is the engine (05-05).
- **ROLL-08** withheld: values are stored columns, but SOQL select/filter/sort of roll-ups is not exercised by any test yet (05-06).

## Next Phase Readiness

Ready for 05-04/05-05. The engine consumes `rollupSelectSql(orgSchema, schema, parentObj, rollupFields, parentIds)` and gets rows `{ Id, <FieldName>: number | string | null }` through the db.ts parsers; `rollupDepth` is available for ordering chained recomputes. Docker Postgres was up during this run, so the Postgres leg of the acceptance criteria was executed, not skipped.

## Self-Check: PASSED

Files present: rollup.ts, rollup.test.ts, index.ts, migrate.ts, migrate.test.ts. Commits present: 1c4eb68, ad9124e.
