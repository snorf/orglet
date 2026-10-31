---
phase: 14-check-report-enterprise-acceptance
verified: 2026-10-31T00:00:00Z
status: passed
score: 4/4 success criteria verified
re_verification:
  previous_status: gaps_found
  previous_score: 3/4
  gaps_closed:
    - "reference-target 50: bare FieldDefinition values (14-08)"
    - "formula 1: relationshipName for 14 lookups plus baseline:check guard (14-09)"
    - "formula 1: implied standard-field root in the report (14-10)"
    - "standard-field round 2 (14-11)"
    - "counted exclusions documented and ACC2-03 ticked (14-12)"
  gaps_remaining: []
  regressions: []
---

# Phase 14: Check Report & Enterprise Acceptance Verification Report

**Phase Goal:** `orglet check` reads as an actionable report on a large retrieve, and the milestone is proven against a public enterprise-shaped fixture, both SDK suites and the author's real retrieves.
**Verified:** 2026-10-31. **Status:** passed. **Re-verification:** Yes, after gap closure 14-08..14-12.

## Previous verification (2026-10-29, gaps_found 3/4)

Single failed criterion (4, ACC2-03): the large retrieve showed 150 warnings. Closure:

| Gap | Closed by | Evidence |
|---|---|---|
| reference-target 50 (bare FieldDefinition values) | 14-08 | `FieldDef.metadataRelationshipControllingField` (packages/metadata/src/types.ts:130, set in build.ts:382, parsed in sfdx.ts); `controllingEntity` in packages/engine/src/seed.ts:23, used at line 124; seed tests pass |
| formula 1 (CampaignMember relationshipName label) and 13 lookups without one | 14-09 | relationshipName overrides in scripts/gen-baseline/overrides.json; `relationshipNameProblems` guard in generate.ts (gen and `--check`); `pnpm baseline:check` passes (54 files) |
| formula 1 (standard field outside baseline reported under formula) | 14-10 | implied root in `groupByRoot` (packages/cli/src/report.ts, `implied?: true`, rendered "[implied, N dependents]"); covered in report.test.ts |
| standard-field 37 (19 new fields) | 14-11 | 5 fields added from public sources, rest counted as accepted exclusions (round 2 in conformance/README.md) |
| exclusions undocumented, ACC2-03 open | 14-12 | README section "Large real-org retrieve: counted exclusions", REQUIREMENTS tick with deviation note |

## Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | check report: census, verdict, per-area table, grouped cascades, deterministic, `warning:` lines unchanged | VERIFIED | report.ts, snapshots; cli tests pass (report 24, enterprise 12, main 33) |
| 2 | --summary redacted, --json, --strict semantics | VERIFIED | main.test.ts passes |
| 3 | examples/enterprise passes check --strict; run-all green | VERIFIED | enterprise.test.ts passes; 14-12-SUMMARY records run-all acme 10/10 and enterprise 11/11 on 2026-10-31 (not re-run, per instruction) |
| 4 | DE exit 0; large retrieve zero warnings beyond documented exclusions, counts only | VERIFIED (on recorded evidence) | DE: exit 0, 0 warnings. Large: 94 warnings, all in counted exclusion categories; README Total 94 |

**Score:** 4/4

## ACC2-03 consistency check (author's private runs not re-run; recorded counts used)

- 14-12-SUMMARY: object-kind 11 + custom-metadata-record 24 + formula 27 (15 + 11 + 1) + standard-field 32 = 94.
- conformance/README.md exclusions table: 11 + 15 + 11 + 0 + 24 + 1 + 32 = 94, "Total: 94" matches the SUMMARY.
- Accepted standard-field table: round 1 19, round 2 14, total 33 = 32 in field files plus 1 only via formula (the implied root); consistent with the "1" row.
- Summary's formula 28 vs 27 settlement is explained (one fixed by 14-09, one double-listing). No names appear in the README or SUMMARY, counts only.
- REQUIREMENTS.md: ACC2-03 ticked, traceability Complete, deviation note refers to the README. Roadmap Phase 14 marked complete.
- Caveat: criterion 4 is met with counted exclusions (94 warnings remain), a documented relaxation of "zero warnings"; the deviation is recorded in REQUIREMENTS.md.

## Gates run by the verifier

`pnpm build` pass; `pnpm lint` pass; `pnpm baseline:check` pass (54 files); `vitest run packages/cli packages/metadata`: 14 files, 305 tests passed; `vitest run packages/engine/src/seed`: 19 passed. Working tree clean before this report.

## Requirements Coverage

| ID | Plans | Status |
|---|---|---|
| CHECK-01 | 14-01, 14-04, 14-07, 14-10, 14-12 | SATISFIED |
| CHECK-02 | 14-01, 14-04, 14-07, 14-12 | SATISFIED |
| ACC2-01 | 14-02, 14-05, 14-07, 14-12 | SATISFIED |
| ACC2-02 | 14-05, 14-06, 14-07, 14-12 | SATISFIED |
| ACC2-03 | 14-03, 14-07..14-12 | SATISFIED (with counted exclusions) |

All five IDs are claimed by plans and ticked in REQUIREMENTS.md; no orphans.

## Anti-Patterns
None found in the verified files.

## Human Verification
None outstanding; the author's private retrieves were evaluated by the author and recorded as counts.
