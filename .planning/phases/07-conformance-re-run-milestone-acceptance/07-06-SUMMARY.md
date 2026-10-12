---
phase: 07-conformance-re-run-milestone-acceptance
plan: 06
subsystem: conformance
tags: [conformance, acceptance, docs]
requires: [07-01, 07-02, 07-04, 07-05]
provides:
  - conformance/README.md overview with dated rows for all 7 checks
  - corrected stale conformance/acceptance statements (D-19)
  - ACCEPT-01..03 verified and ticked
affects: [README.md, .planning/ROADMAP.md, .planning/PROJECT.md, .planning/REQUIREMENTS.md, .planning/codebase/TESTING.md, .planning/codebase/INTEGRATIONS.md]
key-files:
  created: [conformance/README.md]
  modified: [README.md, .planning/ROADMAP.md, .planning/PROJECT.md, .planning/REQUIREMENTS.md, .planning/codebase/TESTING.md, .planning/codebase/INTEGRATIONS.md]
decisions:
  - "Harness README numbers matched the final run exactly, so no harness README was changed."
metrics:
  completed: 2026-10-12
  tasks: 3
---

# Phase 7 Plan 6: Final conformance run, overview README, DE acceptance check

All harnesses re-run green on the final code, `conformance/README.md` written, stale statements corrected, and the DE retrieve check (run last, `--strict`) exits 0 with zero warnings; ACCEPT-01..03 ticked.

## Task commits

| Task | Commit | Content |
|---|---|---|
| 1 | 3b6ad5a | Stale statements corrected (ROADMAP, PROJECT, README, TESTING, INTEGRATIONS), folded todo moved to completed |
| 2 | c648d9e | `conformance/README.md` (7-row overview, DE row pending) |
| 3 | af081d3, c282ffd | DE row filled, ACCEPT-01..03 ticked and Complete, PROJECT Active items ticked |

## Final run (Task 2)

On commit 3b6ad5a, 2026-10-12, Node v22.23.3: `pnpm build && pnpm lint && pnpm test` exit 0 (25 files; 427 passed, 3 skipped, 430 total).
`PORT=8094 ORG_SCHEMA=final7 ... conformance/run-all.sh`: `exit=0`, 8 leg `PASS` lines in the summary, no `FAIL`.
- jsforce run 1: `Tests: 60 skipped, 51 passed, 111 total`; run 2: `Tests: 5 skipped, 12 passed, 17 total`
- simple-salesforce: `29/29 passed`
- describe-check 14/14 + 14/14; poly-check 4/4 + 4/4; rollup-check 5/5 + 5/5

All numbers equal the harness READMEs, so none were modified. `final7` was reset (`--drop-prefixes`) before and after.

## DE retrieve check (Task 3, last command of the phase)

- `exit=0`
- `warning:` count: stdout 0, stderr 0
- first stdout line: `37 objects (2 custom), 983 fields`
- orglet commit: c648d9e (HEAD at the time; `pnpm build` ran on it), date 2026-10-12

Nothing else from the retrieve was read, listed or copied.

## Deviations from Plan

**1. [Process slip, no impact]** A scripted edit failed midway (loop re-ticked ACCEPT-01), so the Task 3 commit af081d3 contained the README DE row plus only ACCEPT-01 ticked; c282ffd completed ACCEPT-02/03, traceability and PROJECT ticks. Final state verified: 3 ticked, 3 Complete, no `pending` left in conformance/README.md.

Otherwise the plan was executed as written. The ROADMAP overview sentence was line-wrapped so the exact phrase "against the metadata retrieved from Johan's Developer Edition and both SDK conformance suites" sits on one line (acceptance grep count 1).

## Known Stubs

None.

## Notes for Johan

- 3 vitest tests are skipped in the suite (pre-existing; not investigated here).
- Nothing pushed. The conformance CI job remains non-required (decision D-14).

## Self-Check: PASSED
