---
phase: quick-261012-leq
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/metadata/src/xml.ts
  - packages/metadata/src/sfdx.ts
  - packages/metadata/src/sfdx.test.ts
autonomous: true
requirements: [QUICK-261012-leq]

must_haves:
  truths:
    - "An SFDX project whose objects/<Name>/<Name>.object-meta.xml is an empty <CustomObject .../> (self-closing, open+close with no body, or whitespace-only body) loads without throwing, and the object's fields from fields/*.field-meta.xml are read"
    - "An object file whose root element is genuinely wrong (e.g. <CustomField> in a .object-meta.xml) still throws, and the message names the offending file path"
    - "Existing conformance/unit suites stay green and `orglet check --strict --project examples/acme` still passes"
  artifacts:
    - path: "packages/metadata/src/xml.ts"
      provides: "parseMetadataXml treating an empty root (parsed as \"\") as an empty node, with optional file context in the error"
      contains: "if (root === \"\") return {};"
    - path: "packages/metadata/src/sfdx.ts"
      provides: "readObjectDir passes objFile to parseMetadataXml so errors name the file"
      contains: "parseMetadataXml(await readFile(objFile, \"utf8\"), \"CustomObject\", objFile)"
    - path: "packages/metadata/src/sfdx.test.ts"
      provides: "regression tests for empty object file and wrong-root error path"
      contains: "empty <CustomObject/>"
  key_links:
    - from: "packages/metadata/src/sfdx.ts readObjectDir"
      to: "packages/metadata/src/xml.ts parseMetadataXml"
      via: "third argument objFile"
      pattern: "\"CustomObject\", objFile\\)"
---

<objective>
Make `parseMetadataXml` accept an empty metadata root element and make the object-file parse error name the file.

Purpose: `sf project retrieve` writes empty object files such as `<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"/>` for standard objects when only their fields / validation rules / record types were retrieved. fast-xml-parser (`parseTagValue: false, trimValues: true`) parses an empty root as the string `""`, so `parseMetadataXml` currently throws `Expected <CustomObject> root element, found: CustomObject` (confusing: the root IS CustomObject) and a large real retrieve dies on the first such file without saying which one.
Output: fixed `xml.ts`, error context in `sfdx.ts`, two new regression tests in `sfdx.test.ts`.

Diagnosis (already verified by reproduction, do not re-investigate): `{"CustomObject": ""}` is returned for `<CustomObject xmlns="..."/>`, `<CustomObject ...></CustomObject>` and a whitespace-only body. `str()`, `list()`, `child()` in xml.ts already handle `{}` correctly, so returning `{}` makes `readObjectDir` produce a label-less object (label/pluralLabel/etc. left unset, exactly as when the object file is absent) with the fields read from the directory.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@packages/metadata/src/xml.ts
@packages/metadata/src/sfdx.ts
@packages/metadata/src/sfdx.test.ts

Environment rules (mandatory):
- Node 22 is NOT the shell default. Prefix EVERY command that runs node/pnpm/vitest with
  `export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && ...`
- Branch `gsd/quick-261012-leq-empty-metadata-root` is already checked out. Commit locally with the repo-local identity (Johan Karlsteen <johan@karlsteen.com>). NEVER push.
- Never read or reference ~/Tele2.nosync or ~/Development.nosync/devrandom-metadata. Tests use temp-dir fixtures written by the test (existing `project()` helper).

<interfaces>
packages/metadata/src/xml.ts (internal module, NOT exported from packages/metadata/src/index.ts):
```typescript
export type XmlNode = Record<string, unknown>;
/** Parse a metadata XML document and return the single root element's content. */
export function parseMetadataXml(xml: string, expectedRoot: string): XmlNode;   // current
export function str(node: XmlNode, key: string): string | undefined;
export function list(node: XmlNode, key: string): XmlNode[];
export function child(node: XmlNode, key: string): XmlNode | undefined;
```

packages/metadata/src/sfdx.ts readObjectDir (lines 286-320), current call site:
```typescript
  const objFile = join(dir, `${name}.object-meta.xml`);
  try {
    const node = parseMetadataXml(await readFile(objFile, "utf8"), "CustomObject");
    ...
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
```
Note: parseField / parseValidationRule / parseRecordType called inside that same try already prefix their own errors with `${file}: ...`. That is why the file context is added at the parseMetadataXml call (third argument) rather than by re-wrapping everything in the catch — wrapping in the catch would double-prefix those messages and would turn `UnsupportedMetadataError` instances into plain `Error`s.

