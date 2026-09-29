/**
 * Row-level Postgres access for one org schema. Knows about column naming and the
 * IsDeleted soft-delete flag; knows nothing about validation or order of execution.
 */
import type { FieldDef, OrgSchema, SObjectDef } from "@orglet/metadata";
import { columnName, isVirtual, quote, sequenceName, tableName, type Queryable } from "@orglet/schema";
import type { RecordData, RecordValue } from "@orglet/formula";

export class Store {
  constructor(
    readonly schema: OrgSchema,
    readonly orgSchema: string,
  ) {}

  table(obj: SObjectDef): string {
    return `${quote(this.orgSchema)}.${quote(tableName(obj))}`;
  }

  storedFields(obj: SObjectDef): FieldDef[] {
    return obj.fields.filter((f) => !isVirtual(f));
  }

  private selectList(obj: SObjectDef): string {
    return this.storedFields(obj)
      .map((f) => `${quote(columnName(f))} AS ${quote(f.name)}`)
      .join(", ");
  }

  async loadByIds(client: Queryable, obj: SObjectDef, ids: string[], includeDeleted = false): Promise<Map<string, RecordData>> {
    if (ids.length === 0) return new Map();
    const res = await client.query<RecordData>(
      `SELECT ${this.selectList(obj)} FROM ${this.table(obj)} WHERE ${quote("id")} = ANY($1)${includeDeleted ? "" : ` AND ${quote("isdeleted")} = false`}`,
      [ids],
    );
    return new Map(res.rows.map((r) => [r["Id"] as string, r]));
  }

  async findByField(client: Queryable, obj: SObjectDef, field: FieldDef, value: RecordValue): Promise<RecordData[]> {
    const col = quote(columnName(field));
    const where = field.caseSensitive || typeof value !== "string" ? `${col} = $1` : `lower(${col}) = lower($1)`;
    const res = await client.query<RecordData>(`SELECT ${this.selectList(obj)} FROM ${this.table(obj)} WHERE ${where} AND ${quote("isdeleted")} = false`, [value]);
    return res.rows;
  }

  /** Which of `ids` exist as live rows of `obj`. */
  async existingIds(client: Queryable, obj: SObjectDef, ids: string[], includeDeleted = false): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const res = await client.query<{ id: string }>(
      `SELECT ${quote("id")} AS id FROM ${this.table(obj)} WHERE ${quote("id")} = ANY($1)${includeDeleted ? "" : ` AND ${quote("isdeleted")} = false`}`,
      [ids],
    );
    return new Set(res.rows.map((r) => r.id));
  }

  async insert(client: Queryable, obj: SObjectDef, record: RecordData): Promise<void> {
    const cols: string[] = [];
    const params: unknown[] = [];
    for (const f of this.storedFields(obj)) {
      const v = record[f.name];
      if (v === undefined) continue;
      cols.push(quote(columnName(f)));
      params.push(v);
    }
    const placeholders = params.map((_, i) => `$${i + 1}`).join(", ");
    await client.query(`INSERT INTO ${this.table(obj)} (${cols.join(", ")}) VALUES (${placeholders})`, params);
  }

  async update(client: Queryable, obj: SObjectDef, id: string, changes: RecordData): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const f of this.storedFields(obj)) {
      if (f.name === "Id") continue;
      const v = changes[f.name];
      if (v === undefined) continue;
      params.push(v);
      sets.push(`${quote(columnName(f))} = $${params.length}`);
    }
    if (sets.length === 0) return;
    params.push(id);
    await client.query(`UPDATE ${this.table(obj)} SET ${sets.join(", ")} WHERE ${quote("id")} = $${params.length}`, params);
  }

  async setDeleted(client: Queryable, obj: SObjectDef, ids: string[], deleted: boolean, stamp: { at: string; by: string }): Promise<void> {
    if (ids.length === 0) return;
    await client.query(
      `UPDATE ${this.table(obj)} SET ${quote("isdeleted")} = $1, ${quote("lastmodifieddate")} = $2, ${quote("lastmodifiedbyid")} = $3, ${quote("systemmodstamp")} = $2 WHERE ${quote("id")} = ANY($4)`,
      [deleted, stamp.at, stamp.by, ids],
    );
  }

  /** Live child rows whose `field` points at any of `parentIds`. */
  async childrenOf(client: Queryable, child: SObjectDef, field: FieldDef, parentIds: string[], includeDeleted = false): Promise<RecordData[]> {
    if (parentIds.length === 0) return [];
    const res = await client.query<RecordData>(
      `SELECT ${this.selectList(child)} FROM ${this.table(child)} WHERE ${quote(columnName(field))} = ANY($1)${includeDeleted ? "" : ` AND ${quote("isdeleted")} = false`}`,
      [parentIds],
    );
    return res.rows;
  }

  async nextAutoNumber(client: Queryable, obj: SObjectDef, field: FieldDef): Promise<number> {
    const res = await client.query<{ n: number }>(`SELECT nextval('${this.orgSchema}.${sequenceName(obj, field)}') AS n`);
    return Number(res.rows[0]?.n ?? 0);
  }
}

/** Render an AutoNumber value: `A-{0000}` with 7 -> `A-0007`. */
export function formatAutoNumber(displayFormat: string | undefined, n: number): string {
  const fmt = displayFormat ?? "{0}";
  return fmt.replace(/\{(0+)\}/, (_, zeros: string) => String(n).padStart(zeros.length, "0"));
}
