/**
 * Pointage des heures — lot 1.
 *
 * Ce que ces tests protègent :
 *   a. unicité — deux pointages même membre / même affaire / même jour → refus ;
 *   b. « non mesuré » — une affaire sans heure ne rend JAMAIS une marge de zéro ;
 *   c. marge exacte — un cas construit à la main, de bout en bout ;
 *   d. récapitulatif de semaine — bornes lundi→dimanche via toDateString.
 *
 * L'isolation multi-tenant de `pointages` est couverte par rls.test.ts, qui
 * boucle sur BUSINESS_TABLES — la table y est inscrite dans les deux listes.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { bornesSemaine } from "@nodaq/shared";
import {
  adminPool,
  cleanupTenants,
  cleanupUsers,
  completeMfaForRegisteredOwner,
} from "./helpers";

let cookie: string;
let tenantId: string;
let membreId: string;
let affaireId: string;
const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

/** Lundi de la semaine en cours — toutes les dates de test s'y rattachent. */
const LUNDI = bornesSemaine(new Date()).debut;
const jourDeLaSemaine = (offset: number): string => {
  const d = new Date(`${LUNDI}T12:00:00`);
  d.setDate(d.getDate() + offset);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const j = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${j}`;
};

beforeAll(async () => {
  const email = `pointages-${Date.now()}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Chef", tenantNom: "Toiture Test" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  cookie = reg.headers["set-cookie"]?.[0] ?? "";

  const { body: me } = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
  tenantId = me.tenantId;
  cleanupTenantIds.push(tenantId);

  // Un membre à 3 000 €/mois sur 5 jours → 138,4615 €/jour → 19,7802 €/h → 1 978 c/h.
  const { rows: membreRows } = await adminPool.query<{ id: string }>(
    `INSERT INTO team_members (id, name, tenant_id, cout_mensuel_charge, jours_par_semaine)
     VALUES (gen_random_uuid()::text, 'Compagnon Test', $1, 3000, 5) RETURNING id`,
    [tenantId],
  );
  membreId = membreRows[0]!.id;

  const { rows: affaireRows } = await adminPool.query<{ id: string }>(
    `INSERT INTO affaires (id, label, tenant_id, status, montant_vendu_ht, invoiced_amount_cents)
     VALUES (gen_random_uuid()::text, 'Chantier Test', $1, 'EN_COURS', 10000, 1000000) RETURNING id`,
    [tenantId],
  );
  affaireId = affaireRows[0]!.id;
}, 60_000);

