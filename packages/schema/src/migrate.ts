/**
 * Brings a Postgres database in line with an OrgSchema: creates missing tables, columns,
 * sequences, indexes and foreign keys; widens columns whose type grew. Anything destructive
 * (dropping tables or columns, narrowing types) only happens with `force` and is otherwise
 * reported as an `UNSUPPORTED:schema-*` warning, so a reload never loses data by accident.
 * A foreign key that existing rows would violate is skipped with an `UNSUPPORTED:schema-fk` warning
 * and retried on the next run.
 * Newly added roll-up summary columns are backfilled once.
 */
import { pushDiagnostic, type Diagnostic, type DiagnosticSink, type FieldDef, type OrgSchema } from "@orglet/metadata";
import { DEFAULT_ORG_SCHEMA, columnName, quote, type ColumnSpec } from "./columns.js";
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
import { rollupBackfillSql, rollupDepth } from "./rollup.js";

export interface MigrateOptions {
  orgSchema?: string;
  /** Allow dropping tables/columns and narrowing types. */
  force?: boolean;
}

export interface MigrateResult {
  /** Executed statements, in order. */
  statements: string[];
  warnings: string[];
  /** Structured form of `warnings`, same order (D-15). */
  diagnostics: Diagnostic[];
}

interface ExistingColumn {
  table: string;
  column: string;
  sqlType: string;
}

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

async function existingIndexNames(client: PoolClient, orgSchema: string): Promise<Set<string>> {
  const res = await client.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = $1`, [orgSchema]);
  return new Set(res.rows.map((r) => r.indexname));
}

async function existingSequenceNames(client: PoolClient, orgSchema: string): Promise<Set<string>> {
  const res = await client.query<{ sequencename: string }>(`SELECT sequencename FROM pg_sequences WHERE schemaname = $1`, [orgSchema]);
  return new Set(res.rows.map((r) => r.sequencename));
}

export async function migrate(pool: Pool, schema: OrgSchema, options: MigrateOptions = {}): Promise<MigrateResult> {
  const orgSchema = options.orgSchema ?? DEFAULT_ORG_SCHEMA;
  const force = options.force ?? false;
  const plans = planSchema(schema);
  const statements: string[] = [];
  const sink: DiagnosticSink = { warnings: [], diagnostics: [] };

  await withTransaction(pool, async (client) => {
    const run = async (sql: string, params?: unknown[]) => {
      statements.push(sql);
      await client.query(sql, params);
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
    const backfills: { plan: TablePlan; field: FieldDef }[] = [];
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
          const field = plan.object.fields.find((f) => f.rollup !== undefined && columnName(f) === column.name);
          if (field) backfills.push({ plan, field });
        } else if (current.sqlType !== column.sqlType) {
          await reconcileType(plan, column, current, force, run, sink, orgSchema);
        }
      }
      for (const name of cols.keys()) {
        if (plan.columns.some((c) => c.name === name)) continue;
        if (force) await run(`ALTER TABLE ${quote(orgSchema)}.${quote(plan.table)} DROP COLUMN ${quote(name)}`);
        else {
          const field = fieldOf(plan, name);
          pushDiagnostic(sink, {
            area: "schema-drop",
            object: plan.object.name,
            ...(field !== undefined ? { field } : {}),
            message: `column ${plan.table}.${name} is no longer in the metadata; kept (use --force to drop)`,
          });
        }
      }
    }
    for (const table of existingTables.keys()) {
      if (plans.some((p) => p.table === table)) continue;
      if (force) await run(`DROP TABLE ${quote(orgSchema)}.${quote(table)} CASCADE`);
      else pushDiagnostic(sink, { area: "schema-drop", message: `table ${table} is no longer in the metadata; kept (use --force to drop)` });
    }

    // 2. Sequences, indexes, foreign keys. Existing sequences and indexes are read from the catalog once and
    // skipped, so a second run executes no CREATE INDEX / CREATE SEQUENCE (D-04).
    const constraints = await existingConstraintNames(client, orgSchema);
    const indexes = await existingIndexNames(client, orgSchema);
    const sequences = await existingSequenceNames(client, orgSchema);
    for (const plan of plans) {
      for (const seq of plan.sequences) {
        if (sequences.has(seq)) continue;
        await run(sequenceSql(orgSchema, seq));
        sequences.add(seq);
      }
      for (const ix of plan.indexes) {
        if (indexes.has(ix.name)) continue;
        await run(indexSql(orgSchema, plan.table, ix));
        indexes.add(ix.name); // two planned indexes can share a truncated identifier() name
      }
      for (const fk of plan.foreignKeys) {
        if (constraints.has(fk.name)) continue;
        // D-01..D-03: adding a foreign key validates existing rows, and a failed ADD CONSTRAINT aborts the whole
        // transaction. A table created in this run is empty; only a table that existed before can hold values with
        // no target row (lookups loaded with --import, or a target that was not modelled until now). Count them
        // first, skip the FK and warn; nothing is deleted or rewritten, and the next run checks again.
        if (existingTables.has(plan.table)) {
          const bad = await client.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM ${quote(orgSchema)}.${quote(plan.table)} t WHERE t.${quote(fk.column)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${quote(orgSchema)}.${quote(fk.referencesTable)} r WHERE r."id" = t.${quote(fk.column)})`,
          );
          const n = Number(bad.rows[0]?.n ?? 0);
          if (n > 0) {
            const field = fieldOf(plan, fk.column);
            pushDiagnostic(sink, {
              area: "schema-fk",
              object: plan.object.name,
              ...(field !== undefined ? { field } : {}),
              message: `foreign key ${fk.name} not added: ${plan.table}.${fk.column} holds ${n} value(s) with no matching row in ${fk.referencesTable}; correct or clear them and run orglet up again`,
            });
            continue;
          }
        }
        await run(foreignKeySql(orgSchema, plan.table, fk));
      }
    }

    // 3. D-10: a roll-up column added to a table that may hold rows is computed once, lower chain levels
    // first, with migration semantics (no hooks, no rules). Later changes come from the engine's recompute.
    // Tables created in this run are empty and need nothing. This must stay the last step: updating a row a
    // second time in one transaction queues a deferred foreign-key check on it, and Postgres then refuses
    // DDL on that table ("has pending trigger events") until commit.
    backfills.sort((a, b) => rollupDepth(schema, a.field) - rollupDepth(schema, b.field));
    for (const { plan, field } of backfills) {
      const { sql, params } = rollupBackfillSql(orgSchema, schema, plan.object, field);
      await run(sql, params);
    }
  });

  return { statements, warnings: sink.warnings, diagnostics: sink.diagnostics };
}

/** API name of the stored field behind a column, when there is one (system columns have none). */
const fieldOf = (plan: TablePlan, column: string): string | undefined => plan.object.fields.find((f) => columnName(f) === column)?.name;

async function reconcileType(
  plan: TablePlan,
  column: ColumnSpec,
  current: ExistingColumn,
  force: boolean,
  run: (sql: string) => Promise<void>,
  sink: DiagnosticSink,
  orgSchema: string,
): Promise<void> {
  if (isWidening(current.sqlType, column.sqlType) || force) {
    await run(alterColumnTypeSql(orgSchema, plan.table, column));
  } else {
    const field = fieldOf(plan, column.name);
    pushDiagnostic(sink, {
      area: "schema-narrow",
      object: plan.object.name,
      ...(field !== undefined ? { field } : {}),
      message: `column ${plan.table}.${column.name} is ${current.sqlType} in the database but ${column.sqlType} in the metadata; kept (use --force to convert)`,
    });
  }
}
