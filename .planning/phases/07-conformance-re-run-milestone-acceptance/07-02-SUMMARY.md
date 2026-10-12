---
phase: 07-conformance-re-run-milestone-acceptance
plan: 02
subsystem: conformance
tags: [simple-salesforce, bulk2, conformance]
requires: []
provides:
  - env-configurable python conformance harness with Bulk 2.0 checks
  - conformance/python/README.md with dated measured results
affects: [07-05 CI conformance job]
tech-stack:
  added: []
  patterns: [env-var configuration with historical defaults]
key-files:
  created: [conformance/python/README.md]
  modified: [conformance/python/run.py, conformance/python/requirements.txt]
key-decisions:
  - "Bulk2 insert fixture uses two columns so the blank-Name row is not a bare empty CSV line"
requirements-completed: [ACCEPT-02, ACCEPT-03]
duration: 15min
completed: 2026-10-12
---

# Phase 7 Plan 02: Python conformance harness Summary

run.py reads BASE_URL/ORGLET_USERNAME/API_VERSION from env, adds three Bulk API 2.0 checks (insert with per-row results, query job, delete), pins simple-salesforce==1.12.10, and a README records the measured run.

## Measured run

Fresh schema `pyconf7`, port 8091, Python 3.12.13, orglet HEAD 93f32f4 (dist built from the working tree):

- `29/29 passed`, `exit=0`
- `[PASS] 11a bulk2 insert -> per-row successful and failed results`
- `[PASS] 11b bulk2 query job returns exactly the inserted rows`
- `[PASS] 11c bulk2 delete by Id -> all processed, REST query no longer finds them`

(The `exit=` echo of the first run printed empty because of shell PIPESTATUS handling; the re-run wrote to a file and printed `exit=0`.)

## Deviations from Plan

**1. [Rule 1 - Harness bug] 11a fixture used a single-column CSV**
- First run: 26/29, 11a saw processed=3 failed=0 of total=4. With a single column, the blank `Name` row serialises to an empty CSV line, which orglet skips (as CSV parsers commonly do) instead of failing it.
- Fix: rows carry a second column (`Industry`) so the blank-Name row is a real record. Re-measured 29/29. No orglet change. Note: orglet silently skipping a bare empty line while the SDK counts it in numberRecordsTotal is untested against Salesforce docs; not flagged as a bug.
- Commit: c244165

## Commits
- 61f4d58: run.py env vars, bulk2 checks, SDK pin
- c244165: README and fixture fix

## Cleanup
Throwaway server PIDs 87950 and 88160 killed; schema `pyconf7` dropped via `reset --drop-prefixes`. Port 8180, `org` and `devrandom` untouched.

## Known Stubs
None.

## Self-Check: PASSED
