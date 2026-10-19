/**
 * Offline integrity check for the vendored sf-skills snapshot: the committed files must match the sha256 manifest
 * that scripts/sync-sfdocs.sh wrote into VENDOR.md, so CI never needs the network to trust the generator input.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../../scripts/gen-baseline/", import.meta.url));
const DIR = `${ROOT}source/sf-skills/`;
const vendorMd = readFileSync(`${DIR}VENDOR.md`, "utf8");

function manifest(): Map<string, string> {
  const section = vendorMd.split("## Files (sha256)")[1] ?? "";
  const entries = new Map<string, string>();
  for (const line of section.split("\n")) {
    const m = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
    if (m) entries.set(m[2] as string, m[1] as string);
  }
  return entries;
}

describe("vendored sf-skills snapshot", () => {
  it("every vendored file matches the sha256 recorded in VENDOR.md and no file is unlisted", () => {
    const listed = manifest();
    expect(listed.size).toBeGreaterThan(0);
    const onDisk = readdirSync(DIR).filter((f) => f !== "VENDOR.md").sort();
    expect(onDisk).toEqual([...listed.keys()].sort());
    for (const [file, hash] of listed) {
      expect(createHash("sha256").update(readFileSync(`${DIR}${file}`)).digest("hex"), file).toBe(hash);
    }
  });

  it("the vendored set is the object list minus the objects recorded as missing upstream", () => {
    const objects = JSON.parse(readFileSync(`${ROOT}objects.json`, "utf8")) as string[];
    const missingLine = /^Missing upstream: (.*)$/m.exec(vendorMd)?.[1] ?? "";
    const missing = missingLine === "none" ? [] : missingLine.split(" ").filter(Boolean);
    const present = readdirSync(DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length))
      .sort();
    expect(present).toEqual(objects.filter((o) => !missing.includes(o)).sort());
  });
});
