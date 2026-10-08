import { describe, expect, it, vi } from "vitest";
import type { SObjectShape, TypeofShape } from "./compile.js";
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

describe("shapeSObjectRow with TYPEOF", () => {
  const USER_ID = "005000000000001AAA";
  const userBranch: SObjectShape = { kind: "sobject", type: "User", idAlias: "c4", fields: [{ name: "Alias", alias: "c5" }], computed: [], parents: new Map(), children: new Map() };
  const groupBranch: SObjectShape = { kind: "sobject", type: "Group", idAlias: "c6", fields: [{ name: "Name", alias: "c7" }], computed: [], parents: new Map(), children: new Map() };
  const elseShape: SObjectShape = { kind: "sobject", type: "", idAlias: "c8", poly: { typeAlias: "c2", fkAlias: "c3" }, fields: [{ name: "Name", alias: "c9" }], computed: [], parents: new Map(), children: new Map() };
  const withElse: TypeofShape = { typeAlias: "c2", fkAlias: "c3", branches: new Map([["User", userBranch]]), else: elseShape };
  const withoutElse: TypeofShape = { typeAlias: "c2", fkAlias: "c3", branches: new Map([["User", userBranch], ["Group", groupBranch]]) };
  const rootWith = (t: TypeofShape): SObjectShape => ({ kind: "sobject", type: "Case", idAlias: "c0", fields: [], computed: [], parents: new Map(), children: new Map(), typeofs: new Map([["Owner", t]]) });
  const shapeWith = (t: TypeofShape, row: Record<string, unknown>) => {
    const onUnmodelledPrefix = vi.fn();
    const record = shapeSObjectRow(rootWith(t), { c0: CASE_ID, ...row }, { apiVersion: "60.0", onUnmodelledPrefix });
    return { owner: record?.["Owner"], onUnmodelledPrefix };
  };

  it("TYPEOF picks the branch named by the row's concrete type and leaves other branches' fields absent", () => {
    const user = shapeWith(withoutElse, { c2: "User", c3: USER_ID, c4: USER_ID, c5: "admin", c6: null, c7: null });
    expect(user.owner).toEqual({ attributes: { type: "User", url: `/services/data/v60.0/sobjects/User/${USER_ID}` }, Alias: "admin" });
    const group = shapeWith(withoutElse, { c2: "Group", c3: GROUP_ID, c4: null, c5: null, c6: GROUP_ID, c7: "Support Queue" });
    expect(group.owner).toEqual({ attributes: { type: "Group", url: `/services/data/v60.0/sobjects/Group/${GROUP_ID}` }, Name: "Support Queue" });
    expect(user.onUnmodelledPrefix).not.toHaveBeenCalled();
  });

  it("TYPEOF without ELSE yields a null parent for an unlisted type", () => {
    const only = { typeAlias: "c2", fkAlias: "c3", branches: new Map([["User", userBranch]]) };
    const { owner, onUnmodelledPrefix } = shapeWith(only, { c2: "Group", c3: GROUP_ID, c4: null, c5: null });
    expect(owner).toBeNull();
    expect(onUnmodelledPrefix).not.toHaveBeenCalled();
  });

  it("TYPEOF with ELSE shapes an unlisted modelled type from the ELSE fields with its concrete attributes.type", () => {
    const { owner } = shapeWith(withElse, { c2: "Group", c3: GROUP_ID, c4: null, c5: null, c8: GROUP_ID, c9: "Support Queue" });
    expect(owner).toEqual({ attributes: { type: "Group", url: `/services/data/v60.0/sobjects/Group/${GROUP_ID}` }, Name: "Support Queue" });
  });

  it("a null lookup is a null TYPEOF parent without a report", () => {
    const { owner, onUnmodelledPrefix } = shapeWith(withElse, { c2: null, c3: null, c4: null, c5: null, c8: null, c9: null });
    expect(owner).toBeNull();
    expect(onUnmodelledPrefix).not.toHaveBeenCalled();
  });

  it("an unmodelled prefix is a null parent even when TYPEOF has ELSE, and is reported once", () => {
    const { owner, onUnmodelledPrefix } = shapeWith(withElse, { c2: null, c3: "zzz000000000001AAA", c4: null, c5: null, c8: null, c9: null });
    expect(owner).toBeNull();
    expect(onUnmodelledPrefix).toHaveBeenCalledTimes(1);
    expect(onUnmodelledPrefix).toHaveBeenCalledWith("zzz");
  });

  it("an unmodelled prefix without ELSE is a null parent and is reported once", () => {
    const { owner, onUnmodelledPrefix } = shapeWith(withoutElse, { c2: null, c3: "zzz000000000001AAA", c4: null, c5: null, c6: null, c7: null });
    expect(owner).toBeNull();
    expect(onUnmodelledPrefix).toHaveBeenCalledTimes(1);
    expect(onUnmodelledPrefix).toHaveBeenCalledWith("zzz");
  });
});
