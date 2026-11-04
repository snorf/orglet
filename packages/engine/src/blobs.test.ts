import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { loadOrgSchema, type OrgSchema } from "@orglet/metadata";
import { generateId, migrate, quote, type Pool } from "@orglet/schema";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { bootstrapOrg } from "./bootstrap.js";
import { DmlEngine } from "./engine.js";
import type { BlobRef, OpenedBlob } from "./blobs.js";
import type { Session } from "./hooks.js";
import { blobKey, InlineBlobStore } from "./blobs.js";
import { Store } from "./store.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
const CS = "d41d8cd98f00b204e9800998ecf8427e";

describe("blobKey (FILE-09, D-13)", () => {
  it("builds the Heimdall files/<cs[0:4]>/<cs>.<ext> key", () => {
    expect(blobKey(CS, "pdf")).toBe(`files/d41d/${CS}.pdf`);
  });
  it("keeps the extension's case as given", () => {
    expect(blobKey(CS, "PDF").endsWith(".PDF")).toBe(true);
  });
  it("an empty extension yields a key without a trailing dot", () => {
    expect(blobKey(CS, "")).toBe(`files/d41d/${CS}`);
  });
  it("rejects uppercase hex", () => {
    expect(() => blobKey(CS.toUpperCase(), "pdf")).toThrow(RangeError);
  });
  it("rejects a checksum that is not exactly 32 characters", () => {
    expect(() => blobKey(CS.slice(1), "pdf")).toThrow(RangeError);
    expect(() => blobKey(CS + "0", "pdf")).toThrow(RangeError);
  });
  it("rejects path traversal and separators in either argument", () => {
    expect(() => blobKey("../../etc/passwd".padEnd(32, "0"), "pdf")).toThrow(RangeError);
    for (const ext of ["../x", "a/b", "a\\b", "/abs"]) expect(() => blobKey(CS, ext)).toThrow(RangeError);
  });
  it("rejects NUL and whitespace", () => {
    expect(() => blobKey(CS, "pd\u0000f")).toThrow(RangeError);
    expect(() => blobKey(CS, "p f")).toThrow(RangeError);
  });
  it("rejects an extension longer than 16 characters", () => {
    expect(() => blobKey(CS, "a".repeat(17))).toThrow(RangeError);
    expect(() => blobKey(CS, "a".repeat(16))).not.toThrow();
  });
  it("InlineBlobStore is the inline kind", async () => {
    const { schema } = await loadOrgSchema({ projectDir: ACME });
    expect(new InlineBlobStore(new Store(schema, "org")).kind).toBe("inline");
  });
});

describe("InlineBlobStore (FILE-09)", () => {
  const orgSchema = `test_${randomBytes(4).toString("hex")}`;
  let testDb: TestDb;
  let pool: Pool;
  let schema: OrgSchema;
  let engine: DmlEngine;
  let session: Session;

  const ref = (id: string, field = "VersionData"): BlobRef => ({ object: "ContentVersion", field, id, checksum: null, extension: null });
  const bytesOf = async (opened: OpenedBlob): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  };
  const newVersion = async (): Promise<string> => {
    const [r] = await engine.insert(session, "ContentVersion", [{ Title: "t", PathOnClient: "t.bin" }]);
    expect(r?.errors).toEqual([]);
    return r?.id as string;
  };

  beforeAll(async () => {
    testDb = await openTestDb();
    pool = testDb.pool;
    schema = (await loadOrgSchema({ projectDir: ACME })).schema;
    await migrate(pool, schema, { orgSchema });
    session = (await bootstrapOrg(pool, schema, { orgSchema })).session;
    engine = new DmlEngine(pool, schema, { orgSchema });
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${quote(orgSchema)} CASCADE`);
    await testDb.close();
  });

  it("put then open returns the exact bytes and their size", async () => {
    const id = await newVersion();
    const data = randomBytes(1024 * 1024);
    await engine.blobs.put(pool, ref(id), data);
    const opened = await engine.blobs.open(pool, ref(id));
    expect(opened?.size).toBe(1_048_576);
    expect((await bytesOf(opened!)).equals(data)).toBe(true);
  });

  it("open answers undefined when no bytes are behind the version", async () => {
    expect(await engine.blobs.open(pool, ref(await newVersion()))).toBeUndefined();
  });

  it("put refuses a version row that does not exist", async () => {
    const id = generateId("068");
    await expect(engine.blobs.put(pool, ref(id), Buffer.from("x"))).rejects.toThrow(id);
  });

  it("put joins the caller's transaction", async () => {
    const id = await newVersion();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await engine.blobs.put(client, ref(id), Buffer.from("rolled back"));
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
    expect(await engine.blobs.open(pool, ref(id))).toBeUndefined();
  });

  it("open refuses a field that is not a Base64 field", async () => {
    await expect(engine.blobs.open(pool, ref(await newVersion(), "Title"))).rejects.toThrow();
  });
});
