/**
 * Facturation électronique (US-A2.6) — paramétrage, capture manuelle,
 * isolation, et authentification du webhook entrant.
 *
 * Pas d'intégration réelle contre une plateforme agréée ici — aucune n'est
 * contractée à ce jour. Le webhook n'est testé QUE sur son authentification
 * et sa résolution de tenant, pas bout en bout contre un vrai fournisseur.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { buildCiiXml, buildFacturXPdf, type FacturXInvoice } from "@nodaq/facturx";
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
} from "./helpers";

let cookieOwnerA: string;
let cookieMemberA: string;
let cookieOwnerB: string;
let tenantAId: string;
let tenantBId: string;
const tenantIds: string[] = [];
const emails: string[] = [];

const INVOICE: FacturXInvoice = {
  number: "F-RECU-0001",
  issueDate: "2026-08-10",
  dueDate: "2026-09-10",
  currency: "EUR",
  operationCategory: "prestation_services",
  seller: {
    name: "Fournisseur Test SARL",
    siret: "81234567600009",
    vatNumber: "FR12812345676",
    address: { street: "1 rue du Test", postalCode: "75001", city: "Paris", countryCode: "FR" },
  },
  buyer: {
    name: "Client Test",
    siret: "52345678800018",
    address: { street: "2 rue du Client", postalCode: "75002", city: "Paris", countryCode: "FR" },
  },
  lines: [
    { description: "Prestation", quantity: 1, unitPriceCents: 100_000, vatRate: 20, vatCategory: "S" },
  ],
  totals: { netCents: 100_000, vatCents: 20_000, grossCents: 120_000, dueCents: 120_000 },
};

async function facturXPdf(): Promise<Buffer> {
  const xml = buildCiiXml(INVOICE, "EN16931");
  const bytes = await buildFacturXPdf(INVOICE, xml, "EN16931");
  return Buffer.from(bytes);
}

beforeAll(async () => {
  const tenantA = await createTestTenant("Facturation Elec Tenant A");
  const tenantB = await createTestTenant("Facturation Elec Tenant B");
  tenantAId = tenantA.id;
  tenantBId = tenantB.id;
  tenantIds.push(tenantA.id, tenantB.id);

  const emailOwnerA = `fe-owner-a-${Date.now()}@test.nodaq`;
  const emailMemberA = `fe-member-a-${Date.now()}@test.nodaq`;
  const emailOwnerB = `fe-owner-b-${Date.now()}@test.nodaq`;
  emails.push(emailOwnerA, emailMemberA, emailOwnerB);

  const ownerA = await createTestUser(emailOwnerA);
  await createTestMembership(ownerA.id, tenantA.id, "OWNER");
  cookieOwnerA = cookieHeader((await createTestSession(ownerA.id, tenantA.id)).id);

  const memberA = await createTestUser(emailMemberA);
  await createTestMembership(memberA.id, tenantA.id, "MEMBER");
  cookieMemberA = cookieHeader((await createTestSession(memberA.id, tenantA.id)).id);

  const ownerB = await createTestUser(emailOwnerB);
  await createTestMembership(ownerB.id, tenantB.id, "OWNER");
  cookieOwnerB = cookieHeader((await createTestSession(ownerB.id, tenantB.id)).id);
});

afterAll(async () => {
  for (const tbl of ["pa_documents_recus", "pa_transmissions"]) {
    await adminPool.query(`DELETE FROM ${tbl} WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
  }
  await adminPool.query(`DELETE FROM tenant_secrets WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
});

// ── a — paramétrage ─────────────────────────────────────────────────────────

describe("a — paramétrage de la clé API PA", () => {
  test("aucune clé enregistrée au départ", async () => {
    const res = await request(app)
      .get("/api/facturation-electronique")
      .set("Cookie", cookieOwnerA)
      .expect(200);
    expect(res.body.paConfiguree).toBe(false);
  });

  test("PUT enregistre la clé — la lecture ne rend qu'un booléen, jamais la valeur", async () => {
    await request(app)
      .put("/api/facturation-electronique")
      .set("Cookie", cookieOwnerA)
      .send({ cleApi: "secret-de-test-pa" })
      .expect(200);

    const res = await request(app)
      .get("/api/facturation-electronique")
      .set("Cookie", cookieOwnerA)
      .expect(200);
    expect(res.body.paConfiguree).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("secret-de-test-pa");
  });

  test("PUT avec cleApi: null révoque la clé", async () => {
    await request(app)
      .put("/api/facturation-electronique")
      .set("Cookie", cookieOwnerA)
      .send({ cleApi: null })
      .expect(200);

    const res = await request(app)
      .get("/api/facturation-electronique")
      .set("Cookie", cookieOwnerA)
      .expect(200);
    expect(res.body.paConfiguree).toBe(false);
  });

  test("un MEMBER n'a pas accès (route réservée aux OWNER)", async () => {
    await request(app)
      .get("/api/facturation-electronique")
      .set("Cookie", cookieMemberA)
      .expect(403);
  });
});

// ── b — capture manuelle ─────────────────────────────────────────────────────

describe("b — capture manuelle d'un Factur-X reçu", () => {
  test("un vrai Factur-X est capturé, le SIREN/montant/date sont extraits sans ressaisie", async () => {
    const pdf = await facturXPdf();
    const res = await request(app)
      .post("/api/facturation-electronique/documents")
      .set("Cookie", cookieOwnerA)
      .attach("file", pdf, { filename: "facture-fournisseur.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(201);
    expect(res.body.fournisseurSiren).toBe("812345676");
    expect(res.body.montantTtcCents).toBe(120_000);
    expect(res.body.dateFacture).toBe("2026-08-10");
  });

  test("un PDF sans pièce jointe Factur-X est refusé (422), rien n'est écrit", async () => {
    const plain = Buffer.from("%PDF-1.4 pas un factur-x");
    const before = await request(app)
      .get("/api/facturation-electronique/documents")
      .set("Cookie", cookieOwnerA)
      .expect(200);

    const res = await request(app)
      .post("/api/facturation-electronique/documents")
      .set("Cookie", cookieOwnerA)
      .attach("file", plain, { filename: "pas-facturx.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(422);

    const after = await request(app)
      .get("/api/facturation-electronique/documents")
      .set("Cookie", cookieOwnerA)
      .expect(200);
    expect(after.body.total).toBe(before.body.total);
  });

  test("un fichier non-PDF est refusé (400)", async () => {
    await request(app)
      .post("/api/facturation-electronique/documents")
      .set("Cookie", cookieOwnerA)
      .attach("file", Buffer.from("pas un pdf"), { filename: "x.txt", contentType: "text/plain" })
      .expect(400);
  });

  test("le document capturé est téléchargeable, octets identiques", async () => {
    const pdf = await facturXPdf();
    const upload = await request(app)
      .post("/api/facturation-electronique/documents")
      .set("Cookie", cookieOwnerA)
      .attach("file", pdf, { filename: "facture.pdf", contentType: "application/pdf" });
    const id = upload.body.id as string;

    const dl = await request(app)
      .get(`/api/facturation-electronique/documents/${id}/pdf`)
      .set("Cookie", cookieOwnerA)
      .expect(200);
    expect((dl.body as Buffer).equals(pdf)).toBe(true);
  });
});

// ── c — isolation multi-tenant ────────────────────────────────────────────────

describe("c — isolation", () => {
  test("le tenant B ne voit aucun document du tenant A", async () => {
    const pdf = await facturXPdf();
    await request(app)
      .post("/api/facturation-electronique/documents")
      .set("Cookie", cookieOwnerA)
      .attach("file", pdf, { filename: "facture-a.pdf", contentType: "application/pdf" })
      .expect(201);

    const listeB = await request(app)
      .get("/api/facturation-electronique/documents")
      .set("Cookie", cookieOwnerB)
      .expect(200);
    expect(listeB.body.documents).toEqual([]);
  });
});

// ── d — webhook entrant : authentification ────────────────────────────────────

describe("d — webhook plateforme agréée : authentification par signature", () => {
  test("génère un secret de webhook, jamais relu ensuite", async () => {
    const res = await request(app)
      .post("/api/facturation-electronique/webhook-secret")
      .set("Cookie", cookieOwnerA)
      .expect(200);
    expect(typeof res.body.secret).toBe("string");
    expect(res.body.secret.length).toBeGreaterThan(32);

    const statut = await request(app)
      .get("/api/facturation-electronique")
      .set("Cookie", cookieOwnerA)
      .expect(200);
    expect(statut.body.webhookConfigure).toBe(true);
    expect(JSON.stringify(statut.body)).not.toContain(res.body.secret);
  });

  test("une signature correcte est acceptée et écrit le document", async () => {
    const secretRes = await request(app)
      .post("/api/facturation-electronique/webhook-secret")
      .set("Cookie", cookieOwnerA)
      .expect(200);
    const secret = secretRes.body.secret as string;

    const pdf = await facturXPdf();
    const body = { pdfBase64: pdf.toString("base64") };
    const raw = JSON.stringify(body);
    const signature = crypto.createHmac("sha256", secret).update(raw).digest("hex");

    const res = await request(app)
      .post(`/api/webhooks/plateforme-agreee/${tenantAId}`)
      .set("Content-Type", "application/json")
      .set("X-Pa-Signature", `sha256=${signature}`)
      .send(raw);
    expect(res.status).toBe(201);
  });

  test("une signature incorrecte est refusée (401), rien n'est écrit", async () => {
    const before = await request(app)
      .get("/api/facturation-electronique/documents")
      .set("Cookie", cookieOwnerA)
      .expect(200);

    const pdf = await facturXPdf();
    const body = { pdfBase64: pdf.toString("base64") };
    const raw = JSON.stringify(body);

    const res = await request(app)
      .post(`/api/webhooks/plateforme-agreee/${tenantAId}`)
      .set("Content-Type", "application/json")
      .set("X-Pa-Signature", "sha256=0000000000000000000000000000000000000000000000000000000000000000")
      .send(raw);
    expect(res.status).toBe(401);

    const after = await request(app)
      .get("/api/facturation-electronique/documents")
      .set("Cookie", cookieOwnerA)
      .expect(200);
    expect(after.body.total).toBe(before.body.total);
  });

  test("sans en-tête de signature, la requête est refusée (401)", async () => {
    const pdf = await facturXPdf();
    const res = await request(app)
      .post(`/api/webhooks/plateforme-agreee/${tenantAId}`)
      .send({ pdfBase64: pdf.toString("base64") });
    expect(res.status).toBe(401);
  });

  test("un tenant sans secret de webhook configuré refuse tout (401) — même réponse qu'un tenant inconnu", async () => {
    const inconnu = crypto.randomUUID();
    const resInconnu = await request(app)
      .post(`/api/webhooks/plateforme-agreee/${inconnu}`)
      .set("X-Pa-Signature", "sha256=abc")
      .send({ pdfBase64: "AA==" });
    expect(resInconnu.status).toBe(401);

    const resTenantBSansSecret = await request(app)
      .post(`/api/webhooks/plateforme-agreee/${tenantBId}`)
      .set("X-Pa-Signature", "sha256=abc")
      .send({ pdfBase64: "AA==" });
    expect(resTenantBSansSecret.status).toBe(401);
    expect(resTenantBSansSecret.body).toEqual(resInconnu.body);
  });

  test("un id de tenant mal formé est rejeté (404), pas une erreur serveur", async () => {
    await request(app)
      .post("/api/webhooks/plateforme-agreee/pas-un-uuid")
      .set("X-Pa-Signature", "sha256=abc")
      .send({ pdfBase64: "AA==" })
      .expect(404);
  });
});
