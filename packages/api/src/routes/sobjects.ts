import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { normalizeDatetime, runQuery, type SaveResult } from "@orglet/engine";
import { normalizeId } from "@orglet/schema";
import { attributes } from "@orglet/soql";
import { asString, type RecordData } from "@orglet/formula";
import { basicInfo, globalDescribe, objectDescribe } from "../describe.js";
import { NOT_FOUND, apiError, sendErrors, session, type ApiContext, type ApiError } from "../server.js";

export function saveErrorsToApi(result: SaveResult): ApiError[] {
  return result.errors.map((e) => apiError(e.statusCode, e.message, e.fields));
}

/** Per-record error status: 404 for missing records, 400 otherwise. */
export function statusFor(result: SaveResult): number {
  const code = result.errors[0]?.statusCode;
  if (code === "NOT_FOUND") return 404;
  if (code === "ENTITY_IS_DELETED") return 404;
  return 400;
}

export function recordJson(type: string, record: RecordData, version: string, fields?: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = { attributes: attributes(type, record["Id"], version) };
  if (fields && fields.length > 0) {
    for (const f of fields) {
      const key = Object.keys(record).find((k) => k.toLowerCase() === f.toLowerCase());
      if (key) out[key] = record[key];
    }
    return out;
  }
  for (const [k, v] of Object.entries(record)) out[k] = v;
  return out;
}

function fieldsParam(req: FastifyRequest): string[] | undefined {
  const raw = (req.query as { fields?: string }).fields;
  return raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
}

