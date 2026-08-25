/**
 * Grille tarifaire (migration 065) — les promesses de la grille, prouvées.
 *
 * Tout tourne sur une vraie base : les limites d'utilisateurs, la bascule
 * essai → lecture seule (sans perte de données), le compteur vocal en
 * DOSSIERS (un impayé relancé = un dossier quel que soit le nombre de
 * tentatives, le 11e compté jamais coupé, reset au mois calendaire de
 * Paris, alerte à 80 % une seule fois — 4.43), le verrou de prix
 * Fondateurs (base seule, sièges facturés), la marge réservée à Équipe,
 * et les jalons d'essai (carte à J10 jamais avant, activation à J7).
 * L'isolation RLS des nouvelles tables est éprouvée par rls.test.ts.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import {
  adminPool,
  cookieHeader,
  createTestTenant,
  createTestUser,
  createTestMembership,
  createTestSession,
  cleanupTenants,
  cleanupUsers,
  serveurTest,
} from "./helpers";
import {
  etatAbonnement,
  abonnementCourant,
  constaterUsageVocal,
  constaterJalonsEssai,
} from "../lib/abonnement.js";

let tenantId: string;
let cookie: string;
const tenantIds: string[] = [];
const emails: string[] = [];

async function poserAbonnement(
  champs: Record<string, unknown>,
): Promise<void> {
  const colonnes = Object.keys(champs);
  const set = colonnes.map((c, i) => `${c} = $${i + 2}`).join(", ");
  await adminPool.query(
    `UPDATE subscriptions SET ${set} WHERE tenant_id = $1`,
    [tenantId, ...colonnes.map((c) => champs[c])],
  );
}

/** Une TENTATIVE d'appel démarrée sur un impayé donné, via le superutilisateur.
 *  La facture est la clé du DOSSIER : plusieurs tentatives sur la même
 *  facture ne doivent compter qu'un dossier (4.43 §1). */
async function insererTentative(quand: Date, factureId: string): Promise<void> {
  await adminPool.query(
    `WITH c AS (
       INSERT INTO campagnes_relance (id, tenant_id, pending_action_id, mandat)
       VALUES (gen_random_uuid()::text, $1, 'pa-tarif-test', '{}'::jsonb)
       RETURNING id
     )
     INSERT INTO appels_relance (id, tenant_id, campagne_id, facture_id, empreinte_numero, statut, started_at)
     SELECT gen_random_uuid()::text, $1, c.id, $3, 'tarif-test', 'TERMINE', $2 FROM c`,
    [tenantId, quand, factureId],
  );
}

beforeAll(async () => {
  const tenant = await createTestTenant("Tarification");
  tenantId = tenant.id;
  tenantIds.push(tenantId);

  const email = `tarif-owner-${Date.now()}@test.nodaq`;
  emails.push(email);
  const user = await createTestUser(email);
  await createTestMembership(user.id, tenantId, "OWNER");
  const session = await createTestSession(user.id, tenantId);
  cookie = cookieHeader(session.id);

  // Matérialise l'abonnement d'essai (le tenant de test est né après le
  // backfill de la migration : la première lecture le crée).
  const sub = await abonnementCourant(tenantId);
  expect(sub.statut).toBe("TRIAL");
}, 60_000);

