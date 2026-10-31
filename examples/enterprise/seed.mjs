#!/usr/bin/env node
// Seeds the enterprise custom settings over REST. Custom-setting data is not part of a retrieve
// (ACC2-01), so the fixture ships none; this script creates it and proves that a $Setup formula
// reads the user-level hierarchy row ahead of the org default.
//
// Usage:
//   BASE_URL=http://localhost:8093 TOKEN=<access_token> node examples/enterprise/seed.mjs
// Env: BASE_URL, TOKEN (required), API_VERSION (default v62.0).

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const TOKEN = process.env.TOKEN;
const API = process.env.API_VERSION || 'v62.0';

if (!TOKEN) {
  console.error('TOKEN env var required (an orglet access token)');
  process.exit(1);
}

async function req(method, path, body) {
  const res = await fetch(`${BASE}/services/data/${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  return json;
}

const query = (q) => req('GET', `/query?q=${encodeURIComponent(q)}`);
let failed = 0;
async function step(name, fn) {
  try {
    const detail = await fn();
    console.log(`ok ${name}${detail ? ` ${detail}` : ''}`);
  } catch (err) {
    failed++;
    console.log(`FAIL ${name} ${err instanceof Error ? err.message : String(err)}`);
  }
}
function must(cond, msg) {
  if (!cond) throw new Error(msg);
}

await step('org-default', async () => {
  const r = await req('POST', '/sobjects/Org_Defaults__c', { Default_Region__c: 'EU', Discount_Cap__c: 15 });
  must(r.success, JSON.stringify(r));
});

await step('user-row', async () => {
  const users = await query("SELECT Id FROM User WHERE Username='admin@orglet.local'");
  must(users.totalSize === 1, `expected one admin user, got ${users.totalSize}`);
  const r = await req('POST', '/sobjects/Org_Defaults__c', {
    SetupOwnerId: users.records[0].Id,
    Default_Region__c: 'NORDICS',
    Discount_Cap__c: 20,
  });
  must(r.success, JSON.stringify(r));
});

await step('list-rows', async () => {
  for (const row of [{ Name: 'SE', Dial_Prefix__c: '+46' }, { Name: 'NO', Dial_Prefix__c: '+47' }]) {
    const r = await req('POST', '/sobjects/Country_Code__c', row);
    must(r.success, JSON.stringify(r));
  }
});

await step('setup-formula-reads-user-row', async () => {
  const created = await req('POST', '/sobjects/Service_Order__c', { Name: 'seed-check' });
  must(created.success, JSON.stringify(created));
  try {
    const rows = await query(`SELECT Default_Region__c FROM Service_Order__c WHERE Id = '${created.id}'`);
    const value = rows.records[0]?.Default_Region__c;
    must(value === 'NORDICS', `expected NORDICS (user row), got ${String(value)}`);
    const count = await query('SELECT COUNT() FROM Country_Code__c');
    must(count.totalSize === 2, `expected 2 Country_Code__c rows, got ${count.totalSize}`);
    return `Default_Region__c=${value} countries=${count.totalSize}`;
  } finally {
    await req('DELETE', `/sobjects/Service_Order__c/${created.id}`);
  }
});

console.log(failed === 0 ? 'enterprise seed: ok' : `enterprise seed: ${failed} step(s) failed`);
process.exit(failed === 0 ? 0 : 1);
