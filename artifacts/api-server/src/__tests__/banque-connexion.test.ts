/**
 * Connecteur bancaire — session de connexion (routes/connecteurs.ts) et
 * webhook (routes/webhooks-banque.ts).
 *
 * Ce que ces tests protègent :
 *   a. sans Bridge configuré → 503, explicite, jamais un 500.
 *   b. session : crée l'utilisateur Bridge UNE SEULE FOIS (idempotence),
 *      renvoie l'URL du funnel.
 *   c. webhook : signature vérifiée AVANT toute lecture (401 sur signature
 *      absente/invalide/forgée) ; tenant introuvable → 404, jamais un
 *      indice sur ce qui existe.
 *   d. webhook : item.created met à jour le statut ; item.account.updated
 *      resynchronise les comptes (listerComptes mocké) et upsert
 *      bank_accounts.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import {
  adminPool,
  createTestTenant,
  createTestUser,
  createTestMembership,
  createTestSession,
  cookieHeader,
  cleanupTenants,
  cleanupUsers,
  serveurTest,
} from "./helpers";

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

const REQUIRED_ENV = {
  BRIDGE_CLIENT_ID: "test-client-id",
  BRIDGE_CLIENT_SECRET: "test-client-secret",
  BRIDGE_WEBHOOK_SECRET: "test-webhook-secret",
} as const;

beforeEach(() => {
  for (const [k, v] of Object.entries(REQUIRED_ENV)) process.env[k] = v;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const k of Object.keys(REQUIRED_ENV)) delete process.env[k];
});

afterEach(async () => {
  await cleanupTenants(...cleanupTenantIds);
  cleanupTenantIds.length = 0;
  await cleanupUsers(...cleanupEmails);
  cleanupEmails.length = 0;
});

/** Un OWNER authentifié, cookie de session prêt à l'emploi. */
async function ownerConnecte(): Promise<{ cookie: string; tenantId: string }> {
  const t = await createTestTenant("Banque Test");
  cleanupTenantIds.push(t.id);
  const email = `banque-owner-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  cleanupEmails.push(email);
  const u = await createTestUser(email);
  await createTestMembership(u.id, t.id, "OWNER");
  const session = await createTestSession(u.id, t.id);
  return { cookie: cookieHeader(session.id), tenantId: t.id };
}

// ── a. Sans Bridge configuré ────────────────────────────────────────────────

describe("a — POST /connecteurs/banque/session sans Bridge configuré", () => {
  test("503, jamais un 500", async () => {
    delete process.env["BRIDGE_CLIENT_ID"];
    const { cookie } = await ownerConnecte();
    const res = await request(serveurTest(app)).post("/api/connecteurs/banque/session").set("Cookie", cookie);
    expect(res.status).toBe(503);
  });
});

// ── b. Session de connexion ─────────────────────────────────────────────────

describe("b — POST /connecteurs/banque/session", () => {
  test("crée l'utilisateur Bridge une seule fois, renvoie l'URL du funnel", async () => {
    const { cookie, tenantId } = await ownerConnecte();

    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/users")) {
          return new Response(JSON.stringify({ uuid: "bridge-user-uuid-1" }), { status: 201 });
        }
        if (url.endsWith("/authorization/token")) {
          return new Response(JSON.stringify({ access_token: "user-token" }), { status: 200 });
        }
        if (url.endsWith("/connect-sessions")) {
          return new Response(
            JSON.stringify({ id: "session-1", url: "https://connect.bridgeapi.io/session-1" }),
            { status: 201 },
          );
        }
        throw new Error(`URL inattendue : ${url}`);
      }),
    );

    const res1 = await request(serveurTest(app)).post("/api/connecteurs/banque/session").set("Cookie", cookie);
    expect(res1.status).toBe(200);
    expect(res1.body.url).toBe("https://connect.bridgeapi.io/session-1");
    expect(calls.filter((u) => u.endsWith("/users"))).toHaveLength(1);

    const { rows } = await adminPool.query(
      `SELECT bridge_user_uuid, statut FROM bank_connections WHERE tenant_id = $1::uuid`,
      [tenantId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.bridge_user_uuid).toBe("bridge-user-uuid-1");
    expect(rows[0]!.statut).toBe("en_attente");

    // Second appel : même connexion déjà en base, PAS de second POST /users.
    const res2 = await request(serveurTest(app)).post("/api/connecteurs/banque/session").set("Cookie", cookie);
    expect(res2.status).toBe(200);
    expect(calls.filter((u) => u.endsWith("/users"))).toHaveLength(1);
  });
});

// ── c. Webhook — authentification ───────────────────────────────────────────

// `corps` doit rester une CHAÎNE, jamais un Buffer : avec Content-Type
// application/json, superagent réencode un Buffer passé à .send() via son
// propre JSON.stringify (`{"type":"Buffer","data":[...]}`) — les octets
// signés ici et les octets reçus par le serveur (req.rawBody) divergeraient
// alors silencieusement. Même patron que facturation-electronique.test.ts.
function signer(corps: string, secret: string): string {
  const hmac = crypto.createHmac("sha256", secret).update(corps).digest("hex");
  return `t=${Date.now()},v1=${hmac}`;
}

describe("c — POST /webhooks/banque — authentification", () => {
  test("signature absente → 401", async () => {
    const res = await request(serveurTest(app))
      .post("/api/webhooks/banque")
      .send({ type: "item.created", content: { user_uuid: "x" } });
    expect(res.status).toBe(401);
  });

  test("signature forgée (mauvais secret) → 401", async () => {
    const corps = JSON.stringify({ type: "item.created", content: { user_uuid: "x" } });
    const res = await request(serveurTest(app))
      .post("/api/webhooks/banque")
      .set("Content-Type", "application/json")
      .set("BridgeApi-Signature", signer(corps, "mauvais-secret"))
      .send(corps);
    expect(res.status).toBe(401);
  });

  test("signature valide, mais aucun tenant ne porte ce user_uuid → 404", async () => {
    const corps = JSON.stringify({ type: "item.created", content: { user_uuid: "user-uuid-inconnu" } });
    const res = await request(serveurTest(app))
      .post("/api/webhooks/banque")
      .set("Content-Type", "application/json")
      .set("BridgeApi-Signature", signer(corps, REQUIRED_ENV.BRIDGE_WEBHOOK_SECRET))
      .send(corps);
    expect(res.status).toBe(404);
  });
});

// ── d. Webhook — traitement des événements ─────────────────────────────────

describe("d — POST /webhooks/banque — événements", () => {
  async function tenantAvecConnexion(bridgeUserUuid: string): Promise<string> {
    const t = await createTestTenant("Banque Webhook Test");
    cleanupTenantIds.push(t.id);
    await adminPool.query(
      `INSERT INTO bank_connections (id, tenant_id, bridge_user_uuid, statut)
       VALUES ($1, $2::uuid, $3, 'en_attente')`,
      [crypto.randomUUID(), t.id, bridgeUserUuid],
    );
    return t.id;
  }

  function envoyerWebhook(corps: Record<string, unknown>) {
    const raw = JSON.stringify(corps);
    return request(serveurTest(app))
      .post("/api/webhooks/banque")
      .set("Content-Type", "application/json")
      .set("BridgeApi-Signature", signer(raw, REQUIRED_ENV.BRIDGE_WEBHOOK_SECRET))
      .send(raw);
  }

  test("item.created → statut passe à connecte, bridge_item_id enregistré", async () => {
    const bridgeUserUuid = `bu-${crypto.randomUUID()}`;
    const tenantId = await tenantAvecConnexion(bridgeUserUuid);

    const res = await envoyerWebhook({
      type: "item.created",
      content: { user_uuid: bridgeUserUuid, item_id: 4568477 },
    });
    expect(res.status).toBe(200);

    const { rows } = await adminPool.query(
      `SELECT statut, bridge_item_id FROM bank_connections WHERE tenant_id = $1::uuid`,
      [tenantId],
    );
    expect(rows[0]!.statut).toBe("connecte");
    expect(rows[0]!.bridge_item_id).toBe("4568477");
  });

  test("item.account.updated → resynchronise les comptes (listerComptes mocké)", async () => {
    const bridgeUserUuid = `bu-${crypto.randomUUID()}`;
    const tenantId = await tenantAvecConnexion(bridgeUserUuid);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.endsWith("/authorization/token")) {
          return new Response(JSON.stringify({ access_token: "user-token" }), { status: 200 });
        }
        if (url.endsWith("/accounts")) {
          return new Response(
            JSON.stringify({
              resources: [{ id: 22908770, name: "Compte courant", balance: 1678.12, currency_code: "EUR" }],
            }),
            { status: 200 },
          );
        }
        throw new Error(`URL inattendue : ${url}`);
      }),
    );

    const res = await envoyerWebhook({
      type: "item.account.updated",
      content: { user_uuid: bridgeUserUuid, item_id: 4568477, account_id: 22908770, balance: 1678.12 },
    });
    expect(res.status).toBe(200);

    const { rows } = await adminPool.query(
      `SELECT id, label, balance_cents FROM bank_accounts WHERE tenant_id = $1::uuid`,
      [tenantId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("22908770");
    expect(rows[0]!.balance_cents).toBe(167812);
  });

  test("un webhook pour le tenant A ne modifie jamais les données du tenant B", async () => {
    const bridgeUserUuidA = `bu-${crypto.randomUUID()}`;
    const bridgeUserUuidB = `bu-${crypto.randomUUID()}`;
    const tenantA = await tenantAvecConnexion(bridgeUserUuidA);
    const tenantB = await tenantAvecConnexion(bridgeUserUuidB);

    await envoyerWebhook({
      type: "item.created",
      content: { user_uuid: bridgeUserUuidA, item_id: 111 },
    });

    const { rows: rowsA } = await adminPool.query(
      `SELECT statut FROM bank_connections WHERE tenant_id = $1::uuid`,
      [tenantA],
    );
    const { rows: rowsB } = await adminPool.query(
      `SELECT statut FROM bank_connections WHERE tenant_id = $1::uuid`,
      [tenantB],
    );
    expect(rowsA[0]!.statut).toBe("connecte");
    expect(rowsB[0]!.statut).toBe("en_attente");
  });

  test("type d'événement inconnu → 200, accusé réception sans action", async () => {
    const bridgeUserUuid = `bu-${crypto.randomUUID()}`;
    await tenantAvecConnexion(bridgeUserUuid);

    const res = await envoyerWebhook({ type: "user.deleted", content: { user_uuid: bridgeUserUuid } });
    expect(res.status).toBe(200);
  });
});
