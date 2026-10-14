/**
 * Step-A gate for the baseline generator (BASE2-01, BASE2-02 step 1): regeneration is deterministic, the v1.0 scope
 * reproduces the frozen v1.0 fixture field for field, the committed standard objects are exactly the CLI's output, and
 * the sources carry most of v1.0 on their own (pins are the exception layer, not the baseline). Runs in memory on the
 * committed inputs: no fs writes, no network.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { StandardObjectJson } from "@orglet/metadata";
import { CLI_OPTIONS, flagsFromCalls, generate, type GenerateResult } from "../../../scripts/gen-baseline/pipeline.js";
import { loadInputs, type GeneratorInputs } from "../../../scripts/gen-baseline/sources.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURE_DIR = `${REPO_ROOT}packages/metadata/test/fixtures/baseline-v1.0/objects/`;
const STANDARD_DIR = `${REPO_ROOT}packages/metadata/standard/`;
const codeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

let inputs: GeneratorInputs;
let v1: GenerateResult;

beforeAll(async () => {
  inputs = await loadInputs(REPO_ROOT);
  v1 = generate(inputs, { v1Only: true });
});

describe("baseline generator (BASE2-01, BASE2-02 step A)", () => {
  it("two in-memory runs yield identical bytes", () => {
    const again = generate(inputs, { v1Only: true });
    expect([...again.files.keys()]).toEqual([...v1.files.keys()]);
    for (const [path, text] of v1.files) expect(again.files.get(path)).toBe(text);
  });

  it("v1.0 scope reproduces the frozen v1.0 fixture for all 35 objects", () => {
    const fixtureFiles = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json")).sort(codeUnit);
    expect(fixtureFiles).toHaveLength(35);
    expect([...v1.files.keys()].sort(codeUnit)).toEqual(fixtureFiles.map((f) => `objects/${f}`));
    for (const file of fixtureFiles) {
      const fixture = JSON.parse(readFileSync(`${FIXTURE_DIR}${file}`, "utf8")) as StandardObjectJson;
      const generated = JSON.parse(v1.files.get(`objects/${file}`)!) as StandardObjectJson;
      // D-19 sorts fields by code-unit order; 20 v1.0 files were hand-ordered, so the fixture is compared field by field.
      const sortedFixture = { ...fixture, fields: [...fixture.fields].sort((a, b) => codeUnit(a.name, b.name)) };
      expect(generated, file).toEqual(sortedFixture);
    }
  });

  it("the committed standard objects and PROVENANCE.json are exactly the CLI regeneration", () => {
    const cli = generate(inputs, CLI_OPTIONS);
    for (const [path, text] of cli.files) expect(readFileSync(`${STANDARD_DIR}${path}`, "utf8"), path).toBe(text);
    const committed = [...readdirSync(`${STANDARD_DIR}objects/`).filter((f) => f.endsWith(".json")).map((f) => `objects/${f}`), "PROVENANCE.json"].sort(codeUnit);
    expect(committed).toEqual([...cli.files.keys()].sort(codeUnit));
  });

  it("fields are sorted by code-unit order in every output file", () => {
    for (const [path, text] of v1.files) {
      const names = (JSON.parse(text) as StandardObjectJson).fields.map((f) => f.name);
      expect(names, path).toEqual([...names].sort(codeUnit));
    }
  });

  it("most v1.0 fields come from the sources, not from pins", () => {
    expect(v1.report.unpinnedV1Fields.length + v1.report.pinnedFields.length).toBe(659);
    expect(v1.report.unpinnedV1Fields.length).toBeGreaterThanOrEqual(200);
  });

  it("generated files contain no documentation prose (SC1)", () => {
    // Labels and picklist values are short noun phrases; a sentence terminator followed by a new sentence is prose.
    const PROSE = /\b[a-z]{3,}[.!?] [A-Z][a-z]+ [a-z]{2,}/;
    const scan = (where: string, value: unknown): void => {
      if (typeof value === "string") {
        // Object files hold labels and values (short); PROVENANCE.json also holds `Obj.Field -> A, B, ...` target lists.
        if (!where.startsWith("PROVENANCE.json")) expect(value.length, `${where}: ${value}`).toBeLessThanOrEqual(100);
        expect(value, where).not.toMatch(PROSE);
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => scan(`${where}[${i}]`, v));
      } else if (value !== null && typeof value === "object") {
        for (const [key, v] of Object.entries(value)) {
          expect(key, where).not.toBe("description");
          scan(`${where}.${key}`, v);
        }
      }
    };
    for (const [path, text] of generate(inputs, CLI_OPTIONS).files) scan(path, JSON.parse(text));
    const committed = readdirSync(`${STANDARD_DIR}objects/`).filter((f) => f.endsWith(".json"));
    expect(committed.length).toBeGreaterThan(0);
    for (const file of committed) scan(file, JSON.parse(readFileSync(`${STANDARD_DIR}objects/${file}`, "utf8")));
  });

  it("no conflict is left unresolved", () => {
    // generate() throws on an unresolved conflict, so reaching here means every disagreement was settled;
    // the report must say by what.
    expect(v1.report.conflictsSettledByPin.length + v1.report.overrideResolved.length).toBeGreaterThan(0);
    for (const entry of [...v1.report.conflictsSettledByPin, ...v1.report.overrideResolved]) expect(entry).toMatch(/^[A-Za-z0-9]+\.[A-Za-z0-9]+\.[a-zA-Z]+$/);
  });
});

// System fields are added by the loader (standard/README.md); the sources list them, the generator must not.
const SYSTEM_FIELDS = new Set(["Id", "IsDeleted", "CreatedDate", "CreatedById", "LastModifiedDate", "LastModifiedById", "SystemModstamp", "OwnerId"]);
const parseObjects = (result: GenerateResult): Map<string, StandardObjectJson> =>
  new Map([...result.files].filter(([path]) => path.startsWith("objects/")).map(([, text]) => JSON.parse(text) as StandardObjectJson).map((o) => [o.name, o]));
/** `Obj.Field` prefix of a report entry such as `Obj.Field (token)` or `Obj.Field -> Target`. */
const fieldOf = (entry: string): string => entry.split(" ")[0]!;

