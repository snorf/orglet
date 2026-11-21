/**
 * Heimdall's S3 key and period formats, re-derived from the documented layout so the fixture generator
 * and the archive loader build and parse keys with one rule set.
 */

const SF_DATETIME = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)\.(\d{3})\+0000$/;

function parseDatetime(sfDatetime: string, part: string): number[] {
  const m = SF_DATETIME.exec(sfDatetime);
  if (!m) throw new RangeError(`${part}: expected a Salesforce datetime ending in +0000`);
  return m.slice(1).map(Number);
}

const two = (n: number): string => String(n).padStart(2, "0");

function checkMonth(month: number): void {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new RangeError("month: expected 1-12");
}

/** `yyyyMM`, the Period= key segment. */
export function periodSegment(year: number, month: number): string {
  checkMonth(month);
  return `${String(year).padStart(4, "0")}${two(month)}`;
}

/** `YYMM` as an integer, the form the index tables store. */
export function periodInt(year: number, month: number): number {
  checkMonth(month);
  return (year % 100) * 100 + month;
}

/** Whole seconds since the epoch for a Salesforce `+0000` datetime (floored). */
export function epochSeconds(sfDatetime: string): number {
  const [y, mo, d, h, mi, s] = parseDatetime(sfDatetime, "datetime") as [number, number, number, number, number, number];
  return Math.floor(Date.UTC(y, mo - 1, d, h, mi, s) / 1000);
}

export interface CsvKeyParts {
  orgId: string;
  /** yyyyMM; the `Archive-yyyyMM` form is not supported. */
  period: string;
  /** Upload time, Salesforce `+0000` form; its UTC date becomes Year/Month/Date. */
  uploaded: string;
  objectName: string;
  deleted: boolean;
  fileName: string;
}

export function csvKey(p: CsvKeyParts): string {
  if (!/^[A-Za-z0-9]{15}([A-Za-z0-9]{3})?$/.test(p.orgId)) throw new RangeError("orgId: expected 15 or 18 alphanumerics");
  if (!/^\d{6}$/.test(p.period)) throw new RangeError("period: expected yyyyMM");
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(p.objectName)) throw new RangeError("objectName: expected a Salesforce API name");
  if (p.fileName.includes("/") || !p.fileName.endsWith(".csv")) throw new RangeError("fileName: expected a plain name ending in .csv");
  const [y, mo, d] = parseDatetime(p.uploaded, "uploaded") as [number, number, number];
  const folder = p.objectName + (p.deleted ? "_deleted" : "");
  return `OrgId=${p.orgId}/Period=${p.period}/Year=${String(y).padStart(4, "0")}/Month=${two(mo)}/Date=${two(d)}/${folder}/${p.fileName}`;
}

/** Wraps engine's `blobKey` output (`files/...`) in the org/period-0 prefix. */
export function blobObjectKey(orgId: string, filesKey: string): string {
  if (!filesKey.startsWith("files/")) throw new RangeError("filesKey: expected a files/ key");
  return `OrgId=${orgId}/Period=0/${filesKey}`;
}
