#!/usr/bin/env node
// rollup-check, jsforce leg: creates an Account, a Project__c and two Milestone__c in a running
// orglet, then checks the roll-up describe flags, live recompute on insert, a SOQL filter and sort
// over a roll-up column, the rejection of a direct write and the recompute on delete through
// jsforce. One PASS/FAIL line per check; exit 1 on any FAIL, 2 when the jsforce build is missing.
// The records are deleted again at the end.
//
// Usage: BASE_URL=http://localhost:8083 node jsforce.mjs
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

const tag = `rollup-check-${Date.now()}`;
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
const must = (r, what) => {
  if (!r.success) throw new Error(`${what} failed: ${JSON.stringify(r)}`);
  return r.id;
};

let acct = null;
try {
  acct = must(await conn.sobject('Account').create({ Name: `RollupCheck ${tag}` }), 'Account create');
  const proj = must(await conn.sobject('Project__c').create({ Name: `RC Project ${tag}`, Account__c: acct, Budget__c: 120, Status__c: 'Active' }), 'Project__c create');
  const open = must(await conn.sobject('Milestone__c').create({ Project__c: proj, Due_Date__c: '2026-06-01' }), 'Milestone__c create');
  must(await conn.sobject('Milestone__c').create({ Project__c: proj, Due_Date__c: '2026-07-01', Done__c: true }), 'Milestone__c create');

  const projCounts = async () => (await conn.query(`SELECT Milestone_Count__c, Open_Milestones__c FROM Project__c WHERE Id = '${proj}'`)).records[0];

  await check('describe-flags', async () => {
    const flags = (f) => ({ calculated: f?.calculated, createable: f?.createable, updateable: f?.updateable });
    const want = { calculated: true, createable: false, updateable: false };
    const p = (await conn.sobject('Project__c').describe()).fields.find((f) => f.name === 'Milestone_Count__c');
    const a = (await conn.sobject('Account').describe()).fields.find((f) => f.name === 'Total_Budget__c');
    return [same(flags(p), want) && same(flags(a), want), { Milestone_Count__c: flags(p), Total_Budget__c: flags(a) }];
  });

  await check('recompute-insert', async () => {
    const p = await projCounts();
    const a = (await conn.query(`SELECT Total_Budget__c FROM Account WHERE Id = '${acct}'`)).records[0];
    return [p.Milestone_Count__c === 2 && p.Open_Milestones__c === 1 && a.Total_Budget__c === 120,
      { Milestone_Count__c: p.Milestone_Count__c, Open_Milestones__c: p.Open_Milestones__c, Total_Budget__c: a.Total_Budget__c }];
  });

  await check('soql-filter-sort', async () => {
    const r = await conn.query(`SELECT Id, Milestone_Count__c FROM Project__c WHERE Milestone_Count__c > 1 AND Name LIKE '%${tag}' ORDER BY Milestone_Count__c DESC`);
    const ids = r.records.map((x) => x.Id);
    return [same(ids, [proj]), { ids, expected: [proj] }];
  });

  await check('write-rejected', async () => {
    let code;
    try {
      const r = await conn.sobject('Project__c').update({ Id: proj, Milestone_Count__c: 99 });
      code = r.success ? undefined : r.errors?.[0]?.errorCode ?? r.errors?.[0]?.statusCode;
    } catch (err) {
      code = err.errorCode;
    }
    const after = (await projCounts()).Milestone_Count__c;
    return [code === 'INVALID_FIELD_FOR_INSERT_UPDATE' && after === 2, { errorCode: code, Milestone_Count__c: after }];
  });

  await check('recompute-delete', async () => {
    await conn.sobject('Milestone__c').destroy(open);
    const p = await projCounts();
    return [p.Milestone_Count__c === 1 && p.Open_Milestones__c === 0, { Milestone_Count__c: p.Milestone_Count__c, Open_Milestones__c: p.Open_Milestones__c }];
  });
} catch (err) {
  console.log(`FAIL setup ${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`);
  results.push(false);
} finally {
  if (acct) await conn.sobject('Account').destroy(acct).catch(() => {});
}

const passed = results.filter(Boolean).length;
console.log(`jsforce: ${passed}/5 passed`);
process.exit(passed === 5 && results.length === 5 ? 0 : 1);
