---
phase: 09-baseline-generator-parity-ownerid-narrowing
plan: 08
subsystem: baseline-generator
tags: [base2-04, base2-01, sc4, ownerTargets, ownerid-narrowing, d-15]
requires: [09-02, 09-07]
provides:
  - "pipeline.ts: ownerTargetsFor derives OwnerId targets per owned object from both sources (User/Group only); override wins and is reported override-resolved; written only when narrower than the default"
  - "overrides.json: ownerTargets for Event [User], Group [User, Group], ServiceContract [User, Group], each with reason and ref"
  - "packages/metadata/standard/objects: Account, Asset, Campaign, Contact, Contract, Event, Individual, Opportunity carry ownerTargets [User]; PROVENANCE.json objects.<O>.ownerTargets verified|override"
  - "SC4 proven in formula, SOQL, engine, describe and DDL tests; D-15 negative test (Group Id on Account.OwnerId -> INVALID_CROSS_REFERENCE_KEY)"
affects: [09-09, 10, 12, 14]
tech-stack:
  added: []
  patterns: ["an object-level fact follows the same precedence as field facts: override > sources, conflict or unmodelled target never resolved silently", "polymorphic-owner test coverage lives on Case (queue-enabled), User-only coverage on Account and friends"]
key-files:
  created: []
  modified:
    - scripts/gen-baseline/pipeline.ts
    - scripts/gen-baseline/overrides.json
    - packages/metadata/standard/PROVENANCE.json
    - packages/metadata/standard/objects/ (8 files)
    - packages/metadata/standard/README.md
    - packages/metadata/src/build.test.ts
    - packages/metadata/test/baseline-generator.test.ts
    - packages/metadata/test/baseline-gate.test.ts
    - packages/formula/src/formula.test.ts
    - packages/soql/src/compile.test.ts
    - packages/engine/src/engine.test.ts
    - packages/engine/src/engine.ts
    - packages/api/src/api.test.ts
    - packages/schema/src/migrate.test.ts
key-decisions:
  - "ownerTargets = the sources' OwnerId Refers To restricted to User/Group, provenance verified when both agree; an override always wins and is reported under overrideResolved; without an override a source conflict is a conflict like any field fact, and no target or a target outside User/Group (Calendar, Organization) aborts instead of being dropped silently (stricter than the plan's plain intersection, D-03/D-12)"
  - "ownerTargets is written only when narrower than [Group, User], so the 8 polymorphic objects stay byte-identical; v1-only mode never emits it"
  - "BASE2-01 ticked (owner targets now live in overrides.json with a reason); BASE2-04 left pending: its wording names unmodelled objects and 'Calendar and User on Event', and the poly-check re-run is 09-09's"
requirements-completed: [BASE2-01]
duration: 14min
completed: 2026-10-14
---

# Phase 9 Plan 08: Per-object ownerTargets and SC4 tests Summary

The generator now narrows `OwnerId.referenceTo` per owned object from the two sources: Account, Asset, Campaign, Contact, Contract, Event, Individual and Opportunity gain `"ownerTargets": ["User"]` (Event by a reasoned override because Calendar is not modelled), Case, Group, Lead, OperatingHours, ServiceAppointment, ServiceContract, SocialPost and Task stay `[User, Group]` (Group and ServiceContract by reasoned overrides), and the tests that relied on a polymorphic Account owner moved to Case per the Phase 8 audit; `Owner.Name` compiles in formulas and SOQL on the six User-only objects, a Group Id on `Account.OwnerId` is `INVALID_CROSS_REFERENCE_KEY`, and the full suite is green on pglite and Postgres 16.

## Performance
- **Started:** 2026-10-14T07:26:25Z — **Completed:** 2026-10-14T07:40Z — **Duration:** ~14 min
- **Tasks:** 2/2 — **Files:** 21 changed (0 created)

## Commits
| Hash | Type | What |
|---|---|---|
| 58edaaa | test | RED: table-driven OwnerId targets per owned object (build.test.ts); ownerTargets-only-when-narrower, ServiceContract override, v1 scope emits none (baseline-generator.test.ts) |
| d5bcca4 | feat | `ownerTargetsFor` in pipeline.ts, override validation, PROVENANCE `ownerTargets`, 3 overrides, regenerated 8 objects + PROVENANCE.json, README rule, gate-test fixture keeps OwnerId (GREEN) |
| 1171916 | test | SC4/D-15 tests and moved assertions in formula, soql, engine, api, schema; engine.ts comment reworded |

