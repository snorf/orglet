---
phase: 04-polymorphic-lookups-soql-typeof
plan: 05
subsystem: soql
tags: [soql, typeof, polymorphic, shape, poly-04, poly-03]
requires:
  - phase: 04-polymorphic-lookups-soql-typeof
    provides: polymorphic joins, PolyJoin/Resolved, polyLeaf/typeCase/polyId, SObjectShape.poly, ShapeOptions.onUnmodelledPrefix (plan 04-04); TYPEOF restriction errors (plan 04-02)
provides:
  - "FieldTypeof compiles onto the shared polymorphic joins into TypeofShape { typeAlias, fkAlias, branches, else? } on SObjectShape.typeofs"
  - "shapeTypeof: per-row branch by concrete type (D-04), null for no WHEN and no ELSE (D-18), null for an unmodelled prefix even with ELSE plus onUnmodelledPrefix once (D-19, D-07)"
  - "notPolymorphic / notATarget MALFORMED_QUERY texts in typeof.ts"
affects: [04-06, 04-07]
tech-stack:
  added: []
  patterns: ["A WHEN branch is an ordinary SObjectShape rooted at its target's join alias; ELSE is a poly shape reading the Name pseudo-object; both reuse addField / polyLeaf"]
key-files:
  created: []
  modified:
    - packages/soql/src/compile.ts
    - packages/soql/src/typeof.ts
    - packages/soql/src/shape.ts
    - packages/soql/src/index.ts
    - packages/soql/src/compile.test.ts
    - packages/soql/src/shape.test.ts
    - packages/engine/src/query.test.ts
key-decisions:
  - "A WHEN naming a declared but unmodelled target is dropped silently at compile time (D-13): no row can carry that type, so the branch can never match"
  - "Inside WHEN Group, Type is Group's own column (Queue/Regular), not the Id-prefix CASE; only the Name pseudo-object (no TYPEOF, or ELSE) answers Type with the object API name"
  - "An unmodelled prefix is a null TYPEOF parent with or without ELSE and never a synthetic object (D-19 restated); the callback fires once per row so 04-06 can log D-07 once per query"
requirements-completed: [POLY-04, POLY-03]
duration: 8min
completed: 2026-10-08
---

# Phase 4 Plan 05: SOQL TYPEOF compile and per-row shaping Summary

**`SELECT TYPEOF <rel> WHEN <Object> THEN <fields> [WHEN ...] [ELSE <Name fields>] END` compiles onto the plan-04-04 polymorphic joins as one shape per WHEN branch plus an optional Name-object ELSE shape, and each row is shaped from the branch named by its concrete type: other branches' fields absent (D-04), `null` when nothing matches and there is no ELSE (D-18), `null` for an Id whose prefix matches no modelled object in every case (D-19).**

## Accomplishments

- `compile.ts` `case "FieldTypeof"`: resolves the relationship path through `resolve()` (creating or reusing the polymorphic join, so `TYPEOF Owner` and `WHERE Owner.Type = ...` share one set of joins), selects the Type CASE and the raw FK once, and builds per branch:
  - WHEN: `declared` is matched case-insensitively against the field's `referenceTo` (else `MALFORMED_QUERY` "... is not a type of the polymorphic relationship ..."); a declared but unmodelled target is dropped (D-13); the branch is a plain `SObjectShape` with `type` = target, `idAlias` = that target's `id` column, and fields through `addField` on the target's join alias (formula fields on a branch give the existing `UNSUPPORTED:soql-formula`; a dotted path gives `UNSUPPORTED:polymorphic-traversal`; an unknown field is `INVALID_FIELD` on the branch's object).
  - ELSE: a poly shape (`type: ""`, `poly: { typeAlias, fkAlias }`, `idAlias` = `COALESCE` over target ids) whose fields go through `polyLeaf`, so only Name pseudo-object fields are allowed (`ELSE Department` is `INVALID_FIELD ... on entity 'Name'`).
  - TYPEOF on a non-polymorphic relationship is `MALFORMED_QUERY` "TYPEOF can only be used with a polymorphic relationship field" (`notPolymorphic` in `typeof.ts`).
  - The host shape is the root or, for `TYPEOF Account.Owner`, the parent shape of the leading path; key = the field's `relationshipName`.