afterAll(async () => {
  // La jauge Fondateurs est GLOBALE : on rend les places prises par le test,
  // sinon 50 exécutions de la suite fermeraient l'offre sur la base locale.
  await adminPool.query(
    `UPDATE fondateurs_compteur SET places_prises = greatest(0, places_prises - 1) WHERE id = 'global'`,
  );
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

describe("limites d'utilisateurs par plan", () => {
  test("Solo : aucune invitation, le refus nomme Équipe et l'écran Abonnement", async () => {
    await poserAbonnement({ plan_id: "solo", statut: "ACTIVE" });
    const res = await request(serveurTest(app))
      .post("/api/membres/inviter")
      .set("Cookie", cookie)
      .send({ email: `invite-solo-${Date.now()}@test.nodaq`, role: "MEMBER" })
      .expect(403);
    expect(res.body.error).toContain("Équipe");
    expect(res.body.error).toContain("Abonnement");
  });

  test("Solo : le comptable non plus — le rôle expert-comptable est un contenu d'Équipe", async () => {
    const res = await request(serveurTest(app))
      .post("/api/membres/inviter")
      .set("Cookie", cookie)
      .send({ email: `invite-compta-${Date.now()}@test.nodaq`, role: "ACCOUNTANT" })
      .expect(403);
    expect(res.body.error).toContain("Équipe");
  });

  test("Équipe : la 6e personne n'est PAS bloquée, le supplément est annoncé avant", async () => {
    await poserAbonnement({ plan_id: "equipe", statut: "ACTIVE" });
    // 5 utilisateurs actifs : le propriétaire + 4 membres.
    for (let i = 0; i < 4; i++) {
      const email = `tarif-m${i}-${Date.now()}@test.nodaq`;
      emails.push(email);
      const u = await createTestUser(email);
      await createTestMembership(u.id, tenantId, "MEMBER");
    }
    const res = await request(serveurTest(app))
      .post("/api/membres/inviter")
      .set("Cookie", cookie)
      .send({ email: `invite-6e-${Date.now()}@test.nodaq`, role: "MEMBER" })
      .expect(201);
    expect(res.body.supplementInvitation).toEqual({ prixMensuelCents: 1500 });
  });

  test("le comptable ne compte pas dans la limite : pas de supplément annoncé", async () => {
    const res = await request(serveurTest(app))
      .post("/api/membres/inviter")
      .set("Cookie", cookie)
      .send({ email: `invite-cab-${Date.now()}@test.nodaq`, role: "ACCOUNTANT" })
      .expect(201);
    expect(res.body.supplementInvitation).toBeNull();
  });
});

describe("essai échu → lecture seule, sans perte de données", () => {
  test("les écritures sont refusées, les données restent lisibles, souscrire rouvre", async () => {
    // Une donnée créée PENDANT l'essai actif.
    await poserAbonnement({
      plan_id: "equipe",
      statut: "TRIAL",
      trial_ends_at: new Date(Date.now() + 60_000),
    });
    const creation = await request(serveurTest(app))
      .post("/api/affaires")
      .set("Cookie", cookie)
      .send({ label: "Chantier d'essai" })
      .expect(201);
    const affaireId = creation.body.id as string;

    // L'essai échoit.
    await poserAbonnement({ trial_ends_at: new Date(Date.now() - 1000) });

    // Écrire est refusé, avec un message qui dit où reprendre la main…
    const refus = await request(serveurTest(app))
      .post("/api/affaires")
      .set("Cookie", cookie)
      .send({ label: "Refusé" })
      .expect(403);
    expect(refus.body.error).toContain("lecture seule");
    expect(refus.body.error).toContain("conservées");

    // …lire reste ouvert, et la donnée d'avant est intacte.
    const lecture = await request(serveurTest(app))
      .get("/api/affaires")
      .set("Cookie", cookie)
      .expect(200);
    const ids = (lecture.body.affaires as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toContain(affaireId);

    // Le statut a été constaté READONLY, sans tâche planifiée.
    const sub = await abonnementCourant(tenantId);
    expect(sub.statut).toBe("READONLY");

    // Souscrire est la porte de sortie : ce POST-là doit passer…
    await request(serveurTest(app))
      .post("/api/abonnement/formule")
      .set("Cookie", cookie)
      .send({ planId: "equipe" })
      .expect(200);

    // …et l'espace écrit à nouveau.
    await request(serveurTest(app))
      .post("/api/affaires")
      .set("Cookie", cookie)
      .send({ label: "Après souscription" })
      .expect(201);
  });
});

describe("compteur vocal — 10 dossiers inclus, le 11e compté, jamais coupé", () => {
  test("un dossier par impayé : trois tentatives sur la même facture font UN dossier", async () => {
    await poserAbonnement({
      statut: "ACTIVE",
      module_vocal: true,
      module_vocal_depuis: new Date(),
    });

    const maintenant = new Date();
    // Trois tentatives sur le MÊME impayé (injoignable, répondeur, rappel)…
    for (let i = 0; i < 3; i++) await insererTentative(maintenant, "facture-relancee-1");

    const etat = await etatAbonnement(tenantId);
    expect(etat.dossiers).not.toBeNull();
    expect(etat.dossiers!.utilises).toBe(1);
    expect(etat.dossiers!.inclus).toBe(10);
    expect(etat.dossiers!.depassement).toBe(0);
  });

  test("le 11e dossier est compté en dépassement (2 €), le mois précédent ne compte pas", async () => {
    // 10 impayés SUPPLÉMENTAIRES ce mois-ci (le 1er existe déjà) = 11 dossiers…
    const maintenant = new Date();
    for (let i = 2; i <= 11; i++) await insererTentative(maintenant, `facture-relancee-${i}`);
    // …et 3 dossiers le mois dernier, qui ne comptent pas : reset mensuel.
    const moisDernier = new Date(maintenant);
    moisDernier.setDate(1);
    moisDernier.setDate(0); // dernier jour du mois précédent
    moisDernier.setHours(10, 0, 0, 0);
    for (let i = 0; i < 3; i++) await insererTentative(moisDernier, `facture-vieille-${i}`);

    const etat = await etatAbonnement(tenantId);
    expect(etat.dossiers!.utilises).toBe(11);
    expect(etat.dossiers!.inclus).toBe(10);
    expect(etat.dossiers!.depassement).toBe(1);
    expect(etat.dossiers!.prixDepassementCents).toBe(200);
  });

  test("l'alerte des 80 % ne part qu'UNE fois, même constatée deux fois", async () => {
    // 11 ≥ 80 % de 10 : le franchissement est constatable. Deux constats…
    await constaterUsageVocal(tenantId);
    await constaterUsageVocal(tenantId);

    const { rows: franchissements } = await adminPool.query(
      `SELECT usage, seuil_pct FROM usage_franchissements WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(franchissements).toHaveLength(1);
    expect(franchissements[0]!.usage).toBe("vocal");
    expect(franchissements[0]!.seuil_pct).toBe(80);

    const { rows: annonces } = await adminPool.query(
      `SELECT count(*)::int AS n FROM activity WHERE tenant_id = $1 AND type = 'abonnement.usage_seuil'`,
      [tenantId],
    );
    expect(annonces[0]!.n).toBe(1);
  });

  test("module inactif : lancer un appel de campagne est refusé avec le chemin d'activation", async () => {
    await poserAbonnement({ module_vocal: false });
    const res = await request(serveurTest(app))
      .post("/api/relance/campagnes/n-importe/appels")
      .set("Cookie", cookie)
      .send({ factureId: "f-1", numero: "+33600000000" })
      .expect(403);
    expect(res.body.module).toBe("relance_vocale_inactif");
    expect(res.body.error).toContain("Réglages → Abonnement");
    await poserAbonnement({ module_vocal: true });
  });
});

describe("offre Fondateurs — 50 places, prix verrouillé à vie", () => {
  test("souscrire pose price_locked_at et prend une place", async () => {
    const { rows: avant } = await adminPool.query(
      `SELECT places_prises FROM fondateurs_compteur WHERE id = 'global'`,
    );
    const res = await request(serveurTest(app))
      .post("/api/abonnement/formule")
      .set("Cookie", cookie)
      .send({ planId: "fondateurs" })
      .expect(200);
    expect(res.body.subscription.priceLockedAt).toBeTruthy();
    expect(res.body.plan.id).toBe("fondateurs");
    expect(res.body.plan.prixMensuelCents).toBe(2900);

    const { rows: apres } = await adminPool.query(
      `SELECT places_prises FROM fondateurs_compteur WHERE id = 'global'`,
    );
    expect(apres[0]!.places_prises).toBe(avant[0]!.places_prises + 1);
  });

  test("le verrou survit aux changements : quitter Fondateurs exige une confirmation explicite", async () => {
    const res = await request(serveurTest(app))
      .post("/api/abonnement/formule")
      .set("Cookie", cookie)
      .send({ planId: "equipe" })
      .expect(409);
    expect(res.body.confirmationRequise).toBe("confirmeAbandonFondateurs");

    // Sans quitter, le prix reste celui du verrou.
    const etat = await etatAbonnement(tenantId);
    expect(etat.plan.prixMensuelCents).toBe(2900);
    expect(etat.subscription.priceLockedAt).toBeTruthy();
  });

  test("la 51e place n'existe pas : l'offre pleine refuse, atomiquement", async () => {
    const { rows: sauvegarde } = await adminPool.query(
      `SELECT places_prises, places_totales FROM fondateurs_compteur WHERE id = 'global'`,
    );
    await adminPool.query(
      `UPDATE fondateurs_compteur SET places_prises = places_totales WHERE id = 'global'`,
    );
    try {
      // Un second tenant candidate alors que tout est pris.
      const t2 = await createTestTenant("Tarification-51e");
      tenantIds.push(t2.id);
      const email2 = `tarif-51-${Date.now()}@test.nodaq`;
      emails.push(email2);
      const u2 = await createTestUser(email2);
      await createTestMembership(u2.id, t2.id, "OWNER");
      const s2 = await createTestSession(u2.id, t2.id);

      const res = await request(serveurTest(app))
        .post("/api/abonnement/formule")
        .set("Cookie", cookieHeader(s2.id))
        .send({ planId: "fondateurs" })
        .expect(409);
      expect(res.body.error).toContain("50 places");
    } finally {
      await adminPool.query(
        `UPDATE fondateurs_compteur SET places_prises = $1 WHERE id = 'global'`,
        [sauvegarde[0]!.places_prises],
      );
    }
  });
});

describe("retour de formule à l'échéance", () => {
  test("revenir à moins cher ne s'applique pas tout de suite, puis s'applique tout seul", async () => {
    // Depuis Fondateurs (souscrit plus haut), retour vers Solo confirmé.
    const res = await request(serveurTest(app))
      .post("/api/abonnement/formule")
      .set("Cookie", cookie)
      .send({ planId: "solo", confirmeAbandonFondateurs: true })
      .expect(200);
    expect(res.body.effet).toBe("a_l_echeance");
    expect(res.body.subscription.planSuivant).toBe("solo");
    // Rien n'a changé aujourd'hui.
    expect(res.body.plan.id).toBe("fondateurs");

    // L'échéance passe (posée dans le passé par le superutilisateur)…
    await poserAbonnement({ echeance: new Date(Date.now() - 1000) });
    // …et la lecture suivante applique le retour, paresseusement.
    const sub = await abonnementCourant(tenantId);
    expect(sub.planId).toBe("solo");
    expect(sub.planSuivant).toBeNull();
  });
});

describe("4.43 §3 — la marge par chantier est un contenu d'Équipe", () => {
  test("en Solo : verrouillée avec un état explicite, jamais un écran mort", async () => {
    // Le tenant est en Solo ACTIVE depuis le test précédent.
    const res = await request(serveurTest(app))
      .get("/api/marge")
      .set("Cookie", cookie)
      .expect(403);
    expect(res.body.formule).toBe("equipe_requise");
    expect(res.body.error).toContain("Équipe");
    expect(res.body.error).toContain("Abonnement");
  });

  test("en Équipe (et donc en essai, qui en a les limites) : ouverte", async () => {
    await poserAbonnement({ plan_id: "equipe" });
    await request(serveurTest(app)).get("/api/marge").set("Cookie", cookie).expect(200);
  });
});

describe("4.43 §4 — Fondateurs : seul le prix de BASE est verrouillé", () => {
  test("le 6e siège est annoncé et facturé, même en Fondateurs", async () => {
    // Le tenant compte déjà 6 actifs (owner + 4 membres + le 6e invité
    // n'ayant pas accepté, 5 actifs) — on force Fondateurs et on invite.
    await poserAbonnement({
      plan_id: "fondateurs",
      statut: "ACTIVE",
      price_locked_at: new Date(),
    });
    const res = await request(serveurTest(app))
      .post("/api/membres/inviter")
      .set("Cookie", cookie)
      .send({ email: `invite-fond-6e-${Date.now()}@test.nodaq`, role: "MEMBER" })
      .expect(201);
    expect(res.body.supplementInvitation).toEqual({ prixMensuelCents: 1500 });

    // Le verrou du prix de base n'a pas bougé.
    const etat = await etatAbonnement(tenantId);
    expect(etat.plan.prixMensuelCents).toBe(2900);
    expect(etat.subscription.priceLockedAt).toBeTruthy();
  });
});

describe("4.43 §5 — jalons d'essai : carte à J10, activation à J7, une seule fois", () => {
  test("J10 : le jalon carte se pose une fois, l'annonce est un message de continuité", async () => {
    // Jour 10 de l'essai = 4 jours restants.
    await poserAbonnement({
      plan_id: "equipe",
      statut: "TRIAL",
      trial_ends_at: new Date(Date.now() + 4 * 86_400_000),
    });
    await constaterJalonsEssai(tenantId);
    await constaterJalonsEssai(tenantId);

    const { rows: jalons } = await adminPool.query(
      `SELECT jalon FROM essai_jalons WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(jalons.map((j) => j.jalon)).toEqual(["J10_CARTE"]);

    const { rows: annonces } = await adminPool.query(
      `SELECT count(*)::int AS n FROM activity WHERE tenant_id = $1 AND type = 'abonnement.essai_carte'`,
      [tenantId],
    );
    expect(annonces[0]!.n).toBe(1);
  });

  test("avant J10, la carte n'est jamais demandée ; à J7 sans action validée, l'activation part", async () => {
    // Remise à zéro des jalons (adminPool : la table est append-only pour
    // app_user seulement) et jour 7 de l'essai = 7 jours restants.
    await adminPool.query(`DELETE FROM essai_jalons WHERE tenant_id = $1`, [tenantId]);
    await poserAbonnement({ trial_ends_at: new Date(Date.now() + 7 * 86_400_000) });

    await constaterJalonsEssai(tenantId);
    const { rows: jalons } = await adminPool.query(
      `SELECT jalon FROM essai_jalons WHERE tenant_id = $1`,
      [tenantId],
    );
    // J7 posé, et surtout PAS de J10 : la carte ne se demande pas avant.
    expect(jalons.map((j) => j.jalon)).toEqual(["J7_ACTIVATION"]);
  });

  test("à J7 avec une action déjà validée, aucun e-mail d'activation", async () => {
    await adminPool.query(`DELETE FROM essai_jalons WHERE tenant_id = $1`, [tenantId]);
    // Une décision APPROUVEE dans le journal : ce tenant relance déjà.
    await adminPool.query(
      `INSERT INTO journal_decisions (id, tenant_id, action_id, action_type, action_label, decision)
       VALUES (gen_random_uuid()::text, $1, 'act-jalon-test', 'PLAN_VOCAL', 'test', 'APPROUVEE')`,
      [tenantId],
    );
    await constaterJalonsEssai(tenantId);
    const { rows: jalons } = await adminPool.query(
      `SELECT count(*)::int AS n FROM essai_jalons WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(jalons[0]!.n).toBe(0);
    // L'abonnement retrouve son état actif pour ne rien laisser derrière.
    await poserAbonnement({ statut: "ACTIVE", trial_ends_at: null });
  });
});
