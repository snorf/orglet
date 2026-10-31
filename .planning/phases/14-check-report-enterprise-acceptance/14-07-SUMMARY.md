---
phase: 14-check-report-enterprise-acceptance
plan: 07
subsystem: conformance
tags: [acceptance, conformance, check, real-org]
requires: ["14-01", "14-02", "14-03", "14-04", "14-05", "14-06"]
provides:
  - "Full-gate and conformance evidence for acme and enterprise at 05ddbe9"
  - "DE retrieve and large real-org retrieve results recorded as counts only"
key-files:
  modified:
    - conformance/README.md
    - .planning/REQUIREMENTS.md
key-decisions:
  - "ACC2-03 is NOT met at Phase 14 acceptance and stays open; CHECK-01, CHECK-02, ACC2-01, ACC2-02 are ticked"
requirements-completed: [CHECK-01, CHECK-02, ACC2-01, ACC2-02]
duration: n/a
completed: 2026-10-29
---

# Phase 14 Plan 07: Acceptance runs Summary

Acceptance evidence for Phase 14 is recorded. Four of five requirements are proven; ACC2-03 is not met because the large real-org retrieve reports 150 warnings.

## Commits

- 68e1428: Task 1, gate and conformance runs, Overview rows
- 1ce1e56: Task 3, DE and large-retrieve counts, requirements ticked

## Task 1: gate and conformance (measured 2026-10-29 at 05ddbe9)

- `pnpm test` pglite: 909 passed / 3 skipped / 0 failed (55 files). Postgres 16: 911 passed / 1 skipped / 0 failed.
- build, lint, typecheck, typecheck:scripts, baseline:check: green.
- `check --strict` acme: exit 0, 0 warnings, 57 objects (4 custom, 53 standard), 3644 fields (24 custom, 3620 standard), info 39.
- `check --strict` enterprise: exit 0, 0 warnings, 63 objects (10 custom, 53 standard), 3737 fields (57 custom, 3680 standard), info 41.
- `run-all.sh` acme: exit 0, 10 legs (jsforce 51/0/60, Bulk 12/0/5, simple-salesforce 29/29, describe 32/32, poly 5/5, rollup 5/5, cmdt 8/8 on both SDKs).
- `run-all.sh` enterprise: exit 0, 11 legs (jsforce 50/0/61 with the classified asterisk exclusion UNSUPPORTED:soql-formula, backlog 999.12; Bulk 12/0/5; simple-salesforce 29/29; describe 38/38; poly 6/6; rollup 6/6; cmdt 8/8).

## Task 2: Johan's local retrieve runs (2026-10-29, dist built at 05ddbe9)

DE retrieve: `check --strict` exit 0. Summary: 55 objects (2 custom, 53 standard), 3625 fields (23 custom, 3602 standard); 146 feature-gated standard fields included; verdict clean (warnings 0, informational 39); info:reference-target-skipped 39. The 2026-10-16 row recorded 3647 fields; today's fresh retrieve measures 3625. Both values are recorded as measured, not reconciled.

Large real-org retrieve (`check --summary`): 181 objects (128 custom, 53 standard), 6702 fields (1907 custom, 4795 standard); 146 feature-gated standard fields; custom metadata 127 records in 22 types; 716 custom labels; verdict 150 warnings to review (root causes 150, dependents 0, informational 311).

| Area | Count |
|---|---|
| UNSUPPORTED:custom-metadata-record | 24 |
| UNSUPPORTED:formula | 28 |
| UNSUPPORTED:object-kind | 11 |
| UNSUPPORTED:reference-target | 50 |
| UNSUPPORTED:standard-field | 37 |
| info:custom-setting-no-data | 20 |
| info:reference-target-skipped | 36 |
| info:standard-object-unmodelled | 255 |

## Requirements

- Ticked and Complete: CHECK-01, CHECK-02, ACC2-01, ACC2-02.
- ACC2-03: left unticked, traceability row "Partial: not met at Phase 14 acceptance". The DE leg holds (exit 0, 0 warnings). The large-retrieve leg does not: 150 warnings, with `UNSUPPORTED:standard-field` at 37 against 19 accepted exclusions and four other non-zero warning areas. No exclusion confirmation was given or applicable.

## Deviations from Plan

**Open item: ACC2-03 not met.** The plan allowed ticking ACC2-03 only if every large-retrieve warning fell inside the accepted exclusions. It does not. Not a code bug in this plan; the gaps are real-org coverage gaps. Johan is triaging the 150 warnings locally into generic Salesforce areas; that feeds a separate gap-closure plan (for example via `/gsd:plan-phase 14 --gaps`). No names from either retrieve were recorded anywhere in the repository.

## Throwaway Postgres schemas (reset commands not run)

`p14_final_acme`, `p14_final_acme_cmdt`, `p14_final_ent`, `p14_final_ent_cmdt`. Johan may drop them with `DROP SCHEMA <name> CASCADE;` when no longer needed.

## Known Stubs

None.

## Self-Check: PASSED

Commits 68e1428 and 1ce1e56 exist; conformance/README.md contains the new DE row and the "Large real-org retrieve" section.
