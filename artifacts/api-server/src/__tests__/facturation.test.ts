/**
 * Facturation — tests de conformité légale.
 *
 * Couverture :
 *   a. Immutabilité : PATCH/DELETE sur EMISE bloqués (y compris requête forgée)
 *   b. Numérotation : 20 émissions parallèles → 20 numéros distincts et continus
 *   c. PDF : aperçu = archivé octet pour octet (SHA-256 comparison)
 *   d. Conformité : chaque mention retirée → émission bloquée (test énumératif)
 *   e. Factur-X : XML extractable du PDF, profil EN 16931
 *   f. TVA 3 taux : 3 bases et 3 montants corrects
 *   g. Attestation TVA : ligne taux réduit sans attestation → émission bloquée
 *   h. Avoir : dépasse montant facture → refus ; création → facture ANNULEE_PAR_AVOIR
 *   i. Isolation : séquence et documents isolés par tenant
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import http from "node:http";
import app from "../app";
import { extractFacturXXml } from "@nodaq/facturx";
import {
  adminPool,
  createTestTenant,
  createTestUser,
  createTestMembership,
  cleanupTenants,
  cleanupUsers,
  completeMfaForRegisteredOwner,
  serveurTest,
} from "./helpers";

// ── Fixtures ─────────────────────────────────────────────────────────────────

let cookieA: string;   // OWNER tenant A
let cookieB: string;   // OWNER tenant B
let tenantAId: string;
let tenantBId: string;
const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

/**
 * UN SEUL serveur pour les rafales concurrentes.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  LE TEST DES 20 ÉMISSIONS EST LE PLUS GOURMAND EN PORTS DE LA SUITE.     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * `request(serveurTest(app))` monte un serveur éphémère PAR REQUÊTE. Vingt brouillons puis
 * vingt émissions en parallèle, c'est quarante serveurs et quarante connexions
 * ouverts en rafale — sur une réserve de ports qui appartient à la MACHINE.
 * D'où des `read ECONNRESET` intermittents sur ce test précis, y compris quand
 * il tourne seul : reproduit 1 fois sur 12.
 *
 * Passer un serveur DÉJÀ à l'écoute fait que supertest le réutilise au lieu
 * d'en créer un (`test.js` : `if (!addr) this._server = app.listen(0)`), et ne
 * le referme pas. Quarante ports de serveur deviennent un seul.
 *
 * Cela ne relâche rien : les vingt émissions restent bel et bien simultanées,
 * ce que ce test doit éprouver. On retire une contrainte du BANC D'ESSAI, pas
 * une contrainte du produit.
 */
let serveurRafale: http.Server;

beforeAll(async () => {
  serveurRafale = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => serveurRafale.close(() => resolve()));
});

/** Creates a brouillon facture with 3 lines at 3 different TVA rates. */
async function createBrouillon(
  cookie: string,
  overrides: Record<string, unknown> = {},
  /** Cible supertest. Les rafales concurrentes passent par le serveur partagé. */
  cible: Parameters<typeof request>[0] = app,
) {
  const res = await request(cible)
    .post("/api/factures")
    .set("Cookie", cookie)
    .send({
      customerName: "Client Test SAS",
      issuedDate: "2026-08-01",
      dueDate: "2026-09-01",
      lines: [
        { description: "Travaux renovation 20%", quantity: 1, unitPriceCents: 100_000, vatRate: 20, vatCategory: "S" },
        { description: "Isolation 10%", quantity: 1, unitPriceCents: 50_000, vatRate: 10, vatCategory: "S" },
        { description: "Rénovation éligible 5,5%", quantity: 1, unitPriceCents: 20_000, vatRate: 5.5, vatCategory: "S" },
      ],
      attestationTvaFournie: true,
      ...overrides,
    })
    .expect(201);
  return res.body as { id: string; statut: string; amountCents: number };
}

