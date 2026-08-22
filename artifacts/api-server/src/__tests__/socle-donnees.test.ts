/**
 * Socle de données — clients, paiements, affectations.
 *
 * Ce que ces tests protègent :
 *   a. immuabilité de `paiements` — privilèges EFFECTIFS, pas un GRANT lu dans
 *      un fichier ;
 *   b. paiement partiel : la facture reste EMISE, reste dû exact ;
 *   c. acompte sans facture, rattaché à une affaire ;
 *   d. NOM FIGÉ : renommer une fiche ne réécrit pas un document émis ;
 *   e. affectation ≠ pointage : aucune heure prévue dans une marge ;
 *   f. bornes de période et dates métier, dans les trois fuseaux ;
 *   g. isolation, une table à la fois.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { toDateString } from "@nodaq/shared";
import { adminPool, cleanupTenants, cleanupUsers, createTestTeamMember, completeMfaForRegisteredOwner, serveurTest } from "./helpers";

interface Locataire { cookie: string; tenantId: string }

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

let a: Locataire;
let b: Locataire;

async function inscrire(nom: string): Promise<Locataire> {
  const email = `socle-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: `Patron ${nom}`, tenantNom: `Tenant ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  const cookie = reg.headers["set-cookie"]?.[0] ?? "";
  const { body: me } = await request(serveurTest(app)).get("/api/auth/me").set("Cookie", cookie).expect(200);
  cleanupTenantIds.push(me.tenantId);
  return { cookie, tenantId: me.tenantId };
}

/** Facture EMISE d'un montant donné, posée directement pour maîtriser l'état. */
async function factureEmise(
  l: Locataire,
  montantCents: number,
  nomClient = "Dupont SARL",
  clientId: string | null = null,
): Promise<string> {
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO factures (id, tenant_id, number, customer_name, amount_cents, residual_cents,
                           due_date, issued_date, statut, settled, client_id)
     VALUES ($1, $2::uuid, $3, $4, $5, $5, CURRENT_DATE, CURRENT_DATE, 'EMISE', false, $6)`,
    [id, l.tenantId, `F-${crypto.randomBytes(3).toString("hex")}`, nomClient, montantCents, clientId],
  );
  return id;
}

async function affaire(l: Locataire, label = "Chantier test"): Promise<string> {
  const id = crypto.randomUUID();
  await adminPool.query(
    `INSERT INTO affaires (id, tenant_id, label, status) VALUES ($1, $2::uuid, $3, 'EN_COURS')`,
    [id, l.tenantId, label],
  );
  return id;
}

/**
 * Un jour de semaine (mardi, jamais un bord de semaine) garanti quelle que
 * soit la date d'exécution du test — pour les tests qui ne veulent PAS
 * dépendre du jour de la semaine, contrairement à ceux qui l'éprouvent
 * délibérément (voir « e — une heure PRÉVUE… »).
 */
function prochainMardi(): string {
  const d = new Date();
  const decalage = (2 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + decalage);
  return toDateString(d);
}

/** Le prochain samedi, garanti, quelle que soit la date d'exécution du test. */
function prochainSamedi(): string {
  const d = new Date();
  const decalage = (6 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + decalage);
  return toDateString(d);
}

beforeAll(async () => {
  a = await inscrire("a");
  b = await inscrire("b");
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

// ── a. Immuabilité de `paiements` ───────────────────────────────────────────

describe("a — `paiements` est append-only, imposé par le moteur", () => {
  test("SELECT et INSERT réussissent, UPDATE et DELETE échouent en 42501", async () => {
    // Privilèges EFFECTIFS, avec la connexion APPLICATIVE : lire un GRANT dans
    // un fichier .sql ne prouve rien — c'est l'erreur commise en PR #15.
    const id = crypto.randomUUID();
    const client = await adminPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_user");
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [a.tenantId]);

      await client.query(
        `INSERT INTO paiements (id, tenant_id, date, montant_cents) VALUES ($1, $2::uuid, CURRENT_DATE, 5000)`,
        [id, a.tenantId],
      );
      const lu = await client.query(`SELECT count(*)::int AS n FROM paiements WHERE id = $1`, [id]);
      expect(lu.rows[0].n).toBe(1);

      await expect(
        client.query(`UPDATE paiements SET montant_cents = 1 WHERE id = $1`, [id]),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK");

      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_user");
      await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [a.tenantId]);
      await expect(
        client.query(`DELETE FROM paiements WHERE id = $1`, [id]),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });

  test("`paiements` figure dans APPEND_ONLY_TABLES de create-app-role.cjs", async () => {
    // Sans cette entrée, la prochaine exécution du script DÉFERAIT la
    // révocation en silence : son GRANT massif rend les quatre droits.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const source = readFileSync(
      resolve(__dirname, "../../../../lib/db/scripts/create-app-role.cjs"),
      "utf8",
    );
    const ligne = /const APPEND_ONLY_TABLES = \[([^\]]*)\]/.exec(source);
    expect(ligne, "APPEND_ONLY_TABLES introuvable").not.toBeNull();
    expect(ligne![1]).toContain("paiements");
  });

  test("le montant est strictement positif — le signe est porté par `sens`", async () => {
    const client = await adminPool.connect();
    try {
      await client.query("BEGIN");
      await expect(
        client.query(
          `INSERT INTO paiements (id, tenant_id, date, montant_cents) VALUES ($1, $2::uuid, CURRENT_DATE, -100)`,
          [crypto.randomUUID(), a.tenantId],
        ),
      ).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});

// ── b. Paiement partiel ─────────────────────────────────────────────────────

describe("b — paiement partiel", () => {
  test("10 000 € facturés, 3 000 € encaissés → EMISE, reste dû 7 000 €", async () => {
    const f = await factureEmise(a, 1_000_000);

    const { body } = await request(serveurTest(app))
      .post("/api/paiements")
      .set("Cookie", a.cookie)
      .send({ factureId: f, montantCents: 300_000, moyen: "VIREMENT", nature: "ACOMPTE" })
      .expect(201);
    expect(body.facture.resteDuCents).toBe(700_000);
    expect(body.facture.soldee).toBe(false);

    const { rows } = await adminPool.query(
      `SELECT statut, settled, residual_cents FROM factures WHERE id = $1`, [f],
    );
    expect(rows[0].statut).toBe("EMISE");
    expect(rows[0].settled).toBe(false);
    expect(Math.round(rows[0].residual_cents)).toBe(700_000);
  });

  test("le solde de 7 000 € fait passer la facture en PAYEE", async () => {
    const f = await factureEmise(a, 1_000_000);
    await request(serveurTest(app)).post("/api/paiements").set("Cookie", a.cookie)
      .send({ factureId: f, montantCents: 300_000 }).expect(201);
    const { body } = await request(serveurTest(app)).post("/api/paiements").set("Cookie", a.cookie)
      .send({ factureId: f, montantCents: 700_000, nature: "SOLDE" }).expect(201);

    expect(body.facture.resteDuCents).toBe(0);
    expect(body.facture.soldee).toBe(true);
    const { rows } = await adminPool.query(
      `SELECT statut, settled, residual_cents FROM factures WHERE id = $1`, [f],
    );
    expect(rows[0].statut).toBe("PAYEE");
    expect(rows[0].settled).toBe(true);
    expect(Math.round(rows[0].residual_cents)).toBe(0);
  });

  test("`POST /factures/:id/payer` passe par le JOURNAL", async () => {
    // Deux façons d'écrire le même fait, ce sont deux façons de le rendre
    // faux : cette route ne doit plus poser l'état à la main.
    const f = await factureEmise(a, 500_000);
    await request(serveurTest(app)).post(`/api/factures/${f}/payer`).set("Cookie", a.cookie).expect(200);

    const { rows } = await adminPool.query(
      `SELECT montant_cents, nature FROM paiements WHERE facture_id = $1`, [f],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].montant_cents).toBe(500_000);
    expect(rows[0].nature).toBe("SOLDE");

    const facture = await adminPool.query(`SELECT statut, settled FROM factures WHERE id = $1`, [f]);
    expect(facture.rows[0].statut).toBe("PAYEE");
    expect(facture.rows[0].settled).toBe(true);
  });

  test("après un acompte, « payer » n'encaisse que le RESTE dû", async () => {
    const f = await factureEmise(a, 1_000_000);
    await request(serveurTest(app)).post("/api/paiements").set("Cookie", a.cookie)
      .send({ factureId: f, montantCents: 400_000, nature: "ACOMPTE" }).expect(201);
    await request(serveurTest(app)).post(`/api/factures/${f}/payer`).set("Cookie", a.cookie).expect(200);

    const { rows } = await adminPool.query(
      `SELECT coalesce(sum(montant_cents),0)::int AS total FROM paiements WHERE facture_id = $1`, [f],
    );
    // 400 000 + 600 000, et surtout pas 400 000 + 1 000 000.
    expect(rows[0].total).toBe(1_000_000);
  });
});

// ── c. Acompte sans facture ─────────────────────────────────────────────────

describe("c — acompte encaissé avant toute facture", () => {
  test("`factureId` nul, `affaireId` renseigné : accepté et visible", async () => {
    const aff = await affaire(a, "Carrelage Dupont");
    await request(serveurTest(app))
      .post("/api/paiements")
      .set("Cookie", a.cookie)
      .send({ affaireId: aff, montantCents: 250_000, nature: "ACOMPTE", moyen: "CHEQUE" })
      .expect(201);

    const { body } = await request(serveurTest(app))
      .get(`/api/affaires/${aff}/encaisse`)
      .set("Cookie", a.cookie)
      .expect(200);
    expect(body.encaisseCents).toBe(250_000);
  });

  test("un remboursement se retranche du total encaissé", async () => {
    const aff = await affaire(a, "Chantier remboursé");
    await request(serveurTest(app)).post("/api/paiements").set("Cookie", a.cookie)
      .send({ affaireId: aff, montantCents: 100_000 }).expect(201);
    await request(serveurTest(app)).post("/api/paiements").set("Cookie", a.cookie)
      .send({ affaireId: aff, montantCents: 30_000, sens: "REMBOURSEMENT" }).expect(201);

    const { body } = await request(serveurTest(app))
      .get(`/api/affaires/${aff}/encaisse`).set("Cookie", a.cookie).expect(200);
    expect(body.encaisseCents).toBe(70_000);
  });
});

// ── d. Le nom figé ──────────────────────────────────────────────────────────

describe("d — le texte est un instantané, `client_id` est le lien", () => {
  test("renommer la fiche ne réécrit pas une facture émise", async () => {
    const { body: client } = await request(serveurTest(app))
      .post("/api/clients").set("Cookie", a.cookie)
      .send({ nom: "Dupont SARL", type: "PRO" }).expect(201);

    const f = await factureEmise(a, 100_000, "Dupont SARL", client.id);

    await request(serveurTest(app))
      .patch(`/api/clients/${client.id}`).set("Cookie", a.cookie)
      .send({ nom: "Dupont & Fils" }).expect(200);

    const { rows } = await adminPool.query(
      `SELECT customer_name, client_id FROM factures WHERE id = $1`, [f],
    );
    // Le PDF archivé porte « Dupont SARL » : un écran qui afficherait
    // « Dupont & Fils » contredirait la preuve.
    expect(rows[0].customer_name).toBe("Dupont SARL");
    // Et le lien, lui, pointe bien sur la fiche renommée.
    expect(rows[0].client_id).toBe(client.id);

    const { body: fiche } = await request(serveurTest(app))
      .get(`/api/clients/${client.id}`).set("Cookie", a.cookie).expect(200);
    expect(fiche.nom).toBe("Dupont & Fils");
  });

  test("la recherche ignore accents et casse", async () => {
    await request(serveurTest(app)).post("/api/clients").set("Cookie", a.cookie)
      .send({ nom: "Génin Père et Fils" }).expect(201);
    const { body } = await request(serveurTest(app))
      .get("/api/clients/rechercher?q=GENIN").set("Cookie", a.cookie).expect(200);
    expect(body.clients.some((c: { nom: string }) => c.nom === "Génin Père et Fils")).toBe(true);
  });

  test("deux clients peuvent porter le même nom", async () => {
    await request(serveurTest(app)).post("/api/clients").set("Cookie", a.cookie).send({ nom: "Dupont" }).expect(201);
    await request(serveurTest(app)).post("/api/clients").set("Cookie", a.cookie).send({ nom: "Dupont" }).expect(201);
    const { body } = await request(serveurTest(app))
      .get("/api/clients/rechercher?q=dupont").set("Cookie", a.cookie).expect(200);
    expect(body.clients.filter((c: { nom: string }) => c.nom === "Dupont").length).toBeGreaterThanOrEqual(2);
  });
});

// ── e. Affectation ≠ pointage ───────────────────────────────────────────────

describe("e — une heure PRÉVUE n'entre dans aucune marge", () => {
  test("une affectation de 7 h/jour sur une semaine ne produit aucune heure de marge", async () => {
    const aff = await affaire(a, "Chantier planifié");
    const membre = await createTestTeamMember(a.tenantId, "Thomas");
    const lundi = toDateString(new Date());

    await request(serveurTest(app))
      .post("/api/affectations").set("Cookie", a.cookie)
      .send({
        affaireId: aff, membreId: membre.id,
        dateDebut: lundi, dateFin: lundi,
        heuresParJour: 7,
      })
      .expect(201);

    // AUCUN pointage n'a été confirmé : la marge ne doit voir aucune heure.
    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM pointages WHERE affaire_id = $1`, [aff],
    );
    expect(rows[0].n).toBe(0);

    const { body } = await request(serveurTest(app))
      .get(`/api/marge/${aff}`).set("Cookie", a.cookie);
    if (body && typeof body === "object" && "labourCents" in body) {
      expect(body.labourCents).toBe(0);
    }
  });

  test("le récapitulatif PROPOSE depuis l'affectation, sans rien écrire", async () => {
    const aff = await affaire(a, "Chantier proposé");
    const membre = await createTestTeamMember(a.tenantId, "Nicolas");
    // Un jour de semaine délibérément fixe : ce test n'éprouve pas la
    // sémantique week-end (voir le test dédié plus bas) et ne doit donc pas
    // dépendre de la date d'exécution — `joursOuvresSeulement` vaut `true`
    // par défaut, ce qui exclurait cette affectation un samedi/dimanche.
    const jour = prochainMardi();

    await request(serveurTest(app)).post("/api/affectations").set("Cookie", a.cookie)
      .send({ affaireId: aff, membreId: membre.id, dateDebut: jour, dateFin: jour, heuresParJour: 6 })
      .expect(201);

    const { body } = await request(serveurTest(app))
      .get(`/api/pointages/recapitulatif-semaine?date=${jour}`)
      .set("Cookie", a.cookie)
      .expect(200);

    const ligne = body.lignes?.find(
      (l: { membreId: string; affaireId: string }) => l.membreId === membre.id && l.affaireId === aff,
    );
    expect(ligne, "l'affectation doit apparaître dans la proposition").toBeDefined();
    expect(ligne.heures).toBe(6);
    expect(ligne.origine).toBe("propose");

    // Et rien n'a été écrit.
    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM pointages WHERE affaire_id = $1`, [aff],
    );
    expect(rows[0].n).toBe(0);
  });

  // Régression : bornesSemaine rend une semaine complète (lundi→dimanche),
  // mais la boucle qui construit la proposition ne parcourait que 5 jours
  // (JOURS_OUVRES) — une affectation posée pour le week-end (joursOuvresSeulement:
  // false, une INTENTION explicite portée par sa propre colonne dédiée,
  // jamais lue par cette route avant ce correctif) n'apparaissait donc JAMAIS
  // dans le récapitulatif, quelle que soit l'intention de qui l'avait créée.
  test("une affectation posée EXPLICITEMENT pour le week-end apparaît dans la proposition", async () => {
    const jourSamedi = prochainSamedi();
    const aff = await affaire(a, "Chantier week-end");
    const membre = await createTestTeamMember(a.tenantId, "Samia");

    await request(serveurTest(app)).post("/api/affectations").set("Cookie", a.cookie)
      .send({
        affaireId: aff, membreId: membre.id,
        dateDebut: jourSamedi, dateFin: jourSamedi, heuresParJour: 5,
        joursOuvresSeulement: false,
      })
      .expect(201);

    const { body } = await request(serveurTest(app))
      .get(`/api/pointages/recapitulatif-semaine?date=${jourSamedi}`)
      .set("Cookie", a.cookie)
      .expect(200);

    const ligne = body.lignes?.find(
      (l: { membreId: string; affaireId: string; date: string }) =>
        l.membreId === membre.id && l.affaireId === aff && l.date === jourSamedi,
    );
    expect(ligne, "l'affectation du samedi doit apparaître dans la proposition").toBeDefined();
    expect(ligne.heures).toBe(5);
    expect(ligne.origine).toBe("propose");
  });

  // Symétrique du test précédent : le défaut (joursOuvresSeulement: true,
  // non fourni) doit continuer à NE PAS proposer le week-end — la colonne
  // n'a de sens que si les deux valeurs se comportent différemment.
  test("une affectation en jours ouvrés par défaut n'apparaît PAS le week-end", async () => {
    const jourSamedi = prochainSamedi();
    const aff = await affaire(a, "Chantier semaine seulement");
    const membre = await createTestTeamMember(a.tenantId, "Karim");

    await request(serveurTest(app)).post("/api/affectations").set("Cookie", a.cookie)
      .send({ affaireId: aff, membreId: membre.id, dateDebut: jourSamedi, dateFin: jourSamedi, heuresParJour: 5 })
      .expect(201);

    const { body } = await request(serveurTest(app))
      .get(`/api/pointages/recapitulatif-semaine?date=${jourSamedi}`)
      .set("Cookie", a.cookie)
      .expect(200);

    const ligne = body.lignes?.find(
      (l: { membreId: string; affaireId: string; date: string }) =>
        l.membreId === membre.id && l.affaireId === aff && l.date === jourSamedi,
    );
    expect(ligne, "une affectation en jours ouvrés seulement ne doit rien proposer un samedi").toBeUndefined();
  });
});

// ── f. Bornes et dates métier ───────────────────────────────────────────────

describe("f — bornes de période, en dates métier", () => {
  test("`date_fin` avant `date_debut` → 400", async () => {
    const aff = await affaire(a);
    const membre = await createTestTeamMember(a.tenantId, "Borne");
    await request(serveurTest(app))
      .post("/api/affectations").set("Cookie", a.cookie)
      .send({
        affaireId: aff, membreId: membre.id,
        dateDebut: "2026-09-27", dateFin: "2026-08-27", heuresParJour: 7,
      })
      .expect(400);
  });

  test("un PATCH qui rendrait la période incohérente est refusé", async () => {
    const aff = await affaire(a);
    const membre = await createTestTeamMember(a.tenantId, "Patch");
    const { body: cree } = await request(serveurTest(app))
      .post("/api/affectations").set("Cookie", a.cookie)
      .send({
        affaireId: aff, membreId: membre.id,
        dateDebut: "2026-08-27", dateFin: "2026-09-27", heuresParJour: 7,
      })
      .expect(201);

    // Seule `dateFin` change : le contrôle doit porter sur la valeur FINALE.
    await request(serveurTest(app))
      .patch(`/api/affectations/${cree.id}`).set("Cookie", a.cookie)
      .send({ dateFin: "2026-08-01" })
      .expect(400);
  });

  test("les dates sont restituées telles quelles, sans décalage de fuseau", async () => {
    // Le test tourne sous UTC, Europe/Paris et Pacific/Auckland : une date
    // métier passée par `toISOString` reviendrait décalée d'un jour.
    const aff = await affaire(a);
    const membre = await createTestTeamMember(a.tenantId, "Fuseau");
    const { body } = await request(serveurTest(app))
      .post("/api/affectations").set("Cookie", a.cookie)
      .send({
        affaireId: aff, membreId: membre.id,
        dateDebut: "2026-08-27", dateFin: "2026-09-27", heuresParJour: 7,
      })
      .expect(201);
    expect(body.dateDebut).toBe("2026-08-27");
    expect(body.dateFin).toBe("2026-09-27");

    const { body: relu } = await request(serveurTest(app))
      .get(`/api/affectations/${body.id}`).set("Cookie", a.cookie).expect(200);
    expect(relu.dateDebut).toBe("2026-08-27");
    expect(relu.dateFin).toBe("2026-09-27");
  });

  test("une période est retenue si elle RECOUVRE la fenêtre, pas seulement si elle y commence", async () => {
    const aff = await affaire(a);
    const membre = await createTestTeamMember(a.tenantId, "Recouvrement");
    await request(serveurTest(app)).post("/api/affectations").set("Cookie", a.cookie)
      .send({
        affaireId: aff, membreId: membre.id,
        dateDebut: "2026-08-27", dateFin: "2026-09-27", heuresParJour: 7,
      }).expect(201);

    // Fenêtre entièrement à l'intérieur de l'affectation.
    const { body } = await request(serveurTest(app))
      .get("/api/affectations?debut=2026-09-01&fin=2026-09-07")
      .set("Cookie", a.cookie).expect(200);
    expect(body.affectations.some((x: { affaireId: string }) => x.affaireId === aff)).toBe(true);
  });

  test("une date de paiement non fournie prend le jour LOCAL", async () => {
    const aff = await affaire(a);
    const { body } = await request(serveurTest(app)).post("/api/paiements").set("Cookie", a.cookie)
      .send({ affaireId: aff, montantCents: 1000 }).expect(201);
    expect(body.paiement.date).toBe(toDateString(new Date()));
  });
});

// ── g. Isolation ────────────────────────────────────────────────────────────

describe("g — isolation, une table à la fois", () => {
  test("le tenant B ne voit pas les clients de A", async () => {
    await request(serveurTest(app)).post("/api/clients").set("Cookie", a.cookie)
      .send({ nom: "Client secret de A" }).expect(201);
    const { body } = await request(serveurTest(app)).get("/api/clients").set("Cookie", b.cookie).expect(200);
    expect(body.clients.some((c: { nom: string }) => c.nom === "Client secret de A")).toBe(false);
  });

  test("le tenant B ne voit pas les paiements de A", async () => {
    const f = await factureEmise(a, 100_000);
    await request(serveurTest(app)).post("/api/paiements").set("Cookie", a.cookie)
      .send({ factureId: f, montantCents: 50_000, reference: "REF-SECRETE-A" }).expect(201);
    const { body } = await request(serveurTest(app)).get("/api/paiements").set("Cookie", b.cookie).expect(200);
    expect(JSON.stringify(body)).not.toContain("REF-SECRETE-A");
  });

  test("le tenant B ne voit pas les affectations de A", async () => {
    const aff = await affaire(a, "Chantier confidentiel");
    const membre = await createTestTeamMember(a.tenantId, "Isolé");
    await request(serveurTest(app)).post("/api/affectations").set("Cookie", a.cookie)
      .send({
        affaireId: aff, membreId: membre.id,
        dateDebut: "2026-08-27", dateFin: "2026-08-28", heuresParJour: 7,
      }).expect(201);
    const { body } = await request(serveurTest(app)).get("/api/affectations").set("Cookie", b.cookie).expect(200);
    expect(body.affectations.some((x: { affaireId: string }) => x.affaireId === aff)).toBe(false);
  });

  test.each(["clients", "paiements", "affectations"])(
    "la policy de `%s` refuse la lecture depuis un autre tenant",
    async (table) => {
      // Sonde au niveau MOTEUR : c'est la policy qu'on éprouve, pas la route.
      const client = await adminPool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE app_user");
        await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [b.tenantId]);
        const { rows } = await client.query(
          `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1::uuid`,
          [a.tenantId],
        );
        expect(rows[0].n).toBe(0);
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    },
  );
});
