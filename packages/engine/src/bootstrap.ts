/**
 * Seeds the rows every org needs before any DML can run: the Organization, the System
 * Administrator profile, an admin user, and one RecordType row per record type in the
 * metadata. Idempotent: existing rows are reused.
 */
import type { OrgSchema, SObjectDef } from "@orglet/metadata";
import { formatSalesforceDatetime, generateId, type Pool, withTransaction } from "@orglet/schema";
import { asString, type RecordData } from "@orglet/formula";
import type { Session } from "./hooks.js";
import { Store } from "./store.js";

export interface BootstrapOptions {
  orgSchema: string;
  organizationName?: string;
  admin?: { username?: string; email?: string; firstName?: string; lastName?: string; alias?: string };
}

export interface BootstrapResult {
  session: Session;
  recordTypeIds: Map<string, string>;
}

function need(schema: OrgSchema, name: string): SObjectDef {
  const obj = schema.getObject(name);
  if (!obj) throw new Error(`bootstrap: standard object ${name} missing from schema`);
  return obj;
}

export async function bootstrapOrg(pool: Pool, schema: OrgSchema, options: BootstrapOptions): Promise<BootstrapResult> {
  const store = new Store(schema, options.orgSchema);
  const organization = need(schema, "Organization");
  const profile = need(schema, "Profile");
  const user = need(schema, "User");
  const recordType = need(schema, "RecordType");
  const now = formatSalesforceDatetime(new Date());
  const username = options.admin?.username ?? "admin@orglet.local";

  return withTransaction(pool, async (client) => {
    const existing = await client.query<{ id: string; organizationid: string | null; profileid: string }>(
      `SELECT "id", "profileid" FROM ${store.table(user)} WHERE lower("username") = lower($1)`,
      [username],
    );
    let session: Session;
    if (existing.rows[0]) {
      const org = await client.query<{ id: string }>(`SELECT "id" FROM ${store.table(organization)} LIMIT 1`);
      session = { userId: existing.rows[0].id, profileId: existing.rows[0].profileid, organizationId: org.rows[0]?.id ?? "" };
    } else {
      const orgId = generateId(organization.keyPrefix);
      const profileId = generateId(profile.keyPrefix);
      const userId = generateId(user.keyPrefix);
      const system = { IsDeleted: false, CreatedDate: now, CreatedById: userId, LastModifiedDate: now, LastModifiedById: userId, SystemModstamp: now };
      // The user row must come first: every other row's CreatedById points at it.
      await store.insert(client, user, {
        Id: userId,
        Username: username,
        Email: options.admin?.email ?? username,
        FirstName: options.admin?.firstName ?? "Admin",
        LastName: options.admin?.lastName ?? "User",
        Alias: options.admin?.alias ?? "admin",
        CommunityNickname: "admin",
        IsActive: true,
        ProfileId: profileId,
        TimeZoneSidKey: "Europe/Stockholm",
        LocaleSidKey: "en_US",
        EmailEncodingKey: "UTF-8",
        LanguageLocaleKey: "en_US",
        UserType: "Standard",
        ...system,
      });
      await store.insert(client, profile, { Id: profileId, Name: "System Administrator", UserType: "Standard", ...system });
      await store.insert(client, organization, {
        Id: orgId,
        Name: options.organizationName ?? "orglet",
        OrganizationType: "Developer Edition",
        InstanceName: "LOCAL",
        IsSandbox: false,
        DefaultLocaleSidKey: "en_US",
        LanguageLocaleKey: "en_US",
        TimeZoneSidKey: "Europe/Stockholm",
        ...system,
      });
      session = { userId, profileId, organizationId: orgId };
    }

    const recordTypeIds = new Map<string, string>();
    const existingTypes = await client.query<RecordData>(`SELECT "id", "sobjecttype", "developername" FROM ${store.table(recordType)}`);
    for (const row of existingTypes.rows) recordTypeIds.set(`${asString(row["sobjecttype"])}.${asString(row["developername"])}`.toLowerCase(), asString(row["id"]));
    for (const obj of schema.objects.values()) {
      for (const rt of obj.recordTypes) {
        const key = `${obj.name}.${rt.name}`.toLowerCase();
        if (recordTypeIds.has(key)) continue;
        const id = generateId(recordType.keyPrefix);
        await store.insert(client, recordType, {
          Id: id,
          Name: rt.label,
          DeveloperName: rt.name,
          SobjectType: obj.name,
          IsActive: rt.active,
          IsPersonType: false,
          Description: rt.description ?? null,
          IsDeleted: false,
          CreatedDate: now,
          CreatedById: session.userId,
          LastModifiedDate: now,
          LastModifiedById: session.userId,
          SystemModstamp: now,
        });
        recordTypeIds.set(key, id);
      }
    }
    return { session, recordTypeIds };
  });
}
