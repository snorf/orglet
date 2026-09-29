/**
 * Conversions between orglet's plain record values and sigha's typed value domain.
 *
 * Records are plain objects keyed by API name in canonical casing. Scalars are the JSON
 * shapes the REST API uses: numbers as numbers, dates as `YYYY-MM-DD`, datetimes as
 * `YYYY-MM-DDTHH:mm:ss.SSS+0000`, times as `HH:mm:ss.SSSZ`, blanks as null. Parent records
 * are nested under the relationship name (`{ Account: { Name: "Acme" } }`).
 */
import type { FieldDef } from "@orglet/metadata";
import { blank, bool, dateValue, datetimeValue, Decimal, num, text, timeValue, type SfType, type SfValue } from "@orglet/sigha";

export type RecordValue = string | number | boolean | null;
export interface RecordData {
  [key: string]: RecordValue | RecordData | undefined;
}

export function sfTypeOf(field: FieldDef): SfType {
  switch (field.type) {
    case "Number":
      return "Number";
    case "Currency":
      return "Currency";
    case "Percent":
      return "Percent";
    case "Checkbox":
      return "Boolean";
    case "Date":
      return "Date";
    case "DateTime":
      return "Datetime";
    case "Time":
      return "Time";
    case "Picklist":
      return "Picklist";
    case "MultiselectPicklist":
      return "Multipicklist";
    case "Id":
    case "Lookup":
    case "MasterDetail":
      return "Id";
    case "Text":
    case "TextArea":
    case "LongTextArea":
    case "Html":
    case "EncryptedText":
    case "Email":
    case "Phone":
    case "Url":
    case "AutoNumber":
    case "Name":
      return "Text";
    case "Address":
    case "Location":
      return "Unknown";
  }
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?Z?$/;

export function toSfValue(value: RecordValue | RecordData | undefined, type: SfType): SfValue {
  if (value === null || value === undefined || value === "" || typeof value === "object") return blank(type);
  switch (type) {
    case "Number":
    case "Currency":
    case "Percent": {
      const d = new Decimal(typeof value === "boolean" ? (value ? 1 : 0) : value);
      return { type, blank: false, data: d };
    }
    case "Boolean":
      return bool(typeof value === "boolean" ? value : value === "true" || value === 1);
    case "Date": {
      const m = DATE_RE.exec(String(value));
      if (!m) return blank(type);
      return dateValue({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) });
    }
    case "Datetime": {
      const ms = typeof value === "number" ? value : Date.parse(String(value).replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
      return Number.isFinite(ms) ? datetimeValue(ms) : blank(type);
    }
    case "Time": {
      const m = TIME_RE.exec(String(value));
      if (!m) return blank(type);
      const millis = Number(m[1]) * 3_600_000 + Number(m[2]) * 60_000 + Number(m[3] ?? 0) * 1000 + Number((m[4] ?? "0").padEnd(3, "0"));
      return timeValue(millis);
    }
    case "Text":
    case "Id":
    case "Picklist":
    case "Multipicklist":
      return { type, blank: false, data: String(value) };
    case "Unknown":
      return blank("Unknown");
  }
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

export function formatDate(parts: { year: number; month: number; day: number }): string {
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

/** Salesforce's REST rendering: `2024-01-31T13:45:00.000+0000`. */
export function formatDatetime(epochMillis: number): string {
  const d = new Date(epochMillis);
  return (
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}+0000`
  );
}

export function formatTime(millisOfDay: number): string {
  const h = Math.floor(millisOfDay / 3_600_000);
  const m = Math.floor((millisOfDay % 3_600_000) / 60_000);
  const s = Math.floor((millisOfDay % 60_000) / 1000);
  const ms = millisOfDay % 1000;
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms, 3)}Z`;
}

export function fromSfValue(v: SfValue): RecordValue {
  if (v.blank) return null;
  switch (v.type) {
    case "Number":
    case "Currency":
    case "Percent":
      return v.data.toNumber();
    case "Boolean":
      return v.data;
    case "Date":
      return formatDate(v.data);
    case "Datetime":
      return formatDatetime(v.data.epochMillis);
    case "Time":
      return formatTime(v.data.millisOfDay);
    case "Text":
    case "Id":
    case "Picklist":
    case "Multipicklist":
      return v.data;
    case "Unknown":
      return null;
  }
}

/** Scalar rendering of a record value; nested records and blanks render as "". */
export function asString(v: RecordValue | RecordData | undefined): string {
  if (v === null || v === undefined || typeof v === "object") return "";
  return String(v);
}

/** Blank-aware equality on record values, used by ISCHANGED. */
export function recordValuesEqual(a: RecordValue | RecordData | undefined, b: RecordValue | RecordData | undefined): boolean {
  const na = a === undefined || a === "" || typeof a === "object" ? null : a;
  const nb = b === undefined || b === "" || typeof b === "object" ? null : b;
  if (na === null || nb === null) return na === nb;
  if (typeof na === "number" || typeof nb === "number") return Number(na) === Number(nb);
  return String(na) === String(nb);
}

export { text, num, bool };
