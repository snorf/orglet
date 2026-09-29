import type { FastifyInstance } from "fastify";
import { asString, type RecordData } from "@orglet/formula";
import { baseUrl, type ApiContext } from "../server.js";

const xmlEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function soapFault(code: string, message: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:sf="urn:fault.partner.soap.sforce.com" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<soapenv:Body><soapenv:Fault><faultcode>sf:${code}</faultcode><faultstring>${code}: ${xmlEscape(message)}</faultstring>` +
    `<detail><sf:LoginFault xsi:type="sf:LoginFault"><sf:exceptionCode>${code}</sf:exceptionCode><sf:exceptionMessage>${xmlEscape(message)}</sf:exceptionMessage></sf:LoginFault></detail>` +
    `</soapenv:Fault></soapenv:Body></soapenv:Envelope>`
  );
}

function tag(xml: string, name: string): string | undefined {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "i").exec(xml);
  return m?.[1]?.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export function registerLoginRoutes(app: FastifyInstance, ctx: ApiContext): void {
  // SOAP login used by simple-salesforce and jsforce's default Connection.login().
  app.post<{ Params: { version: string } }>("/services/Soap/:api/:version", async (req, reply) => {
    const xml = typeof req.body === "string" ? req.body : "";
    const username = tag(xml, "username") ?? "";
    const password = tag(xml, "password") ?? "";
    const login = await ctx.sessions.login(username, password);
    if (!login) {
      return reply.code(500).type("text/xml;charset=UTF-8").send(soapFault("INVALID_LOGIN", "Invalid username, password, security token; or user locked out."));
    }
    const base = baseUrl(req);
    const u = login.user;
    const body =
      `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns="urn:partner.soap.sforce.com" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<soapenv:Body><loginResponse><result>` +
      `<metadataServerUrl>${base}/services/Soap/m/${req.params.version}/${ctx.organizationId}</metadataServerUrl>` +
      `<passwordExpired>false</passwordExpired><sandbox>false</sandbox>` +
      `<serverUrl>${base}/services/Soap/u/${req.params.version}/${ctx.organizationId}</serverUrl>` +
      `<sessionId>${login.token}</sessionId>` +
      `<userId>${login.session.userId}</userId>` +
      `<userInfo><organizationId>${ctx.organizationId}</organizationId><organizationName>orglet</organizationName>` +
      `<profileId>${login.session.profileId}</profileId><userEmail>${xmlEscape(asString(u["Email"]))}</userEmail>` +
      `<userFullName>${xmlEscape(`${asString(u["FirstName"])} ${asString(u["LastName"])}`.trim())}</userFullName>` +
      `<userId>${login.session.userId}</userId><userLanguage>en_US</userLanguage><userLocale>en_US</userLocale>` +
      `<userName>${xmlEscape(asString(u["Username"]))}</userName><userTimeZone>Europe/Stockholm</userTimeZone><userType>Standard</userType></userInfo>` +
      `</result></loginResponse></soapenv:Body></soapenv:Envelope>`;
    return reply.code(200).type("text/xml;charset=UTF-8").send(body);
  });

  // OAuth 2.0 token endpoint: password, refresh_token and client_credentials grants.
  app.post("/services/oauth2/token", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string | undefined>;
    const grant = body["grant_type"];
    let login;
    if (grant === "password") {
      login = await ctx.sessions.login(body["username"] ?? "", body["password"] ?? "");
    } else if (grant === "refresh_token") {
      const existing = ctx.sessions.resolve(body["refresh_token"]);
      login = existing ? ctx.sessions.issue(existing.session, existing.user) : undefined;
    } else if (grant === "client_credentials") {
      login = await ctx.sessions.loginAs(ctx.sessions.clientCredentialsUser);
    } else {
      return reply.code(400).send({ error: "unsupported_grant_type", error_description: "grant type not supported" });
    }
    if (!login) return reply.code(400).send({ error: "invalid_grant", error_description: "authentication failure" });
    const base = baseUrl(req);
    return reply.code(200).send({
      access_token: login.token,
      refresh_token: login.token,
      instance_url: base,
      id: `${base}/id/${ctx.organizationId}/${login.session.userId}`,
      token_type: "Bearer",
      issued_at: String(Date.now()),
      signature: "",
    });
  });

  const identity = (req: { login?: { session: { userId: string }; user: RecordData } }, base: string) => {
    const u: RecordData = req.login?.user ?? {};
    const userId = req.login?.session.userId ?? "";
    return {
      id: `${base}/id/${ctx.organizationId}/${userId}`,
      asserted_user: true,
      user_id: userId,
      organization_id: ctx.organizationId,
      username: asString(u["Username"]),
      nick_name: asString(u["CommunityNickname"]),
      display_name: `${asString(u["FirstName"])} ${asString(u["LastName"])}`.trim(),
      email: asString(u["Email"]),
      email_verified: true,
      first_name: asString(u["FirstName"]),
      last_name: asString(u["LastName"]),
      timezone: asString(u["TimeZoneSidKey"]) || "Europe/Stockholm",
      photos: { picture: "", thumbnail: "" },
      addr_street: null,
      addr_city: null,
      addr_state: null,
      addr_country: null,
      addr_zip: null,
      mobile_phone: null,
      mobile_phone_verified: false,
      is_lightning_login_user: false,
      status: { created_date: null, body: null },
      urls: {
        enterprise: `${base}/services/Soap/c/{version}/${ctx.organizationId}`,
        metadata: `${base}/services/Soap/m/{version}/${ctx.organizationId}`,
        partner: `${base}/services/Soap/u/{version}/${ctx.organizationId}`,
        rest: `${base}/services/data/v{version}/`,
        sobjects: `${base}/services/data/v{version}/sobjects/`,
        search: `${base}/services/data/v{version}/search/`,
        query: `${base}/services/data/v{version}/query/`,
        recent: `${base}/services/data/v{version}/recent/`,
        profile: `${base}/${userId}`,
      },
      active: true,
      user_type: "STANDARD",
      language: "en_US",
      locale: "en_US",
      utcOffset: 3600000,
      last_modified_date: null,
      is_app_installed: true,
    };
  };

  app.get("/id/:org/:user", (req, reply) => reply.send(identity(req, baseUrl(req))));
  app.get("/services/oauth2/userinfo", (req, reply) => {
    const login = ctx.sessions.resolve((req.headers.authorization ?? "").replace(/^(Bearer|OAuth)\s+/i, "") || (req.query as { access_token?: string }).access_token);
    if (!login) return reply.code(401).send({ error: "invalid_token" });
    req.login = login;
    return reply.send(identity(req, baseUrl(req)));
  });
}
