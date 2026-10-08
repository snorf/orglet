---
phase: 04-polymorphic-lookups-soql-typeof
plan: 07
subsystem: conformance
tags: [polymorphic, typeof, jsforce, simple-salesforce, phase-gate]
requires:
  - phase: 04-polymorphic-lookups-soql-typeof
    provides: Name-object reads, Owner.Type, TYPEOF, MALFORMED_QUERY rejections (04-02..04-06)
provides:
  - "conformance/poly-check: jsforce and simple-salesforce legs (4 checks each) against a live orglet"
  - "Phase 4 gate evidence: both test backends green, both SDK legs 4/4"
affects: [phase-7-conformance]
tech-stack:
  added: []
  patterns: ["Targeted SDK script pair copied from conformance/describe-check"]
key-files:
  created:
    - conformance/poly-check/jsforce.mjs
    - conformance/poly-check/sf_poly.py
    - conformance/poly-check/README.md
  modified:
    - .gitignore
    - .planning/REQUIREMENTS.md
key-decisions:
  - "POLY-01 recorded as Partial (formula leg deferred per D-16); POLY-02..POLY-06 complete"
requirements-completed: [POLY-02, POLY-03, POLY-04, POLY-05, POLY-06]
duration: 20min
completed: 2026-10-08
---

# Phase 4 Plan 07: Phase gate Summary

**jsforce and simple-salesforce both pass the four polymorphic checks (Name-object query, Owner.Type filter, TYPEOF, invalid TYPEOF) against a live orglet, and the suite is green on pglite and Docker Postgres 16.**

## Task Commits

1. Task 1: 8e6966c feat(04-07): add poly-check jsforce and simple-salesforce scripts
2. Task 2: 717d164 docs(04-07): record POLY-01 as partial (formula leg deferred per D-16)

No source changes were needed; no SDK check failed.

## Build, lint, tests

- `pnpm build`: clean. `pnpm lint`: clean (exit 0).
- `pnpm test` (embedded pglite), exit 0:
  ```
   Test Files  17 passed (17)
        Tests  251 passed | 2 skipped (253)
  ```
- `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` (Docker Postgres 16), exit 0:
  ```
   Test Files  17 passed (17)
        Tests  253 passed (253)
  ```
  The 2 skips on pglite are the pre-existing Postgres-only tests.

## Live-server run

Pre-check (schema must not exist), output `0`:
```
docker exec orglet-postgres psql -U orglet -d orglet -tAc "SELECT count(*) FROM information_schema.schemata WHERE schema_name = 'poly_check'"
0
```

Server start command (PID 88005, written to the scratchpad PID file):
```
ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet node packages/cli/dist/index.js up --project examples/acme --org-schema poly_check --port 8082 --quiet > <scratch>/poly-check-server.log 2>&1 &
```
The server log was empty (--quiet).

### jsforce leg (`BASE_URL=http://localhost:8082 node conformance/poly-check/jsforce.mjs`), exit 0

```
PASS name-object {"group":{"attributes":{"type":"Group","url":"/services/data/v59.0/sobjects/Group/00G00VXUnOzNpmHEXS"},"Name":"PolyCheck Queue poly-check-1791494750764","Email":null,"Type":"Group"},"user":{"attributes":{"type":"User","url":"/services/data/v59.0/sobjects/User/00500VXUnNwHpmGAXS"},"Name":"Admin User","Email":"admin@orglet.local","Type":"User"}}
PASS type-filter {"ids":["50000VXUnOzWpmHAXS"],"expected":["50000VXUnOzWpmHAXS"]}
PASS typeof {"group":["attributes","Name","Type"],"groupType":"Queue","user":["attributes","Alias"]}
PASS typeof-invalid {"errorCode":"MALFORMED_QUERY","message":"TYPEOF isn't allowed in queries that don't return objects, such as COUNT()"}
jsforce: 4/4 passed
```

### simple-salesforce leg (`BASE_URL=http://localhost:8082 conformance/describe-check/.venv/bin/python conformance/poly-check/sf_poly.py`), exit 0

```
PASS name-object {"group":{"attributes":{"type":"Group","url":"/services/data/v59.0/sobjects/Group/00G00VXUnPr6pmHEXQ"},"Name":"PolyCheck Queue poly-check-1791494754101","Email":null,"Type":"Group"},"user":{"attributes":{"type":"User","url":"/services/data/v59.0/sobjects/User/00500VXUnNwHpmGAXS"},"Name":"Admin User","Email":"admin@orglet.local","Type":"User"}}
PASS type-filter {"ids":["50000VXUnPrApmHAXS"],"expected":["50000VXUnPrApmHAXS"]}
PASS typeof {"group":["attributes","Name","Type"],"groupType":"Queue","user":["attributes","Alias"]}
PASS typeof-invalid {"errorCode":"MALFORMED_QUERY","message":"TYPEOF isn't allowed in queries that don't return objects, such as COUNT()"}
simple-salesforce: 4/4 passed
```
The existing `conformance/describe-check/.venv` was reused.

### Cleanup

The PID file value was verified with `ps -p` (command: `node packages/cli/dist/index.js up --project examples/acme --org-schema poly_check --port 8082 --quiet`) before `kill 88005`; the process stopped. Then:
```
ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet node packages/cli/dist/index.js reset --org-schema poly_check --drop-prefixes
dropped schema "poly_check"
dropped 4 key prefix assignment(s) for schema "poly_check"
```
Afterwards the schema count and the `_orglet.key_prefixes` count for `poly_check` were both `0`. Port 8180 (Johan's dev server) still answered HTTP 200; it was never touched. No hand-written DROP was issued.

## Known gaps

- (a) Success criterion 1's formula leg is the D-16 fallback: `Owner:Group.Name` raises `UNSUPPORTED:formula` because the vendored sigha lexer rejects `:`. Todo: `.planning/todos/pending/2026-10-08-sigha-colon-syntax-for-polymorphic-formula-references.md`. Plain `Owner.Name` on a polymorphic lookup fails compilation (D-08).
- (b) D-15: `OwnerId` stays `User|Group` on every owned object. Todo: `2026-10-08-narrow-baseline-ownerid-per-object.md`.
- (c) D-17 gates: polymorphic parents/TYPEOF in child subqueries (`UNSUPPORTED:polymorphic-subquery`), Name's Profile/UserRole pseudo-fields (`UNSUPPORTED:polymorphic-field`), traversal past a polymorphic parent (`UNSUPPORTED:polymorphic-traversal`), dotted paths in WHEN lists.

## Requirement status

- POLY-01: partial — formula leg deferred per D-16 (SOQL traversal and result shaping done; formula parent references raise UNSUPPORTED:formula; sigha todo above). The REQUIREMENTS.md traceability row now reads `Partial (formula leg deferred per D-16)`.
- POLY-02..POLY-06: complete. POLY-03's "(and ELSE branch in TYPEOF)" is superseded by D-19: an unmodelled prefix is a null parent even with ELSE (note added to REQUIREMENTS.md).

## Deviations from Plan

None - plan executed exactly as written. The POLY-01 checklist box in REQUIREMENTS.md stays `[x]` with the added Partial note, as the plan specifies.

## Known Stubs

None.

## Self-Check: PASSED