## What was built

### Generator (scripts/gen-baseline/pipeline.ts)
`ownerTargetsFor(object, derivedOwnerId, override, report)` runs in full mode for every object with `hasOwner`:
- sf-skills `fields.OwnerId.refers_to` and Object Reference `OwnerId.refersTo` are compared as lists; both stated and different = conflict (goes to `report.conflicts` like a field fact, abort unless `collectConflicts`).
- The stated list is restricted to User/Group. If an override exists it wins (`provenance: "override"`), and is pushed to `report.overrideResolved` as `<O>.OwnerId.ownerTargets` whenever the sources alone would not have produced it: no Refers To (ServiceContract), a target outside User/Group (Event: Calendar; Group: Organization) or a different list (Group).
- Without an override: no target or an unmodelled target is a `GeneratorError` naming the fix (an overrides.json `ownerTargets` entry with a reason).
- The value is written to the object JSON only when it differs from `["Group", "User"]`, code-unit sorted (`["User"]`). v1-only mode never runs it.
- `validateOverrides` now checks `ownerTargets.value` (non-empty, distinct, User/Group only) in addition to the reason.
- PROVENANCE.json gains `objects.<O>.ownerTargets: "verified" | "override"` for the 16 owned objects (13 verified, 3 override). It is an object-level fact and is not added to the per-field `counts`.

### Overrides (scripts/gen-baseline/overrides.json), verbatim from the plan
| Object | value | reason | ref |
|---|---|---|---|
| Event | [User] | Object Reference: Calendar, User; Calendar not modelled; widen when a Calendar object lands | Object Reference: Event.OwnerId |
| Group | [User, Group] | Object Reference: Organization, User; Organization not modelled and narrowing would add an FK on group.ownerid; default kept | Object Reference: Group.OwnerId |
| ServiceContract | [User, Group] | BASE2-04 lists User and Group; the Object Reference shows no Refers To for ServiceContract.OwnerId | BASE2-04 |

Source facts behind the 16 owned objects (both sources agree on every one): User only on Account, Asset, Campaign, Contact, Contract, Individual, Opportunity; Group, User on Case, Lead, OperatingHours, ServiceAppointment, SocialPost, Task; Calendar, User on Event; Organization, User on Group; nothing on ServiceContract. `report.overrideResolved` holds exactly `Event.OwnerId.ownerTargets`, `Group.OwnerId.ownerTargets`, `ServiceContract.OwnerId.ownerTargets` beside the 12 length entries.

### Regenerated output
`pnpm baseline:gen`: exactly 8 object files changed, each by the three lines of `"ownerTargets": ["User"]`; PROVENANCE.json changed only by the 16 `ownerTargets` keys. `pnpm baseline:check` passes and `git status --porcelain -- packages/metadata/standard` is empty after the commit. README rule for `ownerTargets` extended with where the hand decisions live.

### Downstream (no compiler change, as the plan predicted)
DDL adds `fk_account_ownerid` (and the other seven) because `referenceTo.length === 1`; SOQL joins `Account.Owner` as a plain `LEFT JOIN "org"."user" t1 ON t1."id" = t0."ownerid"` with no prefix filter and no `CASE left(...)`; the formula compiler accepts `Owner.Name`/`Owner.Alias` on the six objects; describe shows `referenceTo: ["User"]`, `polymorphicForeignKey: false`, `namePointing: true` (unchanged, Research LOW) on Account and `["User", "Group"]`, `polymorphicForeignKey: true` on Case; the engine rejects a `00G` Id on `Account.OwnerId` with `INVALID_CROSS_REFERENCE_KEY` on `["OwnerId"]` through the existing `matchLookupTarget` branch.

