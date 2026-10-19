---
phase: 09-baseline-generator-parity-ownerid-narrowing
plan: 01
subsystem: baseline-generator
tags: [vendoring, sf-skills, scripts, typecheck, key-prefix]
requires: []
provides:
  - pinned sf-skills enterprise_api snapshot (34 objects) with sha256 manifest
  - scripts/gen-baseline/objects.json (35 names, data input)
  - scripts/gen-baseline/overrides.json (keyPrefix facts for 35 objects)
  - tsconfig.scripts.json and pnpm typecheck:scripts CI step
affects: [09-03, 09-04]
tech-stack:
  added: []
  patterns: [SHA-pinned vendoring with offline sha256 manifest test]
key-files:
  created:
    - scripts/sync-sfdocs.sh
    - scripts/gen-baseline/objects.json
    - scripts/gen-baseline/overrides.json
    - scripts/gen-baseline/source/sf-skills/
    - tsconfig.scripts.json
    - packages/metadata/test/sfdocs-vendor.test.ts
  modified:
    - tsconfig.test.json
    - package.json
    - .github/workflows/ci.yml
key-decisions:
  - "Only Account has a verifiable public SDK fixture for its key prefix; the other 34 are recorded as unverified (no org consulted)"
requirements-completed: [BASE2-01]
duration: 20min
completed: 2026-10-13
---

# Phase 9 Plan 01: Inputs and scaffolding Summary

Pinned sf-skills snapshot (4bbae5c, 34 of 35 objects) vendored unmodified with a sha256 manifest checked offline by vitest, plus key-prefix facts for all 35 objects and lint/typecheck coverage for `scripts/**/*.ts`.

## Commits
- d99849f chore: sync script, object list, scripts typecheck, baseline:* root scripts, CI step
- d863e4d feat: vendored snapshot + `packages/metadata/test/sfdocs-vendor.test.ts`
- 99a0a5a feat: key prefix facts in overrides.json

## Verification
- Re-sync into a temp dir at the same SHA: `diff -r -x VENDOR.md` empty, and the `## Files (sha256)` sections are identical (reproducible).
- `vitest run packages/metadata/test/sfdocs-vendor.test.ts`: 2 passed. `pnpm lint`: clean.
- Not run: `pnpm typecheck:scripts` (no scripts `.ts` yet; CI step is guarded until plan 09-03). Full test suite not run (only the new test, to avoid contending with parallel plan 09-02).
- All 35 `keyPrefix.value` equal the v1.0 baseline prefixes (checked per file).

## Missing upstream
`BusinessProcess` only (recorded in VENDOR.md). The generator must keep it whole via overrides (plan 09-04).

## Observed sf-skills shape (for plan 09-04 `sources.ts`)
Top-level keys: `sections, title, description, fields_columns, fields, ispersonaccount_fields, special_access_rules, usage, associated_objects, wsdl_segment, field_reference, field_reference_columns` (not every object has every key).
- `fields_columns`: `["type","properties","description","relationship_name","refers_to","relationship_type"]`
- `fields.<Name>` entry keys seen across all objects: `type, properties, description, relationship_name, refers_to, relationship_type, required`. `properties` is a comma-separated flag string, e.g. `"Create, Defaulted on create, Filter, Group, Sort, Update"`.
- `field_reference_columns`: `["field_label","type","length","precision","scale","digits"]`; entries hold those keys; values are strings (e.g. `"length":"18"`).
- `ispersonaccount_fields` is a second `fields`-like map (Account), a gating signal.
- Trap: `wsdl_segment` for Account lists org-specific custom fields (`Active__c`, `SLA__c`, ...) and relationship child names; the generator must ignore `__c` and non-field `tns:QueryResult` entries.

## Key prefix table
| Object | prefix | source | ref |
|---|---|---|---|
| Account | 001 | sdk-fixture | jsforce@9bae14e:test/query-pagination.mock.test.ts:59 |
| all other 34 (Asset 02i, BusinessHours 01m, BusinessProcess 019, CallCenter 04v, Campaign 701, CampaignMember 00v, Case 500, Contact 003, Contract 800, DandBCompany 06E, Entitlement 550, Event 00U, ExternalDataSource 0XC, Group 00G, IdeaTheme 0Bg, Individual 0PK, Lead 00Q, OperatingHours 0OH, Opportunity 006, OpportunityHistory 008, OpportunityLineItem 00k, Organization 00D, Pricebook2 01s, PricebookEntry 01u, Product2 01t, Profile 00e, RecordType 012, ServiceAppointment 08p, ServiceContract 810, SocialPost 0ST, Task 00T, User 005, UserLicense 100, UserRole 00E) | as listed | unverified | none |

Counts: doc 0, sdk-fixture 1, unverified 34. Reasons: jsforce and simple-salesforce fixtures only name a type explicitly for Account; `User` 005 appears once (`Owner.Id NOT IN ('00510000000N2C2')`, soql-builder.test.ts:192) but without an explicit type, so it was not counted. Public Salesforce help/developer pages are JS shells that return no readable content via curl, so no `doc` source could be cited. Nothing came from an org. No public source was found for the reserved custom-object (`a00..azz`) or `m0` ranges.

## overrides.json schema (fixed here; generator validates in 09-04)
```
{ "objects": { "<Object>": {
    "keyPrefix":   { "value", "source": "doc|sdk-fixture|unverified", "ref"? },
    "keepObject":  { "reason" },
    "ownerTargets":{ "value": ["User"|"Group"], "reason", "ref"? },
    "fields": { "<Field>": one of
        { "keep": {"reason"} } | { "set": {<StandardFieldJson keys>}, "reason" } |
        { "featureGated": true|false, "reason" } | { "skip": true, "reason" } } } } }
```
Every entry except `keyPrefix` with `source: unverified` needs a non-empty `reason`; `ref` is required for `doc` and `sdk-fixture`.

## Deviations from Plan
None. One lint fix in the new test (`no-regex-spaces`, used `{2}`).

## Self-Check: PASSED
Files and commits d99849f, d863e4d, 99a0a5a exist.
