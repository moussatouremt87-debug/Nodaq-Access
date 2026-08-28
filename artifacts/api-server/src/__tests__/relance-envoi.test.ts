/**
 * Une relance approuvée ENVOIE — e-mail et WhatsApp.
 *
 * ── LE DÉFAUT CORRIGÉ ─────────────────────────────────────────────────────
 * `relance_devis` était inséré dans `pending_actions` et n'était lu par
 * personne : le type n'apparaissait qu'une seule fois dans tout le dépôt, sa
 * propre définition. La campagne rédigeait objet, corps et lien WhatsApp,
 * l'humain approuvait, et l'approbation se contentait de passer le statut à
 * `APPROUVE`. Rien ne partait, et rien ne le disait.
 *
 * ── CE QUE CES TESTS PROTÈGENT ────────────────────────────────────────────
 * Le premier est la garde du défaut : approuver doit ENVOYER. Les autres
 * couvrent les manières de croire qu'on a envoyé sans l'avoir fait —
 * l'exemplaire en double, l'échec muet, la configuration absente.
 *
 * ── POURQUOI L'OPÉRATEUR EST SIMULÉ, ET RIEN D'AUTRE ──────────────────────
 * `fetch` global est remplacé pour la seule API de l'opérateur : aucun test
 * ne doit atteindre le réseau. Le reste de la chaîne — route, transaction,
 * réservation, journal — s'exécute pour de vrai contre PostgreSQL. Simuler
 * l'exécuteur lui-même ne prouverait que la simulation.
 */
