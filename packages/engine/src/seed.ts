/** Seeds custom-metadata types from their record files (CMDT-02, CMDT-03). planCustomMetadataSeed is pure (coercion by declared type, derived Ids, relationship resolution, warnings) so orglet check can run it without a database; seedCustomMetadata syncs the plan into Postgres at orglet up, bypassing DmlEngine like bootstrapOrg, because the data API refuses __mdt writes by design (D-12). */
import { definitionTarget, pushDiagnostic, type CustomMetadataRecord, type Diagnostic, type DiagnosticSink, type FieldDef, type OrgSchema, type SObjectDef } from "@orglet/metadata";
import { columnName, deriveCustomMetadataId, formatSalesforceDatetime, quote, withTransaction, type Pool } from "@orglet/schema";
import type { RecordData, RecordValue } from "@orglet/formula";
import { coerceValue } from "./coerce.js";
import { Store } from "./store.js";

export interface CustomMetadataSeedRow {
  id: string;
  developerName: string;
  /** Field API name -> value, system fields DeveloperName..IsProtected plus every custom field. */
  values: RecordData;
}

export interface CustomMetadataPlan extends DiagnosticSink {
  /** Every __mdt type in the schema, name order, with its rows (empty when no file names it, so the sync removes its rows). */
  types: { object: SObjectDef; rows: CustomMetadataSeedRow[] }[];
  /** Total planned rows. */
  records: number;
}

/** The object a bare FieldDefinition value belongs to: the record's own value of the controlling EntityDefinition field (Metadata API metadataRelationshipControllingField), or undefined. */
function controllingEntity(f: FieldDef, r: CustomMetadataRecord): string | undefined {
  const c = f.metadataRelationshipControllingField?.toLowerCase();
  if (c === undefined) return undefined;
  const raw = r.values.find((v) => v.field.toLowerCase() === c)?.value;
  return raw === undefined || raw === "" ? undefined : raw;
}

type IssueKind = "unknown" | "coercion" | "mdt-target" | "definition";

interface Issue {
  kind: IssueKind;
  type: string;
  field: string;
  /** Target value for the kinds that name one. */
  value: string;
  fieldDef: FieldDef | undefined;
  records: Set<string>;
}

const mdtKey = (type: string, developerName: string) => `${type.toLowerCase()}\0${developerName.toLowerCase()}`;

export function planCustomMetadataSeed(schema: OrgSchema, records: readonly CustomMetadataRecord[], derive: typeof deriveCustomMetadataId = deriveCustomMetadataId): CustomMetadataPlan {
  const sink: CustomMetadataPlan = { warnings: [], diagnostics: [], types: [], records: 0 };
  const objects = [...schema.objects.values()].filter((o) => o.customMetadata === true).sort((a, b) => a.name.localeCompare(b.name));
  const byType = new Map(objects.map((o) => [o.name.toLowerCase(), o]));

  // Group by type, first definition of a DeveloperName wins.
  const grouped = new Map<string, CustomMetadataRecord[]>();
  const seen = new Set<string>();
  for (const r of records) {
    const obj = byType.get(r.type.toLowerCase());
    if (!obj) continue; // build has already warned about records of unknown types
    const key = mdtKey(obj.name, r.developerName);
    if (seen.has(key)) {
      pushDiagnostic(sink, { area: "custom-metadata-record", object: obj.name, message: `${r.file}: duplicate record ${obj.name}.${r.developerName}; the first definition is kept` });
      continue;
    }
    seen.add(key);
    const list = grouped.get(obj.name) ?? [];
    list.push(r);
    grouped.set(obj.name, list);
  }

  // Ids are derived, so every target can be resolved before anything is written (D-07).
  const ids = new Map<string, string>();
  const idOf = new Map<CustomMetadataRecord, string>();
  for (const obj of objects) {
    if (obj.keyPrefix === null) throw new Error(`custom metadata type ${obj.name} has no key prefix`);
    const owners = new Map<string, string>();
    for (const r of grouped.get(obj.name) ?? []) {
      const id = derive(obj.keyPrefix, obj.name, r.developerName);
      const first = owners.get(id);
      if (first !== undefined) throw new Error(`custom metadata Id collision in ${obj.name}: records ${first} and ${r.developerName} both derive ${id}; rename one of them`);
      owners.set(id, r.developerName);
      ids.set(mdtKey(obj.name, r.developerName), id);
      idOf.set(r, id);
    }
  }

  const issues = new Map<string, Issue>();
  const note = (kind: IssueKind, type: string, field: string, value: string, fieldDef: FieldDef | undefined, record: string) => {
    const key = [kind, type, field, value].join("\0");
    let issue = issues.get(key);
    if (!issue) {
      issue = { kind, type, field, value, fieldDef, records: new Set() };
      issues.set(key, issue);
    }
    issue.records.add(record);
  };

  for (const obj of objects) {
    const rows: CustomMetadataSeedRow[] = [];
    for (const r of grouped.get(obj.name) ?? []) {
      const values: RecordData = {
        DeveloperName: r.developerName,
        MasterLabel: r.label,
        Label: r.label, // D-16: Label always equals MasterLabel
        Language: "en_US", // the bootstrap Organization's LanguageLocaleKey
        NamespacePrefix: null, // source retrieve carries no namespace
        QualifiedApiName: r.developerName,
        IsProtected: r.protected,
      };
      for (const f of obj.fields) if (f.custom) values[f.name] = f.type === "Checkbox" ? false : null;
      for (const { field, value } of r.values) {
        const f = schema.getField(obj.name, field);
        if (!f?.custom) {
          note("unknown", obj.name, field, "", undefined, r.developerName);
          continue;
        }
        const def = definitionTarget(f);
        let stored: RecordValue;
        if (def === "EntityDefinition") {
          if (value === "") stored = null;
          else if (schema.getObject(value)) stored = value;
          else {
            note("definition", obj.name, f.name, value, f, r.developerName);
            stored = null;
          }
        } else if (def === "FieldDefinition") {
          // D-08 qualified form Object.Field, or a bare field name qualified by the controlling field on the same record (real retrieves write bare names).
          const dot = value.indexOf(".");
          const entity = dot > 0 ? value.slice(0, dot) : controllingEntity(f, r);
          const fieldName = dot > 0 ? value.slice(dot + 1) : value;
          if (value === "") stored = null;
          else if (entity !== undefined && schema.getObject(entity) && schema.getField(entity, fieldName)) stored = value;
          else {
            note("definition", obj.name, f.name, value, f, r.developerName);
            stored = null;
          }
        } else if (f.type === "MetadataRelationship") {
          const target = f.referenceTo?.[0] ?? "";
          const id = value === "" ? null : (ids.get(mdtKey(target, value)) ?? undefined);
          if (id === undefined) {
            note("mdt-target", obj.name, f.name, value, f, r.developerName);
            stored = null;
          } else stored = id;
        } else {
          const c = coerceValue(f, value);
          if (c.error) {
            note("coercion", obj.name, f.name, "", f, r.developerName);
            stored = null;
          } else stored = f.type === "Checkbox" && c.value === null ? false : c.value;
        }
        values[f.name] = stored;
      }
      rows.push({ id: idOf.get(r) as string, developerName: r.developerName, values });
    }
    sink.types.push({ object: obj, rows });
    sink.records += rows.length;
  }

  const diagnostics: Diagnostic[] = [];
  for (const i of issues.values()) {
    const names = [...i.records].sort().join(", ");
    const f = i.fieldDef;
    const target = f?.referenceTo?.[0] ?? "";
    let d: Diagnostic;
    if (i.kind === "unknown") d = { area: "custom-metadata-record", message: `${i.type}.${i.field} is not a field of ${i.type}; values dropped (records: ${names})` };
    else if (i.kind === "coercion") d = { area: "custom-metadata-record", message: `${i.type}.${i.field}: values that cannot be stored as ${f?.type ?? ""} were stored as null (records: ${names})` };
    else if (i.kind === "mdt-target") d = { area: "custom-metadata-record", message: `${i.type}.${i.field}: target ${target} record ${i.value} does not exist; stored as null (records: ${names})` };
    else d = { area: "reference-target", message: `${i.type}.${i.field}: ${f ? definitionTarget(f) : ""} target ${i.value} is not modelled by orglet; stored as null (records: ${names})` };
    diagnostics.push({ ...d, object: i.type, field: i.field });
  }
  diagnostics.sort((a, b) => `${a.area} ${a.message}`.localeCompare(`${b.area} ${b.message}`));
  for (const d of diagnostics) pushDiagnostic(sink, d);
  return sink;
}

