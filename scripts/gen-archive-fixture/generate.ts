/**
 * IO shell of the archive fixture generator, run by `pnpm archive-fixture:gen`; `--check` regenerates in memory and exits 1 listing every differing, missing or stray file under examples/acme-archive (Phase 16 D-15, mirrors baseline:check). CI wiring is FIX-02.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFixture } from "./build.js";
import type { FixtureFiles } from "./build.js";
import { FixtureLeakError } from "./guard.js";
import { diffTree, writeTree } from "./tree.js";

const OUT = join(fileURLToPath(new URL("../../", import.meta.url)), "examples", "acme-archive");

async function main(): Promise<void> {
  let files: FixtureFiles;
  try {
    files = await buildFixture();
  } catch (err) {
    if (err instanceof FixtureLeakError) {
      console.error(err.message);
      console.error("nothing written: the fixture generator produced an Id or datetime it does not own");
    } else {
      console.error(err instanceof Error ? err.message : String(err));
    }
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes("--check")) {
    const problems = diffTree(files, OUT);
    if (problems.length > 0) {
      for (const p of problems) console.error(p);
      console.error("archive fixture drift: run `pnpm archive-fixture:gen` and commit the result");
      process.exitCode = 1;
      return;
    }
    console.log(`checked ${files.size} files`);
    return;
  }

  writeTree(files, OUT);
  const strays = diffTree(files, OUT).filter((p) => p.startsWith("stray"));
  if (strays.length > 0) {
    for (const p of strays) console.error(p);
    console.error("stray files under examples/acme-archive: remove them (they are not generated)");
    process.exitCode = 1;
    return;
  }
  console.log(`wrote ${files.size} files`);
}

void main();
