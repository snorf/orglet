---
phase: 09-baseline-generator-parity-ownerid-narrowing
plan: 04
subsystem: baseline-generator
tags: [generator, determinism, v1-parity, pins, overrides, ci-drift-gate]
requires: [09-01, 09-02, 09-03]
provides:
  - "scripts/gen-baseline/pipeline.ts: pure generate(inputs, { v1Only }) -> { files, report }, serialise, orderObjectJson, CLI_OPTIONS, GeneratorError"
  - "scripts/gen-baseline/sources.ts: loadInputs(root), parseSfSkills, parseObjectReference, sourceFieldsOf -> SourceField"
  - "scripts/gen-baseline/typemap.ts: TYPE_MAP, mapType, flagsFrom, lengthFor, compoundParent, humanise with provenance"
  - "scripts/gen-baseline/generate.ts: pnpm baseline:gen (write), --check, --bootstrap-pins"
  - "scripts/gen-baseline/v1-pins.json: mechanically bootstrapped v1.0 pin layer (35 objects, 659 fields)"
  - "packages/metadata/standard/objects/*.json are generator output; CI job baseline-gen-check"
affects: [09-05, 09-06, 09-07, 10]
tech-stack:
  added: []
  patterns: ["pure pipeline + thin IO shell shared by CLI and vitest", "v1.0 pin layer: per-field exceptions over source-derived facts, null = key absent", "abort on unresolved source conflicts"]
key-files:
  created:
    - scripts/gen-baseline/errors.ts
    - scripts/gen-baseline/sources.ts
    - scripts/gen-baseline/typemap.ts
    - scripts/gen-baseline/pipeline.ts
    - scripts/gen-baseline/generate.ts
    - scripts/gen-baseline/v1-pins.json
    - packages/metadata/test/gen-baseline-typemap.test.ts
    - packages/metadata/test/baseline-generator.test.ts
  modified:
    - scripts/gen-baseline/overrides.json
    - packages/metadata/standard/objects/ (35 files, whitespace and field order only)
    - .github/workflows/ci.yml
key-decisions:
  - "20 of the 35 v1.0 files were not code-unit sorted; D-19 sorting is applied and the parity test compares fields by name, so the reformat is whitespace plus field order, never content"
  - "combobox maps to Picklist, id is skipped as a system field; Restricted picklist is mapped to restrictedPicklist (2 pins instead of 64)"
  - "BusinessProcess needs no keepObject (documented in the Object Reference); 19 v1.0 fields need keep entries, not one"
requirements-completed: []
duration: 14min
completed: 2026-10-13
---

# Phase 9 Plan 04: Deterministic generator, v1.0 parity (step A) and CI drift gate Summary

A pure, offline generator (`scripts/gen-baseline/`, run with tsx) reproduces all 35 v1.0 standard objects field for field from the sf-skills snapshot, the Object Reference extraction, a mechanically bootstrapped v1.0 pin layer and overrides.json; the committed object files are now its byte output and CI fails on any drift.

## Commits
| Hash | Type | What |
|---|---|---|
| fd89632 | test | RED: 21 typemap/sources tests |
| f17696e | feat | errors.ts, sources.ts, typemap.ts (GREEN) |
| 25c3e85 | feat | pipeline.ts (pure generate, serialise, key orders), generate.ts (write / --check / --bootstrap-pins) |
| 15c690e | fix | bootstrapped pin keys follow FIELD_KEY_ORDER |
| c237b4b | chore | reformat 35 standard objects as generator output (whitespace and field order only) |
| b1dd1ac | feat | v1-pins.json, 19 keep entries, baseline-generator.test.ts (6 tests), CI job baseline-gen-check |
| d091faf | fix | typemap.ts `sfTextLength` helper that 25c3e85 imported but left unstaged (commits 25c3e85..b1dd1ac do not typecheck in isolation; HEAD does) |

## Numbers (generate(inputs, { v1Only: true }) on the committed inputs)
- 35 objects, 659 v1.0 fields: **241 reproduced from the sources with an empty pin, 418 need at least one pin** (test floor: >= 200 unpinned).
- Source conflicts: **1** (`Individual.Name.length`: sf-skills field_reference 121 vs Object Reference maximum), settled by pin. Override-resolved: 0. Generation aborts on any unresolved conflict.
- Guessed facts emitted: 89 (scale 49, precision 22, label 17, length 1). Unsupported field types in v1.0 scope: 0.
- Pin key frequency: label 89, picklistValues 68, defaultValue 67, nillable 46 (36 `null`), referenceTo 37, precision 37, createable 37 (15 `null`), relationshipName 35, childRelationshipName 34, nameField 33, length 33 (20 `null`), standardValueSet 32, compoundFieldName 32, updateable 31 (14 `null`), type 30, defaultedOnCreate 28 (15 `null`), scale 11, displayFormat 3, restrictedPicklist 2, unique 2, sortable 1, groupable 1, idLookup 1.
- Type pins (30): the 19 keep fields below, 3 AutoNumber (Case.CaseNumber, Contract.ContractNumber, ServiceAppointment.AppointmentNumber), 4 `Name` compounds (Contact, Individual, Lead, User `.Name`), 4 `currency` documented fields typed Number in v1.0 (Campaign.HierarchyNumberOf{ConvertedLeads,Leads,Opportunities,Responses}). Exactly what research predicted.
- Reformat proof (against HEAD before c237b4b, per file `isDeepStrictEqual` after sorting both field lists by name): 0 files differ in content; 20 reordered, 14 whitespace only, 1 byte-identical.

