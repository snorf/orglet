---
phase: 04-polymorphic-lookups-soql-typeof
plan: 06
subsystem: engine, api
tags: [polymorphic, warnings, reference-target, query-route, poly-03]
requires:
  - phase: 04-polymorphic-lookups-soql-typeof
    provides: matchTargetByPrefix (04-01), D-16 formula outcome (04-03), ShapeOptions.onUnmodelledPrefix (04-04/05)
provides:
  - "QueryPage.warnings: one UNSUPPORTED:reference-target line per distinct unmodelled prefix"
  - "REST query route logs the warnings once per query via req.log.warn"
  - "ApiOptions.logger widened to Fastify's logger option type"
affects: [04-07]
tech-stack:
  added: []
  patterns: ["Shape callback collected into a Set in runQuery, surfaced as an optional page field; route logs it per request"]
key-files:
  created: []
  modified:
    - packages/engine/src/query.ts
    - packages/engine/src/query.test.ts
    - packages/api/src/routes/query.ts
    - packages/api/src/server.ts
    - packages/api/src/api.test.ts
key-decisions:
  - "warnings key is absent (not an empty array) when nothing degraded"
requirements-completed: [POLY-03]
duration: 12min
completed: 2026-10-08
---

# Phase 4 Plan 06: Unmodelled-prefix warning and end-to-end proof Summary

**`runQuery` turns the shape callback into `QueryPage.warnings`, the REST query route logs them once per query at warn level, and tests prove the three-way Owner agreement (SC1) and the null-parent degradation on a schema without Group (SC3).**

## Accomplishments

- `query.ts`: `onUnmodelledPrefix` fills a `Set`; `result.warnings = ["UNSUPPORTED:reference-target <prefix> matches no object in the org schema", ...]` sorted, only when non-empty.
- `routes/query.ts`: `if (page.warnings) req.log.warn(page.warnings.join("; "))`, one call per query regardless of row count. `ApiOptions.logger` is now `FastifyServerOptions["logger"]` (the CLI's boolean still type-checks).
- Engine tests: one Group-owned Case gives `Owner.Type`, `Owner.attributes.type` and `matchTargetByPrefix(...)` all `Group`; formula leg asserts the D-16 outcome (`Owner:Group.Name` throws `UNSUPPORTED:formula`, plain `Owner.Name` throws `Field Owner.Name does not exist. Check spelling.`); no `warnings` key on a clean query.
- Second schema built from the baseline without `Group` (plus the acme project, no extra filtering was needed), two import-mode Cases with `00G` owners: `Owner` null, TYPEOF null with and without ELSE, `OwnerId` keeps the `00G` value, a single warning each time, no `"type":"Name"` in the output.
- API tests: concrete Owner over REST with `WHERE Owner.Type = 'Group'`; a second app with a capturing pino stream shows exactly one warn line for two rows sharing the prefix `zzz`.

## Captured warn log line (verbatim)

```
{"level":40,"time":1791494442212,"pid":80788,"hostname":"devrandom-1414.local","reqId":"req-2","msg":"UNSUPPORTED:reference-target zzz matches no object in the org schema"}
```

## Task Commits

1. Task 1: 09a1e41 feat(04-06): surface unmodelled owner prefixes as QueryPage.warnings
2. Task 2: 8e941fa feat(04-06): log the unmodelled reference-target warning once per REST query

## Verification run

`pnpm vitest run packages/engine/src/query.test.ts` (24 passed), `packages/api/src` (35 passed), then separately `pnpm build` clean, `pnpm lint` clean, `pnpm test` (pglite): 17 files, 251 passed, 2 skipped (pre-existing Postgres-only skips).

## Deviations from Plan

None in behaviour. The tests were written together with the implementation, so there was no separate failing RED commit. The plan's `engine.insert` for the no-Group schema needed no extra audit fields in import mode.

## Known Stubs

None.

## Self-Check: PASSED
