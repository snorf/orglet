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
| packages/engine/src/query.test.ts | 137-150 (setup: Group row, Group-owned Case), 153-190 (Owner fields, Owner.Type filter, owner type agreement, `Owner.Name`) | DB row | stays: Case remains User+Group; passes unchanged (09-08) |
| packages/engine/src/query.test.ts | 205-235 (TYPEOF Owner WHEN Group, Owner.Type filter with TYPEOF) | DB row | stays: Case remains User+Group; passes unchanged (09-08) |
| packages/engine/src/query.test.ts | 247-290 (orphan `00G` owners with Group removed from the schema, `OwnerId` starts with `00G`) | DB row, literal Id | stays: Case remains User+Group; passes unchanged (09-08) |
| packages/engine/src/engine.test.ts | 351-361 (Group row, Group-owned Case, `Owner` parent load) | DB row | stays: Case remains User+Group. New negative test added right after it in 09-08 (D-15): "a Group Id on Account.OwnerId is rejected like Salesforce does" (`INVALID_CROSS_REFERENCE_KEY` on `OwnerId`; the same Group Id accepted on Case) |
| packages/api/src/api.test.ts | 427-439 (REST create of a Group, Group-owned Case, `Owner.Type = 'Group'` query) | DB row | stays: Group-owned Case via REST; passes unchanged (09-08) |
| packages/engine/src/upgrade.test.ts | 67-84 (Queue Group insert, Group-owned Case via DmlEngine and via importMode engine; v1.0 snapshot still has `OwnerId.referenceTo` including Group, so Phase 9 must decide whether the upgraded org keeps these rows valid) | DB row | stays: the fixture's Group-owned rows are Cases (queue-enabled); the narrowed OwnerId adds FKs on User-owned tables only, `EXPECTED_WARNINGS` stays `[]`; green on pglite and Postgres 16 (09-07, 09-08). The Group-owned-row-on-a-User-only-object case is the row below |
| packages/engine/src/upgrade-owner.test.ts | whole file (v1.0 org with a Queue Group and a Group-owned Account; upgrade with the current baseline) | DB row | new in 09-09 (D-14): the upgrade skips `fk_account_ownerid` with exactly one `UNSUPPORTED:schema-fk` warning and rewrites nothing; after `UPDATE account SET ownerid = <user>` the next `migrate` adds the FK silently. Kept out of upgrade.test.ts so its `EXPECTED_WARNINGS` stays `[]` |

## Tests with literal 00G Ids or prefixes

| File | Lines | Relies on | Phase 9 disposition |
|------|-------|-----------|---------------------|
| packages/schema/src/ids.test.ts | 80-88 (`keyPrefix: "00G"` target, `generateId("00G")`) | literal Id | stays: literal Id generation, not owner-related; passes unchanged (09-08) |
| packages/soql/src/shape.test.ts | 7 (`GROUP_ID`), 13-14, 35, 44-72 (Group TYPEOF branch and polymorphic shape) | literal Id | stays: shapes a polymorphic owner from literal Ids, object-agnostic; passes unchanged (09-08) |
| packages/schema/src/migrate.test.ts | 75 (`fk_account_ownerid` absent: polymorphic User/Group has no FK) | describe shape (DDL: no FK on a polymorphic OwnerId) | flipped in 09-08: `expect(names).toContain("fk_account_ownerid")` (Account is User-only, BASE2-04) plus `expect(names).not.toContain("fk_case_ownerid")` |

## Describe-shape assertions

| File | Lines | Relies on | Phase 9 disposition |
|------|-------|-----------|---------------------|
| packages/api/src/api.test.ts | 173 (`OwnerId.referenceTo: ["User","Group"]`, `namePointing: true`) | describe shape | changed in 09-08: Account `OwnerId` now `referenceTo: ["User"]`, `polymorphicForeignKey: false`, `namePointing: true`; Case `OwnerId` assertion added (`["User", "Group"]`, `polymorphicForeignKey: true`) |

## SQL-shape assertions

| File | Lines | Relies on | Phase 9 disposition |
|------|-------|-----------|---------------------|
| packages/soql/src/compile.test.ts | 35 (LEFT JOIN `group` on `00G` prefix), 153-162 (`GROUP_JOIN`, `TYPE_CASE`, Owner.Type filter), 261 (semi-join on Owner.Type), 340-346 (TYPEOF branches User/Group) | SQL shape | 35 changed in 09-08: `Account.Owner.Alias FROM Contact` is a plain user join (2 LEFT JOINs, no `00G`); the nested polymorphic-owner coverage moved to a new test `Parent.Owner.Alias FROM Case` (3 LEFT JOINs with prefix filters); new test: `Owner.Name` on the six User-only objects and `Owner.Department` on Account compile without the prefix CASE. 153-162, 261, 340-346 stay (Case remains User+Group) |