describe("step B: every documented field (BASE2-02, BASE2-03)", () => {
  let full: GenerateResult;
  let objects: Map<string, StandardObjectJson>;

  beforeAll(() => {
    full = generate(inputs, { v1Only: false, collectConflicts: true });
    objects = parseObjects(full);
  });

  it("v1.0 fields are unchanged by step B", () => {
    for (const [path, text] of v1.files) {
      const v1Object = JSON.parse(text) as StandardObjectJson;
      const fullObject = objects.get(v1Object.name)!;
      expect(fullObject, path).toBeDefined();
      for (const field of v1Object.fields) expect(fullObject.fields.find((f) => f.name === field.name), `${v1Object.name}.${field.name}`).toEqual(field);
    }
  });

  it("every documented field of the 35 is generated or reported as skipped", () => {
    // Lower-cased: a documented name and its SDK case twin are one field, emitted in the SDK spelling.
    const skipped = new Set([...full.report.skipped.fieldType, ...full.report.skipped.referenceTarget].map((e) => fieldOf(e).toLowerCase()));
    const excluded = new Set(full.report.excludedSystem.map((e) => e.toLowerCase()));
    let documented = 0;
    for (const object of inputs.objects) {
      const generated = new Set(objects.get(object)!.fields.map((f) => f.name.toLowerCase()));
      const overrides = inputs.overrides.objects[object]?.fields ?? {};
      const names = new Set([...(inputs.sfSkills.get(object)?.fields.keys() ?? []), ...(inputs.objectReference.get(object)?.fields.keys() ?? [])]);
      for (const name of names) {
        if (SYSTEM_FIELDS.has(name) || overrides[name]?.skip) continue;
        documented++;
        const where = `${object}.${name}`;
        expect(generated.has(name.toLowerCase()) || skipped.has(where.toLowerCase()) || excluded.has(where.toLowerCase()), where).toBe(true);
      }
    }
    expect(documented).toBeGreaterThan(1000);
    expect(full.report.totals.documentedNew).toBeGreaterThan(700);
    expect(full.report.totals.generatedNew).toBeGreaterThan(0);
  });

  it("a gated field is tagged and never required", () => {
    let gated = 0;
    for (const object of objects.values()) {
      for (const field of object.fields) {
        if (!field.featureGated) continue;
        gated++;
        expect(field.featureGated, `${object.name}.${field.name}`).toBe(true);
        expect(field.nillable, `${object.name}.${field.name}`).not.toBe(false);
        expect(full.report.gating[`${object.name}.${field.name}`], `${object.name}.${field.name} has no gating entry`).toBeDefined();
      }
    }
    expect(gated).toBeGreaterThan(0);
    const dataCom = (object: string): string[] => Object.entries(full.report.gating).filter(([k, ids]) => k.startsWith(`${object}.`) && ids.includes("data-com") && objects.get(object)!.fields.some((f) => f.name === k.slice(object.length + 1))).map(([k]) => k);
    expect(dataCom("Contact").length).toBeGreaterThan(0);
    expect(dataCom("Lead").length).toBeGreaterThan(0);
  });

  it("Person Account fields on Account are gated", () => {
    const personAccount = inputs.sfSkills.get("Account")!.personAccountFields;
    expect(personAccount.size).toBeGreaterThan(0);
    const generated = objects.get("Account")!.fields.filter((f) => personAccount.has(f.name));
    expect(generated.length).toBeGreaterThan(0);
    for (const field of generated) expect(field.featureGated, `Account.${field.name}`).toBe(true);
  });

  it("required-looking new fields are forced nullable and listed", () => {
    expect(full.report.forcedNullable.length).toBeGreaterThan(0);
    for (const where of full.report.forcedNullable) {
      const [object, name] = where.split(".") as [string, string];
      const field = objects.get(object)!.fields.find((f) => f.name === name)!;
      expect(field, where).toBeDefined();
      const restored = inputs.overrides.objects[object]?.fields?.[name]?.set?.nillable === false;
      if (!restored) expect(field.nillable, where).not.toBe(false);
    }
  });

  it("sdk-only fields (field_reference only) are read-only", () => {
    expect(full.report.sdkOnly.length).toBeGreaterThan(0);
    for (const where of full.report.sdkOnly) {
      const [object, name] = where.split(".") as [string, string];
      const field = objects.get(object)!.fields.find((f) => f.name === name)!;
      expect(field, where).toBeDefined();
      expect(field.createable, where).toBe(false);
      expect(field.updateable, where).toBe(false);
    }
  });

  it("no generated field references an object outside the object list", () => {
    const known = new Set(inputs.objects);
    for (const object of objects.values()) {
      for (const field of object.fields) for (const target of field.referenceTo ?? []) expect(known.has(target), `${object.name}.${field.name} -> ${target}`).toBe(true);
    }
    expect(full.report.skipped.referenceTarget.length).toBeGreaterThan(0);
  });

  it("every object carries keyPrefixSource matching overrides.json", () => {
    expect(objects.size).toBe(inputs.objects.length);
    for (const object of objects.values()) expect(object.keyPrefixSource, object.name).toBe(inputs.overrides.objects[object.name]!.keyPrefix.source);
  });

  it("PROVENANCE.json is part of the output, holds no prose, and its per-object skip counts equal the report's skipped lists", () => {
    const text = full.files.get("PROVENANCE.json");
    expect(text).toBeDefined();
    const provenance = JSON.parse(text!) as { pins: { sfSkills: string; objectReference: { sha256: string } }; counts: Record<string, { skippedFieldType: number; skippedReferenceTarget: number }>; skipped: { fieldType: string[]; referenceTarget: string[] } };
    expect(provenance.pins.sfSkills).toMatch(/^[0-9a-f]{40}$/);
    expect(provenance.pins.objectReference.sha256).toMatch(/^[0-9a-f]{64}$/);
    const PROSE = /\b[a-z]{3,}[.!?] [A-Z][a-z]+ [a-z]{2,}/;
    const scan = (where: string, value: unknown): void => {
      if (typeof value === "string") expect(value, where).not.toMatch(PROSE);
      else if (Array.isArray(value)) value.forEach((v, i) => scan(`${where}[${i}]`, v));
      else if (value !== null && typeof value === "object") for (const [key, v] of Object.entries(value)) scan(`${where}.${key}`, v);
    };
    scan("PROVENANCE.json", provenance);
    expect(provenance.skipped).toEqual(full.report.skipped.perObject === undefined ? undefined : { fieldType: full.report.skipped.fieldType, referenceTarget: full.report.skipped.referenceTarget });
    for (const object of inputs.objects) {
      const counts = provenance.counts[object]!;
      expect(counts, object).toBeDefined();
      expect(counts.skippedFieldType, object).toBe(full.report.skipped.fieldType.filter((e) => fieldOf(e).startsWith(`${object}.`)).length);
      expect(counts.skippedReferenceTarget, object).toBe(full.report.skipped.referenceTarget.filter((e) => fieldOf(e).startsWith(`${object}.`)).length);
      expect(full.report.skipped.perObject[object], object).toEqual({ fieldType: counts.skippedFieldType, referenceTarget: counts.skippedReferenceTarget });
    }
  });

  it("ownerTargets is written only when narrower than the default", () => {
    // BASE2-04 / D-11: absent means User and Group, so an object whose owner stays polymorphic is byte-identical to 09-07.
    const USER_ONLY = ["Account", "Asset", "Campaign", "Contact", "ContentDocument", "ContentVersion", "Contract", "Event", "Individual", "Opportunity"];
    for (const object of objects.values()) {
      if (object.ownerTargets !== undefined) expect([...object.ownerTargets].sort(codeUnit), object.name).not.toEqual(["Group", "User"]);
      if (USER_ONLY.includes(object.name)) expect(object.ownerTargets, object.name).toEqual(["User"]);
      else expect(object.ownerTargets, object.name).toBeUndefined();
    }
    expect([...objects.values()].filter((o) => o.ownerTargets !== undefined).map((o) => o.name).sort(codeUnit)).toEqual(USER_ONLY);
  });

  it("ServiceContract's owner targets come from a reasoned override", () => {
    // Neither source states Refers To for ServiceContract.OwnerId; BASE2-04 lists it as User and Group (locked decision 3).
    expect(full.report.overrideResolved.some((e) => e.startsWith("ServiceContract.OwnerId"))).toBe(true);
    expect(inputs.overrides.objects["ServiceContract"]?.ownerTargets).toMatchObject({ value: ["User", "Group"], reason: expect.stringContaining("shows no Refers To") as string });
    for (const object of ["Event", "Group", "ServiceContract"]) expect(inputs.overrides.objects[object]?.ownerTargets?.reason, object).toBeTruthy();
  });

  it("the v1.0-scope run emits no ownerTargets", () => {
    for (const [path, text] of v1.files) expect((JSON.parse(text) as StandardObjectJson).ownerTargets, path).toBeUndefined();
  });

  it("no new MasterDetail on a v1.0 object is generated", () => {
    for (const object of objects.values()) {
      const pins = inputs.pins![object.name];
      if (!pins) continue;
      for (const field of object.fields) if (field.type === "MasterDetail") expect(pins.fields[field.name], `${object.name}.${field.name}`).toBeDefined();
    }
  });

  it("collectConflicts returns an unresolved conflict in the report instead of throwing", () => {
    const clone = structuredClone(inputs);
    const doc = clone.objectReference.get("Lead")!.fields;
    const sf = clone.sfSkills.get("Lead")!.fields;
    sf.set("StepBConflict", { type: "string", properties: ["Create", "Filter", "Nillable", "Update"] });
    doc.set("StepBConflict", { type: "textarea", properties: ["Create", "Filter", "Nillable", "Update"] });
    expect(() => generate(clone, { v1Only: false })).toThrow(/Lead\.StepBConflict\.type/);
    const collected = generate(clone, { v1Only: false, collectConflicts: true });
    expect(collected.report.conflicts.unresolved.some((c) => c.startsWith("Lead.StepBConflict.type:"))).toBe(true);
    expect(collected.report.conflicts.byFact.type).toBeGreaterThanOrEqual(1);
    expect(full.report.conflicts.unresolved).toEqual([]);
  });

  it("a documented name and a field_reference name that differ only by case emit the SDK spelling with every documented fact", () => {
    const clone = structuredClone(inputs);
    clone.sfSkills.get("Lead")!.fields.set("CaseTwinID", { type: "string", label: "Documented Label", length: 18, properties: ["Create", "Filter", "Nillable", "Update"] });
    clone.objectReference.get("Lead")!.fields.set("CaseTwinID", { type: "string", length: 18, properties: ["Create", "Filter", "Nillable", "Update"] });
    clone.sfSkills.get("Lead")!.fieldReference.set("CaseTwinId", { label: "Reference Label" });
    const result = generate(clone, { v1Only: false });
    const lead = parseObjects(result).get("Lead")!;
    expect(lead.fields.filter((f) => f.name.toLowerCase() === "casetwinid").map((f) => f.name)).toEqual(["CaseTwinId"]);
    expect(lead.fields.find((f) => f.name === "CaseTwinId")).toEqual({ name: "CaseTwinId", label: "Documented Label", type: "Text", length: 255 });
    expect(result.report.caseSpelling).toContain("Lead.CaseTwinID -> CaseTwinId");
  });

  const BUSINESS = [
    "AccountContactRelation", "AccountTeamMember", "Address", "CaseContactRole", "CaseMilestone", "ContentDocument", "ContentVersion", "ContractLineItem", "EmailMessage",
    "FeedItem", "Location", "OpportunityContactRole", "OpportunitySplit", "OpportunityTeamMember", "Order", "OrderItem", "Quote", "QuoteLineItem",
  ];

  it("BASE2-06: blob, junction-id-list and compound-geolocation fields of the 18 are omitted and listed in the generator report", () => {
    const omitted = full.report.unsupportedTypes
      .map((e) => /^UNSUPPORTED:field-type (\S+)/.exec(e)![1]!)
      .filter((where) => BUSINESS.includes(where.split(".")[0]!))
      .sort(codeUnit);
    expect(omitted).toEqual(["ContentVersion.VersionData", "EmailMessage.BccIds", "EmailMessage.CcIds", "EmailMessage.ContentDocumentIds", "EmailMessage.ToIds", "FeedItem.ContentData", "Location.Location"]);
    for (const where of omitted) {
      const [object, name] = where.split(".") as [string, string];
      expect(objects.get(object)!.fields.some((f) => f.name === name), where).toBe(false);
    }
  });

  it("D-18: documented-required fields of the 18 stay required; forcedNullable lists only v1.0 objects", () => {
    for (const where of full.report.forcedNullable) expect(inputs.pins![where.split(".")[0]!], where).toBeDefined();
    const nillableOf = (object: string, name: string): boolean | undefined => objects.get(object)!.fields.find((f) => f.name === name)!.nillable;
    expect(nillableOf("Order", "EffectiveDate")).toBe(false);
    expect(nillableOf("OrderItem", "OrderId")).toBe(false);
  });

  it("Supported Calls reproduce the committed DML flags of the 14 thin objects", () => {
    const thin = ["BusinessHours", "BusinessProcess", "CallCenter", "DandBCompany", "Entitlement", "ExternalDataSource", "IdeaTheme", "Individual", "OperatingHours", "OpportunityHistory", "ServiceAppointment", "ServiceContract", "SocialPost", "UserLicense"];
    const flags = ["createable", "updateable", "deletable", "undeletable", "queryable", "searchable"] as const;
    for (const name of thin) {
      const derived = flagsFromCalls(inputs.objectReference.get(name)!.supportedCalls!);
      const committed = objects.get(name)!;
      for (const flag of flags) expect(derived[flag] ?? true, `${name}.${flag}`).toBe(committed[flag] ?? true);
    }
  });

  it("every hand lookup target of Phase 10 is generated", () => {
    const lookups: Record<string, string> = {
      "AccountContactRelation.AccountId": "Account", "AccountContactRelation.ContactId": "Contact", "AccountTeamMember.AccountId": "Account", "AccountTeamMember.UserId": "User",
      "CaseMilestone.BusinessHoursId": "BusinessHours", "CaseMilestone.CaseId": "Case", "ContentDocument.ArchivedById": "User", "ContentVersion.RecordTypeId": "RecordType",
      "ContractLineItem.AssetId": "Asset", "ContractLineItem.LocationId": "Location", "ContractLineItem.ParentContractLineItemId": "ContractLineItem",
      "ContractLineItem.PricebookEntryId": "PricebookEntry", "ContractLineItem.Product2Id": "Product2", "ContractLineItem.RootContractLineItemId": "ContractLineItem",
      "ContractLineItem.ServiceContractId": "ServiceContract", "FeedItem.LastEditById": "User", "Location.AccountId": "Account", "Location.BusinessHoursId": "BusinessHours",
      "Location.FulfillingBusinessHoursId": "BusinessHours", "Location.PropertyOwnerAccountId": "Account",
      "OpportunityTeamMember.OpportunityId": "Opportunity", "OpportunityTeamMember.UserId": "User", "Order.BillToContactId": "Contact", "Order.OpportunityId": "Opportunity",
      "Order.QuoteId": "Quote", "Order.RecordTypeId": "RecordType", "Order.ShipToContactId": "Contact", "OrderItem.ParentOrderItemId": "OrderItem",
      "OrderItem.QuoteLineItemId": "QuoteLineItem", "OrderItem.RelatedOrderItemId": "OrderItem", "Quote.AccountId": "Account", "Quote.BillToContactId": "Contact",
      "Quote.ContactId": "Contact", "Quote.ContractId": "Contract", "Quote.OpportunityId": "Opportunity", "Quote.PartnerAccountId": "Account", "Quote.Pricebook2Id": "Pricebook2",
      "Quote.PricingContractId": "Contract", "Quote.RecordTypeId": "RecordType", "Quote.RelatedQuoteId": "Quote", "QuoteLineItem.OpportunityLineItemId": "OpportunityLineItem",
      "QuoteLineItem.PricebookEntryId": "PricebookEntry", "QuoteLineItem.Product2Id": "Product2", "QuoteLineItem.QuoteId": "Quote",
      // D-19: additive nullable lookups on v1.0 objects
      "Asset.LocationId": "Location", "Entitlement.LocationId": "Location", "Entitlement.ContractLineItemId": "ContractLineItem", "Case.FeedItemId": "FeedItem",
    };
    expect(Object.keys(lookups)).toHaveLength(48);
    for (const [where, target] of Object.entries(lookups)) {
      const [object, name] = where.split(".") as [string, string];
      const field = objects.get(object)!.fields.find((f) => f.name === name);
      expect(field?.referenceTo, where).toEqual([target]);
      expect(field?.relationshipName, where).toBeTruthy();
    }
  });

  it("the three polymorphic subsets are exactly the modelled targets", () => {
    const expected: Record<string, number> = { "FeedItem.ParentId": 19, "EmailMessage.RelatedToId": 10, "ContentVersion.FirstPublishLocationId": 20 };
    for (const [where, count] of Object.entries(expected)) {
      const [object, name] = where.split(".") as [string, string];
      const referenceTo = objects.get(object)!.fields.find((f) => f.name === name)?.referenceTo;
      expect(referenceTo, where).toHaveLength(count);
      expect(referenceTo, where).toEqual(inputs.overrides.objects[object]!.fields![name]!.set!.referenceTo);
      expect(referenceTo, where).toContain("Case");
      for (const target of referenceTo!) expect(inputs.objects, `${where} -> ${target}`).toContain(target);
    }
  });

  it("labels of objects without v1 pins come from overrides.json with a reason", () => {
    for (const name of BUSINESS) {
      const labels = inputs.overrides.objects[name]!.labels!;
      expect(labels.reason, name).toBeTruthy();
      expect(objects.get(name)!.label, name).toBe(labels.label);
      expect(objects.get(name)!.labelPlural, name).toBe(labels.labelPlural);
    }
  });
});