- `shape.ts` `shapeTypeof`: FK null -> null, no callback; type null with FK set -> `onUnmodelledPrefix(prefix)` and null (ELSE or not, D-19); branch found -> `shapeSObjectRow(branch)`; else ELSE shape or null (D-18). Runs after parents and before children, so key order stays fields, parents, typeofs, children.
- `index.ts` exports `TypeofShape`.
- Tests: 8 compile unit tests (`describe("TYPEOF")`), 6 shape unit tests (`describe("shapeSObjectRow with TYPEOF")`), 5 pglite integration tests (`describe("TYPEOF")` nested in 04-04's `polymorphic lookups`, with three Task rows linked to an Account, an Opportunity and a Case).

## Verbatim result (pglite, `apiVersion` 60.0)

`SELECT Subject, TYPEOF Owner WHEN User THEN Alias, Email WHEN Group THEN Name, Type END FROM Case ORDER BY Subject`:

```json
{
  "totalSize": 2,
  "done": true,
  "records": [
    {
      "attributes": {
        "type": "Case",
        "url": "/services/data/v60.0/sobjects/Case/50000VXUknBdA2RAHV"
      },
      "Subject": "Group case",
      "Owner": {
        "attributes": {
          "type": "Group",
          "url": "/services/data/v60.0/sobjects/Group/00G00VXUknBTA2REHX"
        },
        "Name": "Support Queue",
        "Type": "Queue"
      }
    },
    {
      "attributes": {
        "type": "Case",
        "url": "/services/data/v60.0/sobjects/Case/50000VXUknBpA2RAHV"
      },
      "Subject": "User case",
      "Owner": {
        "attributes": {
          "type": "User",
          "url": "/services/data/v60.0/sobjects/User/00500VXUknAnA2RAHV"
        },
        "Alias": "admin",
        "Email": "admin@orglet.local"
      }
    }
  ]
}
```

Note `Type: "Queue"` inside `WHEN Group`: that is Group's own `Type` column, as a WHEN branch reads the concrete object's fields. The Name pseudo-object's `Owner.Type` (no TYPEOF) still answers `"Group"` (plan 04-04).

## D-19 restated

An Id whose key prefix matches no modelled object is a `null` relationship in every TYPEOF form, with or without an ELSE branch. No synthetic `attributes.type: "Name"` object is ever produced (`grep -cE 'type: .Name.' compile.ts` and `grep -c 'attributes("Name"' shape.ts` both print 0). `onUnmodelledPrefix` is called once per such row; plan 04-06 turns that into the once-per-query `UNSUPPORTED:reference-target` log line (D-07).

## Task Commits

TDD, RED and GREEN committed separately for the two code tasks:

1. Task 1 (compile side): `450753e` test (8 failing), `6061d33` feat
2. Task 2 (shape side): `7a654ea` test (6 failing), `eb5cdff` feat
3. Task 3 (integration tests, test-only): `225b312`

## Verification run

- `pnpm vitest run packages/soql/src/compile.test.ts`: 51 passed (43 pre-existing unchanged + 8 new).
- `pnpm vitest run packages/soql/src`: 2 files, 61 passed.
- `pnpm vitest run packages/engine/src/query.test.ts`: 21 passed (16 pre-existing unchanged + 5 new).
- `pnpm build` clean; `pnpm lint` clean (run after build); `pnpm test` as a separate command (pglite): 17 files, 246 passed, 2 skipped (the pre-existing Postgres-only skips).
- Acceptance greps: `export interface TypeofShape` 1, `typeofs?: Map<string, TypeofShape>` 1, `TYPEOF is not supported yet` 0, `type: .Name.` 0, `notPolymorphic` in typeof.ts 1, `function shapeTypeof(` 1, `branches.get(` 1, `attributes("Name"` 0.

## Deviations from Plan

None in behaviour. Two small test-side notes:

- Task 3 is marked `tdd="true"` but is test-only on top of Tasks 1 and 2, so the integration tests passed on their first run; there was no meaningful RED step to commit. The task has a single `test(04-05)` commit.
- The plan's `notATarget` message was inlined in `compile.ts` in the action text; it lives in `typeof.ts` next to `notPolymorphic` and `alsoSelected` so all TYPEOF message texts stay in one file.

## Not wired yet (by design, plan 04-06)

`onUnmodelledPrefix` is exercised by unit tests only; `runQuery` and the query route still pass no callback, so the D-07 warning is not logged until 04-06 adds the per-query plumbing and the second-schema POLY-03 test. An unmodelled prefix is already a silent null parent, never an error.

## Known Stubs

None. The ELSE shape and every polymorphic parent shape carry `type: ""` on purpose: `shapeSObjectRow` takes the type per row from `poly.typeAlias` and the root shape is never polymorphic, so nothing reads that empty string.

## Self-Check: PASSED
