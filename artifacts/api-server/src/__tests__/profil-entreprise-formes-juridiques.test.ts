/**
 * US-A1.3 — Profil entreprise avec formes juridiques variées.
 *
 * Chaque cas passe par les VRAIS endpoints (`/onboarding/profil/confirmer`
 * puis `/onboarding/profil` en PATCH, comme le fait réellement l'écran de
 * complétion), jamais par une insertion directe en base — même doctrine que
 * `vendeur-cle-onboarding.test.ts`, qui a détecté la dernière dérive de ce
 * type sur ces mêmes fichiers (`loadSellerInfo`/`chargerEmetteur`).
 *
 * Le PDF émis est réellement décompressé (`texteBrut`, `./helpers`) : une
 * recherche sur les octets bruts ne prouverait rien, le contenu est
 * FlateDecode-compressé quel que soit le résultat du test.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, texteBrut, serveurTest } from "./helpers";
import { toDateString } from "@nodaq/shared";

interface Locataire { cookie: string; tenantId: string }

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

// SIRET/SIREN déjà utilisés (et validés Luhn) ailleurs dans la suite —
// aucune contrainte d'unicité globale sur `company.siret` (settings est
// scopé par tenant), donc réutilisable tel quel.
const SIRET = "81234567600009";
const SIREN = "812345676";
const SIREN_FORMATE = "812 345 676";

async function inscrire(nom: string): Promise<Locataire> {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const email = `formes-juridiques-${nom}-${suffix}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(serveurTest(app)).post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: `Patron ${nom}`, tenantNom: `Tenant ${nom} ${suffix}` })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  const setCookie = reg.headers["set-cookie"] as string[] | string | undefined;
  const cookie = (Array.isArray(setCookie) ? setCookie : [setCookie ?? ""]).find(c => c.startsWith("nodaq_sid=")) ?? "";
  const { rows } = await adminPool.query<{ id: string }>(
    "SELECT t.id FROM tenants t JOIN memberships m ON m.tenant_id = t.id JOIN users u ON u.id = m.user_id WHERE u.email = $1 LIMIT 1",
    [email],
  );
  const tenantId = rows[0]?.id ?? "";
  cleanupTenantIds.push(tenantId);

  await request(serveurTest(app)).post("/api/onboarding/profil/confirmer").set("Cookie", cookie)
    .send({
      siret: SIRET, siren: SIREN, raison_sociale: `${nom} SARL`,
      adresse: "9 rue des Artisans", code_postal: "69001", commune: "Lyon",
    })
    .expect(200);

  return { cookie, tenantId };
}

async function patchProfil(l: Locataire, updates: Record<string, string>): Promise<void> {
  await request(serveurTest(app)).patch("/api/onboarding/profil").set("Cookie", l.cookie).send(updates).expect(200);
}

async function creerFacture(l: Locataire, lines: Array<{ vatRate: number; vatCategory: string }>) {
  const { body } = await request(serveurTest(app)).post("/api/factures").set("Cookie", l.cookie)
    .send({
      customerName: "Client Test",
      issuedDate: toDateString(new Date()),
      dueDate: toDateString(new Date()),
      lines: lines.map((l2, i) => ({
        description: `Prestation ${i}`, quantity: 1, unitPriceCents: 100_000,
        vatRate: l2.vatRate, vatCategory: l2.vatCategory,
      })),
    })
    .expect(201);
  return body as { id: string };
}

afterAll(async () => {
  if (cleanupTenantIds.length) await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

describe("franchise en base de TVA (art. 293 B CGI)", () => {
  let l: Locataire;

  beforeAll(async () => {
    l = await inscrire("franchise");
    await patchProfil(l, { "company.type_profil": "micro_entreprise", "company.tva_franchise": "true" });
  }, 30_000);

  test("mention automatique, pas de ligne Total TVA", async () => {
    const f = await creerFacture(l, [{ vatRate: 0, vatCategory: "E" }]);
    await request(serveurTest(app)).post(`/api/factures/${f.id}/emettre`).set("Cookie", l.cookie).send({}).expect(200);
    const pdfRes = await request(serveurTest(app)).get(`/api/factures/${f.id}/pdf`).set("Cookie", l.cookie).expect(200);
    const texte = texteBrut(pdfRes.body as Buffer);
    expect(texte).toContain("TVA non applicable");
    expect(texte).toContain("293 B");
    expect(texte).not.toContain("Total TVA");
  });

  test("profil franchise + ligne à taux non nul → émission bloquée", async () => {
    const f = await creerFacture(l, [{ vatRate: 20, vatCategory: "S" }]);
    const res = await request(serveurTest(app)).post(`/api/factures/${f.id}/emettre`).set("Cookie", l.cookie).send({}).expect(422);
    expect((res.body.issues as Array<{ code: string }>).map(i => i.code)).toContain("franchise_tva_incoherente");
  });

  test("s'applique aussi à un avoir (régression duplication loadSellerInfo)", async () => {
    const f = await creerFacture(l, [{ vatRate: 0, vatCategory: "E" }]);
    await request(serveurTest(app)).post(`/api/factures/${f.id}/emettre`).set("Cookie", l.cookie).send({}).expect(200);
    const { body: avoir } = await request(serveurTest(app)).post("/api/avoirs").set("Cookie", l.cookie)
      .send({ factureRefId: f.id, montantHtCents: 50_000, montantTvaCents: 0, motif: "Remise commerciale" })
      .expect(201);
    const pdfRes = await request(serveurTest(app)).get(`/api/avoirs/${avoir.id}/pdf`).set("Cookie", l.cookie).expect(200);
    expect(texteBrut(pdfRes.body as Buffer)).toContain("293 B");
  });
});

describe("numéro d'inscription à l'ordre professionnel", () => {
  test("renseigné → apparaît sur la facture émise", async () => {
    const l = await inscrire("liberale");
    await patchProfil(l, {
      "company.type_profil": "profession_liberale",
      "company.numero_ordre": "Ordre des architectes — n° 45210",
    });
    const f = await creerFacture(l, [{ vatRate: 20, vatCategory: "S" }]);
    await request(serveurTest(app)).post(`/api/factures/${f.id}/emettre`).set("Cookie", l.cookie).send({}).expect(200);
    const pdfRes = await request(serveurTest(app)).get(`/api/factures/${f.id}/pdf`).set("Cookie", l.cookie).expect(200);
    expect(texteBrut(pdfRes.body as Buffer)).toContain("Ordre des architectes");
  });

  test("absent → aucune ligne \"ordre professionnel\" affichée", async () => {
    const l = await inscrire("sansordre");
    const f = await creerFacture(l, [{ vatRate: 20, vatCategory: "S" }]);
    await request(serveurTest(app)).post(`/api/factures/${f.id}/emettre`).set("Cookie", l.cookie).send({}).expect(200);
    const pdfRes = await request(serveurTest(app)).get(`/api/factures/${f.id}/pdf`).set("Cookie", l.cookie).expect(200);
    expect(texteBrut(pdfRes.body as Buffer)).not.toContain("ordre professionnel");
  });
});

describe("capital social et RCS", () => {
  let l: Locataire;

  beforeAll(async () => {
    l = await inscrire("societe");
    await patchProfil(l, {
      "company.type_profil": "societe",
      "company.capital": "10 000 €",
      "company.rcs_ville": "Lyon",
    });
  }, 30_000);

  test("renseignés → capital + RCS + SIREN formaté sur la facture", async () => {
    const f = await creerFacture(l, [{ vatRate: 20, vatCategory: "S" }]);
    await request(serveurTest(app)).post(`/api/factures/${f.id}/emettre`).set("Cookie", l.cookie).send({}).expect(200);
    const pdfRes = await request(serveurTest(app)).get(`/api/factures/${f.id}/pdf`).set("Cookie", l.cookie).expect(200);
    const texte = texteBrut(pdfRes.body as Buffer);
    expect(texte).toContain("Capital social");
    expect(texte).toContain("RCS Lyon");
    expect(texte).toContain(SIREN_FORMATE);
  });

  test("s'applique aussi à un devis (régression duplication chargerEmetteur)", async () => {
    const { body: devis } = await request(serveurTest(app)).post("/api/devis").set("Cookie", l.cookie)
      .send({ clientName: "Client Devis", lines: [{ description: "Étude", quantity: 1, unitPriceCents: 50_000 }] })
      .expect(201);
    const pdfRes = await request(serveurTest(app)).get(`/api/devis/${devis.id}/pdf`).set("Cookie", l.cookie).expect(200);
    expect(texteBrut(pdfRes.body as Buffer)).toContain("RCS Lyon");
  });

  test("absents → aucune mention capital/RCS", async () => {
    const l2 = await inscrire("sanscapital");
    const f = await creerFacture(l2, [{ vatRate: 20, vatCategory: "S" }]);
    await request(serveurTest(app)).post(`/api/factures/${f.id}/emettre`).set("Cookie", l2.cookie).send({}).expect(200);
    const pdfRes = await request(serveurTest(app)).get(`/api/factures/${f.id}/pdf`).set("Cookie", l2.cookie).expect(200);
    expect(texteBrut(pdfRes.body as Buffer)).not.toContain("Capital social");
  });
});

describe("GET /onboarding/profil renvoie les nouvelles clés", () => {
  test("une fois posées via PATCH", async () => {
    const l = await inscrire("profil-get");
    await patchProfil(l, {
      "company.type_profil": "societe",
      "company.tva_franchise": "true",
      "company.numero_ordre": "n° 999",
    });
    const { body } = await request(serveurTest(app)).get("/api/onboarding/profil").set("Cookie", l.cookie).expect(200);
    expect(body.profile["company.type_profil"]).toBe("societe");
    expect(body.profile["company.tva_franchise"]).toBe("true");
    expect(body.profile["company.numero_ordre"]).toBe("n° 999");
  });
});
