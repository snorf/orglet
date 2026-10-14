/**
 * MIGR-03 protections for the baseline (D-16..D-18): the v1-vs-v2 diff gate on the real regeneration and on synthetic
 * removals/narrowings, the allowlist's "no stale exceptions" rule, the generator's refusal to add a MasterDetail to an
 * object that existed in v1.0, and the generator's failure modes. Everything runs in memory on the committed inputs:
 * no fs writes, no network.
 */
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadBaseline, type Baseline, type StandardObjectJson } from "@orglet/metadata";
import { CLI_OPTIONS, generate, GeneratorError, type GenerateOptions } from "../../../scripts/gen-baseline/pipeline.js";
import { loadInputs, parseAllowlist, type AllowlistEntry, type GeneratorInputs } from "../../../scripts/gen-baseline/sources.js";
import { diffGate } from "./baseline-gate.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURE_DIR = `${REPO_ROOT}packages/metadata/test/fixtures/baseline-v1.0`;
const STANDARD_DIR = `${REPO_ROOT}packages/metadata/standard`;

let inputs: GeneratorInputs;
let v1: Baseline;
let v2: Baseline;

function regenerate(from: GeneratorInputs, options: GenerateOptions = CLI_OPTIONS): StandardObjectJson[] {
  // Full mode also emits PROVENANCE.json; the gate compares objects only.
  return [...generate(from, options).files].filter(([path]) => path.startsWith("objects/")).map(([, text]) => JSON.parse(text) as StandardObjectJson);
}

/** A deep copy of the regenerated v2 baseline with one synthetic edit applied. */
function edited(edit: (objects: StandardObjectJson[]) => void): Baseline {
  const objects = structuredClone(v2.objects);
  edit(objects);
  return { objects, standardValueSets: v2.standardValueSets };
}

const account = (objects: StandardObjectJson[]): StandardObjectJson => objects.find((o) => o.name === "Account")!;
const accountField = (objects: StandardObjectJson[], name: string) => account(objects).fields.find((f) => f.name === name)!;
const removedAccountNumber: AllowlistEntry = { object: "Account", field: "AccountNumber", kind: "removed", reason: "test" };

beforeAll(async () => {
  inputs = await loadInputs(REPO_ROOT);
  v1 = await loadBaseline(FIXTURE_DIR);
  const live = await loadBaseline(STANDARD_DIR);
  v2 = { objects: regenerate(inputs), standardValueSets: live.standardValueSets };
});

