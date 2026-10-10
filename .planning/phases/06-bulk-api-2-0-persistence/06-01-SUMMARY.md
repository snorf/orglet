---
phase: 06-bulk-api-2-0-persistence
plan: 01
subsystem: engine
tags: [transaction, savepoint, dml, change-bus]
requires: []
provides:
  - DmlTransaction, DmlOptions.transaction, DmlEngine.transaction(fn)
affects: [06-04]
tech-stack:
  added: []
  patterns: [savepoint-scoped DML inside a caller transaction, events deferred to commit]
key-files:
  created: [packages/engine/src/transaction.test.ts]
  modified: [packages/engine/src/engine.ts, packages/engine/src/index.ts]
key-decisions:
  - "DmlTransaction { client, events } passed as DmlOptions.transaction; DmlEngine.transaction(fn) opens it and publishes tx.events after COMMIT and release"
  - "Import mode still issues SET LOCAL session_replication_role = replica on the external path; it lasts until the caller's transaction ends"
requirements-completed: [BULK-03]
duration: 12min
completed: 2026-10-10
---

# Phase 6 Plan 01: Caller-supplied DML transaction Summary

DML calls can join a caller's Postgres transaction via `SAVEPOINT dml_run`, with change events deferred until the outer COMMIT (D-19).

## Tasks
1. RED tests (`777a548`): five invariant tests in `transaction.test.ts`.
2. GREEN (`e3deaf1`): `DmlTransaction`, `DmlOptions.transaction`, `DmlEngine.transaction(fn)`, and the savepoint branch in `run()`; `DmlTransaction` exported from the barrel.

## Decisions
- Final signature: `DmlTransaction { readonly client: PoolClient; readonly events: ChangeEvent[] }`, `DmlOptions.transaction?: DmlTransaction`, `DmlEngine.transaction<T>(fn: (tx: DmlTransaction) => Promise<T>): Promise<T>`.
- Import mode: the replica `session_replication_role` set by a call lasts until the caller's transaction ends (documented on `DmlTransaction`).

## Deviations from Plan
None. The test file keeps the structural tx type instead of importing `DmlTransaction`.

## Verification
`pnpm vitest run packages/engine/src`: 95 tests passed (5 new). `pnpm exec eslint packages/engine/src`: clean. `pnpm build` intentionally not run (parallel wave).

## Known Stubs
None.

## Self-Check: PASSED
