import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { runQuery } from "@orglet/engine";
import { apiError, sendErrors, session, type ApiContext } from "../server.js";

interface Locator {
  q: string;
  all: boolean;
  created: number;
}

const LOCATOR_TTL_MS = 15 * 60 * 1000;
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Salesforce-looking locator `01g<12 chars>-<offset>`; the query lives server-side for 15 minutes. */
function issueLocator(store: Map<string, Locator>, l: Omit<Locator, "created">, offset: number): string {
  const now = Date.now();
  for (const [k, v] of store) if (now - v.created > LOCATOR_TTL_MS) store.delete(k);
  let id = "01g";
  for (let i = 0; i < 12; i++) id += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  store.set(id, { ...l, created: now });
  return `${id}-${offset}`;
}

function lookupLocator(store: Map<string, Locator>, raw: string): { locator: Locator; offset: number } | undefined {
  const m = /^(01g[0-9A-Za-z]{12})-(\d+)$/.exec(raw);
  if (!m) return undefined;
  const locator = store.get(m[1] ?? "");
  if (!locator || Date.now() - locator.created > LOCATOR_TTL_MS) return undefined;
  return { locator, offset: Number(m[2]) };
}

export function registerQueryRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const run = async (req: FastifyRequest, reply: FastifyReply, soql: string, all: boolean, offset: number) => {
    const version = req.apiVersion ?? ctx.defaultVersion;
    const batchHeader = req.headers["sforce-query-options"];
    const batchSize = typeof batchHeader === "string" ? Number(/batchSize=(\d+)/.exec(batchHeader)?.[1] ?? 2000) : 2000;
    const page = await runQuery(ctx.engine, session(req), soql, { includeDeleted: all, apiVersion: version, batchSize: Math.min(Math.max(batchSize, 200), 2000), offset });
    const body: Record<string, unknown> = { totalSize: page.totalSize, done: page.done, records: page.records };
    if (!page.done && page.nextOffset !== undefined) {
      body["nextRecordsUrl"] = `/services/data/v${version}/${all ? "queryAll" : "query"}/${issueLocator(ctx.locators, { q: soql, all }, page.nextOffset)}`;
    }
    return reply.send(body);
  };

  for (const [path, all] of [
    ["query", false],
    ["queryAll", true],
  ] as const) {
    app.get(`/services/data/v:version/${path}`, async (req, reply) => {
      const q = (req.query as { q?: string }).q;
      if (!q) return sendErrors(reply, 400, [apiError("MALFORMED_QUERY", "unexpected token: end of query")]);
      return run(req, reply, q, all, 0);
    });
    app.get<{ Params: { locator: string } }>(`/services/data/v:version/${path}/:locator`, async (req, reply) => {
      const decoded = lookupLocator(ctx.locators, req.params.locator);
      if (!decoded) return sendErrors(reply, 400, [apiError("INVALID_QUERY_LOCATOR", "invalid query locator")]);
      return run(req, reply, decoded.locator.q, decoded.locator.all || all, decoded.offset);
    });
  }
}
