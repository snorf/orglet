/**
 * Brings a Postgres database in line with an OrgSchema: creates missing tables, columns,
 * sequences, indexes and foreign keys; widens columns whose type grew. Anything destructive
 * (dropping tables or columns, narrowing types) only happens with `force` and is otherwise
 * reported as an `UNSUPPORTED:schema-*` warning, so a reload never loses data by accident.
 */
import type { OrgSchema } from "@orglet/metadata";
import { DEFAULT_ORG_SCHEMA, quote, type ColumnSpec } from "./columns.js";
import {
  addColumnSql,
  alterColumnTypeSql,
  createTableSql,
  foreignKeySql,
  indexSql,
  planSchema,
  sequenceSql,
  type TablePlan,
} from "./ddl.js";
import type { Pool, PoolClient } from "./db.js";
import { withTransaction } from "./db.js";

export interface MigrateOptions {
  orgSchema?: string;
  /** Allow dropping tables/columns and narrowing types. */
  force?: boolean;
}

export interface MigrateResult {
  /** Executed statements, in order. */
  statements: string[];
  warnings: string[];
}

interface ExistingColumn {
  table: string;
  column: string;
  sqlType: string;
}

const isPgForeignKeyViolation = (err: unknown): boolean => typeof err === "object" && err !== null && (err as { code?: string }).code === "23503";

async function existingColumns(client: PoolClient, orgSchema: string): Promise<ExistingColumn[]> {
  const res = await client.query<{ table_name: string; column_name: string; data_type: string; character_maximum_length: number | null; numeric_precision: number | null; numeric_scale: number | null }>(
    `SELECT table_name, column_name, data_type, character_maximum_length, numeric_precision, numeric_scale
       FROM information_schema.columns
      WHERE table_schema = $1
      ORDER BY table_name, ordinal_position`,
    [orgSchema],
  );
  return res.rows.map((r) => ({ table: r.table_name, column: r.column_name, sqlType: normalizeType(r) }));
}

/** Render information_schema's description of a column in the same spelling ddl.ts uses. */
function normalizeType(r: { data_type: string; character_maximum_length: number | null; numeric_precision: number | null; numeric_scale: number | null }): string {
  switch (r.data_type) {
    case "character":
      return `char(${r.character_maximum_length ?? 0})`;
    case "character varying":
      return `varchar(${r.character_maximum_length ?? 0})`;
    case "numeric":
      return `numeric(${r.numeric_precision ?? 0},${r.numeric_scale ?? 0})`;
    case "timestamp with time zone":
      return "timestamptz";
    case "time without time zone":
      return "time";
    default:
      return r.data_type; // boolean, date, text
  }
}

function parseSized(sqlType: string): { base: string; a: number; b: number } | undefined {
  const m = /^(varchar|char|numeric)\((\d+)(?:,(\d+))?\)$/.exec(sqlType);
  if (!m) return undefined;
  return { base: m[1] ?? "", a: Number(m[2]), b: Number(m[3] ?? 0) };
}

/** True when changing a column from `from` to `to` cannot lose data. */
function isWidening(from: string, to: string): boolean {
  if (from === to) return true;
  const f = parseSized(from);
  const t = parseSized(to);
  if (f && t && f.base === t.base) {
    if (f.base === "numeric") return t.a - t.b >= f.a - f.b && t.b >= f.b;
    return t.a >= f.a;
  }
  if (f?.base === "varchar" && to === "text") return true;
  return false;
}

async function existingConstraintNames(client: PoolClient, orgSchema: string): Promise<Set<string>> {
  const res = await client.query<{ conname: string }>(
    `SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = $1`,
    [orgSchema],
  );
  return new Set(res.rows.map((r) => r.conname));
}

export async function migrate(pool: Pool, schema: OrgSchema, options: MigrateOptions = {}): Promise<MigrateResult> {
  const orgSchema = options.orgSchema ?? DEFAULT_ORG_SCHEMA;
  const force = options.force ?? false;
  const plans = planSchema(schema);
  const statements: string[] = [];
  const warnings: string[] = [];

  await withTransaction(pool, async (client) => {
    const run = async (sql: string) => {
      statements.push(sql);
      await client.query(sql);
    };

    await run(`CREATE SCHEMA IF NOT EXISTS ${quote(orgSchema)}`);
    const existing = await existingColumns(client, orgSchema);
    const existingTables = new Map<string, Map<string, ExistingColumn>>();
    for (const c of existing) {
      const cols = existingTables.get(c.table) ?? new Map<string, ExistingColumn>();
      cols.set(c.column, c);
      existingTables.set(c.table, cols);
    }

    // 1. Tables and columns.
    for (const plan of plans) {
      const cols = existingTables.get(plan.table);
      if (!cols) {
        await run(createTableSql(orgSchema, plan));
        continue;
      }
      for (const column of plan.columns) {
        const current = cols.get(column.name);
        if (!current) {
          await run(addColumnSql(orgSchema, plan.table, column));
        } else if (current.sqlType !== column.sqlType) {
          await reconcileType(plan, column, current, force, run, warnings, orgSchema);
        }
      }
      for (const name of cols.keys()) {
        if (plan.columns.some((c) => c.name === name)) continue;
        if (force) await run(`ALTER TABLE ${quote(orgSchema)}.${quote(plan.table)} DROP COLUMN ${quote(name)}`);
        else warnings.push(`UNSUPPORTED:schema-drop column ${plan.table}.${name} is no longer in the metadata; kept (use --force to drop)`);
      }
    }
    for (const table of existingTables.keys()) {
      if (plans.some((p) => p.table === table)) continue;
      if (force) await run(`DROP TABLE ${quote(orgSchema)}.${quote(table)} CASCADE`);
      else warnings.push(`UNSUPPORTED:schema-drop table ${table} is no longer in the metadata; kept (use --force to drop)`);
    }

    // 2. Sequences, indexes, foreign keys (all idempotent).
    const constraints = await existingConstraintNames(client, orgSchema);
    for (const plan of plans) {
      for (const seq of plan.sequences) await run(sequenceSql(orgSchema, seq));
      for (const ix of plan.indexes) await run(indexSql(orgSchema, plan.table, ix));
      for (const fk of plan.foreignKeys) {
        if (constraints.has(fk.name)) continue;
        try {
          await run(foreignKeySql(orgSchema, plan.table, fk));
        } catch (err) {
          // Adding a foreign key validates existing rows. A lookup that was unchecked until now
          // (its target object was not modelled yet, or rows came in through --import) can hold
          // Ids with no target row; name the table and column instead of a bare constraint error.
          if (!isPgForeignKeyViolation(err)) throw err;
          throw new Error(
            `cannot add foreign key ${fk.name}: ${orgSchema}.${plan.table}.${fk.column} holds values with no matching row in ${orgSchema}.${fk.referencesTable}; clear or correct those values (for example lookups loaded with --import whose target records were not imported) and run again`,
            { cause: err },
          );
        }
      }
    }
  });

  return { statements, warnings };
}

async function reconcileType(
  plan: TablePlan,
  column: ColumnSpec,
  current: ExistingColumn,
  force: boolean,
  run: (sql: string) => Promise<void>,
  warnings: string[],
  orgSchema: string,
): Promise<void> {
  if (isWidening(current.sqlType, column.sqlType) || force) {
    await run(alterColumnTypeSql(orgSchema, plan.table, column));
  } else {
    warnings.push(
      `UNSUPPORTED:schema-narrow column ${plan.table}.${column.name} is ${current.sqlType} in the database but ${column.sqlType} in the metadata; kept (use --force to convert)`,
    );
  }
}
