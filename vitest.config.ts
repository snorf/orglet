import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: Object.fromEntries(
      ["sigha", "metadata", "schema", "formula", "soql", "engine", "api", "cli"].map((n) => [
        `@orglet/${n}`,
        pkg(n),
      ]),
    ),
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    // Schema migrations against Postgres in Docker take a few seconds per test file.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // A v2 org schema holds ~500 relations and ~190 foreign keys, and migrate() creates them in one transaction
    // (~700 locks). Many files migrating or dropping schemas at once exhaust a default Postgres lock table
    // (max_locks_per_transaction 64 x 100 connections: "out of shared memory"). pglite is per file and unaffected.
    ...(process.env["ORGLET_DATABASE_URL"] ? { maxWorkers: 3 } : {}),
  },
});