packages/metadata/src/sfdx.test.ts helpers:
```typescript
async function project(files: Record<string, string>): Promise<string>;   // writes files under a mkdtemp root
const field = (body: string) => `<?xml ...?><CustomField xmlns="http://soap.sforce.com/2006/04/metadata">${body}</CustomField>`;
import { readSourceProject } from "./sfdx.js";
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Accept empty metadata root and name the object file in parse errors (test first)</name>
  <files>packages/metadata/src/sfdx.test.ts, packages/metadata/src/xml.ts, packages/metadata/src/sfdx.ts</files>
  <read_first>
    - packages/metadata/src/xml.ts (whole file, 72 lines)
    - packages/metadata/src/sfdx.ts lines 286-333 (readObjectDir)
    - packages/metadata/src/sfdx.test.ts (whole file; reuse `project()` and `field()`)
  </read_first>
  <behavior>
    - Test A (invariant: an empty object file contributes no metadata but does not block its fields): for each of the three empty-root forms `<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"/>`, `<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"></CustomObject>`, `<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata">\n  \n</CustomObject>` (each preceded by `<?xml version="1.0" encoding="UTF-8"?>\n`), an `objects/Account/Account.object-meta.xml` with that content plus `objects/Account/fields/Foo__c.field-meta.xml` = `field("<fullName>Foo__c</fullName><type>Text</type><length>10</length>")` → `readSourceProject` resolves; `p.objects` has exactly one object named `Account`, `label` is undefined, fields map to `["Foo__c"]`, `validationRules` and `recordTypes` are `[]`, `p.warnings` is `[]`.
    - Test B (invariant: a wrong root still fails, and the failure names the file): `objects/Foo__c/Foo__c.object-meta.xml` = `field("<fullName>X__c</fullName>")` (a CustomField root in an object file) → `readSourceProject` rejects with a message matching both `Foo__c.object-meta.xml: ` and `Expected <CustomObject> root element, found: CustomField`.
    - Before the fix: Test A fails (throws `Expected <CustomObject> root element, found: CustomObject`), Test B fails (message lacks the file path).
  </behavior>
  <action>
RED: append these two tests inside the existing `describe("readSourceProject", ...)` block in packages/metadata/src/sfdx.test.ts (after the last `it`, before the closing `});`). Use exactly:

```typescript
  it.each([
    ["self-closing", "<CustomObject xmlns=\"http://soap.sforce.com/2006/04/metadata\"/>"],
    ["open and close", "<CustomObject xmlns=\"http://soap.sforce.com/2006/04/metadata\"></CustomObject>"],
    ["whitespace-only", "<CustomObject xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n  \n</CustomObject>"],
  ])("treats an empty <CustomObject/> (%s) as an object with no metadata of its own, still reading its fields", async (_form, objectXml) => {
    // `sf project retrieve` writes these for standard objects when only their children were retrieved.
    const root = await project({
      "objects/Account/Account.object-meta.xml": `<?xml version="1.0" encoding="UTF-8"?>\n${objectXml}`,
      "objects/Account/fields/Foo__c.field-meta.xml": field("<fullName>Foo__c</fullName><type>Text</type><length>10</length>"),
    });
    const p = await readSourceProject(root);
    expect(p.objects).toHaveLength(1);
    expect(p.objects[0]?.name).toBe("Account");
    expect(p.objects[0]?.label).toBeUndefined();
    expect(p.objects[0]?.fields.map((f) => f.fullName)).toEqual(["Foo__c"]);
    expect(p.objects[0]?.validationRules).toEqual([]);
    expect(p.objects[0]?.recordTypes).toEqual([]);
    expect(p.warnings).toEqual([]);
  });

  it("names the object file when its root element is not <CustomObject>", async () => {
    const root = await project({
      "objects/Foo__c/Foo__c.object-meta.xml": field("<fullName>X__c</fullName>"),
    });
    await expect(readSourceProject(root)).rejects.toThrow(/Foo__c\.object-meta\.xml: Expected <CustomObject> root element, found: CustomField/);
  });
```
Run the test file and confirm both new tests FAIL (the 3 it.each cases with "found: CustomObject", the last one because the message has no path). Commit: `test(quick-261012-leq): add failing tests for empty metadata root`.

GREEN, xml.ts: replace `parseMetadataXml` (lines 28-36) with exactly:

```typescript
/**
 * Parse a metadata XML document and return the single root element's content.
 * `file`, when given, prefixes the error so a failure in a large retrieve names the offending file.
 */
export function parseMetadataXml(xml: string, expectedRoot: string, file?: string): XmlNode {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const root = doc[expectedRoot];
  // An empty root (`<CustomObject xmlns="..."/>`, which `sf project retrieve` writes for standard
  // objects when only their fields/rules/record types were retrieved) parses as "": an empty node.
  if (root === "") return {};
  if (root === undefined || root === null || typeof root !== "object") {
    throw new Error(`${file ? `${file}: ` : ""}Expected <${expectedRoot}> root element, found: ${Object.keys(doc).join(", ") || "nothing"}`);
  }
  return root as XmlNode;
}
```

