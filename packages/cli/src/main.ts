/**
 * orglet command line.
 *
 *   orglet up [--project <dir>] [--port 8080] [--db <url>] [--org-schema org] [--force] [--permissive|--users user:pass,...]
 *   orglet reset [--db <url>] [--org-schema org]
 *   orglet check [--project <dir>]
 */
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { loadOrgSchema } from "@orglet/metadata";
import { createPool, databaseUrlFromEnv, migrate, quote, DEFAULT_ORG_SCHEMA } from "@orglet/schema";
import { bootstrapOrg, DmlEngine, FormulaRegistry } from "@orglet/engine";
import { createApiServer, type AuthConfig } from "@orglet/api";

const USAGE = `orglet - a self-hosted, Salesforce-compatible org

Usage:
  orglet up [--project <sfdx-dir>] [--port <n>] [--db <postgres-url>] [--org-schema <name>] [--force] [--users u:p,...]
  orglet check [--project <sfdx-dir>]
  orglet reset [--db <postgres-url>] [--org-schema <name>]

Options:
  --project     SFDX project directory (sfdx-project.json or a folder with objects/). Optional.
  --port        HTTP port (default 8080, or PORT)
  --db          Postgres URL (default ORGLET_DATABASE_URL or postgres://orglet:orglet@localhost:5433/orglet)
  --org-schema  Postgres schema holding the org tables (default "org")
  --force       Allow the migration to drop columns/tables and narrow types
  --users       Comma-separated username:password pairs; without it any password is accepted
  --quiet       Only print errors
`;

interface Common {
  db: string;
  orgSchema: string;
  project?: string;
  quiet: boolean;
}

function common(values: Record<string, string | boolean | undefined>): Common {
  const c: Common = {
    db: typeof values["db"] === "string" ? values["db"] : databaseUrlFromEnv(),
    orgSchema: typeof values["org-schema"] === "string" ? values["org-schema"] : DEFAULT_ORG_SCHEMA,
    quiet: values["quiet"] === true,
  };
  if (typeof values["project"] === "string") c.project = resolve(values["project"]);
  return c;
}

function log(c: { quiet: boolean }, ...args: unknown[]): void {
  if (!c.quiet) console.log(...args);
}

async function check(c: Common): Promise<number> {
  const result = await loadOrgSchema(c.project ? { projectDir: c.project } : {});
  const objects = result.schema.list();
  log(c, `${objects.length} objects (${objects.filter((o) => o.custom).length} custom), ${objects.reduce((n, o) => n + o.fields.length, 0)} fields`);
  for (const w of result.warnings) console.warn(`warning: ${w}`);
  for (const w of new FormulaRegistry(result.schema).warnings) console.warn(`warning: ${w}`);
  return 0;
}

async function up(c: Common, port: number, force: boolean, auth: AuthConfig): Promise<number> {
  const loaded = await loadOrgSchema(c.project ? { projectDir: c.project } : {});
  for (const w of loaded.warnings) console.warn(`warning: ${w}`);
  const pool = createPool(c.db);
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    console.error(`cannot reach Postgres at ${c.db}: ${(err as Error).message}`);
    console.error("start one with: docker compose up -d postgres   (or pass --db)");
    return 1;
  }
  const migration = await migrate(pool, loaded.schema, { orgSchema: c.orgSchema, force });
  for (const w of migration.warnings) console.warn(`warning: ${w}`);
  const changes = migration.statements.filter((s) => /^(CREATE TABLE|ALTER TABLE .* (ADD|DROP|ALTER) COLUMN|DROP TABLE)/.test(s)).length;
  log(c, `schema "${c.orgSchema}": ${changes} change(s) applied`);

  const boot = await bootstrapOrg(pool, loaded.schema, { orgSchema: c.orgSchema });
  const engine = new DmlEngine(pool, loaded.schema, { orgSchema: c.orgSchema });
  for (const w of engine.warnings) console.warn(`warning: ${w}`);
  engine.bus.subscribe((events) => {
    if (process.env["ORGLET_EVENTS"] === "stdout") for (const e of events) console.log(JSON.stringify({ event: "change", ...e }));
  });

  const app = createApiServer({ engine, organizationId: boot.session.organizationId, recordTypeIds: boot.recordTypeIds, auth, logger: !c.quiet });
  await app.listen({ port, host: "0.0.0.0" });
  log(c, "");
  log(c, `orglet is up on http://localhost:${port}`);
  log(c, `  organization ${boot.session.organizationId}`);
  log(c, `  user         admin@orglet.local (${boot.session.userId})${auth.mode === "permissive" ? ", any password" : ""}`);
  log(c, `  login        POST /services/Soap/u/59.0  or  POST /services/oauth2/token (grant_type=password)`);
  log(c, `  objects      ${loaded.schema.list().length} (${loaded.schema.list().filter((o) => o.custom).length} custom)`);
  const shutdown = async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  return -1; // keep running
}

async function reset(c: Common): Promise<number> {
  const pool = createPool(c.db);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${quote(c.orgSchema)} CASCADE`);
    log(c, `dropped schema "${c.orgSchema}"`);
    return 0;
  } finally {
    await pool.end();
  }
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      project: { type: "string" },
      port: { type: "string" },
      db: { type: "string" },
      "org-schema": { type: "string" },
      force: { type: "boolean" },
      users: { type: "string" },
      quiet: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    console.log(USAGE);
    return command ? 0 : 1;
  }
  const c = common(values);
  switch (command) {
    case "up": {
      const port = Number(values.port ?? process.env["PORT"] ?? 8080);
      const auth: AuthConfig = values.users
        ? { mode: "list", users: values.users.split(",").map((pair) => ({ username: pair.split(":")[0] ?? "", password: pair.split(":").slice(1).join(":") })) }
        : { mode: "permissive" };
      return up(c, port, values.force === true, auth);
    }
    case "check":
      return check(c);
    case "reset":
      return reset(c);
    default:
      console.error(`unknown command: ${command}\n`);
      console.log(USAGE);
      return 1;
  }
}