export function registerSobjectRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const version = (req: FastifyRequest) => req.apiVersion ?? ctx.defaultVersion;
  const objectOr404 = (name: string, reply: FastifyReply) => {
    const obj = ctx.engine.schema.getObject(name);
    if (!obj) void sendErrors(reply, 404, [NOT_FOUND]);
    return obj;
  };

  app.get("/services/data/v:version/sobjects", (req, reply) => reply.send(globalDescribe(ctx.engine.schema, version(req))));

  app.get<{ Params: { type: string } }>("/services/data/v:version/sobjects/:type", (req, reply) => {
    const obj = objectOr404(req.params.type, reply);
    if (!obj) return;
    return reply.send(basicInfo(obj, version(req)));
  });

  app.get<{ Params: { type: string } }>("/services/data/v:version/sobjects/:type/describe", (req, reply) => {
    const obj = objectOr404(req.params.type, reply);
    if (!obj) return;
    return reply.send(objectDescribe(ctx.engine.schema, obj, version(req), ctx.recordTypeIds));
  });

  app.post<{ Params: { type: string } }>("/services/data/v:version/sobjects/:type", async (req, reply) => {
    const obj = objectOr404(req.params.type, reply);
    if (!obj) return;
    const [result] = await ctx.engine.insert(session(req), obj.name, [(req.body ?? {}) as Record<string, unknown>]);
    if (!result?.success) return sendErrors(reply, statusFor(result as SaveResult), saveErrorsToApi(result as SaveResult));
    return reply.code(201).send({ id: result.id, success: true, errors: [] });
  });

  // ---- updated / deleted since ---------------------------------------------------------

  const window = (req: FastifyRequest, reply: FastifyReply): { start: string; end: string } | undefined => {
    const q = req.query as { start?: string; end?: string };
    const start = q.start ? normalizeDatetime(q.start) : undefined;
    const end = q.end ? normalizeDatetime(q.end) : undefined;
    if (!start || !end) {
      void sendErrors(reply, 400, [apiError("INVALID_QUERY_FILTER_OPERATOR", "The start and end parameters must be ISO 8601 date-times")]);
      return undefined;
    }
    return { start, end };
  };
  const soqlDate = (iso: string) => iso.replace("+0000", "Z");

  app.get<{ Params: { type: string } }>("/services/data/v:version/sobjects/:type/updated", async (req, reply) => {
    const obj = objectOr404(req.params.type, reply);
    if (!obj) return;
    const w = window(req, reply);
    if (!w) return;
    const page = await runQuery(ctx.engine, session(req), `SELECT Id FROM ${obj.name} WHERE LastModifiedDate >= ${soqlDate(w.start)} AND LastModifiedDate <= ${soqlDate(w.end)} ORDER BY LastModifiedDate`, { apiVersion: version(req) });
    return reply.send({ ids: page.records.map((r) => r["Id"]), latestDateCovered: w.end });
  });

  app.get<{ Params: { type: string } }>("/services/data/v:version/sobjects/:type/deleted", async (req, reply) => {
    const obj = objectOr404(req.params.type, reply);
    if (!obj) return;
    const w = window(req, reply);
    if (!w) return;
    const page = await runQuery(ctx.engine, session(req), `SELECT Id, LastModifiedDate FROM ${obj.name} WHERE IsDeleted = true AND LastModifiedDate >= ${soqlDate(w.start)} AND LastModifiedDate <= ${soqlDate(w.end)} ORDER BY LastModifiedDate`, { apiVersion: version(req), includeDeleted: true });
    return reply.send({ deletedRecords: page.records.map((r) => ({ id: r["Id"], deletedDate: r["LastModifiedDate"] })), earliestDateAvailable: w.start, latestDateCovered: w.end });
  });

  // ---- by record id -------------------------------------------------------------------

  app.get<{ Params: { type: string; id: string } }>("/services/data/v:version/sobjects/:type/:id", async (req, reply) => {
    const obj = objectOr404(req.params.type, reply);
    if (!obj) return;
    const id = normalizeId(req.params.id);
    if (!id) return sendErrors(reply, 404, [NOT_FOUND]);
    const record = (await ctx.engine.retrieve(session(req), obj.name, [id])).get(id);
    if (!record) return sendErrors(reply, 404, [NOT_FOUND]);
    return reply.send(recordJson(obj.name, record, version(req), fieldsParam(req)));
  });

  app.patch<{ Params: { type: string; id: string } }>("/services/data/v:version/sobjects/:type/:id", async (req, reply) => {
    const obj = objectOr404(req.params.type, reply);
    if (!obj) return;
    const [result] = await ctx.engine.update(session(req), obj.name, [{ ...((req.body ?? {}) as Record<string, unknown>), Id: req.params.id }]);
    if (!result?.success) return sendErrors(reply, statusFor(result as SaveResult), saveErrorsToApi(result as SaveResult));
    return reply.code(204).send();
  });

  app.delete<{ Params: { type: string; id: string } }>("/services/data/v:version/sobjects/:type/:id", async (req, reply) => {
    const obj = objectOr404(req.params.type, reply);
    if (!obj) return;
    const [result] = await ctx.engine.delete(session(req), obj.name, [req.params.id]);
    if (!result?.success) return sendErrors(reply, statusFor(result as SaveResult), saveErrorsToApi(result as SaveResult));
    return reply.code(204).send();
  });

  // ---- by external id -----------------------------------------------------------------

  const externalField = (obj: { name: string }, field: string, reply: FastifyReply) => {
    const f = ctx.engine.schema.getField(obj.name, field);
    if (!f || !(f.idLookup || f.name === "Id")) {
      void sendErrors(reply, 404, [apiError("NOT_FOUND", `Provided external ID field does not exist or is not accessible: ${field}`)]);
      return undefined;
    }
    return f;
  };

  app.get<{ Params: { type: string; field: string; value: string } }>("/services/data/v:version/sobjects/:type/:field/:value", async (req, reply) => {
    const obj = objectOr404(req.params.type, reply);
    if (!obj) return;
    const field = externalField(obj, req.params.field, reply);
    if (!field) return;
    const client = await ctx.engine.pool.connect();
    let rows: RecordData[];
    try {
      rows = await ctx.engine.store.findByField(client, obj, field, req.params.value);
      await ctx.engine.project(client, session(req), obj, rows);
    } finally {
      client.release();
    }
    if (rows.length === 0) return sendErrors(reply, 404, [NOT_FOUND]);
    if (rows.length > 1) return reply.code(300).send(rows.map((r) => `/services/data/v${version(req)}/sobjects/${obj.name}/${asString(r["Id"])}`));
    return reply.send(recordJson(obj.name, rows[0] as RecordData, version(req), fieldsParam(req)));
  });

  app.patch<{ Params: { type: string; field: string; value: string } }>("/services/data/v:version/sobjects/:type/:field/:value", async (req, reply) => {
    const obj = objectOr404(req.params.type, reply);
    if (!obj) return;
    const field = externalField(obj, req.params.field, reply);
    if (!field) return;
    const body = { ...((req.body ?? {}) as Record<string, unknown>), [field.name]: req.params.value };
    const [result] = await ctx.engine.upsert(session(req), obj.name, field.name, [body]);
    if (!result?.success) {
      const dup = result?.errors[0];
      if (dup?.statusCode === "DUPLICATE_EXTERNAL_ID") {
        return reply.code(300).send((dup.matchingIds ?? []).map((id) => `/services/data/v${version(req)}/sobjects/${obj.name}/${id}`));
      }
      return sendErrors(reply, statusFor(result as SaveResult), saveErrorsToApi(result as SaveResult));
    }
    if (result.created) return reply.code(201).send({ id: result.id, success: true, errors: [], created: true });
    return reply.code(204).send();
  });

  app.delete<{ Params: { type: string; field: string; value: string } }>("/services/data/v:version/sobjects/:type/:field/:value", async (req, reply) => {
    const obj = objectOr404(req.params.type, reply);
    if (!obj) return;
    const field = externalField(obj, req.params.field, reply);
    if (!field) return;
    const client = await ctx.engine.pool.connect();
    let rows: RecordData[];
    try {
      rows = await ctx.engine.store.findByField(client, obj, field, req.params.value);
    } finally {
      client.release();
    }
    if (rows.length === 0) return sendErrors(reply, 404, [NOT_FOUND]);
    const [result] = await ctx.engine.delete(session(req), obj.name, [asString(rows[0]?.["Id"])]);
    if (!result?.success) return sendErrors(reply, statusFor(result as SaveResult), saveErrorsToApi(result as SaveResult));
    return reply.code(204).send();
  });
}
