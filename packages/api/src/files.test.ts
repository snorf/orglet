/**
 * The REST contract of files (FILE-05, FILE-06, FILE-09): ContentVersion upload as base64 JSON, URLs instead of bytes in every
 * record path, the VersionData download, and the refusals for multipart and oversized bodies.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { loadOrgSchema } from "@orglet/metadata";
import { dropKeyPrefixes, migrate, quote, reconcileKeyPrefixes, type Pool } from "@orglet/schema";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { bootstrapOrg, DmlEngine } from "@orglet/engine";
import { createApiServer } from "./server.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
const orgSchema = `test_${randomBytes(4).toString("hex")}`;
const V = "/services/data/v59.0";

let testDb: TestDb;
let pool: Pool;
let app: FastifyInstance;
let token = "";
const logLines: string[] = [];

type Json = Record<string, unknown>;
const json = (res: { body: string }) => JSON.parse(res.body) as Json;
const arr = (res: { body: string }) => JSON.parse(res.body) as Json[];
const auth = () => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const get = (url: string) => app.inject({ method: "GET", url, headers: auth() });
const post = (url: string, body: unknown) => app.inject({ method: "POST", url, headers: auth(), payload: JSON.stringify(body) });
const md5 = (b: Buffer | string) => createHash("md5").update(b).digest("hex");

async function upload(path: string, bytes: Buffer | null, extra: Json = {}): Promise<string> {
  const body: Json = { Title: path, PathOnClient: path, ...extra };
  if (bytes) body["VersionData"] = bytes.toString("base64");
  const res = await post(`${V}/sobjects/ContentVersion`, body);
  expect(res.statusCode, res.body).toBe(201);
  return json(res)["id"] as string;
}

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  const schema = (await loadOrgSchema({ projectDir: ACME })).schema;
  await reconcileKeyPrefixes(pool, schema, { orgSchema, mapping: { Project__c: "a0Z" } });
  await migrate(pool, schema, { orgSchema });
  const boot = await bootstrapOrg(pool, schema, { orgSchema });
  const engine = new DmlEngine(pool, schema, { orgSchema });
  app = createApiServer({
    engine,
    organizationId: boot.session.organizationId,
    recordTypeIds: boot.recordTypeIds,
    auth: { mode: "list", users: [{ username: "admin@orglet.local", password: "secret" }] },
    logger: { level: "warn", stream: { write: (l: string) => void logLines.push(l) } },
  });
  await app.ready();
  const login = await app.inject({
    method: "POST",
    url: "/services/oauth2/token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: "grant_type=password&username=admin%40orglet.local&password=secret",
  });
  token = json(login)["access_token"] as string;
});

afterAll(async () => {
  await app.close();
  await dropKeyPrefixes(pool, orgSchema);
  await pool.query(`DROP SCHEMA IF EXISTS ${quote(orgSchema)} CASCADE`);
  await testDb.close();
});

describe("ContentVersion upload and URLs", () => {
  it("a base64 VersionData insert returns 201 and the server-computed fields", async () => {
    const id = await upload("hello.txt", Buffer.from("hello world"));
    const rec = json(await get(`${V}/sobjects/ContentVersion/${id}`));
    expect(rec["Checksum"]).toBe(md5("hello world"));
    expect(rec["ContentSize"]).toBe(11);
    expect(rec["FileExtension"]).toBe("txt");
    expect(rec["FileType"]).toBe("TEXT");
  });

  it("record GET carries the VersionData URL, never bytes", async () => {
    const b64 = Buffer.from("secret bytes here").toString("base64");
    const id = await upload("a.txt", Buffer.from("secret bytes here"));
    const res = await get(`${V}/sobjects/ContentVersion/${id}`);
    expect(json(res)["VersionData"]).toBe(`${V}/sobjects/ContentVersion/${id}/VersionData`);
    expect(res.body).not.toContain(b64);
  });

  it("?fields=VersionData returns only the URL", async () => {
    const id = await upload("b.txt", Buffer.from("x"));
    const rec = json(await get(`${V}/sobjects/ContentVersion/${id}?fields=VersionData,Title`));
    expect(Object.keys(rec).sort()).toEqual(["Title", "VersionData", "attributes"]);
    expect(rec["VersionData"]).toBe(`${V}/sobjects/ContentVersion/${id}/VersionData`);
  });

  it("composite collection GET carries the URL", async () => {
    const id = await upload("c.txt", Buffer.from("x"));
    const res = await post(`${V}/composite/sobjects/ContentVersion`, { ids: [id], fields: ["VersionData"] });
    expect(arr(res)[0]?.["VersionData"]).toBe(`${V}/sobjects/ContentVersion/${id}/VersionData`);
  });

  it("SOQL carries the URL", async () => {
    const id = await upload("d.txt", Buffer.from("x"));
    const res = await get(`${V}/query?q=${encodeURIComponent(`SELECT Id, VersionData FROM ContentVersion WHERE Id = '${id}'`)}`);
    expect((json(res)["records"] as Json[])[0]?.["VersionData"]).toBe(`${V}/sobjects/ContentVersion/${id}/VersionData`);
  });

  it("describe lists VersionData as base64 and ContentDocumentId as required", async () => {
    const d = json(await get(`${V}/sobjects/ContentVersion/describe`));
    const fields = d["fields"] as Json[];
    expect(fields.find((f) => f["name"] === "VersionData")?.["type"]).toBe("base64");
    expect(fields.find((f) => f["name"] === "ContentDocumentId")?.["nillable"]).toBe(false);
  });

  it("a multipart body is refused as UNSUPPORTED:content-multipart", async () => {
    const res = await app.inject({
      method: "POST",
      url: `${V}/sobjects/ContentVersion`,
      headers: { authorization: `Bearer ${token}`, "content-type": "multipart/form-data; boundary=x" },
      payload: "--x\r\nContent-Disposition: form-data; name=\"entity_content\"\r\n\r\n{}\r\n--x--\r\n",
    });
    expect(res.statusCode).toBe(415);
    const [e] = arr(res);
    expect(e?.["errorCode"]).toBe("UNSUPPORTED");
    expect(e?.["message"]).toMatch(/^UNSUPPORTED:content-multipart /);
  });

  it("VersionData over the base64 cap answers 413", async () => {
    const res = await post(`${V}/sobjects/ContentVersion`, { Title: "big", PathOnClient: "big.bin", VersionData: "A".repeat(52_428_804) });
    expect(res.statusCode).toBe(413);
    const [e] = arr(res);
    expect(e?.["errorCode"]).toBe("MAXIMUM_SIZE_OF_DOCUMENT");
    expect(e?.["message"]).toMatch(/^UNSUPPORTED:content-size /);
  });

  it("a body over the 64 MiB limit answers 413, not 500", async () => {
    const res = await app.inject({ method: "POST", url: `${V}/sobjects/ContentVersion`, headers: auth(), payload: "x".repeat(64 * 1024 * 1024 + 1) });
    expect(res.statusCode).toBe(413);
    const [e] = arr(res);
    expect(e?.["errorCode"]).toBe("MAXIMUM_SIZE_OF_DOCUMENT");
    expect(e?.["message"]).toMatch(/^UNSUPPORTED:content-size /);
  });

  it("invalid base64 is INVALID_TYPE_ON_FIELD_IN_RECORD", async () => {
    const res = await post(`${V}/sobjects/ContentVersion`, { Title: "bad", PathOnClient: "bad.txt", VersionData: "not base64!" });
    expect(res.statusCode).toBe(400);
    expect(arr(res)[0]?.["errorCode"]).toBe("INVALID_TYPE_ON_FIELD_IN_RECORD");
  });
});

describe("VersionData download", () => {
  const dl = (id: string) => get(`${V}/sobjects/ContentVersion/${id}/VersionData`);
  const linesFor = (area: string, id: string) => logLines.filter((l) => l.includes(`${area} ContentVersion ${id}`));

  it("the download streams the exact bytes with the D-06 headers", async () => {
    const bytes = randomBytes(300 * 1024);
    const id = await upload("report.pdf", bytes);
    const res = await dl(id);
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.equals(bytes)).toBe(true);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-length"]).toBe("307200");
    expect(res.headers["content-disposition"]).toBe(`attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["accept-ranges"]).toBe("none");
  });

  it("an unknown extension downloads as application/octet-stream", async () => {
    const res = await dl(await upload("data.json", Buffer.from("{}")));
    expect(res.headers["content-type"]).toBe("application/octet-stream");
  });

  it("an svg is never served inline", async () => {
    const res = await dl(await upload("x.svg", Buffer.from("<svg/>")));
    expect(res.headers["content-type"]).toBe("image/svg+xml");
    expect(String(res.headers["content-disposition"])).toMatch(/^attachment/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("filenames are sanitised in Content-Disposition", async () => {
    const id = await upload('C:\\tmp\\we"ird\r\nname.txt', Buffer.from("x"));
    const cd = String((await dl(id)).headers["content-disposition"]);
    expect(cd).not.toMatch(/[\r\n]/);
    const quoted = /filename="([^"]*)"/.exec(cd)?.[1] ?? "";
    expect(quoted).not.toContain('"');
    expect(cd).toContain("filename*=UTF-8''we%22ird%0D%0Aname.txt");
  });

  it("the external-id route still answers for other paths", async () => {
    const res = await get(`${V}/sobjects/Account/VersionData/x`);
    expect(res.statusCode).toBe(404);
    expect(arr(res)[0]?.["message"]).toMatch(/external ID field/);
  });

  it("missing blob answers 404 with a diagnostic, never empty bytes", async () => {
    const id = await upload("nobytes.txt", null);
    for (let i = 0; i < 2; i++) {
      const res = await dl(id);
      expect(res.statusCode).toBe(404);
      const [e] = arr(res);
      expect(e?.["errorCode"]).toBe("NOT_FOUND");
      expect(e?.["message"]).toContain(id);
      expect(e?.["message"]).toContain("VersionData");
    }
    expect(linesFor("blob-missing", id)).toHaveLength(1);
  });

  it("checksum mismatch is served and reported once per version", async () => {
    const id = await upload("tampered.txt", Buffer.from("plain content"));
    const zero = "0".repeat(32);
    await pool.query(`UPDATE ${quote(orgSchema)}.contentversion SET checksum = $1 WHERE id = $2`, [zero, id]);
    for (let i = 0; i < 2; i++) {
      const res = await dl(id);
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe("plain content");
    }
    const lines = linesFor("blob-checksum", id);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(zero);
    expect(lines[0]).toContain(md5("plain content"));
    expect(logLines.some((l) => l.includes("plain content"))).toBe(false);
  });

  it("a deleted or unknown version answers 404", async () => {
    expect((await dl("068000000000000AAA")).statusCode).toBe(404);
    const acc = json(await post(`${V}/sobjects/Account`, { Name: "Blobless" }))["id"] as string;
    const res = await get(`${V}/sobjects/Account/${acc}/VersionData`);
    expect(res.statusCode).toBe(404);
    expect(arr(res)[0]?.["errorCode"]).toBe("NOT_FOUND");
  });
});
