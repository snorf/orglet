/**
 * Runs SOQL through the compiler against the org database and shapes the result like the
 * REST `query` resource: total size, done flag, records with attributes, formula fields
 * computed, and stateless pagination through an offset window.
 */
import type { PoolClient } from "@orglet/schema";
import { compileSoql, shapeRows, type Row, type SObjectShape } from "@orglet/soql";
import { asString, type RecordData } from "@orglet/formula";
import type { DmlEngine } from "./engine.js";
import type { Session } from "./hooks.js";

export interface QueryOptions {
  includeDeleted?: boolean;
  apiVersion?: string;
  /** Rows per page; Salesforce defaults to 2000. */
  batchSize?: number;
  /** Row offset of this page (from the query locator). */
  offset?: number;
  now?: Date;
}

export interface QueryPage {
  totalSize: number;
  done: boolean;
  records: Row[];
  /** Offset of the next page when `done` is false. */
  nextOffset?: number;
  /** UNSUPPORTED:reference-target lines, one per distinct unmodelled key prefix seen while shaping (D-07); absent when none. */
  warnings?: string[];
}

export async function runQuery(engine: DmlEngine, session: Session, soql: string, options: QueryOptions = {}): Promise<QueryPage> {
  const compiled = compileSoql(soql, {
    schema: engine.schema,
    orgSchema: engine.orgSchema,
    includeDeleted: options.includeDeleted ?? false,
    ...(options.now ? { now: options.now } : {}),
  });
  const batchSize = options.batchSize ?? 2000;
  const offset = options.offset ?? 0;
  const apiVersion = options.apiVersion ?? "59.0";

  const client: PoolClient = await engine.pool.connect();
  try {
    if (compiled.countOnly) {
      const res = await client.query<{ c0: number }>(compiled.sql, compiled.params);
      return { totalSize: Number(res.rows[0]?.c0 ?? 0), done: true, records: [] };
    }
    // Wrap the user's query so its own LIMIT/OFFSET stay intact and pagination applies on top.
    const page = await client.query<Row>(`SELECT * FROM (${compiled.sql}) q LIMIT ${batchSize + 1} OFFSET ${offset}`, compiled.params);
    const hasMore = page.rows.length > batchSize;
    const rows = hasMore ? page.rows.slice(0, batchSize) : page.rows;
    let totalSize = offset + rows.length;
    if (hasMore) {
      const count = await client.query<{ n: number }>(`SELECT count(*) AS n FROM (${compiled.sql}) q`, compiled.params);
      totalSize = Number(count.rows[0]?.n ?? totalSize);
    }

    const unmodelled = new Set<string>();
    const records = shapeRows(compiled.shape, rows, { apiVersion, onUnmodelledPrefix: (prefix) => unmodelled.add(prefix) });
    if (compiled.shape.kind === "sobject" && compiled.shape.computed.length > 0) {
      await computeFormulaFields(engine, client, session, compiled.shape, records);
    }
    const result: QueryPage = { totalSize, done: !hasMore, records };
    if (hasMore) result.nextOffset = offset + batchSize;
    if (unmodelled.size > 0) result.warnings = [...unmodelled].sort().map((p) => `UNSUPPORTED:reference-target ${p} matches no object in the org schema`);
    return result;
  } finally {
    client.release();
  }
}

/** Formula fields need the full stored row: load it, project, and copy the requested values over. */
async function computeFormulaFields(engine: DmlEngine, client: PoolClient, session: Session, shape: SObjectShape, records: Row[]): Promise<void> {
  const obj = engine.object(shape.type);
  const idOf = (r: Row): string => (typeof r["Id"] === "string" ? r["Id"] : ((r["attributes"] as { url: string }).url.split("/").pop() ?? ""));
  const ids = records.map(idOf);
  const full = await engine.store.loadByIds(client, obj, ids, true);
  const rows = [...full.values()];
  await engine.project(client, session, obj, rows);
  const byId = new Map(rows.map((r) => [asString(r["Id"]), r]));
  for (const record of records) {
    const id = idOf(record);
    const source: RecordData | undefined = byId.get(id);
    for (const name of shape.computed) record[name] = source?.[name] ?? null;
  }
}
