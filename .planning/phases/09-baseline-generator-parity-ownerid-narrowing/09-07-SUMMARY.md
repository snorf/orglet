---
phase: 09-baseline-generator-parity-ownerid-narrowing
plan: 07
subsystem: baseline-generator
tags: [base2-02, base2-03, sc3, sc5, v2-baseline, provenance, feature-gated, diff-gate, postgres-locks]
requires: [09-04, 09-05, 09-06]
provides:
  - "packages/metadata/standard/objects/*.json: v2 baseline, 35 objects, 2 536 fields (659 v1.0 byte-identical + 1 877 new), 135 featureGated"
  - "packages/metadata/standard/PROVENANCE.json: per-fact provenance, source pins, counts, skipped/forcedNullable/gating lists"
  - "packages/metadata/standard/README.md: rules for generated files (attribution, hand-fact locations, featureGated, ownerTargets, skips, provenance)"
  - "scripts/gen-baseline/overrides.json: 13 set referenceTo entries (Johan's 09-06 settle-conflicts name rule)"
  - "pipeline.ts: CLI_OPTIONS full mode; prose-label guard (SC1); pinned v1.0 names always in the inventory"
  - "packages/metadata/test/documented-fields.test.ts: SC3 proof with SKIP_RATIO_MAX"
  - "orglet check: 'N feature-gated standard fields included (...)' line (D-10)"
  - "vitest.config.ts: maxWorkers 3 on Postgres (v2 schemas exhaust a default lock table otherwise)"
affects: [09-08, 09-09, 10, 14]
tech-stack:
  added: []
  patterns: ["generator rejects documentation prose at the label level instead of relying on the test scan alone", "v1.0 pins are the inventory floor in every mode so a dropped field aborts rather than vanishing", "Postgres test leg bounds vitest workers because one migrate() transaction holds ~700 locks on a v2 schema"]
key-files:
  created:
    - packages/metadata/standard/PROVENANCE.json
    - packages/metadata/test/documented-fields.test.ts
  modified:
    - scripts/gen-baseline/pipeline.ts
    - scripts/gen-baseline/overrides.json
    - scripts/gen-baseline/generate.ts
    - packages/metadata/standard/objects/ (35 files)
    - packages/metadata/standard/README.md
    - packages/metadata/src/build.test.ts
    - packages/metadata/test/baseline-generator.test.ts
    - packages/metadata/test/baseline-gate.test.ts
    - packages/engine/src/upgrade.test.ts
    - packages/api/src/describe.test.ts
    - packages/cli/src/main.ts
    - packages/cli/src/main.test.ts
    - vitest.config.ts
    - .planning/ROADMAP.md
    - .planning/REQUIREMENTS.md
key-decisions:
  - "A sf-skills field_reference label that ends a sentence or exceeds 80 characters is documentation prose (87 Profile Permissions* fields): the generator emits the humanised name as a guessed label; the SC1 test scan is a second line of defence, not the first"
  - "Pinned v1.0 field names are always in the generator's inventory, so a v1.0 field both sources dropped aborts in full mode exactly as in v1-only mode"
  - "SKIP_RATIO_MAX = 0.103: Johan's accepted 83/818 assumed all 13 name-rule fields were documented; Product2.RecordTypeId is field_reference-only, so the documented count is 84/818 = 0.1027 (raw 99/818 = 12.1 % matches the decision exactly)"
  - "Postgres test leg runs with maxWorkers 3: a v2 org schema is ~500 relations and ~190 FKs in one migrate() transaction, and ten parallel files exhausted a default Postgres lock table"
  - "BASE2-02 and BASE2-03 ticked under the amended wording; BASE2-01 not ticked (its 'owner targets in overrides.json' clause lands in 09-08)"
requirements-completed: [BASE2-02, BASE2-03]
duration: 17min
completed: 2026-10-14
---

# Phase 9 Plan 07: Step B landing — v2 baseline regenerated, SC3 proven, wording aligned Summary

