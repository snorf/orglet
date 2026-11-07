/**
 * Heimdall's column-order and SOQL rules plus the `objects` row rules (name, metadata), re-derived from the
 * documented behaviour so the fixture generator and the archive loader agree on them.
 */

/** Describe JSON from `/sobjects/X/describe` fits this; so does a FieldDef. */
export interface DescribeFieldShape {
  name: string;
  type: string;
  referenceTo?: readonly string[];
}

const EXCLUDED_TYPES = new Set(["address", "base64"]);
const EXCLUDED_NAMES = new Set(["Tier", "Id", "SystemModstamp"]);

/** Describe order minus excluded fields, then SystemModstamp, then Id last. */
export function heimdallColumns(fields: readonly DescribeFieldShape[]): string[] {
  const rest = fields
    .filter((f) => !EXCLUDED_TYPES.has(f.type.toLowerCase()) && !EXCLUDED_NAMES.has(f.name))
    .map((f) => f.name);
  if (fields.some((f) => f.name === "SystemModstamp")) rest.push("SystemModstamp");
  if (fields.some((f) => f.name === "Id")) rest.push("Id");
  return rest;
}

export interface Checkpoint {
  /** Salesforce `+0000` datetime. */
  modstamp: string;
  id: string;
}

export interface SoqlOptions {
  deleted: boolean;
  checkpoint?: Checkpoint;
  limit?: number;
}

const SF_DATETIME = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}\+0000$/;

/** SOQL datetime literals use `Z` where the REST payloads use `+0000`. */
export function soqlDatetime(sfDatetime: string): string {
  if (!SF_DATETIME.test(sfDatetime)) throw new RangeError("datetime: expected a Salesforce datetime ending in +0000");
  return sfDatetime.replace(/\+0000$/, "Z");
}

/** Keyset-paged query ordered by (SystemModstamp|CreatedDate, Id). */
export function heimdallSoql(objectName: string, columns: readonly string[], options: SoqlOptions): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(objectName)) throw new RangeError("objectName: expected a Salesforce API name");
  const orderField = columns.includes("SystemModstamp") ? "SystemModstamp" : "CreatedDate";
  const where: string[] = [];
  if (options.deleted) where.push("IsDeleted = true");
  if (options.checkpoint) {
    const { modstamp, id } = options.checkpoint;
    if (!/^[A-Za-z0-9]{15,18}$/.test(id)) throw new RangeError("checkpoint id: expected a 15 or 18 character Id");
    const lit = soqlDatetime(modstamp);
    where.push(`((${orderField} = ${lit} AND Id > '${id}') OR ${orderField} > ${lit})`);
  }
  let soql = `SELECT ${columns.join(", ")} FROM ${objectName}`;
  if (where.length > 0) soql += ` WHERE ${where.join(" AND ")}`;
  soql += ` ORDER BY ${orderField} ASC, Id ASC`;
  if (options.limit !== undefined) soql += ` LIMIT ${options.limit}`;
  return soql;
}

export const NAME_FIELDS = ["Name", "Subject", "Title", "CaseNumber", "DeveloperName", "Label"] as const;

/**
 * objects.name: the first NAME_FIELDS entry that exists in the header with a non-empty cell, else the Id.
 * "Exists and non-empty" is orglet's reading of the documented rule.
 */
export function objectRecordName(header: readonly string[], cells: readonly string[]): string {
  for (const f of NAME_FIELDS) {
    const i = header.indexOf(f);
    const v = i >= 0 ? cells[i] : undefined;
    if (v) return v;
  }
  const idIdx = header.indexOf("Id");
  const id = idIdx >= 0 ? cells[idIdx] : undefined;
  if (idIdx < 0 || id === undefined) throw new Error("objects.name: row has no Id column");
  return id;
}

export const CONTENT_VERSION_METADATA_FIELDS = ["Checksum", "FileType", "FileExtension", "ContentSize", "Title", "PathOnClient"] as const;

/** objects.metadata: non-empty Id-like/reference columns, plus ContentVersion's file facts. Values stay strings. */
export function objectMetadata(
  objectName: string,
  header: readonly string[],
  cells: readonly string[],
  referenceFields: ReadonlySet<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  header.forEach((name, i) => {
    const v = cells[i];
    if (!v) return;
    const cvExtra = objectName === "ContentVersion" && (CONTENT_VERSION_METADATA_FIELDS as readonly string[]).includes(name);
    if (name.endsWith("Id") || referenceFields.has(name) || cvExtra) out[name] = v;
  });
  return out;
}
