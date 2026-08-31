import crypto from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import request from "supertest";

import app from "../app.js";
import {
  confirmerRetraitExterneConnecteur,
  confirmerRetraitExterneManuellement,
  deconnecterConnecteur,
  resoudreTentativeOAuthCompensee,
} from "../lib/tenant-secrets.js";
import {
  adminPool,
  cleanupTenants,
  cleanupUsers,
  cookieHeader,
  createTestMembership,
  createTestSession,
  createTestTenant,
  createTestUser,
  serveurTest,
} from "./helpers.js";

const tenants: string[] = [];
const emails: string[] = [];

const OAUTH_ENV = {
  PENNYLANE_OAUTH_CLIENT_ID: "pennylane-client-test",
  PENNYLANE_OAUTH_CLIENT_SECRET: "pennylane-secret-test",
  STRIPE_OAUTH_CLIENT_ID: "stripe-client-test",
  STRIPE_PLATFORM_SECRET_KEY: "sk_test_stripe-platform-test",
  GOOGLE_OAUTH_CLIENT_ID: "google-client-test",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-secret-test",
  SLACK_OAUTH_CLIENT_ID: "slack-client-test",
  SLACK_OAUTH_CLIENT_SECRET: "slack-secret-test",
} as const;

async function owner(): Promise<{ cookie: string; tenantId: string; userId: string }> {
  const tenant = await createTestTenant("Connecteurs simples");
  tenants.push(tenant.id);
  const email = `connecteurs-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const user = await createTestUser(email);
  await createTestMembership(user.id, tenant.id, "OWNER");
  const session = await createTestSession(user.id, tenant.id);
  return { cookie: cookieHeader(session.id), tenantId: tenant.id, userId: user.id };
}

function configureOauth(): void {
  for (const [name, value] of Object.entries(OAUTH_ENV)) process.env[name] = value;
  process.env["APP_URL"] = "https://app.nodaq.test";
  process.env["PUBLIC_URL"] = "https://app.nodaq.test";
}

async function visibleConnectorConfig(
  cookie: string,
  type: string,
): Promise<Record<string, string | boolean>> {
  const response = await request(serveurTest(app)).get("/api/connecteurs").set("Cookie", cookie).expect(200);
  return response.body.connectors.find((item: { type: string }) => item.type === type).config;
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const name of Object.keys(OAUTH_ENV)) delete process.env[name];
  delete process.env["APP_URL"];
  delete process.env["PUBLIC_URL"];
  await cleanupTenants(...tenants.splice(0));
  await cleanupUsers(...emails.splice(0));
});

describe("la connexion ordinaire ne demande aucun secret à l'artisan", () => {
  test("la liste expose OAuth comme parcours principal et sa disponibilité", async () => {
    configureOauth();
    const { cookie } = await owner();

    const response = await request(serveurTest(app)).get("/api/connecteurs").set("Cookie", cookie).expect(200);
    const byType = Object.fromEntries(response.body.connectors.map((item: { type: string }) => [item.type, item]));

    expect(byType.PENNYLANE).toMatchObject({ connectionMode: "OAUTH", available: true });
    expect(byType.STRIPE).toMatchObject({ connectionMode: "OAUTH", available: true });
    expect(byType.GOOGLE_DRIVE).toMatchObject({ connectionMode: "OAUTH", available: true });
    expect(byType.SLACK).toMatchObject({ connectionMode: "OAUTH", available: true });
    expect(byType.ZAPIER).toMatchObject({ connectionMode: "ADVANCED", available: true });
  });

  test("un OAuth non configuré est indisponible sans révéler le nom d'une variable", async () => {
    const { cookie } = await owner();
    const response = await request(serveurTest(app)).get("/api/connecteurs").set("Cookie", cookie).expect(200);
    const pennylane = response.body.connectors.find((item: { type: string }) => item.type === "PENNYLANE");

    expect(pennylane).toMatchObject({ connectionMode: "OAUTH", available: false });
    expect(JSON.stringify(pennylane)).not.toContain("CLIENT_SECRET");
  });

  test("le démarrage OAuth lie l'autorisation au fournisseur et pose un nonce protégé", async () => {
    configureOauth();
    const { cookie, tenantId, userId } = await owner();

    const response = await request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/autorisation")
      .set("Cookie", cookie)
      .expect(200);

    const url = new URL(response.body.url);
    expect(url.origin + url.pathname).toBe("https://app.pennylane.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("pennylane-client-test");
    expect(url.searchParams.get("scope")).toBe("customers:readonly customer_invoices:all file_attachments:all");
    expect(url.searchParams.get("state")).toBeTruthy();
    const encodedPayload = url.searchParams.get("state")!.split(".")[0]!;
    const visibleState = Buffer.from(encodedPayload, "base64url").toString("utf8");
    expect(visibleState).not.toContain(tenantId);
    expect(visibleState).not.toContain(userId);
    const setCookies = Array.isArray(response.headers["set-cookie"])
      ? response.headers["set-cookie"]
      : [String(response.headers["set-cookie"] ?? "")];
    expect(setCookies.join(";")).toContain("nodaq_oauth_nonce=");
    expect(setCookies.join(";")).toContain("HttpOnly");
  });
});

describe("le retour OAuth conserve les jetons uniquement dans le magasin chiffré", () => {
  test("Pennylane connecté : métadonnées publiques, jetons chiffrés", async () => {
    configureOauth();
    const { cookie, tenantId } = await owner();
    const start = await request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/autorisation")
      .set("Cookie", cookie)
      .expect(200);
    const state = new URL(start.body.url).searchParams.get("state")!;
    const startCookies = Array.isArray(start.headers["set-cookie"])
      ? start.headers["set-cookie"]
      : [String(start.headers["set-cookie"] ?? "")];
    const nonceCookie = startCookies.find((value: string) => value.startsWith("nodaq_oauth_nonce="))!.split(";")[0];
    const accessToken = `access-${crypto.randomBytes(12).toString("hex")}`;
    const refreshToken = `refresh-${crypto.randomBytes(12).toString("hex")}`;

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: "Bearer",
      expires_in: 86_400,
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const callback = await request(serveurTest(app))
      .get(`/api/connecteurs/PENNYLANE/retour?code=code-test&state=${encodeURIComponent(state)}`)
      .set("Cookie", `${cookie}; ${nonceCookie}`)
      .expect(302)
      .expect("Location", "/connecteurs?connexion=PENNYLANE");
    expect(String(callback.headers["set-cookie"])).toContain("nodaq_oauth_nonce=;");

    const externalCall = vi.mocked(fetch).mock.calls[0]!;
    expect(externalCall[0]).toBe("https://app.pennylane.com/oauth/token");
    const tokenRequest = externalCall[1] as RequestInit;
    expect(tokenRequest.redirect).toBe("error");
    const tokenForm = new URLSearchParams(String(tokenRequest.body));
    expect(Object.fromEntries(tokenForm)).toEqual({
      code: "code-test",
      grant_type: "authorization_code",
      client_id: "pennylane-client-test",
      client_secret: "pennylane-secret-test",
      redirect_uri: "https://app.nodaq.test/api/connecteurs/PENNYLANE/retour",
    });

    const connector = await adminPool.query(
      "SELECT id, status, last_sync_at, config::text AS config FROM connectors WHERE tenant_id = $1::uuid AND type = 'PENNYLANE'",
      [tenantId],
    );
    expect(connector.rows[0].status).toBe("CONNECTE");
    expect(connector.rows[0].last_sync_at).toBeNull();
    expect(connector.rows[0].config).not.toContain(accessToken);
    expect(connector.rows[0].config).not.toContain(refreshToken);

    const secrets = await adminPool.query(
      "SELECT cle, valeur_chiffree FROM tenant_secrets WHERE tenant_id = $1::uuid AND cle LIKE $2 ORDER BY cle",
      [tenantId, `connecteur.${connector.rows[0].id}.%`],
    );
    expect(secrets.rows.map((row) => row.cle)).toEqual([
      `connecteur.${connector.rows[0].id}.access_token`,
      `connecteur.${connector.rows[0].id}.refresh_token`,
    ]);
    expect(JSON.stringify(secrets.rows)).not.toContain(accessToken);
    expect(JSON.stringify(secrets.rows)).not.toContain(refreshToken);
  });

  test("un état modifié est refusé avant tout appel au fournisseur", async () => {
    configureOauth();
    const { cookie } = await owner();
    const start = await request(serveurTest(app))
      .post("/api/connecteurs/SLACK/autorisation")
      .set("Cookie", cookie)
      .expect(200);
    const state = new URL(start.body.url).searchParams.get("state")!;
    const startCookies = Array.isArray(start.headers["set-cookie"])
      ? start.headers["set-cookie"]
      : [String(start.headers["set-cookie"] ?? "")];
    const nonceCookie = startCookies.find((value: string) => value.startsWith("nodaq_oauth_nonce="))!.split(";")[0];
    const external = vi.fn();
    vi.stubGlobal("fetch", external);

    await request(serveurTest(app))
      .get(`/api/connecteurs/SLACK/retour?code=x&state=${encodeURIComponent(`${state}x`)}`)
      .set("Cookie", `${cookie}; ${nonceCookie}`)
      .expect(302)
      .expect("Location", "/connecteurs?erreur=SLACK");
    expect(external).not.toHaveBeenCalled();
  });

  test("un état ne peut pas être rejoué dans la session d'un autre tenant", async () => {
    configureOauth();
    const first = await owner();
    const second = await owner();
    const start = await request(serveurTest(app))
      .post("/api/connecteurs/GOOGLE_DRIVE/autorisation")
      .set("Cookie", first.cookie)
      .expect(200);
    const state = new URL(start.body.url).searchParams.get("state")!;
    const setCookies = Array.isArray(start.headers["set-cookie"])
      ? start.headers["set-cookie"]
      : [String(start.headers["set-cookie"] ?? "")];
    const nonceCookie = setCookies.find((value: string) => value.startsWith("nodaq_oauth_nonce="))!.split(";")[0];
    const external = vi.fn();
    vi.stubGlobal("fetch", external);

    await request(serveurTest(app))
      .get(`/api/connecteurs/GOOGLE_DRIVE/retour?code=code-google&state=${encodeURIComponent(state)}`)
      .set("Cookie", `${second.cookie}; ${nonceCookie}`)
      .expect(302)
      .expect("Location", "/connecteurs?erreur=GOOGLE_DRIVE");
    expect(external).not.toHaveBeenCalled();
  });

  test("une autorisation refusée chez le fournisseur revient dans l'écran et consomme le nonce", async () => {
    configureOauth();
    const { cookie } = await owner();
    const start = await request(serveurTest(app))
      .post("/api/connecteurs/SLACK/autorisation")
      .set("Cookie", cookie)
      .expect(200);
    const state = new URL(start.body.url).searchParams.get("state")!;
    const setCookies = Array.isArray(start.headers["set-cookie"])
      ? start.headers["set-cookie"]
      : [String(start.headers["set-cookie"] ?? "")];
    const nonceCookie = setCookies.find((value: string) => value.startsWith("nodaq_oauth_nonce="))!.split(";")[0];
    const external = vi.fn();
    vi.stubGlobal("fetch", external);

    const callback = await request(serveurTest(app))
      .get(`/api/connecteurs/SLACK/retour?error=access_denied&state=${encodeURIComponent(state)}`)
      .set("Cookie", `${cookie}; ${nonceCookie}`)
      .expect(302)
      .expect("Location", "/connecteurs?erreur=SLACK");
    expect(String(callback.headers["set-cookie"])).toContain("nodaq_oauth_nonce=;");
    expect(external).not.toHaveBeenCalled();
  });

  test("Stripe échange le code avec la clé plateforme sans stocker de jeton obsolète", async () => {
    configureOauth();
    const { cookie, tenantId } = await owner();
    const start = await request(serveurTest(app))
      .post("/api/connecteurs/STRIPE/autorisation")
      .set("Cookie", cookie)
      .expect(200);
    const state = new URL(start.body.url).searchParams.get("state")!;
    const setCookies = Array.isArray(start.headers["set-cookie"])
      ? start.headers["set-cookie"]
      : [String(start.headers["set-cookie"] ?? "")];
    const nonceCookie = setCookies.find((value: string) => value.startsWith("nodaq_oauth_nonce="))!.split(";")[0];
    const external = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      token_type: "bearer",
      scope: "read_write",
      livemode: false,
      stripe_user_id: "acct_nodaq_test",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", external);

    await request(serveurTest(app))
      .get(`/api/connecteurs/STRIPE/retour?code=code-stripe&state=${encodeURIComponent(state)}`)
      .set("Cookie", `${cookie}; ${nonceCookie}`)
      .expect(302);

    const [, options] = external.mock.calls[0]!;
    const requestOptions = options as RequestInit;
    expect(requestOptions.redirect).toBe("error");
    expect(requestOptions.signal).toBeDefined();
    expect((requestOptions.headers as Record<string, string>)["Authorization"]).toBe(
      `Basic ${Buffer.from("sk_test_stripe-platform-test:").toString("base64")}`,
    );
    const form = new URLSearchParams(String(requestOptions.body));
    expect(Object.fromEntries(form)).toEqual({ code: "code-stripe", grant_type: "authorization_code" });

    const connector = await adminPool.query(
      "SELECT id, config::text AS config FROM connectors WHERE tenant_id = $1::uuid AND type = 'STRIPE'",
      [tenantId],
    );
    expect(connector.rows[0].config).toContain("acct_nodaq_test");
    expect(connector.rows[0].config).not.toContain("sk_test_stripe-platform-test");
    const secrets = await adminPool.query(
      "SELECT cle FROM tenant_secrets WHERE tenant_id = $1::uuid AND cle LIKE $2",
      [tenantId, `connecteur.${connector.rows[0].id}.%`],
    );
    expect(secrets.rows).toHaveLength(0);
  });

  test("Slack conserve les éléments nécessaires à la rotation et exige le webhook autorisé", async () => {
    configureOauth();
    const { cookie, tenantId } = await owner();
    const start = await request(serveurTest(app))
      .post("/api/connecteurs/SLACK/autorisation")
      .set("Cookie", cookie)
      .expect(200);
    const state = new URL(start.body.url).searchParams.get("state")!;
    const setCookies = Array.isArray(start.headers["set-cookie"])
      ? start.headers["set-cookie"]
      : [String(start.headers["set-cookie"] ?? "")];
    const nonceCookie = setCookies.find((value: string) => value.startsWith("nodaq_oauth_nonce="))!.split(";")[0];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      access_token: "xoxe.xoxb-access-test",
      refresh_token: "xoxe-refresh-test",
      expires_in: 43_200,
      team: { id: "T123", name: "Atelier test" },
      incoming_webhook: { url: "https://hooks.slack.com/services/T/B/X" },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await request(serveurTest(app))
      .get(`/api/connecteurs/SLACK/retour?code=code-slack&state=${encodeURIComponent(state)}`)
      .set("Cookie", `${cookie}; ${nonceCookie}`)
      .expect(302);

    const connector = await adminPool.query(
      "SELECT id, config::text AS config FROM connectors WHERE tenant_id = $1::uuid AND type = 'SLACK'",
      [tenantId],
    );
    expect(connector.rows[0].config).toContain("tokenExpiresAt");
    const secrets = await adminPool.query(
      "SELECT cle FROM tenant_secrets WHERE tenant_id = $1::uuid AND cle LIKE $2 ORDER BY cle",
      [tenantId, `connecteur.${connector.rows[0].id}.%`],
    );
    expect(secrets.rows.map((row) => row.cle)).toEqual([
      `connecteur.${connector.rows[0].id}.access_token`,
      `connecteur.${connector.rows[0].id}.refresh_token`,
      `connecteur.${connector.rows[0].id}.webhook_url`,
    ]);
  });

  test("une réponse fournisseur illisible devient une erreur contrôlée", async () => {
    configureOauth();
    const { cookie } = await owner();
    const start = await request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/autorisation")
      .set("Cookie", cookie)
      .expect(200);
    const state = new URL(start.body.url).searchParams.get("state")!;
    const setCookies = Array.isArray(start.headers["set-cookie"])
      ? start.headers["set-cookie"]
      : [String(start.headers["set-cookie"] ?? "")];
    const nonceCookie = setCookies.find((value: string) => value.startsWith("nodaq_oauth_nonce="))!.split(";")[0];
    vi.stubGlobal("fetch", vi.fn(async () => new Response("réponse non JSON", { status: 200 })));

    const response = await request(serveurTest(app))
      .get(`/api/connecteurs/PENNYLANE/retour?code=code-test&state=${encodeURIComponent(state)}`)
      .set("Cookie", `${cookie}; ${nonceCookie}`);
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/connecteurs?erreur=AUTORISATION_A_RETIRER");
  });

  test("un essai devenu lecture seule bloque le retour avant l'échange externe", async () => {
    configureOauth();
    const { cookie, tenantId } = await owner();
    const start = await request(serveurTest(app))
      .post("/api/connecteurs/GOOGLE_DRIVE/autorisation")
      .set("Cookie", cookie)
      .expect(200);
    await adminPool.query(
      "UPDATE subscriptions SET statut = 'READONLY' WHERE tenant_id = $1::uuid",
      [tenantId],
    );
    const state = new URL(start.body.url).searchParams.get("state")!;
    const setCookies = Array.isArray(start.headers["set-cookie"])
      ? start.headers["set-cookie"]
      : [String(start.headers["set-cookie"] ?? "")];
    const nonceCookie = setCookies.find((value: string) => value.startsWith("nodaq_oauth_nonce="))!.split(";")[0];
    const external = vi.fn();
    vi.stubGlobal("fetch", external);

    const response = await request(serveurTest(app))
      .get(`/api/connecteurs/GOOGLE_DRIVE/retour?code=code-google&state=${encodeURIComponent(state)}`)
      .set("Cookie", `${cookie}; ${nonceCookie}`);
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/connecteurs?erreur=LECTURE_SEULE");
    expect(external).not.toHaveBeenCalled();
  });

  test("Slack refuse une réponse sans webhook Slack autorisé", async () => {
    configureOauth();
    const { cookie, tenantId } = await owner();
    const start = await request(serveurTest(app))
      .post("/api/connecteurs/SLACK/autorisation")
      .set("Cookie", cookie)
      .expect(200);
    const state = new URL(start.body.url).searchParams.get("state")!;
    const setCookies = Array.isArray(start.headers["set-cookie"])
      ? start.headers["set-cookie"]
      : [String(start.headers["set-cookie"] ?? "")];
    const nonceCookie = setCookies.find((value: string) => value.startsWith("nodaq_oauth_nonce="))!.split(";")[0];
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: true,
      access_token: "xoxb-ne-doit-pas-etre-garde",
      incoming_webhook: { url: "https://evil.example/intercepte" },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await request(serveurTest(app))
      .get(`/api/connecteurs/SLACK/retour?code=code-slack&state=${encodeURIComponent(state)}`)
      .set("Cookie", `${cookie}; ${nonceCookie}`)
      .expect(302)
      .expect("Location", "/connecteurs?erreur=AUTORISATION_A_RETIRER");

    const rows = await adminPool.query(
      "SELECT count(*)::int AS count FROM tenant_secrets WHERE tenant_id = $1::uuid",
      [tenantId],
    );
    expect(rows.rows[0].count).toBe(0);
  });

  test("une tentative OAuth active ne peut pas être écrasée par un second démarrage", async () => {
    configureOauth();
    const { cookie, tenantId } = await owner();
    const first = await request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/autorisation")
      .set("Cookie", cookie)
      .expect(200);
    await request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/autorisation")
      .set("Cookie", cookie)
      .expect(409);
    const stateOf = (response: typeof first): string => new URL(response.body.url).searchParams.get("state")!;
    const nonceOf = (response: typeof first): string => {
      const values = Array.isArray(response.headers["set-cookie"])
        ? response.headers["set-cookie"]
        : [String(response.headers["set-cookie"] ?? "")];
      return values.find((value: string) => value.startsWith("nodaq_oauth_nonce="))!.split(";")[0]!;
    };
    const external = vi.fn(async () => new Response(JSON.stringify({
      access_token: "pennylane-access-last-attempt",
      refresh_token: "pennylane-refresh-last-attempt",
      expires_in: 3_600,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", external);

    await request(serveurTest(app))
      .get(`/api/connecteurs/PENNYLANE/retour?code=autorise&state=${encodeURIComponent(stateOf(first))}`)
      .set("Cookie", `${cookie}; ${nonceOf(first)}`)
      .expect(302)
      .expect("Location", "/connecteurs?connexion=PENNYLANE");
    expect(external).toHaveBeenCalledTimes(1);

    const connector = await adminPool.query(
      "SELECT status FROM connectors WHERE tenant_id = $1::uuid AND type = 'PENNYLANE'",
      [tenantId],
    );
    expect(connector.rows[0].status).toBe("CONNECTE");
  });

  test("une déconnexion pendant l'échange garde le callback tardif visible après une nouvelle tentative", async () => {
    configureOauth();
    const { cookie, tenantId } = await owner();
    const start = await request(serveurTest(app))
      .post("/api/connecteurs/GOOGLE_DRIVE/autorisation")
      .set("Cookie", cookie)
      .expect(200);
    const state = new URL(start.body.url).searchParams.get("state")!;
    const values = Array.isArray(start.headers["set-cookie"])
      ? start.headers["set-cookie"]
      : [String(start.headers["set-cookie"] ?? "")];
    const nonceCookie = values.find((value: string) => value.startsWith("nodaq_oauth_nonce="))!.split(";")[0]!;
    const external = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "https://oauth2.googleapis.com/token") {
        const disconnected = await request(serveurTest(app))
          .patch("/api/connecteurs/GOOGLE_DRIVE")
          .set("Cookie", cookie)
          .send({ status: "NON_CONNECTE", config: {} })
          .expect(200);
        expect(disconnected.body.externalActionRequired).toBe(true);
        const acknowledged = await request(serveurTest(app))
          .patch("/api/connecteurs/GOOGLE_DRIVE")
          .set("Cookie", cookie)
          .send({
            status: "NON_CONNECTE",
            config: {},
            externalRevocationConfirmed: true,
            externalRevocationId: disconnected.body.config.externalRevocationId,
          })
          .expect(200);
        expect(acknowledged.body.config).toMatchObject({ connectionInProgress: true });

        const guarded = await adminPool.query(
          "SELECT config FROM connectors WHERE tenant_id = $1::uuid AND type = 'GOOGLE_DRIVE'",
          [tenantId],
        );
        const guardedConfig = guarded.rows[0].config as Record<string, unknown>;
        const guardedTombstones = guardedConfig["__oauthAttemptTombstones"] as Record<
          string,
          { state: string; expiresAt: string }
        >;
        expect(Object.values(guardedTombstones)).toHaveLength(1);
        expect(Object.values(guardedTombstones)[0]).toMatchObject({ state: "ACKNOWLEDGED" });
        // Le code OAuth peut rester valable dix minutes : le garde-fou ne doit
        // pas reprendre le lease réseau de cinq minutes.
        expect(Date.parse(Object.values(guardedTombstones)[0]!.expiresAt) - Date.now())
          .toBeGreaterThan(14 * 60_000);

        // Simule l'horizon écoulé : une reconnexion redevient possible, mais le
        // tombstone reste physiquement présent pour qu'un worker très tardif
        // puisse réaffirmer l'alerte sans écraser la nouvelle tentative.
        for (const tombstone of Object.values(guardedTombstones)) {
          tombstone.expiresAt = new Date(Date.now() - 1_000).toISOString();
        }
        await adminPool.query(
          "UPDATE connectors SET config = $2::jsonb WHERE tenant_id = $1::uuid AND type = 'GOOGLE_DRIVE'",
          [tenantId, JSON.stringify(guardedConfig)],
        );
        await request(serveurTest(app))
          .post("/api/connecteurs/GOOGLE_DRIVE/autorisation")
          .set("Cookie", cookie)
          .expect(200);

        return new Response(JSON.stringify({
          access_token: "google-access-orphan",
          refresh_token: "google-refresh-orphan",
          expires_in: 3_600,
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", external);

    await request(serveurTest(app))
      .get(`/api/connecteurs/GOOGLE_DRIVE/retour?code=code-google&state=${encodeURIComponent(state)}`)
      .set("Cookie", `${cookie}; ${nonceCookie}`)
      .expect(302)
      .expect("Location", "/connecteurs?erreur=AUTORISATION_A_RETIRER");

    expect(external.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://oauth2.googleapis.com/token",
    ]);
    const connector = await adminPool.query(
      "SELECT status, config FROM connectors WHERE tenant_id = $1::uuid AND type = 'GOOGLE_DRIVE'",
      [tenantId],
    );
    expect(connector.rows[0]).toMatchObject({
      status: "NON_CONNECTE",
      config: { externalActionRequired: true },
    });
    expect(connector.rows[0].config["__oauthAttemptHash"]).toEqual(expect.any(String));
    const finalTombstones = connector.rows[0].config["__oauthAttemptTombstones"] as Record<
      string,
      { state: string; expiresAt: string }
    >;
    expect(Object.values(finalTombstones).some((item) => item.state === "NEEDS_ACTION")).toBe(true);
    const secrets = await adminPool.query(
      "SELECT count(*)::int AS count FROM tenant_secrets WHERE tenant_id = $1::uuid",
      [tenantId],
    );
    expect(secrets.rows[0].count).toBe(0);
  });

  test("un échange revendiqué reste bloquant après son lease jusqu'à une remise à zéro", async () => {
    const { cookie, tenantId } = await owner();
    await request(serveurTest(app)).get("/api/connecteurs").set("Cookie", cookie).expect(200);
    await adminPool.query(
      `UPDATE connectors
          SET config = $2::jsonb
        WHERE tenant_id = $1::uuid AND type = 'PENNYLANE'`,
      [tenantId, JSON.stringify({
        __oauthAttemptHash: "tentative-revendiquee",
        __oauthAttemptExpiresAt: new Date(Date.now() - 60_000).toISOString(),
        __oauthAttemptPhase: "EXCHANGING",
      })],
    );
    const external = vi.fn();
    vi.stubGlobal("fetch", external);

    await request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/avance")
      .set("Cookie", cookie)
      .send({ apiToken: "pyl_ne-doit-pas-etre-valide" })
      .expect(409);
    expect(external).not.toHaveBeenCalled();

    const visible = await request(serveurTest(app))
      .get("/api/connecteurs")
      .set("Cookie", cookie)
      .expect(200);
    expect(visible.body.connectors.find((item: { type: string }) => item.type === "PENNYLANE").config)
      .toMatchObject({ connectionInProgress: true, connectionAttemptCancelable: true });
  });

  test("compenser une ancienne tentative conserve l'alerte d'une autre tentative en vol", async () => {
    const { cookie, tenantId } = await owner();
    await request(serveurTest(app)).get("/api/connecteurs").set("Cookie", cookie).expect(200);
    const connector = await adminPool.query(
      "SELECT id FROM connectors WHERE tenant_id = $1::uuid AND type = 'PENNYLANE'",
      [tenantId],
    );
    await adminPool.query(
      "UPDATE connectors SET config = $2::jsonb WHERE id = $1",
      [connector.rows[0].id, JSON.stringify({
        externalActionRequired: true,
        __oauthAttemptTombstones: {
          "tentative-compensee": {
            state: "NEEDS_ACTION",
            expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          },
          "tentative-encore-en-vol": {
            state: "PENDING",
            expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          },
        },
      })],
    );

    await resoudreTentativeOAuthCompensee(tenantId, connector.rows[0].id, "tentative-compensee");

    const after = await adminPool.query("SELECT config FROM connectors WHERE id = $1", [connector.rows[0].id]);
    expect(after.rows[0].config).toMatchObject({
      externalActionRequired: true,
      __oauthAttemptTombstones: {
        "tentative-encore-en-vol": { state: "PENDING" },
      },
    });
    expect(after.rows[0].config.__oauthAttemptTombstones["tentative-compensee"]).toBeUndefined();

    await adminPool.query(
      "UPDATE connectors SET config = $2::jsonb WHERE id = $1",
      [connector.rows[0].id, JSON.stringify({
        externalActionRequired: true,
        __externalRevocationAttempt: "44444444-4444-4444-8444-444444444444",
        __oauthAttemptTombstones: {
          "autre-tentative-compensee": {
            state: "NEEDS_ACTION",
            expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          },
        },
      })],
    );
    await resoudreTentativeOAuthCompensee(tenantId, connector.rows[0].id, "autre-tentative-compensee");
    const generation = await adminPool.query("SELECT config FROM connectors WHERE id = $1", [connector.rows[0].id]);
    expect(generation.rows[0].config).toEqual({
      externalActionRequired: true,
      __externalRevocationAttempt: "44444444-4444-4444-8444-444444444444",
    });
  });

  test("une confirmation tardive remet aussi un état ERREUR à zéro", async () => {
    const { cookie, tenantId } = await owner();
    await request(serveurTest(app)).get("/api/connecteurs").set("Cookie", cookie).expect(200);
    await adminPool.query(
      `UPDATE connectors
          SET status = 'ERREUR', config = $2::jsonb
        WHERE tenant_id = $1::uuid AND type = 'SLACK'`,
      [tenantId, JSON.stringify({
        externalActionRequired: true,
        __externalRevocationAttempt: "11111111-1111-4111-8111-111111111111",
        __oauthAttemptTombstones: {
          "callback-tardif": {
            state: "NEEDS_ACTION",
            expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          },
        },
      })],
    );

    await request(serveurTest(app))
      .patch("/api/connecteurs/SLACK")
      .set("Cookie", cookie)
      .send({
        status: "NON_CONNECTE",
        config: {},
        externalRevocationConfirmed: true,
        externalRevocationId: "11111111-1111-4111-8111-111111111111",
      })
      .expect(200);

    const after = await adminPool.query(
      "SELECT status, config FROM connectors WHERE tenant_id = $1::uuid AND type = 'SLACK'",
      [tenantId],
    );
    expect(after.rows[0]).toEqual({ status: "NON_CONNECTE", config: {} });
  });
});

describe("le mode avancé est un repli borné et chiffré", () => {
  test("un jeton Pennylane avancé est chiffré et jamais recopié dans config", async () => {
    const { cookie, tenantId } = await owner();
    const token = `pyl_${crypto.randomBytes(18).toString("hex")}`;
    const validate = vi.fn(async () => new Response(JSON.stringify({
      user: { id: 7, email: "artisan@example.test" },
      company: { id: 42, name: "Atelier test" },
      scopes: ["customers:readonly", "customer_invoices:all", "file_attachments:all"],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", validate);

    await request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/avance")
      .set("Cookie", cookie)
      .send({ apiToken: token })
      .expect(200);

    expect(validate).toHaveBeenCalledWith(
      "https://app.pennylane.com/api/external/v2/me",
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        headers: expect.objectContaining({ Authorization: `Bearer ${token}` }),
      }),
    );

    const rows = await adminPool.query(
      `SELECT c.config::text AS config, s.valeur_chiffree
         FROM connectors c JOIN tenant_secrets s ON s.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1::uuid AND c.type = 'PENNYLANE'
          AND s.cle = 'connecteur.' || c.id || '.api_token'`,
      [tenantId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].config).not.toContain(token);
    expect(rows.rows[0].valeur_chiffree).not.toContain(token);
  });

  test("deux modes avancés simultanés ne peuvent pas s'écraser", async () => {
    const { cookie, tenantId } = await owner();
    let validationStarted!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => { validationStarted = resolve; });
    const validationCanFinish = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async () => {
      validationStarted();
      await validationCanFinish;
      return new Response(JSON.stringify({
        user: { id: 7, email: "artisan@example.test" },
        company: { id: 42, name: "Atelier test" },
        scopes: ["customers:readonly", "customer_invoices:all", "file_attachments:all"],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const firstPromise = request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/avance")
      .set("Cookie", cookie)
      .send({ apiToken: `pyl_${crypto.randomBytes(18).toString("hex")}` })
      .then((response) => response);
    await started;
    await request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/avance")
      .set("Cookie", cookie)
      .send({ apiToken: `pyl_${crypto.randomBytes(18).toString("hex")}` })
      .expect(409);
    release();
    expect((await firstPromise).status).toBe(200);

    const secrets = await adminPool.query(
      "SELECT count(*)::int AS count FROM tenant_secrets WHERE tenant_id = $1::uuid",
      [tenantId],
    );
    expect(secrets.rows[0].count).toBe(1);
  });

  test("une tentative OAuth abandonnée n'interdit pas le repli avancé après son expiration", async () => {
    configureOauth();
    const { cookie, tenantId } = await owner();
    await request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/autorisation")
      .set("Cookie", cookie)
      .expect(200);
    await adminPool.query(
      `UPDATE connectors
          SET config = jsonb_set(config, '{__oauthAttemptExpiresAt}', to_jsonb($2::text))
        WHERE tenant_id = $1::uuid AND type = 'PENNYLANE'`,
      [tenantId, new Date(Date.now() - 60_000).toISOString()],
    );
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      user: { id: 7, email: "artisan@example.test" },
      company: { id: 42, name: "Atelier test" },
      scopes: ["customers:readonly", "customer_invoices:all", "file_attachments:all"],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/avance")
      .set("Cookie", cookie)
      .send({ apiToken: `pyl_${crypto.randomBytes(18).toString("hex")}` })
      .expect(200);
  });

  test("une validation avancée expirée n'empêche pas de revenir au parcours OAuth", async () => {
    configureOauth();
    const { cookie, tenantId } = await owner();
    await request(serveurTest(app)).get("/api/connecteurs").set("Cookie", cookie).expect(200);
    await adminPool.query(
      `UPDATE connectors
          SET config = $2::jsonb
        WHERE tenant_id = $1::uuid AND type = 'PENNYLANE'`,
      [tenantId, JSON.stringify({
        __oauthAttemptHash: "validation-avancee-crashee",
        __oauthAttemptExpiresAt: new Date(Date.now() - 60_000).toISOString(),
        __oauthAttemptPhase: "ADVANCED_VALIDATING",
      })],
    );

    await request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/autorisation")
      .set("Cookie", cookie)
      .expect(200);
  });

  test("une validation avancée tardive ne ressuscite pas un jeton déjà retiré", async () => {
    const { cookie, tenantId } = await owner();
    const oldToken = `pyl_ancien_${crypto.randomBytes(12).toString("hex")}`;
    const newToken = `pyl_nouveau_${crypto.randomBytes(12).toString("hex")}`;
    let oldValidationStarted!: () => void;
    let releaseOldValidation!: () => void;
    const started = new Promise<void>((resolve) => { oldValidationStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseOldValidation = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
      if (authorization === `Bearer ${oldToken}`) {
        oldValidationStarted();
        await release;
      }
      return new Response(JSON.stringify({
        user: { id: 7, email: "artisan@example.test" },
        company: { id: 42, name: "Atelier test" },
        scopes: ["customers:readonly", "customer_invoices:all", "file_attachments:all"],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const oldRequest = request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/avance")
      .set("Cookie", cookie)
      .send({ apiToken: oldToken })
      .then((response) => response);
    await started;

    await request(serveurTest(app))
      .patch("/api/connecteurs/PENNYLANE")
      .set("Cookie", cookie)
      .send({ status: "NON_CONNECTE", config: {} })
      .expect(200);
    await request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/avance")
      .set("Cookie", cookie)
      .send({ apiToken: newToken })
      .expect(200);
    const current = await visibleConnectorConfig(cookie, "PENNYLANE");
    const disconnected = await request(serveurTest(app))
      .patch("/api/connecteurs/PENNYLANE")
      .set("Cookie", cookie)
      .send({ status: "NON_CONNECTE", config: {}, connectionId: current["connectionId"] })
      .expect(200);
    await request(serveurTest(app))
      .patch("/api/connecteurs/PENNYLANE")
      .set("Cookie", cookie)
      .send({
        status: "NON_CONNECTE",
        config: {},
        externalRevocationConfirmed: true,
        externalRevocationId: disconnected.body.config.externalRevocationId,
      })
      .expect(200);

    releaseOldValidation();
    expect((await oldRequest).status).toBe(409);
    const after = await adminPool.query(
      "SELECT status, config FROM connectors WHERE tenant_id = $1::uuid AND type = 'PENNYLANE'",
      [tenantId],
    );
    expect(after.rows[0]).toEqual({ status: "NON_CONNECTE", config: {} });
    const secrets = await adminPool.query(
      "SELECT count(*)::int AS count FROM tenant_secrets WHERE tenant_id = $1::uuid",
      [tenantId],
    );
    expect(secrets.rows[0].count).toBe(0);
  });

  test("un jeton Pennylane refusé n'est jamais conservé ni annoncé connecté", async () => {
    const { cookie, tenantId } = await owner();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_token" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })));

    const response = await request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/avance")
      .set("Cookie", cookie)
      .send({ apiToken: `pyl_${crypto.randomBytes(18).toString("hex")}` });
    expect(response.status).toBe(400);

    const connector = await adminPool.query(
      "SELECT id, status FROM connectors WHERE tenant_id = $1::uuid AND type = 'PENNYLANE'",
      [tenantId],
    );
    expect(connector.rows[0].status).toBe("NON_CONNECTE");
    const secrets = await adminPool.query(
      "SELECT count(*)::int AS count FROM tenant_secrets WHERE tenant_id = $1::uuid",
      [tenantId],
    );
    expect(secrets.rows[0].count).toBe(0);
  });

  test("un jeton Pennylane valide mais sans les droits requis est refusé", async () => {
    const { cookie, tenantId } = await owner();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      user: { id: 7, email: "artisan@example.test" },
      company: { id: 42, name: "Atelier test" },
      scopes: ["customers:readonly", "customer_invoices:readonly"],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const response = await request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/avance")
      .set("Cookie", cookie)
      .send({ apiToken: `pyl_${crypto.randomBytes(18).toString("hex")}` });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("droits");

    const secrets = await adminPool.query(
      "SELECT count(*)::int AS count FROM tenant_secrets WHERE tenant_id = $1::uuid",
      [tenantId],
    );
    expect(secrets.rows[0].count).toBe(0);
  });

  test("Stripe, Google et Slack refusent les secrets manuels", async () => {
    const { cookie } = await owner();
    for (const type of ["STRIPE", "GOOGLE_DRIVE", "SLACK"]) {
      const response = await request(serveurTest(app))
        .post(`/api/connecteurs/${type}/avance`)
        .set("Cookie", cookie)
        .send({ apiToken: "ne-doit-jamais-etre-accepte" });
      expect(response.status, type).toBe(400);
    }
  });

  test("un client ne peut pas déclarer un connecteur géré comme connecté", async () => {
    const { cookie } = await owner();
    await request(serveurTest(app)).get("/api/connecteurs").set("Cookie", cookie).expect(200);

    const response = await request(serveurTest(app))
      .patch("/api/connecteurs/STRIPE")
      .set("Cookie", cookie)
      .send({ status: "CONNECTE" });

    expect(response.status).toBe(400);
  });

  test("se déconnecter supprime les secrets et conserve l'action externe à confirmer", async () => {
    const { cookie, tenantId } = await owner();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      user: { id: 7, email: "artisan@example.test" },
      company: { id: 42, name: "Atelier test" },
      scopes: ["customers:readonly", "customer_invoices:all", "file_attachments:all"],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    await request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/avance")
      .set("Cookie", cookie)
      .send({ apiToken: `pyl_${crypto.randomBytes(18).toString("hex")}` })
      .expect(200);
    const connectedConfig = await visibleConnectorConfig(cookie, "PENNYLANE");

    const disconnected = await request(serveurTest(app))
      .patch("/api/connecteurs/PENNYLANE")
      .set("Cookie", cookie)
      .send({ status: "NON_CONNECTE", connectionId: connectedConfig["connectionId"] })
      .expect(200);
    expect(disconnected.body.externalActionRequired).toBe(true);

    const connector = await adminPool.query(
      "SELECT id, status, last_sync_at, config FROM connectors WHERE tenant_id = $1::uuid AND type = 'PENNYLANE'",
      [tenantId],
    );
    expect(connector.rows[0]).toMatchObject({
      status: "NON_CONNECTE",
      last_sync_at: null,
      config: { externalActionRequired: true },
    });
    const secrets = await adminPool.query(
      "SELECT cle FROM tenant_secrets WHERE tenant_id = $1::uuid AND cle LIKE $2",
      [tenantId, `connecteur.${connector.rows[0].id}.%`],
    );
    expect(secrets.rows).toHaveLength(0);
  });

  test("la lecture seule autorise uniquement la déconnexion d'un outil", async () => {
    configureOauth();
    const { cookie, tenantId } = await owner();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      user: { id: 7, email: "artisan@example.test" },
      company: { id: 42, name: "Atelier test" },
      scopes: ["customers:readonly", "customer_invoices:all", "file_attachments:all"],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    await request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/avance")
      .set("Cookie", cookie)
      .send({ apiToken: `pyl_${crypto.randomBytes(18).toString("hex")}` })
      .expect(200);
    const connectedConfig = await visibleConnectorConfig(cookie, "PENNYLANE");
    await adminPool.query(
      "UPDATE subscriptions SET statut = 'READONLY' WHERE tenant_id = $1::uuid",
      [tenantId],
    );

    await request(serveurTest(app))
      .post("/api/connecteurs/SLACK/autorisation")
      .set("Cookie", cookie)
      .expect(403);
    const disconnected = await request(serveurTest(app))
      .patch("/api/connecteurs/PENNYLANE")
      .set("Cookie", cookie)
      .send({ status: "NON_CONNECTE", config: {}, connectionId: connectedConfig["connectionId"] })
      .expect(200);
    await request(serveurTest(app))
      .patch("/api/connecteurs/PENNYLANE")
      .set("Cookie", cookie)
      .send({
        status: "NON_CONNECTE",
        config: {},
        externalRevocationConfirmed: true,
        externalRevocationId: disconnected.body.config.externalRevocationId,
      })
      .expect(200);

    const remaining = await adminPool.query(
      "SELECT count(*)::int AS count FROM tenant_secrets WHERE tenant_id = $1::uuid",
      [tenantId],
    );
    expect(remaining.rows[0].count).toBe(0);
  });

  test("une révocation Google reste manuelle et durable sans appel global inter-tenant", async () => {
    configureOauth();
    const { cookie, tenantId } = await owner();
    const start = await request(serveurTest(app))
      .post("/api/connecteurs/GOOGLE_DRIVE/autorisation")
      .set("Cookie", cookie)
      .expect(200);
    const state = new URL(start.body.url).searchParams.get("state")!;
    const startCookies = Array.isArray(start.headers["set-cookie"])
      ? start.headers["set-cookie"]
      : [String(start.headers["set-cookie"] ?? "")];
    const nonceCookie = startCookies.find((value: string) => value.startsWith("nodaq_oauth_nonce="))!.split(";")[0];
    const external = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "google-access-test",
        refresh_token: "google-refresh-test",
        expires_in: 3_600,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", external);
    await request(serveurTest(app))
      .get(`/api/connecteurs/GOOGLE_DRIVE/retour?code=code-google&state=${encodeURIComponent(state)}`)
      .set("Cookie", `${cookie}; ${nonceCookie}`)
      .expect(302);
    const connectedConfig = await visibleConnectorConfig(cookie, "GOOGLE_DRIVE");

    const disconnected = await request(serveurTest(app))
      .patch("/api/connecteurs/GOOGLE_DRIVE")
      .set("Cookie", cookie)
      .send({ status: "NON_CONNECTE", config: {}, connectionId: connectedConfig["connectionId"] })
      .expect(200);
    expect(disconnected.body.externalActionRequired).toBe(true);
    expect(external.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://oauth2.googleapis.com/token",
    ]);

    const visible = await request(serveurTest(app))
      .get("/api/connecteurs")
      .set("Cookie", cookie)
      .expect(200);
    expect(visible.body.connectors.find((item: { type: string }) => item.type === "GOOGLE_DRIVE").config)
      .toMatchObject({ externalActionRequired: true });
    await request(serveurTest(app))
      .post("/api/connecteurs/GOOGLE_DRIVE/autorisation")
      .set("Cookie", cookie)
      .expect(409);

    await request(serveurTest(app))
      .patch("/api/connecteurs/GOOGLE_DRIVE")
      .set("Cookie", cookie)
      .send({
        status: "NON_CONNECTE",
        config: {},
        externalRevocationConfirmed: true,
        externalRevocationId: disconnected.body.config.externalRevocationId,
      })
      .expect(200);
    const acknowledged = await adminPool.query(
      "SELECT config FROM connectors WHERE tenant_id = $1::uuid AND type = 'GOOGLE_DRIVE'",
      [tenantId],
    );
    expect(acknowledged.rows[0].config).toEqual({});

    const remaining = await adminPool.query(
      "SELECT count(*)::int AS count FROM tenant_secrets WHERE tenant_id = $1::uuid",
      [tenantId],
    );
    expect(remaining.rows[0].count).toBe(0);
  });

  test("une révocation Pennylane ciblée ne masque pas un ancien callback ambigu", async () => {
    configureOauth();
    const { cookie, tenantId } = await owner();
    const start = await request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/autorisation")
      .set("Cookie", cookie)
      .expect(200);
    const state = new URL(start.body.url).searchParams.get("state")!;
    const values = Array.isArray(start.headers["set-cookie"])
      ? start.headers["set-cookie"]
      : [String(start.headers["set-cookie"] ?? "")];
    const nonceCookie = values.find((value: string) => value.startsWith("nodaq_oauth_nonce="))!.split(";")[0]!;
    const external = vi.fn(async (url: string | URL | Request) => (
      String(url).endsWith("/oauth/token")
        ? new Response(JSON.stringify({
            access_token: "pennylane-access-current",
            refresh_token: "pennylane-refresh-current",
            expires_in: 3_600,
          }), { status: 200, headers: { "Content-Type": "application/json" } })
        : new Response(null, { status: 200 })
    ));
    vi.stubGlobal("fetch", external);
    await request(serveurTest(app))
      .get(`/api/connecteurs/PENNYLANE/retour?code=code-pennylane&state=${encodeURIComponent(state)}`)
      .set("Cookie", `${cookie}; ${nonceCookie}`)
      .expect(302)
      .expect("Location", "/connecteurs?connexion=PENNYLANE");

    const connected = await adminPool.query(
      "SELECT config FROM connectors WHERE tenant_id = $1::uuid AND type = 'PENNYLANE'",
      [tenantId],
    );
    await adminPool.query(
      "UPDATE connectors SET config = $2::jsonb WHERE tenant_id = $1::uuid AND type = 'PENNYLANE'",
      [tenantId, JSON.stringify({
        ...connected.rows[0].config,
        externalActionRequired: true,
        __oauthAttemptTombstones: {
          "ancienne-tentative": {
            state: "NEEDS_ACTION",
            expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          },
        },
      })],
    );

    const disconnected = await request(serveurTest(app))
      .patch("/api/connecteurs/PENNYLANE")
      .set("Cookie", cookie)
      .send({
        status: "NON_CONNECTE",
        config: {},
        connectionId: connected.rows[0].config.__connectionVersion,
      })
      .expect(200);
    expect(disconnected.body.externalActionRequired).toBe(true);
    expect(external.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://app.pennylane.com/oauth/token",
      "https://app.pennylane.com/oauth/revoke",
    ]);

    const stillVisible = await adminPool.query(
      "SELECT config FROM connectors WHERE tenant_id = $1::uuid AND type = 'PENNYLANE'",
      [tenantId],
    );
    expect(stillVisible.rows[0].config).toMatchObject({
      externalActionRequired: true,
      __oauthAttemptTombstones: {
        "ancienne-tentative": { state: "NEEDS_ACTION" },
      },
    });

    await request(serveurTest(app))
      .patch("/api/connecteurs/PENNYLANE")
      .set("Cookie", cookie)
      .send({
        status: "NON_CONNECTE",
        config: {},
        externalRevocationConfirmed: true,
        externalRevocationId: disconnected.body.config.externalRevocationId,
      })
      .expect(200);
    const acknowledged = await adminPool.query(
      "SELECT config FROM connectors WHERE tenant_id = $1::uuid AND type = 'PENNYLANE'",
      [tenantId],
    );
    expect(acknowledged.rows[0].config).toEqual({});
  });

  test("un ancien succès de révocation ne peut pas acquitter une connexion plus récente", async () => {
    const { cookie, tenantId } = await owner();
    const validate = vi.fn(async () => new Response(JSON.stringify({
      user: { id: 7, email: "artisan@example.test" },
      company: { id: 42, name: "Atelier test" },
      scopes: ["customers:readonly", "customer_invoices:all", "file_attachments:all"],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", validate);
    const connect = async (suffix: string): Promise<void> => {
      await request(serveurTest(app))
        .post("/api/connecteurs/PENNYLANE/avance")
        .set("Cookie", cookie)
        .send({ apiToken: `pyl_${suffix}_${crypto.randomBytes(12).toString("hex")}` })
        .expect(200);
    };

    await connect("premiere");
    const row = await adminPool.query(
      "SELECT id FROM connectors WHERE tenant_id = $1::uuid AND type = 'PENNYLANE'",
      [tenantId],
    );
    const connectorId = row.rows[0].id as string;
    const firstConnection = await visibleConnectorConfig(cookie, "PENNYLANE");
    const first = await deconnecterConnecteur(
      tenantId,
      connectorId,
      String(firstConnection["connectionId"]),
    );
    expect(first.revocationAttemptId).toEqual(expect.any(String));
    await confirmerRetraitExterneManuellement(tenantId, connectorId, first.revocationAttemptId!);

    await connect("seconde");
    const secondConnection = await visibleConnectorConfig(cookie, "PENNYLANE");
    const second = await deconnecterConnecteur(
      tenantId,
      connectorId,
      String(secondConnection["connectionId"]),
    );
    expect(second.revocationAttemptId).toEqual(expect.any(String));
    expect(second.revocationAttemptId).not.toBe(first.revocationAttemptId);

    await expect(confirmerRetraitExterneConnecteur(
      tenantId,
      connectorId,
      first.revocationAttemptId!,
    )).rejects.toBeInstanceOf(Error);

    const after = await adminPool.query("SELECT config FROM connectors WHERE id = $1", [connectorId]);
    expect(after.rows[0].config).toMatchObject({
      externalActionRequired: true,
      __externalRevocationAttempt: second.revocationAttemptId,
    });
  });

  test("des clics de déconnexion ou confirmation anciens ne touchent jamais la génération suivante", async () => {
    const { cookie, tenantId } = await owner();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      user: { id: 7, email: "artisan@example.test" },
      company: { id: 42, name: "Atelier test" },
      scopes: ["customers:readonly", "customer_invoices:all", "file_attachments:all"],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const connect = async (): Promise<Record<string, string | boolean>> => {
      await request(serveurTest(app))
        .post("/api/connecteurs/PENNYLANE/avance")
        .set("Cookie", cookie)
        .send({ apiToken: `pyl_${crypto.randomBytes(18).toString("hex")}` })
        .expect(200);
      return visibleConnectorConfig(cookie, "PENNYLANE");
    };
    const disconnect = async (connectionId: string) => request(serveurTest(app))
      .patch("/api/connecteurs/PENNYLANE")
      .set("Cookie", cookie)
      .send({ status: "NON_CONNECTE", config: {}, connectionId })
      .expect(200);
    const acknowledge = async (externalRevocationId: string, status = 200) => request(serveurTest(app))
      .patch("/api/connecteurs/PENNYLANE")
      .set("Cookie", cookie)
      .send({
        status: "NON_CONNECTE",
        config: {},
        externalRevocationConfirmed: true,
        externalRevocationId,
      })
      .expect(status);

    const firstConnection = await connect();
    const firstDisconnect = await disconnect(String(firstConnection["connectionId"]));
    const firstAction = String(firstDisconnect.body.config.externalRevocationId);
    await acknowledge(firstAction);

    const secondConnection = await connect();
    await request(serveurTest(app))
      .patch("/api/connecteurs/PENNYLANE")
      .set("Cookie", cookie)
      .send({ status: "NON_CONNECTE", config: {}, connectionId: firstConnection["connectionId"] })
      .expect(409);
    const stillConnected = await adminPool.query(
      "SELECT status FROM connectors WHERE tenant_id = $1::uuid AND type = 'PENNYLANE'",
      [tenantId],
    );
    expect(stillConnected.rows[0].status).toBe("CONNECTE");

    const secondDisconnect = await disconnect(String(secondConnection["connectionId"]));
    const secondAction = String(secondDisconnect.body.config.externalRevocationId);
    expect(secondAction).not.toBe(firstAction);
    await acknowledge(firstAction, 409);
    const stillPending = await visibleConnectorConfig(cookie, "PENNYLANE");
    expect(stillPending).toMatchObject({
      externalActionRequired: true,
      externalRevocationId: secondAction,
    });
    await acknowledge(secondAction);
  });

  test("un connecteur Google en erreur n'appelle jamais la révocation globale", async () => {
    configureOauth();
    const { cookie, tenantId } = await owner();
    const start = await request(serveurTest(app))
      .post("/api/connecteurs/GOOGLE_DRIVE/autorisation")
      .set("Cookie", cookie)
      .expect(200);
    const state = new URL(start.body.url).searchParams.get("state")!;
    const values = Array.isArray(start.headers["set-cookie"])
      ? start.headers["set-cookie"]
      : [String(start.headers["set-cookie"] ?? "")];
    const nonceCookie = values.find((value: string) => value.startsWith("nodaq_oauth_nonce="))!.split(";")[0]!;
    const external = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: "google-access-error-state",
        refresh_token: "google-refresh-error-state",
        expires_in: 3_600,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", external);
    await request(serveurTest(app))
      .get(`/api/connecteurs/GOOGLE_DRIVE/retour?code=code-google&state=${encodeURIComponent(state)}`)
      .set("Cookie", `${cookie}; ${nonceCookie}`)
      .expect(302);
    const connectedConfig = await visibleConnectorConfig(cookie, "GOOGLE_DRIVE");
    await adminPool.query(
      "UPDATE connectors SET status = 'ERREUR' WHERE tenant_id = $1::uuid AND type = 'GOOGLE_DRIVE'",
      [tenantId],
    );

    await request(serveurTest(app))
      .patch("/api/connecteurs/GOOGLE_DRIVE")
      .set("Cookie", cookie)
      .send({ status: "NON_CONNECTE", config: {}, connectionId: connectedConfig["connectionId"] })
      .expect(200);

    expect(external.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://oauth2.googleapis.com/token",
    ]);
  });

  test("un refresh token corrompu interdit d'affirmer la révocation complète", async () => {
    configureOauth();
    const { cookie, tenantId } = await owner();
    const start = await request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/autorisation")
      .set("Cookie", cookie)
      .expect(200);
    const state = new URL(start.body.url).searchParams.get("state")!;
    const values = Array.isArray(start.headers["set-cookie"])
      ? start.headers["set-cookie"]
      : [String(start.headers["set-cookie"] ?? "")];
    const nonceCookie = values.find((value: string) => value.startsWith("nodaq_oauth_nonce="))!.split(";")[0]!;
    const external = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/oauth/token")
      ? new Response(JSON.stringify({
        access_token: "pennylane-access-readable",
        refresh_token: "pennylane-refresh-corrupted",
        expires_in: 3_600,
      }), { status: 200, headers: { "Content-Type": "application/json" } })
      : new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", external);
    await request(serveurTest(app))
      .get(`/api/connecteurs/PENNYLANE/retour?code=code-pennylane&state=${encodeURIComponent(state)}`)
      .set("Cookie", `${cookie}; ${nonceCookie}`)
      .expect(302);
    const connectedConfig = await visibleConnectorConfig(cookie, "PENNYLANE");
    await adminPool.query(
      "UPDATE tenant_secrets SET valeur_chiffree = 'chiffre-invalide' WHERE tenant_id = $1::uuid AND cle LIKE '%.refresh_token'",
      [tenantId],
    );

    const disconnected = await request(serveurTest(app))
      .patch("/api/connecteurs/PENNYLANE")
      .set("Cookie", cookie)
      .send({ status: "NON_CONNECTE", config: {}, connectionId: connectedConfig["connectionId"] })
      .expect(200);
    expect(disconnected.body.externalActionRequired).toBe(true);
    expect(external.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://app.pennylane.com/oauth/token",
      "https://app.pennylane.com/oauth/revoke",
    ]);

    const connector = await adminPool.query(
      "SELECT config FROM connectors WHERE tenant_id = $1::uuid AND type = 'PENNYLANE'",
      [tenantId],
    );
    expect(connector.rows[0].config).toMatchObject({ externalActionRequired: true });

    const remaining = await adminPool.query(
      "SELECT count(*)::int AS count FROM tenant_secrets WHERE tenant_id = $1::uuid",
      [tenantId],
    );
    expect(remaining.rows[0].count).toBe(0);
  });

  test("un secret annoncé mais absent conserve aussi l'action externe", async () => {
    configureOauth();
    const { cookie, tenantId } = await owner();
    const start = await request(serveurTest(app))
      .post("/api/connecteurs/PENNYLANE/autorisation")
      .set("Cookie", cookie)
      .expect(200);
    const state = new URL(start.body.url).searchParams.get("state")!;
    const values = Array.isArray(start.headers["set-cookie"])
      ? start.headers["set-cookie"]
      : [String(start.headers["set-cookie"] ?? "")];
    const nonceCookie = values.find((value: string) => value.startsWith("nodaq_oauth_nonce="))!.split(";")[0]!;
    const external = vi.fn(async (url: string | URL | Request) => String(url).endsWith("/oauth/token")
      ? new Response(JSON.stringify({
        access_token: "pennylane-access-present",
        refresh_token: "pennylane-refresh-missing",
        expires_in: 3_600,
      }), { status: 200, headers: { "Content-Type": "application/json" } })
      : new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", external);
    await request(serveurTest(app))
      .get(`/api/connecteurs/PENNYLANE/retour?code=code-pennylane&state=${encodeURIComponent(state)}`)
      .set("Cookie", `${cookie}; ${nonceCookie}`)
      .expect(302);
    const connectedConfig = await visibleConnectorConfig(cookie, "PENNYLANE");
    await adminPool.query(
      "DELETE FROM tenant_secrets WHERE tenant_id = $1::uuid AND cle LIKE '%.refresh_token'",
      [tenantId],
    );

    const disconnected = await request(serveurTest(app))
      .patch("/api/connecteurs/PENNYLANE")
      .set("Cookie", cookie)
      .send({ status: "NON_CONNECTE", config: {}, connectionId: connectedConfig["connectionId"] })
      .expect(200);
    expect(disconnected.body.externalActionRequired).toBe(true);
    const connector = await adminPool.query(
      "SELECT config FROM connectors WHERE tenant_id = $1::uuid AND type = 'PENNYLANE'",
      [tenantId],
    );
    expect(connector.rows[0].config).toMatchObject({ externalActionRequired: true });
  });

  test("un ancien connecteur sans mode ne prétend jamais avoir été révoqué à distance", async () => {
    const { cookie, tenantId } = await owner();
    await request(serveurTest(app)).get("/api/connecteurs").set("Cookie", cookie).expect(200);
    await adminPool.query(
      `UPDATE connectors
          SET status = 'CONNECTE', config = '{"__secrets":["apiKey"]}'::jsonb
        WHERE tenant_id = $1::uuid AND type = 'PENNYLANE'`,
      [tenantId],
    );

    const visible = await request(serveurTest(app))
      .get("/api/connecteurs")
      .set("Cookie", cookie)
      .expect(200);
    expect(visible.body.connectors.find((item: { type: string }) => item.type === "PENNYLANE").status)
      .toBe("ERREUR");
    expect(visible.body.connected).toBe(0);
    expect(visible.body.withError).toBe(1);

    const disconnected = await request(serveurTest(app))
      .patch("/api/connecteurs/PENNYLANE")
      .set("Cookie", cookie)
      .send({ status: "NON_CONNECTE", config: {} })
      .expect(200);
    expect(disconnected.body.externalActionRequired).toBe(true);
  });
});
