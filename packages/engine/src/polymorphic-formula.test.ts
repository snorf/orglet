/**
 * FORM-02 at runtime: typed polymorphic formula references load only the named target, blank otherwise,
 * and loaded parents never leak into returned records (D-10, D-11, research Pitfall 5).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { loadOrgSchema, OrgSchemaImpl, type FieldDef, type OrgSchema, type SObjectDef, type ValidationRuleDef } from "@orglet/metadata";
import { migrate, quote, type Pool } from "@orglet/schema";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { bootstrapOrg } from "./bootstrap.js";
import { DmlEngine } from "./engine.js";
import type { Session } from "./hooks.js";
import { runQuery } from "./query.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));

interface Fixture {
  testDb: TestDb;
  pool: Pool;
  orgSchema: string;
  engine: DmlEngine;
  session: Session;
}

async function setup(extend: (base: OrgSchema) => OrgSchema): Promise<Fixture> {
  const testDb = await openTestDb();
  const pool = testDb.pool;
  const orgSchema = `test_${randomBytes(4).toString("hex")}`;
  const schema = extend((await loadOrgSchema({ projectDir: ACME })).schema);
  await migrate(pool, schema, { orgSchema });
  const session = (await bootstrapOrg(pool, schema, { orgSchema })).session;
  return { testDb, pool, orgSchema, engine: new DmlEngine(pool, schema, { orgSchema }), session };
}

async function teardown(f: Fixture): Promise<void> {
  await f.pool.query(`DROP SCHEMA IF EXISTS ${quote(f.orgSchema)} CASCADE`);
  await f.testDb.close();
}

function withObject(base: OrgSchema, name: string, change: (o: SObjectDef, template: FieldDef) => SObjectDef): OrgSchema {
  const obj = base.getObject(name) as SObjectDef;
  const template = obj.fields.find((f) => f.name === (name === "Case" ? "Subject" : "Name") || f.name === "LastName") as FieldDef;
  const objects = new Map(base.objects);
  objects.set(name.toLowerCase(), change(obj, template));
  return new OrgSchemaImpl(objects, base.globalValueSets, base.standardValueSets, base.labels);
}

const formula = (template: FieldDef, name: string, expr: string): FieldDef => ({ ...template, name, label: name, type: "Text", formula: expr, length: 255, formulaTreatBlanksAs: "BlankAsBlank" });

const insert = async (f: Fixture, sobject: string, input: Record<string, unknown>) => {
  const [r] = await f.engine.insert(f.session, sobject, [input]);
  if (!r?.success) throw new Error(JSON.stringify(r?.errors));
  return r.id as string;
};

describe("typed polymorphic formula fields", () => {
  let f: Fixture;
  let userCase = "";
  let groupCase = "";
  let accountId = "";
  let contactId = "";

  beforeAll(async () => {
    f = await setup((base) => {
      const withCase = withObject(base, "Case", (o, t) => ({
        ...o,
        fields: [
          ...o.fields,
          formula(t, "Owner_Email__c", "Owner:User.Email"),
          formula(t, "Queue_Name__c", "Owner:Queue.Name"),
          formula(t, "Group_Name__c", "Owner:Group.Name"),
          formula(t, "Queue_Mail__c", "Owner:Queue.QueueEmail"),
          formula(t, "Owner_Profile__c", "Owner:User.Profile.Name"),
        ],
      }));
      return withObject(withCase, "Contact", (o, t) => ({ ...o, fields: [...o.fields, formula(t, "Account_Name__c", "Account.Name")] }));
    });
    expect(f.engine.warnings).toEqual([]);
    const groupId = await insert(f, "Group", { Name: "Support Queue", DeveloperName: "Support_Queue", Type: "Queue", Email: "queue@acme.se" });
    groupCase = await insert(f, "Case", { Subject: "B group case", OwnerId: groupId });
    userCase = await insert(f, "Case", { Subject: "A user case" });
    accountId = await insert(f, "Account", { Name: "Acme" });
    contactId = await insert(f, "Contact", { LastName: "Doe", AccountId: accountId });
  });

  afterAll(() => teardown(f));

  it("a User-owned case reads the user through Owner:User and is blank through Owner:Queue", async () => {
    const row = (await f.engine.retrieve(f.session, "Case", [userCase])).get(userCase) as Record<string, unknown>;
    expect(row["Owner_Email__c"]).toEqual(expect.stringContaining("@"));
    expect(row["Owner_Profile__c"]).toBe("System Administrator");
    expect(row["Queue_Name__c"]).toBeNull();
    expect(row["Group_Name__c"]).toBeNull();
    expect(row["Queue_Mail__c"]).toBeNull();
  });

  it("a Group-owned case reads the queue through Owner:Queue and Owner:Group and is blank through Owner:User", async () => {
    const row = (await f.engine.retrieve(f.session, "Case", [groupCase])).get(groupCase) as Record<string, unknown>;
    expect(row["Queue_Name__c"]).toBe("Support Queue");
    expect(row["Group_Name__c"]).toBe("Support Queue");
    expect(row["Queue_Mail__c"]).toBe("queue@acme.se");
    expect(row["Owner_Email__c"]).toBeNull();
    expect(row["Owner_Profile__c"]).toBeNull();
  });

  it("the SOQL formula-field path returns the same typed values", async () => {
    const res = await runQuery(f.engine, f.session, "SELECT Id, Owner_Email__c, Queue_Name__c FROM Case ORDER BY Subject", { apiVersion: "60.0" });
    expect(res.records.map((r) => r["Queue_Name__c"])).toEqual([null, "Support Queue"]);
    expect(res.records[0]?.["Owner_Email__c"]).toEqual(expect.stringContaining("@"));
    expect(res.records[1]?.["Owner_Email__c"]).toBeNull();
  });

  it("retrieved records carry no relationship objects loaded for formulas", async () => {
    const row = (await f.engine.retrieve(f.session, "Case", [userCase])).get(userCase) as Record<string, unknown>;
    for (const key of ["Owner:User", "Owner:Group", "Owner"]) expect(row).not.toHaveProperty(key);
    expect(row["Owner_Profile__c"]).toBe("System Administrator");
  });

  it("a plain parent loaded for a formula does not leak into the retrieved record", async () => {
    const row = (await f.engine.retrieve(f.session, "Contact", [contactId])).get(contactId) as Record<string, unknown>;
    expect(row["Account_Name__c"]).toBe("Acme");
    expect(row).not.toHaveProperty("Account");
  });
});

describe("typed polymorphic validation rule", () => {
  let f: Fixture;

  beforeAll(async () => {
    const rule: ValidationRuleDef = { name: "Owner_Not_Admin", active: true, errorConditionFormula: "Owner:User.Alias = 'admin'", errorMessage: "admin may not own" };
    f = await setup((base) => withObject(base, "Case", (o) => ({ ...o, validationRules: [...o.validationRules, rule] })));
    expect(f.engine.warnings).toEqual([]);
  });

  afterAll(() => teardown(f));

  it("owner_not_admin_rule_blocks_user_owned_case_and_allows_group_owned_case", async () => {
    const [blocked] = await f.engine.insert(f.session, "Case", [{ Subject: "Admin owned" }]);
    expect(blocked?.success).toBe(false);
    expect(blocked?.errors[0]?.statusCode).toBe("FIELD_CUSTOM_VALIDATION_EXCEPTION");
    const groupId = await insert(f, "Group", { Name: "Support Queue", DeveloperName: "Support_Queue", Type: "Queue" });
    const [allowed] = await f.engine.insert(f.session, "Case", [{ Subject: "Queue owned", OwnerId: groupId }]);
    expect(allowed?.success).toBe(true);
  });
});
