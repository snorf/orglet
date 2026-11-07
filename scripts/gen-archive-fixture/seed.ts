/**
 * Seed data for the archive fixture: the acme org as it looked at two monthly backups. Every Id and
 * timestamp is fixed here (Phase 16 D-02, D-03); the period-2 section reads as the story a reviewer
 * should see in the CSV diff. Pure data and Id allocation, no DB access.
 */
import { createHash } from "node:crypto";
import { fileExtensionOf, fileTypeFor } from "@orglet/engine";
import type { BootstrapOptions } from "@orglet/engine";
import { toCaseSafeId } from "@orglet/schema";

export const FIXTURE_ORG_SCHEMA = "org";

export const FIXTURE_CLOCK = { bootstrap: "2026-01-02T08:00:00.000+0000", period1Run: "2026-01-31T02:00:00.000+0000", period2Run: "2026-02-28T02:00:00.000+0000" } as const;

export interface FixturePeriod {
  year: number;
  month: number;
  runAt: string;
}

export const FIXTURE_PERIODS: readonly [FixturePeriod, FixturePeriod] = [
  { year: 2026, month: 1, runAt: FIXTURE_CLOCK.period1Run },
  { year: 2026, month: 2, runAt: FIXTURE_CLOCK.period2Run },
];

/** Pinned key prefixes for the custom objects (a00..a03), so Ids do not depend on migration order. */
export const KEY_PREFIX_MAPPING = { BigTable__c: "a00", Milestone__c: "a01", Project__c: "a02", UpsertTable__c: "a03" } as const;

export interface IdAllocator {
  next(prefix: string): string;
  readonly allocated: ReadonlySet<string>;
}

/** Per-prefix counter; the 15-char form is `<prefix>00<10 digits>`, widened to the case-safe 18-char form. */
export function createIdAllocator(): IdAllocator {
  const counters = new Map<string, number>();
  const allocated = new Set<string>();
  return {
    next(prefix: string): string {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      const id = toCaseSafeId(`${prefix}00${String(n).padStart(10, "0")}`);
      allocated.add(id);
      return id;
    },
    allocated,
  };
}

/** `at` is CreatedDate = LastModifiedDate = SystemModstamp. */
export interface SeedRecord {
  object: string;
  id: string;
  at: string;
  fields: Record<string, unknown>;
}
export interface SeedUpdate {
  object: string;
  id: string;
  at: string;
  changes: Record<string, unknown>;
}
export interface SeedDelete {
  object: string;
  ids: string[];
  at: string;
}
export interface SeedBlob {
  versionId: string;
  checksum: string;
  extension: string;
  bytes: Buffer;
}

export interface SeedBootstrap {
  now: string;
  organizationName: string;
  admin: { username: string; email: string; firstName: string; lastName: string; alias: string };
  ids: NonNullable<BootstrapOptions["ids"]>;
}

export interface FixtureSeed {
  orgId: string;
  adminId: string;
  bootstrap: SeedBootstrap;
  period1: { inserts: SeedRecord[] };
  period2: { inserts: SeedRecord[]; updates: SeedUpdate[]; deletes: SeedDelete[] };
  /** One entry per ContentVersion row (all versions, none deleted). */
  blobs: SeedBlob[];
  allocated: ReadonlySet<string>;
}

const stamp = (month: 1 | 2, day: number, hour: number, minute = 0): string => `2026-0${month}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000+0000`;

function blobFields(path: string, bytes: Buffer, versionNumber: string): { fields: Record<string, unknown>; blob: Omit<SeedBlob, "versionId"> } {
  const checksum = createHash("md5").update(bytes).digest("hex");
  const extension = fileExtensionOf(path);
  if (extension === null) throw new Error(`seed: ${path} has no file extension`);
  return {
    fields: {
      PathOnClient: path,
      VersionNumber: versionNumber,
      IsLatest: true,
      IsMajorVersion: true,
      Checksum: checksum,
      ContentSize: bytes.length,
      ContentSizeLong: bytes.length,
      FileExtension: extension,
      FileType: fileTypeFor(extension),
      VersionData: bytes.toString("base64"),
    },
    blob: { checksum, extension, bytes },
  };
}

