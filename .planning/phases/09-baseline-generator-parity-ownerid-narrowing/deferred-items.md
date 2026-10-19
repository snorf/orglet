# Deferred items (found during execution, out of scope)

## 09-05
- `tsc -p tsconfig.test.json` reports 41 pre-existing errors in test files (e.g. `packages/schema/src/migrate.test.ts:232`
  `generateId(obj.keyPrefix)` with `string | null`). Not a CI gate today (`pnpm lint` and `pnpm typecheck:scripts` are);
  the new `packages/metadata/test/baseline-gate*.ts` files add none. Candidate: a `typecheck:tests` script once the backlog is cleared.
