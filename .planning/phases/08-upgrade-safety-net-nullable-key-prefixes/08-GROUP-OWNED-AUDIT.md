# Phase 8: Group-owned audit (D-22)

Purpose: Phase 9 narrows `OwnerId.referenceTo` per object (BASE2-04). Objects that stay queue-owned (Case, Lead)
keep `["User", "Group"]`; the rest become User-only. For every usage below, Phase 9 decides whether it stays,
moves to a still queue-owned object (Case/Lead), or must now expect `INVALID_CROSS_REFERENCE_KEY` as Salesforce
would. The "Phase 9 disposition" column is left for Phase 9 to fill. Rows marked n.a. need no decision.

This is a living list: later Phase 8 plans that add a Group-owned test, or a file the grep hits, append their own
rows (08-07 appends `packages/engine/src/upgrade.test.ts` and the `packages/metadata/test/fixtures/baseline-v1.0`
snapshot). Fixture directories are deliberately not excluded from the grep.

Grep used (run 2026-10-13):

```bash
grep -rnE '\bGroup\b|00G|Queue' packages conformance examples --include='*.ts' --include='*.mjs' --include='*.py' --include='*.json' --include='*.xml' --include='*.md' \
  | grep -vE 'packages/sigha/|/node_modules/|/dist/|/\.venv/|/\.cache/'
```

`conformance/describe-check/*` was checked explicitly: it has no Group or OwnerId reliance (no grep hit), so it
needs no row.

## Tests that create Group rows or Group-owned records (DB rows)

| File | Lines | Relies on | Phase 9 disposition |
|------|-------|-----------|---------------------|
| packages/engine/src/query.test.ts | 137-150 (setup: Group row, Group-owned Case), 153-190 (Owner fields, Owner.Type filter, owner type agreement, `Owner.Name`) | DB row | |
| packages/engine/src/query.test.ts | 205-235 (TYPEOF Owner WHEN Group, Owner.Type filter with TYPEOF) | DB row | |
| packages/engine/src/query.test.ts | 247-290 (orphan `00G` owners with Group removed from the schema, `OwnerId` starts with `00G`) | DB row, literal Id | |
| packages/engine/src/engine.test.ts | 351-361 (Group row, Group-owned Case, `Owner` parent load) | DB row | |
| packages/api/src/api.test.ts | 427-439 (REST create of a Group, Group-owned Case, `Owner.Type = 'Group'` query) | DB row | |

## Tests with literal 00G Ids or prefixes

| File | Lines | Relies on | Phase 9 disposition |
|------|-------|-----------|---------------------|
| packages/schema/src/ids.test.ts | 80-88 (`keyPrefix: "00G"` target, `generateId("00G")`) | literal Id | |
| packages/soql/src/shape.test.ts | 7 (`GROUP_ID`), 13-14, 35, 44-72 (Group TYPEOF branch and polymorphic shape) | literal Id | |
| packages/schema/src/migrate.test.ts | 75 (`fk_account_ownerid` absent: polymorphic User/Group has no FK) | describe shape (DDL: no FK on a polymorphic OwnerId) | |

## Describe-shape assertions

| File | Lines | Relies on | Phase 9 disposition |
|------|-------|-----------|---------------------|
| packages/api/src/api.test.ts | 173 (`OwnerId.referenceTo: ["User","Group"]`, `namePointing: true`) | describe shape | |

## SQL-shape assertions

| File | Lines | Relies on | Phase 9 disposition |
|------|-------|-----------|---------------------|
| packages/soql/src/compile.test.ts | 35 (LEFT JOIN `group` on `00G` prefix), 153-162 (`GROUP_JOIN`, `TYPE_CASE`, Owner.Type filter), 261 (semi-join on Owner.Type), 340-346 (TYPEOF branches User/Group) | SQL shape | |

## Formula tests

| File | Lines | Relies on | Phase 9 disposition |
|------|-------|-----------|---------------------|
| packages/formula/src/formula.test.ts | 43 (comment: OwnerId is User/Group; `Owner.Alias` rejected), 49-50 (`Owner:Group.Name` reported as UNSUPPORTED:formula) | formula | |
| packages/formula/src/expectations.test.ts | 52-60 (`Owner:Group.Name` and `Owner:Queue.Name` `it.fails` cases, plus the `Owner:User.Email` case) | formula | |
| packages/engine/src/query.test.ts | 182-183 (formula `Owner:Group.Name` UNSUPPORTED and `Owner.Name` rejection, inside the owner agreement test) | formula | |

## Conformance legs

| File | Lines | Relies on | Phase 9 disposition |
|------|-------|-----------|---------------------|
| conformance/poly-check/jsforce.mjs | 2, 42, 60-61, 74, 80, 86-89, 108 (creates a Queue, Group-owned and User-owned Case; asserts Owner.Type, TYPEOF Owner) | conformance (live REST) | |
| conformance/poly-check/sf_poly.py | 3, 44, 60, 69, 74, 79-81, 109 (same scenario via simple-salesforce) | conformance (live REST) | |
| conformance/poly-check/README.md | 5-6 (describes the Queue/Group-owned Case scenario) | comment | |

## Production code encoding the polymorphism, and comments

| File | Lines | Relies on | Phase 9 disposition |
|------|-------|-----------|---------------------|
| packages/metadata/src/build.ts | 115 (`owner.referenceTo = ["User", "Group"]`, the line Phase 9 narrows) | production code | |
| packages/metadata/src/types.ts | 196 (doc comment: `OwnerId` (User/Group)) | comment | |
| packages/engine/src/engine.ts | 681 (comment: Group referenced IDs by target object, incidental), 692 (STALE comment "Unknown target object (e.g. Group): accept unchecked"; Group is modelled now) | comment | |
| packages/engine/src/parents.ts | 34 (comment: Group-owned record's Owner comes from Group) | comment | |
| packages/formula/src/compile.ts | 97 (comment: polymorphic lookup Owner User/Group has no single parent) | comment | |
| packages/soql/src/compile.ts | 210 (comment: Group's own Type column ('Queue') never answers Owner.Type) | comment | |
| packages/soql/src/polymorphic.ts | 5 (comment: Group.Email column) | comment | |
| packages/schema/src/ids.ts | 46 (doc comment: polymorphic Owner -> User/Group prefix rule) | comment | |

## Incidental / not owner-related

| File | Lines | Relies on | Phase 9 disposition |
|------|-------|-----------|---------------------|
| packages/metadata/standard/objects/Group.json | whole file (the Group object definition itself) | n.a. | n.a. |
| packages/metadata/standard/objects/User.json | 89 (`DefaultGroupNotificationFrequency`, unrelated word), 101 (`DelegatedApproverId` referenceTo Group/User: a non-owner lookup to Group) | n.a. | decide whether Group stays a target here |

## Completeness check

Command (must print nothing: every file with a hit has a row above):

```bash
for f in $(grep -rlE '\bGroup\b|00G|Queue' packages conformance examples --include='*.ts' --include='*.mjs' --include='*.py' --include='*.json' --include='*.xml' --include='*.md' | grep -vE 'packages/sigha/|/node_modules/|/dist/|/\.venv/|/\.cache/'); do grep -q "$f" .planning/phases/08-upgrade-safety-net-nullable-key-prefixes/08-GROUP-OWNED-AUDIT.md || echo "MISSING $f"; done
```

Output at 2026-10-13: (empty)
