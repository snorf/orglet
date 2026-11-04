import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { loadOrgSchema, type OrgSchema } from "@orglet/metadata";
import { generateId, migrate, quote, type Pool } from "@orglet/schema";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { bootstrapOrg } from "./bootstrap.js";
import { DmlEngine } from "./engine.js";
import type { ChangeEvent } from "./events.js";
import type { Session, TriggerContext } from "./hooks.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
const orgSchema = `test_${randomBytes(4).toString("hex")}`;
const importSchema = `test_${randomBytes(4).toString("hex")}`;

let testDb: TestDb;
let pool: Pool;
let schema: OrgSchema;
let engine: DmlEngine;
let session: Session;
const seenKeys: string[][] = [];
const events: ChangeEvent[] = [];

const base64 = (s: string) => Buffer.from(s).toString("base64");

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  schema = (await loadOrgSchema({ projectDir: ACME })).schema;
  await migrate(pool, schema, { orgSchema });
  session = (await bootstrapOrg(pool, schema, { orgSchema })).session;
  engine = new DmlEngine(pool, schema, {
    orgSchema,
    executors: [
      {
        run: (ctx: TriggerContext) => {
          if (ctx.sobject.name === "ContentVersion") seenKeys.push(...ctx.records.map((r) => Object.keys(r)));
          return Promise.resolve();
        },
      },
    ],
  });
  engine.bus.subscribe((e) => {
    events.push(...e);
  });
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${quote(orgSchema)} CASCADE`);
  await pool.query(`DROP SCHEMA IF EXISTS ${quote(importSchema)} CASCADE`);
  await testDb.close();
});

async function one(sobject: string, input: Record<string, unknown>, eng = engine, sess = session): Promise<string> {
  const [r] = await eng.insert(sess, sobject, [input]);
  expect(r?.errors, JSON.stringify(r?.errors)).toEqual([]);
  return r?.id as string;
}
const get = async (sobject: string, id: string, eng = engine, sess = session) => (await eng.retrieve(sess, sobject, [id])).get(id)!;
const count = async (table: string, where = "true", schemaName = orgSchema) =>
  Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${quote(schemaName)}.${quote(table)} WHERE ${where}`)).rows[0]?.n);