The committed baseline is now the generator's full-mode output: the 35 standard objects grow from 659 to 2 536 fields (every v1.0 field byte-identical, the diff gate returns `[]` with an empty allowlist), 135 of them `featureGated`, with `PROVENANCE.json` beside them; a retrieve declaring every documented field of the 35 yields `UNSUPPORTED:standard-field` only for the 99 fields the generator reports as skipped (84 documented, 10.27 %), the populated v1.0 database upgrades with ADD COLUMN/ADD CONSTRAINT only and no warnings on pglite and Postgres 16, and `orglet check` prints the gated count.

## Performance
- **Started:** 2026-10-14T07:04:38Z — **Completed:** 2026-10-14T07:22Z — **Duration:** ~17 min
- **Tasks:** 3/3 — **Files:** 51 changed (2 created)

## Commits
| Hash | Type | What |
|---|---|---|
| 92577c3 | feat | v2 regeneration (35 objects + PROVENANCE.json), 13 referenceTo overrides, prose-label guard, pinned-inventory fix, README rewrite, contract-change test edits, upgrade ADD COLUMN assertion |
| 98c5e11 | test | RED: documented-fields.test.ts (SC3 + SKIP_RATIO_MAX), describe gated-parity test, main.test gated-count line |
| cf28a59 | feat | `check()` prints `N feature-gated standard fields included (...)` (GREEN) |
| b0bfe45 | docs | ROADMAP SC3 and REQUIREMENTS BASE2-02/BASE2-03 wording aligned with delivered scope, dated note |
| d91355d | fix | vitest `maxWorkers: 3` when `ORGLET_DATABASE_URL` is set (Postgres lock table) |

## Johan's 09-06 decision applied: settle-conflicts name rule
13 `overrides.json` entries `set: { referenceTo: [<Name>] }`, each with the reason `settle-conflicts rule (09-06 checkpoint): field name names modelled object <Name>; neither source states Refers To`: Account.PersonContactId -> Contact, Account.PersonIndividualId -> Individual, BusinessHours.BusinessHoursId -> BusinessHours, Entitlement.{AccountId -> Account, AssetId -> Asset, BusinessHoursId -> BusinessHours, ServiceContractId -> ServiceContract}, Lead.PartnerAccountId -> Account, Opportunity.PartnerAccountId -> Account, Product2.RecordTypeId -> RecordType, ServiceContract.{AccountId -> Account, ContactId -> Contact, Pricebook2Id -> Pricebook2}. Hand facts (D-06), no generator inference. `relationshipName` is written only where a source states it (none of the 13 do), as for every other new lookup.

**BusinessHours.BusinessHoursId is a self-reference**, kept as decided. The schema layer handles self-referencing lookups already (Account.ParentId, User.ManagerId hierarchies): `ALTER TABLE businesshours ADD CONSTRAINT ... FOREIGN KEY (businesshoursid) REFERENCES businesshours (id)` ran in the upgrade test on both backends with no warning, and the field is `createable: false, updateable: false` (field_reference-only), so no write path can set it. Whether Salesforce's BusinessHours really has such a field is a question for the sources, not for orglet; it is flagged here as the one mechanical match of the rule that is semantically odd.

**Side effects of the rule**: three of the 13 are gated (Account.PersonContactId person-accounts; Lead/Opportunity.PartnerAccountId enabled-phrase), so gated count is 135, not 132; Entitlement.AccountId is documented required and is now the 9th forced-nullable field.