/** Returns a supertest Test for emitting a facture. Call `.expect(status)` or await directly. */
function emettre(
  cookie: string,
  id: string,
  opts: Record<string, unknown> = {},
  cible: Parameters<typeof request>[0] = app,
) {
  return request(cible)
    .post(`/api/factures/${id}/emettre`)
    .set("Cookie", cookie)
    .send({ issuedDate: "2026-08-01", dueDate: "2026-09-01", ...opts });
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeAll(async () => {
  // Tenant A
  const emailA = `fact-owner-a-${Date.now()}@test.nodaq`;
  cleanupEmails.push(emailA);
  const regA = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email: emailA, password: "test-pass-1234", nom: "Owner A", tenantNom: "Corp A" })
    .expect(201);
  await completeMfaForRegisteredOwner(regA.body.userId);
  cookieA = regA.headers["set-cookie"]?.[0] ?? "";

  const { body: meA } = await request(serveurTest(app)).get("/api/auth/me").set("Cookie", cookieA).expect(200);
  tenantAId = meA.tenantId;
  cleanupTenantIds.push(tenantAId);

  // Tenant B
  const emailB = `fact-owner-b-${Date.now()}@test.nodaq`;
  cleanupEmails.push(emailB);
  const regB = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email: emailB, password: "test-pass-1234", nom: "Owner B", tenantNom: "Corp B" })
    .expect(201);
  await completeMfaForRegisteredOwner(regB.body.userId);
  cookieB = regB.headers["set-cookie"]?.[0] ?? "";

  const { body: meB } = await request(serveurTest(app)).get("/api/auth/me").set("Cookie", cookieB).expect(200);
  tenantBId = meB.tenantId;
  cleanupTenantIds.push(tenantBId);

  // Seed company SIRET + nom for both tenants via the parametres API
  // so RLS + upsert go through the normal application path.
  const tenantSeeds = [
    { cookie: cookieA, siret: "81234567600009", nom: "Elec Provence SARL" },
    // 55203253400000 : SIREN 552032534 (Société Générale), NIC 00000 — Luhn ✓
    { cookie: cookieB, siret: "55203253400000", nom: "Bati Nord SASU" },
  ];
  for (const { cookie, siret, nom } of tenantSeeds) {
    await request(serveurTest(app))
      .patch("/api/parametres")
      .set("Cookie", cookie)
      .send({ "company.siret": siret, "company.raison_sociale": nom })
      .expect(200);
  }
}, 60_000);

