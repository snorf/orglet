/**
 * Turns client-supplied field values into the canonical record representation and reports
 * the system-validation errors Salesforce would (type, length, restricted picklist, ID form).
 * Does not touch the database.
 */
import type { FieldDef, SObjectDef } from "@orglet/metadata";
import { normalizeId } from "@orglet/schema";
import type { RecordData, RecordValue } from "@orglet/formula";
import { Errors, type SaveError } from "./errors.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/;
const TIME_RE = /^\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z?$/;

export interface Coerced {
  value: RecordValue;
  error?: SaveError;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === "";
}

/** Normalise a datetime to Salesforce's `YYYY-MM-DDTHH:mm:ss.SSS+0000`. */
export function normalizeDatetime(input: string): string | undefined {
  if (!DATETIME_RE.test(input)) return undefined;
  const ms = Date.parse(input.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  if (!Number.isFinite(ms)) return undefined;
  const d = new Date(ms);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}+0000`
  );
}

export function coerceValue(field: FieldDef, raw: unknown): Coerced {
  if (isBlank(raw)) return { value: null };
  switch (field.type) {
    case "Id":
    case "Lookup":
    case "MasterDetail": {
      if (typeof raw !== "string") return { value: null, error: Errors.malformedId(field.label, field.name, raw) };
      const id = normalizeId(raw);
      if (!id) return { value: null, error: Errors.malformedId(field.label, field.name, raw) };
      return { value: id };
    }
    case "Checkbox": {
      if (typeof raw === "boolean") return { value: raw };
      if (raw === "true" || raw === "false") return { value: raw === "true" };
      return { value: null, error: Errors.invalidType(field.label, field.name, raw) };
    }
    case "Number":
    case "Currency":
    case "Percent": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
      if (!Number.isFinite(n)) return { value: null, error: Errors.invalidType(field.label, field.name, raw) };
      return { value: n };
    }
    case "Date": {
      if (typeof raw !== "string" || !DATE_RE.test(raw) || Number.isNaN(Date.parse(raw))) {
        return { value: null, error: Errors.invalidType(field.label, field.name, raw) };
      }
      return { value: raw };
    }
    case "DateTime": {
      const normalized = typeof raw === "string" ? normalizeDatetime(raw) : undefined;
      if (normalized === undefined) return { value: null, error: Errors.invalidType(field.label, field.name, raw) };
      return { value: normalized };
    }
    case "Time": {
      if (typeof raw !== "string" || !TIME_RE.test(raw)) return { value: null, error: Errors.invalidType(field.label, field.name, raw) };
      return { value: raw };
    }
    case "Picklist": {
      const value = String(raw);
      const picklist = field.picklist;
      if (picklist?.restricted && !picklist.values.some((v) => v.value === value && v.active)) {
        return { value: null, error: Errors.restrictedPicklist(field.label, field.name, value) };
      }
      return { value };
    }
    case "MultiselectPicklist": {
      const value = String(raw);
      const picklist = field.picklist;
      if (picklist?.restricted) {
        const bad = value.split(";").find((part) => !picklist.values.some((v) => v.value === part && v.active));
        if (bad !== undefined) return { value: null, error: Errors.restrictedPicklist(field.label, field.name, bad) };
      }
      return { value };
    }
    case "Address":
    case "Name":
    case "Location":
      return { value: null, error: Errors.notWritable([field.name]) };
    default: {
      // Text-like.
      const value = typeof raw === "string" ? raw : typeof raw === "number" || typeof raw === "boolean" ? String(raw) : undefined;
      if (value === undefined) return { value: null, error: Errors.invalidType(field.label, field.name, raw) };
      if (field.length !== undefined && value.length > field.length) {
        return { value: null, error: Errors.stringTooLong(field.label, field.name, value, field.length) };
      }
      return { value };
    }
  }
}

export interface CoercedRecord {
  /** Canonical field names, typed values. Only fields the client supplied. */
  values: RecordData;
  errors: SaveError[];
}

/**
 * Coerce one client record for insert or update: unknown fields, read-only fields and bad
 * values become errors. `Id` and `attributes` are ignored here; callers handle them.
 * In import mode every stored field is writable (audit fields, derived flags), and `Id` is
 * kept on insert so migrated records keep their identifiers.
 */
export function coerceRecord(obj: SObjectDef, input: Record<string, unknown>, operation: "insert" | "update", lookupField: (name: string) => FieldDef | undefined, importMode = false): CoercedRecord {
  const values: RecordData = {};
  const errors: SaveError[] = [];
  const notWritable: string[] = [];
  for (const [key, raw] of Object.entries(input)) {
    if (key === "attributes") continue;
    if (key.toLowerCase() === "id" && !(importMode && operation === "insert")) continue;
    const field = lookupField(key);
    if (!field) {
      errors.push(Errors.invalidField(key, obj.name));
      continue;
    }
    const writable = importMode ? field.formula === undefined && field.type !== "Address" && field.type !== "Name" && field.type !== "Location" : operation === "insert" ? field.createable : field.updateable;
    if (field.formula !== undefined || !writable) {
      notWritable.push(field.name);
      continue;
    }
    const coerced = coerceValue(field, raw);
    if (coerced.error) errors.push(coerced.error);
    else values[field.name] = coerced.value;
  }
  if (notWritable.length > 0) errors.push(Errors.notWritable(notWritable));
  return { values, errors };
}
