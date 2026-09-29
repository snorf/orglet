import { describe, expect, it, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { loadOrgSchema, type BuildResult } from "./index.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));

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

  it("marks exactly one name field per object", () => {
    for (const obj of result.schema.list()) {
      expect(obj.fields.filter((f) => f.nameField).map((f) => f.name), obj.name).toHaveLength(1);
    }
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

  it("assigns custom key prefixes in name order", () => {
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

  it("reports unknown reference targets as warnings instead of failing", () => {
    expect(result.warnings.some((w) => w.startsWith("UNSUPPORTED:reference-target Group"))).toBe(true);
  });
});
