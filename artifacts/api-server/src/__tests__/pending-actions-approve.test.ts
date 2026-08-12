/**
 * Régression — approuver depuis le cockpit doit RÉELLEMENT écrire.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  `POST /pending-actions/:id/approve` ne faisait que basculer le statut   ║
 * ║  sur `APPROUVE` — jamais d'appel à `executerPlan`. Seul le chemin dédié   ║
 * ║  `/voix/executer` (utilisé par le micro flottant) écrivait réellement.   ║
 * ║  Approuver une proposition de l'agent de chat DEPUIS LE COCKPIT — le     ║
 * ║  bouton que l'écran expose — ne produisait donc AUCUNE des opérations    ║
 * ║  proposées. Ce test échoue sur l'ancien code, à l'étape 1 ci-dessous.    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers } from "./helpers";

interface Locataire { cookie: string; tenantId: string }

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

let a: Locataire;
let b: Locataire;

async function inscrire(nom: string): Promise<Locataire> {
  const email = `approve-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: `Patron ${nom}`, tenantNom: `Tenant ${nom}` })
    .expect(201);
  const cookie = reg.headers["set-cookie"]?.[0] ?? "";
  const { body: me } = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
  cleanupTenantIds.push(me.tenantId);
  return { cookie, tenantId: me.tenantId };
}

beforeAll(async () => {
  a = await inscrire("a");
  b = await inscrire("b");
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

describe("POST /pending-actions/:id/approve exécute réellement un plan vocal", () => {
  test("l'agent propose un prospect → approuver DEPUIS LE COCKPIT (pas /voix/executer) → le prospect existe", async () => {
    const avant = await adminPool.query(
      `SELECT count(*)::int AS n FROM prospects WHERE tenant_id = $1::uuid`, [a.tenantId],
    );

    const { body: propose } = await request(app)
      .post("/api/chat/messages")
      .set("Cookie", a.cookie)
      .send({ content: "Crée un prospect Jean Dupont au 0612345678" })
      .expect(200);
    expect(propose.planId, "l'agent doit avoir créé un plan").toBeTruthy();

    // Rien n'est encore écrit — la proposition seule ne suffit pas.
    const pendant = await adminPool.query(
      `SELECT count(*)::int AS n FROM prospects WHERE tenant_id = $1::uuid`, [a.tenantId],
    );
    expect(pendant.rows[0].n).toBe(avant.rows[0].n);

    // Le chemin du BOUTON DU COCKPIT — pas /voix/executer.
    const approuve = await request(app)
      .post(`/api/pending-actions/${propose.planId}/approve`)
      .set("Cookie", a.cookie)
      .expect(200);
    expect(approuve.body.status).toBe("VALIDEE");

    const apres = await adminPool.query(
      `SELECT count(*)::int AS n FROM prospects WHERE tenant_id = $1::uuid AND name = 'Jean Dupont'`,
      [a.tenantId],
    );
    expect(apres.rows[0].n).toBe(1);
  });

  test("un second appel n'écrit pas en double", async () => {
    const { body: propose } = await request(app)
      .post("/api/chat/messages")
      .set("Cookie", a.cookie)
      .send({ content: "Crée un prospect Jean Dupont au 0612345678" })
      .expect(200);

    await request(app).post(`/api/pending-actions/${propose.planId}/approve`).set("Cookie", a.cookie).expect(200);
    await request(app).post(`/api/pending-actions/${propose.planId}/approve`).set("Cookie", a.cookie).expect(200);

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM prospects WHERE tenant_id = $1::uuid AND name = 'Jean Dupont'`,
      [a.tenantId],
    );
    // Deux appels, une seule écriture pour CE plan (la première ligne du test
    // précédent en ajoute une autre — on vérifie ici l'absence de doublon
    // pour le plan de CE test, donc au plus 2 au total, jamais 3).
    expect(rows[0].n).toBeLessThanOrEqual(2);
  });

  test("isolation : le tenant B ne peut pas approuver le plan de A", async () => {
    const { body: propose } = await request(app)
      .post("/api/chat/messages")
      .set("Cookie", a.cookie)
      .send({ content: "Crée un prospect Jean Dupont au 0612345678" })
      .expect(200);

    const reponse = await request(app)
      .post(`/api/pending-actions/${propose.planId}/approve`)
      .set("Cookie", b.cookie);
    expect(reponse.status).toBe(404);
    expect(JSON.stringify(reponse.body)).not.toContain("Jean Dupont");

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM prospects WHERE tenant_id = $1::uuid`, [b.tenantId],
    );
    expect(rows[0].n).toBe(0);
  });
});