describe("v1-vs-v2 diff gate (MIGR-03, D-16..D-18)", () => {
  it("no v1.0 field disappears or narrows without an allowlist entry", () => {
    expect(diffGate(v1, v2, inputs.allowlist)).toEqual([]);
  });

  it("a removed v1.0 field is reported", () => {
    const removed = edited((objects) => {
      account(objects).fields = account(objects).fields.filter((f) => f.name !== "AccountNumber");
    });
    expect(diffGate(v1, removed, [])).toEqual(["Account.AccountNumber removed"]);
  });

  it("a narrowed length is reported with both SQL types", () => {
    const narrowed = edited((objects) => {
      accountField(objects, "AccountNumber").length = 20;
    });
    expect(diffGate(v1, narrowed, [])).toEqual(["Account.AccountNumber narrowed: varchar(40) -> varchar(20)"]);
  });

  it("a type change is reported", () => {
    const retyped = edited((objects) => {
      const f = accountField(objects, "AnnualRevenue");
      f.type = "Text";
      delete f.precision;
      delete f.scale;
    });
    const messages = diffGate(v1, retyped, []);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/^Account\.AnnualRevenue narrowed: numeric\(/);
  });

  it("an allowlisted change passes and a stale allowlist entry fails", () => {
    const removed = edited((objects) => {
      account(objects).fields = account(objects).fields.filter((f) => f.name !== "AccountNumber");
    });
    expect(diffGate(v1, removed, [removedAccountNumber])).toEqual([]);
    expect(diffGate(v1, v2, [removedAccountNumber])).toEqual(["allowlist entry Account.AccountNumber (removed) is not needed"]);
  });

  it("flag changes are free (D-17)", () => {
    const flagged = edited((objects) => {
      accountField(objects, "AccountNumber").createable = false;
    });
    expect(diffGate(v1, flagged, [])).toEqual([]);
  });

  it("a removed v1.0 object or a changed key prefix always fails", () => {
    const noAccount = edited((objects) => {
      objects.splice(objects.indexOf(account(objects)), 1);
    });
    expect(diffGate(v1, noAccount, [removedAccountNumber])).toContain("Account object removed");
    const reprefixed = edited((objects) => {
      account(objects).keyPrefix = "00X";
    });
    expect(diffGate(v1, reprefixed, [removedAccountNumber])).toContain("Account key prefix changed: 001 -> 00X");
  });

  it("the committed allowlist is empty and every entry needs object, field, a known kind and a reason", () => {
    expect(inputs.allowlist).toEqual([]);
    expect(parseAllowlist({ entries: [removedAccountNumber] })).toEqual([removedAccountNumber]);
    expect(() => parseAllowlist({ entries: [{ ...removedAccountNumber, reason: " " }] })).toThrow(GeneratorError);
    expect(() => parseAllowlist({ entries: [{ ...removedAccountNumber, kind: "renamed" }] })).toThrow(/kind must be one of removed\|narrowed/);
    expect(() => parseAllowlist({ entries: [{ ...removedAccountNumber, field: "" }] })).toThrow(/object and field must be non-empty strings/);
    expect(() => parseAllowlist([])).toThrow(/expected \{ entries: \[\.\.\.\] \}/);
  });
});

const MASTER_DETAIL_REFUSAL = "Account.SyntheticParentId: MasterDetail on an object that existed in v1.0 would add a NOT NULL column to a populated table; model it as Lookup in overrides.json";
const SYNTHETIC_PROPERTIES = ["Create", "Filter", "Group", "Sort", "Update"];

/**
 * Account only, in full mode, with its sources pruned to the v1.0 inventory plus one synthetic reference field, so the
 * refusal is tested on exactly one new field rather than on the whole step-B inventory.
 */
function syntheticAccountInputs(relationshipType: "lookup" | "master-detail"): GeneratorInputs {
  const clone = structuredClone(inputs);
  clone.objects = ["Account"];
  clone.pins = { Account: clone.pins!.Account! };
  const v1Names = new Set(Object.keys(clone.pins.Account!.fields));
  const sf = clone.sfSkills.get("Account")!;
  const doc = clone.objectReference.get("Account")!;
  // OwnerId is a system field (never pinned) but the generator reads its Refers To for ownerTargets (BASE2-04), so it stays.
  for (const map of [sf.fields, sf.fieldReference, doc.fields]) for (const name of [...map.keys()]) if (!v1Names.has(name) && name !== "OwnerId") map.delete(name);
  // The target is Account itself: the pruned object list holds only Account, and 09-06 skips a new Lookup whose target is
  // outside objects.json before it could reach the field loop's emit step (the MasterDetail refusal still runs first).
  sf.fields.set("SyntheticParentId", { type: "reference", properties: SYNTHETIC_PROPERTIES, refersTo: ["Account"], relationshipName: "SyntheticParent" });
  doc.fields.set("SyntheticParentId", { type: "reference", properties: SYNTHETIC_PROPERTIES, refersTo: ["Account"], relationshipName: "SyntheticParent", relationshipType });
  return clone;
}

