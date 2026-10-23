---
phase: 12-sigha-resync-formula-globals
plan: 07
subsystem: formula
tags: [formula, api-global, session]
requires:
  - phase: 12-06
    provides: evaluation-time globals and gated loadGlobals
provides:
  - "$Api.Session_ID, Partner_Server_URL_<n>, Enterprise_Server_URL_<n> compile and evaluate"
  - Session.request transport, filled only by the API's session(req)
  - FormulaRegistry.evaluate with one-time no-request UNSUPPORTED:formula-global warning
  - loginSession(req) for Bulk jobs
key-files:
  created:
    - packages/api/src/formula-globals.test.ts
  modified:
    - packages/formula/src/compile.ts
    - packages/formula/src/evaluate.ts
    - packages/formula/src/globals.test.ts
    - packages/engine/src/hooks.ts
    - packages/engine/src/engine.ts
    - packages/engine/src/formulas.ts
    - packages/engine/src/formula-globals.test.ts
    - packages/api/src/server.ts
    - packages/api/src/routes/bulk.ts
key-decisions:
  - "D-08 correction: the _<n> suffix is the API version times ten (_600 -> 60.0, _255 -> 25.5)"
  - "$Api allowed in every formula context; blank plus one warning per formula without a request context"
  - "Session_ID is the bearer token; the token lives only on the per-request Session object, never on Bulk jobs"
requirements-completed: [FORM-03]
completed: 2026-10-23
---

# Phase 12 Plan 07: $Api global Summary

`$Api` values now equal what the client saw at login (access_token, instance_url incl. forwarded headers) over REST/SOQL, and are blank with one `UNSUPPORTED:formula-global` warning per formula for engine-direct use and Bulk jobs.

## Commits

- 0ab076e feat(12-07): compile and evaluate $Api references
- 40fca38 feat(12-07): evaluate $Api from the session request, warn once without it
- e84d108 feat(12-07): API attaches the request context for $Api; Bulk jobs keep none

## Notes

- FORM-03 complete ($UserRole in 12-06, $Api here).
- Verification: `pnpm lint`, `pnpm build` green; full `pnpm test`: 49 files, 805 passed, 3 skipped (pre-existing).

## Deviations from Plan

None. Process note: tests and implementation were written before the first run, so RED was not observed separately.

## Self-Check: PASSED
