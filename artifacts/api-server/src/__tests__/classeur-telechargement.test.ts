/**
 * Les pièces du Classeur doivent se télécharger.
 *
 * Constaté le 29/08/2026 : 30 documents listés, aucun téléchargeable. Chaque
 * facture répondait 404 avec « Ce document n'a pas de contenu archivé (importé
 * avant la mise en place du stockage) » — pour des factures créées le jour
 * même, dont le PDF existait bel et bien.
 *
 * Le Classeur ne cherchait que dans `classeur_document_bytes`, alimenté par les
 * dépôts manuels. Les PDF de factures et d'avoirs, eux, vivent dans
 * `archived_pdfs` : la règle 5 du dépôt les y met, dans la transaction qui
 * passe le document en EMISE, sur une table où `app_user` n'a que SELECT et
 * INSERT.
 *
 * Le Classeur indexe pourtant ces documents — il porte `sourceType` et
 * `sourceId`. Il ne lui manquait que d'aller les chercher là où ils sont.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest } from "./helpers";

let cookie: string;
let tenantId: string;
const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

const OCTETS = Buffer.from("%PDF-1.4 fausse facture archivée", "utf8");

/** Une facture émise, son PDF archivé, et son entrée au Classeur. */
async function factureArchivee(): Promise<{ documentId: string; factureId: string }> {
  const factureId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO factures (id, tenant_id, number, customer_name, amount_cents,
                           total_ht_cents, total_tva_cents, due_date, issued_date, statut, settled)
     VALUES ($1, $2::uuid, $3, 'Client Test', 120000, 100000, 20000,
             '2026-08-01', '2026-08-01', 'EMISE', false)`,
    [factureId, tenantId, `F-${Math.random().toString(36).slice(2, 8)}`],
  );
  await adminPool.query(
    `INSERT INTO archived_pdfs (id, tenant_id, document_type, document_id, bytes, sha256, byte_size)
     VALUES ($1, $2::uuid, 'FACTURE', $3, $4, $5, $6)`,
    [crypto.randomUUID(), tenantId, factureId, OCTETS,
     crypto.createHash("sha256").update(OCTETS).digest("hex"), OCTETS.length],
  );
  const documentId = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO classeur_documents (id, tenant_id, name, category, mime_type, source_type, source_id)
     VALUES ($1, $2::uuid, 'Facture de test', 'FACTURE', 'application/pdf', 'FACTURE', $3)`,
    [documentId, tenantId, factureId],
  );
  return { documentId, factureId };
}

beforeAll(async () => {
  const email = `classeur-${Date.now()}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Tenant Classeur" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  cookie = reg.headers["set-cookie"]?.[0] ?? "";
  const { body: me } = await request(serveurTest(app))
    .get("/api/auth/me").set("Cookie", cookie).expect(200);
  tenantId = me.tenantId;
  cleanupTenantIds.push(tenantId);
}, 120_000);

afterAll(async () => {
  for (const t of ["archived_pdfs", "classeur_documents", "factures"]) {
    await adminPool.query(`DELETE FROM ${t} WHERE tenant_id = ANY($1::uuid[])`, [cleanupTenantIds]);
  }
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

describe("une facture archivée se télécharge depuis le Classeur", () => {
  test("le téléchargement rend les octets du PDF archivé", async () => {
    const { documentId } = await factureArchivee();
    const res = await request(serveurTest(app))
      .get(`/api/classeur/${documentId}/telechargement`)
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(Buffer.from(res.body).equals(OCTETS)).toBe(true);
  });

  /*
   * La liste pilote le bouton de l'écran. Annoncer `hasContent: false` sur un
   * document parfaitement téléchargeable, c'est griser le bouton : le défaut
   * resterait invisible depuis l'interface même une fois la route réparée.
   */
  test("la liste annonce que le document a un contenu", async () => {
    const { documentId } = await factureArchivee();
    const res = await request(serveurTest(app)).get("/api/classeur").set("Cookie", cookie);
    const doc = (res.body.documents as Array<{ id: string; hasContent: boolean }>)
      .find(d => d.id === documentId);
    expect(doc?.hasContent).toBe(true);
  });

  /*
   * Le message d'origine accusait « un import antérieur à la mise en place du
   * stockage » pour des documents créés le jour même. Un document sans octets
   * nulle part existe (une fiche saisie à la main), mais il ne doit pas mentir
   * sur la raison.
   */
  test("un document sans aucun octet répond 404 sans accuser un import", async () => {
    const documentId = crypto.randomUUID();
    await adminPool.query(
      `INSERT INTO classeur_documents (id, tenant_id, name, category, mime_type)
       VALUES ($1, $2::uuid, 'Fiche sans fichier', 'AUTRE', 'application/pdf')`,
      [documentId, tenantId],
    );
    const res = await request(serveurTest(app))
      .get(`/api/classeur/${documentId}/telechargement`).set("Cookie", cookie);
    expect(res.status).toBe(404);
    expect(res.body.error).not.toMatch(/import/i);
  });
});