## Audit-row dispositions (for 09-09 to copy into 08-GROUP-OWNED-AUDIT.md)
| File | Lines (audit) | Disposition |
|---|---|---|
| packages/engine/src/engine.test.ts | 351-361 | Stays (Case is queue-enabled). New negative test added right after it: "a Group Id on Account.OwnerId is rejected like Salesforce does" (INVALID_CROSS_REFERENCE_KEY on OwnerId; the same Group Id accepted on Case). |
| packages/api/src/api.test.ts | 173 | Changed: Account `OwnerId` now `referenceTo: ["User"]`, `polymorphicForeignKey: false`, `namePointing: true`; Case `OwnerId` assertion added (`["User", "Group"]`, `polymorphicForeignKey: true`). |
| packages/api/src/api.test.ts | 427-439 | Stays (Group-owned Case via REST). |
| packages/schema/src/migrate.test.ts | 75 | Inverted: `expect(names).toContain("fk_account_ownerid")` (User-only, BASE2-04) plus `expect(names).not.toContain("fk_case_ownerid")`. |
| packages/soql/src/compile.test.ts | 35 | Changed: `Account.Owner.Alias FROM Contact` is a plain user join (2 LEFT JOINs, no `00G`); the nested polymorphic-owner coverage moved to a new test `Parent.Owner.Alias FROM Case` (3 LEFT JOINs with prefix filters). New test: `Owner.Name` on the six User-only objects and `Owner.Department` on Account compile without the prefix CASE. |
| packages/soql/src/compile.test.ts | 153-162, 261, 340-346 | Stay (Case). |
| packages/formula/src/formula.test.ts | 43 | Moved to Case: `rule("Owner.Alias = 'x'", "Case")` throws; new test "Owner fields resolve on objects whose owner is always a User" (Owner.Name on six objects, Owner.Alias on Account). |
| packages/formula/src/formula.test.ts | 49-50 | Stays (colon syntax, Phase 12). |
| packages/formula/src/formula.test.ts | 152-153 (**not in the audit**: the grep missed it, no Group/00G/Queue literal) | Moved to Case: `failure(() => rule("Owner.Alias = 'x'", "Case")).missing` is undefined. 09-09 should add this row. |
| packages/engine/src/engine.ts | 692 | Comment reworded to "Unknown target object (not in the baseline): accept unchecked." (comment only). Line 681 ("Group referenced IDs by target object") is the verb, unchanged. |
| packages/metadata/src/types.ts | 196 | Already reworded by 09-02 ("Has `OwnerId` (User and/or Group, see StandardObjectJson.ownerTargets)"); nothing to do. |
| packages/metadata/src/build.ts | 115 | Narrowed: 09-02 threads `ownerTargets` into `systemFields`; this plan supplies the values from the generator. |
| packages/engine/src/upgrade.test.ts | 67-84 | Stays: the fixture's Group-owned rows are Cases; the narrowed OwnerId adds FKs on User-owned tables only, `EXPECTED_WARNINGS` stays `[]` — verified green on pglite and Postgres 16 (D-14 scenario itself is 09-09's). |
| packages/engine/src/query.test.ts (all rows), packages/soql/src/shape.test.ts, packages/schema/src/ids.test.ts, parents.ts/compile.ts/polymorphic.ts/ids.ts comments, conformance legs | — | Not touched; all tests pass unchanged (they use Case or literal Ids). Conformance re-run is 09-09's. |

## Verification (HEAD 1171916)
- `pnpm test` (pglite): **37 files, 573 passed, 3 skipped** (pre-existing Phase 12 `it.fails`), 24.5 s.
- `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` (Postgres 16, Docker `orglet-postgres`): **37 files, 575 passed, 1 skipped**, 23.1 s.
- `pnpm lint`, `pnpm typecheck:scripts`: clean. `pnpm baseline:check`: "checked 36 files". `git status --porcelain -- packages/metadata/standard`: empty.
- Acceptance greps: ownerTargets files = `Account.json Asset.json Campaign.json Contact.json Contract.json Event.json Individual.json Opportunity.json`; `"ownerTargets"` in overrides.json = 3, "shows no Refers To" = 1; migrate.test `not.toContain("fk_account_ownerid")` = 0, `toContain("fk_account_ownerid")` = 1; api.test `referenceTo: ["User"], relationshipName: "Owner"` = 1; engine.test `INVALID_CROSS_REFERENCE_KEY` = 8; engine.ts "e.g. Group): accept unchecked" = 0.

## Deviations from Plan