export interface CustomMetadataSeedOptions {
  orgSchema: string;
  /** Bootstrap admin; CreatedById/LastModifiedById (D-16). */
  userId: string;
}

export interface CustomMetadataSeedResult {
  records: number;
  types: number;
  added: number;
  updated: number;
  removed: number;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  const numeric = (v: unknown) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)));
  return numeric(a) && numeric(b) && Number(a) === Number(b);
}

/**
 * Full sync, one transaction (D-03). Runs on every `orglet up`, `--import` included: it is direct SQL,
 * so the import-mode replica role never applies.
 */
export async function seedCustomMetadata(pool: Pool, schema: OrgSchema, plan: CustomMetadataPlan, options: CustomMetadataSeedOptions): Promise<CustomMetadataSeedResult> {
  const store = new Store(schema, options.orgSchema);
  const now = formatSalesforceDatetime(new Date());
  const { userId } = options;
  return withTransaction(pool, async (client) => {
    let added = 0;
    let updated = 0;
    let removed = 0;
    for (const { object: obj, rows } of plan.types) {
      const select = store
        .storedFields(obj)
        .map((f) => `${quote(columnName(f))} AS ${quote(f.name)}`)
        .join(", ");
      const existing = new Map((await client.query<RecordData>(`SELECT ${select} FROM ${store.table(obj)}`)).rows.map((r) => [r["Id"] as string, r]));
      for (const row of rows) {
        const current = existing.get(row.id);
        if (!current) {
          await store.insert(client, obj, { ...row.values, Id: row.id, CreatedDate: now, CreatedById: userId, LastModifiedDate: now, LastModifiedById: userId, SystemModstamp: now });
          added++;
          continue;
        }
        const changes: RecordData = {};
        for (const [k, v] of Object.entries(row.values)) if (!same(current[k], v)) changes[k] = v;
        // Stamps move only on a real change, so a second run is a no-op (Pitfall 7).
        if (Object.keys(changes).length > 0) {
          await store.update(client, obj, row.id, { ...changes, LastModifiedDate: now, LastModifiedById: userId, SystemModstamp: now });
          updated++;
        }
      }
      const planned = new Set(rows.map((r) => r.id));
      const gone = [...existing.keys()].filter((id) => !planned.has(id));
      if (gone.length > 0) {
        // __mdt has no recycle bin, so a vanished record file is a hard delete (D-03).
        const res = await client.query(`DELETE FROM ${store.table(obj)} WHERE ${quote("id")} = ANY($1)`, [gone]);
        removed += res.rowCount ?? 0;
      }
    }
    return { records: plan.records, types: plan.types.length, added, updated, removed };
  });
}

export function customMetadataSummary(r: CustomMetadataSeedResult): string {
  return `custom metadata: ${r.records} records in ${r.types} types (${r.added} added, ${r.updated} updated, ${r.removed} removed)`;
}
