import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadOrgSchema } from "@orglet/metadata";
import { blobKey, InlineBlobStore } from "./blobs.js";
import { Store } from "./store.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
const CS = "d41d8cd98f00b204e9800998ecf8427e";

describe("blobKey (FILE-09, D-13)", () => {
  it("builds the Heimdall files/<cs[0:4]>/<cs>.<ext> key", () => {
    expect(blobKey(CS, "pdf")).toBe(`files/d41d/${CS}.pdf`);
  });
  it("keeps the extension's case as given", () => {
    expect(blobKey(CS, "PDF").endsWith(".PDF")).toBe(true);
  });
  it("an empty extension yields a key without a trailing dot", () => {
    expect(blobKey(CS, "")).toBe(`files/d41d/${CS}`);
  });
  it("rejects uppercase hex", () => {
    expect(() => blobKey(CS.toUpperCase(), "pdf")).toThrow(RangeError);
  });
  it("rejects a checksum that is not exactly 32 characters", () => {
    expect(() => blobKey(CS.slice(1), "pdf")).toThrow(RangeError);
    expect(() => blobKey(CS + "0", "pdf")).toThrow(RangeError);
  });
  it("rejects path traversal and separators in either argument", () => {
    expect(() => blobKey("../../etc/passwd".padEnd(32, "0"), "pdf")).toThrow(RangeError);
    for (const ext of ["../x", "a/b", "a\\b", "/abs"]) expect(() => blobKey(CS, ext)).toThrow(RangeError);
  });
  it("rejects NUL and whitespace", () => {
    expect(() => blobKey(CS, "pd\u0000f")).toThrow(RangeError);
    expect(() => blobKey(CS, "p f")).toThrow(RangeError);
  });
  it("rejects an extension longer than 16 characters", () => {
    expect(() => blobKey(CS, "a".repeat(17))).toThrow(RangeError);
    expect(() => blobKey(CS, "a".repeat(16))).not.toThrow();
  });
  it("InlineBlobStore is the inline kind", async () => {
    const { schema } = await loadOrgSchema({ projectDir: ACME });
    expect(new InlineBlobStore(new Store(schema, "org")).kind).toBe("inline");
  });
});
