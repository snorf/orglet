import { describe, expect, it, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { buildOrgSchema, loadBaseline, loadOrgSchema, readSourceProject, type BuildResult, type SourceObject } from "./index.js";

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
