---
phase: 14-check-report-enterprise-acceptance
plan: 12
subsystem: conformance
tags: [acceptance, conformance, check, gap-closure]
requires: [14-08, 14-09, 14-10, 14-11]
provides:
  - "ACC2-03 evidenced: large retrieve at 94 warnings, all counted exclusions"
  - "conformance/README.md counted-exclusions section"
affects: [conformance/README.md, .planning/REQUIREMENTS.md]
key-files:
  modified:
    - conformance/README.md
    - .planning/REQUIREMENTS.md
    - packages/cli (acme check snapshots)
decisions:
  - "Formula count settled at 27 (C 15 + D 11 + G 1); triage 28 + 1 double-listed explained"
metrics:
  completed: 2026-10-31
---

# Phase 14 Plan 12: Gap-closure acceptance Summary

Re-ran every gate after 14-08..14-11, recorded the author's DE and large-retrieve results as name-free counts, documented the counted exclusions (Total 94) and ticked ACC2-03.

## Task 1: automated gates

- `pnpm build`, `lint`, `typecheck`, `typecheck:scripts`, `baseline:check` (54 files): pass.
- `pnpm test` pglite: 55 files, 922 passed, 3 skipped, 0 failed.
- `pnpm test` Postgres 16 (5433): 55 files, 924 passed, 1 skipped, 0 failed.
- `check --strict` exit 0 for both. acme: 57 objects (4 custom, 53 standard), 3649 fields (24 custom, 3625 standard), warnings 0, informational 39. enterprise: 63 objects (10 custom, 53 standard), 3742 fields (57 custom, 3685 standard), warnings 0, informational 41.
- `run-all.sh` acme (p14_gaps_acme, 8093): 10/10 PASS (jsforce core 51 passed / 60 skipped; Bulk 2.0 12 / 5; simple-salesforce 29/29; describe-check 32/32 each; poly-check 5/5; rollup-check 5/5; cmdt-check 8/8).
- `run-all.sh` enterprise (p14_gaps_ent, 8096): 11/11 PASS (jsforce core 50 / 61 skipped; Bulk 12 / 5; simple-salesforce 29/29; describe-check 38/38; poly-check 6/6; rollup-check 6/6; cmdt-check 8/8). describe-check: no new differences.
- Overview rows re-dated 2026-10-31 (commit a2f4d2b).

Reset commands (not run) for schemas `p14_gaps_acme`, `p14_gaps_acme_cmdt`, `p14_gaps_ent`, `p14_gaps_ent_cmdt`: `orglet reset` against each schema; the orchestrator performs the cleanup.

## Task 2: author's checkpoint reply (counts only)

DE retrieve: `check --strict` exit 0; 55 objects (2 custom, 53 standard), 3653 fields (46 custom, 3607 standard), 146 feature-gated standard fields, clean (0 warnings, informational 39).

Large retrieve: 181 objects (128 custom, 53 standard), 6707 fields (1907 custom, 4800 standard); custom metadata 127 records in 22 types; 716 custom labels; 94 warnings (root causes 93, dependents 1, informational 311). Areas: custom-metadata-record 24, formula 27, object-kind 11, standard-field 32.

Categories: A 11, A' 0, B 24, B' 0, C 15, D 11, E 0, F 0, G 1, H 1, I 32, J 0. I = 32 = 18 (14-03) + 14 (14-11) accepted exclusions; E is 0 so nothing to confirm.

## Met-condition check

DE exit 0 with 0 warnings: yes. J = 0, A' = 0, B' = 0, F = 0: yes. G = H (1 = 1): yes. I all accepted: yes. E = 0: yes. Area mapping: object-kind 11 = A; custom-metadata-record 24 = B; formula 27 = C + D + E + G = 15 + 11 + 0 + 1; standard-field 32 = I. Sum 94 = warning count. ACC2-03 is met and ticked (traceability row Complete, deviation note added).

## 28-vs-29 settlement

Triage listed C 15 + D 1 + E 11 + G 1 = 28 (+1 double-listed). Measured: 27 = C 15 + D 11 + G 1. (a) The 14-09 relationshipName fix resolved one formula (28 -> 27). (b) The triage's D 1 / E 11 split was in fact 11 unique formulas all referencing namespaced managed-package fields absent from the retrieve; measured D 11, E 0, double-listed occurrence counted once.

## Deviations from Plan

**1. [Rule 1 - Bug] Refreshed acme check snapshots** after 14-11 added 5 standard fields (3644 -> 3649 fields, standard 3620 -> 3625); 2 census snapshot tests failed until updated. Commit 7cacd50.

## Commits

- 7cacd50 fix(14-12): refresh acme check snapshots
- a2f4d2b docs(14-12): refresh conformance Overview rows
- a69527f docs(14-12): record DE and large-retrieve counts, counted exclusions, tick ACC2-03

Requirements ticked: ACC2-03 (CHECK-01, CHECK-02, ACC2-01, ACC2-02 unchanged, still ticked).

## Known Stubs

None.

## Self-Check: PASSED