## Numbers (full mode on the committed inputs, HEAD d91355d)
| Measure | 09-06 report | Landed |
|---|---|---|
| Documented new fields | 818 | 818 |
| Generated new fields | 1 864 | **1 877** |
| Skipped total (documented / sdk-only) | 112 (96 / 16) | **99 (84 / 15)**: 5 field-type, 94 reference-target (66 none stated, 28 outside the list) |
| Documented skip ratio | 11.7 % | **84/818 = 10.27 %** (SKIP_RATIO_MAX 0.103; see deviation 3) |
| Raw skip ratio | 13.7 % | 99/818 = 12.1 % (Johan's accepted raw figure exactly) |
| Feature-gated | 132 | **135** (person-accounts 45, social 44, enabled-phrase 22, chatter 14, data-com 5, field-service 3, knowledge 2, org-feature-phrase 1) |
| Forced nullable | 8 | **9** (+ Entitlement.AccountId) |
| Conflicts settled by override / unresolved | 12 / 0 | 12 / 0 |
| Guessed labels | — | 315 (87 of them prose replaced, see deviation 1) |
| Total fields | 2 523 | **2 536** |
| PROVENANCE.json | 377 561 B | 378 487 B; fact totals verified 3 297, sdk-only 5 896, v1.0 588, guessed 603, doc-only 40, override 25 |

### Field count per object (v1.0 -> v2, gated)
| object | v1.0 | v2 | gated | | object | v1.0 | v2 | gated |
|---|---|---|---|---|---|---|---|---|
| Account | 57 | 123 | 45 | | OperatingHours | 1 | 7 | 0 |
| Asset | 26 | 68 | 14 | | Opportunity | 37 | 46 | 1 |
| BusinessHours | 3 | 20 | 0 | | OpportunityHistory | 0 | 10 | 0 |
| BusinessProcess | 1 | 5 | 0 | | OpportunityLineItem | 16 | 24 | 0 |
| CallCenter | 1 | 5 | 0 | | Organization | 39 | 90 | 0 |
| Campaign | 38 | 62 | 0 | | Pricebook2 | 7 | 10 | 0 |
| CampaignMember | 27 | 31 | 1 | | PricebookEntry | 8 | 11 | 0 |
| Case | 41 | 49 | 3 | | Product2 | 17 | 47 | 2 |
| Contact | 59 | 79 | 2 | | Profile | 12 | 1035 | 0 |
| Contract | 42 | 54 | 0 | | RecordType | 8 | 8 | 0 |
| DandBCompany | 1 | 113 | 0 | | ServiceAppointment | 1 | 56 | 2 |
| Entitlement | 1 | 17 | 0 | | ServiceContract | 1 | 46 | 0 |
| Event | 37 | 52 | 1 | | SocialPost | 1 | 57 | 44 |
| ExternalDataSource | 1 | 11 | 0 | | Task | 35 | 38 | 0 |
| Group | 7 | 9 | 0 | | User | 62 | 226 | 16 |
| IdeaTheme | 1 | 8 | 0 | | UserLicense | 2 | 9 | 1 |
| Individual | 3 | 27 | 0 | | UserRole | 12 | 14 | 0 |
| Lead | 54 | 69 | 3 | | **Total** | **659** | **2536** | **135** |

### Skips per object (kind; documented and sdk-only together)
Account ref 5, Asset ref 5, Campaign ref 4, CampaignMember ref 1, Case ref 6, Contact ref 6, Contract ref 4, Entitlement ref 8, Event type 4, ExternalDataSource ref 4, Group ref 1, IdeaTheme ref 1, Lead ref 7, Opportunity ref 8, OpportunityLineItem ref 2, Organization ref 9, Pricebook2 ref 1, PricebookEntry ref 1, Product2 ref 6, ServiceAppointment ref 8, ServiceContract ref 2, SocialPost ref 2, Task type 1 + ref 3. All listed in `PROVENANCE.json#skipped`.

## Diff gate and allowlist
`diffGate(v1 fixture, regenerated v2, allowlist)` returns `[]`; `diff-allowlist.json` stays `{ "entries": [] }` — no v1.0 field removed or narrowed, no schema-level pin touched, nothing allowlisted. The gate test needed one fix: `regenerate()` now parses only `objects/*` (it had parsed PROVENANCE.json as an object and tripped `validateBaseline`).

## SC5: upgrade test (packages/engine/src/upgrade.test.ts)
`expect(migration.statements.some((s) => /^ALTER TABLE \S+ ADD COLUMN /.test(s))).toBe(true)` added; `EXPECTED_WARNINGS` stays `[]` (comment updated: every change is an ADD COLUMN or an FK the fixture rows satisfy). **Result: 3/3 passed on pglite (4.9 s) and 3/3 passed on Postgres 16 (`ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet`, 5.2 s)** — the v1.0 fixture org upgrades with ADD COLUMN / ADD CONSTRAINT only, rows identical on their v1.0 columns, second `up` silent.

## SC3 proof (Task 2)
- `documented-fields.test.ts`: writes a temp SFDX project with a `<fullName>`-only field file for every documented field of the 35 (sf-skills `fields` ∪ Object Reference, minus `__c`, system names case-insensitively, override skips; one file per lower-cased name because macOS file systems are case-insensitive), builds the schema on the live baseline and asserts the `standard-field` diagnostics equal exactly the generator's skipped set restricted to the written names, zero `reference-target`, warning count = skipped count. 2 437 field files written; passes. Second test: `skippedDocumented / documentedNew <= SKIP_RATIO_MAX` with per-object counts in the failure message.
- `describe.test.ts`: `Contact.JigsawContactId` (Text 20, gated) and `Contact.Jigsaw` (Text 20) describe with identical key sets, gated `nillable: true`, no `featureGated` key (D-10). `grep -c featureGated packages/api/src/describe.ts` = 0.
- `main.test.ts`: `main(["check"])` logs `135 feature-gated standard fields included (nullable; present in an org only when the feature is enabled)`; absent with `--quiet`. This was the only RED test; the other two pinned behaviour that was already true after Task 1 (recorded, not hidden).

## Tests edited and why
| File | Change | Reason |
|---|---|---|
| build.test.ts | thin "carries only ..." -> "keeps its v1.0 fields and only gains documented ones": fixture v1.0 names must equal the phase-3 THIN shape and be a subset of the live object | Planned contract change (BASE2-02 supersedes phase 3); "field details" and "reference" tests unchanged |
| baseline-generator.test.ts | "committed ... exactly the CLI regeneration" compares `objects/*` + `PROVENANCE.json`; SC1 scan keeps the 100-char bound for object files only (PROSE regex still applies everywhere) | PROVENANCE.json is now committed output; its `Obj.Field -> A, B, ...` target lists are not prose (`ServiceAppointment.ParentRecordId -> ...` is 125 chars) |
| baseline-gate.test.ts | `regenerate()` filters `objects/` | PROVENANCE.json is not an object |
| upgrade.test.ts | ADD COLUMN assertion; comment | Plan step 3 |
| describe.test.ts, main.test.ts, documented-fields.test.ts | new tests | Task 2 |

## Verification (HEAD d91355d)
- `pnpm test` (pglite): 37 files, 565 passed, 3 skipped (pre-existing Phase 12 `it.fails`). `ORGLET_DATABASE_URL=... pnpm test` (Postgres 16): 37 files, 567 passed, 1 skipped, 24 s (after the maxWorkers fix; before it 4 files died in hooks with `out of shared memory`).
- `pnpm lint`, `pnpm typecheck:scripts`: clean. `pnpm baseline:check`: "checked 36 files", exit 0. `pnpm baseline:gen` twice: `git status --porcelain -- packages/metadata/standard` empty.
- Acceptance greps: `v1Only: false` in pipeline.ts 2 (CLI_OPTIONS and its doc comment); `"featureGated": true` in 13 object files (Contact, Lead included); `"keyPrefixSource"` once in each of the 35 object files; README "Skip fields that only exist" 0, "featureGated" 1; `ADD COLUMN` in upgrade.test.ts 3; `feature-gated standard fields included` in main.ts 1; `featureGated` in describe.ts 0; `SKIP_RATIO_MAX` in documented-fields.test.ts 3; ROADMAP "listed in `PROVENANCE.json`" 1, "Wording of SC3 aligned" 1; REQUIREMENTS "Deviation note" 1.
- Prose scan of the committed object files (strings > 100 chars, sentence pattern, trailing terminator): 0 hits.

## Deviations from Plan

**1. [Rule 1 - Bug] 87 sf-skills `field_reference` labels are documentation prose.** The first full regeneration tripped the SC1 scan: `Profile.PermissionsActivationWrite.label = "Allows use to hit cleanroom API while creating activations."` and 86 more Profile `Permissions*` labels are sentences (longest 215 chars). Committing them would have put Salesforce documentation prose into the repo. Fix in `pipeline.ts#deriveField`: a label that ends with `.`/`!`/`?` or exceeds 80 characters is treated as prose, the humanised name is used and the label is reported `guessed`. A first version also matched a sentence break (`/[.!?] [A-Z]/`) and broke v1-only parity on `Contact.AssistantPhone` ("Asst. Phone"); narrowed to the two rules above. Commit 92577c3.

**2. [Rule 2 - Correctness] A pinned v1.0 field that both sources dropped vanished silently in full mode.** The 09-05 failure-mode test ("aborts without a keep entry") went red under `CLI_OPTIONS = { v1Only: false }`: full mode built its inventory from the sources and `keep` entries only, so a v1.0 field missing from both sources was never iterated and the abort never fired (the diff gate would have caught the removal, but the generator's own contract is to abort). Pinned names are now added to the inventory in both modes; output unchanged (every pinned name is in a source or has a keep entry). Commit 92577c3.

**3. [Plan premise off by one] SKIP_RATIO_MAX is 0.103, not 0.1015.** Johan's 09-06 computation assumed all 13 name-rule fields were documented; `Product2.RecordTypeId` is `field_reference`-only, so the documented skip count is 84, not 83: 84/818 = 0.1027. The raw figure (99/818 = 12.1 %) matches the decision exactly. The constant is rounded up to three decimals and the comment states the arithmetic. **Johan should confirm** the 0.103 bound (or ask for 84/818 verbatim); lowering it is a decision, not a code fix.

**4. [Rule 3 - Blocking] Postgres 16 suite failed with `out of shared memory`.** A v2 org schema is 39 tables, 263 indexes, 192 FKs (v1: ~130 indexes, 91 FKs); `migrate()` creates them in one transaction (~700 locks), and vitest ran 10 files in parallel on this machine. The default lock table (`max_locks_per_transaction` 64 × 100 connections) overflowed: bulk.test, bootstrap.test, query.test, upgrade.test died in hooks and one api.test insert failed as collateral. Fix: `vitest.config.ts` sets `maxWorkers: 3` when `ORGLET_DATABASE_URL` is set (harness only; pglite unchanged; CI's service container cannot take a `-c max_locks_per_transaction` command, so raising the server setting was not an option there). Full Postgres run: 24 s, all green. `orglet up` alone is unaffected (one transaction may use the whole table). Commit d91355d. Note: 11 `test_*` schemas from the crashed runs are left in the local `orglet` database; `DROP SCHEMA test_... CASCADE` (or `pnpm db:down && pnpm db:up` with a fresh volume) clears them — not done here (destructive, Johan's call).

**5. generate.ts prints "wrote/checked 36 files"** instead of "object files": PROVENANCE.json is now part of the checked output (it was already compared by `--check` through the `files` loop; only the message was wrong).

**6. Test fixes beyond the planned thin test** (listed above): PROVENANCE.json in the generator and gate tests, SC1 length bound scoped to object files. All are consequences of PROVENANCE.json becoming committed output, as 09-06's notes predicted.

## Requirements
Frontmatter: BASE2-01, BASE2-02, BASE2-03, MIGR-03.
- **BASE2-02 ticked**: step 1 (no-op against v1.0: parity test), step 2 (every documented field with type/length/flags: 1 877 new fields, documented-fields test), zero `UNSUPPORTED:standard-field` for modelled fields with the generator-reported exceptions listed in PROVENANCE.json — true and tested under the amended wording.
- **BASE2-03 ticked**: gated fields are nullable, tagged `featureGated` in the JSON (135), described as plain nullable fields (describe.test), tag visible in `orglet check` (main.test) — true and tested under the amended wording.
- **BASE2-01 not ticked**: its wording puts "owner targets" among the hand facts in `overrides.json`; no `ownerTargets` override exists yet (09-08). Everything else in it is true (deterministic, byte-identical, CI drift gate, provenance marks, no prose).
- **MIGR-03**: ticked by 09-05; the gate ran on the real v2 output here and returned `[]`.

## Notes for 09-08 / 09-09
- `ownerTargets` is not emitted; `OBJECT_KEY_ORDER` already has the slot and `validateOverrides` checks its reason.
- The Postgres test leg now runs 3 workers; if 09-08 adds FK targets (ownerTargets does not add constraints) nothing changes.
- `report.guessed` now counts 315 labels; `--report` is the review list if Johan wants to hand-label any Profile permission.

## Known Stubs
None.

## Self-Check: PASSED
Files (PROVENANCE.json, documented-fields.test.ts, README.md, vitest.config.ts, main.ts, this SUMMARY) and commits 92577c3, 98c5e11, cf28a59, b0bfe45, d91355d exist; acceptance greps re-run after writing: 13 gated object files, keyPrefixSource once in 35/35, `v1Only: false` 2, `ADD COLUMN` 3.
