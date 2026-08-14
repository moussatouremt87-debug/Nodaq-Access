/**
 * Profil entreprise — les clés que l'onboarding écrit doivent être celles que
 * les documents légaux LISENT.
 *
 * Régression : `POST /onboarding/profil/confirmer` (le SEUL chemin du produit
 * réel qui renseigne le profil — voir `pages/onboarding.tsx`) écrivait
 * `company.raison_sociale` / `company.adresse` / `company.code_postal` /
 * `company.commune`. Mais `loadSellerInfo()` dans `factures.ts`, `avoirs.ts`,
 * `pdf-devis.ts` et `public.ts` lisent `company.nom` / `company.adresse_rue` /
 * `company.adresse_cp` / `company.adresse_ville` — des clés que rien
 * n'écrivait nulle part dans le dépôt.
 *
 * Conséquence pour tout tenant ayant suivi le parcours normal : chaque devis,
 * facture et avoir affichait « Entreprise » (repli silencieux) au lieu de la
 * vraie raison sociale, sans adresse. Le garde de mentions obligatoires ne
 * bloque que sur le SIRET — jamais sur le nom — donc rien n'empêchait
 * l'émission : le défaut ne se voyait qu'en ouvrant le PDF.
 *
 * Les 1014 tests existants ne l'attrapaient pas parce qu'ils seedent TOUS le
 * profil via `PATCH /api/parametres` (écriture libre, sans passer par
 * l'onboarding) avec les clés déjà correctes — un raccourci de test qui
 * contourne exactement le chemin cassé.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner } from "./helpers";

let cookie: string;
let tenantId: string;
const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

beforeAll(async () => {
  const email = `profil-entreprise-${Date.now()}@test.nodaq`;
  cleanupEmails.push(email);

  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Owner Profil", tenantNom: "Toiture Martin SARL" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  cookie = reg.headers["set-cookie"]?.[0] ?? "";

  const { body: me } = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
  tenantId = me.tenantId;
  cleanupTenantIds.push(tenantId);
}, 60_000);

afterAll(async () => {
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

describe("onboarding → profil entreprise → clés lues par les documents", () => {
  test("POST /onboarding/profil/confirmer renseigne aussi company.nom et company.adresse_*", async () => {
    await request(app)
      .post("/api/onboarding/profil/confirmer")
      .set("Cookie", cookie)
      .send({
        siret: "73282932000009",
        siren: "732829320",
        raison_sociale: "Toiture Martin SARL",
        adresse: "12 rue des Artisans",
        code_postal: "75011",
        commune: "Paris",
      })
      .expect(200);

    const { rows } = await adminPool.query<{ key: string; value: string }>(
      `SELECT key, value FROM settings
       WHERE tenant_id = $1
         AND key IN ('company.nom', 'company.adresse_rue', 'company.adresse_cp', 'company.adresse_ville')`,
      [tenantId],
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    // C'est la ligne qui aurait échoué avant le correctif : ces clés
    // n'étaient écrites nulle part, donc absentes ici.
    expect(byKey["company.nom"]).toBe("Toiture Martin SARL");
    expect(byKey["company.adresse_rue"]).toBe("12 rue des Artisans");
    expect(byKey["company.adresse_cp"]).toBe("75011");
    expect(byKey["company.adresse_ville"]).toBe("Paris");
  });

  test("les anciennes clés (raison_sociale/adresse/code_postal/commune) restent aussi écrites — non-régression", async () => {
    const { rows } = await adminPool.query<{ key: string; value: string }>(
      `SELECT key, value FROM settings
       WHERE tenant_id = $1
         AND key IN ('company.raison_sociale', 'company.adresse', 'company.code_postal', 'company.commune')`,
      [tenantId],
    );
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    expect(byKey["company.raison_sociale"]).toBe("Toiture Martin SARL");
    expect(byKey["company.adresse"]).toBe("12 rue des Artisans");
    expect(byKey["company.code_postal"]).toBe("75011");
    expect(byKey["company.commune"]).toBe("Paris");
  });

  test("une facture émise après onboarding s'émet sans erreur avec le profil renseigné", async () => {
    // Le contenu texte du PDF (flux compressé par pdfkit) n'est pas
    // vérifiable de façon fiable par une lecture d'octets bruts en test — la
    // vérification visuelle du rendu réel a été faite manuellement lors de
    // l'audit (extraction via pdftotext) et confirme que `seller.nom` est
    // bien celui du tenant, plus jamais le repli "Entreprise", une fois les
    // clés ci-dessus correctement renseignées. Ce test couvre la partie
    // fiable en CI : le chemin complet ne casse pas et produit un PDF non vide.
    const brouillon = await request(app)
      .post("/api/factures")
      .set("Cookie", cookie)
      .send({
        customerName: "Client E2E",
        issuedDate: "2026-08-14",
        dueDate: "2026-09-13",
        lines: [{ description: "Travaux", quantity: 1, unitPriceCents: 100_000, vatRate: 20, vatCategory: "S" }],
      })
      .expect(201);

    const emise = await request(app)
      .post(`/api/factures/${brouillon.body.id}/emettre`)
      .set("Cookie", cookie)
      .send({})
      .expect(200);
    expect(emise.body.number).toMatch(/^FACT-/);

    const pdf = await request(app)
      .get(`/api/factures/${brouillon.body.id}/pdf`)
      .set("Cookie", cookie)
      .expect(200);
    expect((pdf.body as Buffer).length).toBeGreaterThan(0);
  });
});
