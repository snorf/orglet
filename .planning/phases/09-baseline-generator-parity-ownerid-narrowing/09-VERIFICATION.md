---
phase: 09-baseline-generator-parity-ownerid-narrowing
verified: 2026-10-14T08:00:00Z
status: passed
score: 5/5 must-haves verified
human_verification_resolved: "2026-10-14 Johan approved SKIP_RATIO_MAX = 0.103 (09-HUMAN-UAT.md, status complete)"
human_verification:
  - test: "Confirm SKIP_RATIO_MAX = 0.103 in packages/metadata/test/documented-fields.test.ts"
    expected: "Johan accepts 84/818 = 10.27 % documented skip ratio (his accepted figure 0.1015 assumed 83 skips), or asks for a different bound"
    why_human: "Decision, not a code fix (09-07 deviation 3); the raw ratio 99/818 = 12.1 % matches his accepted figure exactly"
---

# Phase 9: Baseline generator, parity, OwnerId narrowing - Verification Report

**Phase Goal:** Deterministic, licence-attributed baseline generator; existing 35 objects keep shape and gain documented fields; OwnerId targets match documentation.
**Status:** human_needed (all automated checks pass; one accepted-threshold deviation awaits confirmation)
**Re-verification:** No

## Observable Truths

| # | Truth (ROADMAP SC) | Status | Evidence |
|---|---|---|---|
| 1 | Generator deterministic, CI fails on drift, no prose | VERIFIED | `pnpm baseline:gen` re-run: `git status` clean (byte-identical); `pnpm baseline:check` "checked 36 files"; CI job `baseline-gen-check` in `.github/workflows/ci.yml` runs gen + `git diff --exit-code` + untracked check; 0 strings over 100 chars in `standard/objects`; prose-label guard in pipeline.ts; SC1 prose test green |
| 2 | v1 no-op step, diff gate, MasterDetail refusal | VERIFIED | `scripts/gen-baseline/{pipeline,generate,sources,gating,typemap,errors}.ts`, `diff-allowlist.json`, `v1-pins.json`; `baseline-gate.ts` + `baseline-gate.test.ts` (17 tests) and `baseline-generator.test.ts` (21 tests) pass, including MasterDetail refusal (MIGR-03) and v1-field-removal abort |
| 3 | Documented fields modelled, skips in PROVENANCE.json, feature-gated tagging | VERIFIED | `documented-fields.test.ts` passes (zero UNSUPPORTED:standard-field for modelled fields; skip ratio bounded); `PROVENANCE.json` has `skipped`, `gating`, `forcedNullable`; `"featureGated": true` in 13 object files; `main.ts:77-78` reports gated count in `orglet check`; no describe key (0 matches in describe.ts per 09-07) |
| 4 | Owner.Name on Account/Contact/Opportunity/Contract/Asset/Campaign; Case/Lead/Task stay polymorphic | VERIFIED | JSON `ownerTargets: ["User"]` on those six (also Event by D-12 override); Case, Lead, Task, Group have none (default User+Group, `build.ts:118`); loader validates ownerTargets (`build.ts:444`); 09-08 tests pass in the full suite; conformance poly-check 4/4 on both SDKs recorded in 09-09 (not re-run, per instruction) |
| 5 | Phase 8 populated upgrade test passes on v2 baseline | VERIFIED | `upgrade.test.ts` (3 tests) passes with `EXPECTED_WARNINGS = []`; `upgrade-owner.test.ts` (2 tests) proves D-14 single schema-fk warning |

**Score:** 5/5

## Requirements Coverage

| Requirement | Status | Evidence |
|---|---|---|
| BASE2-01 deterministic generator | SATISFIED | scripts/gen-baseline, determinism re-run, CI job |
| BASE2-02 parity / v1-v2 gate | SATISFIED | baseline-gate.ts + tests, allowlist, v1 pins |
| BASE2-03 documented + feature-gated fields | SATISFIED | documented-fields test, PROVENANCE.json, featureGated in 13 files and `orglet check` |
| BASE2-04 per-object ownerTargets | SATISFIED (wording amended in 09-09 to the 35 modelled objects, with a Phase 10 forward clause) | JSON ownerTargets, build.ts validation, 09-08 and 09-09 tests |
| MIGR-03 MasterDetail refusal | SATISFIED | refusal guard before referenceTo check; synthetic Account tests pass |

No orphaned Phase 9 IDs: REQUIREMENTS.md maps exactly these five to Phase 9, all ticked. BASE2-05 belongs to Phase 8, BASE2-06 to 08 to Phase 10 (pending).

## Spot-Checks

| Behavior | Command | Result |
|---|---|---|
| Determinism | `pnpm baseline:gen` then `git status --short` | clean |
| Drift check | `pnpm baseline:check` | checked 36 files |
| Targeted tests | `pnpm vitest run baseline-generator baseline-gate upgrade upgrade-owner documented-fields gen-baseline-typemap` | 6 files, 66 tests passed |

## Deviations Reviewed

- 09-04 field reorder in 20 files: mandated by D-19 sorting; parity test sorts fixture fields; content parity claimed and gate passes. Accepted.
- 09-06 target-less lookups skipped (79, reported as `skippedReferenceTarget`) and Checkbox exempt from forced-nullable: justified (DmlEngine defaults Checkbox to false); v1.0 fields still abort. Accepted; policy was raised at the 09-06 checkpoint.
- 09-07 SKIP_RATIO_MAX 0.103 vs accepted 0.1015: arithmetic explained (84 documented skips, not 83); needs Johan's confirmation (the human item above).
- 09-07 prose-label guard (87 labels): keeps SC1 intact; accepted.
- 09-07 `maxWorkers: 3` when ORGLET_DATABASE_URL is set: harness only, pglite unchanged; accepted.
- 09-08 stricter owner-target abort: same output, safer; accepted.
- 09-09 BASE2-04 wording amendment: recorded before/after in SUMMARY; the delivered scope is tested.

## Anti-Patterns

None blocking. Housekeeping: 11 test_* schemas and conformance_p09 remain in the local Docker Postgres (not dropped, per instruction). `tsc -p tsconfig.test.json` has 41 pre-existing errors (deferred-items.md, not a CI gate).

## Human Verification Required

1. Confirm SKIP_RATIO_MAX 0.103 (see frontmatter).

---

_Verified: 2026-10-14_
_Verifier: Claude (gsd-verifier)_
