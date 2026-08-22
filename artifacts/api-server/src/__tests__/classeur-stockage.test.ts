/**
 * Le Classeur n'offrait aucun moyen de consulter un document uploadé — bug
 * confirmé en UAT : `classeur_documents` n'avait jamais eu de colonne de
 * contenu, `POST /classeur` n'acceptait que des métadonnées JSON, et le
 * fichier réel n'était jamais transmis au serveur.
 *
 * Ces tests couvrent le stockage réel introduit par 029_classeur_document_bytes.sql :
 * aller-retour upload → téléchargement avec les MÊMES octets, isolation par
 * tenant, et suppression qui emporte le contenu.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
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
  serveurTest,
} from "./helpers";

let cookieA: string;
let cookieB: string;
let tenantAId: string;
const tenantIds: string[] = [];
const emails: string[] = [];

beforeAll(async () => {
  const tenantA = await createTestTenant("Classeur Tenant A");
  const tenantB = await createTestTenant("Classeur Tenant B");
  tenantAId = tenantA.id;
  tenantIds.push(tenantA.id, tenantB.id);

  const emailA = `classeur-a-${Date.now()}@test.nodaq`;
  const emailB = `classeur-b-${Date.now()}@test.nodaq`;
  emails.push(emailA, emailB);

  const userA = await createTestUser(emailA);
  await createTestMembership(userA.id, tenantA.id, "OWNER");
  const sessionA = await createTestSession(userA.id, tenantA.id);
  cookieA = cookieHeader(sessionA.id);

  const userB = await createTestUser(emailB);
  await createTestMembership(userB.id, tenantB.id, "OWNER");
  const sessionB = await createTestSession(userB.id, tenantB.id);
  cookieB = cookieHeader(sessionB.id);
});

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
});

describe("a — aller-retour upload → téléchargement", () => {
  test("les octets téléchargés sont EXACTEMENT ceux uploadés", async () => {
    const contenu = Buffer.from("%PDF-1.4 contenu de test classeur");
    const shaAttendu = crypto.createHash("sha256").update(contenu).digest("hex");

    const upload = await request(serveurTest(app))
      .post("/api/classeur")
      .set("Cookie", cookieA)
      .field("category", "CONTRATS")
      .attach("file", contenu, { filename: "contrat-test.pdf", contentType: "application/pdf" });

    expect(upload.status).toBe(201);
    expect(upload.body.hasContent).toBe(true);
    expect(upload.body.name).toBe("contrat-test.pdf");
    expect(upload.body.category).toBe("CONTRATS");
    const id = upload.body.id as string;

    const dl = await request(serveurTest(app))
      .get(`/api/classeur/${id}/telechargement`)
      .set("Cookie", cookieA);

    expect(dl.status).toBe(200);
    expect(dl.headers["content-type"]).toContain("application/pdf");
    const shaRecu = crypto.createHash("sha256").update(dl.body as Buffer).digest("hex");
    expect(shaRecu).toBe(shaAttendu);
    expect((dl.body as Buffer).equals(contenu)).toBe(true);
  });

  test("le document est listé avec hasContent:true", async () => {
    const upload = await request(serveurTest(app))
      .post("/api/classeur")
      .set("Cookie", cookieA)
      .field("name", "Facture listing")
      .field("category", "FACTURES")
      .attach("file", Buffer.from("contenu"), { filename: "f.pdf", contentType: "application/pdf" });
    expect(upload.status).toBe(201);

    const list = await request(serveurTest(app)).get("/api/classeur").set("Cookie", cookieA);
    expect(list.status).toBe(200);
    const doc = list.body.documents.find((d: { id: string }) => d.id === upload.body.id);
    expect(doc.hasContent).toBe(true);
  });

  test("sans fichier → 400, rien n'est créé", async () => {
    const res = await request(serveurTest(app))
      .post("/api/classeur")
      .set("Cookie", cookieA)
      .field("name", "Sans fichier")
      .field("category", "DIVERS");
    expect(res.status).toBe(400);
  });

  test("un type de fichier non autorisé est refusé", async () => {
    const res = await request(serveurTest(app))
      .post("/api/classeur")
      .set("Cookie", cookieA)
      .attach("file", Buffer.from("#!/bin/sh\necho hi"), { filename: "script.sh", contentType: "application/x-sh" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
});

describe("b — suppression emporte le contenu", () => {
  test("après DELETE, le téléchargement rend 404", async () => {
    const upload = await request(serveurTest(app))
      .post("/api/classeur")
      .set("Cookie", cookieA)
      .attach("file", Buffer.from("à supprimer"), { filename: "a-supprimer.pdf", contentType: "application/pdf" });
    const id = upload.body.id as string;

    const del = await request(serveurTest(app)).delete(`/api/classeur/${id}`).set("Cookie", cookieA);
    expect(del.status).toBe(204);

    const dl = await request(serveurTest(app)).get(`/api/classeur/${id}/telechargement`).set("Cookie", cookieA);
    expect(dl.status).toBe(404);

    const { rows } = await adminPool.query(
      "SELECT 1 FROM classeur_document_bytes WHERE document_id = $1",
      [id],
    );
    expect(rows.length).toBe(0);
  });
});

describe("c — isolation par tenant", () => {
  test("le tenant B ne peut pas télécharger un document du tenant A", async () => {
    const upload = await request(serveurTest(app))
      .post("/api/classeur")
      .set("Cookie", cookieA)
      .attach("file", Buffer.from("secret tenant A"), { filename: "secret.pdf", contentType: "application/pdf" });
    const id = upload.body.id as string;

    const dl = await request(serveurTest(app)).get(`/api/classeur/${id}/telechargement`).set("Cookie", cookieB);
    expect(dl.status).toBe(404);

    const list = await request(serveurTest(app)).get("/api/classeur").set("Cookie", cookieB);
    expect(list.body.documents.find((d: { id: string }) => d.id === id)).toBeUndefined();
  });
});

describe("d — document sans contenu archivé (créé avant la migration)", () => {
  test("hasContent:false et le téléchargement rend 404 avec un message explicite", async () => {
    const id = crypto.randomUUID();
    await adminPool.query(
      "INSERT INTO classeur_documents (id, tenant_id, name, category) VALUES ($1, $2, 'ancien-document.pdf', 'DIVERS')",
      [id, tenantAId],
    );

    const list = await request(serveurTest(app)).get("/api/classeur").set("Cookie", cookieA);
    const doc = list.body.documents.find((d: { id: string }) => d.id === id);
    expect(doc.hasContent).toBe(false);

    const dl = await request(serveurTest(app)).get(`/api/classeur/${id}/telechargement`).set("Cookie", cookieA);
    expect(dl.status).toBe(404);
    expect(dl.body.error).toMatch(/contenu archivé/);
  });
});
