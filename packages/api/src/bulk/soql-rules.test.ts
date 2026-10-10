/**
 * The Bulk SOQL rule set is pure (parser AST plus an OrgSchema), so every documented construct
 * is tested here without a database.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadOrgSchema, type FieldDef, type OrgSchema } from "@orglet/metadata";
import { SoqlError } from "@orglet/soql";
import { bulkQueryViolation, parseBulkQuery, type BulkRuleSchema } from "./soql-rules.js";

const ACME = fileURLToPath(new URL("../../../../examples/acme/", import.meta.url));

let schema: OrgSchema;
let withLocation: BulkRuleSchema;

beforeAll(async () => {
  schema = (await loadOrgSchema({ projectDir: ACME })).schema;
  withLocation = {
    getField: (o, f) =>
      o.toLowerCase() === "account" && f.toLowerCase() === "site_location__c"
        ? ({ ...(schema.getField("Account", "Name") as FieldDef), name: "Site_Location__c", type: "Location" } as FieldDef)
        : schema.getField(o, f),
    resolveRelationship: (o, r) => schema.resolveRelationship(o, r),
  };
});

const violations: Array<[string, string]> = [
  ["SELECT Id, TYPEOF What WHEN Account THEN Name END FROM Event", "TYPEOF"],
  ["SELECT Industry FROM Account GROUP BY Industry", "GROUP BY"],
  ["SELECT Industry FROM Account GROUP BY ROLLUP(Industry)", "GROUP BY"],
  ["SELECT Industry FROM Account GROUP BY CUBE(Industry)", "GROUP BY"],
  ["SELECT Id FROM Account OFFSET 2", "OFFSET"],
  ["SELECT Id FROM Account LIMIT 5 OFFSET 0", "OFFSET"],
  ["SELECT COUNT() FROM Account", "aggregate function COUNT"],
  ["SELECT COUNT(Id) FROM Account", "aggregate function COUNT"],
  ["SELECT count_distinct(Industry) FROM Account", "aggregate function COUNT_DISTINCT"],
  ["SELECT SUM(AnnualRevenue) FROM Account", "aggregate function SUM"],
  ["SELECT AVG(AnnualRevenue) FROM Account", "aggregate function AVG"],
  ["SELECT MIN(CreatedDate) FROM Account", "aggregate function MIN"],
  ["SELECT MAX(CreatedDate) FROM Account", "aggregate function MAX"],
  ["SELECT FIELDS(ALL) FROM Account LIMIT 200", "FIELDS()"],
  ["SELECT Id, (SELECT Id FROM Contacts) FROM Account", "parent-to-child relationship subqueries"],
  ["SELECT Id, BillingAddress FROM Account", "compound field BillingAddress"],
  ["SELECT Id, Account.BillingAddress FROM Contact", "compound field Account.BillingAddress"],
  ["SELECT a.ShippingAddress FROM Account a", "compound field a.ShippingAddress"],
];

const legal = [
  "SELECT Id, Name, Industry FROM Account WHERE Industry = 'Technology' ORDER BY Name LIMIT 10",
  "SELECT Id, Account.Name, Owner.Alias FROM Contact",
  "SELECT Id FROM Account WHERE Id IN (SELECT AccountId FROM Contact)",
  "SELECT Id, CALENDAR_YEAR(CreatedDate) FROM Account",
  "SELECT Id FROM Account WHERE CALENDAR_YEAR(CreatedDate) = 2026",
  "SELECT Id, toLabel(Industry) FROM Account",
  "SELECT Id, Name FROM Contact",
  "SELECT Id, BillingCity FROM Account",
  "SELECT Nope__c FROM Account",
];

describe("Bulk API 2.0 query restrictions", () => {
  it.each(violations)("rejects %s as %s", (soql, construct) => {
    const v = bulkQueryViolation(parseBulkQuery(soql), schema);
    expect(v).toEqual({ construct, message: `Bulk API 2.0 query jobs do not support ${construct}` });
  });

  it.each(legal)("accepts %s", (soql) => {
    expect(bulkQueryViolation(parseBulkQuery(soql), schema)).toBeUndefined();
  });

  it("rejects a Location field directly and through a parent path", () => {
    expect(bulkQueryViolation(parseBulkQuery("SELECT Site_Location__c FROM Account"), withLocation)?.construct).toBe(
      "compound field Site_Location__c",
    );
    expect(bulkQueryViolation(parseBulkQuery("SELECT Account.Site_Location__c FROM Contact"), withLocation)?.construct).toBe(
      "compound field Account.Site_Location__c",
    );
  });

  it("compound Name is not a Bulk violation", () => {
    expect(bulkQueryViolation(parseBulkQuery("SELECT Id, Name FROM Contact"), schema)).toBeUndefined();
  });

  it("messages carry no UNSUPPORTED marker", () => {
    for (const [soql] of violations) {
      const v = bulkQueryViolation(parseBulkQuery(soql), schema);
      expect(v?.message).toMatch(/^Bulk API 2\.0 query jobs do not support /);
      expect(v?.message).not.toContain("UNSUPPORTED:");
    }
  });

  it("a parse failure is a MALFORMED_QUERY SoqlError", () => {
    try {
      parseBulkQuery("SELEKT Id FROM Account");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SoqlError);
      expect((err as SoqlError).errorCode).toBe("MALFORMED_QUERY");
    }
  });
});