describe("ContentVersion insert (FILE-03..05)", () => {
  const bytes = "%PDF-1.4 hello";
  let docId: string;
  let v1: string;

  it("a version without ContentDocumentId creates its document", async () => {
    v1 = await one("ContentVersion", { Title: "Spec", PathOnClient: "spec.pdf", VersionData: base64(bytes) });
    const cv = await get("ContentVersion", v1);
    docId = cv["ContentDocumentId"] as string;
    expect(docId.startsWith("069")).toBe(true);
    expect(cv).toMatchObject({ IsLatest: true, VersionNumber: "1", Checksum: createHash("md5").update(bytes).digest("hex"), ContentSize: bytes.length, ContentSizeLong: bytes.length, FileExtension: "pdf", FileType: "PDF" });
    const doc = await get("ContentDocument", docId);
    expect(doc).toMatchObject({ Title: "Spec", FileType: "PDF", FileExtension: "pdf", ContentSize: bytes.length, LatestPublishedVersionId: v1, OwnerId: session.userId });
  });

  it("contentversion.contentdocumentid is never null for a live insert", async () => {
    expect(await count("contentversion", `"contentdocumentid" IS NULL`)).toBe(0);
  });

  it("a second version adds a version and flips IsLatest", async () => {
    const v2 = await one("ContentVersion", { Title: "Spec v2", PathOnClient: "spec.docx", VersionData: base64("second version"), ContentDocumentId: docId });
    expect((await get("ContentVersion", v1))["IsLatest"]).toBe(false);
    expect(await get("ContentVersion", v2)).toMatchObject({ IsLatest: true, VersionNumber: "2" });
    expect(await get("ContentDocument", docId)).toMatchObject({ LatestPublishedVersionId: v2, Title: "Spec v2", FileType: "WORD_X", FileExtension: "docx", ContentSize: "second version".length });
  });

  it("two versions of one document in one batch get consecutive numbers", async () => {
    const res = await engine.insert(session, "ContentVersion", [
      { Title: "a", PathOnClient: "a.txt", VersionData: base64("a"), ContentDocumentId: docId },
      { Title: "b", PathOnClient: "b.txt", VersionData: base64("b"), ContentDocumentId: docId },
    ]);
    expect(res.map((r) => r.errors)).toEqual([[], []]);
    const [a, b] = await Promise.all(res.map((r) => get("ContentVersion", r.id as string)));
    expect([a?.["VersionNumber"], b?.["VersionNumber"]]).toEqual(["3", "4"]);
    expect([a?.["IsLatest"], b?.["IsLatest"]]).toEqual([false, true]);
  });

  it("VersionData without PathOnClient is REQUIRED_FIELD_MISSING", async () => {
    const before = await count("contentdocument");
    const [r] = await engine.insert(session, "ContentVersion", [{ Title: "x", VersionData: base64("x") }]);
    expect(r?.errors).toMatchObject([{ statusCode: "REQUIRED_FIELD_MISSING", fields: ["PathOnClient"] }]);
    expect(await count("contentdocument")).toBe(before);
  });

  it("a version without Title is REQUIRED_FIELD_MISSING", async () => {
    const [r] = await engine.insert(session, "ContentVersion", [{ PathOnClient: "x.txt", VersionData: base64("x") }]);
    expect(r?.errors[0]).toMatchObject({ statusCode: "REQUIRED_FIELD_MISSING" });
    expect(r?.errors[0]?.fields).toContain("Title");
  });

  it("system-computed fields from the client are refused", async () => {
    for (const f of ["Checksum", "IsLatest", "VersionNumber", "FileType"]) {
      const [r] = await engine.insert(session, "ContentVersion", [{ Title: "x", PathOnClient: "x.txt", [f]: "x" }]);
      expect(r?.errors[0]?.statusCode, f).toBe("INVALID_FIELD_FOR_INSERT_UPDATE");
    }
  });

  it("an unknown extension is FileType UNKNOWN", async () => {
    const id = await one("ContentVersion", { Title: "d", PathOnClient: "data.json", VersionData: base64("{}") });
    expect(await get("ContentVersion", id)).toMatchObject({ FileType: "UNKNOWN", FileExtension: "json" });
  });

  it("a version without VersionData has no bytes and no checksum", async () => {
    const id = await one("ContentVersion", { Title: "Link", PathOnClient: "x.txt" });
    const cv = await get("ContentVersion", id);
    expect(cv["Checksum"]).toBeNull();
    expect(cv["ContentSize"]).toBeNull();
    expect(cv["ContentDocumentId"]).toBeTruthy();
    expect(await engine.blobs.open(pool, { object: "ContentVersion", field: "VersionData", id, checksum: null, extension: null })).toBeUndefined();
  });

  it("a ContentDocumentId that does not exist is INVALID_CROSS_REFERENCE_KEY", async () => {
    const [r] = await engine.insert(session, "ContentVersion", [{ Title: "x", PathOnClient: "x.txt", ContentDocumentId: generateId("069") }]);
    expect(r?.errors[0]?.statusCode).toBe("INVALID_CROSS_REFERENCE_KEY");
  });

  it("FirstPublishLocationId creates exactly one link", async () => {
    const acct = await one("Account", { Name: "Linked" });
    const v = await one("ContentVersion", { Title: "Pub", PathOnClient: "p.txt", VersionData: base64("p"), FirstPublishLocationId: acct });
    const doc = (await get("ContentVersion", v))["ContentDocumentId"] as string;
    const links = await pool.query(`SELECT * FROM ${quote(orgSchema)}."contentdocumentlink" WHERE "contentdocumentid" = $1 AND "isdeleted" = false`, [doc]);
    expect(links.rows).toHaveLength(1);
    expect(links.rows[0]).toMatchObject({ linkedentityid: acct, sharetype: "V", visibility: "AllUsers" });
    await one("ContentVersion", { Title: "Pub2", PathOnClient: "p.txt", ContentDocumentId: doc, FirstPublishLocationId: acct });
    expect(await count("contentdocumentlink", `"contentdocumentid" = '${doc}'`)).toBe(1);
  });

  it("the base64 string never reaches hooks or change events", async () => {
    seenKeys.length = 0;
    events.length = 0;
    await one("ContentVersion", { Title: "Hooked", PathOnClient: "h.txt", VersionData: base64("hooked") });
    expect(seenKeys.length).toBeGreaterThan(0);
    for (const keys of seenKeys) expect(keys).not.toContain("VersionData");
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain("VersionData");
    expect(JSON.stringify(events)).not.toContain(base64("hooked"));
  });
});

