/**
 * Envoi depuis le domaine de l'artisan — lot 3.
 *
 * Ce que ces tests protègent :
 *   a. les deux modes livrés (domaine authentifié, repli) ;
 *   b. le repli AVERTIT sur la délivrabilité — un repli silencieux ferait
 *      croire que tout va bien pendant que les devis tombent en indésirables ;
 *   c. AUCUN corps ni sujet de message dans le journal ;
 *   d. la vérification DNS nomme précisément l'enregistrement manquant.
 *
 * L'isolation de `parametres_envoi` et `envois_journal` est couverte par
 * rls.test.ts, qui boucle sur BUSINESS_TABLES.
 *
 * AUCUN ENVOI RÉEL : `getTransporter()` refuse de construire un transport
 * quand NODE_ENV vaut « test », et le résolveur DNS est injecté.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest } from "./helpers";

let cookie: string;
let tenantId: string;
const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

beforeAll(async () => {
  const email = `envoi-${Date.now()}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Martin", tenantNom: "Toiture Martin" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  cookie = reg.headers["set-cookie"]?.[0] ?? "";
  const { body: me } = await request(serveurTest(app)).get("/api/auth/me").set("Cookie", cookie).expect(200);
  tenantId = me.tenantId;
  cleanupTenantIds.push(tenantId);
}, 60_000);

afterAll(async () => {
  for (const t of ["envois_journal", "parametres_envoi"]) {
    await adminPool.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1::uuid[])`, [cleanupTenantIds]);
  }
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

// ── a & b. Les deux modes, et l'avertissement du repli ───────────────────────

describe("a — LES DEUX MODES", () => {
  test("par défaut, un tenant neuf est en repli et AVERTI", async () => {
    const { body } = await request(serveurTest(app))
      .get("/api/parametres-envoi")
      .set("Cookie", cookie)
      .expect(200);

    expect(body.avertissementDelivrabilite).toBe(true);
    expect(body.messageAvertissement).toMatch(/indésirables/i);
    expect(body.messageAvertissement).toMatch(/nodaq\.fr/);
  });

  test("le mode domaine authentifié exige un domaine et une adresse", async () => {
    const res = await request(serveurTest(app))
      .put("/api/parametres-envoi")
      .set("Cookie", cookie)
      .send({ mode: "domaine_authentifie" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/domaine/i);
  });

  test("l'adresse d'expédition doit appartenir au domaine déclaré", async () => {
    // Expédier « martin@gmail.com » depuis un domaine authentifié échouerait à
    // l'alignement DMARC, sans message clair pour l'artisan.
    const res = await request(serveurTest(app))
      .put("/api/parametres-envoi")
      .set("Cookie", cookie)
      .send({
        mode: "domaine_authentifie",
        domaine: "toituremartin.fr",
        emailExpediteur: "martin@gmail.com",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/doit appartenir au domaine/i);
  });

  test("un paramétrage valide est accepté mais NON vérifié tant que le DNS ne l'est pas", async () => {
    const { body } = await request(serveurTest(app))
      .put("/api/parametres-envoi")
      .set("Cookie", cookie)
      .send({
        mode: "domaine_authentifie",
        domaine: "toituremartin.fr",
        emailExpediteur: "contact@toituremartin.fr",
        nomExpediteur: "Toiture Martin",
      })
      .expect(200);

    expect(body.mode).toBe("domaine_authentifie");
    // Déclaré n'est pas vérifié : le produit ne doit pas expédier depuis un
    // domaine dont SPF et DKIM n'ont jamais été contrôlés.
    expect(body.verifieLe).toBeNull();
  });
});

describe("b — LE REPLI AVERTIT", () => {
  test("un domaine déclaré mais non vérifié reste en avertissement", async () => {
    const { body } = await request(serveurTest(app))
      .get("/api/parametres-envoi")
      .set("Cookie", cookie)
      .expect(200);
    expect(body.parametres.mode).toBe("domaine_authentifie");
    expect(body.parametres.verifieLe).toBeNull();
    // Le mode est déclaré, mais l'envoi partira en repli — donc on avertit.
    expect(body.avertissementDelivrabilite).toBe(true);
  });
});

// ── c. Aucun contenu de message dans le journal ──────────────────────────────

describe("c — JOURNAL sans corps ni sujet", () => {
  test("l'envoi d'un devis journalise le destinataire, jamais le contenu", async () => {
    const devis = await request(serveurTest(app))
      .post("/api/devis")
      .set("Cookie", cookie)
      .send({
        clientName: "Madame Dupont",
        lines: [{ description: "Réfection toiture", quantity: 1, unitPriceCents: 500000, vatRate: 20 }],
      })
      .expect(201);

    await request(serveurTest(app))
      .post(`/api/devis/${devis.body.id}/envoyer`)
      .set("Cookie", cookie)
      .send({ emailTo: "cliente@exemple.test", message: "Bonjour Madame Dupont" })
      .expect(200);

    const { body } = await request(serveurTest(app))
      .get("/api/parametres-envoi/journal")
      .set("Cookie", cookie)
      .expect(200);

    expect(body.envois.length).toBeGreaterThan(0);
    const trace = body.envois[0];
    expect(trace.destinataire).toBe("cliente@exemple.test");
    expect(trace.documentType).toBe("DEVIS");

    // La trace ne doit contenir NI sujet NI corps, sous aucune clé.
    const serialise = JSON.stringify(trace);
    expect(serialise).not.toMatch(/bon pour accord/i);   // le sujet
    expect(serialise).not.toMatch(/Bonjour Madame Dupont/); // le corps
    expect(serialise).not.toMatch(/Réfection toiture/);     // la ligne du devis
    expect(Object.keys(trace)).not.toContain("subject");
    expect(Object.keys(trace)).not.toContain("sujet");
    expect(Object.keys(trace)).not.toContain("body");
  });

  test("la colonne de journal ne comporte aucun champ de contenu", async () => {
    const { rows } = await adminPool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'envois_journal'`,
    );
    const colonnes = rows.map((r) => r.column_name);
    for (const interdite of ["subject", "sujet", "body", "corps", "message", "contenu"]) {
      expect(colonnes).not.toContain(interdite);
    }
  });
});

// ── d. Vérification DNS ───────────────────────────────────────────────────────

describe("d — VÉRIFICATION DNS", () => {
  test("sans EMAIL_SPF_INCLUDE, la vérification est refusée et le dit", async () => {
    const sauvegarde = process.env["EMAIL_SPF_INCLUDE"];
    delete process.env["EMAIL_SPF_INCLUDE"];
    try {
      const res = await request(serveurTest(app))
        .post("/api/parametres-envoi/verifier")
        .set("Cookie", cookie);
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/EMAIL_SPF_INCLUDE/);
    } finally {
      if (sauvegarde !== undefined) process.env["EMAIL_SPF_INCLUDE"] = sauvegarde;
    }
  });

  test("avec la configuration mais sans DNS publié, chaque manque est NOMMÉ", async () => {
    process.env["EMAIL_SPF_INCLUDE"] = "include:_spf.exemple-fournisseur.test";
    try {
      const { body } = await request(serveurTest(app))
        .post("/api/parametres-envoi/verifier")
        .set("Cookie", cookie)
        .expect(200);

      expect(body.conforme).toBe(false);
      // Le domaine de test n'existe pas : rien n'est publié, tout est signalé.
      expect(body.manquants.length).toBeGreaterThan(0);
      const spf = body.enregistrements.find((e: { type: string }) => e.type === "SPF");
      expect(spf.nom).toBe("toituremartin.fr");
      expect(spf.commentFaire).toContain("include:_spf.exemple-fournisseur.test");
    } finally {
      delete process.env["EMAIL_SPF_INCLUDE"];
    }
  }, 30_000);
});
