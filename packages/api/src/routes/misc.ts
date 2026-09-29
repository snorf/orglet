import type { FastifyInstance } from "fastify";
import { baseUrl, type ApiContext } from "../server.js";

const VERSIONS = Array.from({ length: 36 }, (_, i) => 30 + i); // 30.0 .. 65.0

function label(major: number): string {
  // Three releases a year since 30.0 = Spring '14.
  const idx = major - 30;
  const season = ["Spring", "Summer", "Winter"][idx % 3] ?? "Spring";
  const year = 14 + Math.floor((idx + (season === "Winter" ? 1 : 0)) / 3) + (season === "Winter" ? 0 : 0);
  return `${season} '${String(year).padStart(2, "0")}`;
}

export function registerMiscRoutes(app: FastifyInstance, ctx: ApiContext): void {
  app.get("/services/data", (_req, reply) =>
    reply.send(VERSIONS.map((v) => ({ label: label(v), url: `/services/data/v${v}.0`, version: `${v}.0` }))),
  );
  app.get("/services/data/", (_req, reply) =>
    reply.send(VERSIONS.map((v) => ({ label: label(v), url: `/services/data/v${v}.0`, version: `${v}.0` }))),
  );

  app.get("/services/data/v:version", (req, reply) => {
    const v = req.apiVersion ?? ctx.defaultVersion;
    const base = `/services/data/v${v}`;
    return reply.send({
      tooling: `${base}/tooling`,
      metadata: `${base}/metadata`,
      eclair: `${base}/eclair`,
      folders: `${base}/folders`,
      prechatForms: `${base}/prechatForms`,
      "chatter": `${base}/chatter`,
      tabs: `${base}/tabs`,
      appMenu: `${base}/appMenu`,
      quickActions: `${base}/quickActions`,
      queryAll: `${base}/queryAll`,
      query: `${base}/query`,
      search: `${base}/search`,
      identity: `${baseUrl(req)}/id/${ctx.organizationId}/${req.login?.session.userId ?? ""}`,
      composite: `${base}/composite`,
      sobjects: `${base}/sobjects`,
      limits: `${base}/limits`,
      recent: `${base}/recent`,
      theme: `${base}/theme`,
      jobs: `${base}/jobs`,
    });
  });

  app.get("/services/data/v:version/limits", (_req, reply) =>
    reply.send({
      DailyApiRequests: { Max: 15000, Remaining: 14999 },
      DailyBulkApiBatches: { Max: 15000, Remaining: 15000 },
      DailyBulkV2QueryJobs: { Max: 10000, Remaining: 10000 },
      DailyStreamingApiEvents: { Max: 10000, Remaining: 10000 },
      DataStorageMB: { Max: 5, Remaining: 5 },
      FileStorageMB: { Max: 20, Remaining: 20 },
      HourlyODataCallout: { Max: 1000, Remaining: 1000 },
      MonthlyPlatformEventsUsageEntitlement: { Max: 0, Remaining: 0 },
      SingleEmail: { Max: 15, Remaining: 15 },
      ConcurrentAsyncGetReportInstances: { Max: 200, Remaining: 200 },
      ConcurrentSyncReportRuns: { Max: 20, Remaining: 20 },
      DailyAsyncApexExecutions: { Max: 250000, Remaining: 250000 },
      DailyDurableStreamingApiEvents: { Max: 10000, Remaining: 10000 },
      DailyWorkflowEmails: { Max: 15, Remaining: 15 },
      MassEmail: { Max: 10, Remaining: 10 },
      PermissionSets: { Max: 1500, Remaining: 1500, CreateCustom: { Max: 1000, Remaining: 1000 } },
    }),
  );

  // SOSL is phase 1; answer the documented empty shape so clients keep working.
  app.get("/services/data/v:version/search", (req, reply) => {
    const q = (req.query as { q?: string }).q ?? "";
    if (!ctx.unsupported.has("sosl")) {
      ctx.unsupported.add("sosl");
      req.log.warn(`UNSUPPORTED:sosl search is not implemented; returning no results for: ${q}`);
    }
    return reply.send({ searchRecords: [] });
  });
}
