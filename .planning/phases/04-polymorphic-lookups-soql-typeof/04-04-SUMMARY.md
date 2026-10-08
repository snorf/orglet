---
phase: 04-polymorphic-lookups-soql-typeof
plan: 04
subsystem: soql
tags: [soql, polymorphic, name-object, owner-type, shape]
requires:
  - phase: 04-polymorphic-lookups-soql-typeof
    provides: TYPEOF restriction hooks in compile.ts (plan 04-02); referenceTo.length > 1 gating rule (plan 04-01)
provides:
  - "One LEFT JOIN per modelled target with a left(fk, 3) prefix filter for every polymorphic relationship (D-11)"
  - "Name pseudo-object table (NAME_OBJECT_FIELDS) and per-row COALESCE / CASE expressions for WHERE, ORDER BY, GROUP BY and SELECT"
  - "SObjectShape.poly { typeAlias, fkAlias } and per-row attributes.type in shapeSObjectRow; ShapeOptions.onUnmodelledPrefix"
affects: [04-05, 04-06, 04-07]
tech-stack:
  added: []
  patterns: ["Resolved.sql override: resolve() returns per-row SQL for a polymorphic leaf, sqlOf(r) picks it over expr()", "Prefixes and object names from the schema are inlined as SQL literals; user literals stay parameters"]
key-files:
  created:
    - packages/soql/src/polymorphic.ts
    - packages/soql/src/shape.test.ts
  modified:
    - packages/soql/src/compile.ts
    - packages/soql/src/shape.ts
    - packages/soql/src/compile.test.ts
    - packages/engine/src/query.test.ts
key-decisions:
  - "Owner.Type is answered by the Id-prefix CASE before any column lookup so Group's own Type column ('Queue') never leaks"
  - "A polymorphic parent shape carries type '' and takes attributes.type from the per-row typeAlias column; a row without one is a null parent (D-02, D-19)"
  - "Name-object fields on a polymorphic parent bypass addField and are pushed as plain shape fields; toLabel/FORMAT/convertCurrency on them is UNSUPPORTED:polymorphic-field"
requirements-completed: [POLY-01, POLY-02, POLY-05]
duration: 7min
completed: 2026-10-08
---

# Phase 4 Plan 04: Polymorphic SOQL read path Summary

**A polymorphic parent (Owner, What, Who) is joined once per modelled target with a key-prefix filter, read through the Name pseudo-object with COALESCE over contributing targets, typed per row from `CASE left(fk, 3)`, and shaped with the concrete `attributes.type`; `Owner.Type` selects, filters, sorts and groups by object API name.**

## Accomplishments

- `resolve()` emits `LEFT JOIN "org"."user" t1 ON t1."id" = t0."ownerid" AND left(t0."ownerid", 3) = '005'` and the Group equivalent for any relationship whose declared `referenceTo` has more than one entry (D-15); non-polymorphic joins are byte-identical to before (every pre-existing `compile.test.ts` expectation passes unchanged except the line-31 join strings that now include the prefix filter and the third join).
- `polymorphic.ts`: `NAME_OBJECT_FIELDS` (Id, Alias, Email, FirstName, IsActive, LastName, LastReferencedDate, LastViewedDate, MiddleName, Name, Phone, Profile, ProfileId, Suffix, Title, Type, Username, UserRole, UserRoleId; user-only flags per the Object Reference) and `pseudoField()`.
- `polyLeaf()`: `Type` -> prefix CASE (checked first, so `Group.Type = 'Queue'` never answers `Owner.Type`); `Id` -> `COALESCE(t1."id", t2."id")`; other Name fields -> `COALESCE` over targets that have a stored column, User only for user-only fields (`Owner.Email` on a Group row is null even though Group has an Email column); anything else -> `INVALID_FIELD ... on entity 'Name'`; `Profile`/`UserRole` -> `UNSUPPORTED:polymorphic-field`.
- Gates (D-17): `Owner.Profile.Name` -> `UNSUPPORTED:polymorphic-traversal`; a polymorphic parent referenced inside a child subquery (`inChildSubquery` scope flag) -> `UNSUPPORTED:polymorphic-subquery`; functions on a polymorphic field -> `UNSUPPORTED:polymorphic-field`.
- `SObjectShape.poly { typeAlias, fkAlias }`: `parentShape` selects the COALESCE id, the Type CASE and the raw FK; `shapeSObjectRow` stamps `attributes.type`/`url` from the row's concrete type and returns a null parent (calling `onUnmodelledPrefix(prefix)`) when the FK is set but no modelled prefix matched (D-07, D-19).
- Integration (pglite, Group `Support Queue` of Type Queue + Group-owned and User-owned Case): `Owner.Name`/`Owner.Type`/`attributes` per row, user-only nulls, `WHERE Owner.Type = 'Group'` / `'group'` / `!=` / `IN` / `LIKE`, `WHERE Owner.Name = ...`, `ORDER BY Owner.Name`, traversal gate. The unchanged `Account.Owner.Alias` test and the Bulk query job test (`Owner.Alias` CSV column) stay green.

