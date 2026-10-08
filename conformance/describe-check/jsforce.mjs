#!/usr/bin/env node
// describe-check, jsforce leg: runs describeGlobal(), describe() and sobject().describe() through
// jsforce for each object in objects.txt (or the names given as arguments) against a running
// orglet, and checks every property in contract.json. One PASS/FAIL line per object; exit 1 on
// any FAIL, 2 when the jsforce build is missing.
//
// Usage: BASE_URL=http://localhost:8081 node jsforce.mjs [Object ...]
// Env: BASE_URL (default http://localhost:8081), ORGLET_USERNAME (admin@orglet.local),
//      ORGLET_PASSWORD (x), API_VERSION (59.0). Needs Node 22 and the jsforce build that
//      ../jsforce/run.sh leaves in ../jsforce/.cache/jsforce.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'http://localhost:8081';
const USERNAME = process.env.ORGLET_USERNAME || 'admin@orglet.local';
const PASSWORD = process.env.ORGLET_PASSWORD || 'x';
const API_VERSION = process.env.API_VERSION || '59.0';
const JSFORCE = join(HERE, '..', 'jsforce', '.cache', 'jsforce');

if (!existsSync(join(JSFORCE, 'package.json'))) {
  console.error(`jsforce build not found at ${JSFORCE}; run conformance/jsforce/run.sh once to clone and build it`);
  process.exit(2);
}
const jsforce = createRequire(import.meta.url)(JSFORCE);
const contract = JSON.parse(readFileSync(join(HERE, 'contract.json'), 'utf8'));
const listed = readFileSync(join(HERE, 'objects.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const objects = process.argv.length > 2 ? process.argv.slice(2) : listed;

const missing = (obj, keys) => keys.filter((k) => obj === null || typeof obj !== 'object' || !(k in obj));

function problemsFor(name, globalEntry, d) {
  const p = [];
  if (!globalEntry) p.push('missing from describeGlobal().sobjects');
  else p.push(...missing(globalEntry, contract.globalSObjectKeys).map((k) => `global.${k}`));
  p.push(...missing(d, [...contract.globalSObjectKeys, ...contract.sobjectDescribeKeys]).map((k) => `describe.${k}`));
  if (d.name !== name) p.push(`describe.name is ${d.name}`);
  if (typeof d.keyPrefix !== 'string' || d.keyPrefix.length !== 3) p.push(`keyPrefix ${d.keyPrefix}`);
  p.push(...missing(d.urls, contract.urlKeys).map((k) => `urls.${k}`));
  const fields = Array.isArray(d.fields) ? d.fields : [];
  for (const f of fields) p.push(...missing(f, contract.fieldKeys).map((k) => `fields.${f.name}.${k}`));
  for (const s of contract.systemFields) if (fields.filter((f) => f.name === s).length !== 1) p.push(`system field ${s}`);
  const nameFields = fields.filter((f) => f.nameField === true);
  if (nameFields.length > 1) p.push(`${nameFields.length} nameField fields`);
  for (const c of Array.isArray(d.childRelationships) ? d.childRelationships : []) p.push(...missing(c, contract.childRelationshipKeys).map((k) => `childRelationships.${c.childSObject}.${k}`));
  return p;
}

const login = await fetch(`${BASE}/services/oauth2/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'password', username: USERNAME, password: PASSWORD }),
});
if (!login.ok) {
  console.error(`login failed: HTTP ${login.status} ${await login.text()}`);
  process.exit(1);
}
const { access_token: accessToken } = await login.json();
const conn = new jsforce.Connection({ instanceUrl: BASE, accessToken, version: API_VERSION });
const global = await conn.describeGlobal();

let failed = 0;
for (const name of objects) {
  try {
    const d = await conn.describe(name);
    const viaSObject = await conn.sobject(name).describe();
    const p = problemsFor(name, global.sobjects.find((s) => s.name === name), d);
    if (viaSObject.name !== name) p.push(`sobject().describe() returned ${viaSObject.name}`);
    if (p.length > 0) {
      failed++;
      console.log(`FAIL ${name} ${p.join('; ')}`);
    } else {
      const nf = d.fields.find((f) => f.nameField === true)?.name ?? '-';
      console.log(`PASS ${name} keyPrefix=${d.keyPrefix} nameField=${nf} fields=${d.fields.length} childRelationships=${d.childRelationships.length}`);
    }
  } catch (err) {
    failed++;
    console.log(`FAIL ${name} ${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`);
  }
}
console.log(`jsforce: ${objects.length - failed}/${objects.length} passed`);
process.exit(failed > 0 ? 1 : 0);
