/**
 * La page que voit le CLIENT de l'artisan.
 *
 * Ce que ces tests protègent :
 *   — le client voit CE QU'IL ACCEPTE : toutes les lignes et les trois totaux ;
 *   — l'entreprise qui envoie est NOMMÉE, avec son SIRET ;
 *   — la route publique n'expose aucune autre donnée du tenant ;
 *   — un jeton d'un autre tenant n'ouvre rien ;
 *   — les bornes des réglages d'objectif, une par valeur refusée.
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

let compteurIp = 0;
const ipUnique = (): string => `203.0.113.${(compteurIp++ % 250) + 1}`;
const publicGet = (chemin: string) => request(app).get(chemin).set("X-Forwarded-For", ipUnique());

async function inscrire(nom: string): Promise<Locataire> {
  const email = `pageclient-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
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

async function reglage(tenantId: string, cle: string, valeur: string): Promise<void> {
  await adminPool.query(
    `INSERT INTO settings (tenant_id, key, value) VALUES ($1::uuid, $2, $3)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [tenantId, cle, valeur],
  );
}

/** Devis ENVOYÉ avec des lignes réelles. Rend le jeton en clair. */
async function devisAvecLignes(l: Locataire): Promise<{ id: string; token: string; reference: string }> {
  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  const reference = `DEV-${crypto.randomBytes(3).toString("hex")}`;
  const sha = crypto.createHash("sha256").update(token).digest("hex");

  const lignes = [
    { id: crypto.randomUUID(), description: "Cloison BA13", quantity: 30, unitPriceCents: 4_500, vatRate: 10, vatCategory: "S", unit: "m2" },
    { id: crypto.randomUUID(), description: "Peinture deux couches", quantity: 30, unitPriceCents: 2_000, vatRate: 10, vatCategory: "S", unit: "m2" },
  ];
  const totalHT = 30 * 4_500 + 30 * 2_000;
  const totalTTC = Math.round(totalHT * 1.1);

  await adminPool.query(
    `INSERT INTO devis (id, tenant_id, reference, client_name, status, lines,
                        total_ht_cents, total_ttc_cents, tva_rate, accept_token_sha256, date_envoi)
     VALUES ($1, $2::uuid, $3, 'Madame Client', 'ENVOYE', $4::json, $5, $6, 10, $7, NOW())`,
    [id, l.tenantId, reference, JSON.stringify(lignes), totalHT, totalTTC, sha],
  );
  return { id, token, reference };
}

