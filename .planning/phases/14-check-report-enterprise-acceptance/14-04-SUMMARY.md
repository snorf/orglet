---
phase: 14-check-report-enterprise-acceptance
plan: 04
subsystem: cli
tags: [check, report, summary, json, snapshot]
requires:
  - phase: 14-01
    provides: report core (buildCheckReport and formatters)
  - phase: 14-03
    provides: regenerated baseline (census input to the acme snapshot)
provides:
  - orglet check prints census, verdict, area table and root-cause groups
  - --summary (name-free) and --json flags with the locked flag interplay
  - committed acme snapshots
affects: [14-05]
tech-stack:
  added: []
  patterns: [toMatchFileSnapshot for CLI output]
key-files:
  created: [packages/cli/src/__snapshots__/check-acme.txt, packages/cli/src/__snapshots__/check-acme-summary.txt]
  modified: [packages/cli/src/main.ts, packages/cli/src/main.test.ts, README.md]
key-decisions:
  - "Exit code stays flags.strict && warnings.length > 0, computed from the warning strings, never from the report"
  - "gated count read from report.census.featureGatedFields (old reduce removed)"
requirements-completed: [CHECK-01, CHECK-02]
duration: 20min
completed: 2026-10-29
---

# Phase 14 Plan 04: check report wiring Summary

`orglet check` now prints the census, a verdict line, the per-area table and the root-cause groups; `--summary` and `--json` are wired per user decision 2, and the acme report is pinned by committed file snapshots.

## Commits
- 883b178 feat: wire check report with --summary and --json (main.ts, main.test.ts)
- 6199693 docs: acme snapshots and README paragraph

## Acme snapshot (check-acme.txt)
```
57 objects (4 custom, 53 standard), 3644 fields (24 custom, 3620 standard)
146 feature-gated standard fields included (nullable; present in an org only when the feature is enabled)
  BigTable__c  a00  (provisional)
  Milestone__c  a01  (provisional)
  Project__c  a02  (provisional)
  UpsertTable__c  a03  (provisional)
custom-object key prefixes are provisional here; ...
verdict: clean (warnings: 0, informational: 39)
areas:
  info:reference-target-skipped  39
info: 39 standard objects not modelled and unreferenced: ActionCadence, ... (name list)
```

## --summary on conformance/cmdt-check/project
```
58 objects (5 custom, 53 standard), 3650 fields (13 custom, 3637 standard)
146 feature-gated standard fields included (nullable; present in an org only when the feature is enabled)
custom metadata: 5 records in 2 types
2 custom labels
verdict: 8 warnings to review (root causes: 8, dependents: 0, informational: 41)
areas:
  UNSUPPORTED:custom-label             1
  UNSUPPORTED:custom-metadata-record   5
  UNSUPPORTED:reference-target         2
  info:custom-setting-no-data          2
  info:reference-target-skipped       39
```

## Deviations from Plan
- [Rule 1 - test bug in plan] The plan's summary test asserted the output contains neither `info:` nor `root causes`. The area table legitimately has `info:<area>` rows and the verdict line contains `root causes:`. The assertions were narrowed to what the invariant means: no `info: ` name-listing lines and no `root causes with dependents` section.
- RED step was not run separately: tests and implementation were written together and first run after both existed (the first run also failed only because of a failed `sed`/shell chain, not a behavioural RED).

## Verification (actually run, Node 22)
- `pnpm vitest run packages/cli/src`: 3 files, 61 tests passed, run repeatedly without `-u` (snapshots deterministic)
- `pnpm build` and `pnpm lint`: clean (lint re-run after the last test edit)
- `pnpm test` (full): 55 files, 909 passed, 3 skipped (run before a one-line lint-only edit of a test assertion; the cli tests were re-run after it)
- Built CLI on acme equals the snapshot; cmdt-check still prints 8 `warning:` lines on stderr
- Not run: conformance suites against a live server

## Known Stubs
None.

## Self-Check: PASSED
