/**
 * Devis dicté — chaîne complète.
 *
 * Ce que ces tests protègent :
 *   a. AUCUN prix inventé — un ouvrage absent du catalogue sort sans prix ;
 *   b. le total serveur fait autorité — un total falsifié côté client est ignoré ;
 *   c. la chaîne dictée → devis émis, sur un cas construit à la main ;
 *   d. l'amorçage depuis les devis existants, idempotent.
 *
 * L'isolation de `catalogue_lignes` est couverte par rls.test.ts, qui boucle sur
 * BUSINESS_TABLES — la table y est inscrite dans les deux listes.
 *
 * Aucun test n'atteint un fournisseur réel : vitest.setup.ts intercepte tout
 * appel vers LLM_BASE_URL et rend un DÉCOUPAGE sans prix.
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
  const email = `dictee-${Date.now()}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Artisan", tenantNom: "Placo Test" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  cookie = reg.headers["set-cookie"]?.[0] ?? "";

  const { body: me } = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
  tenantId = me.tenantId;
  cleanupTenantIds.push(tenantId);

  // Catalogue : la cloison est tarifée, la véranda ne l'est PAS.
  await request(app)
    .post("/api/catalogue")
    .set("Cookie", cookie)
    .send({
      libelle: "Cloison BA13",
      unite: "m2",
      prixUnitaireHtCents: 4500,
      tauxTva: 20,
      motsCles: ["placo", "ba13"],
    })
    .expect(201);
}, 60_000);

afterAll(async () => {
  await adminPool.query(`DELETE FROM catalogue_lignes WHERE tenant_id = ANY($1::uuid[])`, [cleanupTenantIds]);
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

// ── a. Aucun prix inventé ─────────────────────────────────────────────────────

describe("a — AUCUN PRIX INVENTÉ hors catalogue", () => {
  test("un ouvrage absent du catalogue est rendu SANS prix, marqué à compléter", async () => {
    const { body } = await request(app)
      .post("/api/devis/dictee/proposer")
      .set("Cookie", cookie)
      .send({ texte: "Pose de cloison BA13 sur trente mètres carrés, et une véranda" })
      .expect(200);

    const veranda = body.lignes.find((l: { libelle: string }) =>
      l.libelle.toLowerCase().includes("veranda"),
    );
    expect(veranda).toBeDefined();
    expect(veranda.prixUnitaireHtCents).toBeNull();
    expect(veranda.provenance).toBe("a_completer");

    // La cloison, elle, est chiffrée — et son prix vient du CATALOGUE.
    const cloison = body.lignes.find((l: { provenance: string }) => l.provenance === "catalogue");
    expect(cloison.prixUnitaireHtCents).toBe(4500);
  });

  test("le total n'additionne QUE le chiffrable, et compte le reste", async () => {
    // Posé à la main : 30 m² × 4 500 c = 135 000 c. La véranda n'entre pas.
    const { body } = await request(app)
      .post("/api/devis/dictee/proposer")
      .set("Cookie", cookie)
      .send({ texte: "Cloison BA13 trente mètres carrés plus une véranda" })
      .expect(200);

    expect(body.totalHtCents).toBe(135_000);
    expect(body.lignesChiffrees).toBe(1);
    expect(body.lignesACompleter).toBe(1);
  });

  test("catalogue VIDE → aucune ligne chiffrée, aucun prix sorti de nulle part", async () => {
    // Un second tenant, sans aucun catalogue.
    const email = `dictee-vide-${Date.now()}@test.nodaq`;
    cleanupEmails.push(email);
    const reg = await request(app)
      .post("/api/auth/register")
      .send({ email, password: "test-pass-1234", nom: "Neuf", tenantNom: "Sans Catalogue" })
      .expect(201);
    await completeMfaForRegisteredOwner(reg.body.userId);
    const cookieVide = reg.headers["set-cookie"]?.[0] ?? "";
    const { body: me } = await request(app).get("/api/auth/me").set("Cookie", cookieVide).expect(200);
    cleanupTenantIds.push(me.tenantId);

    const { body } = await request(app)
      .post("/api/devis/dictee/proposer")
      .set("Cookie", cookieVide)
      .send({ texte: "Cloison BA13 trente mètres carrés" })
      .expect(200);

    expect(body.catalogueVide).toBe(true);
    expect(body.totalHtCents).toBe(0);
    expect(body.lignes.every((l: { prixUnitaireHtCents: number | null }) => l.prixUnitaireHtCents === null)).toBe(true);
  });
});

// ── b. Le total serveur fait autorité ─────────────────────────────────────────

describe("b — TOTAL SERVEUR fait autorité", () => {
  test("un total falsifié envoyé par le client est IGNORÉ", async () => {
    // Le client tente d'imposer un total dérisoire en plus des lignes.
    const { body } = await request(app)
      .post("/api/devis")
      .set("Cookie", cookie)
      .send({
        clientName: "Client Falsificateur",
        lines: [{ description: "Cloison BA13", quantity: 30, unitPriceCents: 4500, vatRate: 20 }],
        totalHTCents: 1,
        totalTTCCents: 1,
      })
      .expect(201);

    // Posé à la main : 30 × 4 500 = 135 000 c HT ; TVA 20 % → 162 000 c TTC.
    expect(body.totalHTCents).toBe(135_000);
    expect(body.totalTTCCents).toBe(162_000);
    expect(body.totalHTCents).not.toBe(1);
  });
});

// ── c. Chaîne complète ────────────────────────────────────────────────────────

describe("c — CHAÎNE dictée → devis émis", () => {
  test("la proposition alimente POST /devis sans dupliquer la logique d'émission", async () => {
    const proposition = await request(app)
      .post("/api/devis/dictee/proposer")
      .set("Cookie", cookie)
      .send({ texte: "Cloison BA13 trente mètres carrés" })
      .expect(200);

    // L'écran ne retient que les lignes chiffrées pour créer le devis.
    const lines = proposition.body.lignes
      .filter((l: { prixUnitaireHtCents: number | null }) => l.prixUnitaireHtCents !== null)
      .map((l: { libelle: string; quantite: number; prixUnitaireHtCents: number; tauxTva: number; unite: string | null }) => ({
        description: l.libelle,
        quantity: l.quantite,
        unitPriceCents: l.prixUnitaireHtCents,
        vatRate: l.tauxTva,
        ...(l.unite ? { unit: l.unite } : {}),
      }));

    const devis = await request(app)
      .post("/api/devis")
      .set("Cookie", cookie)
      .send({ clientName: "Madame Martin", lines })
      .expect(201);

    expect(devis.body.reference).toMatch(/^DEV-\d{4}-\d{4}$/);
    expect(devis.body.totalHTCents).toBe(135_000);
    expect(devis.body.lines).toHaveLength(1);
    expect(devis.body.lines[0].unitPriceCents).toBe(4500);
  });
});

// ── d. Amorçage depuis l'existant ─────────────────────────────────────────────

describe("d — AMORÇAGE du catalogue depuis les devis existants", () => {
  test("les lignes des devis déjà saisis deviennent des entrées de catalogue", async () => {
    await request(app)
      .post("/api/devis")
      .set("Cookie", cookie)
      .send({
        clientName: "Client Historique",
        lines: [{ description: "Ragréage sol", quantity: 20, unitPriceCents: 1800, vatRate: 10, unit: "m2" }],
      })
      .expect(201);

    const { body } = await request(app)
      .post("/api/catalogue/amorcer")
      .set("Cookie", cookie)
      .expect(200);
    expect(body.crees).toBeGreaterThan(0);

    const { body: cat } = await request(app).get("/api/catalogue").set("Cookie", cookie).expect(200);
    const ragreage = cat.lignes.find((l: { libelle: string }) => l.libelle === "Ragréage sol");
    expect(ragreage).toBeDefined();
    expect(ragreage.prixUnitaireHtCents).toBe(1800);
    expect(ragreage.origine).toBe("reprise");
  });

  test("relancer l'amorçage n'ajoute rien — opération idempotente", async () => {
    const { body } = await request(app)
      .post("/api/catalogue/amorcer")
      .set("Cookie", cookie)
      .expect(200);
    expect(body.crees).toBe(0);
  });

  test("une ligne saisie à la main n'est JAMAIS écrasée par une déduction", async () => {
    const { body: cat } = await request(app).get("/api/catalogue").set("Cookie", cookie).expect(200);
    const cloison = cat.lignes.find((l: { libelle: string }) => l.libelle === "Cloison BA13");
    expect(cloison.origine).toBe("saisi");
    expect(cloison.prixUnitaireHtCents).toBe(4500);
  });
});