describe("ContentVersion insert in import mode", () => {
  let imp: DmlEngine;
  let impSession: Session;

  beforeAll(async () => {
    await migrate(pool, schema, { orgSchema: importSchema });
    impSession = (await bootstrapOrg(pool, schema, { orgSchema: importSchema })).session;
    imp = new DmlEngine(pool, schema, { orgSchema: importSchema, importMode: true });
  });

  it("import mode cannot store a version without ContentDocumentId: the NOT NULL column refuses it", async () => {
    const before = await count("contentdocument", "true", importSchema);
    const [r] = await imp.insert(impSession, "ContentVersion", [{ Title: "Old", PathOnClient: "old.pdf" }]);
    // Outcome today: success false with REQUIRED_FIELD_MISSING [ContentDocumentId] from checkRequired (the archive-org policy is Phase 17's, D-03).
    expect(r?.errors).toMatchObject([{ statusCode: "REQUIRED_FIELD_MISSING", fields: ["ContentDocumentId"] }]);
    expect(await count("contentdocument", "true", importSchema)).toBe(before);
    expect(await count("contentversion", "true", importSchema)).toBe(0);
  });

  it("import mode creates no document and derives nothing", async () => {
    const docId = await one("ContentDocument", { Title: "Imported" }, imp, impSession);
    const other = await one("ContentVersion", { Title: "Prev", PathOnClient: "p.pdf", ContentDocumentId: docId, IsLatest: true, VersionNumber: "1" }, imp, impSession);
    const checksum = "0123456789abcdef0123456789abcdef";
    const id = await one(
      "ContentVersion",
      { Title: "Old", PathOnClient: "old.pdf", ContentDocumentId: docId, IsLatest: true, VersionNumber: "7", Checksum: checksum, VersionData: base64("abc") },
      imp,
      impSession,
    );
    expect(await get("ContentVersion", id, imp, impSession)).toMatchObject({ VersionNumber: "7", Checksum: checksum, IsLatest: true });
    expect((await get("ContentVersion", other, imp, impSession))["IsLatest"]).toBe(true);
    expect((await get("ContentDocument", docId, imp, impSession))["LatestPublishedVersionId"] ?? null).toBeNull();
    expect(await count("contentdocument", "true", importSchema)).toBe(1);
    const opened = await imp.blobs.open(pool, { object: "ContentVersion", field: "VersionData", id, checksum, extension: "pdf" });
    const chunks: Buffer[] = [];
    for await (const c of opened!.stream) chunks.push(c as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe("abc");
  });
});

describe("delete and undelete (FILE-08)", () => {
  let account: string;
  let kase: string;
  let doc: string;
  let cv1: string;
  let cv2: string;
  let linkAccount: string;
  let linkCase: string;

  const flags = async (table: string, id: string) => (await pool.query<{ isdeleted: boolean }>(`SELECT isdeleted FROM ${quote(orgSchema)}.${quote(table)} WHERE id = $1`, [id])).rows[0]?.isdeleted;

  beforeAll(async () => {
    account = await one("Account", { Name: "Files cascade" });
    kase = await one("Case", { Subject: "Files cascade" });
    cv1 = await one("ContentVersion", { Title: "V1", PathOnClient: "v1.txt", VersionData: base64("one"), FirstPublishLocationId: account });
    doc = (await get("ContentVersion", cv1))["ContentDocumentId"] as string;
    cv2 = await one("ContentVersion", { Title: "V2", PathOnClient: "v2.txt", VersionData: base64("two"), ContentDocumentId: doc });
    linkAccount = (await pool.query<{ id: string }>(`SELECT id FROM ${quote(orgSchema)}.contentdocumentlink WHERE contentdocumentid = $1 AND linkedentityid = $2`, [doc, account])).rows[0]!.id;
    linkCase = await one("ContentDocumentLink", { ContentDocumentId: doc, LinkedEntityId: kase, ShareType: "V" });
  });

  it("deleting a ContentDocument soft-deletes its versions and links", async () => {
    const [r] = await engine.delete(session, "ContentDocument", [doc]);
    expect(r?.errors).toEqual([]);
    expect(await flags("contentdocument", doc)).toBe(true);
    for (const id of [cv1, cv2]) expect(await flags("contentversion", id)).toBe(true);
    for (const id of [linkAccount, linkCase]) expect(await flags("contentdocumentlink", id)).toBe(true);
  });

  it("the cascade does not null the document's LatestPublishedVersionId", async () => {
    const res = await pool.query<{ latestpublishedversionid: string }>(`SELECT latestpublishedversionid FROM ${quote(orgSchema)}.contentdocument WHERE id = $1`, [doc]);
    expect(res.rows[0]?.latestpublishedversionid).toBe(cv2);
  });

  it("undeleting the ContentDocument restores versions and links together", async () => {
    const [r] = await engine.undelete(session, "ContentDocument", [doc]);
    expect(r?.errors).toEqual([]);
    expect(await flags("contentdocument", doc)).toBe(false);
    for (const id of [cv1, cv2]) expect(await flags("contentversion", id)).toBe(false);
    for (const id of [linkAccount, linkCase]) expect(await flags("contentdocumentlink", id)).toBe(false);
    expect((await get("ContentDocument", doc))["LatestPublishedVersionId"]).toBe(cv2);
    expect((await get("ContentVersion", cv1))["IsLatest"]).toBe(false);
    expect((await get("ContentVersion", cv2))["IsLatest"]).toBe(true);
  });

  it("deleting a linked Account soft-deletes its links and undelete restores them", async () => {
    const [d] = await engine.delete(session, "Account", [account]);
    expect(d?.errors).toEqual([]);
    expect(await flags("contentdocumentlink", linkAccount)).toBe(true);
    expect(await flags("contentdocumentlink", linkCase)).toBe(false);
    expect(await flags("contentdocument", doc)).toBe(false);
    expect(await flags("contentversion", cv2)).toBe(false);
    const [u] = await engine.undelete(session, "Account", [account]);
    expect(u?.errors).toEqual([]);
    expect(await flags("contentdocumentlink", linkAccount)).toBe(false);
  });

  it("a ContentVersion cannot be deleted directly", async () => {
    const [r] = await engine.delete(session, "ContentVersion", [cv1]);
    expect(r?.errors[0]?.statusCode).toBe("INVALID_TYPE_FOR_OPERATION");
  });

  it("a ContentDocumentLink cannot be undeleted directly", async () => {
    const [d] = await engine.delete(session, "ContentDocumentLink", [linkCase]);
    expect(d?.errors).toEqual([]);
    const [r] = await engine.undelete(session, "ContentDocumentLink", [linkCase]);
    expect(r?.errors[0]?.statusCode).toBe("INVALID_TYPE_FOR_OPERATION");
  });
});

describe("mirror on update (D-11)", () => {
  let doc: string;
  let cv1: string;
  let cv2: string;

  beforeAll(async () => {
    cv1 = await one("ContentVersion", { Title: "M1", PathOnClient: "m1.txt", VersionData: base64("a") });
    doc = (await get("ContentVersion", cv1))["ContentDocumentId"] as string;
    cv2 = await one("ContentVersion", { Title: "M2", PathOnClient: "m2.txt", VersionData: base64("b"), ContentDocumentId: doc });
  });

  it("updating the latest version's Title mirrors it to the document", async () => {
    const [r] = await engine.update(session, "ContentVersion", [{ Id: cv2, Title: "Renamed" }]);
    expect(r?.errors).toEqual([]);
    expect((await get("ContentDocument", doc))["Title"]).toBe("Renamed");
  });

  it("updating an older version's Title leaves the document alone", async () => {
    const [r] = await engine.update(session, "ContentVersion", [{ Id: cv1, Title: "Old name" }]);
    expect(r?.errors).toEqual([]);
    expect((await get("ContentDocument", doc))["Title"]).toBe("Renamed");
  });

  it("a direct ContentDocument Title update changes only the document", async () => {
    const [r] = await engine.update(session, "ContentDocument", [{ Id: doc, Title: "Doc only" }]);
    expect(r?.errors).toEqual([]);
    expect((await get("ContentDocument", doc))["Title"]).toBe("Doc only");
    expect((await get("ContentVersion", cv2))["Title"]).toBe("Renamed");
  });

  it("VersionData cannot be updated", async () => {
    const [r] = await engine.update(session, "ContentVersion", [{ Id: cv2, VersionData: base64("x") }]);
    expect(r?.errors[0]?.statusCode).toBe("INVALID_FIELD_FOR_INSERT_UPDATE");
  });
});

describe("ContentDocumentLink DML (FILE-07, D-14)", () => {
  let doc: string;
  let account: string;

  beforeAll(async () => {
    const cv = await one("ContentVersion", { Title: "L", PathOnClient: "l.txt", VersionData: base64("l") });
    doc = (await get("ContentVersion", cv))["ContentDocumentId"] as string;
    account = await one("Account", { Name: "Link target" });
  });

  const link = (extra: Record<string, unknown>) => engine.insert(session, "ContentDocumentLink", [{ ContentDocumentId: doc, ...extra }]).then((r) => r[0]!);

  it("a link attaches a file to an Account, a Case and a custom object", async () => {
    const kase = await one("Case", { Subject: "Link target" });
    const project = await one("Project__c", { Name: "Link target", Account__c: account });
    for (const id of [account, kase, project]) {
      const r = await link({ LinkedEntityId: id, ShareType: "V" });
      expect(r.errors, JSON.stringify(r.errors)).toEqual([]);
    }
  });

  it("a link to a missing record or an unowned key prefix is INVALID_CROSS_REFERENCE_KEY", async () => {
    expect((await link({ LinkedEntityId: generateId("001"), ShareType: "V" })).errors[0]?.statusCode).toBe("INVALID_CROSS_REFERENCE_KEY");
    expect((await link({ LinkedEntityId: generateId("0Q0"), ShareType: "V" })).errors[0]?.statusCode).toBe("INVALID_CROSS_REFERENCE_KEY");
  });

  it("ShareType is required", async () => {
    expect((await link({ LinkedEntityId: account })).errors).toMatchObject([{ statusCode: "REQUIRED_FIELD_MISSING", fields: ["ShareType"] }]);
  });

  it("ShareType and Visibility are restricted picklists", async () => {
    expect((await link({ LinkedEntityId: account, ShareType: "X" })).errors[0]?.statusCode).toBe("INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST");
    expect((await link({ LinkedEntityId: account, ShareType: "V", Visibility: "Everyone" })).errors[0]?.statusCode).toBe("INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST");
  });

  it("ShareType and Visibility can be updated, ContentDocumentId and LinkedEntityId are create-only, a link can be deleted", async () => {
    const other = await one("Account", { Name: "Other target" });
    const id = (await link({ LinkedEntityId: other, ShareType: "V" })).id as string;
    const [ok] = await engine.update(session, "ContentDocumentLink", [{ Id: id, ShareType: "C", Visibility: "InternalUsers" }]);
    expect(ok?.errors).toEqual([]);
    const [moved] = await engine.update(session, "ContentDocumentLink", [{ Id: id, LinkedEntityId: account }]);
    expect(moved?.errors[0]?.statusCode).toBe("INVALID_FIELD_FOR_INSERT_UPDATE");
    const [redoc] = await engine.update(session, "ContentDocumentLink", [{ Id: id, ContentDocumentId: generateId("069") }]);
    expect(redoc?.errors[0]?.statusCode).toBe("INVALID_FIELD_FOR_INSERT_UPDATE");
    const [del] = await engine.delete(session, "ContentDocumentLink", [id]);
    expect(del?.errors).toEqual([]);
  });
});
