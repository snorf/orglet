import { beforeAll, describe, expect, it } from "vitest";
import { buildOrgSchema, loadBaseline, type Baseline, type FieldDef, type FieldType, type OrgSchema, type SObjectDef, type SourceField, type SourceFilterItem, type SourceObject } from "@orglet/metadata";
import { rollupBackfillSql, rollupDepth, rollupSelectSql } from "./rollup.js";

// Same in-memory Parent__c/Child__c shape as packages/metadata/src/build.test.ts (test files are not imported across packages).
const sourceField = (fullName: string, type: FieldType, extra: Partial<SourceField> = {}): SourceField => ({ fullName, label: fullName, type, ...extra });
const sourceObject = (name: string, fields: SourceField[]): SourceObject => ({ name, fields, validationRules: [], recordTypes: [] });
const picklist = (fullName: string, ...values: string[]): SourceField =>
  sourceField(fullName, "Picklist", { valueSet: { restricted: false, values: values.map((v) => ({ value: v, label: v, default: false, active: true })) } });
const filter = (field: string, operation: string, value: string, valueField?: string): SourceFilterItem => ({ field, operation, value, ...(valueField !== undefined ? { valueField } : {}) });
const summary = (fullName: string, op: string, fk: string, summarized?: string, filters?: SourceFilterItem[]): SourceField => ({
  fullName,
  label: fullName,
  type: "Summary",
  summaryForeignKey: fk,
  summaryOperation: op,
  ...(summarized !== undefined ? { summarizedField: summarized } : {}),
  ...(filters !== undefined ? { summaryFilterItems: filters } : {}),
});
const childFields = (): SourceField[] => [
  sourceField("Parent__c", "MasterDetail", { referenceTo: "Parent__c", relationshipName: "Children" }),
  sourceField("Amount__c", "Currency", { precision: 16, scale: 2 }),
  sourceField("Qty__c", "Number", { precision: 10, scale: 0 }),
  sourceField("Due__c", "Date"),
  sourceField("Planned__c", "Date"),
  sourceField("Stamp__c", "DateTime"),
  sourceField("Done__c", "Checkbox"),
  picklist("Status__c", "Open", "Closed"),
  sourceField("Tag__c", "Text", { length: 40 }),
];

const PARENT_ROLLUPS: SourceField[] = [
  summary("Child_Count__c", "count", "Child__c.Parent__c"),
  summary("Total__c", "sum", "Child__c.Parent__c", "Child__c.Amount__c"),
  summary("Last_Stamp__c", "max", "Child__c.Parent__c", "Child__c.Stamp__c"),
  summary("First_Due__c", "min", "Child__c.Parent__c", "Child__c.Due__c"),
  summary("Done_Count__c", "count", "Child__c.Parent__c", undefined, [filter("Child__c.Done__c", "equals", "True")]),
  summary("Status_Count__c", "count", "Child__c.Parent__c", undefined, [filter("Child__c.Status__c", "equals", "Open, Closed")]),
  summary("Not_Status_Count__c", "count", "Child__c.Parent__c", undefined, [filter("Child__c.Status__c", "notEqual", "Open, Closed")]),
  summary("Untagged_Count__c", "count", "Child__c.Parent__c", undefined, [filter("Child__c.Tag__c", "equals", "")]),
  summary("Has_Due_Count__c", "count", "Child__c.Parent__c", undefined, [filter("Child__c.Due__c", "notEqual", "")]),
  summary("Qty_Count__c", "count", "Child__c.Parent__c", undefined, [filter("Child__c.Qty__c", "equals", "1, 2")]),
  summary("Due_Count__c", "count", "Child__c.Parent__c", undefined, [filter("Child__c.Due__c", "equals", "2026-01-01")]),
  summary("Stamp_Count__c", "count", "Child__c.Parent__c", undefined, [filter("Child__c.Stamp__c", "equals", "2026-01-01T10:00:00.000Z")]),
  summary("Big_Qty_Count__c", "count", "Child__c.Parent__c", undefined, [filter("Child__c.Qty__c", "greaterOrEqual", "5")]),
  summary("Early_Count__c", "count", "Child__c.Parent__c", undefined, [filter("Child__c.Due__c", "lessThan", "2026-06-01")]),
  summary("Contains_Count__c", "count", "Child__c.Parent__c", undefined, [filter("Child__c.Tag__c", "contains", "x_")]),
  summary("Starts_Count__c", "count", "Child__c.Parent__c", undefined, [filter("Child__c.Tag__c", "startsWith", "al")]),
  summary("Not_Contains_Count__c", "count", "Child__c.Parent__c", undefined, [filter("Child__c.Tag__c", "notContain", "z")]),
  summary("Slipped_Count__c", "count", "Child__c.Parent__c", undefined, [filter("Child__c.Due__c", "greaterThan", "", "Child__c.Planned__c")]),
  summary("Same_Tag_Count__c", "count", "Child__c.Parent__c", undefined, [filter("Child__c.Tag__c", "equals", "", "Child__c.Status__c")]),
  summary("Moved_Count__c", "count", "Child__c.Parent__c", undefined, [filter("Child__c.Due__c", "notEqual", "", "Child__c.Planned__c")]),
  summary("Two_Filters__c", "sum", "Child__c.Parent__c", "Child__c.Amount__c", [filter("Child__c.Done__c", "equals", "False"), filter("Child__c.Qty__c", "greaterThan", "1")]),
];

