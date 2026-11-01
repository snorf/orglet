---
phase: 14-check-report-enterprise-acceptance
plan: 06
subsystem: conformance
tags: [poly-check, rollup-check, jsforce, simple-salesforce, enterprise]
requires: ["14-02"]
provides:
  - "poly-check: owner-narrowed (all fixtures) and owner-colon-formula (FIXTURE=enterprise), both SDKs"
  - "rollup-check: formula-rollup (FIXTURE=enterprise), both SDKs"
key-files:
  modified:
    - conformance/poly-check/jsforce.mjs
    - conformance/poly-check/sf_poly.py
    - conformance/poly-check/README.md
    - conformance/rollup-check/jsforce.mjs
    - conformance/rollup-check/sf_rollup.py
    - conformance/rollup-check/README.md
key-decisions:
  - "Enterprise-only checks are switched on by FIXTURE=enterprise, never by skipping when an object is missing; expected total (5 acme / 6 enterprise) is enforced in the exit code"
requirements-completed: [ACC2-02]
duration: 15min
completed: 2026-10-28
---

# Phase 14 Plan 06: poly-check and rollup-check extension Summary

poly-check and rollup-check now prove OwnerId narrowing, `Owner:User.`/`Owner:Queue.` colon formulas and a roll-up over a formula field through jsforce and simple-salesforce, with the expected total derived from `FIXTURE`.

## Commits

- cd5a0c4: poly-check (Task 1)
- e452a98: rollup-check (Task 2)

## Verification actually run

Servers: `up --project examples/enterprise --org-schema p14_poly_ent --port 8097` and `up --project examples/acme --org-schema p14_poly_acme --port 8098` (after `pnpm build`, clean). Both rollup-check and poly-check legs were run against the same two servers (so schemas `p14_roll_*` were not used). Python leg used `conformance/describe-check/.venv/bin/python`.

| Script | Fixture | Result |
| --- | --- | --- |
| poly-check jsforce | enterprise | `jsforce: 6/6 passed`, exit 0 |
| poly-check simple-salesforce | enterprise | `simple-salesforce: 6/6 passed`, exit 0 |
| poly-check jsforce | acme | `jsforce: 5/5 passed`, exit 0 |
| poly-check simple-salesforce | acme | `simple-salesforce: 5/5 passed`, exit 0 |
| rollup-check jsforce | enterprise | `jsforce: 6/6 passed`, exit 0 |
| rollup-check simple-salesforce | enterprise | `simple-salesforce: 6/6 passed`, exit 0 |
| rollup-check jsforce | acme | `jsforce: 5/5 passed`, exit 0 |
| rollup-check simple-salesforce | acme | `simple-salesforce: 5/5 passed`, exit 0 |

Key lines: `PASS owner-narrowed {"account":["User"],"case":["Group","User"]}`; `PASS owner-colon-formula` (user-owned Case: `Owner_User_Email__c` = admin email, `Owner_Queue_Name__c` null; queue-owned the reverse); `PASS formula-rollup {"afterInsert":{"Total_Lines__c":35,"Line_Count__c":2},"afterUpdate":{"Total_Lines__c":25,"Line_Count__c":2}}`.

Not run: `conformance/run-all.sh` (plan 14-05/14-07 scope), the FIXTURE passing by run-all.sh.

## Reset commands (not run)

```sh
node packages/cli/dist/index.js reset --org-schema p14_poly_ent --drop-prefixes
node packages/cli/dist/index.js reset --org-schema p14_poly_acme --drop-prefixes
```
(servers were stopped; the throwaway schemas p14_poly_ent and p14_poly_acme remain in the local Postgres.)

## Deviations from Plan

None. No orglet findings: Phase 12 colon semantics and Phase 13 formula roll-up behaved as specified.

## Known Stubs

None.

## Self-Check: PASSED
