#!/usr/bin/env node
// cmdt-check, jsforce leg: describe, query, retrieve and relationship traversal on the custom metadata
// types of the fixture in ./project, the rejection of DML on a __mdt, and the custom-setting describe
// and hierarchy uniqueness. Checks: describe-mdt, query-values, retrieve, relationships,
// entity-definition-only, dml-rejected, setting-describe, hierarchy-duplicate. One PASS/FAIL line per
// check; exit 1 on any FAIL, 2 when the jsforce build is missing. App_Config__c rows it creates are
// deleted again at the end.
//
// Usage: BASE_URL=http://localhost:8095 node jsforce.mjs
// Env: BASE_URL (default http://localhost:8095), ORGLET_USERNAME (admin@orglet.local),
//      ORGLET_PASSWORD (x), API_VERSION (59.0). Needs Node 22 and the jsforce build that
//      ../jsforce/run.sh leaves in ../jsforce/.cache/jsforce.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'http://localhost:8095';
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
const failed = async (fn) => {
  try {
    const r = await fn();
    return r && r.success === false ? { rejected: true, result: r } : { rejected: false, result: r };
  } catch (err) {
    return { rejected: true, err };
  }
};

const created = [];
try {
  const desc = await conn.sobject('Support_Tier__mdt').describe();
  const q = await conn.query('SELECT Id, DeveloperName, MasterLabel, Code__c, Max_Seats__c, Is_Active__c, Region__c FROM Support_Tier__mdt ORDER BY DeveloperName');
  const byName = Object.fromEntries(q.records.map((r) => [r.DeveloperName, r]));
  const gold = byName.Gold;

  await check('describe-mdt', async () => {
    const names = desc.fields.map((f) => f.name);
    const need = ['Id', 'DeveloperName', 'MasterLabel', 'Label', 'Language', 'NamespacePrefix', 'QualifiedApiName', 'IsProtected', 'SystemModstamp'];
    const ok = !desc.createable && !desc.updateable && !desc.deletable && !desc.undeletable
      && desc.queryable && desc.retrieveable && desc.custom && desc.customSetting === false
      && String(desc.keyPrefix).startsWith('m')
      && need.every((n) => names.includes(n)) && !['Name', 'OwnerId', 'IsDeleted'].some((n) => names.includes(n));
    return [ok, { keyPrefix: desc.keyPrefix, createable: desc.createable, customSetting: desc.customSetting, missing: need.filter((n) => !names.includes(n)) }];
  });

  await check('query-values', async () => {
    const names = q.records.map((r) => r.DeveloperName);
    const ok = q.totalSize === 3 && same(names, ['Bronze', 'Gold', 'Silver'])
      && byName.Gold.Code__c === '007' && byName.Silver.Code__c === null
      && byName.Gold.Max_Seats__c === 50 && byName.Bronze.Max_Seats__c === null
      && byName.Silver.Region__c === null && byName.Bronze.Is_Active__c === false
      && byName.Silver.MasterLabel === 'Silver Tier'
      && q.records.every((r) => typeof r.Id === 'string' && r.Id.length === 18 && r.Id.startsWith(desc.keyPrefix));
    return [ok, { names, gold: gold && { code: gold.Code__c, seats: gold.Max_Seats__c }, ids: q.records.map((r) => r.Id) }];
  });

  await check('retrieve', async () => {
    const r = await conn.sobject('Support_Tier__mdt').retrieve(gold.Id);
    const ok = r.DeveloperName === 'Gold' && r.QualifiedApiName === 'Gold' && r.Label === 'Gold' && r.Language === 'en_US' && r.NamespacePrefix === null;
    return [ok, { DeveloperName: r.DeveloperName, QualifiedApiName: r.QualifiedApiName, Label: r.Label, Language: r.Language, NamespacePrefix: r.NamespacePrefix }];
  });

  await check('relationships', async () => {
    const t = await conn.query('SELECT DeveloperName, Tier_Group__c, Tier_Group__r.DeveloperName, Target_Object__c, Target_Object__r.QualifiedApiName, Target_Field__c FROM Support_Tier__mdt ORDER BY DeveloperName');
    const g = await conn.query('SELECT DeveloperName, Default_Tier__r.DeveloperName FROM Tier_Group__mdt ORDER BY DeveloperName');
    const tb = Object.fromEntries(t.records.map((r) => [r.DeveloperName, r]));
    const gb = Object.fromEntries(g.records.map((r) => [r.DeveloperName, r]));
    const ok = tb.Gold.Tier_Group__r?.DeveloperName === 'Premium' && tb.Gold.Target_Object__c === 'Account'
      && tb.Gold.Target_Object__r?.QualifiedApiName === 'Account' && tb.Gold.Target_Field__c === 'Account.Industry'
      && tb.Bronze.Tier_Group__c === null && tb.Bronze.Target_Object__c === null && tb.Bronze.Target_Field__c === null
      && gb.Premium.Default_Tier__r?.DeveloperName === 'Gold' && gb.Standard.Default_Tier__r?.DeveloperName === 'Silver';
    return [ok, { gold: tb.Gold, bronze: tb.Bronze, premium: gb.Premium?.Default_Tier__r, standard: gb.Standard?.Default_Tier__r }];
  });

  await check('entity-definition-only', async () => {
    try {
      await conn.query('SELECT Target_Object__r.Label FROM Support_Tier__mdt');
      return [false, 'query was accepted'];
    } catch (err) {
      const ok = err.errorCode === 'INVALID_FIELD' && String(err.message).includes('UNSUPPORTED:entity-definition');
      return [ok, { errorCode: err.errorCode, message: err.message }];
    }
  });

  await check('dml-rejected', async () => {
    const sobj = conn.sobject('Support_Tier__mdt');
    const c = await failed(() => sobj.create({ DeveloperName: 'Probe', MasterLabel: 'Probe' }));
    const u = await failed(() => sobj.update({ Id: gold.Id, MasterLabel: 'Changed' }));
    const d = await failed(() => sobj.destroy(gold.Id));
    const count = await conn.query('SELECT COUNT() FROM Support_Tier__mdt');
    const after = await sobj.retrieve(gold.Id);
    const ok = c.rejected && u.rejected && d.rejected && count.totalSize === 3 && after.MasterLabel === 'Gold';
    return [ok, { create: c.rejected, update: u.rejected, delete: d.rejected, count: count.totalSize, label: after.MasterLabel }];
  });

  await check('setting-describe', async () => {
    const app = await conn.sobject('App_Config__c').describe();
    const list = await conn.sobject('Region_List__c').describe();
    const names = (d) => d.fields.map((f) => f.name);
    const setupOwner = app.fields.find((f) => f.name === 'SetupOwnerId');
    const ok = app.customSetting === true && list.customSetting === true
      && !names(app).includes('OwnerId') && !names(list).includes('OwnerId')
      && same([...(setupOwner?.referenceTo ?? [])].sort(), ['Organization', 'Profile', 'User'])
      && !names(list).includes('SetupOwnerId');
    return [ok, { app: app.customSetting, list: list.customSetting, referenceTo: setupOwner?.referenceTo }];
  });

  await check('hierarchy-duplicate', async () => {
    const first = await conn.sobject('App_Config__c').create({ Feature_Enabled__c: true });
    if (!first.success) return [false, { first }];
    created.push(first.id);
    const second = await failed(() => conn.sobject('App_Config__c').create({ Endpoint__c: 'https://example.invalid' }));
    if (!second.rejected) created.push(second.result.id);
    const errorCode = second.err?.errorCode ?? second.result?.errors?.[0]?.statusCode;
    const rows = await conn.query('SELECT SetupOwnerId FROM App_Config__c');
    const ok = second.rejected && errorCode === 'DUPLICATE_VALUE' && rows.totalSize === 1 && String(rows.records[0].SetupOwnerId).startsWith('00D');
    return [ok, { errorCode, rows: rows.records.map((r) => r.SetupOwnerId) }];
  });
} catch (err) {
  console.log(`FAIL setup ${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`);
  results.push(false);
} finally {
  for (const id of created) await conn.sobject('App_Config__c').destroy(id).catch(() => {});
}

const passed = results.filter(Boolean).length;
console.log(`jsforce: ${passed}/8 passed`);
process.exit(passed === 8 && results.length === 8 ? 0 : 1);
