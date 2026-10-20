---
phase: 11-custom-metadata-custom-settings-labels
plan: 01
subsystem: conformance
tags: [fixture, conformance, jsforce, simple-salesforce, custom-metadata, custom-settings, labels]
requires: []
provides:
  - conformance/cmdt-check SFDX fixture and written expected-facts contract
  - jsforce and simple-salesforce legs for Phase 11 criteria 1-4 (8 checks each)
  - packages/engine/src/seed.test.ts Wave 0 scaffold (16 it.todo)
affects: [11-02, 11-03, 11-04, 11-05, 11-06, 11-07, 11-08, 11-09]
tech-stack:
  added: []
  patterns: [dedicated conformance fixture outside examples/acme]
key-files:
  created:
    - conformance/cmdt-check/README.md
    - conformance/cmdt-check/jsforce.mjs
    - conformance/cmdt-check/sf_cmdt.py
    - conformance/cmdt-check/project/ (25 XML files plus sfdx-project.json)
    - packages/engine/src/seed.test.ts
  modified: []
key-decisions:
  - "Fixture lives in conformance/cmdt-check, examples/acme untouched"
requirements-completed: [CMDT-01, CMDT-02, CMDT-03, CMDT-04, CSET-01, CSET-02]
duration: 15min
completed: 2026-10-20
---

# Phase 11 Plan 01: Wave 0 fixture and conformance legs Summary

Dedicated cmdt-check SFDX fixture (two __mdt types with an mdt cycle and Entity/FieldDefinition links, Hierarchy and List settings, six record files, CustomLabels), a README with the exact expected facts and eight warnings, two SDK conformance legs, and the seed.test.ts scaffold.

## Verification
- All 25 fixture XML files pass `xmllint`; `pnpm lint` green; seed.test.ts runs (16 todo).
- `node --check` and `py_compile` pass on the legs. The legs were NOT run against a server (the code they check lands in 11-02..11-08; wired by 11-09).

## Deviations from Plan
None - plan executed as written. Note: requirements are listed in the plan frontmatter but only the Wave 0 test infrastructure exists; the implementing plans complete them, so they are not marked complete in REQUIREMENTS.md.

## Known Stubs
`seed.test.ts` contains `it.todo` entries by design; plan 11-06 replaces them.

## Commits
- c232952: fixture, README, seed.test.ts scaffold
- 614d38e: jsforce and simple-salesforce legs

## Self-Check: PASSED