beforeAll(async () => {
  a = await inscrire("a");
  b = await inscrire("b");
  await reglage(a.tenantId, "company.nom", "Toiture Martin SARL");
  await reglage(a.tenantId, "company.siret", "12345678901234");
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

// ── Le client voit ce qu'il accepte ─────────────────────────────────────────

describe("le client voit CE QU'IL ACCEPTE", () => {
  test("toutes les lignes du devis sont renvoyées", async () => {
    const d = await devisAvecLignes(a);
    const { body } = await publicGet(`/api/public/devis/${d.token}/accept-page`).expect(200);

    expect(body.lignes).toHaveLength(2);
    expect(body.lignes[0].description).toBe("Cloison BA13");
    expect(body.lignes[0].quantity).toBe(30);
    expect(body.lignes[0].unit).toBe("m2");
    expect(body.lignes[0].unitPriceCents).toBe(4_500);
    expect(body.lignes[0].vatRate).toBe(10);
    // Le montant de ligne est calculé côté serveur : deux calculs du même
    // montant finissent par diverger.
    expect(body.lignes[0].montantHTCents).toBe(135_000);
  });

  test("les TROIS totaux sont renvoyés et cohérents", async () => {
    const d = await devisAvecLignes(a);
    const { body } = await publicGet(`/api/public/devis/${d.token}/accept-page`).expect(200);

    expect(body.totalHTCents).toBe(195_000);
    expect(body.totalTTCCents).toBe(214_500);
    // La TVA n'est pas un troisième chiffre indépendant : elle est la
    // différence, sinon l'écran pourrait afficher un total qui ne s'additionne
    // pas.
    expect(body.totalTVACents).toBe(body.totalTTCCents - body.totalHTCents);
  });

  test("la date de validité est renvoyée", async () => {
    const d = await devisAvecLignes(a);
    await adminPool.query(`UPDATE devis SET valid_until = '2027-12-31' WHERE id = $1`, [d.id]);
    const { body } = await publicGet(`/api/public/devis/${d.token}/accept-page`).expect(200);
    expect(body.validUntil).toBe("2027-12-31");
  });
});

// ── L'entreprise est nommée ─────────────────────────────────────────────────

describe("l'entreprise qui envoie est NOMMÉE", () => {
  test("nom et SIRET figurent dans la réponse", async () => {
    // C'est la première chose qu'un client cherche avant de s'engager, et ce
    // qui distingue cette page d'une tentative d'hameçonnage.
    const d = await devisAvecLignes(a);
    const { body } = await publicGet(`/api/public/devis/${d.token}/accept-page`).expect(200);
    expect(body.entreprise.nom).toBe("Toiture Martin SARL");
    expect(body.entreprise.siret).toBe("12345678901234");
  });

  test("une entreprise sans SIRET renseigné rend `null`, pas une chaîne vide", async () => {
    const d = await devisAvecLignes(b);
    const { body } = await publicGet(`/api/public/devis/${d.token}/accept-page`).expect(200);
    expect(body.entreprise.nom).toBeNull();
    expect(body.entreprise.siret).toBeNull();
  });

  test("l'écran « déjà accepté » nomme aussi l'entreprise", async () => {
    const d = await devisAvecLignes(a);
    await request(app)
      .post(`/api/public/devis/${d.token}/accept`)
      .set("X-Forwarded-For", ipUnique())
      .send({ signataire: "Jean Client" })
      .expect(200);
    const { body } = await publicGet(`/api/public/devis/${d.token}/accept-page`).expect(200);
    expect(body.alreadyAccepted).toBe(true);
    expect(body.entreprise.nom).toBe("Toiture Martin SARL");
  });
});

// ── Rien d'autre ne sort ────────────────────────────────────────────────────

describe("la route publique n'expose QUE ce devis", () => {
  test("aucune autre donnée du tenant ne traverse", async () => {
    // Un autre devis, avec une référence reconnaissable.
    const autre = await devisAvecLignes(a);
    await adminPool.query(`UPDATE devis SET client_name = 'CLIENT-SECRET-XYZ' WHERE id = $1`, [autre.id]);

    const cible = await devisAvecLignes(a);
    const { body } = await publicGet(`/api/public/devis/${cible.token}/accept-page`).expect(200);

    const corps = JSON.stringify(body);
    expect(corps).not.toContain("CLIENT-SECRET-XYZ");
    expect(corps).not.toContain(autre.reference);
    // Ni identifiant interne, ni jeton, ni condensat.
    expect(corps).not.toContain(cible.id);
    expect(corps).not.toContain(cible.token);
  });

  test("un jeton du tenant A n'ouvre rien chez B, et réciproquement", async () => {
    const chezA = await devisAvecLignes(a);
    const chezB = await devisAvecLignes(b);
    const rA = await publicGet(`/api/public/devis/${chezA.token}/accept-page`).expect(200);
    const rB = await publicGet(`/api/public/devis/${chezB.token}/accept-page`).expect(200);
    expect(rA.body.reference).toBe(chezA.reference);
    expect(rB.body.reference).toBe(chezB.reference);
    expect(rA.body.entreprise.nom).toBe("Toiture Martin SARL");
    expect(rB.body.entreprise.nom).toBeNull();
  });
});

// ── Bornes des réglages d'objectif ──────────────────────────────────────────

describe("les bornes sont tenues PAR LA ROUTE, pas par l'écran", () => {
  test("LE CAS OBSERVÉ : 35 au lieu de 3500 est refusé en 400", async () => {
    // L'application avait affiché, sans broncher, un seuil de rentabilité de
    // 13 714 286 €. Le calcul était juste ; l'entrée était absurde.
    const r = await request(app)
      .patch("/api/parametres")
      .set("Cookie", a.cookie)
      .send({ "objectifs.taux_marge_bp": "35" })
      .expect(400);
    expect(r.body.error).toContain("3500");
  });

  test.each([
    ["taux nul", { "objectifs.taux_marge_bp": "0" }],
    ["taux négatif", { "objectifs.taux_marge_bp": "-500" }],
    ["taux au-delà de 100 %", { "objectifs.taux_marge_bp": "15000" }],
    ["taux décimal", { "objectifs.taux_marge_bp": "3500.5" }],
    ["charges nulles", { "objectifs.charges_fixes_annuelles_cents": "0" }],
    ["charges négatives", { "objectifs.charges_fixes_annuelles_cents": "-1" }],
    ["charges hors fourchette TPE", { "objectifs.charges_fixes_annuelles_cents": "999999999999" }],
  ])("%s → 400", async (_label, corps) => {
    await request(app).patch("/api/parametres").set("Cookie", a.cookie).send(corps).expect(400);
  });

  test("une valeur refusée n'est PAS enregistrée", async () => {
    await request(app).patch("/api/parametres").set("Cookie", a.cookie)
      .send({ "objectifs.taux_marge_bp": "35" }).expect(400);
    const { rows } = await adminPool.query(
      `SELECT value FROM settings WHERE tenant_id = $1::uuid AND key = 'objectifs.taux_marge_bp'`,
      [a.tenantId],
    );
    expect(rows.map((r) => r.value)).not.toContain("35");
  });

  test("un lot mixte est refusé EN ENTIER — rien n'est écrit", async () => {
    // Écrire la moitié valide d'un lot refusé laisserait un paramétrage
    // incohérent, à moitié appliqué et à moitié non.
    await request(app).patch("/api/parametres").set("Cookie", a.cookie)
      .send({ "objectifs.taux_marge_bp": "3500", "objectifs.charges_fixes_annuelles_cents": "1" })
      .expect(400);
    const { rows } = await adminPool.query(
      `SELECT key FROM settings WHERE tenant_id = $1::uuid AND key LIKE 'objectifs.%'`,
      [a.tenantId],
    );
    expect(rows).toHaveLength(0);
  });

  test("des valeurs correctes passent, et le cockpit les lit", async () => {
    await request(app).patch("/api/parametres").set("Cookie", a.cookie)
      .send({
        "objectifs.taux_marge_bp": "3500",
        "objectifs.charges_fixes_annuelles_cents": "12000000",
      })
      .expect(200);

    const { body } = await request(app)
      .get("/api/cockpit/objectifs").set("Cookie", a.cookie).expect(200);
    const seuil = body.objectifs.find((o: { id: string }) => o.id === "seuil_rentabilite");
    expect(seuil.configurable).toBeUndefined();
    // 12 000 000 c ÷ 0,35 = 34 285 714 c. Et surtout PAS 1 371 428 571.
    expect(seuil.seuilCents).toBe(34_285_714);
  });
});
