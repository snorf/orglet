/**
 * Logins and bearer sessions. Users are rows in the User table; passwords come from the
 * configuration (or anything goes in permissive mode, the default for local development).
 * Security tokens appended to passwords are tolerated the way Salesforce clients send them.
 */
import { randomBytes } from "node:crypto";
import type { FieldDef } from "@orglet/metadata";
import type { DmlEngine, Session } from "@orglet/engine";
import { asString, type RecordData } from "@orglet/formula";

export interface AuthConfig {
  mode: "permissive" | "list";
  users?: { username: string; password: string }[];
  /** User the client_credentials grant logs in as (default: the bootstrap admin). */
  clientCredentialsUser?: string;
}

export interface LoginResult {
  token: string;
  session: Session;
  user: RecordData;
}

export class SessionStore {
  private readonly tokens = new Map<string, LoginResult>();

  constructor(
    private readonly engine: DmlEngine,
    private readonly organizationId: string,
    private readonly config: AuthConfig,
  ) {}

  private passwordAccepted(username: string, given: string): boolean {
    if (this.config.mode === "permissive") return true;
    const entry = this.config.users?.find((u) => u.username.toLowerCase() === username.toLowerCase());
    if (!entry) return false;
    return given === entry.password || (given.length > entry.password.length && given.startsWith(entry.password));
  }

  async login(username: string, password: string): Promise<LoginResult | undefined> {
    if (!username || !this.passwordAccepted(username, password)) return undefined;
    return this.loginAs(username);
  }

  /** Issue a session for a username without a password check (client_credentials, CLI). */
  async loginAs(username: string): Promise<LoginResult | undefined> {
    const userObj = this.engine.object("User");
    const usernameField = this.engine.schema.getField("User", "Username") as FieldDef;
    const client = await this.engine.pool.connect();
    let user: RecordData | undefined;
    try {
      user = (await this.engine.store.findByField(client, userObj, usernameField, username))[0];
    } finally {
      client.release();
    }
    if (!user || user["IsActive"] === false) return undefined;
    const session: Session = { userId: asString(user["Id"]), profileId: asString(user["ProfileId"]), organizationId: this.organizationId };
    const token = `${this.organizationId}!${randomBytes(24).toString("base64url")}`;
    const result = { token, session, user };
    this.tokens.set(token, result);
    return result;
  }

  resolve(token: string | undefined): LoginResult | undefined {
    if (!token) return undefined;
    return this.tokens.get(token);
  }

  get clientCredentialsUser(): string {
    return this.config.clientCredentialsUser ?? "admin@orglet.local";
  }

  /** Re-issue a token for an existing session (refresh_token grant). */
  issue(session: Session, user: RecordData): LoginResult {
    const token = `${this.organizationId}!${randomBytes(24).toString("base64url")}`;
    const result = { token, session, user };
    this.tokens.set(token, result);
    return result;
  }
}

/** Extract the token from `Authorization: Bearer x` or `Authorization: OAuth x`. */
export function bearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^(?:Bearer|OAuth)\s+(.+)$/i.exec(header.trim());
  return m?.[1]?.trim();
}
