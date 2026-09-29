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
  },
});
