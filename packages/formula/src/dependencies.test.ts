import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadOrgSchema, type OrgSchema } from "@orglet/metadata";
import { compileFormula } from "./compile.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
let schema: OrgSchema;

beforeAll(async () => {
  schema = (await loadOrgSchema({ projectDir: ACME })).schema;
});

const rule = (source: string, objectName = "Account") => compileFormula(source, { schema, objectName, context: "validation_rule" }).dependencies;
const field = (source: string, objectName: string) =>
  compileFormula(source, { schema, objectName, context: "formula_field", treatBlanksAs: "BlankAsBlank" }).dependencies;

describe("formula dependencies", () => {
  it("lists the lookup field on the record and the leaf on the parent", () => {
    expect(rule("Account.Industry = 'Energy'", "Contact")).toEqual({
      fields: [
        { object: "Contact", path: [], fields: ["AccountId"] },
        { object: "Account", path: ["Account"], fields: ["Industry"] },
      ],
      globals: [],
      volatile: false,
    });
  });

  it("represents a typed segment as Relationship:Object in the path", () => {
    expect(rule("Owner:User.Email = 'a@b.se'", "Case").fields).toEqual([
      { object: "Case", path: [], fields: ["OwnerId"] },
      { object: "User", path: ["Owner:User"], fields: ["Email"] },
    ]);
  });

  it("lists every hop of a multi-level path", () => {
    expect(rule("Owner:User.Profile.Name = 'x'", "Case").fields).toEqual([
      { object: "Case", path: [], fields: ["OwnerId"] },
      { object: "User", path: ["Owner:User"], fields: ["ProfileId"] },
      { object: "Profile", path: ["Owner:User", "Profile"], fields: ["Name"] },
    ]);
  });

  it("counts PRIORVALUE and ISCHANGED arguments as reads of the own record and ISNEW as none", () => {
    expect(rule("ISCHANGED(Name) || PRIORVALUE(Industry) = 'Energy' || ISNEW()")).toEqual({
      fields: [{ object: "Account", path: [], fields: ["Industry", "Name"] }],
      globals: [],
      volatile: false,
    });
  });

  it("is volatile when the formula reads the clock", () => {
    expect(field("CloseDate - TODAY()", "Opportunity")).toEqual({
      fields: [{ object: "Opportunity", path: [], fields: ["CloseDate"] }],
      globals: [],
      volatile: true,
    });
  });

  it("is volatile when it reads an evaluation-time global", () => {
    expect(rule("$User.Alias = 'x' && Name = 'y'")).toEqual({
      fields: [{ object: "Account", path: [], fields: ["Name"] }],
      globals: ["$User"],
      volatile: true,
    });
  });

  it("returns the global roots sorted", () => {
    expect(rule("$Profile.Name = 'a' && $Organization.Name = 'b'").globals).toEqual(["$Organization", "$Profile"]);
  });

  it("does not treat $System.OriginDateTime as volatile", () => {
    const d = rule("CreatedDate > $System.OriginDateTime");
    expect(d.globals).toContain("$System");
    expect(d.volatile).toBe(false);
  });

  it("lists a field read twice once", () => {
    expect(rule("Name = 'a' || Name = 'b'").fields).toEqual([{ object: "Account", path: [], fields: ["Name"] }]);
  });
});