const ID = "a01000000000001AAA";
const COUNT_ALL = `(SELECT COUNT(*) FROM "org"."child__c" c WHERE c."parent__c" = p."id" AND c."isdeleted" = false)`;
const FROM = `FROM "org"."parent__c" p WHERE p."id" = ANY($1) AND p."isdeleted" = false`;

let schema: OrgSchema;
let parent: SObjectDef;
const field = (name: string): FieldDef => {
  const f = schema.getField("Parent__c", name);
  if (!f) throw new Error(`missing ${name}`);
  return f;
};
const select = (...names: string[]) => rollupSelectSql("org", schema, parent, names.map(field), [ID]);
/** The filter clause of a single-roll-up select: everything after the base COUNT predicate. */
const filterOf = (name: string): string => {
  const { sql } = select(name);
  const m = /c\."isdeleted" = false (AND .*)\) AS /.exec(sql);
  if (!m?.[1]) throw new Error(`no filter in ${sql}`);
  return m[1];
};

describe("rollupSelectSql", () => {
  beforeAll(async () => {
    const baseline: Baseline = await loadBaseline();
    const r = buildOrgSchema(baseline, { rootDir: "", packageDirectories: [], objects: [sourceObject("Parent__c", PARENT_ROLLUPS), sourceObject("Child__c", childFields())], globalValueSets: [], standardValueSets: [], warnings: [] });
    expect(r.warnings.filter((w) => w.startsWith("UNSUPPORTED:rollup"))).toEqual([]);
    schema = r.schema;
    parent = schema.getObject("Parent__c") as SObjectDef;
  });

  it("COUNT without filters is a correlated count over non-deleted children keyed by the parent ids", () => {
    const { sql, params } = select("Child_Count__c");
    expect(sql).toBe(`SELECT p."id" AS "Id", ${COUNT_ALL} AS "Child_Count__c" ${FROM}`);
    expect(params).toEqual([[ID]]);
  });

  it("SUM coalesces an empty child set to 0; MIN and MAX stay NULL", () => {
    expect(select("Total__c").sql).toContain(`COALESCE((SELECT SUM(c."amount__c") FROM "org"."child__c" c WHERE c."parent__c" = p."id" AND c."isdeleted" = false), 0) AS "Total__c"`);
    expect(select("Last_Stamp__c").sql).toContain(`(SELECT MAX(c."stamp__c") FROM "org"."child__c" c WHERE c."parent__c" = p."id" AND c."isdeleted" = false) AS "Last_Stamp__c"`);
    expect(select("First_Due__c").sql).toContain(`(SELECT MIN(c."due__c") FROM "org"."child__c" c WHERE c."parent__c" = p."id" AND c."isdeleted" = false) AS "First_Due__c"`);
    expect(select("Last_Stamp__c").sql).not.toContain("COALESCE");
  });

  it("several roll-ups in one select appear in field order with the field name as alias", () => {
    const { sql, params } = select("Child_Count__c", "Total__c");
    expect(sql).toBe(
      `SELECT p."id" AS "Id", ${COUNT_ALL} AS "Child_Count__c", COALESCE((SELECT SUM(c."amount__c") FROM "org"."child__c" c WHERE c."parent__c" = p."id" AND c."isdeleted" = false), 0) AS "Total__c" ${FROM}`,
    );
    expect(params).toEqual([[ID]]);
  });

  it("checkbox equals binds a boolean parameter", () => {
    expect(filterOf("Done_Count__c")).toBe(`AND c."done__c" = $2::boolean`);
    expect(select("Done_Count__c").params[1]).toBe(true);
  });

  it("text equals with several tokens is a case-insensitive ANY over lower-cased tokens", () => {
    expect(filterOf("Status_Count__c")).toBe(`AND lower(c."status__c") = ANY($2::text[])`);
    expect(select("Status_Count__c").params[1]).toEqual(["open", "closed"]);
  });

  it("text notEqual counts NULL as not equal", () => {
    expect(filterOf("Not_Status_Count__c")).toBe(`AND (c."status__c" IS NULL OR NOT (lower(c."status__c") = ANY($2::text[])))`);
  });

  it("blank equals on text matches NULL and empty string; blank notEqual on a date is IS NOT NULL", () => {
    expect(filterOf("Untagged_Count__c")).toBe(`AND (c."tag__c" IS NULL OR c."tag__c" = '')`);
    expect(select("Untagged_Count__c").params).toEqual([[ID]]);
    expect(filterOf("Has_Due_Count__c")).toBe(`AND c."due__c" IS NOT NULL`);
    expect(select("Has_Due_Count__c").params).toEqual([[ID]]);
  });

  it("number, date and datetime equals cast the token array to the column type", () => {
    expect(filterOf("Qty_Count__c")).toBe(`AND c."qty__c" = ANY($2::numeric[])`);
    expect(select("Qty_Count__c").params[1]).toEqual([1, 2]);
    expect(filterOf("Due_Count__c")).toBe(`AND c."due__c" = ANY($2::date[])`);
    expect(select("Due_Count__c").params[1]).toEqual(["2026-01-01"]);
    expect(filterOf("Stamp_Count__c")).toBe(`AND c."stamp__c" = ANY($2::timestamptz[])`);
    expect(select("Stamp_Count__c").params[1]).toEqual(["2026-01-01T10:00:00.000Z"]);
  });

  it("range operators bind one typed scalar parameter", () => {
    expect(filterOf("Big_Qty_Count__c")).toBe(`AND c."qty__c" >= $2::numeric`);
    expect(select("Big_Qty_Count__c").params[1]).toBe(5);
    expect(filterOf("Early_Count__c")).toBe(`AND c."due__c" < $2::date`);
    expect(select("Early_Count__c").params[1]).toBe("2026-06-01");
  });

  it("contains, startsWith and notContain use ILIKE with backslash-escaped wildcards", () => {
    expect(filterOf("Contains_Count__c")).toBe(`AND c."tag__c" ILIKE ANY($2::text[])`);
    expect(select("Contains_Count__c").params[1]).toEqual(["%x\\_%"]);
    expect(filterOf("Starts_Count__c")).toBe(`AND c."tag__c" ILIKE ANY($2::text[])`);
    expect(select("Starts_Count__c").params[1]).toEqual(["al%"]);
    expect(filterOf("Not_Contains_Count__c")).toBe(`AND (c."tag__c" IS NULL OR NOT (c."tag__c" ILIKE ANY($2::text[])))`);
    expect(select("Not_Contains_Count__c").params[1]).toEqual(["%z%"]);
  });

  it("valueField comparisons compare two child columns without parameters", () => {
    expect(filterOf("Slipped_Count__c")).toBe(`AND c."due__c" > c."planned__c"`);
    expect(select("Slipped_Count__c").params).toEqual([[ID]]);
    expect(filterOf("Same_Tag_Count__c")).toBe(`AND lower(c."tag__c") = lower(c."status__c")`);
    expect(filterOf("Moved_Count__c")).toBe(`AND c."due__c" IS DISTINCT FROM c."planned__c"`);
  });

  it("two filters on one roll-up number their placeholders in filter order", () => {
    const { sql, params } = select("Two_Filters__c");
    expect(sql).toContain(`COALESCE((SELECT SUM(c."amount__c") FROM "org"."child__c" c WHERE c."parent__c" = p."id" AND c."isdeleted" = false AND c."done__c" = $2::boolean AND c."qty__c" > $3::numeric), 0) AS "Two_Filters__c"`);
    expect(params).toEqual([[ID], false, 1]);
  });

  it("throws for a field that is not a roll-up", () => {
    expect(() => rollupSelectSql("org", schema, parent, [field("Name")], [ID])).toThrow(/Name/);
  });
});

