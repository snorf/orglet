import { describe, expect, it, vi } from "vitest";
import type { SObjectShape } from "./compile.js";
import { shapeSObjectRow } from "./shape.js";

const ownerShape: SObjectShape = { kind: "sobject", type: "", idAlias: "c1", poly: { typeAlias: "c2", fkAlias: "c3" }, fields: [{ name: "Name", alias: "c4" }], computed: [], parents: new Map(), children: new Map() };
const caseShape: SObjectShape = { kind: "sobject", type: "Case", idAlias: "c0", fields: [], computed: [], parents: new Map([["Owner", ownerShape]]), children: new Map() };
const GROUP_ID = "00G000000000001AAA";
const CASE_ID = "500000000000001AAA";

describe("shapeSObjectRow with a polymorphic parent", () => {
  it("stamps the parent's attributes.type from the row's concrete type, not the shape", () => {
    const onUnmodelledPrefix = vi.fn();
    const record = shapeSObjectRow(caseShape, { c0: CASE_ID, c1: GROUP_ID, c2: "Group", c3: GROUP_ID, c4: "Support Queue" }, { apiVersion: "60.0", onUnmodelledPrefix });
    expect(record?.["Owner"]).toEqual({ attributes: { type: "Group", url: `/services/data/v60.0/sobjects/Group/${GROUP_ID}` }, Name: "Support Queue" });
    expect(onUnmodelledPrefix).not.toHaveBeenCalled();
  });

  it("returns a null parent and reports the prefix once when the Id matches no modelled object", () => {
    const onUnmodelledPrefix = vi.fn();
    const record = shapeSObjectRow(caseShape, { c0: CASE_ID, c1: null, c2: null, c3: "zzz000000000001AAA", c4: null }, { apiVersion: "60.0", onUnmodelledPrefix });
    expect(record?.["Owner"]).toBeNull();
    expect(onUnmodelledPrefix).toHaveBeenCalledTimes(1);
    expect(onUnmodelledPrefix).toHaveBeenCalledWith("zzz");
  });

  it("returns a null parent without a report when the lookup itself is null", () => {
    const onUnmodelledPrefix = vi.fn();
    const record = shapeSObjectRow(caseShape, { c0: CASE_ID, c1: null, c2: null, c3: null, c4: null }, { apiVersion: "60.0", onUnmodelledPrefix });
    expect(record?.["Owner"]).toBeNull();
    expect(onUnmodelledPrefix).not.toHaveBeenCalled();
  });

  it("returns a null parent without a report when the type is known but the parent row is missing", () => {
    const onUnmodelledPrefix = vi.fn();
    const record = shapeSObjectRow(caseShape, { c0: CASE_ID, c1: null, c2: "Group", c3: GROUP_ID, c4: null }, { apiVersion: "60.0", onUnmodelledPrefix });
    expect(record?.["Owner"]).toBeNull();
    expect(onUnmodelledPrefix).not.toHaveBeenCalled();
  });
});
