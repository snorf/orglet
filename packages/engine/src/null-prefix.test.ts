/**
 * Proves an object without a confirmed key prefix is first-class in the write path (D-08..D-10):
 * creates are refused and never mint an Id, import mode accepts supplied Ids, single-target
 * lookups resolve to it and polymorphic lookups never do. Uses the test-only null-prefix fixture.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { buildOrgSchema, loadBaseline, type OrgSchema } from "@orglet/metadata";
import { migrate, quote, toCaseSafeId, type Pool } from "@orglet/schema";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { bootstrapOrg } from "./bootstrap.js";
import { DmlEngine } from "./engine.js";
import type { Session } from "./hooks.js";
import { loadParents } from "./parents.js";

const NULL_PREFIX = fileURLToPath(new URL("../../metadata/test/fixtures/null-prefix/", import.meta.url));
const orgSchema = `test_${randomBytes(4).toString("hex")}`;

let testDb: TestDb;
let pool: Pool;
let schema: OrgSchema;
let engine: DmlEngine;
let importer: DmlEngine;
let session: Session;
const thingId = toCaseSafeId("9Zz000000000001");

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  const real = await loadBaseline();
  const extra = await loadBaseline(NULL_PREFIX);
  schema = buildOrgSchema({ ...real, objects: [...real.objects, ...extra.objects] }).schema;
  await migrate(pool, schema, { orgSchema });
  session = (await bootstrapOrg(pool, schema, { orgSchema })).session;
  engine = new DmlEngine(pool, schema, { orgSchema });
  importer = new DmlEngine(pool, schema, { orgSchema, importMode: true });
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${quote(orgSchema)} CASCADE`);
  await testDb.close();
});

const codes = (r: { errors: { statusCode: string }[] } | undefined) => (r?.errors ?? []).map((e) => e.statusCode);

describe("an object without a key prefix", () => {
  it("rejects a create with INVALID_TYPE_FOR_OPERATION and never mints an Id", async () => {
    const [r] = await engine.insert(session, "PrefixlessThing", [{ Name: "x" }]);
    expect(r).toMatchObject({ success: false });
    expect(codes(r)).toEqual(["INVALID_TYPE_FOR_OPERATION"]);
    expect(r?.id).toBeUndefined();
  });

  it("import mode stores a supplied well-formed Id and can update it", async () => {
    const [ins] = await importer.insert(session, "PrefixlessThing", [{ Id: thingId, Name: "Imported" }]);
    expect(ins, JSON.stringify(ins?.errors)).toMatchObject({ success: true, id: thingId });
    const [upd] = await importer.update(session, "PrefixlessThing", [{ Id: thingId, Name: "Renamed" }]);
    expect(upd, JSON.stringify(upd?.errors)).toMatchObject({ success: true });
    expect((await engine.retrieve(session, "PrefixlessThing", [thingId])).get(thingId)).toMatchObject({ Name: "Renamed" });
  });

  it("import mode without an Id cannot create a row", async () => {
    const [r] = await importer.insert(session, "PrefixlessThing", [{ Name: "No Id" }]);
    expect(r).toMatchObject({ success: false, errors: [{ statusCode: "REQUIRED_FIELD_MISSING", fields: ["Id"] }] });
  });

  it("is accepted by a single-target lookup when the Id exists and rejected when it does not", async () => {
    const [ok] = await engine.insert(session, "PrefixlessLink", [{ Name: "ok", ThingId: thingId }]);
    expect(ok, JSON.stringify(ok?.errors)).toMatchObject({ success: true });
    const [bad] = await engine.insert(session, "PrefixlessLink", [{ Name: "bad", ThingId: toCaseSafeId("9Zz000000000999") }]);
    expect(bad).toMatchObject({ success: false, errors: [{ statusCode: "INVALID_CROSS_REFERENCE_KEY", fields: ["ThingId"] }] });
  });

  it("is never resolved by a polymorphic lookup", async () => {
    const [poly] = await engine.insert(session, "PrefixlessLink", [{ Name: "poly", SubjectId: thingId }]);
    expect(poly).toMatchObject({ success: false, errors: [{ statusCode: "INVALID_CROSS_REFERENCE_KEY", fields: ["SubjectId"] }] });
    const [user] = await engine.insert(session, "PrefixlessLink", [{ Name: "user", SubjectId: session.userId }]);
    expect(user, JSON.stringify(user?.errors)).toMatchObject({ success: true });
  });

  it("is followed by formula parent loading through a single-target lookup", async () => {
    const link = schema.getObject("PrefixlessLink");
    if (!link) throw new Error("PrefixlessLink missing from schema");
    const records: Record<string, unknown>[] = [{ ThingId: thingId }];
    const client = await pool.connect();
    try {
      await loadParents(client, engine.store, link, records, [["Thing"]]);
    } finally {
      client.release();
    }
    expect(records[0]?.["Thing"]).toMatchObject({ Name: "Renamed" });
  });
});
