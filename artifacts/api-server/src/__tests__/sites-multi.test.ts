/*
 * Les sites d'un contrat multi-sites — US-B7.1, première moitié.
 *
 * ── L'équilibre que la story impose ───────────────────────────────────────
 * « Chaque site associé peut être planifié et suivi INDÉPENDAMMENT tout en
 * remontant à une facturation CONSOLIDÉE pour le client. »
 *
 * Les deux moitiés tirent en sens contraire : le terrain travaille site par
 * site — huit agences, huit tournées — pendant que la comptabilité veut UNE
 * facture par client. Ce fichier éprouve la première ; la seconde vient avec
 * la facturation consolidée.
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

async function inscrire(nom: string): Promise<{ cookie: string; tenantId: string }> {
  const email = `site-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const { body, headers } = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "P", tenantNom: `Nettoyage ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(body.userId);
  tenantIds.push(body.tenantId);
  return { cookie: headers["set-cookie"][0], tenantId: body.tenantId };
}

async function client(tenantId: string, nom = "Groupe Delacroix"): Promise<string> {
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO clients (id, tenant_id, nom) VALUES ($1, $2::uuid, $3)`,
    [id, tenantId, nom],
  );
  return id;
}

async function contrat(tenantId: string, clientNom = "Groupe Delacroix"): Promise<string> {
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO contrats (id, tenant_id, label, client_name, cadence, amount_cents, status, start_date)
     VALUES ($1, $2::uuid, 'Nettoyage multi-sites', $3, 'mensuel', 200000, 'ACTIF', CURRENT_DATE)`,
    [id, tenantId, clientNom],
  );
  return id;
}

const poser = (cookie: string, corps: Record<string, unknown>) =>
  request(serveurTest(app)).post("/api/sites").set("Cookie", cookie).send(corps);

afterAll(async () => {
  await adminPool.query(`DELETE FROM sites WHERE tenant_id = ANY($1::uuid[])`, [tenantIds]);
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

describe("un contrat couvre plusieurs sites", () => {
  test("huit agences sous UN contrat", async () => {
    // C'est le cas d'usage : avant, il fallait huit contrats, donc huit
    // factures mensuelles à un client qui en attend une.
    const t = await inscrire("huit");
    const cl = await client(t.tenantId);
    const co = await contrat(t.tenantId);

    for (let i = 1; i <= 8; i++) {
      await poser(t.cookie, {
        clientId: cl, contratId: co, libelle: `Agence ${i}`, montantCents: 25_000,
      }).expect(201);
    }
    const { body } = await request(serveurTest(app))
      .get(`/api/sites?contratId=${co}`).set("Cookie", t.cookie).expect(200);
    expect(body).toHaveLength(8);
  });

  test("chaque site porte SON montant", async () => {
    // Une agence de 400 m² ne se facture pas comme un local de 60. C'est ce
    // qui lève la limite du contrat à montant global unique (US-A2.3).
    const t = await inscrire("montants");
    const cl = await client(t.tenantId);
    const co = await contrat(t.tenantId);

    const grande = await poser(t.cookie, {
      clientId: cl, contratId: co, libelle: "Siège", montantCents: 90_000,
    }).expect(201);
    const petite = await poser(t.cookie, {
      clientId: cl, contratId: co, libelle: "Dépôt", montantCents: 15_000,
    }).expect(201);

    expect(grande.body.montantCents).toBe(90_000);
    expect(petite.body.montantCents).toBe(15_000);
  });

  test("un site SANS montant est accepté — inclus dans un forfait", async () => {
    const t = await inscrire("sansmontant");
    const cl = await client(t.tenantId);
    const { body } = await poser(t.cookie, {
      clientId: cl, libelle: "Tournée incluse",
    }).expect(201);
    expect(body.montantCents).toBeNull();
  });

  test("un site hors contrat est accepté — bâtiment connu, intervention ponctuelle", async () => {
    const t = await inscrire("horscontrat");
    const cl = await client(t.tenantId);
    const { body } = await poser(t.cookie, { clientId: cl, libelle: "Chantier ponctuel" }).expect(201);
    expect(body.contratId).toBeNull();
  });
});

describe("les refus qui expliquent", () => {
  test("deux sites du même nom sous un contrat sont refusés", async () => {
    // Deux lignes « Agence Nord » sur une facture consolidée, pour deux
    // montants différents, seraient invérifiables par le client.
    const t = await inscrire("doublon");
    const cl = await client(t.tenantId);
    const co = await contrat(t.tenantId);

    await poser(t.cookie, { clientId: cl, contratId: co, libelle: "Agence Nord" }).expect(201);
    const { body } = await poser(t.cookie, {
      clientId: cl, contratId: co, libelle: "Agence Nord",
    }).expect(409);
    expect(body.error).toMatch(/facture consolidée/);
  });

  test("le même nom sous DEUX contrats différents reste possible", async () => {
    // Deux clients peuvent avoir chacun leur « Siège ». L'unicité porte sur
    // le couple contrat + libellé, pas sur le libellé seul.
    const t = await inscrire("deuxcontrats");
    const cl = await client(t.tenantId);
    const a = await contrat(t.tenantId);
    const b = await contrat(t.tenantId);
    await poser(t.cookie, { clientId: cl, contratId: a, libelle: "Siège" }).expect(201);
    await poser(t.cookie, { clientId: cl, contratId: b, libelle: "Siège" }).expect(201);
  });

  test("un client inexistant est refusé", async () => {
    // Un site rattaché à un client fantôme ne remonterait dans aucune facture
    // et resterait invisible.
    const t = await inscrire("clientfantome");
    const { body } = await poser(t.cookie, {
      clientId: crypto.randomUUID(), libelle: "Agence",
    }).expect(422);
    expect(body.error).toMatch(/client n'existe pas/);
  });

  test("un contrat inexistant est refusé", async () => {
    const t = await inscrire("contratfantome");
    const cl = await client(t.tenantId);
    await poser(t.cookie, {
      clientId: cl, contratId: crypto.randomUUID(), libelle: "Agence",
    }).expect(422);
  });
});

describe("un site se désactive, il ne se supprime pas", () => {
  test("DELETE le désactive et conserve son historique", async () => {
    // Le supprimer ferait disparaître des lignes de factures déjà émises de
    // la vue du client — sur un document qu'il a payé et archivé.
    const t = await inscrire("desactiver");
    const cl = await client(t.tenantId);
    const { body: site } = await poser(t.cookie, { clientId: cl, libelle: "Agence fermée" }).expect(201);

    const { body } = await request(serveurTest(app))
      .delete(`/api/sites/${site.id}`).set("Cookie", t.cookie).expect(200);
    expect(body.actif).toBe(false);
    expect(body.message).toMatch(/historique/);

    const { rows } = await adminPool.query(
      "SELECT count(*)::int AS n FROM sites WHERE id = $1", [site.id],
    );
    expect(rows[0].n).toBe(1);   // il est TOUJOURS là
  });
});

describe("le planning par site", () => {
  test("une affectation vise un SITE précis", async () => {
    // « Planifié indépendamment » : sans cette colonne, planifier huit
    // agences donnait huit lignes indistinguables sur le même client.
    const t = await inscrire("planning");
    const cl = await client(t.tenantId);
    const { body: site } = await poser(t.cookie, { clientId: cl, libelle: "Agence Nord" }).expect(201);

    const membreId = crypto.randomUUID();
    await adminPool.query(
      `INSERT INTO team_members (id, tenant_id, name, role) VALUES ($1, $2::uuid, 'Thomas', 'OUVRIER')`,
      [membreId, t.tenantId],
    );
    await adminPool.query(
      `INSERT INTO affectations (id, tenant_id, client_id, site_id, membre_id, date_debut, date_fin, heures_par_jour)
       VALUES ($1, $2::uuid, $3, $4, $5, '2026-09-01', '2026-09-05', 7)`,
      [crypto.randomUUID(), t.tenantId, cl, site.id, membreId],
    );

    const { rows } = await adminPool.query(
      "SELECT site_id FROM affectations WHERE tenant_id = $1", [t.tenantId],
    );
    expect(rows[0].site_id).toBe(site.id);
  });
});

describe("l'isolation", () => {
  test("les sites d'un tenant ne sont pas lus par un autre", async () => {
    const a = await inscrire("iso-a");
    const b = await inscrire("iso-b");
    const cl = await client(a.tenantId);
    await poser(a.cookie, { clientId: cl, libelle: "Agence secrète" }).expect(201);

    const { body } = await request(serveurTest(app))
      .get("/api/sites").set("Cookie", b.cookie).expect(200);
    expect(JSON.stringify(body)).not.toContain("Agence secrète");
  });
});
