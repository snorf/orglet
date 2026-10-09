import { describe, expect, it, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { buildOrgSchema, loadBaseline, loadOrgSchema, readSourceProject, type Baseline, type BuildResult, type FieldType, type SourceField, type SourceFilterItem, type SourceObject } from "./index.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));

const SYSTEM_FIELDS = ["Id", "IsDeleted", "CreatedDate", "CreatedById", "LastModifiedDate", "LastModifiedById", "SystemModstamp"];
/** Objects the Object Reference gives no name-equivalent field (D-02); adding one must be a conscious act. */
const NO_NAME_FIELD = ["OpportunityHistory"];
/** 03-RESEARCH.md Fact Table as amended by CONTEXT D-03a. extra = fields beyond system fields and OwnerId. */
const THIN: Record<
  string,
  { keyPrefix: string; hasOwner: boolean; createable: boolean; updateable: boolean; deletable: boolean; undeletable: boolean; searchable: boolean; nameField: string | null; extra: string[] }
> = {
  BusinessHours: { keyPrefix: "01m", hasOwner: false, createable: true, updateable: true, deletable: false, undeletable: false, searchable: true, nameField: "Name", extra: ["Name", "IsActive", "IsDefault"] },
  BusinessProcess: { keyPrefix: "019", hasOwner: false, createable: true, updateable: true, deletable: false, undeletable: false, searchable: false, nameField: "Name", extra: ["Name"] },
  CallCenter: { keyPrefix: "04v", hasOwner: false, createable: true, updateable: false, deletable: false, undeletable: false, searchable: false, nameField: "Name", extra: ["Name"] },
  DandBCompany: { keyPrefix: "06E", hasOwner: false, createable: true, updateable: true, deletable: true, undeletable: true, searchable: true, nameField: "Name", extra: ["Name"] },
  Entitlement: { keyPrefix: "550", hasOwner: false, createable: true, updateable: true, deletable: true, undeletable: true, searchable: true, nameField: "Name", extra: ["Name"] },
  ExternalDataSource: { keyPrefix: "0XC", hasOwner: false, createable: false, updateable: false, deletable: false, undeletable: false, searchable: false, nameField: "DeveloperName", extra: ["DeveloperName"] },
  IdeaTheme: { keyPrefix: "0Bg", hasOwner: false, createable: true, updateable: true, deletable: true, undeletable: true, searchable: true, nameField: "Title", extra: ["Title"] },
  Individual: { keyPrefix: "0PK", hasOwner: true, createable: true, updateable: true, deletable: true, undeletable: true, searchable: true, nameField: "Name", extra: ["Name", "FirstName", "LastName"] },
  OperatingHours: { keyPrefix: "0OH", hasOwner: true, createable: true, updateable: true, deletable: true, undeletable: true, searchable: true, nameField: "Name", extra: ["Name"] },
  OpportunityHistory: { keyPrefix: "008", hasOwner: false, createable: false, updateable: false, deletable: false, undeletable: false, searchable: false, nameField: null, extra: [] },
  ServiceAppointment: { keyPrefix: "08p", hasOwner: true, createable: true, updateable: true, deletable: true, undeletable: true, searchable: true, nameField: "AppointmentNumber", extra: ["AppointmentNumber"] },
  ServiceContract: { keyPrefix: "810", hasOwner: true, createable: true, updateable: true, deletable: true, undeletable: true, searchable: true, nameField: "Name", extra: ["Name"] },
  SocialPost: { keyPrefix: "0ST", hasOwner: true, createable: true, updateable: true, deletable: true, undeletable: true, searchable: true, nameField: "Name", extra: ["Name"] },
  UserLicense: { keyPrefix: "100", hasOwner: false, createable: false, updateable: false, deletable: false, undeletable: false, searchable: false, nameField: "Name", extra: ["Name", "MasterLabel"] },
};

describe("standard baseline alone", () => {
  let result: BuildResult;
  beforeAll(async () => {
    result = await loadOrgSchema();
  });

  it("loads the phase-0 standard objects with their key prefixes", () => {
    const prefixes = Object.fromEntries(result.schema.list().map((o) => [o.name, o.keyPrefix]));
    expect(prefixes).toMatchObject({
      Account: "001",
      Contact: "003",
      Opportunity: "006",
      Contract: "800",
      Lead: "00Q",
      Case: "500",
      User: "005",
      Organization: "00D",
      Profile: "00e",
      RecordType: "012",
    });
  });

  it("adds system fields once and never lets the baseline redefine them", () => {
    for (const obj of result.schema.list()) {
      const names = obj.fields.map((f) => f.name);
      for (const sys of ["Id", "IsDeleted", "CreatedDate", "CreatedById", "LastModifiedDate", "LastModifiedById", "SystemModstamp"]) {
        expect(names.filter((n) => n === sys), `${obj.name}.${sys}`).toHaveLength(1);
      }
      expect(names.filter((n) => n === "OwnerId"), `${obj.name}.OwnerId`).toHaveLength(obj.hasOwner ? 1 : 0);
      expect(new Set(names.map((n) => n.toLowerCase())).size, `${obj.name} duplicate fields`).toBe(names.length);
    }
  });

  it("marks exactly one name field per object, except the objects the reference gives none", () => {
    for (const obj of result.schema.list()) {
      expect(obj.fields.filter((f) => f.nameField).map((f) => f.name), obj.name).toHaveLength(NO_NAME_FIELD.includes(obj.name) ? 0 : 1);
    }
    expect(result.schema.list().filter((o) => !o.fields.some((f) => f.nameField)).map((o) => o.name)).toEqual(NO_NAME_FIELD);
  });

  it("thin: each of the 14 objects loads with its documented key prefix, owner and DML flags", () => {
    expect(Object.keys(THIN)).toHaveLength(14);
    for (const [name, f] of Object.entries(THIN)) {
      expect(result.schema.getObject(name), name).toMatchObject({
        name,
        custom: false,
        queryable: true,
        keyPrefix: f.keyPrefix,
        hasOwner: f.hasOwner,
        createable: f.createable,
        updateable: f.updateable,
        deletable: f.deletable,
        undeletable: f.undeletable,
        searchable: f.searchable,
      });
    }
  });

  it("thin: each of the 14 objects has its documented name field, or none for OpportunityHistory", () => {
    for (const [name, f] of Object.entries(THIN)) {
      const obj = result.schema.getObject(name);
      expect(obj?.fields.filter((x) => x.nameField).map((x) => x.name), name).toEqual(f.nameField === null ? [] : [f.nameField]);
    }
  });

  it("thin: each of the 14 objects carries only Id, the system fields, OwnerId when owned and its name, seed or compound fields", () => {
    for (const [name, f] of Object.entries(THIN)) {
      const obj = result.schema.getObject(name);
      expect(obj?.fields.map((x) => x.name).sort(), name).toEqual([...SYSTEM_FIELDS, ...(f.hasOwner ? ["OwnerId"] : []), ...f.extra].sort());
    }
  });

  it("thin: field details follow the Object Reference", () => {
    const g = (o: string, f: string) => result.schema.getField(o, f);
    expect(g("Individual", "Name")).toMatchObject({ type: "Name", nameField: true, createable: false, updateable: false });
    expect(g("Individual", "FirstName")).toMatchObject({ compoundFieldName: "Name", nameField: false, nillable: true });
    expect(g("Individual", "LastName")).toMatchObject({ compoundFieldName: "Name", nillable: false });
    expect(g("ServiceAppointment", "AppointmentNumber")).toMatchObject({
      type: "AutoNumber",
      displayFormat: "{00000000}",
      idLookup: true,
      createable: false,
      updateable: false,
      defaultedOnCreate: true,
    });
    expect(g("CallCenter", "Name")).toMatchObject({ createable: true, updateable: false, idLookup: true });
    expect(g("UserLicense", "Name")).toMatchObject({ idLookup: true, createable: false, updateable: false, nillable: false });
    expect(g("UserLicense", "MasterLabel")).toMatchObject({ nameField: false, createable: false, updateable: false, nillable: false });
    expect(g("ExternalDataSource", "DeveloperName")).toMatchObject({ createable: false, updateable: false, idLookup: false });
    expect(g("Entitlement", "Name")).toMatchObject({ groupable: false, sortable: false, idLookup: false });
    expect(g("IdeaTheme", "Title")).toMatchObject({ idLookup: true, nillable: false });
    for (const n of ["IsActive", "IsDefault"]) expect(g("BusinessHours", n)).toMatchObject({ type: "Checkbox", nillable: false, defaultValue: "false" });
  });

  it("reference: the baseline defines every reference target, so no reference-target warning remains", () => {
    expect(result.warnings.filter((w) => w.startsWith("UNSUPPORTED:reference-target"))).toEqual([]);
  });

  it("resolves standard picklists from standard value sets", () => {
    const stage = result.schema.getField("Opportunity", "StageName");
    expect(stage?.picklist?.valueSetName).toBe("OpportunityStage");
    const won = stage?.picklist?.values.find((v) => v.value === "Closed Won");
    expect(won).toMatchObject({ probability: 100, closed: true, won: true });
    expect(result.schema.getField("Account", "Industry")?.picklist?.values.length).toBeGreaterThan(5);
  });

  it("looks objects and fields up case-insensitively", () => {
    expect(result.schema.getObject("ACCOUNT")?.name).toBe("Account");
    expect(result.schema.getField("account", "billingcity")?.name).toBe("BillingCity");
  });

  it("derives child relationships from lookups", () => {
    const contacts = result.schema.childRelationships("Account").find((c) => c.childSObject === "Contact" && c.field === "AccountId");
    expect(contacts?.relationshipName).toBe("Contacts");
  });
});

describe("examples/acme merged onto the baseline", () => {
  let result: BuildResult;
  beforeAll(async () => {
    result = await loadOrgSchema({ projectDir: ACME });
  });

  it("assigns provisional custom key prefixes in name order", () => {
    expect(result.schema.getObject("BigTable__c")?.keyPrefix).toBe("a00");
    expect(result.schema.getObject("Milestone__c")?.keyPrefix).toBe("a01");
    expect(result.schema.getObject("Project__c")?.keyPrefix).toBe("a02");
  });

  it("gives master-detail children no owner and a cascading, required parent field", () => {
    const project = result.schema.getObject("Project__c");
    expect(project?.hasOwner).toBe(false);
    expect(project?.fields.some((f) => f.name === "OwnerId")).toBe(false);
    const account = result.schema.getField("Project__c", "Account__c");
    expect(account).toMatchObject({
      type: "MasterDetail",
      nillable: false,
      referenceTo: ["Account"],
      relationshipName: "Account__r",
      childRelationshipName: "Projects__r",
      deleteConstraint: "Cascade",
    });
    expect(result.schema.childRelationships("Account")).toContainEqual({
      childSObject: "Project__c",
      field: "Account__c",
      relationshipName: "Projects__r",
      cascadeDelete: true,
      restrictedDelete: false,
    });
  });

  it("builds the custom object's Name field from nameField, including AutoNumber", () => {
    expect(result.schema.getField("Project__c", "Name")).toMatchObject({ type: "Text", length: 80, nillable: false, nameField: true, label: "Project Name" });
    expect(result.schema.getField("Milestone__c", "Name")).toMatchObject({
      type: "AutoNumber",
      displayFormat: "MS-{0000}",
      createable: false,
      updateable: false,
      nameField: true,
    });
  });

  it("adds custom fields to standard objects and resolves global value sets", () => {
    const tier = result.schema.getField("Account", "Tier__c");
    expect(tier?.custom).toBe(true);
    expect(tier?.picklist).toMatchObject({ restricted: true, valueSetName: "Tier" });
    expect(tier?.picklist?.values.map((v) => v.value)).toEqual(["Gold", "Silver", "Bronze"]);
    expect(result.schema.getField("Account", "Customer_Number__c")).toMatchObject({ unique: true, externalId: true, idLookup: true, length: 20 });
  });

  it("applies standard-field overrides without changing the field's type", () => {
    const industry = result.schema.getField("Account", "Industry");
    expect(industry?.type).toBe("Picklist");
    expect(industry?.inlineHelpText).toBe("Primary industry of the account.");
    expect(industry?.picklist?.values.map((v) => v.value)).toEqual(["Telecommunications", "Energy", "Other"]);
  });

  it("treats formula fields as calculated and read-only", () => {
    expect(result.schema.getField("Opportunity", "Weighted_Amount__c")).toMatchObject({
      type: "Currency",
      formula: "Amount * Probability / 100",
      formulaTreatBlanksAs: "BlankAsZero",
      createable: false,
      updateable: false,
    });
    expect(result.schema.getField("Project__c", "Is_Overdue__c")?.formula).toContain("TODAY()");
  });

  it("loads validation rules and record types", () => {
    const account = result.schema.getObject("Account");
    expect(account?.validationRules).toEqual([
      expect.objectContaining({
        name: "Website_Required_For_Customers",
        active: true,
        errorDisplayField: "Website",
        errorConditionFormula: 'AND(ISPICKVAL(Type, "Customer - Direct"), ISBLANK(Website))',
      }),
    ]);
    const project = result.schema.getObject("Project__c");
    expect(project?.recordTypes.map((r) => r.name).sort()).toEqual(["External", "Internal"]);
    expect(project?.recordTypes.find((r) => r.name === "Internal")?.picklistValues[0]?.values.map((v) => v.value)).toEqual(["Planned", "Done"]);
  });

  it("acme roll-ups resolve into read-only stored fields of the aggregate's type", () => {
    const f = (o: string, n: string) => result.schema.getField(o, n);
    expect(f("Project__c", "Milestone_Count__c")).toMatchObject({
      type: "Number",
      precision: 18,
      scale: 0,
      createable: false,
      updateable: false,
      rollup: { childObject: "Milestone__c", foreignKey: "Project__c", operation: "COUNT", filters: [] },
    });
    expect(f("Project__c", "Open_Milestones__c")?.rollup?.filters).toEqual([{ field: "Done__c", operation: "equals", values: ["false"] }]);
    expect(f("Project__c", "Next_Due_Date__c")).toMatchObject({ type: "Date", rollup: { operation: "MIN", summarizedField: "Due_Date__c" } });
    expect(f("Account", "Total_Budget__c")).toMatchObject({
      type: "Currency",
      precision: 18,
      scale: 2,
      rollup: {
        childObject: "Project__c",
        foreignKey: "Account__c",
        operation: "SUM",
        summarizedField: "Budget__c",
        filters: [{ field: "Status__c", operation: "notEqual", values: ["Done"] }],
      },
    });
    expect(f("Account", "Open_Project_Milestones__c")).toMatchObject({ type: "Number", rollup: { summarizedField: "Open_Milestones__c" } });
    expect(f("Account", "Last_Active_Project_Created__c")).toMatchObject({ type: "DateTime", rollup: { operation: "MAX", summarizedField: "CreatedDate" } });
    expect(result.warnings).toEqual([]);
    expect(result.schema.getObject("Project__c")?.validationRules.map((r) => r.name)).toContain("Milestone_Limit");
  });

  it("carries defaults and required flags", () => {
    expect(result.schema.getField("Milestone__c", "Due_Date__c")?.nillable).toBe(false);
    expect(result.schema.getField("Milestone__c", "Sort_Order__c")).toMatchObject({ defaultValue: "1", defaultedOnCreate: true, precision: 3, scale: 0 });
    expect(result.schema.getField("Project__c", "Manager__c")).toMatchObject({ deleteConstraint: "SetNull", referenceTo: ["User"], childRelationshipName: "ManagedProjects__r" });
  });

  it("reference: acme merged onto the baseline produces no reference-target warning", () => {
    expect(result.warnings.filter((w) => w.startsWith("UNSUPPORTED:reference-target"))).toEqual([]);
  });

  it("reference: a lookup to an undefined object still warns once instead of failing", async () => {
    const baseline = await loadBaseline();
    const project = await readSourceProject(ACME);
    const dangler: SourceObject = {
      name: "Dangler__c",
      fields: [{ fullName: "Target__c", label: "Target", type: "Lookup", referenceTo: "NoSuchObject__c", relationshipName: "Target" }],
      validationRules: [],
      recordTypes: [],
    };
    const built = buildOrgSchema(baseline, { ...project, objects: [...project.objects, dangler] });
    expect(built.warnings.filter((w) => w.startsWith("UNSUPPORTED:reference-target"))).toEqual([
      "UNSUPPORTED:reference-target NoSuchObject__c is referenced but not defined; lookups to it are unchecked",
    ]);
    expect(built.schema.getObject("Dangler__c")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Roll-up summary resolution (phase 5). In-memory projects so edge cases never touch examples/acme.

const sourceField = (fullName: string, type: FieldType, extra: Partial<SourceField> = {}): SourceField => ({ fullName, label: fullName, type, ...extra });
const sourceObject = (name: string, fields: SourceField[]): SourceObject => ({ name, fields, validationRules: [], recordTypes: [] });
const picklist = (fullName: string, ...values: string[]): SourceField =>
  sourceField(fullName, "Picklist", { valueSet: { restricted: false, values: values.map((v) => ({ value: v, label: v, default: false, active: true })) } });
const filter = (field: string, operation: string, value: string, valueField?: string): SourceFilterItem => ({ field, operation, value, ...(valueField !== undefined ? { valueField } : {}) });
const summary = (fullName: string, op: string | undefined, fk: string, summarized?: string, filters?: SourceFilterItem[]): SourceField => ({
  fullName,
  label: fullName,
  type: "Summary",
  summaryForeignKey: fk,
  ...(op !== undefined ? { summaryOperation: op } : {}),
  ...(summarized !== undefined ? { summarizedField: summarized } : {}),
  ...(filters !== undefined ? { summaryFilterItems: filters } : {}),
});
const childFields = (): SourceField[] => [
  sourceField("Parent__c", "MasterDetail", { referenceTo: "Parent__c", relationshipName: "Children" }),
  sourceField("Amount__c", "Currency", { precision: 16, scale: 2 }),
  sourceField("Qty__c", "Number", { precision: 10, scale: 0 }),
  sourceField("Pct__c", "Percent", { precision: 5, scale: 2 }),
  sourceField("Due__c", "Date"),
  sourceField("Planned__c", "Date"),
  sourceField("Stamp__c", "DateTime"),
  sourceField("Done__c", "Checkbox"),
  picklist("Status__c", "Open", "Closed"),
  sourceField("Tag__c", "Text", { length: 40 }),
  sourceField("Notes__c", "LongTextArea", { length: 1000 }),
  sourceField("Calc__c", "Number", { precision: 18, scale: 0, formula: "Qty__c * 2" }),
  sourceField("Ref__c", "Lookup", { referenceTo: "Parent__c", relationshipName: "RefChildren" }),
];
/** Parent__c with the given roll-ups over Child__c, plus any extra objects. */
const parentChild = (parentFields: SourceField[], extra: SourceObject[] = []): SourceObject[] => [sourceObject("Parent__c", parentFields), sourceObject("Child__c", childFields()), ...extra];
const rollupWarnings = (r: BuildResult) => r.warnings.filter((w) => w.startsWith("UNSUPPORTED:rollup") || w.startsWith("UNSUPPORTED:field-type"));

describe("roll-up summary resolution", () => {
  let baseline: Baseline;
  beforeAll(async () => {
    baseline = await loadBaseline();
  });
  const build = (objects: SourceObject[], b: Baseline = baseline): BuildResult =>
    buildOrgSchema(b, { rootDir: "", packageDirectories: [], objects, globalValueSets: [], standardValueSets: [], warnings: [] });

  it("a COUNT roll-up becomes a read-only Number(18,0) column carrying its definition", () => {
    const r = build(parentChild([summary("Child_Count__c", "count", "Child__c.Parent__c")]));
    const f = r.schema.getField("Parent__c", "Child_Count__c");
    expect(f).toMatchObject({
      type: "Number",
      precision: 18,
      scale: 0,
      custom: true,
      createable: false,
      updateable: false,
      nillable: true,
      defaultedOnCreate: false,
      rollup: { childObject: "Child__c", foreignKey: "Parent__c", operation: "COUNT", filters: [] },
    });
    expect(f?.rollup?.summarizedField).toBeUndefined();
    expect(rollupWarnings(r)).toEqual([]);
  });

  it("SUM keeps the child type and scale with precision raised to 18", () => {
    const r = build(parentChild([summary("Total__c", "sum", "Child__c.Parent__c", "Child__c.Amount__c"), summary("Pct_Total__c", "sum", "Child__c.Parent__c", "Child__c.Pct__c")]));
    expect(r.schema.getField("Parent__c", "Total__c")).toMatchObject({ type: "Currency", precision: 18, scale: 2, rollup: { summarizedField: "Amount__c", operation: "SUM" } });
    expect(r.schema.getField("Parent__c", "Pct_Total__c")).toMatchObject({ type: "Percent", precision: 18, scale: 2 });
    expect(rollupWarnings(r)).toEqual([]);
  });

  it("MIN and MAX accept Date and DateTime, including the CreatedDate system field", () => {
    const r = build(
      parentChild([
        summary("First_Due__c", "min", "Child__c.Parent__c", "Child__c.Due__c"),
        summary("Last_Stamp__c", "max", "Child__c.Parent__c", "Child__c.Stamp__c"),
        summary("Last_Created__c", "max", "Child__c.Parent__c", "Child__c.CreatedDate"),
      ]),
    );
    expect(r.schema.getField("Parent__c", "First_Due__c")).toMatchObject({ type: "Date", rollup: { operation: "MIN", summarizedField: "Due__c" } });
    expect(r.schema.getField("Parent__c", "First_Due__c")?.precision).toBeUndefined();
    expect(r.schema.getField("Parent__c", "Last_Stamp__c")).toMatchObject({ type: "DateTime" });
    expect(r.schema.getField("Parent__c", "Last_Created__c")).toMatchObject({ type: "DateTime", rollup: { summarizedField: "CreatedDate" } });
    expect(rollupWarnings(r)).toEqual([]);
  });

  it("summaryOperation is case-insensitive", () => {
    const r = build(parentChild([summary("A__c", "SUM", "Child__c.Parent__c", "Child__c.Amount__c"), summary("B__c", "Sum", "Child__c.Parent__c", "Child__c.Amount__c")]));
    expect(r.schema.getField("Parent__c", "A__c")?.rollup?.operation).toBe("SUM");
    expect(r.schema.getField("Parent__c", "B__c")?.rollup?.operation).toBe("SUM");
  });

  it("roll-ups on standard objects resolve over the three whitelisted lookups", () => {
    const r = build([
      sourceObject("Account", [summary("Opp_Total__c", "sum", "Opportunity.AccountId", "Opportunity.Amount")]),
      sourceObject("Opportunity", [summary("Items_Total__c", "sum", "OpportunityLineItem.OpportunityId", "OpportunityLineItem.TotalPrice")]),
      sourceObject("Campaign", [summary("Member_Count__c", "count", "CampaignMember.CampaignId")]),
    ]);
    expect(r.schema.getField("Account", "Opp_Total__c")).toMatchObject({ type: "Currency", precision: 18, scale: 2, custom: true, rollup: { childObject: "Opportunity", foreignKey: "AccountId" } });
    expect(r.schema.getField("Opportunity", "Items_Total__c")).toMatchObject({ type: "Currency", precision: 18, scale: 2, rollup: { childObject: "OpportunityLineItem", foreignKey: "OpportunityId" } });
    expect(r.schema.getField("Campaign", "Member_Count__c")).toMatchObject({ type: "Number", precision: 18, scale: 0, rollup: { childObject: "CampaignMember", foreignKey: "CampaignId" } });
    expect(rollupWarnings(r)).toEqual([]);
  });

  it("a roll-up over a plain lookup fails metadata load naming the field and the rule", () => {
    expect(() => build([sourceObject("Account", [summary("Contact_Count__c", "count", "Contact.AccountId")])])).toThrowError(/Account\.Contact_Count__c.*Contact\.AccountId.*master-detail/);
    expect(() => build(parentChild([summary("Ref_Count__c", "count", "Child__c.Ref__c")]))).toThrowError(/Parent__c\.Ref_Count__c.*Child__c\.Ref__c/);
  });

  it("a whitelisted child missing from the baseline degrades to rollup-target instead of failing", () => {
    const thin: Baseline = { ...baseline, objects: baseline.objects.filter((o) => o.name !== "OpportunityLineItem") };
    const r = build([sourceObject("Opportunity", [summary("Items_Total__c", "sum", "OpportunityLineItem.OpportunityId", "OpportunityLineItem.TotalPrice")])], thin);
    expect(r.schema.getField("Opportunity", "Items_Total__c")).toBeUndefined();
    expect(rollupWarnings(r)).toEqual([expect.stringMatching(/^UNSUPPORTED:rollup-target Opportunity\.Items_Total__c: /)]);
  });

  it("unresolvable references warn rollup-target and drop the field", () => {
    const other = sourceObject("Other__c", [summary("Stray__c", "count", "Child__c.Parent__c")]);
    const r = build(
      parentChild(
        [
          summary("No_Child__c", "count", "Nope__c.Parent__c"),
          summary("No_Fk__c", "count", "Child__c.Nope__c"),
          summary("No_Field__c", "sum", "Child__c.Parent__c", "Child__c.Nope__c"),
          summary("Wrong_Object__c", "sum", "Child__c.Parent__c", "Parent__c.Name"),
        ],
        [other],
      ),
    );
    for (const name of ["No_Child__c", "No_Fk__c", "No_Field__c", "Wrong_Object__c"]) expect(r.schema.getField("Parent__c", name), name).toBeUndefined();
    expect(r.schema.getField("Other__c", "Stray__c")).toBeUndefined();
    const warnings = rollupWarnings(r).sort();
    expect(warnings).toHaveLength(5);
    for (const name of ["Parent__c.No_Child__c", "Parent__c.No_Fk__c", "Parent__c.No_Field__c", "Parent__c.Wrong_Object__c", "Other__c.Stray__c"]) {
      expect(warnings.filter((w) => w.startsWith(`UNSUPPORTED:rollup-target ${name}: `)), name).toHaveLength(1);
    }
  });

  it("disallowed operations and summarized types warn rollup-type and drop the field", () => {
    const r = build(
      parentChild([
        summary("Avg__c", "avg", "Child__c.Parent__c", "Child__c.Amount__c"),
        summary("No_Op__c", undefined, "Child__c.Parent__c", "Child__c.Amount__c"),
        summary("Sum_Date__c", "sum", "Child__c.Parent__c", "Child__c.Due__c"),
        summary("Max_Text__c", "max", "Child__c.Parent__c", "Child__c.Tag__c"),
        summary("Sum_Formula__c", "sum", "Child__c.Parent__c", "Child__c.Calc__c"),
        summary("Min_Nothing__c", "min", "Child__c.Parent__c"),
      ]),
    );
    for (const name of ["Avg__c", "No_Op__c", "Sum_Date__c", "Max_Text__c", "Sum_Formula__c", "Min_Nothing__c"]) expect(r.schema.getField("Parent__c", name), name).toBeUndefined();
    const warnings = rollupWarnings(r);
    expect(warnings).toHaveLength(6);
    for (const name of ["Avg__c", "No_Op__c", "Sum_Date__c", "Max_Text__c", "Sum_Formula__c"]) {
      expect(warnings.filter((w) => w.startsWith(`UNSUPPORTED:rollup-type Parent__c.${name}: `)), name).toHaveLength(1);
    }
    expect(warnings.filter((w) => w.startsWith("UNSUPPORTED:rollup-target Parent__c.Min_Nothing__c: "))).toHaveLength(1);
  });

  it("a roll-up over another roll-up resolves regardless of declaration order", () => {
    const grand = sourceObject("Grand__c", [summary("Total__c", "sum", "Parent__c.Grand__c", "Parent__c.Total__c")]);
    const parent = sourceObject("Parent__c", [sourceField("Grand__c", "MasterDetail", { referenceTo: "Grand__c", relationshipName: "Parents" }), summary("Total__c", "sum", "Child__c.Parent__c", "Child__c.Amount__c")]);
    const r = build([grand, parent, sourceObject("Child__c", childFields())]);
    expect(r.schema.getField("Parent__c", "Total__c")).toMatchObject({ type: "Currency", precision: 18, scale: 2 });
    expect(r.schema.getField("Grand__c", "Total__c")).toMatchObject({ type: "Currency", precision: 18, scale: 2, rollup: { childObject: "Parent__c", foreignKey: "Grand__c", summarizedField: "Total__c" } });
    expect(rollupWarnings(r)).toEqual([]);
  });

  it("roll-ups that summarise each other in a cycle warn rollup-cycle and are dropped", () => {
    const a = sourceObject("A__c", [sourceField("B__c", "MasterDetail", { referenceTo: "B__c", relationshipName: "As" }), summary("Sum_B__c", "sum", "B__c.A__c", "B__c.Sum_A__c")]);
    const b = sourceObject("B__c", [sourceField("A__c", "MasterDetail", { referenceTo: "A__c", relationshipName: "Bs" }), summary("Sum_A__c", "sum", "A__c.B__c", "A__c.Sum_B__c")]);
    const r = build([a, b]);
    expect(r.schema.getField("A__c", "Sum_B__c")).toBeUndefined();
    expect(r.schema.getField("B__c", "Sum_A__c")).toBeUndefined();
    expect(rollupWarnings(r).sort()).toEqual([expect.stringMatching(/^UNSUPPORTED:rollup-cycle A__c\.Sum_B__c: /), expect.stringMatching(/^UNSUPPORTED:rollup-cycle B__c\.Sum_A__c: /)]);
  });
});

describe("roll-up summary filters", () => {
  let baseline: Baseline;
  beforeAll(async () => {
    baseline = await loadBaseline();
  });
  const build = (objects: SourceObject[]): BuildResult => buildOrgSchema(baseline, { rootDir: "", packageDirectories: [], objects, globalValueSets: [], standardValueSets: [], warnings: [] });
  /** One COUNT roll-up per filter item, named F0__c, F1__c, ... */
  const counted = (...items: SourceFilterItem[]): BuildResult => build(parentChild(items.map((item, i) => summary(`F${i}__c`, "count", "Child__c.Parent__c", undefined, [item]))));

  it("documented filters resolve to canonical field names and tokenised values", () => {
    const r = counted(
      filter("Child__c.done__c", "equals", "True"),
      filter("Child__c.Status__c", "notEqual", 'Closed, "Open"'),
      filter("Child__c.Status__c", "equals", ""),
      filter("Child__c.Qty__c", "greaterOrEqual", "5"),
      filter("Child__c.Due__c", "lessThan", "2026-01-31"),
      filter("Child__c.Stamp__c", "greaterThan", "2026-01-31T10:00:00.000Z"),
      filter("Child__c.Tag__c", "contains", "x_"),
      filter("Child__c.Tag__c", "startsWith", "al"),
      filter("Child__c.Tag__c", "notContain", "z"),
    );
    const filters = Array.from({ length: 9 }, (_, i) => r.schema.getField("Parent__c", `F${i}__c`)?.rollup?.filters);
    expect(filters).toEqual([
      [{ field: "Done__c", operation: "equals", values: ["true"] }],
      [{ field: "Status__c", operation: "notEqual", values: ["Closed", "Open"] }],
      [{ field: "Status__c", operation: "equals", values: [] }],
      [{ field: "Qty__c", operation: "greaterOrEqual", values: ["5"] }],
      [{ field: "Due__c", operation: "lessThan", values: ["2026-01-31"] }],
      [{ field: "Stamp__c", operation: "greaterThan", values: ["2026-01-31T10:00:00.000Z"] }],
      [{ field: "Tag__c", operation: "contains", values: ["x_"] }],
      [{ field: "Tag__c", operation: "startsWith", values: ["al"] }],
      [{ field: "Tag__c", operation: "notContain", values: ["z"] }],
    ]);
    expect(r.warnings.filter((w) => w.startsWith("UNSUPPORTED:"))).toEqual([]);
  });

  it("field-to-field filters accept Child.Field and bare names in the same type family", () => {
    const r = counted(filter("Child__c.Due__c", "greaterThan", "", "Child__c.Planned__c"), filter("Child__c.Due__c", "greaterThan", "", "Planned__c"));
    const expected = [{ field: "Due__c", operation: "greaterThan", values: [], valueField: "Planned__c" }];
    expect(r.schema.getField("Parent__c", "F0__c")?.rollup?.filters).toEqual(expected);
    expect(r.schema.getField("Parent__c", "F1__c")?.rollup?.filters).toEqual(expected);
    expect(r.warnings.filter((w) => w.startsWith("UNSUPPORTED:"))).toEqual([]);
  });

  it("unsupported filters drop the whole field with rollup-filter, never the filter alone", () => {
    const cases: [SourceFilterItem, RegExp?][] = [
      [filter("Child__c.Status__c", "includes", "Open")],
      [filter("Child__c.Due__c", "within", "2026-01-31")],
      [filter("Child__c.Tag__c", "lessThan", "m")],
      [filter("Child__c.Qty__c", "contains", "1")],
      [filter("Child__c.Notes__c", "equals", "x")],
      [filter("Child__c.Calc__c", "equals", "2")],
      [filter("Child__c.Ref__c", "equals", "a00")],
      [filter("Child__c.Done__c", "equals", "Yes")],
      [filter("Child__c.Done__c", "equals", "True, False")],
      [filter("Child__c.Qty__c", "equals", "abc")],
      [filter("Child__c.Due__c", "equals", "TODAY"), /date literal/],
      [filter("Child__c.Due__c", "greaterThan", "LAST_N_DAYS:30"), /date literal/],
      [filter("Child__c.Qty__c", "greaterThan", "1, 2")],
      [filter("Child__c.Qty__c", "equals", "", "Child__c.Tag__c")],
      [filter("Child__c.Qty__c", "equals", "5", "Child__c.Qty__c")],
      [filter("Child__c.Tag__c", "contains", "", "Child__c.Tag__c")],
      [filter("Child__c.Tag__c", "startsWith", "")],
    ];
    const r = counted(...cases.map(([item]) => item));
    const warnings = r.warnings.filter((w) => w.startsWith("UNSUPPORTED:"));
    expect(warnings).toHaveLength(cases.length);
    cases.forEach(([item, detail], i) => {
      const name = `F${i}__c`;
      expect(r.schema.getField("Parent__c", name), `${name} ${JSON.stringify(item)}`).toBeUndefined();
      const own = warnings.filter((w) => w.startsWith(`UNSUPPORTED:rollup-filter Parent__c.${name}: `));
      expect(own, `${name} ${JSON.stringify(item)}`).toHaveLength(1);
      if (detail) expect(own[0]).toMatch(detail);
    });
  });

  it("filter on an unknown child field is rollup-target", () => {
    const r = counted(filter("Child__c.Nope__c", "equals", "x"));
    expect(r.schema.getField("Parent__c", "F0__c")).toBeUndefined();
    expect(r.warnings.filter((w) => w.startsWith("UNSUPPORTED:"))).toEqual([expect.stringMatching(/^UNSUPPORTED:rollup-target Parent__c\.F0__c: /)]);
  });

  it("DE-shaped: MAX over CreatedDate with one picklist equals filter over master-detail loads with zero warnings", () => {
    // Neutral stand-in for the one Summary field in Johan's Developer Edition retrieve (ROLL-09); the real retrieve is checked locally in 05-07.
    const backup = sourceObject("Backup__c", [summary("Last_Run__c", "max", "Backup_Run__c.Backup__c", "Backup_Run__c.CreatedDate", [filter("Backup_Run__c.Result__c", "equals", "Success")])]);
    const run = sourceObject("Backup_Run__c", [sourceField("Backup__c", "MasterDetail", { referenceTo: "Backup__c", relationshipName: "Runs" }), picklist("Result__c", "Success", "Failure")]);
    const r = build([backup, run]);
    expect(r.schema.getField("Backup__c", "Last_Run__c")).toMatchObject({
      type: "DateTime",
      createable: false,
      updateable: false,
      rollup: { childObject: "Backup_Run__c", foreignKey: "Backup__c", operation: "MAX", summarizedField: "CreatedDate", filters: [{ field: "Result__c", operation: "equals", values: ["Success"] }] },
    });
    expect(r.warnings).toEqual([]);
  });

  it("acme still loads with zero warnings", async () => {
    expect((await loadOrgSchema({ projectDir: ACME })).warnings).toEqual([]);
  });
});
