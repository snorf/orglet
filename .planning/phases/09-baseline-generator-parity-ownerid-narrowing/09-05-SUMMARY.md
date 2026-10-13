---
phase: 09-baseline-generator-parity-ownerid-narrowing
plan: 05
subsystem: baseline-generator
tags: [migr-03, diff-gate, allowlist, master-detail, isWidening, failure-modes, no-prose]
requires: [09-04]
provides:
  - "packages/schema exports isWidening (migrate()'s own definition of a non-narrowing column change)"
  - "scripts/gen-baseline/diff-allowlist.json ({ entries: [] }) parsed into inputs.allowlist by sources.ts with GeneratorError validation"
  - "packages/metadata/test/baseline-gate.ts: diffGate(v1, v2, allowlist) -> sorted messages (removed / narrowed / object removed / key prefix changed / stale allowlist entry)"
  - "pipeline.ts: MasterDetail refusal on objects that existed in v1.0, after pins and overrides, allowlist ignored"
  - "baseline-gate.test.ts (17 tests) and the SC1 no-prose scan in baseline-generator.test.ts"
affects: [09-06, 09-07, 09-08, 09-09, 10]
tech-stack:
  added: []
  patterns: ["gate compares sqlTypeFor() output with isWidening() so gate and migrate cannot disagree", "test-only helper under packages/metadata/test when a check needs @orglet/* runtime values that scripts/ must not import", "synthetic inputs via structuredClone of the loaded GeneratorInputs"]
key-files:
  created:
    - scripts/gen-baseline/diff-allowlist.json
    - packages/metadata/test/baseline-gate.ts
    - packages/metadata/test/baseline-gate.test.ts
  modified:
    - packages/schema/src/migrate.ts
    - packages/schema/src/index.ts
    - packages/schema/src/migrate.test.ts
    - scripts/gen-baseline/sources.ts
    - scripts/gen-baseline/pipeline.ts
    - packages/metadata/test/baseline-generator.test.ts
key-decisions:
  - "diffGate takes Baseline (objects + standardValueSets) on both sides so buildOrgSchema can resolve picklists; v2 uses the live standardValueSets.json, v1 the fixture's"
  - "System fields are compared too (same code on both sides, so hasOwner flips surface as OwnerId removed); OwnerId.referenceTo narrowing is not a SQL-type change and stays free (D-17)"
  - "The MasterDetail synthetic test runs full mode on Account with its sources pruned to the v1.0 inventory; full mode on the unpruned sources is 09-07's job"
  - "MIGR-03 ticked (both halves true and tested); BASE2-01 left unticked (its 'owner targets in overrides.json' clause lands in 09-06)"
requirements-completed: [MIGR-03]
duration: 10min
completed: 2026-10-13
---

# Phase 9 Plan 05: Diff gate, allowlist, MasterDetail refusal and generator failure modes Summary

The MIGR-03 protections are live before step B grows the baseline: a vitest diff gate compares the frozen v1.0 fixture with the in-memory regeneration at the SQL-type level using migrate()'s own `isWidening`, an empty committed allowlist is the only way to accept a removal or narrowing (and a stale entry fails), the generator refuses a MasterDetail on any object that existed in v1.0 regardless of pins' origin or the allowlist, and the generator's failure modes plus the SC1 no-prose rule are pinned by tests.

## Performance
- **Started:** 2026-10-13T21:12:16Z — **Completed:** 2026-10-13T21:22Z — **Duration:** ~10 min
- **Tasks:** 2/2 (both TDD) — **Files:** 9 (3 created, 6 modified)

## Commits
| Hash | Type | What |
|---|---|---|
| 53b1b9d | test | RED: isWidening unit test (migrate.test.ts) + 8 diff-gate tests (baseline-gate.test.ts) |
| bc42857 | feat | `export function isWidening` + index export; diff-allowlist.json; `AllowlistEntry`/`parseAllowlist`/`inputs.allowlist` in sources.ts; baseline-gate.ts (GREEN) |
| 79c139c | test | RED: 3 MasterDetail refusal tests (+1 Lookup/v1-only control), 5 failure-mode tests, SC1 no-prose scan |
| 497131b | feat | MasterDetail guard in pipeline.ts (GREEN) |

## What the gate checks (packages/metadata/test/baseline-gate.ts)
Both sides go through `buildOrgSchema` (so `validateBaseline` runs and system fields are included); per v1 object: missing -> `X object removed`; `keyPrefix` differs -> `X key prefix changed: a -> b`; per v1 field: missing -> `X.F removed` unless an allowlist `removed` entry matches; otherwise `a = isVirtual(f) ? "virtual" : sqlTypeFor(f)` on each side and `a === b || (neither virtual && isWidening(a, b))` must hold, else `X.F narrowed: a -> b` unless an allowlist `narrowed` entry matches. Every allowlist entry that suppressed nothing -> `allowlist entry X.F (kind) is not needed`. Object removal and prefix changes are never suppressible. Messages are code-unit sorted. On the real regeneration (`generate(inputs, CLI_OPTIONS)` vs `fixtures/baseline-v1.0`) the gate returns `[]` with the empty allowlist.

