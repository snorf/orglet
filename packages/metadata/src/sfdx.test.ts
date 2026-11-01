import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSourceProject } from "./sfdx.js";
import { formatDiagnostic } from "./diagnostics.js";

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

  it("records the skipped ExternalLookup as a field-type diagnostic beside the warning string", async () => {
    const root = await project({
      "objects/Foo__c/fields/Ext__c.field-meta.xml": field("<fullName>Ext__c</fullName><type>ExternalLookup</type>"),
    });
    const p = await readSourceProject(root);
    expect(p.diagnostics).toEqual([
      { area: "field-type", kind: "field", object: "Foo__c", field: "Ext__c", message: expect.stringContaining("field type ExternalLookup is not supported yet; field skipped") as string },
    ]);
    expect(p.warnings).toEqual((p.diagnostics ?? []).map(formatDiagnostic));
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

  it.each([
    ["self-closing", "<CustomObject xmlns=\"http://soap.sforce.com/2006/04/metadata\"/>"],
    ["open and close", "<CustomObject xmlns=\"http://soap.sforce.com/2006/04/metadata\"></CustomObject>"],
    ["whitespace-only", "<CustomObject xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n  \n</CustomObject>"],
  ])("treats an empty <CustomObject/> (%s) as an object with no metadata of its own, still reading its fields", async (_form, objectXml) => {
    // `sf project retrieve` writes these for standard objects when only their children were retrieved.
    const root = await project({
      "objects/Account/Account.object-meta.xml": `<?xml version="1.0" encoding="UTF-8"?>\n${objectXml}`,
      "objects/Account/fields/Foo__c.field-meta.xml": field("<fullName>Foo__c</fullName><type>Text</type><length>10</length>"),
    });
    const p = await readSourceProject(root);
    expect(p.objects).toHaveLength(1);
    expect(p.objects[0]?.name).toBe("Account");
    expect(p.objects[0]?.label).toBeUndefined();
    expect(p.objects[0]?.fields.map((f) => f.fullName)).toEqual(["Foo__c"]);
    expect(p.objects[0]?.validationRules).toEqual([]);
    expect(p.objects[0]?.recordTypes).toEqual([]);
    expect(p.warnings).toEqual([]);
  });

  it("names the object file when its root element is not <CustomObject>", async () => {
    const root = await project({
      "objects/Foo__c/Foo__c.object-meta.xml": field("<fullName>X__c</fullName>"),
    });
    await expect(readSourceProject(root)).rejects.toThrow(/Foo__c\.object-meta\.xml: Expected <CustomObject> root element, found: CustomField/);
  });
});

