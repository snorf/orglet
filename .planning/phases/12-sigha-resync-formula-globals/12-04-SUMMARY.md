---
phase: 12-sigha-resync-formula-globals
plan: 04
subsystem: formula
tags: [formula, dependencies, registry]
requires:
  - phase: 12-02
    provides: typed Relationship:Object segments in resolvePath
provides:
  - CompiledFormula.dependencies (fields per object/path, globals, volatile)
  - FormulaRegistry.fieldDependencies / ruleDependencies / usesGlobal
affects: [12-05, 12-06, 12-07, phase-13]
key-files:
  modified:
    - packages/formula/src/compile.ts
    - packages/formula/src/index.ts
    - packages/engine/src/formulas.ts
    - packages/engine/src/formulas.test.ts
  created:
    - packages/formula/src/dependencies.test.ts
key-decisions:
  - "$System, $Label and $CustomMetadata do not make a formula volatile; NOW/TODAY/TIMENOW and $User, $Profile, $Organization, $RecordType, $UserRole, $Api, $Setup do"
requirements-completed: [FORM-03, FORM-05]
completed: 2026-10-23
---

# Phase 12 Plan 04: Formula dependency list Summary

Every compiled formula now carries a structured dependency list, and FormulaRegistry can tell whether any formula uses a given global root.

## Final shape (for Phase 13)

```typescript
export type GlobalRoot = "$User" | "$Profile" | "$Organization" | "$RecordType" | "$UserRole" | "$Api" | "$Label" | "$CustomMetadata" | "$Setup" | "$System";
export interface ObjectFieldDependency { object: string; path: string[]; fields: string[]; }
export interface FormulaDependencies {
  fields: ObjectFieldDependency[]; // own object first, then by path length and path text; fields sorted
  globals: GlobalRoot[];           // sorted, unique
  volatile: boolean;
}
```

`path` uses canonical segments, typed ones as `Owner:User`. Each hop contributes the lookup field (for example `OwnerId`) on the object it hangs off, plus the leaf. PRIORVALUE and ISCHANGED arguments count as reads; ISNEW adds none. Currently only `$User`, `$Profile`, `$Organization`, `$RecordType` and `$System` are collected; plans 12-05..12-07 add the other roots in their own branches.

## Commits

- be1a53d feat(12-04): collect structured formula dependencies at compile time
- 06bfa7a feat(12-04): expose formula dependencies on FormulaRegistry

## Verification

`pnpm lint`, `pnpm build` green; full `pnpm test`: 46 files, 746 passed, 3 skipped (pre-existing skips). No reverse index or cycle detection (Phase 13).

## Deviations from Plan

None. Process note: tests and implementation were written before the first run, so RED was not observed separately.

## Self-Check: PASSED
