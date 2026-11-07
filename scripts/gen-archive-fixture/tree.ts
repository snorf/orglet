/**
 * Writes and compares the fixture tree; shared by the CLI and the determinism test.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FixtureFiles } from "./build.js";

const codeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function writeTree(files: FixtureFiles, dir: string): void {
  for (const [rel, content] of files) {
    const path = join(dir, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof content === "string" ? Buffer.from(content, "utf8") : content);
  }
}

/** Relative "/"-separated paths of every file under `dir`, code-unit sorted; [] when `dir` is missing. */
export function listTree(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    let entries;
    try {
      entries = readdirSync(join(dir, rel), { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT" && rel === "") return;
      throw err;
    }
    for (const e of entries) {
      const next = rel === "" ? e.name : `${rel}/${e.name}`;
      if (e.isDirectory()) walk(next);
      else out.push(next);
    }
  };
  walk("");
  return out.sort(codeUnit);
}

/** Sorted `missing:`, `differs:` and `stray (not generated):` lines; never contents. */
export function diffTree(files: FixtureFiles, dir: string): string[] {
  const problems: string[] = [];
  const existing = new Set(listTree(dir));
  for (const [rel, content] of files) {
    if (!existing.has(rel)) {
      problems.push(`missing: ${rel}`);
      continue;
    }
    const want = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    if (Buffer.compare(readFileSync(join(dir, rel)), want) !== 0) problems.push(`differs: ${rel}`);
  }
  for (const rel of existing) if (!files.has(rel)) problems.push(`stray (not generated): ${rel}`);
  return problems.sort(codeUnit);
}
