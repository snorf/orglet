---
phase: 09-baseline-generator-parity-ownerid-narrowing
plan: 09
subsystem: baseline-generator
tags: [base2-04, sc4, d-14, d-15, upgrade, schema-fk, group-owned-audit, conformance, poly-check]
requires: [09-07, 09-08]
provides:
  - "packages/engine/src/upgrade-owner.test.ts: D-14 proven: a v1.0 database with a Queue-owned Account upgrades with one UNSUPPORTED:schema-fk warning and no rewrite; the FK lands silently once the owner is corrected"
  - "08-GROUP-OWNED-AUDIT.md: Phase 9 disposition on every row, rows for every file Phase 9 created or regenerated, completeness loop prints nothing"
  - "conformance/run-all.sh green on all 8 legs against the narrowed baseline (poly-check 4/4 jsforce, 4/4 simple-salesforce): SC4 live leg"
  - "Folded todo 2026-10-08-narrow-baseline-ownerid-per-object in .planning/todos/completed"
  - "BASE2-04 wording aligned with delivered scope and ticked"
affects: [10, 12, 14]
tech-stack:
  added: []
  patterns: ["a deliberately-warning upgrade scenario lives in its own test file with its own schema so the main upgrade fixture's EXPECTED_WARNINGS stays []"]
key-files:
  created:
    - packages/engine/src/upgrade-owner.test.ts
    - .planning/todos/completed/2026-10-08-narrow-baseline-ownerid-per-object.md
  modified:
    - .planning/phases/08-upgrade-safety-net-nullable-key-prefixes/08-GROUP-OWNED-AUDIT.md
    - .planning/REQUIREMENTS.md
key-decisions:
  - "D-14 scenario kept in its own file (upgrade-owner.test.ts), not in the upgrade fixture: the main contract stays warning-free, the Group-owned-row-on-a-User-only-object case warns exactly once"
  - "BASE2-04 wording amended to the 35 modelled objects (8 User-only incl. Event by D-12 override, 8 polymorphic incl. Group by override, 19 without OwnerId) with a Phase 10 forward clause; ticked because every clause is tested (09-08 SC4/D-15 tests, this plan's D-14 test, conformance 8/8 PASS)"
  - "The conformance_p09 schema created for the run is left in the local Docker database (dropping it is a destructive command, Johan's call), like the 11 test_* schemas from 09-07"
requirements-completed: [BASE2-04]
duration: 6min
completed: 2026-10-14
---

# Phase 9 Plan 09: D-14 upgrade case, Group-owned audit, conformance, todo Summary

A v1.0 database holding a Queue-owned Account now has a test proving the D-14 upgrade path (one `UNSUPPORTED:schema-fk foreign key fk_account_ownerid not added: account.ownerid holds 1 value(s) ...` warning, row untouched, FK added silently on the next run after the owner is corrected) on pglite and Postgres 16; every row of the Phase 8 Group-owned audit carries its Phase 9 disposition and the completeness loop prints nothing; the full conformance suite ran locally against the narrowed baseline and passed all 8 legs including `poly-check` on both SDKs (SC4); the folded todo is done and BASE2-04 is ticked under wording aligned with the delivered scope.

## Performance
- **Started:** 2026-10-14T07:44:33Z — **Completed:** 2026-10-14T07:50Z — **Duration:** ~6 min (plus the state/docs commit)
- **Tasks:** 1/1 — **Files:** 4 changed (1 created, 1 moved) + REQUIREMENTS.md/STATE.md/ROADMAP.md in the docs commit

## Commits
| Hash | Type | What |
|---|---|---|
| ccffff9 | test | upgrade-owner.test.ts (D-14), audit dispositions + new rows, todo moved to completed |
| (docs commit) | docs | SUMMARY, STATE, ROADMAP, REQUIREMENTS (BASE2-04 amended and ticked) |

## What was done