import { describe, test, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app.js";
import {
  adminPool,
  cleanupTenants,
  cleanupUsers,
  completeMfaForRegisteredOwner,
  serveurTest,
} from "./helpers.js";

const tenantIds: string[] = [];
const emails: string[] = [];
let cookie = "";
let tenantId = "";

/** Les appels sortants vers l'opérateur, corps NON conservé (règle 6). */
let appelsOperateur: Array<{ to: string; from: string }> = [];
let reponseOperateur: { ok: boolean; status: number } = { ok: true, status: 201 };
const vraiFetch = globalThis.fetch;

beforeAll(async () => {
  const email = `renv-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Toiture Vasseur" })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantId = body.tenantId;
  tenantIds.push(tenantId);
  cookie = headers["set-cookie"][0];

  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const adresse = String(url);
    if (adresse.includes("api.twilio.com")) {
      const params = new URLSearchParams(String(init?.body ?? ""));
      appelsOperateur.push({ to: params.get("To") ?? "", from: params.get("From") ?? "" });
      return {
        ok: reponseOperateur.ok,
        status: reponseOperateur.status,
        json: async () => ({ sid: "SM-simule" }),
      } as Response;
    }
    return vraiFetch(url as string, init);
  }) as typeof fetch;
}, 90_000);

afterAll(async () => {
  globalThis.fetch = vraiFetch;
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

beforeEach(() => {
  appelsOperateur = [];
  reponseOperateur = { ok: true, status: 201 };
  process.env["TELEPHONY_ACCOUNT_SID"] = "AC-simule";
  process.env["TELEPHONY_AUTH_TOKEN"] = "jeton-simule";
  process.env["WHATSAPP_FROM"] = "+14155238886";
});

/** Un devis ENVOYÉ il y a 30 jours, avec le contact voulu. */
async function devisRelancable(opts: {
  telephone?: string | null;
  email?: string | null;
}): Promise<void> {
  const clientId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO clients (id, tenant_id, nom, telephone, email)
     VALUES ($1, $2::uuid, $3, $4, $5)`,
    [clientId, tenantId, "Marchetti", opts.telephone ?? null, opts.email ?? null],
  );
  await adminPool.query(
    `INSERT INTO devis (id, tenant_id, reference, client_name, client_id, status,
                        date_envoi, total_ttc_cents)
     VALUES ($1, $2::uuid, $3, 'Marchetti', $4, 'ENVOYE',
             now() - interval '30 days', 480000)`,
    [crypto.randomUUID(), tenantId, `DV-${crypto.randomBytes(3).toString("hex")}`, clientId],
  );
}

/** Propose une campagne et rend l'identifiant de la seule action créée. */
async function proposerEtRecupererAction(): Promise<string> {
  await request(serveurTest(app))
    .post("/api/relance/devis/proposer")
    .set("Cookie", cookie)
    .expect(201);
  const { rows } = await adminPool.query(
    `SELECT id FROM pending_actions
      WHERE tenant_id = $1::uuid AND type = 'relance_devis' AND execute_le IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [tenantId],
  );
  return rows[0].id as string;
}

/** Nettoie entre deux scénarios — chaque test part d'une file vide. */
async function vider(): Promise<void> {
  await adminPool.query(`DELETE FROM pending_actions WHERE tenant_id = $1::uuid`, [tenantId]);
  await adminPool.query(`DELETE FROM activity WHERE tenant_id = $1::uuid`, [tenantId]);
  await adminPool.query(`DELETE FROM devis WHERE tenant_id = $1::uuid`, [tenantId]);
  await adminPool.query(`DELETE FROM clients WHERE tenant_id = $1::uuid`, [tenantId]);
}

describe("Approuver une relance l'envoie", () => {
  test("le message WhatsApp part vraiment chez l'opérateur", async () => {
    await vider();
    await devisRelancable({ telephone: "0612345678", email: "marchetti@exemple.fr" });
    const actionId = await proposerEtRecupererAction();

    await request(serveurTest(app))
      .post(`/api/pending-actions/${actionId}/approve`)
      .set("Cookie", cookie)
      .expect(200);

    // LA garde du défaut : sans elle, approuver ne faisait rien.
    expect(appelsOperateur).toHaveLength(1);
    expect(appelsOperateur[0]!.to).toBe("whatsapp:+33612345678");
    expect(appelsOperateur[0]!.from).toBe("whatsapp:+14155238886");
  });

  test("l'exécution est consignée, et dit par quels canaux", async () => {
    await vider();
    await devisRelancable({ telephone: "0612345678", email: "marchetti@exemple.fr" });
    const actionId = await proposerEtRecupererAction();
    await request(serveurTest(app))
      .post(`/api/pending-actions/${actionId}/approve`)
      .set("Cookie", cookie)
      .expect(200);

    const { rows } = await adminPool.query(
      `SELECT label, meta FROM activity
        WHERE tenant_id = $1::uuid AND type = 'relance_devis.envoyee'`,
      [tenantId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toContain("whatsapp");
    // Ni numéro ni corps de message dans la trace (règle 6).
    expect(JSON.stringify(rows[0].meta)).not.toContain("0612345678");
    expect(JSON.stringify(rows[0].meta)).not.toContain("+33612345678");
  });

  test("approuver deux fois n'envoie qu'une fois", async () => {
    await vider();
    await devisRelancable({ telephone: "0612345678", email: "marchetti@exemple.fr" });
    const actionId = await proposerEtRecupererAction();

    await request(serveurTest(app))
      .post(`/api/pending-actions/${actionId}/approve`)
      .set("Cookie", cookie)
      .expect(200);
    // Le second passage est REFUSÉ, il ne réussit pas silencieusement : un
    // client relancé deux fois est une faute visible.
    await request(serveurTest(app))
      .post(`/api/pending-actions/${actionId}/approve`)
      .set("Cookie", cookie)
      .expect(409);

    expect(appelsOperateur).toHaveLength(1);
  });

  test("sans expéditeur configuré, rien ne part et le journal le dit", async () => {
    await vider();
    delete process.env["WHATSAPP_FROM"];
    await devisRelancable({ telephone: "0612345678", email: "marchetti@exemple.fr" });
    const actionId = await proposerEtRecupererAction();

    await request(serveurTest(app))
      .post(`/api/pending-actions/${actionId}/approve`)
      .set("Cookie", cookie)
      .expect(200);

    expect(appelsOperateur).toHaveLength(0);
    const { rows } = await adminPool.query(
      `SELECT meta FROM activity
        WHERE tenant_id = $1::uuid AND type = 'relance_devis.envoyee'`,
      [tenantId],
    );
    // Une relance qui n'est pas partie DOIT se voir — sinon l'artisan croit
    // avoir relancé.
    expect(JSON.stringify(rows[0].meta)).toContain("non_configure");
  });

  test("un refus de l'opérateur est consigné comme un échec, pas comme un envoi", async () => {
    await vider();
    reponseOperateur = { ok: false, status: 400 };
    await devisRelancable({ telephone: "0612345678", email: "marchetti@exemple.fr" });
    const actionId = await proposerEtRecupererAction();

    await request(serveurTest(app))
      .post(`/api/pending-actions/${actionId}/approve`)
      .set("Cookie", cookie)
      .expect(200);

    const { rows } = await adminPool.query(
      `SELECT label, meta FROM activity
        WHERE tenant_id = $1::uuid AND type = 'relance_devis.envoyee'`,
      [tenantId],
    );
    const trace = JSON.stringify(rows[0].meta);
    expect(trace).toContain("echec");
    expect(trace).not.toContain('"etat":"envoye"');
  });

  test("sans numéro, la relance part sans WhatsApp — et ne prétend pas l'avoir envoyé", async () => {
    await vider();
    await devisRelancable({ telephone: null, email: "marchetti@exemple.fr" });
    const actionId = await proposerEtRecupererAction();

    await request(serveurTest(app))
      .post(`/api/pending-actions/${actionId}/approve`)
      .set("Cookie", cookie)
      .expect(200);

    expect(appelsOperateur).toHaveLength(0);
    const { rows } = await adminPool.query(
      `SELECT meta FROM activity
        WHERE tenant_id = $1::uuid AND type = 'relance_devis.envoyee'`,
      [tenantId],
    );
    expect(JSON.stringify(rows[0].meta)).toContain("sans_destinataire");
  });
});