describe("rollupBackfillSql", () => {
  it("updates every parent row from the same aggregate, with no parameters when unfiltered", () => {
    const { sql, params } = rollupBackfillSql("org", schema, parent, field("Child_Count__c"));
    expect(sql).toBe(`UPDATE "org"."parent__c" AS p SET "child_count__c" = ${COUNT_ALL}`);
    expect(params).toEqual([]);
  });

  it("a filtered backfill numbers its parameters from $1", () => {
    const { sql, params } = rollupBackfillSql("org", schema, parent, field("Two_Filters__c"));
    expect(sql).toBe(
      `UPDATE "org"."parent__c" AS p SET "two_filters__c" = COALESCE((SELECT SUM(c."amount__c") FROM "org"."child__c" c WHERE c."parent__c" = p."id" AND c."isdeleted" = false AND c."done__c" = $1::boolean AND c."qty__c" > $2::numeric), 0)`,
    );
    expect(params).toEqual([false, 1]);
  });
});

describe("rollupDepth", () => {
  it("is 0 for a plain field, 1 for a roll-up over plain fields, and one more per roll-up level in a chain", async () => {
    const baseline = await loadBaseline();
    const grand = sourceObject("Grand__c", [summary("Total__c", "sum", "Parent__c.Grand__c", "Parent__c.Total__c")]);
    const parentObj = sourceObject("Parent__c", [
      sourceField("Grand__c", "MasterDetail", { referenceTo: "Grand__c", relationshipName: "Parents" }),
      summary("Total__c", "sum", "Child__c.Parent__c", "Child__c.Amount__c"),
      summary("Child_Count__c", "count", "Child__c.Parent__c"),
    ]);
    const r = buildOrgSchema(baseline, { rootDir: "", packageDirectories: [], objects: [grand, parentObj, sourceObject("Child__c", childFields())], globalValueSets: [], standardValueSets: [], warnings: [] });
    const s = r.schema;
    expect(rollupDepth(s, s.getField("Child__c", "Amount__c") as FieldDef)).toBe(0);
    expect(rollupDepth(s, s.getField("Parent__c", "Child_Count__c") as FieldDef)).toBe(1);
    expect(rollupDepth(s, s.getField("Parent__c", "Total__c") as FieldDef)).toBe(1);
    expect(rollupDepth(s, s.getField("Grand__c", "Total__c") as FieldDef)).toBe(2);
  });
});
