---
phase: 12-sigha-resync-formula-globals
plan: 08
subsystem: infra
tags: [gate, conformance, planning-docs]
requires:
  - phase: 12-07
    provides: $Api global, last feature plan of the phase
provides:
  - Phase 12 gate results (build, test, lint, check --strict, SDK conformance)
  - Folded colon-syntax todo closed; PROJECT.md decision row resolved
key-files:
  modified:
    - .planning/PROJECT.md
    - .planning/todos/completed/2026-10-08-sigha-colon-syntax-for-polymorphic-formula-references.md
key-decisions:
  - "No product code changed; no regression found by the gate"
requirements-completed: [FORM-01, FORM-02, FORM-03, FORM-04, FORM-05]
completed: 2026-10-23
---

# Phase 12 Plan 08: Phase gate and close-out Summary

Phase 12 gate passed on executed commands: build, 49 test files / 805 tests, lint, typecheck:scripts, unchanged `check --strict` warnings, and all 10 SDK conformance legs PASS.

## Gate results

- `pnpm build`: clean.
- `pnpm test`: 49 files passed; 805 tests passed, 3 skipped (808 total). The skips are pre-existing; I did not inspect each one.
- `pnpm lint`: no output beyond the eslint banner (clean). `pnpm typecheck:scripts`: clean.
- `orglet check --strict`, phase head vs base commit 75010ef (throwaway worktree, built, removed):
  - `examples/acme`: exit 0, 0 warnings at both.
  - `conformance/cmdt-check/project`: exit 1 at both, 8 `warning:` lines at both. Sorted output is identical except the absolute project path in one line (different checkout location). The plan's acceptance criterion says "exits 0" for this fixture, but it already exits 1 at the base because of its deliberate warnings (as the orchestrator noted); the comparison that matters (warning lines) is equal.
- `bash conformance/run-all.sh` (Postgres `orglet-postgres` on localhost:5433, fresh schemas): all PASS: jsforce-subset, simple-salesforce, describe-check-jsforce, describe-check-python, poly-check-jsforce, poly-check-python, rollup-check-jsforce, rollup-check-python, cmdt-check-jsforce, cmdt-check-python.

## Problem found and worked around (environment, not product)

The first run-all.sh run (schema `conformance_p12_1792763696`) had all jsforce legs PASS but all five Python legs FAIL with `Bad CPU type in executable`: the checked-in-by-hand `conformance/python/.venv` contains x86_64 binaries on this arm64 Mac. I did not touch that venv. I created a scratch venv from `conformance/python/requirements.txt` (cryptography 43.0.3, simple-salesforce 1.12.10, Homebrew python 3.14) under the scratchpad and re-ran the whole script with `PYTHON=` pointing at it on fresh schemas; that second run is the one with all 10 legs PASS. The first run's Python failures were not a product regression. Note the CI Python (3.9 in the old venv) differs from the 3.14 used here.

## Schemas created (not dropped; Johan to drop if wanted)

- `conformance_p12_1792763696` and `conformance_p12_1792763696_cmdt` (first run)
- `conformance_p12b_1792763739` and `conformance_p12b_1792763739_cmdt` (second run)

## Task 2

- Todo moved to `.planning/todos/completed/` with a `## Resolution` section (pin ff6c108).
- PROJECT.md polymorphic-formula row Outcome changed to the Phase 12 resolved text; no other row touched.
- REQUIREMENTS.md already had FORM-01..05 checked and 5 traceability rows `Complete` (verified, no edit needed).
- Commit: 1be36c9.

## Deviations from Plan

None to product code. The Python venv issue above is an environment workaround.

## Self-Check: PASSED