GREEN, sfdx.ts readObjectDir (line 292): change
`const node = parseMetadataXml(await readFile(objFile, "utf8"), "CustomObject");`
to
`const node = parseMetadataXml(await readFile(objFile, "utf8"), "CustomObject", objFile);`
Do NOT change the catch block and do NOT touch the CustomField / ValidationRule / RecordType / GlobalValueSet / StandardValueSet call sites (keep the change surgical; out of scope for this quick task). Do not wrap errors in the catch: parseField/parseValidationRule/parseRecordType already prefix `${file}: ` and wrapping would double-prefix them and lose the `UnsupportedMetadataError` class.

Run the test file: all tests pass. Commit: `fix(quick-261012-leq): treat empty metadata root as empty node and name object file in parse errors`.
  </action>
  <verify>
    <automated>cd /Users/johankarlsteen/Development.nosync/local-salesforce && export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && pnpm exec vitest run packages/metadata/src/sfdx.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `grep -c 'if (root === "") return {};' packages/metadata/src/xml.ts` returns 1
    - `grep -c 'file?: string' packages/metadata/src/xml.ts` returns 1
    - `grep -c '"CustomObject", objFile)' packages/metadata/src/sfdx.ts` returns 1
    - `grep -c 'if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;' packages/metadata/src/sfdx.ts` still returns 2 (catch blocks unchanged)
    - `grep -c 'empty <CustomObject/>' packages/metadata/src/sfdx.test.ts` returns 1 and `grep -c 'names the object file when its root element is not <CustomObject>' packages/metadata/src/sfdx.test.ts` returns 1
    - vitest run of sfdx.test.ts: all tests pass, including 3 it.each cases + the wrong-root case
    - `git log --oneline -2` shows a `test(...)` commit followed by a `fix(...)` commit
  </acceptance_criteria>
  <done>Empty object files in any of the three forms load as metadata-less objects with their directory fields; a wrong-root object file throws an error that starts with the file path; RED then GREEN commits recorded.</done>
</task>

<task type="auto">
  <name>Task 2: Full regression run (build, lint, test, acme strict check)</name>
  <files>(none modified; verification only, fix any regression in the Task 1 files)</files>
  <read_first>
    - packages/metadata/src/xml.ts (confirm Task 1 change is as specified)
  </read_first>
  <action>
Run from the repo root, each prefixed with `export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" &&`:
1. `pnpm build` (tsc -b; must succeed under strict + exactOptionalPropertyTypes; the new `file?: string` is a function parameter so exactOptionalPropertyTypes does not apply).
2. `pnpm lint` (must report 0 errors; the `_form` parameter in the it.each callback is allowed by the `^_` unused-vars ignore pattern).
3. `pnpm test` (whole workspace). If Postgres-backed tests fail with connection errors, run `pnpm db:up` first and re-run (local Docker only, nothing outward-facing). Report exact pass/fail/skip counts.
4. `node packages/cli/dist/index.js check --strict --project examples/acme` must exit 0.
If anything fails because of the Task 1 change, fix it in the Task 1 files and commit as `fix(quick-261012-leq): ...`. If something fails that is unrelated (pre-existing), do not fix it; record it verbatim in the SUMMARY. Do not push.
  </action>
  <verify>
    <automated>cd /Users/johankarlsteen/Development.nosync/local-salesforce && export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" && pnpm build && pnpm lint && pnpm test && node packages/cli/dist/index.js check --strict --project examples/acme</automated>
  </verify>
  <acceptance_criteria>
    - `pnpm build` exits 0
    - `pnpm lint` exits 0
    - `pnpm test` exits 0 with no newly failing or skipped tests compared to main
    - `node packages/cli/dist/index.js check --strict --project examples/acme` exits 0
    - `git status --porcelain` is empty after the run (no stray build artefacts committed or left modified in tracked files)
  </acceptance_criteria>
  <done>Build, lint, full test suite and acme strict check all green; results with counts recorded in SUMMARY.</done>
</task>

</tasks>

<verification>
- Empty `<CustomObject/>` in all three forms no longer throws; directory fields are still loaded.
- Wrong root in an object file throws `<path>/Foo__c.object-meta.xml: Expected <CustomObject> root element, found: CustomField`.
- No other call site of parseMetadataXml changed (`git diff main -- packages/metadata/src/sfdx.ts` shows a single-line change).
- Full build/lint/test/acme check green.
</verification>

<success_criteria>
- A real-org retrieve containing empty standard-object files loads past them.
- Parse failures in object files identify the file.
- No regressions; nothing pushed.
</success_criteria>

<output>
After completion, create `.planning/quick/261012-leq-fix-parsemetadataxml-so-an-empty-metadat/261012-leq-SUMMARY.md`
</output>
