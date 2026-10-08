import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { loadOrgSchema, type OrgSchema } from "@orglet/metadata";
import { migrate, quote, toCaseSafeId, type Pool } from "@orglet/schema";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { bootstrapOrg } from "./bootstrap.js";
import { DmlEngine } from "./engine.js";
import type { ChangeEvent } from "./events.js";
import type { Session, TriggerContext } from "./hooks.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
const orgSchema = `test_${randomBytes(4).toString("hex")}`;

let testDb: TestDb;
let pool: Pool;
let schema: OrgSchema;
let engine: DmlEngine;
let session: Session;
const hookLog: string[] = [];
const events: ChangeEvent[] = [];

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
  await testDb.close();
});

async function one(sobject: string, input: Record<string, unknown>): Promise<string> {
  const [r] = await engine.insert(session, sobject, [input]);
  expect(r?.errors, JSON.stringify(r?.errors)).toEqual([]);
  return r?.id as string;
}

/** Fact Table flags (createable, updateable, deletable, undeletable) for the 14 thin objects. */
const THIN_FLAGS: Record<string, [boolean, boolean, boolean, boolean]> = {
  BusinessHours: [true, true, false, false], BusinessProcess: [true, true, false, false], CallCenter: [true, false, false, false],
  DandBCompany: [true, true, true, true], Entitlement: [true, true, true, true], ExternalDataSource: [false, false, false, false],
  IdeaTheme: [true, true, true, true], Individual: [true, true, true, true], OperatingHours: [true, true, true, true],
  OpportunityHistory: [false, false, false, false], ServiceAppointment: [true, true, true, true], ServiceContract: [true, true, true, true],
  SocialPost: [true, true, true, true], UserLicense: [false, false, false, false],
};
const unknownId = (name: string) => toCaseSafeId(`${schema.getObject(name)?.keyPrefix ?? "000"}000000000099`);
const codes = (r: { errors: { statusCode: string }[] } | undefined) => (r?.errors ?? []).map((e) => e.statusCode);

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

describe("object flags", () => {
  it("object flags: insert, update and delete forbidden by a thin object's flags fail with INVALID_TYPE_FOR_OPERATION, allowed ones never do", async () => {
    for (const [name, [c, u, d]] of Object.entries(THIN_FLAGS)) {
      for (const [op, allowed] of [["insert", c], ["update", u], ["delete", d]] as const) {
        const result =
          op === "insert"
            ? await engine.insert(session, name, [{}])
            : op === "update"
              ? await engine.update(session, name, [{ Id: unknownId(name) }])
              : await engine.delete(session, name, [unknownId(name)]);
        if (allowed) {
          expect(codes(result[0]), `${name} ${op}`).not.toContain("INVALID_TYPE_FOR_OPERATION");
        } else {
          expect(result[0]?.errors, `${name} ${op}`).toEqual([{ statusCode: "INVALID_TYPE_FOR_OPERATION", message: `entity type ${name} does not support ${op}`, fields: [] }]);
        }
      }
    }
  });

  it("object flags: one error per record, each a separate object", async () => {
    const rs = await engine.insert(session, "UserLicense", [{}, {}]);
    expect(rs).toHaveLength(2);
    expect(rs[0]?.errors[0]).not.toBe(rs[1]?.errors[0]);
    expect(rs.every((r) => r.success === false)).toBe(true);
  });

  it("object flags: upsert needs both createable and updateable, undelete needs undeletable", async () => {
    const [license] = await engine.upsert(session, "UserLicense", "Id", [{ Id: unknownId("UserLicense") }]);
    expect(license?.errors).toEqual([{ statusCode: "INVALID_TYPE_FOR_OPERATION", message: "entity type UserLicense does not support upsert", fields: [] }]);
    const [center] = await engine.upsert(session, "CallCenter", "Name", [{ Name: "Upserted Center" }]);
    expect(center?.errors[0]).toMatchObject({ statusCode: "INVALID_TYPE_FOR_OPERATION", message: "entity type CallCenter does not support upsert" });
    const [hours] = await engine.upsert(session, "BusinessHours", "Name", [{ Name: "Upsert Hours" }]);
    expect(codes(hours)).not.toContain("INVALID_TYPE_FOR_OPERATION");
    const [undeleteHours] = await engine.undelete(session, "BusinessHours", [unknownId("BusinessHours")]);
    expect(undeleteHours?.errors).toEqual([{ statusCode: "INVALID_TYPE_FOR_OPERATION", message: "entity type BusinessHours does not support undelete", fields: [] }]);
    const [undeleteEntitlement] = await engine.undelete(session, "Entitlement", [unknownId("Entitlement")]);
    expect(codes(undeleteEntitlement)).not.toContain("INVALID_TYPE_FOR_OPERATION");
  });
});

describe("thin object references", () => {
  it("thin: a lookup to a thin object with an unknown or wrong-prefix Id is INVALID_CROSS_REFERENCE_KEY", async () => {
    const [unknown, wrongPrefix] = await engine.insert(session, "Case", [
      { Subject: "thin ref", BusinessHoursId: "01m000000000001AAA" },
      { Subject: "thin ref", BusinessHoursId: "001000000000001AAA" },
    ]);
    expect(unknown?.errors[0]).toMatchObject({ statusCode: "INVALID_CROSS_REFERENCE_KEY", fields: ["BusinessHoursId"] });
    expect(wrongPrefix?.errors[0]).toMatchObject({ statusCode: "INVALID_CROSS_REFERENCE_KEY", fields: ["BusinessHoursId"] });
    const [contact] = await engine.insert(session, "Contact", [{ LastName: "Thin", IndividualId: toCaseSafeId("0PK000000000001") }]);
    expect(contact?.errors[0]).toMatchObject({ statusCode: "INVALID_CROSS_REFERENCE_KEY", fields: ["IndividualId"] });
  });

  it("thin: a lookup to an existing thin-object row is accepted", async () => {
    const hours = await one("BusinessHours", { Name: "Thin Ref Hours" });
    const individual = await one("Individual", { FirstName: "Ada", LastName: "Thin" });
    const caseId = await one("Case", { Subject: "thin ok", BusinessHoursId: hours });
    const contactId = await one("Contact", { LastName: "Thin", IndividualId: individual });
    expect((await engine.retrieve(session, "Case", [caseId])).get(caseId)?.["BusinessHoursId"]).toBe(hours);
    expect((await engine.retrieve(session, "Contact", [contactId])).get(contactId)?.["IndividualId"]).toBe(individual);
    expect((await engine.retrieve(session, "Individual", [individual])).get(individual)).toMatchObject({ Name: "Ada Thin" });
  });
});

