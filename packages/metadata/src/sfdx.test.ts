import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSourceProject } from "./sfdx.js";

async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "orglet-sfdx-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    await mkdir(join(p, ".."), { recursive: true });
    await writeFile(p, content);
  }
  return root;
}

const field = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><CustomField xmlns="http://soap.sforce.com/2006/04/metadata">${body}</CustomField>`;

describe("readSourceProject", () => {
  it("falls back to scanning the directory when sfdx-project.json is absent", async () => {
    const root = await project({
      "objects/Foo__c/fields/Bar__c.field-meta.xml": field("<fullName>Bar__c</fullName><type>Text</type><length>10</length>"),
    });
    const p = await readSourceProject(root);
    expect(p.packageDirectories).toEqual([root]);
    expect(p.objects.map((o) => o.name)).toEqual(["Foo__c"]);
    expect(p.objects[0]?.fields[0]).toMatchObject({ fullName: "Bar__c", type: "Text", length: 10 });
  });

  it("keeps empty elements as empty strings rather than objects", async () => {
    const root = await project({
      "objects/Foo__c/fields/Bar__c.field-meta.xml": field("<fullName>Bar__c</fullName><type>Text</type><length>10</length><description/><inlineHelpText></inlineHelpText>"),
    });
    const p = await readSourceProject(root);
    expect(p.objects[0]?.fields[0]).toMatchObject({ description: "", inlineHelpText: "" });
  });

  it("parses a single picklist value as a one-element list", async () => {
    const root = await project({
      "objects/Foo__c/fields/P__c.field-meta.xml": field(
        "<fullName>P__c</fullName><type>Picklist</type><valueSet><restricted>true</restricted><valueSetDefinition><sorted>false</sorted><value><fullName>Only</fullName><default>true</default><label>Only</label></value></valueSetDefinition></valueSet>",
      ),
    });
    const p = await readSourceProject(root);
    expect(p.objects[0]?.fields[0]?.valueSet?.values).toEqual([{ value: "Only", label: "Only", default: true, active: true }]);
  });

  it("parses a COUNT roll-up with no summarized field and no filters", async () => {
    const root = await project({
      "objects/Foo__c/fields/Total__c.field-meta.xml": field(
        "<fullName>Total__c</fullName><label>Total</label><type>Summary</type><summaryForeignKey>Child__c.Parent__c</summaryForeignKey><summaryOperation>count</summaryOperation>",
      ),
    });
    const p = await readSourceProject(root);
    expect(p.objects[0]?.fields[0]).toEqual({
      fullName: "Total__c",
      label: "Total",
      type: "Summary",
      summaryForeignKey: "Child__c.Parent__c",
      summaryOperation: "count",
      summaryFilterItems: [],
    });
    expect(p.warnings).toEqual([]);
  });

  it("reads checkbox, blank and multi-token filter values even though <value> parses as an array", async () => {
    const item = (f: string, op: string, value: string) =>
      `<summaryFilterItems><field>${f}</field><operation>${op}</operation>${value}</summaryFilterItems>`;
    const root = await project({
      "objects/Foo__c/fields/Total__c.field-meta.xml": field(
        "<fullName>Total__c</fullName><type>Summary</type><summarizedField>Child__c.Amount__c</summarizedField>" +
          "<summaryForeignKey>Child__c.Parent__c</summaryForeignKey><summaryOperation>sum</summaryOperation>" +
          item("Child__c.Done__c", "equals", "<value>True</value>") +
          item("Child__c.Status__c", "notEqual", "<value/>") +
          item("Child__c.Status__c", "equals", '<value>Completed, "Closed, not Completed"</value>'),
      ),
    });
    const p = await readSourceProject(root);
    expect(p.objects[0]?.fields[0]).toMatchObject({
      summarizedField: "Child__c.Amount__c",
      summaryFilterItems: [
        { field: "Child__c.Done__c", operation: "equals", value: "True" },
        { field: "Child__c.Status__c", operation: "notEqual", value: "" },
        { field: "Child__c.Status__c", operation: "equals", value: 'Completed, "Closed, not Completed"' },
      ],
    });
  });

  it("treats a missing <value> as blank and keeps <valueField>", async () => {
    const root = await project({
      "objects/Foo__c/fields/Total__c.field-meta.xml": field(
        "<fullName>Total__c</fullName><type>Summary</type><summaryOperation>count</summaryOperation>" +
          "<summaryFilterItems><field>Child__c.Due__c</field><operation>greaterThan</operation><valueField>Child__c.Planned__c</valueField></summaryFilterItems>",
      ),
    });
    const p = await readSourceProject(root);
    expect(p.objects[0]?.fields[0]?.summaryFilterItems).toEqual([
      { field: "Child__c.Due__c", operation: "greaterThan", value: "", valueField: "Child__c.Planned__c" },
    ]);
  });

  it("still skips ExternalLookup with an UNSUPPORTED:field-type warning", async () => {
    const root = await project({
      "objects/Foo__c/fields/Ext__c.field-meta.xml": field("<fullName>Ext__c</fullName><type>ExternalLookup</type>"),
      "objects/Foo__c/fields/Bar__c.field-meta.xml": field("<fullName>Bar__c</fullName><type>Text</type><length>10</length>"),
    });
    const p = await readSourceProject(root);
    expect(p.objects[0]?.fields.map((f) => f.fullName)).toEqual(["Bar__c"]);
    expect(p.warnings).toEqual([expect.stringMatching(/^UNSUPPORTED:field-type .*ExternalLookup/)]);
  });

  it("reads Hierarchy fields as lookups", async () => {
    const root = await project({
      "objects/Account/fields/ParentId.field-meta.xml": field("<fullName>ParentId</fullName><type>Hierarchy</type>"),
    });
    const p = await readSourceProject(root);
    expect(p.objects[0]?.fields[0]).toMatchObject({ fullName: "ParentId", type: "Lookup" });
    expect(p.warnings).toEqual([]);
  });

  it("reads metadata-format object files with inlined fields and rules", async () => {
    const root = await project({
      "objects/Foo__c/Foo__c.object-meta.xml": `<?xml version="1.0" encoding="UTF-8"?>
<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">
  <label>Foo</label><pluralLabel>Foos</pluralLabel>
  <nameField><label>Foo Name</label><type>Text</type></nameField>
  <fields><fullName>A__c</fullName><type>Checkbox</type><defaultValue>false</defaultValue><label>A</label></fields>
  <validationRules><fullName>R</fullName><active>true</active><errorConditionFormula>A__c</errorConditionFormula><errorMessage>no</errorMessage></validationRules>
</CustomObject>`,
    });
    const p = await readSourceProject(root);
    expect(p.objects[0]).toMatchObject({ name: "Foo__c", label: "Foo", pluralLabel: "Foos", nameField: { label: "Foo Name", type: "Text" } });
    expect(p.objects[0]?.fields.map((f) => f.fullName)).toEqual(["A__c"]);
    expect(p.objects[0]?.validationRules[0]?.name).toBe("R");
  });
});
