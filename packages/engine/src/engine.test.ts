import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { loadOrgSchema, type OrgSchema } from "@orglet/metadata";
import { createPool, databaseUrlFromEnv, migrate, quote, type Pool } from "@orglet/schema";
import { bootstrapOrg } from "./bootstrap.js";
import { DmlEngine } from "./engine.js";
import type { ChangeEvent } from "./events.js";
import type { Session, TriggerContext } from "./hooks.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
const orgSchema = `test_${randomBytes(4).toString("hex")}`;

let pool: Pool;
let schema: OrgSchema;
let engine: DmlEngine;
let session: Session;
const hookLog: string[] = [];
const events: ChangeEvent[] = [];

beforeAll(async () => {
  pool = createPool(databaseUrlFromEnv());
  schema = (await loadOrgSchema({ projectDir: ACME })).schema;
  await migrate(pool, schema, { orgSchema });
  session = (await bootstrapOrg(pool, schema, { orgSchema })).session;
  engine = new DmlEngine(pool, schema, {
    orgSchema,
    executors: [
      {
        run: (ctx: TriggerContext) => {
          hookLog.push(`${ctx.timing}:${ctx.operation}:${ctx.sobject.name}:${ctx.records.length || ctx.old.length}`);
          if (ctx.sobject.name === "Account" && ctx.timing === "before" && ctx.operation === "insert") {
            ctx.records.forEach((r, i) => {
              if (r["Description"] === undefined || r["Description"] === null) r["Description"] = "set by hook";
              if (r["Name"] === "Reject") ctx.addError(i, "Rejected by hook", "Name");
            });
          }
          return Promise.resolve();
        },
      },
    ],
  });
  engine.bus.subscribe((e) => {
    events.push(...e);
  });
  expect(engine.warnings).toEqual([]);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${quote(orgSchema)} CASCADE`);
  await pool.end();
});

async function one(sobject: string, input: Record<string, unknown>): Promise<string> {
  const [r] = await engine.insert(session, sobject, [input]);
  expect(r?.errors, JSON.stringify(r?.errors)).toEqual([]);
  return r?.id as string;
}

describe("insert", () => {
  it("creates a record with system fields, owner and hook-populated defaults", async () => {
    const id = await one("Account", { Name: "Acme" });
    expect(id).toMatch(/^001[0-9A-Za-z]{15}$/);
    const rec = (await engine.retrieve(session, "Account", [id])).get(id);
    expect(rec).toMatchObject({ Id: id, Name: "Acme", IsDeleted: false, OwnerId: session.userId, CreatedById: session.userId, Description: "set by hook" });
    expect(rec?.["CreatedDate"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+0000$/);
    expect(rec?.["CreatedDate"]).toBe(rec?.["LastModifiedDate"]);
    expect(events.find((e) => e.changeType === "CREATE" && e.recordIds.includes(id))).toMatchObject({ entityName: "Account", commitUser: session.userId });
    expect(hookLog).toContain("before:insert:Account:1");
    expect(hookLog).toContain("after:insert:Account:1");
  });

  it("reports system validation errors with Salesforce status codes", async () => {
    const [unknown, readOnly, missing, picklist, tooLong] = await engine.insert(session, "Account", [
      { Name: "x", Nope__c: 1 },
      { Name: "x", CreatedDate: "2020-01-01T00:00:00Z" },
      { Industry: "Energy" },
      { Name: "x", Tier__c: "Platinum" },
      { Name: "x".repeat(256) },
    ]);
    expect(unknown?.errors[0]).toMatchObject({ statusCode: "INVALID_FIELD", message: "No such column 'Nope__c' on sobject of type Account" });
    expect(readOnly?.errors[0]).toMatchObject({ statusCode: "INVALID_FIELD_FOR_INSERT_UPDATE", fields: ["CreatedDate"] });
    expect(missing?.errors[0]).toMatchObject({ statusCode: "REQUIRED_FIELD_MISSING", message: "Required fields are missing: [Name]", fields: ["Name"] });
    expect(picklist?.errors[0]).toMatchObject({ statusCode: "INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST", fields: ["Tier__c"] });
    expect(tooLong?.errors[0]).toMatchObject({ statusCode: "STRING_TOO_LONG", fields: ["Name"] });
  });

  it("enforces validation rules and hook errors as FIELD_CUSTOM_VALIDATION_EXCEPTION", async () => {
    const [rule, ok, hook] = await engine.insert(session, "Account", [
      { Name: "Direct", Type: "Customer - Direct" },
      { Name: "Direct", Type: "Customer - Direct", Website: "https://direct.example" },
      { Name: "Reject" },
    ]);
    expect(rule?.errors).toEqual([{ statusCode: "FIELD_CUSTOM_VALIDATION_EXCEPTION", message: "Website is required for direct customers.", fields: ["Website"] }]);
    expect(ok?.success).toBe(true);
    expect(hook?.errors).toEqual([{ statusCode: "FIELD_CUSTOM_VALIDATION_EXCEPTION", message: "Rejected by hook", fields: ["Name"] }]);
  });

  it("checks lookup references exist and point at the right object", async () => {
    const accountId = await one("Account", { Name: "Parent" });
    const [dangling, wrongType, malformed, good] = await engine.insert(session, "Contact", [
      { LastName: "a", AccountId: "001000000000001AAA" },
      { LastName: "b", AccountId: session.userId },
      { LastName: "c", AccountId: "not-an-id" },
      { FirstName: "Jane", LastName: "Doe", AccountId: accountId.slice(0, 15) },
    ]);
    expect(dangling?.errors[0]).toMatchObject({ statusCode: "INVALID_CROSS_REFERENCE_KEY", fields: ["AccountId"] });
    expect(wrongType?.errors[0]).toMatchObject({ statusCode: "INVALID_CROSS_REFERENCE_KEY" });
    expect(malformed?.errors[0]).toMatchObject({ statusCode: "MALFORMED_ID", fields: ["AccountId"] });
    expect(good?.success).toBe(true);
    const contact = (await engine.retrieve(session, "Contact", [good?.id as string])).get(good?.id as string);
    expect(contact).toMatchObject({ AccountId: accountId, Name: "Jane Doe", FirstName: "Jane" });
  });

  it("applies partial success by default and rolls everything back with allOrNone", async () => {
    const partial = await engine.insert(session, "Account", [{ Name: "P1" }, { Industry: "Energy" }]);
    expect(partial.map((r) => r.success)).toEqual([true, false]);
    expect((await engine.retrieve(session, "Account", [partial[0]?.id as string])).size).toBe(1);

    const atomic = await engine.insert(session, "Account", [{ Name: "A1" }, { Industry: "Energy" }], { allOrNone: true });
    expect(atomic[0]?.errors[0]?.statusCode).toBe("ALL_OR_NONE_OPERATION_ROLLED_BACK");
    expect(atomic[1]?.errors[0]?.statusCode).toBe("REQUIRED_FIELD_MISSING");
    expect((await engine.retrieve(session, "Account", [atomic[0]?.id as string])).size).toBe(0);
  });

  it("derives Opportunity probability from the stage and computes formula fields on read", async () => {
    const id = await one("Opportunity", { Name: "Deal", StageName: "Prospecting", CloseDate: "2026-12-31", Amount: 1000 });
    const opp = (await engine.retrieve(session, "Opportunity", [id])).get(id);
    expect(opp).toMatchObject({ Probability: 10, IsClosed: false, IsWon: false, ForecastCategory: "Pipeline", Weighted_Amount__c: 100 });
  });
});

describe("update and upsert", () => {
  it("updates fields, stamps modification metadata and accepts 15-character ids", async () => {
    const id = await one("Account", { Name: "Before" });
    const before = (await engine.retrieve(session, "Account", [id])).get(id);
    await new Promise((r) => setTimeout(r, 5));
    const [r] = await engine.update(session, "Account", [{ Id: id.slice(0, 15), Name: "After", Industry: "Energy" }]);
    expect(r).toMatchObject({ id, success: true });
    const after = (await engine.retrieve(session, "Account", [id])).get(id);
    expect(after).toMatchObject({ Name: "After", Industry: "Energy" });
    expect(after?.["LastModifiedDate"]).not.toBe(before?.["LastModifiedDate"]);
    expect(after?.["CreatedDate"]).toBe(before?.["CreatedDate"]);
    // Change Data Capture lists the system stamps among the changed fields too.
    expect(events.find((e) => e.changeType === "UPDATE" && e.recordIds.includes(id))?.changedFields.sort()).toEqual(["Industry", "LastModifiedDate", "Name", "SystemModstamp"]);
  });

  it("rejects updates to missing, deleted or foreign records", async () => {
    const id = await one("Account", { Name: "Gone" });
    await engine.delete(session, "Account", [id]);
    const [missing, deleted, noId, foreign] = await engine.update(session, "Account", [
      { Id: "001000000000001AAA", Name: "x" },
      { Id: id, Name: "x" },
      { Name: "x" },
      { Id: session.userId, Name: "x" },
    ]);
    expect(missing?.errors[0]?.statusCode).toBe("NOT_FOUND");
    expect(deleted?.errors[0]?.statusCode).toBe("ENTITY_IS_DELETED");
    expect(noId?.errors[0]?.statusCode).toBe("MISSING_ARGUMENT");
    expect(foreign?.errors[0]?.statusCode).toBe("MALFORMED_ID");
  });

  it("evaluates ISCHANGED/PRIORVALUE rules against the old row", async () => {
    const id = await one("Account", { Name: "Stable", Type: "Prospect" });
    // Switching to a direct customer without a website trips the rule only on update.
    const [r] = await engine.update(session, "Account", [{ Id: id, Type: "Customer - Direct" }]);
    expect(r?.errors[0]).toMatchObject({ statusCode: "FIELD_CUSTOM_VALIDATION_EXCEPTION", fields: ["Website"] });
  });

  it("upserts on an external id: create, then update, and flags duplicates", async () => {
    const [created] = await engine.upsert(session, "Account", "Customer_Number__c", [{ Customer_Number__c: "C-100", Name: "Cust" }]);
    expect(created).toMatchObject({ success: true, created: true });
    const [updated] = await engine.upsert(session, "Account", "Customer_Number__c", [{ Customer_Number__c: "c-100", Name: "Cust renamed" }]);
    expect(updated).toMatchObject({ success: true, created: false, id: created?.id });
    expect((await engine.retrieve(session, "Account", [created?.id as string])).get(created?.id as string)?.["Name"]).toBe("Cust renamed");

    const [dup] = await engine.insert(session, "Account", [{ Name: "Dup", Customer_Number__c: "C-100" }]);
    expect(dup?.errors[0]).toMatchObject({ statusCode: "DUPLICATE_VALUE", fields: ["Customer_Number__c"] });
    expect(dup?.errors[0]?.message).toContain(created?.id as string);
  });
});

describe("master-detail, delete and undelete", () => {
  it("defaults picklists, record types and auto-numbers on custom objects", async () => {
    const accountId = await one("Account", { Name: "MD" });
    const projectId = await one("Project__c", { Name: "P", Account__c: accountId });
    const project = (await engine.retrieve(session, "Project__c", [projectId])).get(projectId);
    expect(project?.["Status__c"]).toBe("Planned");
    expect(project?.["RecordTypeId"]).toMatch(/^012/);
    expect(project?.["OwnerId"]).toBeUndefined();
    const m1 = await one("Milestone__c", { Project__c: projectId, Due_Date__c: "2026-10-01" });
    const m2 = await one("Milestone__c", { Project__c: projectId, Due_Date__c: "2026-10-02" });
    const names = [...(await engine.retrieve(session, "Milestone__c", [m1, m2])).values()].map((r) => r["Name"]).sort();
    expect(names).toEqual(["MS-0001", "MS-0002"]);
    const [required] = await engine.insert(session, "Milestone__c", [{ Project__c: projectId }]);
    expect(required?.errors[0]).toMatchObject({ statusCode: "REQUIRED_FIELD_MISSING", fields: ["Due_Date__c"] });
  });

  it("cascades delete and undelete through master-detail chains", async () => {
    const accountId = await one("Account", { Name: "Cascade" });
    const projectId = await one("Project__c", { Name: "P", Account__c: accountId });
    const milestoneId = await one("Milestone__c", { Project__c: projectId, Due_Date__c: "2026-10-01" });

    const [del] = await engine.delete(session, "Account", [accountId]);
    expect(del).toMatchObject({ id: accountId, success: true });
    expect((await engine.retrieve(session, "Milestone__c", [milestoneId])).size).toBe(0);
    expect((await engine.retrieve(session, "Milestone__c", [milestoneId], { includeDeleted: true })).get(milestoneId)?.["IsDeleted"]).toBe(true);
    expect(hookLog).toContain("before:delete:Milestone__c:1");
    expect(events.find((e) => e.changeType === "DELETE" && e.recordIds.includes(accountId))).toBeDefined();

    const [again] = await engine.delete(session, "Account", [accountId]);
    expect(again?.errors[0]?.statusCode).toBe("ENTITY_IS_DELETED");

    const [undel] = await engine.undelete(session, "Account", [accountId]);
    expect(undel?.success).toBe(true);
    expect((await engine.retrieve(session, "Milestone__c", [milestoneId])).get(milestoneId)?.["IsDeleted"]).toBe(false);
  });

  it("refuses to touch unknown objects with a 404-style error", async () => {
    await expect(engine.insert(session, "Nope__c", [{}])).rejects.toMatchObject({ statusCode: "NOT_FOUND", httpStatus: 404 });
  });
});