export function buildSeed(): FixtureSeed {
  const ids = createIdAllocator();

  // Bootstrap rows first: they fix the first Id of each system prefix.
  const orgId = ids.next("00D");
  const profileId = ids.next("00e");
  const adminId = ids.next("005");
  const businessHoursId = ids.next("01m");
  const userLicenseId = ids.next("100");
  const internalRt = ids.next("012");
  const externalRt = ids.next("012");
  const bootstrap: SeedBootstrap = {
    now: FIXTURE_CLOCK.bootstrap,
    organizationName: "Acme Archive Fixture",
    admin: { username: "admin@acme.example.com", email: "admin@acme.example.com", firstName: "Ada", lastName: "Admin", alias: "aadmin" },
    ids: { organization: orgId, profile: profileId, user: adminId, businessHours: businessHoursId, userLicense: userLicenseId, recordTypes: { "project__c.internal": internalRt, "project__c.external": externalRt } },
  };

  const owner = { OwnerId: adminId };
  const p1: SeedRecord[] = [];
  const add = (list: SeedRecord[], object: string, prefix: string, at: string, fields: Record<string, unknown>): SeedRecord => {
    const r: SeedRecord = { object, id: ids.next(prefix), at, fields };
    list.push(r);
    return r;
  };

  // ---- Period 1: the full set of acme rows as of the January backup ----
  const accountSpecs = [
    { name: "Acme Corporation", num: "C-1001", tier: "Gold", industry: "Telecommunications", web: "acme", description: 'Key account, "strategic"' },
    { name: "Globex Nordic", num: "C-1002", tier: "Silver", industry: "Energy", web: "globex", description: "Two-line\ndescription" },
    { name: "Initech AB", num: "C-1003", tier: "Bronze", industry: "Other", web: "initech" },
    { name: "Umbrella Logistics", num: "C-1004", tier: "Gold", industry: "Energy", web: "umbrella" },
    { name: "Stark Components", tier: "Silver", industry: "Other" },
    { name: "Wayne Analytics", industry: "Telecommunications" },
  ];
  const accounts = accountSpecs.map((a, i) =>
    add(p1, "Account", "001", stamp(1, 5, 8 + i), {
      Name: a.name,
      ...(a.num ? { Customer_Number__c: a.num } : {}),
      ...(a.tier ? { Tier__c: a.tier } : {}),
      Industry: a.industry,
      Phone: `+46 8 555 0${i + 1}0 0${i + 1}`,
      ...(a.web ? { Website: `https://${a.web}.example.com`, Type: "Customer - Direct" } : {}),
      NumberOfEmployees: 25 * (i + 1),
      AnnualRevenue: 1_000_000 * (i + 1),
      ...(a.description ? { Description: a.description } : {}),
      ...owner,
    }),
  );

  const contactSpecs = [
    { first: "Anna", last: "Andersson", acct: 0, lang: "sv", buyer: "Buyer;Champion", born: "1984-03-12", lead: "Web" },
    { first: "Bengt", last: "Berg", acct: 0, lang: "en", buyer: "DecisionMaker" },
    { first: "Cecilia", last: "Carlsson", acct: 1, lang: "sv", born: "1990-07-01", lead: "Web" },
    { first: "David", last: "Dahl", acct: 2, lang: "en" },
    { first: "Elin", last: "Ek", acct: 3, lang: "sv", born: "1978-11-23" },
    { first: "Filip", last: "Fors", acct: 4, lang: "en", lead: "Web" },
    { first: "Greta", last: "Gran", acct: 4, lang: "sv", born: "1995-01-30" },
    { first: "Hugo", last: "Holm", lang: "en" },
  ];
  const contacts = contactSpecs.map((c, i) =>
    add(p1, "Contact", "003", stamp(1, 6, 8 + i), {
      FirstName: c.first,
      LastName: c.last,
      ...(c.acct === undefined ? {} : { AccountId: accounts[c.acct]?.id }),
      Email: `${c.first.toLowerCase()}.${c.last.toLowerCase()}@example.com`,
      ...(c.born ? { Birthdate: c.born } : {}),
      ...(c.lead ? { LeadSource: c.lead } : {}),
      Preferred_Language__c: c.lang,
      ...(c.buyer ? { BuyerAttributes: c.buyer } : {}),
      ...owner,
    }),
  );

  const oppSpecs = [
    { name: "Acme Fibre Upgrade", acct: 0, stage: "Prospecting", close: "2026-06-30", amount: 120000, prob: 25 },
    { name: "Globex Energy Pilot", acct: 0, stage: "Qualification", close: "2026-05-15", amount: 45000, prob: 10 },
    { name: "Initech Support Renewal", acct: 1, stage: "Negotiation", close: "2026-04-01", prob: 60 },
    { name: "Umbrella Rollout", acct: 2, stage: "Closed Won", close: "2026-02-01", amount: 80000, prob: 100 },
    { name: "Stark Prototype", acct: 3, stage: "Prospecting", close: "2026-09-30", amount: 15000, prob: 10 },
  ];
  const opps = oppSpecs.map((o, i) =>
    add(p1, "Opportunity", "006", stamp(1, 7, 8 + i), {
      Name: o.name,
      AccountId: accounts[o.acct]?.id,
      StageName: o.stage,
      CloseDate: o.close,
      ...(o.amount === undefined ? {} : { Amount: o.amount }),
      Probability: o.prob,
      ...owner,
    }),
  );

  // End_Date__c is blank or on/before 2025-12-31 so Is_Overdue__c (TODAY()) never changes with the wall clock.
  const projectSpecs = [
    { acct: 0, status: "Active", budget: 50000, start: "2025-03-01", end: "2025-12-15", notes: 'Kick-off notes:\n- scope "phase 1"\n- budget, approved' },
    { acct: 0, status: "Planned", budget: 20000, start: "2025-09-01" },
    { acct: 1, status: "Done", budget: 12500.5, start: "2025-01-10", end: "2025-09-30" },
    { acct: 1, status: "Active", budget: 30000, start: "2025-05-01", end: "2025-11-30" },
    { acct: 2, status: "Planned", budget: 8000, start: "2025-10-01" },
    { acct: 3, status: "Done", budget: 99999.99, start: "2025-02-01", end: "2025-08-31" },
  ];
  const projects = projectSpecs.map((p, i) =>
    add(p1, "Project__c", "a02", stamp(1, 8, 8 + i), {
      Name: `Project ${i + 1}`,
      Account__c: accounts[p.acct]?.id,
      Manager__c: adminId,
      RecordTypeId: i % 2 === 0 ? internalRt : externalRt,
      Status__c: p.status,
      Budget__c: p.budget,
      Code__c: `PRJ-${String(i + 1).padStart(3, "0")}`,
      Start_Date__c: p.start,
      ...(p.end ? { End_Date__c: p.end } : {}),
      ...(p.notes ? { Notes__c: p.notes } : {}),
    }),
  );

  // At most 5 per project (Milestone_Limit).
  const milestoneSpecs = [
    { proj: 0, due: "2025-06-30", done: true },
    { proj: 0, due: "2025-09-30", done: true },
    { proj: 0, due: "2026-03-31", done: false },
    { proj: 1, due: "2026-01-31", done: false },
    { proj: 1, due: "2026-04-30", done: false },
    { proj: 2, due: "2025-05-31", done: true },
    { proj: 2, due: "2025-08-31", done: true },
    { proj: 3, due: "2025-10-31", done: true },
    { proj: 3, due: "2026-02-28", done: false },
    { proj: 3, due: "2026-05-31", done: false },
  ];
  const sortCounter = new Map<number, number>();
  const milestones = milestoneSpecs.map((m, i) => {
    const sort = (sortCounter.get(m.proj) ?? 0) + 1;
    sortCounter.set(m.proj, sort);
    return add(p1, "Milestone__c", "a01", stamp(1, 9, 8 + i), {
      Name: `Milestone ${i + 1}`,
      Project__c: projects[m.proj]?.id,
      Due_Date__c: m.due,
      Done__c: m.done,
      Sort_Order__c: sort,
    });
  });

  // Roll-ups are import-mode data (the engine stores them as given), so compute them from the rows above.
  const projectRollups = projects.map((p, pi) => {
    const own = milestoneSpecs.filter((m) => m.proj === pi);
    const open = own.filter((m) => !m.done);
    const nextDue = open.map((m) => m.due).sort()[0];
    return { count: own.length, open: open.length, nextDue, project: p };
  });
  for (const r of projectRollups) {
    r.project.fields.Milestone_Count__c = r.count;
    r.project.fields.Open_Milestones__c = r.open;
    if (r.nextDue !== undefined) r.project.fields.Next_Due_Date__c = r.nextDue;
  }
  accounts.forEach((a, ai) => {
    const owned = projectSpecs.map((p, pi) => ({ spec: p, roll: projectRollups[pi], rec: projects[pi] })).filter((x) => x.spec.acct === ai);
    a.fields.Total_Budget__c = owned.filter((x) => x.spec.status !== "Done").reduce((sum, x) => sum + x.spec.budget, 0);
    a.fields.Open_Project_Milestones__c = owned.reduce((sum, x) => sum + (x.roll?.open ?? 0), 0);
    const activeStamps = owned.filter((x) => x.spec.status === "Active").map((x) => x.rec?.at ?? "");
    const latest = activeStamps.sort().at(-1);
    if (latest) a.fields.Last_Active_Project_Created__c = latest;
  });

  const upserts = [1, 2, 3, 4, 5].map((n) => add(p1, "UpsertTable__c", "a03", stamp(1, 10, 8 + n), { Name: `Upsert row ${n}`, ExtId__c: `EXT-${String(n).padStart(4, "0")}`, ...owner }));

  // Rows 7-10 share one stamp so the LIMIT 8 split falls inside the tie group.
  const bigStamps = [
    stamp(1, 11, 8),
    stamp(1, 11, 9),
    stamp(1, 11, 10),
    stamp(1, 11, 11),
    stamp(1, 11, 12),
    stamp(1, 11, 13),
    stamp(1, 15, 12),
    stamp(1, 15, 12),
    stamp(1, 15, 12),
    stamp(1, 15, 12),
    stamp(1, 16, 8),
    stamp(1, 16, 9),
  ];
  const bigRows = bigStamps.map((at, i) => add(p1, "BigTable__c", "a00", at, { Name: String(i + 1).padStart(8, "0"), ...owner }));

  const fileSpecs = [
    { title: "Onboarding notes", path: "onboarding-notes.txt", bytes: Buffer.from("Acme onboarding notes\nVersion one.\n", "utf8") },
    { title: "Price list", path: "price-list.csv", bytes: Buffer.from("item,price\nwidget,10\n", "utf8") },
    // Same bytes as the previous file: shared Checksum and extension, one blob key (Heimdall dedup).
    { title: "Price list copy", path: "price-list-copy.csv", bytes: Buffer.from("item,price\nwidget,10\n", "utf8") },
    // Not valid UTF-8.
    { title: "Logo", path: "logo.png", bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80, 0xc3, 0x28]) },
  ];
  const blobs: SeedBlob[] = [];
  const documents: SeedRecord[] = [];
  const versions: SeedRecord[] = [];
  fileSpecs.forEach((f, i) => {
    const at = stamp(1, 18, 9 + i);
    const documentId = ids.next("069");
    const versionId = ids.next("068");
    const { fields, blob } = blobFields(f.path, f.bytes, "1");
    const doc: SeedRecord = {
      object: "ContentDocument",
      id: documentId,
      at,
      fields: {
        Title: f.title,
        LatestPublishedVersionId: versionId,
        FileType: fields.FileType,
        FileExtension: fields.FileExtension,
        ContentSize: f.bytes.length,
        ContentSizeLong: f.bytes.length,
        ...owner,
      },
    };
    const ver: SeedRecord = { object: "ContentVersion", id: versionId, at, fields: { ContentDocumentId: documentId, Title: f.title, ...fields, ...owner } };
    documents.push(doc);
    versions.push(ver);
    blobs.push({ versionId, ...blob });
    p1.push(doc, ver);
  });

  // ---- Period 2: what changed between the January and February backups ----
  const p2Inserts: SeedRecord[] = [];
  const p2Updates: SeedUpdate[] = [];
  const upd = (rec: SeedRecord, at: string, changes: Record<string, unknown>): void => {
    p2Updates.push({ object: rec.object, id: rec.id, at, changes });
  };
  const pick = <T>(list: readonly T[], i: number): T => {
    const v = list[i];
    if (v === undefined) throw new Error(`seed: no record at index ${i}`);
    return v;
  };

  // Edits: an account is renamed, a contact gets a new email, an opportunity is won, a project's notes are
  // rewritten, a milestone is re-ordered and an upsert row is renamed. None touches a roll-up input
  // (Budget__c, Status__c, Done__c, Due_Date__c, CreatedDate).
  upd(pick(accounts, 0), stamp(2, 3, 9), { Name: "Acme Corporation AB" });
  upd(pick(contacts, 1), stamp(2, 4, 9), { Email: "bengt.berg@new.example.com" });
  upd(pick(opps, 0), stamp(2, 5, 9), { StageName: "Closed Won" });
  upd(pick(projects, 0), stamp(2, 6, 9), { Notes__c: "Rewritten notes:\n- phase 1 delivered" });
  upd(pick(milestones, 0), stamp(2, 7, 9), { Sort_Order__c: 9 });
  upd(pick(upserts, 0), stamp(2, 8, 9), { Name: "Upsert row 1 (renamed)" });
  // BigTable rows 1-9 are touched (stamp only): nine changed rows, so two jobs at LIMIT 8.
  bigRows.slice(0, 9).forEach((r, i) => upd(r, stamp(2, 12 + Math.floor(i / 3), 9 + (i % 3)), {}));

  // Deletes: one contact, one opportunity and one upsert row go to the recycle bin on the same day.
  const deletes: SeedDelete[] = [
    { object: "Contact", ids: [pick(contacts, 6).id], at: "2026-02-10T10:00:00.000+0000" },
    { object: "Opportunity", ids: [pick(opps, 4).id], at: "2026-02-10T10:00:00.000+0000" },
    { object: "UpsertTable__c", ids: [pick(upserts, 4).id], at: "2026-02-10T10:00:00.000+0000" },
  ];

  // File story (D-07): a second version of the onboarding notes. V1 stops being the latest and the
  // document mirrors V5.
  const v5At = "2026-02-12T09:00:00.000+0000";
  const v5Id = ids.next("068");
  const v5Bytes = Buffer.from("Acme onboarding notes\nVersion two, revised.\n", "utf8");
  const { fields: v5Fields, blob: v5Blob } = blobFields("onboarding-notes.txt", v5Bytes, "2");
  const d1 = pick(documents, 0);
  p2Inserts.push({ object: "ContentVersion", id: v5Id, at: v5At, fields: { ContentDocumentId: d1.id, Title: "Onboarding notes", ...v5Fields, ...owner } });
  upd(pick(versions, 0), v5At, { IsLatest: false });
  upd(d1, v5At, { LatestPublishedVersionId: v5Id, ContentSize: v5Bytes.length, ContentSizeLong: v5Bytes.length, FileType: v5Fields.FileType, FileExtension: v5Fields.FileExtension });
  blobs.push({ versionId: v5Id, ...v5Blob });

  return { orgId, adminId, bootstrap, period1: { inserts: p1 }, period2: { inserts: p2Inserts, updates: p2Updates, deletes }, blobs, allocated: ids.allocated };
}
