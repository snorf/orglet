import type { FastifyInstance, FastifyRequest } from "fastify";
import type { SaveResult } from "@orglet/engine";
import { asString } from "@orglet/formula";
import { apiError, sendErrors, session, type ApiContext } from "../server.js";
import { recordJson } from "./sobjects.js";

type Rec = Record<string, unknown>;

/** Collections report errors with `statusCode`, unlike single-record calls (`errorCode`). */
function collectionResult(r: SaveResult): Rec {
  const out: Rec = { id: r.id ?? null, success: r.success, errors: r.errors.map((e) => ({ statusCode: e.statusCode, message: e.message, fields: e.fields })) };
  if (r.created !== undefined) out["created"] = r.created;
  return out;
}

/** Run one DML operation over records that may mix object types, preserving order. */
async function runByType(
  records: Rec[],
  op: (type: string, batch: Rec[]) => Promise<SaveResult[]>,
): Promise<SaveResult[]> {
  const results: SaveResult[] = new Array<SaveResult>(records.length);
  const groups = new Map<string, number[]>();
  records.forEach((r, i) => {
    const type = String((r["attributes"] as { type?: string } | undefined)?.type ?? "");
    groups.set(type, [...(groups.get(type) ?? []), i]);
  });
  for (const [type, indexes] of groups) {
    if (!type) {
      for (const i of indexes) results[i] = { success: false, errors: [{ statusCode: "INVALID_TYPE", message: "The attributes.type is required for each record", fields: [] }] };
      continue;
    }
    const batch = indexes.map((i) => {
      const { attributes: _a, ...rest } = records[i] as Rec;
      return rest;
    });
    let out: SaveResult[];
    try {
      out = await op(type, batch);
    } catch (err) {
      const message = (err as Error).message;
      out = batch.map(() => ({ success: false, errors: [{ statusCode: (err as { statusCode?: string }).statusCode ?? "UNKNOWN_EXCEPTION", message, fields: [] }] }));
    }
    indexes.forEach((i, j) => {
      results[i] = out[j] as SaveResult;
    });
  }
  return results;
}

/** `@{ref.field.path}` substitution for composite subrequests. */
function substitute(value: unknown, refs: Map<string, unknown>): unknown {
  if (typeof value === "string") {
    return value.replace(/@\{([^}]+)\}/g, (_, path: string) => {
      const [refId, ...rest] = path.split(".");
      let cur: unknown = refs.get(refId ?? "");
      for (const seg of rest) {
        const m = /^(\w+)\[(\d+)\]$/.exec(seg);
        if (m) {
          cur = (cur as Rec | undefined)?.[m[1] ?? ""];
          cur = Array.isArray(cur) ? (cur as unknown[])[Number(m[2])] : undefined;
        } else {
          cur = (cur as Rec | undefined)?.[seg];
        }
      }
      if (cur === undefined || cur === null || typeof cur === "object") return "";
      return typeof cur === "string" ? cur : JSON.stringify(cur);
    });
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, refs));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Rec).map(([k, v]) => [k, substitute(v, refs)]));
  return value;
}