**1. [Stricter than planned] An owner target outside User/Group without an override aborts instead of being dropped by the intersection.** The plan's derivation is `(sf ∪ doc) ∩ {User, Group}`, which would have made Event `[User]` silently and Group `[User]` (a narrowing nobody decided). D-03 says a source fact is never resolved silently and D-12 says Event's narrowing is an override; the generator now requires the override and reports it. Output is identical to the plan's (both objects have overrides). Commit d5bcca4.

**2. [Rule 3 - Blocking] baseline-gate.test.ts fixture keeps OwnerId.** `syntheticAccountInputs` prunes the sources to the v1.0 pin inventory; OwnerId is a system field (never pinned) so it was deleted and the new rule aborted with "Account.OwnerId: no source names a User or Group owner target", failing 4 MasterDetail-refusal tests. One condition added with a comment; the tests' meaning is unchanged. Commit d5bcca4.

**3. One more test moved than the plan listed.** `formula.test.ts` 152-153 (`FormulaCompileError.missing` on `Owner.Alias`) also relied on a polymorphic Account owner; moved to Case. Listed above for the audit. Commit 1171916.

**4. compile.test.ts:32 (audit row, not in the plan's behaviour list) rewritten** as a plain-join assertion, with the nested polymorphic case re-homed on `Case.Parent.Owner` so the "once per target with a prefix filter" coverage through a parent is not lost. Commit 1171916.

**5. types.ts not changed**: the plan's step 4 was conditional on 09-02 having left the comment; 09-02 reworded it.

**6. README.md touched** (not in the plan's file list): the `ownerTargets` rule line now says when the generator writes it and where the hand decisions live. Three lines.

## Requirements
Frontmatter: BASE2-04.
- **BASE2-01 ticked.** Its "owner targets" clause was the only one 09-07 left open; `overrides.json` now holds the three `ownerTargets` hand facts with reason and ref, validated by the generator, and the drift gate (`baseline-gen-check` in ci.yml) covers the regenerated files. **Nuance to flag:** the wording lists precision/scale, compound fields and standard value sets among the hand facts "in overrides.json"; today none needed a hand decision — v1.0 values come from the pin layer (`v1-pins.json`, mechanical, no per-entry reasons), new numeric precision/scale are type defaults marked `guessed` in PROVENANCE.json, and `standardValueSets.json` stays hand-maintained. The `set` mechanism accepts every one of those keys with a reason, so the rule holds the moment such a fact is needed. A strict reading of the wording may want that stated in REQUIREMENTS.md; left for the verifier/Johan.
- **BASE2-04 not ticked.** Its wording lists objects orglet does not model (Solution, ContentVersion, Order, Location, ContactRequest, WorkOrder) and says "Calendar and User on Event" where orglet decides `[User]` (D-12); its "polymorphic behaviour from v1.0 is unchanged on queue-enabled objects" is proven here in unit/engine tests but the `conformance/poly-check` re-run is 09-09's. 09-09 should align the wording (as 09-07 did for BASE2-02/03) and tick it.

## Notes for 09-09
- D-14 scenario: a Group-owned row on a now-User-only object in an existing database should yield one `UNSUPPORTED:schema-fk` warning for `fk_<table>_ownerid` and no rewrite; the FKs now added by the upgrade are `fk_account_ownerid`, `fk_asset_ownerid`, `fk_campaign_ownerid`, `fk_contact_ownerid`, `fk_contract_ownerid`, `fk_event_ownerid`, `fk_individual_ownerid`, `fk_opportunity_ownerid`.
- Audit: copy the table above; add the missing row for formula.test.ts 152-153; the User.json `DelegatedApproverId` row ("decide whether Group stays a target") is untouched by this plan (it is a field fact, not OwnerId).
- The folded todo `2026-10-08-narrow-baseline-ownerid-per-object.md` is now behaviourally closed (`Account.Owner.Department` in SOQL and `Owner.Alias` in an Account formula compile); the move to done is 09-09's.
- 11 leftover `test_*` schemas in the local Docker database are still there (not dropped, Johan's call).

## Known Stubs
None.

## Self-Check: PASSED
Files (pipeline.ts, overrides.json, PROVENANCE.json, README.md, the 9 test files, this SUMMARY) and commits 58edaaa, d5bcca4, 1171916 exist; `--report` lists exactly Event/Group/ServiceContract `.OwnerId.ownerTargets` under overrideResolved.