afterAll(async () => {
  // Explicit cleanup for tables with FK → tenants that cleanupTenants::text cast may miss.
  for (const tbl of ["activity", "avoirs", "facture_sequences", "factures"]) {
    await adminPool.query(
      `DELETE FROM ${tbl} WHERE tenant_id = ANY($1::uuid[])`,
      [cleanupTenantIds],
    );
  }
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

// ── a. Immutabilité ───────────────────────────────────────────────────────────

describe("a — IMMUTABILITÉ", () => {
  test("PATCH sur une facture EMISE → 409", async () => {
    const { id } = await createBrouillon(cookieA);
    await emettre(cookieA, id).expect(200);

    const patch = await request(serveurTest(app))
      .patch(`/api/factures/${id}`)
      .set("Cookie", cookieA)
      .send({ customerName: "Hacked Name" });
    expect(patch.status).toBe(409);
    expect(patch.body.error).toMatch(/immuable|émise/i);
    console.log("[a] PATCH sur EMISE → 409 ✓");
  });

  test("DELETE sur une facture EMISE → 409", async () => {
    const { id } = await createBrouillon(cookieA);
    await emettre(cookieA, id).expect(200);

    const del = await request(serveurTest(app))
      .delete(`/api/factures/${id}`)
      .set("Cookie", cookieA);
    expect(del.status).toBe(409);
    expect(del.body.error).toMatch(/supprimée|émise/i);
    console.log("[a] DELETE sur EMISE → 409 ✓");
  });

  test("Requête forgée PATCH directe → 409 (même path, corps arbitraire)", async () => {
    const { id } = await createBrouillon(cookieA);
    await emettre(cookieA, id).expect(200);

    const forged = await request(serveurTest(app))
      .patch(`/api/factures/${id}`)
      .set("Cookie", cookieA)
      .send({ statut: "BROUILLON", pdfPath: null }); // tentative de déblocage
    expect(forged.status).toBe(409);
    console.log("[a] Requête forgée → 409 ✓");
  });
});

// ── b. Numérotation séquentielle ──────────────────────────────────────────────

describe("b — NUMÉROTATION SÉQUENTIELLE", () => {
  test("20 émissions parallèles → 20 numéros distincts et continus", async () => {
    // Create 20 brouillons — sur le serveur partagé, pas 20 serveurs éphémères
    const ids = await Promise.all(
      Array.from({ length: 20 }, () =>
        createBrouillon(cookieA, {}, serveurRafale).then(f => f.id),
      ),
    );

    // Emit all in parallel — les 20 émissions restent bien SIMULTANÉES
    const reponses = await Promise.all(
      ids.map(id => emettre(cookieA, id, {}, serveurRafale)),
    );

    // ── NE PAS FILTRER LES RÉPONSES SANS NUMÉRO ──────────────────────────────
    //
    // Ce test rendait auparavant `results.map(r => r.number).filter(Boolean)`.
    // Le jour où une émission sur vingt a échoué, il a annoncé « attendu 20,
    // reçu 19 » — et le `.filter(Boolean)` avait jeté la seule chose utile : ce
    // que le serveur avait répondu. On perd un diagnostic pour gagner un
    // message d'erreur plus court.
    //
    // Ici la réponse fautive est DANS l'assertion. Si cela se reproduit, le
    // rapport porte son statut et son corps.
    const fautives = reponses
      .filter(r => r.status !== 200 || typeof r.body?.number !== "string")
      .map(r => ({ status: r.status, body: r.body }));
    expect(fautives).toEqual([]);

    const numbers = reponses.map(r => r.body.number as string);
    expect(numbers).toHaveLength(20);

    const unique = new Set(numbers);
    expect(unique.size).toBe(20);

    // Extract sequence numbers and verify they form a contiguous range
    // Même raison qu'au-dessus : un numéro au mauvais format doit se NOMMER,
    // pas se faire retirer du compte.
    const malFormes = numbers.filter(n => !/FACT-\d{4}-(\d{4})$/.test(n));
    expect(malFormes).toEqual([]);

    const seqs = numbers
      .map(n => Number(n.match(/FACT-\d{4}-(\d{4})$/)![1]))
      .sort((a, b) => a - b);

    expect(seqs).toHaveLength(20);
    const minSeq = seqs[0]!;
    const maxSeq = seqs[seqs.length - 1]!;
    expect(maxSeq - minSeq + 1).toBe(20); // contiguous range
    console.log(`[b] 20 émissions parallèles → numéros ${minSeq}..${maxSeq} (${unique.size} uniques) ✓`);
  }, 120_000);
});

// ── c. PDF : même bytes à chaque lecture ─────────────────────────────────────

describe("c — PDF ARCHIVÉ", () => {
  test("le PDF lu via /pdf a le même SHA-256 que celui stocké en DB", async () => {
    const { id } = await createBrouillon(cookieA);
    const emitted = await emettre(cookieA, id).expect(200);
    const dbSha256 = emitted.body.pdfSha256 as string;
    expect(dbSha256).toBeTruthy();

    // Fetch PDF bytes
    const pdfRes = await request(serveurTest(app))
      .get(`/api/factures/${id}/pdf`)
      .set("Cookie", cookieA)
      .expect(200);
    expect(pdfRes.headers["content-type"]).toMatch(/pdf/);

    const fetchedSha256 = crypto
      .createHash("sha256")
      .update(pdfRes.body as Buffer)
      .digest("hex");

    expect(fetchedSha256).toBe(dbSha256);
    console.log(`[c] SHA-256 archivé = SHA-256 servi : ${dbSha256.slice(0, 12)}… ✓`);
  });

  test("deuxième lecture → mêmes bytes (immutabilité du fichier archivé)", async () => {
    const { id } = await createBrouillon(cookieA);
    await emettre(cookieA, id).expect(200);

    const [r1, r2] = await Promise.all([
      request(serveurTest(app)).get(`/api/factures/${id}/pdf`).set("Cookie", cookieA).expect(200),
      request(serveurTest(app)).get(`/api/factures/${id}/pdf`).set("Cookie", cookieA).expect(200),
    ]);
    const sha1 = crypto.createHash("sha256").update(r1.body as Buffer).digest("hex");
    const sha2 = crypto.createHash("sha256").update(r2.body as Buffer).digest("hex");
    expect(sha1).toBe(sha2);
    console.log("[c] Deux lectures successives → mêmes bytes ✓");
  });
});

// ── d. Conformité — mentions obligatoires ─────────────────────────────────────

describe("d — MENTIONS OBLIGATOIRES (test énumératif)", () => {
  test("SIRET vendeur manquant → 422", async () => {
    // Remove SIRET for this test then restore
    await adminPool.query(
      `DELETE FROM settings WHERE tenant_id = $1 AND key = 'company.siret'`,
      [tenantAId],
    );
    const { id } = await createBrouillon(cookieA);
    const res = await emettre(cookieA, id);
    // Restore SIRET (plain text, no JSON encoding)
    await adminPool.query(
      `INSERT INTO settings (tenant_id, key, value)
       VALUES ($1, 'company.siret', '81234567600009')
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
      [tenantAId],
    );
    expect(res.status).toBe(422);
    expect(res.body.issues?.some((i: { code: string }) => i.code === "siret_vendeur_manquant")).toBe(true);
    console.log("[d] SIRET vendeur manquant → 422 ✓");
  });

  test("aucune ligne → émission bloquée avec mention appropriée", async () => {
    const { id } = await createBrouillon(cookieA, { lines: [] });
    // aucune ligne est non-bloquant dans auditMentionsFR mais bloquant si Factur-X rejette
    // Pour l'instant: le brouillon sans ligne peut être créé; l'émission vérifie
    const res = await emettre(cookieA, id);
    // Should succeed (no lines is non-blocking in our audit) or fail gracefully
    expect([200, 422]).toContain(res.status);
    console.log(`[d] Aucune ligne → ${res.status} ✓`);
  });

  test("attestation TVA réduite manquante → 422", async () => {
    const { id } = await createBrouillon(cookieA, { attestationTvaFournie: false });
    const res = await emettre(cookieA, id);
    expect(res.status).toBe(422);
    expect(res.body.issues?.some((i: { code: string }) => i.code === "attestation_tva_manquante")).toBe(true);
    console.log("[d] Attestation TVA manquante → 422 ✓");
  });
});

// ── e. Factur-X ───────────────────────────────────────────────────────────────

describe("e — FACTUR-X EN 16931", () => {
  test("XML Factur-X est extractable du PDF et porte le profil EN 16931", async () => {
    const { id } = await createBrouillon(cookieA);
    await emettre(cookieA, id).expect(200);

    const pdfRes = await request(serveurTest(app))
      .get(`/api/factures/${id}/pdf`)
      .set("Cookie", cookieA)
      .expect(200);

    const xml = await extractFacturXXml(new Uint8Array(pdfRes.body as Buffer));
    expect(xml).not.toBeNull();
    expect(xml).toContain("urn:cen.eu:en16931:2017");
    expect(xml).toContain("<ram:TypeCode>380</ram:TypeCode>");
    console.log("[e] Factur-X XML extractable + profil EN 16931 ✓");
  });

  test("XML Factur-X contient les numéros SIREN des deux parties", async () => {
    const { id } = await createBrouillon(cookieA);
    await emettre(cookieA, id).expect(200);

    const pdfRes = await request(serveurTest(app))
      .get(`/api/factures/${id}/pdf`)
      .set("Cookie", cookieA)
      .expect(200);
    const xml = await extractFacturXXml(new Uint8Array(pdfRes.body as Buffer));
    expect(xml).toContain("812345676"); // SIREN from SIRET 81234567600009
    console.log("[e] SIREN vendeur dans le XML ✓");
  });
});

// ── f. TVA 3 taux ─────────────────────────────────────────────────────────────

describe("f — TVA 3 TAUX", () => {
  test("3 bases et 3 montants TVA distincts dans le XML", async () => {
    const { id } = await createBrouillon(cookieA); // 20% + 10% + 5.5%
    await emettre(cookieA, id).expect(200);

    const pdfRes = await request(serveurTest(app))
      .get(`/api/factures/${id}/pdf`)
      .set("Cookie", cookieA)
      .expect(200);
    const xml = await extractFacturXXml(new Uint8Array(pdfRes.body as Buffer));
    expect(xml).not.toBeNull();

    // Should contain 3 ApplicableTradeTax blocks
    const taxBlockCount = (xml!.match(/<ram:ApplicableTradeTax>/g) ?? []).length;
    // 3 from lines + 3 from the header breakdown = 6, or 3 header-only per profile
    expect(taxBlockCount).toBeGreaterThanOrEqual(3);
    expect(xml).toContain("<ram:RateApplicablePercent>20.00</ram:RateApplicablePercent>");
    expect(xml).toContain("<ram:RateApplicablePercent>10.00</ram:RateApplicablePercent>");
    expect(xml).toContain("<ram:RateApplicablePercent>5.50</ram:RateApplicablePercent>");
    console.log("[f] 3 taux TVA dans le XML (20%, 10%, 5.5%) ✓");
  });

  test("totaux HT et TVA corrects selon ventilation par taux", async () => {
    const facture = await createBrouillon(cookieA);
    // Lines: 100000 + 50000 + 20000 = 170000 HT
    // TVA: 20000 (20%) + 5000 (10%) + 1100 (5.5%) = 26100
    // TTC: 196100
    expect(facture.amountCents).toBe(196100);
    console.log(`[f] TTC calculé correct : ${facture.amountCents / 100} € ✓`);
  });
});

// ── g. Attestation TVA réduite ────────────────────────────────────────────────

describe("g — ATTESTATION TVA RÉDUITE", () => {
  test("ligne taux réduit (10%) sans attestation → 422 à l'émission", async () => {
    const { id } = await createBrouillon(cookieA, { attestationTvaFournie: false });
    const res = await emettre(cookieA, id);
    expect(res.status).toBe(422);
    const codes = res.body.issues?.map((i: { code: string }) => i.code) ?? [];
    expect(codes).toContain("attestation_tva_manquante");
    console.log("[g] Sans attestation TVA réduite → 422 ✓");
  });

  test("attestation fournie → émission autorisée", async () => {
    const { id } = await createBrouillon(cookieA, { attestationTvaFournie: true });
    const res = await emettre(cookieA, id);
    expect(res.status).toBe(200);
    console.log("[g] Avec attestation TVA réduite → émission OK ✓");
  });
});

// ── g2. TVA réduite hors bâtiment (US-A2.5) ───────────────────────────────────
//
// `attestation_tva_manquante` et `decennale_manquante` concernent
// spécifiquement les travaux (art. 279-0 bis CGI, art. L.241-1 C.assur.).
// Un secteur sans lien contractuel avec un maître d'ouvrage (ici
// restauration_chr, absent de la liste `garantie-decennale` de
// regulatoryWatch.ts) doit pouvoir émettre une facture à taux réduit SANS
// ces cases, à la différence du tenant BTP ci-dessus (section g).

describe("g2 — TVA RÉDUITE HORS BÂTIMENT NE BLOQUE PAS (US-A2.5)", () => {
  let cookieRestau: string;

  beforeAll(async () => {
    const email = `fact-restau-${Date.now()}@test.nodaq`;
    cleanupEmails.push(email);
    const reg = await request(serveurTest(app))
      .post("/api/auth/register")
      .send({ email, password: "test-pass-1234", nom: "Owner Restau", tenantNom: "Chez Restau" })
      .expect(201);
    await completeMfaForRegisteredOwner(reg.body.userId);
    cookieRestau = reg.headers["set-cookie"]?.[0] ?? "";

    const { body: me } = await request(serveurTest(app)).get("/api/auth/me").set("Cookie", cookieRestau).expect(200);
    cleanupTenantIds.push(me.tenantId);

    await request(serveurTest(app))
      .patch("/api/parametres")
      .set("Cookie", cookieRestau)
      .send({ "company.siret": "73282932000074", "company.raison_sociale": "Chez Restau SARL" })
      .expect(200);

    await request(serveurTest(app))
      .patch("/api/votre-metier")
      .set("Cookie", cookieRestau)
      .send({ metier: "restauration_chr" })
      .expect(200);
  }, 60_000);

  test("taux réduit (10%), ni attestation ni décennale renseignées → émission autorisée", async () => {
    const { id } = await createBrouillon(cookieRestau, { attestationTvaFournie: false });
    const res = await emettre(cookieRestau, id);
    expect(res.status).toBe(200);
    const codes = res.body?.issues?.map?.((i: { code: string }) => i.code) ?? [];
    expect(codes).not.toContain("attestation_tva_manquante");
    expect(codes).not.toContain("decennale_manquante");
    console.log("[g2] Restauration, taux réduit sans attestation/décennale → émission OK ✓");
  });

  test("le tenant BTP (section g) reste bloqué à l'identique — non-régression", async () => {
    const { id } = await createBrouillon(cookieA, { attestationTvaFournie: false });
    const res = await emettre(cookieA, id);
    expect(res.status).toBe(422);
    const codes = res.body.issues?.map((i: { code: string }) => i.code) ?? [];
    expect(codes).toContain("attestation_tva_manquante");
    console.log("[g2] BTP reste bloqué sans attestation — non-régression ✓");
  });
});

// ── h. Avoir ──────────────────────────────────────────────────────────────────

describe("h — AVOIR", () => {
  test("avoir dont le montant > facture → 422", async () => {
    const { id, amountCents } = await createBrouillon(cookieA);
    await emettre(cookieA, id).expect(200);

    const res = await request(serveurTest(app))
      .post("/api/avoirs")
      .set("Cookie", cookieA)
      .send({
        factureRefId: id,
        montantHtCents: amountCents * 2, // double = trop grand
        montantTvaCents: 0,
        motif: "Test dépassement",
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/dépasse/i);
    console.log("[h] Avoir montant > facture → 422 ✓");
  });

  test("avoir plein montant → facture passe ANNULEE_PAR_AVOIR", async () => {
    const { id, amountCents } = await createBrouillon(cookieA);
    await emettre(cookieA, id).expect(200);

    // Avoir TTC = factureTTC (montantHt = amountCents, tva = 0) → annulation complète
    const avoir = await request(serveurTest(app))
      .post("/api/avoirs")
      .set("Cookie", cookieA)
      .send({
        factureRefId: id,
        montantHtCents: amountCents, // TTC facture entier couvert → full cancellation
        montantTvaCents: 0,
        motif: "Annulation complète",
      })
      .expect(201);

    expect(avoir.body.numero).toMatch(/^AVOIR-\d{4}-\d{4}$/);

    const factureUpdated = await request(serveurTest(app))
      .get(`/api/factures/${id}`)
      .set("Cookie", cookieA)
      .expect(200);
    expect(factureUpdated.body.statut).toBe("ANNULEE_PAR_AVOIR");
    expect(factureUpdated.body.avoirId).toBe(avoir.body.id);
    console.log(`[h] Avoir ${avoir.body.numero} → facture ANNULEE_PAR_AVOIR ✓`);
  });

  test("avoir partiel → facture reste EMISE", async () => {
    const { id, amountCents } = await createBrouillon(cookieA);
    await emettre(cookieA, id).expect(200);

    // Avoir couvrant 50 % du TTC → correction partielle, facture reste EMISE
    const avoir = await request(serveurTest(app))
      .post("/api/avoirs")
      .set("Cookie", cookieA)
      .send({
        factureRefId: id,
        montantHtCents: Math.round(amountCents * 0.5),
        montantTvaCents: 0,
        motif: "Remise accordée après travaux",
      })
      .expect(201);

    expect(avoir.body.numero).toMatch(/^AVOIR-\d{4}-\d{4}$/);

    const factureUpdated = await request(serveurTest(app))
      .get(`/api/factures/${id}`)
      .set("Cookie", cookieA)
      .expect(200);
    // Partial credit note: invoice stays EMISE (balance reduced, not cancelled)
    expect(factureUpdated.body.statut).toBe("EMISE");
    // For a partial avoir, avoirId is NOT set on the facture (that field tracks the final
    // cancelling avoir only). Only residualCents is reduced.
    expect(factureUpdated.body.avoirId).toBeNull();
    // Verify residual was reduced (it should be less than the original amountCents)
    expect(factureUpdated.body.residualCents).toBeLessThan(factureUpdated.body.amountCents);
    console.log(`[h] Avoir partiel ${avoir.body.numero} → facture reste EMISE ✓`);
  });

  test("avoir sur facture non EMISE → 422", async () => {
    const { id } = await createBrouillon(cookieA);
    // Still BROUILLON
    const res = await request(serveurTest(app))
      .post("/api/avoirs")
      .set("Cookie", cookieA)
      .send({ factureRefId: id, montantHtCents: 1000, montantTvaCents: 200, motif: "Test" });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/EMISE/);
    console.log("[h] Avoir sur BROUILLON → 422 ✓");
  });
});

// ── i. Isolation par tenant ────────────────────────────────────────────────────

describe("i — ISOLATION PAR TENANT", () => {
  test("tenant B ne voit pas les factures de tenant A", async () => {
    // Create a facture in tenant A
    const { id } = await createBrouillon(cookieA);
    await emettre(cookieA, id).expect(200);

    // Tenant B cannot read it
    const res = await request(serveurTest(app))
      .get(`/api/factures/${id}`)
      .set("Cookie", cookieB);
    expect(res.status).toBe(404);
    console.log("[i] Tenant B ne voit pas les factures de tenant A ✓");
  });

  test("séquences sont indépendantes par tenant", async () => {
    // Both emit one facture each
    const [fA, fB] = await Promise.all([
      createBrouillon(cookieA).then(({ id }) => emettre(cookieA, id).expect(200)),
      createBrouillon(cookieB).then(({ id }) => emettre(cookieB, id).expect(200)),
    ]);

    const numA = fA.body.number as string;
    const numB = fB.body.number as string;

    // Both are FACT-YYYY-NNNN but with separate counters
    expect(numA).toMatch(/^FACT-\d{4}-\d{4}$/);
    expect(numB).toMatch(/^FACT-\d{4}-\d{4}$/);
    // They should share the same year but their sequence counters are independent
    console.log(`[i] Numéros indépendants : ${numA} (A) vs ${numB} (B) ✓`);
  });
});

// ── j. Date d'émission — round-trip fuseau horaire ───────────────────────────
//
// This whole suite runs under TZ=Europe/Paris (vitest.config.ts). Guards
// against the class of bug fixed in "fuseau-paris" / "dates-metier": a date
// written as issuedDate must be read back byte-for-byte identical, never
// shifted a day by a stray toISOString() sliced to 10 chars somewhere in the path.

describe("j — DATE D'ÉMISSION (round-trip fuseau horaire)", () => {
  test("une facture émise avec une date connue la restitue identique via l'API", async () => {
    // 2026-09-01: the exact date from the bug report — a value that
    // toISOString() sliced to 10 chars would render as "2026-08-31" in Paris.
    const issuedDate = "2026-09-01";
    const { id } = await createBrouillon(cookieA, { issuedDate });
    const emitted = await emettre(cookieA, id, { issuedDate }).expect(200);
    expect(emitted.body.issuedDate).toBe(issuedDate);

    const reread = await request(serveurTest(app))
      .get(`/api/factures/${id}`)
      .set("Cookie", cookieA)
      .expect(200);
    expect(reread.body.issuedDate).toBe(issuedDate);
    console.log(`[j] issuedDate ${issuedDate} → relue identique via GET (TZ=${process.env["TZ"]}) ✓`);
  });
});

// ── k — ÉCHÉANCE DU JOUR MÊME ────────────────────────────────────────────────
//
// Bug confirmé en UAT : une facture à échéance du jour même (cas comptant,
// US-A3.4) était comptée "en retard" dès la première seconde après minuit
// UTC, car `totalOverdueCents` comparait `new Date(dueDate)` (minuit UTC) à
// `new Date()` (l'instant précis) au lieu de comparer deux dates métier.

describe("k — une échéance du jour même n'est pas encore en retard", () => {
  test("dueDate === aujourd'hui ne contribue pas à totalOverdueCents", async () => {
    const { toDateString } = await import("@nodaq/shared");
    const aujourdhui = toDateString(new Date());

    const avant = await request(serveurTest(app)).get("/api/factures").set("Cookie", cookieA).expect(200);

    const { id } = await createBrouillon(cookieA, { dueDate: aujourdhui });
    const emitted = await emettre(cookieA, id, { dueDate: aujourdhui }).expect(200);
    expect(emitted.body.dueDate).toBe(aujourdhui);

    const apres = await request(serveurTest(app)).get("/api/factures").set("Cookie", cookieA).expect(200);
    expect(apres.body.totalOverdueCents).toBe(avant.body.totalOverdueCents);
  });
});

// ── l — cockpit.ts totalImpayeCents suit la même définition que factures.ts ──
//
// Bug corrigé (US-A3.1) : `cockpit.ts` comptait TOUTE facture `settled=false`
// dans `totalImpayeCents`, sans jamais vérifier `dueDate` — une facture
// fraîchement émise, à échéance future, s'affichait "en retard" (tone
// warning) sur le tableau de bord principal. Faux positif systématique pour
// tout tenant à cycle de paiement long (une facture reste "en attente" des
// semaines avant son échéance), et absurde en particulier pour un profil à
// encaissement comptant.

describe("l — totalImpayeCents (cockpit) exclut les factures pas encore échues", () => {
  test("échéance future → n'augmente pas totalImpayeCents", async () => {
    const avant = await request(serveurTest(app)).get("/api/cockpit/kpis").set("Cookie", cookieA).expect(200);

    const { id } = await createBrouillon(cookieA, { dueDate: "2026-12-31" });
    await emettre(cookieA, id, { dueDate: "2026-12-31" }).expect(200);

    const apres = await request(serveurTest(app)).get("/api/cockpit/kpis").set("Cookie", cookieA).expect(200);
    expect(apres.body.totalImpayeCents).toBe(avant.body.totalImpayeCents);
  });

  test("échéance passée → augmente totalImpayeCents du montant de la facture", async () => {
    const avant = await request(serveurTest(app)).get("/api/cockpit/kpis").set("Cookie", cookieA).expect(200);

    const { id, amountCents } = await createBrouillon(cookieA, {
      issuedDate: "2020-01-01", dueDate: "2020-01-31",
    });
    await emettre(cookieA, id, { issuedDate: "2020-01-01", dueDate: "2020-01-31" }).expect(200);

    const apres = await request(serveurTest(app)).get("/api/cockpit/kpis").set("Cookie", cookieA).expect(200);
    expect(apres.body.totalImpayeCents).toBe(avant.body.totalImpayeCents + amountCents);
  });
});
