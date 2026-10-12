---
phase: quick-261012-leq
plan: 01
subsystem: metadata
tags: [sfdx, xml, parsing]
key-files:
  modified:
    - packages/metadata/src/xml.ts
    - packages/metadata/src/sfdx.ts
    - packages/metadata/src/sfdx.test.ts
metrics:
  completed: 2026-10-12
---

# Quick 261012-leq: Empty metadata root accepted, object parse errors name the file

`parseMetadataXml` now treats an empty root element (`""` from fast-xml-parser) as an empty node, so `sf project retrieve` object files like `<CustomObject xmlns="..."/>` load as label-less objects with their directory fields. It also takes an optional `file` argument that prefixes the "Expected <X> root element" error. `readObjectDir` passes `objFile`.

## Commits
- ca8d5e9 test(quick-261012-leq): add failing tests for empty metadata root (RED: 4 failed)
- 3a7898f fix(quick-261012-leq): treat empty metadata root as empty node and name object file in parse errors (GREEN: 13/13 in sfdx.test.ts)

## Verification
- pnpm build: exit 0
- pnpm lint: exit 0
- pnpm test: 25 files passed; 431 passed, 3 skipped (434). The skips are existing pglite-only `skip(usingPglite, ...)` cases, not new.
- `node packages/cli/dist/index.js check --strict --project examples/acme`: exit 0
- git status clean apart from untracked .planning/quick/

## Deviations from Plan
None. The plan was executed as written.

## Self-Check: PASSED