### D-14 scenario (`packages/engine/src/upgrade-owner.test.ts`)
Same `reconcileKeyPrefixes -> migrate -> bootstrapOrg` sequence and `test_<hex>` schema pattern as upgrade.test.ts. The v1.0 fixture baseline (`Account.OwnerId.referenceTo = ["User","Group"]`) accepts a Queue Group as the Account owner through the v1 `DmlEngine`; upgrading with the current baseline yields `migration.warnings` equal to exactly
`["UNSUPPORTED:schema-fk foreign key fk_account_ownerid not added: account.ownerid holds 1 value(s) with no matching row in user; correct or clear them and run orglet up again"]`
(the plan's predicted wording held, no adjustment), no `ADD CONSTRAINT "fk_account_ownerid"` statement, and `account.ownerid` unchanged. After `UPDATE account SET ownerid = <admin user>` a second `migrate` has `warnings: []` and exactly one `ADD CONSTRAINT "fk_account_ownerid"` statement. The main upgrade fixture is not extended (D-14), so `EXPECTED_WARNINGS` in upgrade.test.ts stays `[]`.

**TDD note:** the plan marked the task `tdd="true"`, but the behaviour under test already existed (Phase 8 schema-fk skip and retry, 09-08's `fk_account_ownerid`), so there was no failing RED run: the test passed on first execution on both backends. It is a scenario proof pinning D-14, committed as `test(...)`, not a behaviour change.

### Group-owned audit (`08-GROUP-OWNED-AUDIT.md`)
Every pre-existing row got its disposition from 09-08's table (stays on Case / changed in 09-08 / flipped / moved to Case / replaced by ownerTargets / reworded / accurate / User.json DelegatedApproverId stays as a non-owner v1.0-pinned lookup). Rows added: `packages/engine/src/upgrade-owner.test.ts` (D-14, DB row), `packages/formula/src/formula.test.ts` 152-153 (09-08 deviation 3, missed by the original grep), and under "Incidental / not owner-related" one row each for the 13 files the completeness loop reported MISSING: `build.test.ts` (ownerTargets loader tests), `baseline-generator.test.ts` (generator ownerTargets tests), `baseline-gate.test.ts`, `gen-baseline-typemap.test.ts`, `standard/README.md`, `PROVENANCE.json`, and the regenerated `Account`, `CampaignMember`, `Contact`, `Event`, `Profile`, `ServiceAppointment`, `SocialPost` object files (labels or non-owner referenceTo lists containing "Group"/"Queue"). Loop re-run: prints nothing; `grep -cE '\|\s*\|\s*$'` = 0. Nothing was excluded from the grep.

### Conformance (SC4 live leg), run locally
`pnpm build`, then `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet ORG_SCHEMA=conformance_p09 PORT=8093 PYTHON=conformance/describe-check/.venv/bin/python conformance/run-all.sh` against Docker `orglet-postgres` (Postgres 16), exit 0:

| Leg | Result | Detail |
|---|---|---|
| jsforce-subset | **PASS** | core: 4 suites, 51 passed, 60 skipped (111); bulk2: 1 suite, 12 passed, 5 skipped (17); orglet's own bulk2 check 29/29 |
| simple-salesforce | **PASS** | 14/14 |
| describe-check-jsforce | **PASS** | 14/14 |
| describe-check-python | **PASS** | 14/14 |
| poly-check-jsforce | **PASS** | 4/4 (name-object, type-filter, typeof, typeof-invalid) on a Queue-owned and a User-owned Case |
| poly-check-python | **PASS** | 4/4 |
| rollup-check-jsforce | **PASS** | 5/5 |
| rollup-check-python | **PASS** | 5/5 |

The `conformance/python/.venv` in the repo is an x86_64 anaconda 3.9 venv that no longer runs on this arm64 machine ("bad CPU type in executable"); `run-all.sh` takes `PYTHON`, so the working `conformance/describe-check/.venv` (Python 3.12.13, simple-salesforce installed) was used, as the poly-check README allows. No code change. The server started by `run-all.sh` was stopped by its trap; `pgrep` finds no `packages/cli/dist/index.js` and port 8093 is free. The throwaway schema `conformance_p09` is **left in the local database** (dropping it is destructive; `node packages/cli/dist/index.js reset --db postgres://orglet:orglet@localhost:5433/orglet --org-schema conformance_p09 --drop-prefixes` clears it). The 11 `test_*` schemas from 09-07 were not touched, as instructed.

### Todo
`git mv` of `.planning/todos/pending/2026-10-08-narrow-baseline-ownerid-per-object.md` to `.planning/todos/completed/` with an appended "Resolved by Phase 9 (09-02, 09-08): per-object ownerTargets." STATE.md's "Pending Todos" list updated accordingly in the docs commit.

## Verification (HEAD ccffff9)
- `pnpm vitest run packages/engine/src/upgrade-owner.test.ts packages/engine/src/upgrade.test.ts`: 5/5 on pglite and on Postgres 16.
- `pnpm test` (pglite): **38 files, 575 passed, 3 skipped** (pre-existing Phase 12 `it.fails`). `ORGLET_DATABASE_URL=... pnpm test` (Postgres 16): **38 files, 577 passed, 1 skipped**.
- `pnpm lint`: clean. `pnpm baseline:check`: "checked 36 files", exit 0 (its `warning: UNSUPPORTED:field-type Task.TaskWhoIds (JunctionIdList)` line is the generator's standing skip report, unchanged since 09-07).
- Acceptance: `grep -c "UNSUPPORTED:schema-fk" upgrade-owner.test.ts` = 1 (>= 1); empty dispositions = 0; completeness loop empty; todo file exists in completed and not in pending; conformance per leg above.

## Deviations from Plan

**1. [Orchestrator deviation, same precedent as 09-07 for BASE2-02/03] BASE2-04 wording amended to the delivered scope, then ticked.**
- *Before:* "`OwnerId.referenceTo` is defined per object from the Object Reference (User-only on Account, Contact, Opportunity, Contract, Asset, Campaign, Individual, Solution, ContentVersion; User and Group on Case, Lead, Task, SocialPost, Order, Location, ContactRequest, WorkOrder, ServiceAppointment, OperatingHours, ServiceContract; Calendar and User on Event; none on Quote, QuoteLineItem, Entitlement, Product2, Pricebook2, PricebookEntry, EmailMessage, FeedItem, Address), so plain `Owner.X` formula traversal and `Owner.X` SOQL compile on User-only objects while polymorphic behaviour from v1.0 is unchanged on queue-enabled objects."
- *After:* "`OwnerId.referenceTo` is defined per object by the generator as `ownerTargets`, derived from both sources (sf-skills and the Object Reference) for the 35 modelled objects: User-only on Account, Asset, Campaign, Contact, Contract, Event, Individual and Opportunity (Event by a reasoned override, D-12: the documented Calendar owner is not modelled; widen when a Calendar object lands); User and Group on the modelled objects whose owner stays polymorphic (Case, Lead, Task, SocialPost, ServiceAppointment, OperatingHours, ServiceContract, and Group by override because its documented Organization owner is not modelled); none on the 19 objects without `OwnerId` (Entitlement, Product2, Pricebook2, PricebookEntry among them). Plain `Owner.X` formula traversal and `Owner.X` SOQL compile on User-only objects while polymorphic behaviour from v1.0 is unchanged on queue-enabled objects, and a v1.0 database holding a Group-owned row on a now-User-only object upgrades with one `UNSUPPORTED:schema-fk` warning and no rewrite (D-14). Objects added from Phase 10 on (Solution, ContentVersion, Order, Location, ContactRequest, WorkOrder, Quote, QuoteLineItem, EmailMessage, FeedItem, Address) follow the same generator rule when they land." Plus a dated deviation note line.
- *Why:* the old list named 11 objects orglet does not model (Phase 10) and "Calendar and User on Event" where D-12 decided `["User"]`.
- *Evidence per clause:* per-object derivation and the 8/8/19 split (build.test.ts table test, baseline-generator.test.ts, 09-08); Event/Group overrides with reasons (overrides.json, baseline-generator.test.ts); `Owner.X` formula and SOQL on User-only objects (formula.test.ts, compile.test.ts, 09-08); polymorphic behaviour unchanged on queue-enabled objects (query/engine/api tests on Case; poly-check 4/4 on both SDK legs, this plan); D-14 (upgrade-owner.test.ts, this plan). Every clause is true and tested, so the box is ticked.
- ROADMAP SC4 does not repeat the object list (it names Account, Contact, Opportunity, Contract, Asset, Campaign and Case, Lead, Task, all of which hold), so it was not amended.

**2. [Environment] Python leg run through the describe-check venv.** `conformance/python/.venv` is a broken x86_64 venv; `PYTHON=conformance/describe-check/.venv/bin/python` passed to `run-all.sh` (supported env var). No file changed. Recreating `conformance/python/.venv` with `/opt/homebrew/bin/python3.12` is a one-liner for Johan if wanted; not done here (not part of the plan, and the venv is gitignored local state).

**3. [TDD] No RED phase possible** for the D-14 test: the behaviour pre-existed (see above). Recorded, not hidden.

Otherwise the plan executed as written.

## Phase 9 success criteria, final status
1. Determinism, CI drift gate, no prose: 09-04/09-05/09-07 (tests + `baseline-gen-check`).
2. No-op v1 diff, diff gate, MasterDetail refusal: 09-04/09-05/09-07.
3. Zero `UNSUPPORTED:standard-field` for modelled documented fields, skips in PROVENANCE.json, featureGated at baseline/check level: 09-07.
4. `Owner.Name` compiles on the six User-only objects, Case/Lead/Task owners still User and Group, poly-check green: 09-08 (unit/engine) + **this plan (conformance 8/8, poly-check 4/4 on both legs)**.
5. Phase 8 upgrade test green with v2 and only expected warnings: 09-07/09-08 (`EXPECTED_WARNINGS = []`), plus this plan's D-14 scenario for the one deliberate warning.

## Notes for later phases
- Phase 10: new owned objects go through `ownerTargetsFor`; a target outside User/Group or a missing Refers To aborts the generator until an `overrides.json` `ownerTargets` entry with a reason exists (09-08 deviation 1). A thin Calendar object would let Event widen to `["User","Calendar"]` (CONTEXT deferred).
- ROADMAP still carries "Phase 999.1: Narrow baseline OwnerId referenceTo per object (BACKLOG)", which Phase 9 has now delivered; left for `/gsd:review-backlog` (outside this plan's files).
- Local Docker database: `conformance_p09` plus the 11 `test_*` schemas remain; see the reset command above.

## Known Stubs
None.

## Self-Check: PASSED
Files (upgrade-owner.test.ts, completed todo, 08-GROUP-OWNED-AUDIT.md, this SUMMARY) and commit ccffff9 exist; pending todo file gone; completeness loop re-run after the audit edit: empty.