## Keep entries written to overrides.json (reason "present in v1.0, absent from sources")
Account.Tier; Case.EntitlementId, Case.MilestoneStatus, Case.MilestoneStatusIcon, Case.ProductId, Case.SlaExitDate; Event.Attendees, Event.Email, Event.Phone, Event.ServiceAppointmentId; Lead.CampaignId, Lead.DoNotCall, Lead.LastTransferDate; Product2.SellerId, Product2.SourceProductId; Task.Email, Task.Phone; User.IsSystemControlled, User.WorkspaceId. No `keepObject` entry: BusinessProcess is in the Object Reference (09-03) and its `Name` derives from it with a single `nameField` pin.

## Verification (run on HEAD d091faf)
- `pnpm vitest run packages/metadata/test/gen-baseline-typemap.test.ts`: 21 passed. `packages/metadata/test/baseline-generator.test.ts`: 6 passed (RED before regeneration on "committed == regenerated", GREEN after).
- `pnpm vitest run packages/metadata`: 8 files, 128 passed. `pnpm test`: 35 files, 531 passed, 3 skipped (the pre-existing `it.fails` Phase 12 expectations in formula/expectations.test.ts). pglite only; Docker Postgres not run.
- `pnpm lint`, `pnpm typecheck:scripts`: clean.
- `pnpm baseline:gen` twice then `pnpm baseline:check`: "checked 35 object files"; `git status --porcelain -- packages/metadata/standard` empty.
- `git diff --stat main -- packages/metadata/test/fixtures/baseline-v1.0`: empty (fixture untouched). v1-pins.json has 35 objects; 19 keep entries (>= 2).
- Acceptance greps all satisfied (CLI_OPTIONS 1; no readFile/writeFile/process./Date( or localeCompare or "description" in pipeline.ts; --check and --bootstrap-pins present; baseline-gen-check and the porcelain line once in ci.yml).

## Deviations from Plan
1. **[Plan premise wrong] The v1.0 files are not code-unit sorted.** 20 of 35 fixture files were hand-ordered (e.g. Account appends `CleanStatus`/`DandbCompanyId` after `Industry`). D-19 (locked) mandates the sort, so the generator sorts and the "whitespace only" reformat is in fact whitespace plus field order; the parity test sorts the fixture's fields by name before `toEqual` and the reformat commit message says so. No field content changed (proof above). Describe field order for newly built databases changes accordingly (research Pitfall 5 accepts this); the full suite is green.
2. **[Finding from 09-03] BusinessProcess is in the Object Reference**, so no `keepObject`; the plan's "Account.Tier and BusinessProcess" became 19 `keep` field entries (listed above). The `>= 2` acceptance grep holds.
3. **Property-token spellings** in the real sources are `idLookup`, `Namefield`, `Restricted picklist`, `Defaulted on create or filter`, not the plan's `Idlookup`/`ID lookup`/`Name Field`; tokens are matched by letters only (spaces removed, lower-cased) against 09-03's KNOWN_PROPERTY_TOKENS, and sf-skills' comma-less `"Sort Update"` is split. `Restricted picklist` -> `restrictedPicklist` was added to the flag map (sources state it; result: 2 pins instead of 64).
4. **Type tokens 09-03 flagged:** `combobox` -> Picklist (Event/Task `Subject`, v1.0 Picklist with standardValueSet), `id` -> skip (system). `junctionidlist`, `base64`, `anytype`, `complexvalue`, `location` skip with `UNSUPPORTED:field-type` (none in v1.0 scope).
5. **Geolocation 18,15 is reported `guessed`** (the sources state no precision for doubles; the value is a v1.0 convention), unlike the plan's wording "18,15" without a tag.
6. **API details:** `deriveFromSources` returns `Map<name, DerivedField>` (`json` + `conflicts` + `provenance` + optional `skip`) because `--bootstrap-pins` needs the conflicts; `serialise` is the plain stringify and the key-order enforcement (unknown key such as `description` throws) lives in `orderKeys`/`orderObjectJson`, which `generate` applies before serialising. A Lookup/MasterDetail still lacking `referenceTo` after pins and overrides is a `GeneratorError` (Rule 2: never emit an invalid object file).
7. **Process slip:** the `sfTextLength` refactor of typemap.ts was left unstaged in 25c3e85 and committed in d091faf; intermediate commits 25c3e85..b1dd1ac fail `typecheck:scripts` on their own.

## Notes for downstream plans
- `generate(inputs, { v1Only: false })` already selects the inventory from the sources plus `keep` entries, drops `skip` overrides and writes `keyPrefixSource`; it does not yet write `ownerTargets`, `featureGated`, PROVENANCE.json or the MasterDetail refusal (09-06/09-07). Objects without `pins.<Obj>.object` facts abort: 09-07 must supply label/labelPlural/hasOwner for any new object through the pin or override layer.
- Flag pins with `null` (36 nillable, 15 createable, 14 updateable, 15 defaultedOnCreate) are places where the sources say "not nillable/createable/..." but v1.0 does not; D-17 lets a later plan delete those pins to adopt the documented flags. Schema-level pins (type, length, precision, scale) must stay or be allowlisted (D-16/D-17), e.g. `UserLicense.Name` 80 vs 40.
- `Individual.Name.length`: v1.0 121 is the pinned value; the sources disagree (field_reference 121 vs PDF maximum); any change is a deliberate override.

## Requirements
Plan frontmatter lists BASE2-01 and BASE2-02. Neither ticked here: BASE2-01 was completed in 09-01; BASE2-02 requires step B (every documented field plus the diff gate, 09-06/09-07), only step 1 (no-op against v1.0) is true now.

## Known Stubs
None.

## Self-Check: PASSED
