#!/usr/bin/env node
// files-check, jsforce leg: uploads a ContentVersion as base64 JSON, reads it back through
// record(id).blob('VersionData'), adds a second version, queries ContentDocumentLink with and
// without the mandatory filter, and checks that a multipart create is refused as
// UNSUPPORTED:content-multipart (multipart upload is FILE-10, deferred). One PASS/FAIL line per
// check; exit 1 on any FAIL, 2 when the jsforce build is missing. Everything created is deleted
// again at the end.
//
// Usage: BASE_URL=http://localhost:8082 node jsforce.mjs
// Env: BASE_URL (default http://localhost:8081), ORGLET_USERNAME (admin@orglet.local),
//      ORGLET_PASSWORD (x), API_VERSION (59.0). Needs Node 22 and the jsforce build that
//      ../jsforce/run.sh leaves in ../jsforce/.cache/jsforce.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'http://localhost:8081';
const USERNAME = process.env.ORGLET_USERNAME || 'admin@orglet.local';
const PASSWORD = process.env.ORGLET_PASSWORD || 'x';
const API_VERSION = process.env.API_VERSION || '59.0';
const EXPECTED = 7;
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

const TEXT = `files-check ${Date.now()}\nline two, with non-ASCII: åäö\n`;
const TEXT_BYTES = Buffer.from(TEXT, 'utf8');
const b64 = (buf) => buf.toString('base64');

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

const created = { account: null, document: null };
try {
  const acct = await conn.sobject('Account').create({ Name: 'files-check' });
  if (!acct.success) throw new Error(`Account create failed: ${JSON.stringify(acct)}`);
  created.account = acct.id;

  let versionId = null;
  let documentId = null;

  await check('upload-json', async () => {
    const r = await conn.sobject('ContentVersion').create({
      Title: 'files-check',
      PathOnClient: 'files-check.txt',
      VersionData: b64(TEXT_BYTES),
      FirstPublishLocationId: acct.id,
    });
    versionId = r.id;
    return [r.success === true && Boolean(r.id), r];
  });
  if (!versionId) throw new Error('upload-json produced no ContentVersion; remaining checks cannot run');

  await check('computed-fields', async () => {
    const rec = await conn.sobject('ContentVersion').retrieve(versionId);
    documentId = rec.ContentDocumentId;
    created.document = documentId;
    const expectedUrl = `/services/data/v${API_VERSION}/sobjects/ContentVersion/${versionId}/VersionData`;
    const ok = rec.Checksum === createHash('md5').update(TEXT_BYTES).digest('hex')
      && rec.ContentSize === TEXT_BYTES.length
      && rec.FileType === 'TEXT'
      && rec.VersionNumber === '1'
      && rec.IsLatest === true
      && rec.VersionData === expectedUrl;
    return [ok, { Checksum: rec.Checksum, ContentSize: rec.ContentSize, FileType: rec.FileType, VersionNumber: rec.VersionNumber, IsLatest: rec.IsLatest, VersionData: rec.VersionData }];
  });

  await check('blob-download', async () => {
    const stream = await conn.sobject('ContentVersion').record(versionId).blob('VersionData');
    const chunks = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    const got = Buffer.concat(chunks);
    return [got.equals(TEXT_BYTES), { bytes: got.length, expected: TEXT_BYTES.length }];
  });

  await check('second-version', async () => {
    const r = await conn.sobject('ContentVersion').create({
      Title: 'files-check v2',
      PathOnClient: 'files-check.txt',
      VersionData: b64(Buffer.from(`${TEXT}second\n`, 'utf8')),
      ContentDocumentId: documentId,
    });
    const v2 = await conn.sobject('ContentVersion').retrieve(r.id);
    const q = await conn.query(`SELECT Id, IsLatest FROM ContentVersion WHERE ContentDocumentId = '${documentId}' ORDER BY VersionNumber`);
    const doc = await conn.sobject('ContentDocument').retrieve(documentId);
    const flags = q.records.map((x) => x.IsLatest);
    const ok = v2.VersionNumber === '2' && JSON.stringify(flags) === '[false,true]' && doc.LatestPublishedVersionId === r.id;
    return [ok, { versionNumber: v2.VersionNumber, flags, latest: doc.LatestPublishedVersionId, second: r.id }];
  });

  await check('link-query', async () => {
    const r = await conn.query(`SELECT Id, ShareType, Visibility FROM ContentDocumentLink WHERE LinkedEntityId = '${acct.id}'`);
    const l = r.records[0];
    return [r.records.length === 1 && l.ShareType === 'V' && l.Visibility === 'AllUsers', r.records.map((x) => ({ ShareType: x.ShareType, Visibility: x.Visibility }))];
  });

  await check('link-filter-required', async () => {
    try {
      await conn.query('SELECT Id FROM ContentDocumentLink');
      return [false, 'query was accepted'];
    } catch (err) {
      return [err.errorCode === 'MALFORMED_QUERY', { errorCode: err.errorCode, message: err.message }];
    }
  });

  await check('multipart-refused', async () => {
    try {
      await conn.sobject('ContentVersion').create(
        { Title: 'multipart', PathOnClient: 'x.txt', VersionData: TEXT_BYTES },
        { multipartFileFields: { VersionData: { filename: 'x.txt' } } },
      );
      return [false, 'multipart create was accepted'];
    } catch (err) {
      return [String(err.message).startsWith('UNSUPPORTED:content-multipart'), { errorCode: err.errorCode, message: err.message }];
    }
  });
} catch (err) {
  console.log(`FAIL setup ${err?.name ?? 'Error'}: ${err?.message ?? String(err)}`);
  results.push(false);
} finally {
  // Deleting the ContentDocument cascades to its versions and links.
  if (created.document) await conn.sobject('ContentDocument').destroy(created.document).catch(() => {});
  if (created.account) await conn.sobject('Account').destroy(created.account).catch(() => {});
}

const passed = results.filter(Boolean).length;
console.log(`jsforce: ${passed}/${EXPECTED} passed`);
process.exit(passed === EXPECTED && results.length === EXPECTED ? 0 : 1);