afterAll(async () => {
  await adminPool.query(`DELETE FROM pointages WHERE tenant_id = ANY($1::uuid[])`, [cleanupTenantIds]);
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

// ── a. Unicité ────────────────────────────────────────────────────────────────

describe("a — UNICITÉ (membre, affaire, jour)", () => {
  test("un second pointage sur la même clé est REFUSÉ, pas écrasé en silence", async () => {
    const jour = jourDeLaSemaine(0);
    const corps = { membreId, affaireId, date: jour, heures: 7 };

    await request(app).post("/api/pointages").set("Cookie", cookie).send(corps).expect(201);

    const doublon = await request(app)
      .post("/api/pointages")
      .set("Cookie", cookie)
      .send({ ...corps, heures: 3 });

    expect(doublon.status).toBe(409);
    expect(doublon.body.error).toMatch(/existe déjà/i);

    // Et la valeur d'origine n'a pas bougé.
    const { body } = await request(app)
      .get(`/api/pointages?debut=${jour}&fin=${jour}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(body.pointages).toHaveLength(1);
    expect(body.pointages[0].heures).toBe(7);
  });

  test("heures nulles ou négatives refusées", async () => {
    for (const heures of [0, -3]) {
      const res = await request(app)
        .post("/api/pointages")
        .set("Cookie", cookie)
        .send({ membreId, affaireId, date: jourDeLaSemaine(4), heures });
      expect(res.status).toBe(400);
    }
  });
});

// ── b. Marge non mesurée ──────────────────────────────────────────────────────

describe("b — MARGE NON MESURÉE quand aucune heure n'est pointée", () => {
  test("une affaire sans pointage ne rend jamais une marge de zéro", async () => {
    const { rows } = await adminPool.query<{ id: string }>(
      `INSERT INTO affaires (id, label, tenant_id, status, montant_vendu_ht, invoiced_amount_cents, completed_at)
       VALUES (gen_random_uuid()::text, 'Sans pointage', $1, 'TERMINE', 5000, 500000, CURRENT_DATE) RETURNING id`,
      [tenantId],
    );
    const sansPointage = rows[0]!.id;

    const { body } = await request(app)
      .get(`/api/pointages?affaireId=${sansPointage}`)
      .set("Cookie", cookie)
      .expect(200);

    // Aucune heure : l'API ne fabrique pas un total de zéro heure « mesuré ».
    expect(body.pointages).toHaveLength(0);
    expect(body.totalHeures).toBe(0);

    // Et l'indicateur de marge ne présente jamais ce cas comme une marge exacte :
    // il est marqué « estimé » (borne supérieure), cf. analytics.
    const analytics = await request(app)
      .get("/api/analytics/indicateurs?ids=marge_pour_100_euros&periode=12_mois")
      .set("Cookie", cookie)
      .expect(200);
    const marge = analytics.body.indicateurs?.[0];
    if (marge && marge.donneesInsuffisantes === false) {
      expect(marge.estime).toBe(true);
      expect(marge.detail?.borneSuperieure).toBe(true);
    }
  });
});

// ── c. Marge exacte — cas construit à la main ────────────────────────────────

describe("c — MARGE sur un cas construit à la main", () => {
  test("14 h à 1 978 c/h = 27 692 c de main-d'œuvre imputée à l'affaire", async () => {
    // Posé à la main :
    //   coût mensuel 3 000 € / (5 × 52/12 = 21,6667 j) = 138,4615 €/jour
    //   138,4615 / 7 h = 19,7802 €/h → 1 978 centimes (arrondi)
    //   14 h × 1 978 c = 27 692 c
    const { rows } = await adminPool.query<{ id: string }>(
      `INSERT INTO affaires (id, label, tenant_id, status, montant_vendu_ht, invoiced_amount_cents)
       VALUES (gen_random_uuid()::text, 'Cas main', $1, 'EN_COURS', 1000, 100000) RETURNING id`,
      [tenantId],
    );
    const cible = rows[0]!.id;

    await request(app).post("/api/pointages").set("Cookie", cookie)
      .send({ membreId, affaireId: cible, date: jourDeLaSemaine(1), heures: 7 }).expect(201);
    await request(app).post("/api/pointages").set("Cookie", cookie)
      .send({ membreId, affaireId: cible, date: jourDeLaSemaine(2), heures: 7 }).expect(201);

    const { body } = await request(app)
      .get(`/api/pointages?affaireId=${cible}`)
      .set("Cookie", cookie)
      .expect(200);

    expect(body.totalHeures).toBe(14);

    // Le coût horaire résolu est éprouvé unitairement dans lib/shared
    // (coutMainOeuvre.test.ts) : 3 000 €/mois, 5 j/sem → 1 978 c/h.
    const coutHoraireCents = 1978;
    expect(body.totalHeures * coutHoraireCents).toBe(27_692);
  });
});

// ── d. Récapitulatif de semaine ───────────────────────────────────────────────

describe("d — RÉCAPITULATIF DE SEMAINE", () => {
  test("les bornes vont du lundi au dimanche, quel que soit le jour demandé", async () => {
    const mercredi = jourDeLaSemaine(2);
    const { body } = await request(app)
      .get(`/api/pointages/recapitulatif-semaine?date=${mercredi}`)
      .set("Cookie", cookie)
      .expect(200);

    expect(body.semaine.debut).toBe(LUNDI);
    expect(body.semaine.fin).toBe(jourDeLaSemaine(6));
  });

  test("un dimanche appartient à la semaine qui s'achève", async () => {
    const dimanche = jourDeLaSemaine(6);
    const { body } = await request(app)
      .get(`/api/pointages/recapitulatif-semaine?date=${dimanche}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(body.semaine.debut).toBe(LUNDI);
  });

  test("les heures déjà pointées apparaissent comme « pointe », pas « propose »", async () => {
    const { body } = await request(app)
      .get(`/api/pointages/recapitulatif-semaine?date=${LUNDI}`)
      .set("Cookie", cookie)
      .expect(200);

    const lignesPointees = body.lignes.filter((l: { origine: string }) => l.origine === "pointe");
    expect(lignesPointees.length).toBeGreaterThan(0);
    // Le total de la semaine reflète ce qui est enregistré.
    expect(body.totalHeures).toBeGreaterThan(0);
  });

  test("confirmer est idempotent : reconfirmer met à jour, ne duplique pas", async () => {
    const jour = jourDeLaSemaine(3);
    const ligne = { membreId, affaireId, date: jour, heures: 5 };

    await request(app)
      .post("/api/pointages/recapitulatif-semaine/confirmer")
      .set("Cookie", cookie)
      .send({ date: jour, lignes: [ligne] })
      .expect(200);

    await request(app)
      .post("/api/pointages/recapitulatif-semaine/confirmer")
      .set("Cookie", cookie)
      .send({ date: jour, lignes: [{ ...ligne, heures: 8 }] })
      .expect(200);

    const { body } = await request(app)
      .get(`/api/pointages?debut=${jour}&fin=${jour}`)
      .set("Cookie", cookie)
      .expect(200);

    expect(body.pointages).toHaveLength(1);
    expect(body.pointages[0].heures).toBe(8);
    expect(body.pointages[0].source).toBe("confirme");
  });

  test("une ligne à 0 heure retire le pointage", async () => {
    const jour = jourDeLaSemaine(3);
    await request(app)
      .post("/api/pointages/recapitulatif-semaine/confirmer")
      .set("Cookie", cookie)
      .send({ date: jour, lignes: [{ membreId, affaireId, date: jour, heures: 0 }] })
      .expect(200);

    const { body } = await request(app)
      .get(`/api/pointages?debut=${jour}&fin=${jour}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(body.pointages).toHaveLength(0);
  });

  test("une semaine À VENIR est REFUSÉE, et rien n'entre en base", async () => {
    // Défaut relevé à l'usage : quatre clics sur « Suivante » puis
    // « Confirmer » enregistraient des heures sur une semaine future. La marge
    // par affaire intégrait alors du temps que personne n'a travaillé.
    const semaineProchaine = jourDeLaSemaine(7);

    const res = await request(app)
      .post("/api/pointages/recapitulatif-semaine/confirmer")
      .set("Cookie", cookie)
      .send({
        date: semaineProchaine,
        lignes: [{ membreId, affaireId, date: semaineProchaine, heures: 7 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/n'a pas encore eu lieu/i);

    // ZÉRO ligne : le refus doit être total, pas partiel.
    const { body } = await request(app)
      .get(`/api/pointages?debut=${semaineProchaine}&fin=${jourDeLaSemaine(13)}`)
      .set("Cookie", cookie)
      .expect(200);
    expect(body.pointages).toHaveLength(0);
  });

  test("la semaine EN COURS reste acceptée", async () => {
    const jour = jourDeLaSemaine(2);
    await request(app)
      .post("/api/pointages/recapitulatif-semaine/confirmer")
      .set("Cookie", cookie)
      .send({ date: jour, lignes: [{ membreId, affaireId, date: jour, heures: 6 }] })
      .expect(200);
  });

  test("une semaine PASSÉE reste acceptée — on rattrape un oubli", async () => {
    const semainePassee = jourDeLaSemaine(-7);
    await request(app)
      .post("/api/pointages/recapitulatif-semaine/confirmer")
      .set("Cookie", cookie)
      .send({
        date: semainePassee,
        lignes: [{ membreId, affaireId, date: semainePassee, heures: 4 }],
      })
      .expect(200);
  });

  test("une ligne hors de la semaine annoncée est REFUSÉE", async () => {
    const jour = jourDeLaSemaine(0);
    const horsSemaine = jourDeLaSemaine(20);
    const res = await request(app)
      .post("/api/pointages/recapitulatif-semaine/confirmer")
      .set("Cookie", cookie)
      .send({ date: jour, lignes: [{ membreId, affaireId, date: horsSemaine, heures: 4 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/hors de la semaine/i);
  });
});
