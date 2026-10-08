/**
 * Seeds the rows every org needs before any DML can run: the Organization, the System
 * Administrator profile, an admin user, one RecordType row per record type in the metadata,
 * and the default BusinessHours and the Salesforce UserLicense every real org has. Those two
 * objects reject API writes (UserLicense is read-only, BusinessHours cannot be deleted), so
 * this is how they get rows outside import mode. Idempotent: existing rows are reused and
 * never modified.
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

/** Name of the default BusinessHours row a new org gets (D-05). */
const SEED_BUSINESS_HOURS = "Default";
/** Name and MasterLabel of the UserLicense a new org gets; the admin profile points at it (D-07a). */
const SEED_USER_LICENSE = "Salesforce";

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
  const businessHours = need(schema, "BusinessHours");
  const userLicense = need(schema, "UserLicense");
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

    const stamp = { IsDeleted: false, CreatedDate: now, CreatedById: session.userId, LastModifiedDate: now, LastModifiedById: session.userId, SystemModstamp: now };
    // D-06: create each seed row only when missing and never modify an existing one; any
    // default BusinessHours (an imported one too) counts as present.
    const defaultHours = await client.query<{ id: string }>(`SELECT "id" FROM ${store.table(businessHours)} WHERE "isdefault" = true AND "isdeleted" = false LIMIT 1`);
    if (!defaultHours.rows[0]) {
      await store.insert(client, businessHours, { Id: generateId(businessHours.keyPrefix), Name: SEED_BUSINESS_HOURS, IsDefault: true, IsActive: true, ...stamp });
    }
    const license = await client.query<{ id: string }>(`SELECT "id" FROM ${store.table(userLicense)} WHERE "masterlabel" = $1 AND "isdeleted" = false LIMIT 1`, [SEED_USER_LICENSE]);
    let licenseId = license.rows[0]?.id;
    if (licenseId === undefined) {
      licenseId = generateId(userLicense.keyPrefix);
      await store.insert(client, userLicense, { Id: licenseId, Name: SEED_USER_LICENSE, MasterLabel: SEED_USER_LICENSE, ...stamp });
    }
    // Link the admin profile only while it has no license; an imported or user-set value stays.
    await client.query(`UPDATE ${store.table(profile)} SET "userlicenseid" = $1 WHERE "id" = $2 AND "userlicenseid" IS NULL`, [licenseId, session.profileId]);

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
