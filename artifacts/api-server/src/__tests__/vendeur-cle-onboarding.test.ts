/**
 * Régression — le nom et l'adresse du vendeur doivent venir du VRAI chemin
 * d'écriture de l'onboarding, pas d'une clé de repli qui n'est jamais posée.
 *
 * Le défaut : `loadSellerInfo`/`chargerEmetteur`/`emetteur` (factures.ts,
 * avoirs.ts, pdf-devis.ts, public.ts) lisaient `company.nom` et
 * `company.adresse_rue`/`_cp`/`_ville`, alors que `POST
 * /onboarding/profil/confirmer` — le seul chemin réel d'écriture — pose
 * `company.raison_sociale` et `company.adresse`/`code_postal`/`commune`.
 * Résultat en production : chaque document émis affichait le nom de repli
 * "Entreprise" et une adresse vide, quel que soit ce que l'utilisateur avait
 * réellement saisi à l'onboarding.
 *
 * Ce test passe par le VRAI point d'entrée (`/onboarding/profil/confirmer`),
 * pas par une insertion directe en base — c'est justement l'écart entre les
 * deux qui a caché le défaut : les fixtures de test posaient déjà la bonne
 * clé par coïncidence, sans jamais emprunter le chemin réel.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, texteBrut } from "./helpers";

const suffix = Date.now().toString(36);
const email = `vendeur-cle-${suffix}@test.nodaq`;
let cookie = "";
let tenantId = "";

const RAISON_SOCIALE = "Menuiserie Excellence SARL";
const ADRESSE = "9 rue des Artisans";
const CODE_POSTAL = "69001";
const COMMUNE = "Lyon";

beforeAll(async () => {
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Test Onboarding", tenantNom: `Vendeur Clé ${suffix}` })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  const setCookie = reg.headers["set-cookie"] as string[] | string | undefined;
  cookie = (Array.isArray(setCookie) ? setCookie : [setCookie ?? ""]).find(c => c.startsWith("nodaq_sid=")) ?? "";

  const { rows } = await adminPool.query<{ id: string }>(
    "SELECT t.id FROM tenants t JOIN memberships m ON m.tenant_id = t.id JOIN users u ON u.id = m.user_id WHERE u.email = $1 LIMIT 1",
    [email],
  );
  tenantId = rows[0]?.id ?? "";

  // Le VRAI chemin d'écriture — pas une insertion directe en base.
  await request(app)
    .post("/api/onboarding/profil/confirmer")
    .set("Cookie", cookie)
    .send({
      siret: "81234567600009",
      siren: "812345676",
      raison_sociale: RAISON_SOCIALE,
      adresse: ADRESSE,
      code_postal: CODE_POSTAL,
      commune: COMMUNE,
    })
    .expect(200);
}, 30_000);

afterAll(async () => {
  if (tenantId) await cleanupTenants(tenantId);
  await cleanupUsers(email);
}, 30_000);

describe("le vendeur d'une facture émise vient du vrai profil onboarding", () => {
  test("le nom réel apparaît, jamais le repli \"Entreprise\"", async () => {
    const { body: f } = await request(app)
      .post("/api/factures")
      .set("Cookie", cookie)
      .send({
        customerName: "Client Test",
        issuedDate: new Date().toISOString().slice(0, 10),
        dueDate: new Date().toISOString().slice(0, 10),
        lines: [{ description: "Prestation", quantity: 1, unitPriceCents: 100_000, vatRate: 20, vatCategory: "S" }],
      })
      .expect(201);

    const emise = await request(app)
      .post(`/api/factures/${f.id}/emettre`)
      .set("Cookie", cookie)
      .send({})
      .expect(200);
    expect(emise.body.statut).toBe("EMISE");

    // Le PDF archivé est celui servi — même octets, donc l'assertion sur le
    // PDF récupéré vaut pour ce qui a réellement été remis au client.
    const pdfRes = await request(app)
      .get(`/api/factures/${f.id}/pdf`)
      .set("Cookie", cookie)
      .expect(200);
    const texte = texteBrut(pdfRes.body as Buffer);
    expect(texte).toContain(RAISON_SOCIALE);
    expect(texte).toContain(ADRESSE);
    expect(texte).toContain(COMMUNE);
    expect(texte).not.toContain("Entreprise");
  });
});
