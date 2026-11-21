/**
 * Backs up one period of the fixture org the way Heimdall does (Phase 16 D-05, D-13): every replicateable object, Heimdall's column order and SOQL, real Bulk 2.0 query jobs through app.inject, pages joined under one header, and a `queryAll ... IsDeleted = true` phase into `<Object>_deleted`.
 */
import { heimdallColumns, heimdallSoql, parseBulkCsv } from "@orglet/archive";
import type { Checkpoint } from "@orglet/archive";
import type { FixtureOrg } from "./org.js";

export const API = "/services/data/v59.0";

export interface DescribedObject {
  name: string;
  columns: string[];
  referenceColumns: ReadonlySet<string>;
}
export interface ExportedCsv {
  fileName: string;
  text: string;
  header: string[];
  rows: string[][];
}
export interface ObjectRun {
  objectName: string;
  deleted: boolean;
  status: "Completed" | "Failed";
  csvs: ExportedCsv[];
  errorMessage: string | null;
  checkpoint: Checkpoint | null;
}
export interface ExportOptions {
  startCheckpoints: ReadonlyMap<string, Checkpoint>;
  limitFor: (objectName: string) => number;
  nextFileName: () => string;
}

const codeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

async function getJson<T>(org: FixtureOrg, url: string, what: string): Promise<T> {
  const res = await org.app.inject({ method: "GET", url, headers: org.headers });
  if (res.statusCode !== 200) throw new Error(`describe: ${what} returned ${res.statusCode}`);
  return JSON.parse(res.body) as T;
}

export async function describeReplicateable(org: FixtureOrg): Promise<DescribedObject[]> {
  const global = await getJson<{ sobjects: { name: string; replicateable?: boolean }[] }>(org, `${API}/sobjects/`, "global describe");
  const names = global.sobjects.filter((s) => s.replicateable === true).map((s) => s.name).sort(codeUnit);
  const out: DescribedObject[] = [];
  for (const name of names) {
    const d = await getJson<{ fields: { name: string; type: string; referenceTo?: string[] }[] }>(org, `${API}/sobjects/${name}/describe`, name);
    const columns = heimdallColumns(d.fields);
    const inColumns = new Set(columns);
    out.push({ name, columns, referenceColumns: new Set(d.fields.filter((f) => f.type === "reference" && inColumns.has(f.name)).map((f) => f.name)) });
  }
  return out;
}

type Phase = { kind: "refused"; run: ObjectRun } | { kind: "done"; csvs: ExportedCsv[]; checkpoint: Checkpoint | null };

async function runPhase(org: FixtureOrg, obj: DescribedObject, deleted: boolean, start: Checkpoint | undefined, options: ExportOptions): Promise<Phase> {
  const csvs: ExportedCsv[] = [];
  let cp = start;
  for (;;) {
    const query = heimdallSoql(obj.name, obj.columns, { deleted, limit: options.limitFor(obj.name), ...(cp ? { checkpoint: cp } : {}) });
    const post = await org.app.inject({
      method: "POST",
      url: `${API}/jobs/query`,
      headers: org.headers,
      payload: JSON.stringify({ operation: deleted ? "queryAll" : "query", query, contentType: "CSV", lineEnding: "LF" }),
    });
    if (post.statusCode === 400) {
      const body = JSON.parse(post.body) as { message: string; errorCode: string }[];
      const first = body[0];
      return {
        kind: "refused",
        run: { objectName: obj.name, deleted, status: "Failed", csvs, errorMessage: `${first?.errorCode ?? "UNKNOWN"}: ${first?.message ?? ""}`, checkpoint: null },
      };
    }
    if (post.statusCode !== 200) throw new Error(`export: ${obj.name} job create returned ${post.statusCode}`);
    const job = JSON.parse(post.body) as { id: string; state: string };
    let state = job.state;
    for (let i = 0; i < 10 && state !== "JobComplete"; i++) {
      const info = await getJson<{ state: string }>(org, `${API}/jobs/query/${job.id}`, `${obj.name} job`);
      state = info.state;
    }
    if (state !== "JobComplete") throw new Error(`export: ${obj.name} job ended in state ${state}`);

    let text = "";
    let counted = 0;
    let locator: string | null = "0";
    while (locator !== null && locator !== "null") {
      const url: string = `${API}/jobs/query/${job.id}/results?maxRecords=2000${locator === "0" ? "" : `&locator=${locator}`}`;
      const page = await org.app.inject({ method: "GET", url, headers: org.headers });
      if (page.statusCode !== 200) throw new Error(`export: ${obj.name} results returned ${page.statusCode}`);
      const body = page.body;
      text += text === "" ? body : body.slice(body.indexOf("\n") + 1);
      counted += Number(page.headers["sforce-numberofrecords"] ?? 0);
      const next = page.headers["sforce-locator"];
      locator = typeof next === "string" ? next : null;
    }
    if (text === "\n" || text === "") break;
    const parsed = parseBulkCsv(text);
    if (parsed.rows.length === 0) break;
    if (parsed.header.join(",") !== obj.columns.join(",")) throw new Error(`format check: ${obj.name} header differs from Heimdall column rule`);
    if (obj.columns.includes("SystemModstamp") && (parsed.header.at(-2) !== "SystemModstamp" || parsed.header.at(-1) !== "Id")) {
      throw new Error(`format check: ${obj.name} header does not end with SystemModstamp,Id`);
    }
    if (counted !== parsed.rows.length) throw new Error(`format check: ${obj.name} record count header differs from the CSV rows`);
    csvs.push({ fileName: options.nextFileName(), text, header: parsed.header, rows: parsed.rows });
    const last = parsed.rows.at(-1) as string[];
    const orderCol = parsed.header.indexOf(obj.columns.includes("SystemModstamp") ? "SystemModstamp" : "CreatedDate");
    cp = { modstamp: last[orderCol] as string, id: last[parsed.header.indexOf("Id")] as string };
  }
  return { kind: "done", csvs, checkpoint: csvs.length > 0 && cp ? cp : null };
}

export async function exportPeriod(org: FixtureOrg, objects: readonly DescribedObject[], options: ExportOptions): Promise<ObjectRun[]> {
  const runs: ObjectRun[] = [];
  for (const obj of objects) {
    const active = await runPhase(org, obj, false, options.startCheckpoints.get(obj.name), options);
    if (active.kind === "refused") {
      runs.push(active.run);
      continue;
    }
    if (active.csvs.length > 0) runs.push({ objectName: obj.name, deleted: false, status: "Completed", csvs: active.csvs, errorMessage: null, checkpoint: active.checkpoint });
    const del = await runPhase(org, obj, true, undefined, options);
    if (del.kind === "refused") runs.push(del.run);
    else if (del.csvs.length > 0) runs.push({ objectName: obj.name, deleted: true, status: "Completed", csvs: del.csvs, errorMessage: null, checkpoint: del.checkpoint });
  }
  return runs;
}
