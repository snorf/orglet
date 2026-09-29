import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadOrgSchema, type OrgSchema } from "@orglet/metadata";
import { compileSoql, type CompiledQuery } from "./compile.js";
import { SoqlError } from "./errors.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
let schema: OrgSchema;
const now = new Date("2026-09-25T10:00:00Z"); // a Friday

beforeAll(async () => {
  schema = (await loadOrgSchema({ projectDir: ACME })).schema;
});

const compile = (soql: string, includeDeleted = false): CompiledQuery => compileSoql(soql, { schema, orgSchema: "org", now, includeDeleted });
const sql = (soql: string) => compile(soql).sql.replace(/\s+/g, " ");

describe("compileSoql", () => {
  it("selects canonical columns with the soft-delete filter and case-insensitive object names", () => {
    const q = compile("select id, name, industry from account");
    expect(q.sobject.name).toBe("Account");
    expect(q.sql).toContain('FROM "org"."account" t0');
    expect(q.sql).toContain('WHERE t0."isdeleted" = false');
    expect(q.shape.kind === "sobject" && q.shape.fields.map((f) => f.name)).toEqual(["Id", "Name", "Industry"]);
  });

  it("drops the soft-delete filter for queryAll", () => {
    expect(compile("SELECT Id FROM Account", true).sql).not.toContain("isdeleted");
  });

  it("joins parents once per relationship path and nests them in the shape", () => {
    const q = compile("SELECT Id, Account.Name, Account.Industry, Account.Owner.Alias FROM Contact");
    expect(q.sql).toContain('LEFT JOIN "org"."account" t1 ON t1."id" = t0."accountid"');
    expect(q.sql).toContain('LEFT JOIN "org"."user" t2 ON t2."id" = t1."ownerid"');
    expect((q.sql.match(/LEFT JOIN/g) ?? []).length).toBe(2);
    const shape = q.shape.kind === "sobject" ? q.shape : undefined;
    expect(shape?.parents.get("Account")?.fields.map((f) => f.name)).toEqual(["Name", "Industry"]);
    expect(shape?.parents.get("Account")?.parents.get("Owner")?.fields.map((f) => f.name)).toEqual(["Alias"]);
  });

  it("compiles child subqueries as correlated JSON aggregates with their own order and limit", () => {
    const q = compile("SELECT Id, (SELECT Id, LastName FROM Contacts WHERE Email != null ORDER BY LastName LIMIT 5), (SELECT Name FROM Projects__r) FROM Account");
    expect(q.sql).toMatch(/\(SELECT json_agg\(row_to_json\(sub\)\) FROM \(SELECT .* FROM "org"\."contact" t1 WHERE t1\."accountid" = t0\."id" AND t1\."isdeleted" = false AND \(t1\."email" IS NOT NULL\) ORDER BY lower\(t1\."lastname"\) ASC NULLS FIRST LIMIT 5\) sub\)/);
    expect(q.sql).toContain('"org"."project__c" t2 WHERE t2."account__c" = t0."id"');
    const shape = q.shape.kind === "sobject" ? q.shape : undefined;
    expect([...(shape?.children.keys() ?? [])]).toEqual(["Contacts", "Projects__r"]);
  });

  it("compares text case-insensitively, keeps != null-inclusive and translates LIKE to ILIKE", () => {
    const q = compile("SELECT Id FROM Account WHERE Name = 'Acme' AND Industry != 'Energy' AND Website LIKE '%.se' AND AnnualRevenue > 100");
    expect(q.sql).toContain('lower(t0."name") = lower($1)');
    expect(q.sql).toContain('lower(t0."industry") IS DISTINCT FROM lower($2)');
    expect(q.sql).toContain('t0."website" ILIKE $3');
    expect(q.sql).toContain('t0."annualrevenue" > $4');
    expect(q.params).toEqual(["Acme", "Energy", "%.se", 100]);
  });

  it("keeps case-sensitive external ids exact and unescapes SOQL string escapes", () => {
    const q = compile("SELECT Id FROM Project__c WHERE Code__c = 'P\\'1'");
    expect(q.sql).toContain('t0."code__c" = $1');
    expect(q.params).toEqual(["P'1"]);
  });

  it("renders parentheses and NOT from the flat clause chain", () => {
    expect(sql("SELECT Id FROM Contact WHERE NOT (FirstName = 'a' AND LastName = 'b') OR Email = null")).toContain(
      'WHERE t0."isdeleted" = false AND NOT (lower(t0."firstname") = lower($1) AND lower(t0."lastname") = lower($2)) OR t0."email" IS NULL',
    );
    expect(sql("SELECT Id FROM Account WHERE Name = 'a' AND (Industry = 'b' OR AnnualRevenue > 1)")).toContain("AND (lower(t0.\"industry\") = lower($2) OR t0.\"annualrevenue\" > $3)");
  });

  it("turns date literals into half-open ranges, as dates or timestamps depending on the field", () => {
    const q = compile("SELECT Id FROM Project__c WHERE Start_Date__c = THIS_WEEK AND CreatedDate = LAST_N_DAYS:7 AND End_Date__c < TODAY AND LastModifiedDate >= YESTERDAY");
    expect(q.params).toEqual([
      "2026-09-20",
      "2026-09-27",
      "2026-09-18T00:00:00.000Z",
      "2026-09-26T00:00:00.000Z",
      "2026-09-25",
      "2026-09-24T00:00:00.000Z",
    ]);
    expect(q.sql).toContain('(t0."start_date__c" >= $1 AND t0."start_date__c" < $2)');
    expect(q.sql).toContain('t0."end_date__c" < $5');
    expect(q.sql).toContain('t0."lastmodifieddate" >= $6');
  });

  it("compiles IN lists, semi-joins, booleans and multi-select INCLUDES", () => {
    const q = compile("SELECT Id FROM Account WHERE Industry IN ('Energy', 'Other') AND Id IN (SELECT AccountId FROM Contact WHERE Email != null) AND IsDeleted = false");
    expect(q.sql).toContain('lower(t0."industry") IN (lower($1), lower($2))');
    expect(q.sql).toMatch(/t0\."id" IN \(SELECT t\d+\."accountid" FROM "org"\."contact" t\d+ WHERE TRUE AND t\d+\."isdeleted" = false AND \(t\d+\."email" IS NOT NULL\)\)/);
    expect(q.sql).toContain('t0."isdeleted" = $3');
    expect(q.params).toEqual(["Energy", "Other", false]);
  });

  it("compiles COUNT() and grouped aggregates with expr names", () => {
    const count = compile("SELECT COUNT() FROM Account");
    expect(count.countOnly).toBe(true);
    expect(count.sql).toContain('count(*) AS "c0"');
    const grouped = compile("SELECT Industry, COUNT(Id) cnt, SUM(AnnualRevenue), MAX(CreatedDate) FROM Account GROUP BY Industry HAVING COUNT(Id) > 1 ORDER BY Industry");
    expect(grouped.sql).toContain('GROUP BY t0."industry" HAVING count(t0."id") > $1');
    expect(grouped.shape.kind === "aggregate" && grouped.shape.columns.map((c) => c.name)).toEqual(["Industry", "cnt", "expr0", "expr1"]);
  });

  it("expands FIELDS(ALL), computes compound Name in SQL and defers formula fields", () => {
    const all = compile("SELECT FIELDS(ALL) FROM Contact LIMIT 1");
    const shape = all.shape.kind === "sobject" ? all.shape : undefined;
    expect(shape?.fields.map((f) => f.name)).toContain("MailingAddress");
    expect(all.sql).toContain("NULLIF(concat_ws(' ', t0.\"firstname\", t0.\"lastname\"), '')");
    const opp = compile("SELECT Id, Weighted_Amount__c FROM Opportunity");
    expect(opp.shape.kind === "sobject" && opp.shape.computed).toEqual(["Weighted_Amount__c"]);
    expect(opp.fetchesAllColumns).toBe(true);
  });

  it("sorts text case-insensitively with SOQL null ordering and honours LIMIT/OFFSET", () => {
    expect(sql("SELECT Id FROM Account ORDER BY Name DESC, AnnualRevenue NULLS LAST LIMIT 10 OFFSET 5")).toContain(
      'ORDER BY lower(t0."name") DESC NULLS LAST, t0."annualrevenue" ASC NULLS LAST LIMIT 10 OFFSET 5',
    );
  });

  it("maps toLabel to picklist labels", () => {
    const q = compile("SELECT toLabel(Preferred_Language__c) FROM Contact");
    const shape = q.shape.kind === "sobject" ? q.shape : undefined;
    expect(shape?.fields[0]?.labels?.get("sv")).toBe("Swedish");
  });

  it("reports Salesforce-style errors", () => {
    expect(() => compile("SELECT Id FROM Nope")).toThrow(SoqlError);
    expect(() => compile("SELECT Id FROM Nope")).toThrow(/sObject type 'Nope' is not supported/);
    expect(() => compile("SELECT Nope FROM Account")).toThrow(/No such column 'Nope' on entity 'Account'/);
    expect(() => compile("SELECT Id, Foo.Name FROM Account")).toThrow(/Didn't understand relationship 'Foo'/);
    expect(() => compile("SELECT Id FROM Account WHERE")).toThrow(/EOF|token/);
    try {
      compile("SELECT Id FROM Account WHERE");
    } catch (e) {
      expect((e as SoqlError).errorCode).toBe("MALFORMED_QUERY");
    }
    expect(compile("SELECT Id FROM Account FOR VIEW").sql).toContain('FROM "org"."account"');
  });
});
