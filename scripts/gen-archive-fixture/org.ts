/**
 * Boots examples/acme on in-process pglite exactly like `orglet up --import`, but with pinned key prefixes,
 * a pinned bootstrap and no wall clock, and writes the seed through DmlEngine (Phase 16 D-01, D-12, D-13).
 */
import { fileURLToPath } from "node:url";
import { createApiServer, prepareBulk } from "@orglet/api";
import { DmlEngine, Store, bootstrapOrg } from "@orglet/engine";
import type { Session } from "@orglet/engine";
import { loadOrgSchema } from "@orglet/metadata";
import type { OrgSchema, SObjectDef } from "@orglet/metadata";
import { migrate, reconcileKeyPrefixes } from "@orglet/schema";
import type { Pool } from "@orglet/schema";
import { openPgliteDb } from "../../test/db.js";
import { FIXTURE_ORG_SCHEMA, KEY_PREFIX_MAPPING } from "./seed.js";
import type { FixtureSeed, SeedDelete, SeedRecord, SeedUpdate } from "./seed.js";

const ACME = fileURLToPath(new URL("../../examples/acme/", import.meta.url));

export interface FixtureOrg {
  pool: Pool;
  schema: OrgSchema;
  engine: DmlEngine;
  store: Store;
  session: Session;
  app: ReturnType<typeof createApiServer>;
  headers: Record<string, string>;
  close(): Promise<void>;
}

export async function bootFixtureOrg(seed: FixtureSeed): Promise<FixtureOrg> {
  const db = await openPgliteDb();
  let app: ReturnType<typeof createApiServer> | undefined;
  try {
    const schema = (await loadOrgSchema({ projectDir: ACME })).schema;
    await reconcileKeyPrefixes(db.pool, schema, { orgSchema: FIXTURE_ORG_SCHEMA, mapping: { ...KEY_PREFIX_MAPPING } });
    await migrate(db.pool, schema, { orgSchema: FIXTURE_ORG_SCHEMA });
    const boot = await bootstrapOrg(db.pool, schema, { orgSchema: FIXTURE_ORG_SCHEMA, ...seed.bootstrap });
    if (boot.session.organizationId !== seed.orgId) throw new Error("fixture boot: organization Id differs from the seed");
    if (boot.session.userId !== seed.adminId) throw new Error("fixture boot: admin user Id differs from the seed");
    await prepareBulk(db.pool, FIXTURE_ORG_SCHEMA);
    const engine = new DmlEngine(db.pool, schema, { orgSchema: FIXTURE_ORG_SCHEMA, importMode: true });
    const store = new Store(schema, FIXTURE_ORG_SCHEMA);
    app = createApiServer({ engine, organizationId: boot.session.organizationId, recordTypeIds: boot.recordTypeIds });
    await app.ready();
    const login = await app.inject({
      method: "POST",
      url: "/services/oauth2/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: `grant_type=password&username=${encodeURIComponent(seed.bootstrap.admin.username)}&password=x`,
    });
    if (login.statusCode !== 200) throw new Error(`fixture boot: login failed with ${login.statusCode}`);
    const token = (JSON.parse(login.body) as { access_token: string }).access_token;
    const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    const opened = app;
    return {
      pool: db.pool,
      schema,
      engine,
      store,
      session: boot.session,
      app,
      headers,
      close: async () => {
        await opened.close();
        await db.close();
      },
    };
  } catch (err) {
    if (app) await app.close();
    await db.close();
    throw err;
  }
}

function fail(kind: "insert" | "update", object: string, index: number, statusCode: string | undefined): Error {
  return new Error(`seed ${kind} failed: ${object} #${index}: ${statusCode ?? "no result"}`);
}

const audit = (org: FixtureOrg, at: string): Record<string, unknown> => ({ LastModifiedDate: at, LastModifiedById: org.session.userId, SystemModstamp: at });

/** Import mode adds no stamps, so every row states its own (RESEARCH gap 3). One engine call per record keeps error attribution simple. */
export async function applyInserts(org: FixtureOrg, records: readonly SeedRecord[]): Promise<void> {
  for (const [i, r] of records.entries()) {
    const input: Record<string, unknown> = {
      Id: r.id,
      ...r.fields,
      IsDeleted: false,
      CreatedDate: r.at,
      CreatedById: org.session.userId,
      ...audit(org, r.at),
    };
    if (org.schema.getField(r.object, "OwnerId") && !("OwnerId" in input)) input.OwnerId = org.session.userId;
    const [res] = await org.engine.insert(org.session, r.object, [input]);
    if (!res?.success) throw fail("insert", r.object, i, res?.errors[0]?.statusCode);
  }
}

export async function applyUpdates(org: FixtureOrg, updates: readonly SeedUpdate[]): Promise<void> {
  for (const [i, u] of updates.entries()) {
    const [res] = await org.engine.update(org.session, u.object, [{ Id: u.id, ...u.changes, ...audit(org, u.at) }]);
    if (!res?.success) throw fail("update", u.object, i, res?.errors[0]?.statusCode);
  }
}

function schemaObject(org: FixtureOrg, name: string): SObjectDef {
  const obj = org.schema.getObject(name);
  if (!obj) throw new Error(`seed delete: unknown object ${name}`);
  return obj;
}

/** Straight to Store.setDeleted: engine.delete would stamp the wall clock (RESEARCH Pitfall 2). */
export async function applyDeletes(org: FixtureOrg, deletes: readonly SeedDelete[]): Promise<void> {
  const client = await org.pool.connect();
  try {
    for (const d of deletes) await org.store.setDeleted(client, schemaObject(org, d.object), d.ids, true, { at: d.at, by: org.session.userId });
  } finally {
    client.release();
  }
}
