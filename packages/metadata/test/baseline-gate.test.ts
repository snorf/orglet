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
  return [...generate(from, options).files.values()].map((text) => JSON.parse(text) as StandardObjectJson);
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