export function registerCompositeRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const version = (req: FastifyRequest) => req.apiVersion ?? ctx.defaultVersion;
  const allOrNone = (body: Rec | undefined, query: Rec) => Boolean(body?.["allOrNone"] ?? (query["allOrNone"] === "true"));

  // ---- sObject collections ----------------------------------------------------------------

  app.post("/services/data/v:version/composite/sobjects", async (req, reply) => {
    const body = req.body as { records?: Rec[]; allOrNone?: boolean } | undefined;
    const records = body?.records ?? [];
    const s = session(req);
    const results = await runByType(records, (type, batch) => ctx.engine.insert(s, type, batch, { allOrNone: allOrNone(body, req.query as Rec) }));
    return reply.send(results.map(collectionResult));
  });

  app.patch("/services/data/v:version/composite/sobjects", async (req, reply) => {
    const body = req.body as { records?: Rec[]; allOrNone?: boolean } | undefined;
    const s = session(req);
    const results = await runByType(body?.records ?? [], (type, batch) => ctx.engine.update(s, type, batch, { allOrNone: allOrNone(body, req.query as Rec) }));
    return reply.send(results.map(collectionResult));
  });

  app.delete("/services/data/v:version/composite/sobjects", async (req, reply) => {
    const q = req.query as { ids?: string; allOrNone?: string };
    const ids = (q.ids ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const s = session(req);
    // Ids may belong to different objects: route each by key prefix.
    const byType = new Map<string, number[]>();
    ids.forEach((id, i) => {
      const obj = [...ctx.engine.schema.objects.values()].find((o) => o.keyPrefix === id.slice(0, 3));
      byType.set(obj?.name ?? "", [...(byType.get(obj?.name ?? "") ?? []), i]);
    });
    const results: SaveResult[] = new Array<SaveResult>(ids.length);
    for (const [type, indexes] of byType) {
      if (!type) {
        for (const i of indexes) results[i] = { success: false, errors: [{ statusCode: "MALFORMED_ID", message: `malformed id ${ids[i] ?? ""}`, fields: [] }] };
        continue;
      }
      const out = await ctx.engine.delete(s, type, indexes.map((i) => ids[i] as string), { allOrNone: q.allOrNone === "true" });
      indexes.forEach((i, j) => {
        results[i] = out[j] as SaveResult;
      });
    }
    return reply.send(results.map(collectionResult));
  });

  app.post<{ Params: { type: string } }>("/services/data/v:version/composite/sobjects/:type", async (req, reply) => {
    const body = req.body as { ids?: string[]; fields?: string[] } | undefined;
    const obj = ctx.engine.schema.getObject(req.params.type);
    if (!obj) return sendErrors(reply, 404, [apiError("NOT_FOUND", "The requested resource does not exist")]);
    const ids = body?.ids ?? [];
    const found = await ctx.engine.retrieve(session(req), obj.name, ids);
    return reply.send(ids.map((id) => {
      const rec = [...found.values()].find((r) => asString(r["Id"]).startsWith(id.slice(0, 15)));
      return rec ? recordJson(obj.name, rec, version(req), body?.fields) : null;
    }));
  });

  app.patch<{ Params: { type: string; field: string } }>("/services/data/v:version/composite/sobjects/:type/:field", async (req, reply) => {
    const body = req.body as { records?: Rec[]; allOrNone?: boolean } | undefined;
    const obj = ctx.engine.schema.getObject(req.params.type);
    if (!obj) return sendErrors(reply, 404, [apiError("NOT_FOUND", "The requested resource does not exist")]);
    const records = (body?.records ?? []).map((r) => {
      const { attributes: _a, ...rest } = r;
      return rest;
    });
    const results = await ctx.engine.upsert(session(req), obj.name, req.params.field, records, { allOrNone: allOrNone(body, req.query as Rec) });
    return reply.send(results.map(collectionResult));
  });

  // ---- composite request: subrequests with @{ref} substitution -------------------------

  interface SubRequest {
    method: string;
    url: string;
    referenceId: string;
    body?: unknown;
    httpHeaders?: Record<string, string>;
  }

  const inject = async (req: FastifyRequest, sub: SubRequest, refs: Map<string, unknown>) => {
    const url = String(substitute(sub.url, refs));
    const payload = sub.body === undefined ? undefined : substitute(sub.body, refs);
    const res = await app.inject({
      method: sub.method.toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
      url,
      headers: { authorization: req.headers.authorization ?? "", "content-type": "application/json", ...(sub.httpHeaders ?? {}) },
      ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
    });
    const text = res.body;
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    return { status: res.statusCode, body: parsed, headers: res.headers };
  };

  app.post("/services/data/v:version/composite", async (req, reply) => {
    const body = req.body as { compositeRequest?: SubRequest[]; allOrNone?: boolean } | undefined;
    const subs = body?.compositeRequest ?? [];
    const refs = new Map<string, unknown>();
    const responses: Rec[] = [];
    let failed = false;
    if (body?.allOrNone && !ctx.unsupported.has("composite-rollback")) {
      ctx.unsupported.add("composite-rollback");
      req.log.warn("UNSUPPORTED:composite-rollback allOrNone on /composite does not roll back earlier subrequests");
    }
    for (const sub of subs) {
      if (failed && body?.allOrNone) {
        responses.push({ body: [apiError("PROCESSING_HALTED", "The transaction was rolled back since another operation in the same transaction failed.")], httpHeaders: {}, httpStatusCode: 400, referenceId: sub.referenceId });
        continue;
      }
      const res = await inject(req, sub, refs);
      if (res.status >= 400) failed = true;
      refs.set(sub.referenceId, res.body);
      const httpHeaders: Rec = {};
      if (res.status === 201 && res.body && typeof res.body === "object" && "id" in res.body) {
        httpHeaders["Location"] = `${sub.url.replace(/\/$/, "")}/${String((res.body as { id: string }).id)}`;
      }
      responses.push({ body: res.body, httpHeaders, httpStatusCode: res.status, referenceId: sub.referenceId });
    }
    return reply.send({ compositeResponse: responses });
  });

  app.post("/services/data/v:version/composite/batch", async (req, reply) => {
    const body = req.body as { batchRequests?: { method: string; url: string; richInput?: unknown }[]; haltOnError?: boolean } | undefined;
    const results: Rec[] = [];
    let hasErrors = false;
    for (const b of body?.batchRequests ?? []) {
      if (hasErrors && body?.haltOnError) {
        results.push({ statusCode: 412, result: [apiError("PROCESSING_HALTED", "Halted because of an error in a previous batch request")] });
        continue;
      }
      const url = b.url.startsWith("/") ? b.url : `/services/data/${b.url}`;
      const res = await inject(req, { method: b.method, url, referenceId: "", ...(b.richInput === undefined ? {} : { body: b.richInput }) }, new Map());
      if (res.status >= 400) hasErrors = true;
      results.push({ statusCode: res.status, result: res.body });
    }
    return reply.send({ hasErrors, results });
  });

  // ---- composite tree ----------------------------------------------------------------------

  app.post<{ Params: { type: string } }>("/services/data/v:version/composite/tree/:type", async (req, reply) => {
    const body = req.body as { records?: Rec[] } | undefined;
    const s = session(req);
    const results: { referenceId: string; id?: string; errors?: Rec[] }[] = [];
    let hasErrors = false;

    const insertLevel = async (type: string, records: Rec[], parentField?: string, parentId?: string): Promise<void> => {
      const prepared = records.map((r) => {
        const { attributes: _a, ...rest } = r;
        const children: [string, Rec[]][] = [];
        const fields: Rec = {};
        for (const [k, v] of Object.entries(rest)) {
          if (v && typeof v === "object" && !Array.isArray(v) && Array.isArray((v as { records?: unknown }).records)) children.push([k, (v as { records: Rec[] }).records]);
          else fields[k] = v;
        }
        if (parentField && parentId) fields[parentField] = parentId;
        return { referenceId: String((r["attributes"] as { referenceId?: string } | undefined)?.referenceId ?? ""), fields, children };
      });
      const saved = await ctx.engine.insert(s, type, prepared.map((p) => p.fields), { allOrNone: true });
      for (const [i, p] of prepared.entries()) {
        const r = saved[i] as SaveResult;
        if (!r.success) {
          hasErrors = true;
          results.push({ referenceId: p.referenceId, errors: r.errors.map((e) => ({ statusCode: e.statusCode, message: e.message, fields: e.fields })) });
          continue;
        }
        results.push({ referenceId: p.referenceId, id: r.id as string });
        for (const [rel, childRecords] of p.children) {
          const child = ctx.engine.schema.childRelationships(type).find((c) => c.relationshipName?.toLowerCase() === rel.toLowerCase());
          if (!child) {
            hasErrors = true;
            results.push({ referenceId: p.referenceId, errors: [{ statusCode: "INVALID_FIELD", message: `Unknown child relationship ${rel}`, fields: [] }] });
            continue;
          }
          await insertLevel(child.childSObject, childRecords, child.field, r.id);
        }
      }
    };

    await insertLevel(req.params.type, body?.records ?? []);
    return reply.code(hasErrors ? 400 : 201).send({ hasErrors, results });
  });
}