## Formula tests

| File | Lines | Relies on | Phase 9 disposition |
|------|-------|-----------|---------------------|
| packages/formula/src/formula.test.ts | 43 (comment: OwnerId is User/Group; `Owner.Alias` rejected), 49-50 (`Owner:Group.Name` reported as UNSUPPORTED:formula) | formula | 43 moved to Case in 09-08: `rule("Owner.Alias = 'x'", "Case")` throws; new test "Owner fields resolve on objects whose owner is always a User" (`Owner.Name` on six objects, `Owner.Alias` on Account). 49-50 stay (colon syntax, Phase 12) |
| packages/formula/src/formula.test.ts | 152-153 (`FormulaCompileError.missing` undefined for `Owner.Alias` on a polymorphic owner; not in the 2026-10-13 grep: no Group/00G/Queue literal, found by 09-08) | formula | moved to Case in 09-08: `failure(() => rule("Owner.Alias = 'x'", "Case")).missing` is undefined |
| packages/formula/src/expectations.test.ts | 52-60 (`Owner:Group.Name` and `Owner:Queue.Name` `it.fails` cases, plus the `Owner:User.Email` case) | formula | stays: colon-syntax expectations on Case (Phase 12, `it.fails` kept red per Phase 8 D-21); unchanged |
| packages/engine/src/query.test.ts | 182-183 (formula `Owner:Group.Name` UNSUPPORTED and `Owner.Name` rejection, inside the owner agreement test) | formula | stays: Case remains User+Group; passes unchanged (09-08) |

## Conformance legs

| File | Lines | Relies on | Phase 9 disposition |
|------|-------|-----------|---------------------|
| conformance/poly-check/jsforce.mjs | 2, 42, 60-61, 74, 80, 86-89, 108 (creates a Queue, Group-owned and User-owned Case; asserts Owner.Type, TYPEOF Owner) | conformance (live REST) | unchanged (Case); re-run result recorded in 09-09-SUMMARY.md |
| conformance/poly-check/sf_poly.py | 3, 44, 60, 69, 74, 79-81, 109 (same scenario via simple-salesforce) | conformance (live REST) | unchanged (Case); re-run result recorded in 09-09-SUMMARY.md |
| conformance/poly-check/README.md | 5-6 (describes the Queue/Group-owned Case scenario) | comment | accurate (Case) |

## Production code encoding the polymorphism, and comments

