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

  it("skips roll-up summary fields with an UNSUPPORTED warning and keeps loading", async () => {
    const root = await project({
      "objects/Foo__c/fields/Total__c.field-meta.xml": field("<fullName>Total__c</fullName><type>Summary</type><summaryOperation>count</summaryOperation>"),
      "objects/Foo__c/fields/Bar__c.field-meta.xml": field("<fullName>Bar__c</fullName><type>Text</type><length>10</length>"),
    });
    const p = await readSourceProject(root);
    expect(p.objects[0]?.fields.map((f) => f.fullName)).toEqual(["Bar__c"]);
    expect(p.warnings).toEqual([expect.stringMatching(/^UNSUPPORTED:field-type .*Total__c.*Summary/)]);
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