describe("import mode", () => {
  it("keeps supplied ids and audit fields, loads children before parents, and bypasses rules and hooks", async () => {
    const importer = new DmlEngine(pool, schema, { orgSchema, importMode: true, executors: [{ run: () => Promise.reject(new Error("hooks must not run")) }] });
    const accountId = toCaseSafeId("001000000000AAA");
    const contactId = toCaseSafeId("003000000000BBB");
    const [child] = await importer.insert(session, "Contact", [{ Id: contactId, LastName: "First", AccountId: accountId, CreatedDate: "2020-01-02T03:04:05.000+0000", CreatedById: session.userId }]);
    expect(child, JSON.stringify(child?.errors)).toMatchObject({ id: contactId, success: true });
    const [parent] = await importer.insert(session, "Account", [{ Id: accountId, Name: "Imported", Type: "Customer - Direct", CreatedDate: "2019-06-01T00:00:00.000+0000" }]);
    expect(parent, JSON.stringify(parent?.errors)).toMatchObject({ id: accountId, success: true });

    const account = (await engine.retrieve(session, "Account", [accountId])).get(accountId);
    expect(account).toMatchObject({ Name: "Imported", CreatedDate: "2019-06-01T00:00:00.000+0000", CreatedById: session.userId });
    const contact = (await engine.retrieve(session, "Contact", [contactId])).get(contactId);
    expect(contact).toMatchObject({ AccountId: accountId, CreatedDate: "2020-01-02T03:04:05.000+0000" });

    const [dup] = await importer.insert(session, "Account", [{ Id: accountId, Name: "Again" }]);
    expect(dup?.errors[0]).toMatchObject({ statusCode: "DUPLICATE_VALUE", fields: ["Id"] });
    const [wrongPrefix] = await importer.insert(session, "Account", [{ Id: contactId, Name: "Wrong" }]);
    expect(wrongPrefix?.errors[0]?.statusCode).toBe("MALFORMED_ID");
    // Outside import mode the same validation rule still fires and ids are not accepted.
    const [normal] = await engine.insert(session, "Account", [{ Id: toCaseSafeId("001000000000CCC"), Name: "Normal", Type: "Customer - Direct" }]);
    expect(normal?.errors.map((e) => e.statusCode)).toContain("FIELD_CUSTOM_VALIDATION_EXCEPTION");
  });

  it("object flags are bypassed in import mode for read-only, create-only and non-deletable thin objects", async () => {
    const importer = new DmlEngine(pool, schema, { orgSchema, importMode: true });
    const licenseId = toCaseSafeId("100000000000077");
    const historyId = toCaseSafeId("008000000000077");
    const sourceId = toCaseSafeId("0XC000000000077");
    const centerId = toCaseSafeId("04v000000000077");
    const hoursId = toCaseSafeId("01m000000000077");
    expect(await importer.insert(session, "UserLicense", [{ Id: licenseId, Name: "Imported License", MasterLabel: "Imported License" }])).toMatchObject([{ id: licenseId, success: true }]);
    expect(await importer.insert(session, "OpportunityHistory", [{ Id: historyId }])).toMatchObject([{ id: historyId, success: true }]);
    expect(await importer.insert(session, "ExternalDataSource", [{ Id: sourceId, DeveloperName: "Imported_Source" }])).toMatchObject([{ id: sourceId, success: true }]);
    expect(await importer.insert(session, "CallCenter", [{ Id: centerId, Name: "Imported Center" }])).toMatchObject([{ id: centerId, success: true }]);
    expect(await importer.update(session, "CallCenter", [{ Id: centerId, Name: "Renamed Center" }])).toMatchObject([{ success: true }]);
    expect(await importer.insert(session, "BusinessHours", [{ Id: hoursId, Name: "Imported Hours" }])).toMatchObject([{ id: hoursId, success: true }]);
    expect(await importer.delete(session, "BusinessHours", [hoursId])).toMatchObject([{ success: true }]);
    expect(await importer.undelete(session, "BusinessHours", [hoursId])).toMatchObject([{ success: true }]);
    // The normal-mode engine still refuses the same calls.
    expect(codes((await engine.insert(session, "UserLicense", [{ Name: "x", MasterLabel: "x" }]))[0])).toEqual(["INVALID_TYPE_FOR_OPERATION"]);
    expect(codes((await engine.update(session, "CallCenter", [{ Id: centerId, Name: "x" }]))[0])).toEqual(["INVALID_TYPE_FOR_OPERATION"]);
    expect(codes((await engine.delete(session, "BusinessHours", [hoursId]))[0])).toEqual(["INVALID_TYPE_FOR_OPERATION"]);
    expect((await engine.retrieve(session, "CallCenter", [centerId])).get(centerId)).toMatchObject({ Name: "Renamed Center" });
  });
});