function expectGeneratorError(run: () => unknown, message: RegExp | string): void {
  let caught: unknown;
  try {
    run();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(GeneratorError);
  if (typeof message === "string") expect((caught as Error).message).toBe(message);
  else expect((caught as Error).message).toMatch(message);
}

describe("MasterDetail refusal (MIGR-03)", () => {
  it("the generator refuses a new MasterDetail field on an object that existed in v1.0", () => {
    expectGeneratorError(() => generate(syntheticAccountInputs("master-detail"), { v1Only: false }), MASTER_DETAIL_REFUSAL);
  });

  it("the same field as a Lookup is emitted, and in v1-only mode it is out of scope", () => {
    const lookup = regenerate(syntheticAccountInputs("lookup"), { v1Only: false });
    expect(accountField(lookup, "SyntheticParentId")).toMatchObject({ type: "Lookup", referenceTo: ["Account"] });
    const v1Scope = regenerate(syntheticAccountInputs("master-detail"), { v1Only: true });
    expect(account(v1Scope).fields.some((f) => f.name === "SyntheticParentId")).toBe(false);
  });

  it("an overrides.json set cannot introduce a MasterDetail on a v1.0 object either", () => {
    const viaOverride = syntheticAccountInputs("lookup");
    viaOverride.overrides.objects.Account!.fields!.SyntheticParentId = { set: { type: "MasterDetail", referenceTo: ["Account"] }, reason: "test" };
    expectGeneratorError(() => generate(viaOverride, { v1Only: false }), MASTER_DETAIL_REFUSAL);
  });

  it("the refusal ignores the allowlist", () => {
    const allowlisted = syntheticAccountInputs("master-detail");
    allowlisted.allowlist = [{ object: "Account", field: "SyntheticParentId", kind: "narrowed", reason: "test" }];
    expectGeneratorError(() => generate(allowlisted, { v1Only: false }), MASTER_DETAIL_REFUSAL);
  });
});

describe("generator failure modes", () => {
  const withInputs = (edit: (clone: GeneratorInputs) => void): GeneratorInputs => {
    const clone = structuredClone(inputs);
    edit(clone);
    return clone;
  };

  it("an unknown source type token aborts, naming the field", () => {
    const unknownType = withInputs((c) => c.objectReference.get("Account")!.fields.set("SyntheticWeird", { type: "weirdtype" }));
    expectGeneratorError(() => generate(unknownType, CLI_OPTIONS), /^Account\.SyntheticWeird: unknown source type "weirdtype"/);
  });

  it("an overrides entry without a reason aborts", () => {
    const noReason = withInputs((c) => {
      c.overrides.objects.Account!.fields!.Tier!.reason = "";
    });
    expectGeneratorError(() => generate(noReason, CLI_OPTIONS), /^overrides\.json Account\.Tier: every field override needs a non-empty reason/);
  });

  it("a key prefix sourced from a describe aborts (D-07: never from an org)", () => {
    const describeSourced = withInputs((c) => {
      (c.overrides.objects.Account!.keyPrefix as { source: string }).source = "de-describe";
    });
    expectGeneratorError(() => generate(describeSourced, CLI_OPTIONS), /^overrides\.json Account: keyPrefix\.source must be one of doc\|sdk-fixture\|unverified/);
  });

  it("a pinned v1.0 field that both sources dropped aborts without a keep entry", () => {
    const dropped = withInputs((c) => {
      const sf = c.sfSkills.get("Account")!;
      sf.fields.delete("AccountNumber");
      sf.fieldReference.delete("AccountNumber");
      c.objectReference.get("Account")!.fields.delete("AccountNumber");
    });
    expectGeneratorError(() => generate(dropped, CLI_OPTIONS), /^Account\.AccountNumber is in v1\.0 but in neither source; add an overrides\.json keep entry/);
  });

  it("a source conflict on a field with no pin or override aborts", () => {
    const conflicting = withInputs((c) => {
      const doc = c.objectReference.get("Account")!.fields.get("AccountNumber")!;
      doc.properties = doc.properties!.filter((p) => p !== "Create");
    });
    expect(inputs.pins!.Account!.fields.AccountNumber).toEqual({});
    expectGeneratorError(() => generate(conflicting, CLI_OPTIONS), /unresolved source conflicts[\s\S]*Account\.AccountNumber\.createable: sf-skills=true object-reference=false/);
  });
});