## MasterDetail refusal (scripts/gen-baseline/pipeline.ts)
After pins and the overrides `set` are applied and label/type are validated, `json.type === "MasterDetail" && objectPins && !fieldPins` throws `GeneratorError("<Object>.<Field>: MasterDetail on an object that existed in v1.0 would add a NOT NULL column to a populated table; model it as Lookup in overrides.json")`. "Existed in v1.0" = the object has a v1-pins.json entry; "new field" = no field pin. In `v1Only: true` mode the inventory is the pin list, so the guard can never fire there and `pnpm baseline:check` is unaffected. Tested through the sources (`relationshipType: "master-detail"` in the Object Reference facts) and through an overrides `set: { type: "MasterDetail" }`; the allowlist is not consulted (test asserts a `narrowed` entry does not help).

## Verification (HEAD 497131b)
- `pnpm vitest run packages/metadata/test/baseline-gate.test.ts packages/schema/src/migrate.test.ts`: 17 passed (RED before: `isWidening is not a function`, `Cannot find module ./baseline-gate.js`; then 3 MasterDetail tests red before the guard).
- `pnpm vitest run packages/metadata`: 9 files, 146 passed. `pnpm test`: 36 files, 550 passed, 3 skipped (Postgres-gated tests; pglite run, Docker not started).
- `pnpm lint`, `pnpm typecheck:scripts`: clean. `pnpm baseline:check`: "checked 35 object files", exit 0; `git status --porcelain -- packages/metadata/standard` empty.
- Acceptance greps: `^export function isWidening` 1; `isWidening` in schema index 1; `is not needed` in baseline-gate.ts 1; `diff-allowlist.json` -> `{"entries":[]}`; `would add a NOT NULL column to a populated table` in pipeline.ts 1; `MasterDetail` in baseline-gate.test.ts 6; `v1Only: true` in pipeline.ts 1.

## Deviations from Plan
1. **`diffGate` signature takes `Baseline` objects, not `StandardObjectJson[]`.** `buildOrgSchema` needs `standardValueSets` to resolve `standardValueSet` picklists, so the helper takes `{ objects, standardValueSets }` per side (fixture sets for v1, live `standard/standardValueSets.json` for the regenerated v2). Same behaviour as the plan describes; one fewer hidden file read inside the helper.
2. **Full mode on the real inputs is not reachable yet, so the MasterDetail test prunes.** `generate(inputs, { v1Only: false })` aborts today at `Account.ConnectionReceivedId: Lookup without referenceTo` (a 09-07 override/pin task), before any synthetic Account field is reached. The synthetic test therefore clones the inputs, keeps only `Account` (objects + pins), prunes its sf-skills and Object Reference fields to the v1.0 pin inventory, and adds `SyntheticParentId`; full mode then emits 660 fields (659 v1.0 + synthetic) in the Lookup control case and throws in the MasterDetail cases. No change to the generator's field loop was needed (09-04 already implemented it); `CLI_OPTIONS` is unchanged.
3. **MasterDetail guard sits before the `referenceTo` check**, not after everything else, so a MasterDetail without Refers To reports the MIGR-03 refusal rather than the generic "without referenceTo" message. Both are GeneratorErrors; the refusal is the more actionable one.
4. **Allowlist parsing is unit-tested** (one extra test: missing reason, unknown kind, empty field, wrong top-level shape) since `parseAllowlist` is new validation code; `inputs.allowlist` is a required field of `GeneratorInputs` (only `loadInputs` constructs it, verified by grep).
5. **Failure-mode and no-prose tests were green on first run** (the code paths exist since 09-04): they pin behaviour rather than drive it. Only the MasterDetail tests went RED -> GREEN. Recorded, not hidden.

## Notes for downstream plans
- 09-06/09-07: when step B lands, run `diffGate` in CI via the existing vitest job; expect flag pins deleted per D-17 to be invisible to the gate, but any schema-level pin removal (type/length/precision/scale, e.g. `UserLicense.Name` 80 vs 40) must come with a `diff-allowlist.json` entry or the gate names it.
- 09-07 must resolve `Account.ConnectionReceivedId` (and whatever follows) before `v1Only: false` becomes the CLI default; the pruned synthetic test will keep passing regardless.
- `tsc -p tsconfig.test.json` has 41 pre-existing errors (not a CI gate); logged in `deferred-items.md`. The new test files add none.

## Requirements
Frontmatter lists MIGR-03 and BASE2-01. **MIGR-03 ticked**: both halves (MasterDetail refusal, v1-vs-v2 diff gate with allowlist) are implemented and tested. **BASE2-01 not ticked**: its "hand facts (... owner targets) live in a committed overrides.json" clause is 09-06's work; 09-01 reported it complete but the checkbox was never set, so the phase verifier should settle it once 09-06 lands.

## Known Stubs
None. `diff-allowlist.json` is intentionally empty (no exception is needed while output equals v1.0).

## Self-Check: PASSED
