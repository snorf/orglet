// @orglet/schema: OrgSchema -> Postgres DDL, migrations, Salesforce ID generation
export { generateId, normalizeId, toCaseSafeId, keyPrefixOf } from "./ids.js";
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
