---
phase: 10-business-standard-objects
plan: 01
subsystem: baseline-generator
tags: [generator, supported-calls, baseline, typemap]
requires: []
provides:
  - "scripts/gen-baseline/calls.ts: KNOWN_SUPPORTED_CALLS and parseSupportedCalls"
  - "Generator support for objects without v1 pins (flags from Supported Calls, labels/flags overrides, hasOwner from OwnerId)"
  - "de-describe key prefix source with a ref; rule 4 restricted to pinned objects; five new type tokens"
affects: [10-04]
tech-stack:
  added: []
  patterns: ["tokenise Supported Calls on name(), not on commas"]
key-files:
  created: [scripts/gen-baseline/calls.ts]
  modified:
    - scripts/gen-baseline/snapshot-lists.ts
    - scripts/gen-baseline/snapshot-pdf.ts
    - scripts/gen-baseline/sources.ts
    - scripts/gen-baseline/pipeline.ts
    - scripts/gen-baseline/typemap.ts
    - packages/metadata/test/gen-baseline-typemap.test.ts
    - packages/metadata/test/object-reference-snapshot.test.ts
    - packages/metadata/test/baseline-gate.test.ts
key-decisions:
  - "The Phase 9 D-07 'never from an org' key-prefix guard is intentionally reversed for source de-describe with a ref (Phase 10 D-01)"
  - "Pinned objects carry no new PROVENANCE keys, so the committed PROVENANCE.json stays byte-identical"
requirements-completed: [BASE2-06, BASE2-07]
duration: 25min
completed: 2026-10-14
---

# Phase 10 Plan 01: Generator capability for objects without v1 pins Summary

The baseline generator can now produce an object with no v1 pins: DML flags come from the Object Reference "Supported Calls" line, labels from an overrides.json `labels` entry, ownership from OwnerId in sf-skills `fields` or the Object Reference. Nothing under `packages/metadata/standard` changed.

## Tasks

1. Supported Calls extraction (commit 686f270): `calls.ts` tokeniser, snapshot step writes `supportedCalls`, `parseObjectReference` validates the vocabulary, `NO_SUPPORTED_CALLS` list added (empty).
2. Object facts for unpinned objects (commit 96878d7): `flagsFromCalls`, `objectFactsFor`, `labels`/`flags` override validation, `de-describe` key prefix source, rule 4 limited to pinned objects (D-18), new-field normalisation (AutoNumber drops length/nillable; flags equal to the loader default are not written), type map entries for text, timeOnly, long, integer, dynamic picklist.

## Verification (all run)

- `pnpm vitest run packages/metadata`: 10 files, 187 tests passed.
- `pnpm typecheck:scripts`: clean. `pnpm lint`: exit 0. `pnpm baseline:check`: exit 0 ("checked 36 files").
- `git status --porcelain -- packages/metadata/standard scripts/gen-baseline/source scripts/gen-baseline/objects.json scripts/gen-baseline/overrides.json` printed nothing, so the 35 committed objects regenerate byte-identically.

## Deviations from Plan

None in behaviour. BusinessHours worked as the unpinned test subject. The Phase 9 "never from an org" test was rewritten into two tests as the plan specified (intentional reversal per D-01). Provenance for unpinned objects gets `labels: "override"` and `flags: "override" | "doc-only"` in PROVENANCE.json objects.

## Known Stubs

None. `NO_SUPPORTED_CALLS` is intentionally empty; Plan 10-04 fills snapshot lists together with objects.json. `pnpm baseline:snapshot` was not run (needs the PDF; Plan 10-04).

## Self-Check: PASSED
