/**
 * Turns result rows into Salesforce record JSON according to a Shape.
 */
import { keyPrefixOf } from "@orglet/schema";
import type { AggregateShape, SObjectShape, Shape } from "./compile.js";

export type Row = Record<string, unknown>;

export interface ShapeOptions {
  /** e.g. "59.0"; used for `attributes.url`. */
  apiVersion: string;
  /** Called with the key prefix of a polymorphic lookup value that matches no modelled object (D-07); the parent is returned as null. */
  onUnmodelledPrefix?: (prefix: string) => void;
}

export interface QueryRecords {
  totalSize: number;
  done: boolean;
  records: Row[];
}

export function attributes(type: string, id: unknown, apiVersion: string): Row {
  return { type, url: `/services/data/v${apiVersion}/sobjects/${type}/${String(id)}` };
}

export function shapeSObjectRow(shape: SObjectShape, row: Row, options: ShapeOptions): Row | null {
  let type = shape.type;
  if (shape.poly) {
    // A polymorphic parent is typed per row from its Id prefix; a prefix no modelled object owns is a null parent, never a synthetic object (D-19).
    const concrete = row[shape.poly.typeAlias];
    if (typeof concrete !== "string") {
      const fk = row[shape.poly.fkAlias];
      if (typeof fk === "string") options.onUnmodelledPrefix?.(keyPrefixOf(fk));
      return null;
    }
    type = concrete;
  }
  const id = row[shape.idAlias];
  if (id === null || id === undefined) return null;
  const record: Row = { attributes: attributes(type, id, options.apiVersion) };
  for (const f of shape.fields) {
    const v = row[f.alias];
    record[f.name] = f.labels && typeof v === "string" ? (f.labels.get(v) ?? v) : v;
  }
  for (const [rel, parent] of shape.parents) record[rel] = shapeSObjectRow(parent, row, options);
  for (const [rel, child] of shape.children) {
    const raw = row[child.alias];
    const rows = Array.isArray(raw) ? (raw as Row[]) : [];
    const records = rows.map((r) => shapeSObjectRow(child.shape, r, options)).filter((r): r is Row => r !== null);
    record[rel] = rows.length === 0 ? null : { totalSize: records.length, done: true, records };
  }
  return record;
}

export function shapeAggregateRow(shape: AggregateShape, row: Row): Row {
  const record: Row = { attributes: { type: "AggregateResult" } };
  for (const c of shape.columns) record[c.name] = row[c.alias];
  return record;
}

export function shapeRows(shape: Shape, rows: Row[], options: ShapeOptions): Row[] {
  if (shape.kind === "aggregate") return rows.map((r) => shapeAggregateRow(shape, r));
  return rows.map((r) => shapeSObjectRow(shape, r, options)).filter((r): r is Row => r !== null);
}
