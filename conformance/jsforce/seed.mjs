#!/usr/bin/env node
// Seeds an orglet org with the fixture data the jsforce e2e subset needs
// beyond the SFDX metadata in examples/acme (which only defines the
// BigTable__c / UpsertTable__c objects/fields, not any records).
//
// A real Salesforce scratch org used by upstream jsforce e2e tests is
// created with `hasSampleData: true` (see the upstream
// test/org-setup/project-scratch-def.json) and its BigTable__c is bulk
// loaded with 5 x 5001 rows by scripts/org-setup.mjs. orglet has no
// equivalent of either, so this script does the minimum needed for the
// query.test.ts "big tables and autoFetch" describe block (needs >2000
// BigTable__c rows to exercise queryMore/autoFetch paging) and for
// sobject.test.ts's relationship-based find/select/sort tests (needs
// Accounts with related Contacts and Opportunities) to have real data to
// run against, using orglet's SObject Collections API
// (POST/DELETE /composite/sobjects) since the Bulk API is not implemented.
//
// Usage:
//   BASE_URL=http://localhost:8081 TOKEN=<access_token> node seed.mjs

const BASE = process.env.BASE_URL || 'http://localhost:8081';
const TOKEN = process.env.TOKEN;
const API = process.env.API_VERSION || 'v62.0';
const BIGTABLE_COUNT = Number(process.env.BIGTABLE_COUNT || 2500);
const ACCOUNT_COUNT = Number(process.env.ACCOUNT_COUNT || 8);

if (!TOKEN) {
  console.error('TOKEN env var required (an orglet access token)');
  process.exit(1);
}

async function req(method, path, body) {
  const res = await fetch(`${BASE}/services/data/${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (res.status >= 400) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  }
  return json;
}

async function insertCollection(records) {
  const results = [];
  for (let i = 0; i < records.length; i += 200) {
    const batch = records.slice(i, i + 200);
    const res = await req('POST', '/composite/sobjects', {
      allOrNone: false,
      records: batch,
    });
    results.push(...res);
    const failed = res.filter((r) => !r.success);
    if (failed.length) {
      console.error('failed records:', JSON.stringify(failed.slice(0, 3)));
    }
  }
  return results;
}

async function main() {
  const userQ = await req(
    'GET',
    `/query?q=${encodeURIComponent('SELECT Id FROM User LIMIT 1')}`,
  );
  const ownerId = userQ.records[0].Id;
  console.log('owner id:', ownerId);

  console.log(`seeding ${BIGTABLE_COUNT} BigTable__c records...`);
  const bigTableRecords = Array.from({ length: BIGTABLE_COUNT }, () => ({
    attributes: { type: 'BigTable__c' },
  }));
  const btRes = await insertCollection(bigTableRecords);
  console.log(
    `BigTable__c inserted: ${btRes.filter((r) => r.success).length}/${BIGTABLE_COUNT}`,
  );

  const accountNames = Array.from(
    { length: ACCOUNT_COUNT },
    (_, i) => `Seed Account ${String(i + 1).padStart(2, '0')}`,
  );
  const accountRecords = accountNames.map((Name) => ({
    attributes: { type: 'Account' },
    Name,
  }));
  const accRes = await insertCollection(accountRecords);
  const accountIds = accRes.map((r) => r.id);
  console.log(
    `Accounts inserted: ${accountIds.filter(Boolean).length}/${ACCOUNT_COUNT}`,
  );

  const contactRecords = [];
  accountIds.forEach((AccountId, ai) => {
    for (let c = 0; c < 2; c++) {
      contactRecords.push({
        attributes: { type: 'Contact' },
        AccountId,
        FirstName: `Con${ai}`,
        LastName: `Tact${ai}-${c}`,
      });
    }
  });
  const conRes = await insertCollection(contactRecords);
  console.log(
    `Contacts inserted: ${conRes.filter((r) => r.success).length}/${contactRecords.length}`,
  );

  const stages = [
    'Prospecting',
    'Qualification',
    'Proposal/Price Quote',
    'Closed Won',
  ];
  const oppRecords = [];
  accountIds.forEach((AccountId, ai) => {
    for (let o = 0; o < 2; o++) {
      const closeDate = new Date(Date.now() + (ai * 2 + o) * 86400000)
        .toISOString()
        .slice(0, 10);
      oppRecords.push({
        attributes: { type: 'Opportunity' },
        AccountId,
        OwnerId: ownerId,
        Name: `Seed Opp ${ai}-${o}`,
        StageName: stages[(ai + o) % stages.length],
        CloseDate: closeDate,
      });
    }
  });
  const oppRes = await insertCollection(oppRecords);
  console.log(
    `Opportunities inserted: ${oppRes.filter((r) => r.success).length}/${oppRecords.length}`,
  );

  console.log('seed complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