## Generated SQL

`SELECT Owner.Name, Owner.Type FROM Case WHERE Owner.Type = 'Group'` (acme schema, org schema `org`), verbatim:

```sql
SELECT t0."id" AS "c0", COALESCE(t1."id", t2."id") AS "c1", CASE left(t0."ownerid", 3) WHEN '005' THEN 'User' WHEN '00G' THEN 'Group' END AS "c2", t0."ownerid" AS "c3", COALESCE(NULLIF(concat_ws(' ', t1."firstname", t1."lastname"), ''), t2."name") AS "c4", CASE left(t0."ownerid", 3) WHEN '005' THEN 'User' WHEN '00G' THEN 'Group' END AS "c5" FROM "org"."case" t0 LEFT JOIN "org"."user" t1 ON t1."id" = t0."ownerid" AND left(t0."ownerid", 3) = '005' LEFT JOIN "org"."group" t2 ON t2."id" = t0."ownerid" AND left(t0."ownerid", 3) = '00G' WHERE t0."isdeleted" = false AND lower(CASE left(t0."ownerid", 3) WHEN '005' THEN 'User' WHEN '00G' THEN 'Group' END) = lower($1)
```

params: `["Group"]`

## Task Commits

TDD, RED and GREEN committed separately per task:

1. Task 1 (compiler joins / Name leaf / Type CASE / sqlOf): `5d98280` test, `c393ec7` feat
2. Task 2 (SELECT side, poly shape, function guard): `b28f8b1` test, `956bed7` feat
3. Task 3 (shape per-row type, integration tests): `d2dba46` test, `1f888f0` feat

## Verification run

- `pnpm vitest run packages/soql/src/compile.test.ts`: 43 passed.
- `pnpm vitest run packages/soql/src packages/engine/src/query.test.ts`: 3 files, 63 passed.
- `pnpm vitest run packages/api/src/bulk.test.ts -t "runs a query job"`: 1 passed (12 skipped by the filter).
- `pnpm build` clean; `pnpm lint` clean; `pnpm test` (separate command, pglite): 17 files, 227 passed, 2 skipped (pre-existing Postgres-only skips).
- Acceptance greps: `this.expr(r.alias, r.obj, r.field)` occurs once (inside `sqlOf`); `type: "Name"` occurs zero times; the first-target comment is gone.

## Deviations from Plan

None in behaviour. One test-only adjustment: the plan's ORDER BY assertion ("`lower(COALESCE(` whose last argument is `t2."name"`") was written as an exact string match on the generated expression, since the COALESCE's first argument (`NULLIF(concat_ws(...))`) contains commas that defeat a simple regex.

## Not wired yet (by design, plan 04-06)

`ShapeOptions.onUnmodelledPrefix` is implemented and unit-tested but `runQuery` and the query route do not pass a callback yet, so the `UNSUPPORTED:reference-target` warning (D-07) is not logged until 04-06 adds the per-query warning plumbing and the second-schema POLY-03 test. Until then an unmodelled prefix is already a silent null parent (never an error).

## Known Stubs

None. A polymorphic parent shape is created with `type: ""` on purpose: the value is never read for such a shape (`shapeSObjectRow` takes the type from `poly.typeAlias` per row), and the root shape is never polymorphic, so `computeFormulaFields` (which reads `shape.type` on the root only) is unaffected.

## Self-Check: PASSED
