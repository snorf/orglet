/**
 * The Salesforce-compatible HTTP surface: login (SOAP and OAuth), REST sobjects, query,
 * describe, composite, limits. Everything under /services/data needs a bearer session and
 * answers JSON with Salesforce's error envelopes.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import formbody from "@fastify/formbody";
import type { DmlEngine, Session } from "@orglet/engine";
import { DmlError } from "@orglet/engine";
import { SoqlError } from "@orglet/soql";
import { SessionStore, bearerToken, type AuthConfig, type LoginResult } from "./auth.js";
import { registerLoginRoutes } from "./routes/login.js";
import { registerSobjectRoutes } from "./routes/sobjects.js";
import { registerQueryRoutes } from "./routes/query.js";
import { registerCompositeRoutes } from "./routes/composite.js";
import { registerMiscRoutes } from "./routes/misc.js";

export interface ApiOptions {
  engine: DmlEngine;
  organizationId: string;
  recordTypeIds: ReadonlyMap<string, string>;
  auth?: AuthConfig;
  /** Default API version for internally generated URLs. */
  defaultVersion?: string;
  logger?: boolean;
}

export interface ApiContext {
  engine: DmlEngine;
  sessions: SessionStore;
  organizationId: string;
  recordTypeIds: ReadonlyMap<string, string>;
  defaultVersion: string;
  /** Warnings for features that were called but are not implemented (logged once each). */
  unsupported: Set<string>;
  /** Live query locators for nextRecordsUrl. */
  locators: Map<string, { q: string; all: boolean; created: number }>;
}

declare module "fastify" {
  interface FastifyRequest {
    login?: LoginResult;
    apiVersion?: string;
  }
}

export interface ApiError {
  message: string;
  errorCode: string;
  fields?: string[];
}

export function apiError(errorCode: string, message: string, fields?: string[]): ApiError {
  const e: ApiError = { message, errorCode };
  if (fields && fields.length > 0) e.fields = fields;
  return e;
}

export function sendErrors(reply: FastifyReply, status: number, errors: ApiError[]): FastifyReply {
  return reply.code(status).type("application/json;charset=UTF-8").send(errors);
}

export const INVALID_SESSION: ApiError = { message: "Session expired or invalid", errorCode: "INVALID_SESSION_ID" };
export const NOT_FOUND: ApiError = { message: "The requested resource does not exist", errorCode: "NOT_FOUND" };

export function session(req: FastifyRequest): Session {
  if (!req.login) throw new DmlError("INVALID_SESSION_ID", "Session expired or invalid", 401);
  return req.login.session;
}

export function baseUrl(req: FastifyRequest): string {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? req.protocol;
  const host = (req.headers["x-forwarded-host"] as string | undefined) ?? req.headers.host ?? "localhost";
  return `${proto}://${host}`;
}

export function createApiServer(options: ApiOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 64 * 1024 * 1024, maxParamLength: 500, ignoreTrailingSlash: true });
  const ctx: ApiContext = {
    engine: options.engine,
    sessions: new SessionStore(options.engine, options.organizationId, options.auth ?? { mode: "permissive" }),
    organizationId: options.organizationId,
    recordTypeIds: options.recordTypeIds,
    defaultVersion: options.defaultVersion ?? "59.0",
    unsupported: new Set(),
    locators: new Map(),
  };

  void app.register(formbody);
  app.addContentTypeParser(["text/xml", "application/xml", "application/soap+xml"], { parseAs: "string" }, (_req, body, done) => done(null, body));
  // Salesforce clients send JSON with and without charset, sometimes with an empty body.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    const text = typeof body === "string" ? body : body.toString("utf8");
    if (text.trim() === "") return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      done(Object.assign(new Error((err as Error).message), { statusCode: 400, errorCode: "JSON_PARSER_ERROR" }), undefined);
    }
  });

  // Authentication for the REST surface.
  app.addHook("onRequest", (req, reply, done) => {
    const url = req.url;
    const protectedPath = /^\/services\/data\/v\d+\.\d+/.test(url) || url.startsWith("/id/");
    if (!protectedPath) return done();
    const token = bearerToken(req.headers.authorization);
    const login = ctx.sessions.resolve(token);
    if (!login) {
      void sendErrors(reply, 401, [INVALID_SESSION]);
      return done();
    }
    req.login = login;
    const m = /^\/services\/data\/v(\d+\.\d+)/.exec(url);
    req.apiVersion = m?.[1] ?? ctx.defaultVersion;
    done();
  });

  app.addHook("onSend", (req, reply, payload, done) => {
    if (req.url.startsWith("/services/data/")) {
      reply.header("Sforce-Limit-Info", "api-usage=1/15000");
      if (!reply.getHeader("content-type")) reply.type("application/json;charset=UTF-8");
    }
    done(null, payload);
  });

  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/services/") || req.url.startsWith("/id/")) return sendErrors(reply, 404, [NOT_FOUND]);
    return reply.code(404).send({ error: "not found" });
  });

  app.setErrorHandler((err: Error & { statusCode?: number; errorCode?: string; validation?: unknown }, req, reply) => {
    if (err instanceof DmlError) return sendErrors(reply, err.httpStatus, [apiError(err.statusCode, err.message, err.fields)]);
    if (err instanceof SoqlError) return sendErrors(reply, 400, [apiError(err.errorCode, err.message)]);
    if (err.errorCode === "JSON_PARSER_ERROR") return sendErrors(reply, 400, [apiError("JSON_PARSER_ERROR", err.message)]);
    if (err.statusCode === 415) return sendErrors(reply, 415, [apiError("UNSUPPORTED_MEDIA_TYPE", "Unsupported media type")]);
    req.log.error(err);
    return sendErrors(reply, 500, [apiError("UNKNOWN_EXCEPTION", err.message)]);
  });

  registerLoginRoutes(app, ctx);
  registerMiscRoutes(app, ctx);
  registerSobjectRoutes(app, ctx);
  registerQueryRoutes(app, ctx);
  registerCompositeRoutes(app, ctx);
  return app;
}
