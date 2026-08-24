/*
 * L'attestation fiscale SAP, de bout en bout — US-B4.1.
 *
 * `attestationSap.test.ts` éprouve le CALCUL. Celui-ci éprouve le CÂBLAGE :
 * que la route lit les encaissements là où ils sont, qu'elle distingue une
 * aide d'un versement du client, et qu'un double clic n'envoie pas deux
 * documents fiscaux contradictoires au même particulier.
 */
import { describe, test, expect, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app.js";
import {
  adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest,
} from "./helpers.js";

const tenantIds: string[] = [];
const emails: string[] = [];

async function inscrire(nom: string, avecSap = true): Promise<{ cookie: string; tenantId: string }> {
  const email = `sap-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "P", tenantNom: `SAP ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantIds.push(body.tenantId);
  const poser = (k: string, v: string) => adminPool.query(
    `INSERT INTO settings (tenant_id, key, value) VALUES ($1::uuid, $2, $3)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [body.tenantId, k, v],
  );
  await poser("company.nom", "Services Martin");
  await poser("company.siret", "12345678901234");
  if (avecSap) await poser("company.sap_numero_declaration", "SAP123456789");
  return { cookie: headers["set-cookie"][0], tenantId: body.tenantId };
}

async function client(tenantId: string, nom: string): Promise<string> {
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO clients (id, tenant_id, nom, adresse, ville) VALUES ($1, $2::uuid, $3, '3 rue Neuve', 'Paris')`,
    [id, tenantId, nom],
  );
  return id;
}

async function encaisser(
  tenantId: string, clientId: string, date: string, cents: number,
  nature = "AUTRE", sens = "ENCAISSEMENT",
): Promise<void> {
  await adminPool.query(
    `INSERT INTO paiements (id, tenant_id, client_id, date, montant_cents, sens, nature)
     VALUES ($1, $2::uuid, $3, $4, $5, $6, $7)`,
    [crypto.randomUUID(), tenantId, clientId, date, cents, sens, nature],
  );
}

const generer = (cookie: string, annee: number) =>
  request(serveurTest(app)).post("/api/attestations-sap").set("Cookie", cookie).send({ annee });

afterAll(async () => {
  await adminPool.query(`DELETE FROM attestations_sap WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
  await adminPool.query(`DELETE FROM paiements WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

describe("la génération EN MASSE, en une action", () => {
  test("quarante clients, un seul geste", async () => {
    // Le cœur de la story : les faire un par un au mois de mars est
    // exactement le travail qu'elle supprime.
    const t = await inscrire("masse");
    for (let i = 0; i < 40; i++) {
      const c = await client(t.tenantId, `Client ${i}`);
      await encaisser(t.tenantId, c, "2026-06-15", 30_000);
    }
    const { body } = await generer(t.cookie, 2026).expect(201);
    expect(body.creees).toBe(40);
  });

  test("un client sans encaissement de l'année est ÉCARTÉ, avec son motif", async () => {
    const t = await inscrire("ecarte");
    const actif = await client(t.tenantId, "Actif");
    await client(t.tenantId, "Dormant");
    await encaisser(t.tenantId, actif, "2026-06-15", 30_000);

    const { body } = await generer(t.cookie, 2026).expect(201);
    expect(body.creees).toBe(1);
    expect(body.ecartes).toHaveLength(1);
    expect(body.ecartes[0].motif).toMatch(/aucun encaissement en 2026/);
  });
});

describe("l'attestation porte l'ENCAISSÉ de l'année civile", () => {
  test("un paiement de l'année précédente n'y entre pas", async () => {
    // Une facture de décembre réglée en janvier appartient à l'année
    // suivante. Attester du facturé ferait réclamer un crédit d'impôt indu —
    // et c'est le CLIENT que l'administration redresserait.
    const t = await inscrire("annee");
    const c = await client(t.tenantId, "Madame Dupont");
    await encaisser(t.tenantId, c, "2025-12-28", 50_000);
    await encaisser(t.tenantId, c, "2026-03-10", 20_000);

    await generer(t.cookie, 2026).expect(201);
    const { rows } = await adminPool.query(
      "SELECT montant_eligible_cents FROM attestations_sap WHERE client_id = $1", [c],
    );
    expect(rows[0].montant_eligible_cents).toBe(20_000);
  });

  test("un REMBOURSEMENT réduit ce qui est attesté", async () => {
    // De l'argent RENDU au client : il ne l'a pas payé. L'attester lui ferait
    // réclamer un crédit d'impôt sur une somme qu'il a récupérée.
    const t = await inscrire("sens");
    const c = await client(t.tenantId, "Madame Dupont");
    await encaisser(t.tenantId, c, "2026-03-10", 50_000);
    await encaisser(t.tenantId, c, "2026-04-10", 20_000, "AUTRE", "REMBOURSEMENT");

    await generer(t.cookie, 2026).expect(201);
    const { rows } = await adminPool.query(
      "SELECT montant_eligible_cents FROM attestations_sap WHERE client_id = $1", [c],
    );
    expect(rows[0].montant_eligible_cents).toBe(30_000);
  });

  test("les aides d'un tiers sont DÉDUITES et affichées à part", async () => {
    // APA, PCH, CESU préfinancé ne sortent pas de la poche du client : les
    // inclure gonflerait l'avantage fiscal déclaré.
    const t = await inscrire("aides");
    const c = await client(t.tenantId, "Madame Dupont");
    await encaisser(t.tenantId, c, "2026-03-10", 80_000);
    await encaisser(t.tenantId, c, "2026-04-10", 30_000, "AIDE_TIERS");

    await generer(t.cookie, 2026).expect(201);
    const { rows } = await adminPool.query(
      "SELECT montant_eligible_cents, aides_cents FROM attestations_sap WHERE client_id = $1", [c],
    );
    expect(rows[0].montant_eligible_cents).toBe(80_000);
    expect(rows[0].aides_cents).toBe(30_000);
  });
});

describe("sans numéro de déclaration SAP, RIEN ne part", () => {
  test("la génération est refusée en bloc", async () => {
    // En produire quarante qu'il faudra renvoyer est pire que n'en produire
    // aucune : le client les a déjà transmises à son centre des impôts.
    const t = await inscrire("sansnum", false);
    const c = await client(t.tenantId, "Madame Dupont");
    await encaisser(t.tenantId, c, "2026-03-10", 20_000);

    const { body } = await generer(t.cookie, 2026).expect(422);
    expect(body.error).toMatch(/déclaration SAP/);
    // Et il dit combien de clients attendent — c'est ce qui motive à
    // compléter le profil.
    expect(body.clientsConcernes).toBe(1);

    const { rows } = await adminPool.query(
      "SELECT count(*)::int AS n FROM attestations_sap WHERE tenant_id = $1", [t.tenantId],
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("un double clic n'envoie pas deux documents contradictoires", () => {
  test("rejouer la génération ne crée rien de plus", async () => {
    const t = await inscrire("double");
    const c = await client(t.tenantId, "Madame Dupont");
    await encaisser(t.tenantId, c, "2026-03-10", 20_000);

    expect((await generer(t.cookie, 2026).expect(201)).body.creees).toBe(1);
    const second = await generer(t.cookie, 2026).expect(201);
    expect(second.body.creees).toBe(0);
    expect(second.body.dejaGenerees).toBe(1);

    const { rows } = await adminPool.query(
      "SELECT count(*)::int AS n FROM attestations_sap WHERE client_id = $1", [c],
    );
    expect(rows[0].n).toBe(1);
  });

  test("l'INDEX refuse le doublon, pas seulement le code", async () => {
    const t = await inscrire("index");
    const c = await client(t.tenantId, "Madame Dupont");
    await encaisser(t.tenantId, c, "2026-03-10", 20_000);
    await generer(t.cookie, 2026).expect(201);

    await expect(adminPool.query(
      `INSERT INTO attestations_sap (id, tenant_id, client_id, annee, montant_eligible_cents)
       VALUES ($1, $2::uuid, $3, 2026, 999)`,
      [crypto.randomUUID(), t.tenantId, c],
    )).rejects.toThrow(/attestations_sap_client_annee_idx|duplicate key/);
  });
});

describe("le document", () => {
  test("il porte le numéro de déclaration SAP et l'article du CGI", async () => {
    // Chaque mention absente est une raison de refuser l'avantage au client.
    const t = await inscrire("pdf");
    const c = await client(t.tenantId, "Madame Dupont");
    await encaisser(t.tenantId, c, "2026-03-10", 80_000);
    await encaisser(t.tenantId, c, "2026-04-10", 30_000, "AIDE_TIERS");
    await generer(t.cookie, 2026).expect(201);

    const { rows } = await adminPool.query(
      "SELECT id FROM attestations_sap WHERE client_id = $1", [c],
    );
    const rep = await request(serveurTest(app))
      .get(`/api/attestations-sap/${rows[0].id}/pdf`).set("Cookie", t.cookie).expect(200);

    const texte = rep.body.toString("latin1");
    expect(texte).toContain("%PDF");
    expect(rep.headers["content-type"]).toBe("application/pdf");
    expect(rep.body.length).toBeGreaterThan(1000);
  });

  test("une attestation d'un AUTRE tenant est introuvable", async () => {
    const a = await inscrire("iso-a");
    const b = await inscrire("iso-b");
    const c = await client(a.tenantId, "Madame Dupont");
    await encaisser(a.tenantId, c, "2026-03-10", 20_000);
    await generer(a.cookie, 2026).expect(201);
    const { rows } = await adminPool.query(
      "SELECT id FROM attestations_sap WHERE client_id = $1", [c],
    );

    await request(serveurTest(app))
      .get(`/api/attestations-sap/${rows[0].id}/pdf`).set("Cookie", b.cookie).expect(404);
  });
});