| File | Lines | Relies on | Phase 9 disposition |
|------|-------|-----------|---------------------|
| packages/metadata/src/build.ts | 115 (`owner.referenceTo = ["User", "Group"]`, the line Phase 9 narrows) | production code | replaced by `ownerTargets` (09-02 threads `StandardObjectJson.ownerTargets` into `systemFields`; 09-08's generator writes `["User"]` for Account, Asset, Campaign, Contact, Contract, Event, Individual, Opportunity; absent means User+Group) |
| packages/metadata/src/types.ts | 196 (doc comment: `OwnerId` (User/Group)) | comment | reworded in 09-02 ("Has `OwnerId` (User and/or Group, see StandardObjectJson.ownerTargets)") |
| packages/engine/src/engine.ts | 681 (comment: Group referenced IDs by target object, incidental), 692 (STALE comment "Unknown target object (e.g. Group): accept unchecked"; Group is modelled now) | comment | 692 reworded in 09-08 to "Unknown target object (not in the baseline): accept unchecked."; 681 is the verb, accurate |
| packages/engine/src/parents.ts | 34 (comment: Group-owned record's Owner comes from Group) | comment | accurate (holds for the queue-enabled objects) |
| packages/formula/src/compile.ts | 97 (comment: polymorphic lookup Owner User/Group has no single parent) | comment | accurate (describes the `referenceTo.length > 1` case, which User-only objects no longer hit) |
| packages/soql/src/compile.ts | 210 (comment: Group's own Type column ('Queue') never answers Owner.Type) | comment | accurate |
| packages/soql/src/polymorphic.ts | 5 (comment: Group.Email column) | comment | accurate |
| packages/schema/src/ids.ts | 46 (doc comment: polymorphic Owner -> User/Group prefix rule) | comment | accurate (prefix rule applies where OwnerId stays polymorphic) |

## Incidental / not owner-related

| File | Lines | Relies on | Phase 9 disposition |
|------|-------|-----------|---------------------|
| packages/metadata/standard/objects/Group.json | whole file (the Group object definition itself) | n.a. | n.a. |
| packages/metadata/standard/objects/User.json | 89 (`DefaultGroupNotificationFrequency`, unrelated word), 101 (`DelegatedApproverId` referenceTo Group/User: a non-owner lookup to Group) | n.a. | stays: non-owner lookup, v1.0 pinned (BASE2-04 narrows OwnerId only; the diff gate keeps the v1.0 `referenceTo`) |
| packages/metadata/test/fixtures/baseline-v1.0/objects/Group.json | whole file (frozen v1.0 copy of the Group object) | incidental (frozen v1.0 baseline snapshot, never edited) | n.a. |
| packages/metadata/test/fixtures/baseline-v1.0/objects/User.json | same hits as the live User.json (frozen v1.0 copy) | incidental (frozen v1.0 baseline snapshot, never edited) | n.a. |
| packages/metadata/src/build.test.ts | 672-696 (`ownerTargets` loader tests: Case keeps User/Group, table of User-only and User+Group objects, `Calendar` rejected by `validateBaseline`) | generated or incidental (Phase 9) | new in 09-02/09-08: these are the SC4 loader tests themselves, not Group-owned scenarios; n.a. |
| packages/metadata/test/baseline-generator.test.ts | 226-240 (`ownerTargets` written only when narrower than User+Group; Event/Group/ServiceContract overrides carry a reason) | generated or incidental (Phase 9) | new in 09-08: generator tests for BASE2-04; n.a. |
| packages/metadata/test/baseline-gate.test.ts | 113 (`"Group"` as a sf-skills field property word in a synthetic fixture) | generated or incidental (Phase 9) | generated or incidental, n.a. |
| packages/metadata/test/gen-baseline-typemap.test.ts | 128-166 (synthetic sf-skills/Object Reference inputs with `Group` property word and `refers_to: "Group, User"` on a fixture OwnerId) | generated or incidental (Phase 9) | generated or incidental, n.a. |
| packages/metadata/standard/README.md | 30-32 (`ownerTargets` rule: absent means User and Group; hand decisions for Event, Group, ServiceContract live in overrides.json) | generated or incidental (Phase 9) | accurate (rewritten in 09-07/09-08); n.a. |
| packages/metadata/standard/PROVENANCE.json | generated provenance report (`Group` appears in `Obj.Field -> ...` target lists) | generated or incidental (Phase 9) | generated or incidental, n.a. |
| packages/metadata/standard/objects/Account.json | 175 (label "Commerce Group Reference"), 409 (`Group` in a referenceTo list of a non-owner lookup); `ownerTargets: ["User"]` written in 09-08 | generated or incidental (Phase 9) | generated or incidental, n.a. |
| packages/metadata/standard/objects/CampaignMember.json | 174 (`Group` in a referenceTo list of a non-owner lookup) | generated or incidental (Phase 9) | generated or incidental, n.a. |
| packages/metadata/standard/objects/Contact.json | 153, 194 (labels containing "Group") | generated or incidental (Phase 9) | generated or incidental, n.a. |
| packages/metadata/standard/objects/Event.json | 123, 168 (labels "Group Event Type", "Is Group Event") | generated or incidental (Phase 9) | generated or incidental, n.a. |
| packages/metadata/standard/objects/Profile.json | 2943-4793 (permission labels containing "Group"/"Queue") | generated or incidental (Phase 9) | generated or incidental, n.a. |
| packages/metadata/standard/objects/ServiceAppointment.json | 223 (label "Group Appointment Access Type") | generated or incidental (Phase 9) | generated or incidental, n.a. |
| packages/metadata/standard/objects/SocialPost.json | 142 (label "Keyword Group Name") | generated or incidental (Phase 9) | generated or incidental, n.a. |

## Completeness check

Command (must print nothing: every file with a hit has a row above):

```bash
for f in $(grep -rlE '\bGroup\b|00G|Queue' packages conformance examples --include='*.ts' --include='*.mjs' --include='*.py' --include='*.json' --include='*.xml' --include='*.md' | grep -vE 'packages/sigha/|/node_modules/|/dist/|/\.venv/|/\.cache/'); do grep -q "$f" .planning/phases/08-upgrade-safety-net-nullable-key-prefixes/08-GROUP-OWNED-AUDIT.md || echo "MISSING $f"; done
```

Output at 2026-10-13: (empty)

Re-run at 2026-10-14 (Phase 9, 09-09, after the v2 regeneration and the new tests): (empty). Every row's "Phase 9
disposition" is filled; the rows under "Incidental / not owner-related" from `packages/metadata/src/build.test.ts`
down were added by 09-09 for files Phase 9 created or regenerated.
