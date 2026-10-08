#!/usr/bin/env node
// poly-check, jsforce leg: creates a Queue (Group), a Group-owned Case and a User-owned Case in a
// running orglet, then checks a Name-object query, a Owner.Type filter, a TYPEOF query and the
// rejection of an invalid TYPEOF through jsforce. One PASS/FAIL line per check; exit 1 on any
// FAIL, 2 when the jsforce build is missing. The records are deleted again at the end.
//
// Usage: BASE_URL=http://localhost:8082 node jsforce.mjs
// Env: BASE_URL (default http://localhost:8081), ORGLET_USERNAME (admin@orglet.local),
//      ORGLET_PASSWORD (x), API_VERSION (59.0). Needs Node 22 and the jsforce build that
//      ../jsforce/run.sh leaves in ../jsforce/.cache/jsforce.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
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

const tag = `poly-check-${Date.now()}`;
const groupName = `PolyCheck Queue ${tag}`;
const keysOf = (o) => Object.keys(o);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const results = [];
const check = async (name, fn) => {
  try {
    const [ok, detail] = await fn();
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  } catch (err) {
    results.push(false);
    console.log(`FAIL ${name} ${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`);
  }
};

const created = { cases: [], group: null };
try {
  const g = await conn.sobject('Group').create({ Name: groupName, DeveloperName: `PolyCheck_${Date.now()}`, Type: 'Queue' });
  if (!g.success) throw new Error(`Group create failed: ${JSON.stringify(g)}`);
  created.group = g.id;
  const gc = await conn.sobject('Case').create({ Subject: `group ${tag}`, OwnerId: g.id });
  if (!gc.success) throw new Error(`Case create failed: ${JSON.stringify(gc)}`);
  created.cases.push(gc.id);
  const uc = await conn.sobject('Case').create({ Subject: `user ${tag}` });
  if (!uc.success) throw new Error(`Case create failed: ${JSON.stringify(uc)}`);
  created.cases.push(uc.id);

  await check('name-object', async () => {
    const r = await conn.query(`SELECT Subject, Owner.Name, Owner.Email, Owner.Type FROM Case WHERE Subject LIKE '%${tag}' ORDER BY Subject`);
    const [grp, usr] = r.records;
    const ok = r.records.length === 2
      && grp.Owner.attributes.type === 'Group' && grp.Owner.Name === groupName && grp.Owner.Email === null && grp.Owner.Type === 'Group'
      && usr.Owner.attributes.type === 'User' && usr.Owner.Type === 'User';
    return [ok, { group: grp?.Owner, user: usr?.Owner }];
  });

  await check('type-filter', async () => {
    const r = await conn.query(`SELECT Id FROM Case WHERE Owner.Type = 'Group' AND Subject LIKE '%${tag}'`);
    const ids = r.records.map((x) => x.Id);
    return [same(ids, [gc.id]), { ids, expected: [gc.id] }];
  });

  await check('typeof', async () => {
    const r = await conn.query(`SELECT Subject, TYPEOF Owner WHEN User THEN Alias WHEN Group THEN Name, Type END FROM Case WHERE Subject LIKE '%${tag}' ORDER BY Subject`);
    const [grp, usr] = r.records;
    const ok = r.records.length === 2
      && same(keysOf(grp.Owner), ['attributes', 'Name', 'Type']) && grp.Owner.Type === 'Queue'
      && same(keysOf(usr.Owner), ['attributes', 'Alias']);
    return [ok, { group: keysOf(grp?.Owner ?? {}), groupType: grp?.Owner?.Type, user: keysOf(usr?.Owner ?? {}) }];
  });

  await check('typeof-invalid', async () => {
    try {
      await conn.query('SELECT COUNT(), TYPEOF Owner WHEN User THEN Name END FROM Case');
      return [false, 'query was accepted'];
    } catch (err) {
      const ok = err.errorCode === 'MALFORMED_QUERY' && String(err.message).includes('such as COUNT()');
      return [ok, { errorCode: err.errorCode, message: err.message }];
    }
  });
} catch (err) {
  console.log(`FAIL setup ${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`);
  results.push(false);
} finally {
  for (const id of created.cases) await conn.sobject('Case').destroy(id).catch(() => {});
  if (created.group) await conn.sobject('Group').destroy(created.group).catch(() => {});
}

const passed = results.filter(Boolean).length;
console.log(`jsforce: ${passed}/4 passed`);
process.exit(passed === 4 && results.length === 4 ? 0 : 1);