const NS = 'xmlns="http://soap.sforce.com/2006/04/metadata" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"';
const record = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><CustomMetadata ${NS}>${body}</CustomMetadata>`;
const labelsXml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><CustomLabels ${NS}>${body}</CustomLabels>`;
const objectXml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><CustomObject ${NS}>${body}</CustomObject>`;

describe("custom metadata, labels and settings (Phase 11)", () => {
  it("reads a record file: type from the file name plus __mdt, DeveloperName after the first dot, label and protected", async () => {
    const root = await project({
      "customMetadata/Support_Tier.Gold.md-meta.xml": record(
        '<label>Gold</label><protected>true</protected><values><field>Code__c</field><value xsi:type="xsd:string">007</value></values>',
      ),
    });
    const p = await readSourceProject(root);
    expect(p.customMetadata).toEqual([
      { type: "Support_Tier__mdt", developerName: "Gold", label: "Gold", protected: true, values: [{ field: "Code__c", value: "007" }], file: join(root, "customMetadata/Support_Tier.Gold.md-meta.xml") },
    ]);
  });

  it("xsi:nil with and without a space, an empty value and a values entry without value all read as an empty string", async () => {
    const root = await project({
      "customMetadata/T.R.md-meta.xml": record(
        '<label>R</label><values><field>A__c</field><value xsi:nil="true"/></values><values><field>B__c</field><value xsi:nil="true" /></values>' +
          '<values><field>C__c</field><value xsi:type="xsd:string"></value></values><values><field>D__c</field></values>',
      ),
    });
    const p = await readSourceProject(root);
    expect(p.customMetadata?.[0]?.values).toEqual([
      { field: "A__c", value: "" },
      { field: "B__c", value: "" },
      { field: "C__c", value: "" },
      { field: "D__c", value: "" },
    ]);
  });

  it("a multi-line value element with attributes on their own lines reads its text", async () => {
    const root = await project({
      "customMetadata/T.R.md-meta.xml": record('<label>R</label><values><field>A__c</field><value\n    xsi:type="xsd:string"\n>Ticket__c</value></values>'),
    });
    const p = await readSourceProject(root);
    expect(p.customMetadata?.[0]?.values).toEqual([{ field: "A__c", value: "Ticket__c" }]);
  });

  it("a record without <label> takes its DeveloperName and protected defaults to false", async () => {
    const root = await project({ "customMetadata/T.Dev_Name.md-meta.xml": record("") });
    const p = await readSourceProject(root);
    expect(p.customMetadata?.[0]).toMatchObject({ label: "Dev_Name", protected: false, values: [] });
  });

  it("a record file name without a dot is skipped with one custom-metadata-record warning", async () => {
    const root = await project({ "customMetadata/Broken.md-meta.xml": record("<label>x</label>") });
    const p = await readSourceProject(root);
    expect(p.customMetadata).toEqual([]);
    expect(p.warnings).toHaveLength(1);
    expect(p.warnings[0]).toMatch(/^UNSUPPORTED:custom-metadata-record .*Broken\.md-meta\.xml: file name is not <Type>\.<Record>\.md-meta\.xml; record skipped$/);
  });

  it("reads a single label as a one-element list and decodes entities", async () => {
    const root = await project({
      "labels/CustomLabels.labels-meta.xml": labelsXml(
        "<labels><fullName>Terms_Link_Text</fullName><language>en_US</language><protected>true</protected><shortDescription>Terms link</shortDescription><value>Terms &amp; Conditions &lt;v2&gt;</value></labels>",
      ),
    });
    const p = await readSourceProject(root);
    expect(p.labels).toEqual([{ fullName: "Terms_Link_Text", value: "Terms & Conditions <v2>", language: "en_US", protected: true, shortDescription: "Terms link" }]);
  });

  it("reads several labels in file order with categories; a missing language defaults to en_US", async () => {
    const root = await project({
      "labels/CustomLabels.labels-meta.xml": labelsXml(
        "<labels><fullName>B_One</fullName><value>1</value><categories>a,b</categories><protected>false</protected></labels><labels><fullName>A_Two</fullName><value>2</value><protected>false</protected></labels>",
      ),
    });
    const p = await readSourceProject(root);
    expect(p.labels).toEqual([
      { fullName: "B_One", value: "1", language: "en_US", categories: "a,b", protected: false },
      { fullName: "A_Two", value: "2", language: "en_US", protected: false },
    ]);
  });

  it("customSettingsType List and Hierarchy are read; an empty element means Hierarchy; another value warns and loads as an ordinary object", async () => {
    const root = await project({
      "objects/L__c/L__c.object-meta.xml": objectXml("<customSettingsType>List</customSettingsType>"),
      "objects/H__c/H__c.object-meta.xml": objectXml("<customSettingsType>Hierarchy</customSettingsType>"),
      "objects/E__c/E__c.object-meta.xml": objectXml("<customSettingsType/>"),
      "objects/Odd__c/Odd__c.object-meta.xml": objectXml("<customSettingsType>Weird</customSettingsType>"),
    });
    const p = await readSourceProject(root);
    const byName = Object.fromEntries(p.objects.map((o) => [o.name, o.customSettingsType]));
    expect(byName).toEqual({ E__c: "Hierarchy", H__c: "Hierarchy", L__c: "List", Odd__c: undefined });
    expect(p.warnings).toEqual([
      `UNSUPPORTED:custom-setting ${join(root, "objects/Odd__c/Odd__c.object-meta.xml")}: customSettingsType Weird is not List or Hierarchy; Odd__c loaded as an ordinary custom object`,
    ]);
  });

  it("a MetadataRelationship field loads with its referenceTo and its metadataRelationshipControllingField as written, and no field-type warning", async () => {
    const root = await project({
      "objects/T__mdt/fields/F__c.field-meta.xml": field(
        "<fullName>F__c</fullName><type>MetadataRelationship</type><referenceTo>FieldDefinition</referenceTo><metadataRelationshipControllingField>X__mdt.Y__c</metadataRelationshipControllingField>",
      ),
    });
    const p = await readSourceProject(root);
    expect(p.objects[0]?.fields).toEqual([{ fullName: "F__c", type: "MetadataRelationship", referenceTo: "FieldDefinition", metadataRelationshipControllingField: "X__mdt.Y__c" }]);
    expect(p.warnings.filter((w) => w.includes("field-type"))).toEqual([]);
  });
});
