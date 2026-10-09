// @orglet/schema: OrgSchema -> Postgres DDL, migrations, Salesforce ID generation
export { generateId, normalizeId, toCaseSafeId, keyPrefixOf, matchTargetByPrefix } from "./ids.js";
export { createPool, databaseUrlFromEnv, formatSalesforceDatetime, withTransaction } from "./db.js";
export type { Pool, PoolClient, Queryable } from "./db.js";
export {
  DEFAULT_ORG_SCHEMA,
  INTERNAL_SCHEMA,
  columnFor,
  columnName,
  identifier,
  isVirtual,
  quote,
  sequenceName,
  sqlTypeFor,
  tableName,
} from "./columns.js";
export type { ColumnSpec } from "./columns.js";
export { planSchema, planTable } from "./ddl.js";
export type { TablePlan, ForeignKeySpec, IndexSpec } from "./ddl.js";
export { migrate } from "./migrate.js";
export type { MigrateOptions, MigrateResult } from "./migrate.js";
export { rollupBackfillSql, rollupDepth, rollupSelectSql } from "./rollup.js";
export type { RollupStatement } from "./rollup.js";
export { ensureInternalSchema } from "./internal.js";
export { KeyPrefixError, planKeyPrefixes, parseKeyPrefixMapping, reconcileKeyPrefixes, dropKeyPrefixes } from "./prefixes.js";
export type { KeyPrefixSource, KeyPrefixClaim, KeyPrefixAssignment, KeyPrefixPlanInput, KeyPrefixPlan, ReconcileKeyPrefixesOptions, ReconcileKeyPrefixesResult } from "./prefixes.js";
