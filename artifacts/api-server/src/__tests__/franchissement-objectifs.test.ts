/**
 * Franchissement d'objectif — la trace, et l'annonce.
 *
 * Ce que ces tests protègent :
 *   a. le franchissement est enregistré À L'ÉMISSION, avec le bon montant ;
 *   b. il n'est annoncé QU'UNE FOIS, même sur dix émissions ;
 *   c. un objectif que le cockpit ne SERT PAS n'est pas franchissable ;
 *   d. un avoir qui repasse sous le seuil n'EFFACE PAS le franchissement ;
 *   e. la bascule d'exercice ne rejoue pas celui de l'année précédente ;
 *   f. une évaluation qui échoue ne fait PAS échouer l'émission ;
 *   g. isolation : le franchissement d'un tenant n'apparaît pas chez un autre.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { toDateString, CLE_TAUX_MARGE, CLE_CHARGES_FIXES } from "@nodaq/shared";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner } from "./helpers";
import { evaluerFranchissements } from "../lib/franchissement-objectifs";

interface Locataire { cookie: string; tenantId: string }

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];
const anneeCourante = new Date().getFullYear();

async function inscrire(nom: string): Promise<Locataire> {
  const email = `franchi-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(app).post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: `Patron ${nom}`, tenantNom: `Tenant ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  const cookie = reg.headers["set-cookie"]?.[0] ?? "";
  const { body: me } = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
  cleanupTenantIds.push(me.tenantId);
  return { cookie, tenantId: me.tenantId };
}

async function reglage(tenantId: string, cle: string, valeur: string): Promise<void> {
  await adminPool.query(
    `INSERT INTO settings (tenant_id, key, value) VALUES ($1::uuid, $2, $3)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [tenantId, cle, valeur],
  );
}

/** Facture déjà ÉMISE, posée directement pour maîtriser le chiffre d'affaires. */
async function factureEmise(l: Locataire, montantCents: number, issuedDate: string): Promise<void> {
  await adminPool.query(
    `INSERT INTO factures (id, tenant_id, number, customer_name, amount_cents, residual_cents,
                           due_date, issued_date, statut, settled)
     VALUES (gen_random_uuid()::text, $1::uuid, $2, 'Client', $3, $3, $4, $4, 'EMISE', false)`,
    [l.tenantId, `F-${crypto.randomBytes(3).toString("hex")}`, montantCents, issuedDate],
  );
}

const franchissements = async (tenantId: string) =>
  (await adminPool.query(
    `SELECT objectif, exercice, montant_cents, franchi_le FROM objectifs_franchissements
      WHERE tenant_id = $1::uuid ORDER BY franchi_le`,
    [tenantId],
  )).rows;

beforeAll(async () => {}, 30_000);

afterAll(async () => {
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

// ── a & b. Enregistré une fois, avec le bon montant ─────────────────────────

describe("a — le seuil de rentabilité, franchi", () => {
  test("enregistré avec le montant ATTEINT, pas le seuil", async () => {
    const t = await inscrire("seuil");
    // 120 000 € de charges, 35 % de marge → seuil 342 857,14 €.
    await reglage(t.tenantId, CLE_CHARGES_FIXES, "12000000");
    await reglage(t.tenantId, CLE_TAUX_MARGE, "3500");

    await factureEmise(t, 40_000_000, toDateString(new Date()));
    const nouveaux = await evaluerFranchissements(t.tenantId);

    expect(nouveaux.map((f) => f.objectif)).toContain("seuil_rentabilite");
    const lignes = await franchissements(t.tenantId);
    const seuil = lignes.find((l) => l.objectif === "seuil_rentabilite");
    expect(seuil).toBeDefined();
    // Le montant conservé est celui qu'on avait atteint, pour pouvoir
    // expliquer la trace — jamais recalculé après coup.
    expect(seuil!.montant_cents).toBe(40_000_000);
    expect(seuil!.exercice).toBe(anneeCourante);
  });

  test("sous le seuil, rien n'est enregistré", async () => {
    const t = await inscrire("sous-seuil");
    await reglage(t.tenantId, CLE_CHARGES_FIXES, "12000000");
    await reglage(t.tenantId, CLE_TAUX_MARGE, "3500");
    await factureEmise(t, 1_000_000, toDateString(new Date()));

    expect(await evaluerFranchissements(t.tenantId)).toEqual([]);
    expect(await franchissements(t.tenantId)).toHaveLength(0);
  });
});

describe("b — annoncé UNE SEULE FOIS", () => {
  test("dix évaluations, une seule ligne et une seule annonce", async () => {
    // Annoncer deux fois le même franchissement est la façon la plus sûre de
    // ne plus être cru.
    const t = await inscrire("une-fois");
    await reglage(t.tenantId, CLE_CHARGES_FIXES, "12000000");
    await reglage(t.tenantId, CLE_TAUX_MARGE, "3500");
    await factureEmise(t, 40_000_000, toDateString(new Date()));

    const premier = await evaluerFranchissements(t.tenantId);
    expect(premier).toHaveLength(1);

    // L'espion est le cœur de ce test. Sans lui, il passait pour la MAUVAISE
    // raison : la violation d'unicité était levée puis avalée par le
    // `try/catch` du module, ce qui donnait bien une seule ligne — au prix
    // d'une erreur journalisée à CHAQUE émission suivante. Un exploitant
    // aurait vu son journal se remplir sans rien casser de visible.
    //
    // Découvert en retirant `onConflictDoNothing()` : le test restait vert.
    const erreurs = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (let i = 0; i < 9; i++) {
        expect(await evaluerFranchissements(t.tenantId)).toEqual([]);
      }
      expect(erreurs, "le rejeu doit être ABSORBÉ, pas rattrapé après coup")
        .not.toHaveBeenCalled();
    } finally {
      erreurs.mockRestore();
    }

    expect(await franchissements(t.tenantId)).toHaveLength(1);
    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM activity WHERE tenant_id = $1::uuid AND type = 'objectif_franchi'`,
      [t.tenantId],
    );
    expect(rows[0].n).toBe(1);
  });

  test("l'émission d'une facture rend les objectifs franchis PAR CETTE émission", async () => {
    const t = await inscrire("emission");
    await reglage(t.tenantId, CLE_CHARGES_FIXES, "12000000");
    await reglage(t.tenantId, CLE_TAUX_MARGE, "3500");
    // SIRET valide au sens de Luhn : l'audit des mentions obligatoires le
    // vérifie, et un SIRET fantaisiste fait échouer l'émission en 422.
    for (const cle of [
      ["company.nom", "Toiture Martin"], ["company.siret", "81234567600009"],
      ["company.adresse_rue", "12 rue X"], ["company.adresse_cp", "02120"],
      ["company.adresse_ville", "Marly"],
    ]) await reglage(t.tenantId, cle[0]!, cle[1]!);

    const { body: f } = await request(app).post("/api/factures").set("Cookie", t.cookie)
      .send({
        customerName: "Madame Bernard",
        issuedDate: toDateString(new Date()),
        dueDate: toDateString(new Date()),
        lines: [{ description: "Chantier", quantity: 1, unitPriceCents: 40_000_000, vatRate: 20, vatCategory: "S" }],
        attestationTvaFournie: true,
      })
      .expect(201);

    const emise = await request(app).post(`/api/factures/${f.id}/emettre`)
      .set("Cookie", t.cookie).send({}).expect(200);

    expect(emise.body.objectifsFranchis).toHaveLength(1);
    expect(emise.body.objectifsFranchis[0].objectif).toBe("seuil_rentabilite");
    expect(emise.body.objectifsFranchis[0].message).toMatch(/seuil de rentabilité/i);
  });
});

// ── c. On n'annonce que ce qui était affiché ────────────────────────────────

describe("c — un objectif que le cockpit ne SERT PAS n'est pas franchissable", () => {
  test("sans seuil paramétré, aucun franchissement de seuil", async () => {
    // Un seuil absent n'est pas un seuil à zéro : féliciter quelqu'un d'avoir
    // dépassé un objectif qu'il n'a jamais vu n'est pas une bonne nouvelle.
    const t = await inscrire("sans-seuil");
    await factureEmise(t, 99_000_000, toDateString(new Date()));
    const nouveaux = await evaluerFranchissements(t.tenantId);
    expect(nouveaux.map((f) => f.objectif)).not.toContain("seuil_rentabilite");
  });

  test("sans douze mois d'historique, aucun franchissement d'exercice précédent", async () => {
    const t = await inscrire("sans-historique");
    // Un exercice précédent NON NUL, mais dont la plus ancienne facture a
    // moins de douze mois : décembre dernier, pas juin. Avec juin, le test
    // passait pour la mauvaise raison — la condition des douze mois était
    // remplie, et c'est ce que la première version affirmait à tort.
    await factureEmise(t, 1_000_000, `${anneeCourante - 1}-12-20`);
    await factureEmise(t, 5_000_000, toDateString(new Date()));

    const nouveaux = await evaluerFranchissements(t.tenantId);
    expect(nouveaux.map((f) => f.objectif)).not.toContain("exercice_precedent");
  });

  test("avec douze mois d'historique, le dépassement est enregistré", async () => {
    const t = await inscrire("avec-historique");
    await factureEmise(t, 2_000_000, `${anneeCourante - 2}-01-10`);
    await factureEmise(t, 3_000_000, `${anneeCourante - 1}-03-10`);
    await factureEmise(t, 9_000_000, toDateString(new Date()));

    const nouveaux = await evaluerFranchissements(t.tenantId);
    expect(nouveaux.map((f) => f.objectif)).toContain("exercice_precedent");
  });
});

// ── d & e. La trace ne se défait pas ────────────────────────────────────────

describe("d — un avoir ne DÉFAIT pas un franchissement", () => {
  test("repasser sous le seuil laisse la trace intacte", async () => {
    // Le franchissement a EU LIEU. La table est append-only, et effacer
    // permettrait d'annoncer deux fois à la faveur d'un aller-retour.
    const t = await inscrire("avoir");
    await reglage(t.tenantId, CLE_CHARGES_FIXES, "12000000");
    await reglage(t.tenantId, CLE_TAUX_MARGE, "3500");
    await factureEmise(t, 40_000_000, toDateString(new Date()));
    await evaluerFranchissements(t.tenantId);

    const avant = await franchissements(t.tenantId);
    expect(avant).toHaveLength(1);

    // Un avoir qui annule presque tout.
    await adminPool.query(
      `INSERT INTO avoirs (id, tenant_id, numero, facture_ref_id, issued_date, montant_ht_cents, motif)
       VALUES (gen_random_uuid()::text, $1::uuid, 'AV-1', gen_random_uuid()::text, CURRENT_DATE, 39000000, 'annulation')`,
      [t.tenantId],
    );

    await evaluerFranchissements(t.tenantId);
    const apres = await franchissements(t.tenantId);
    expect(apres).toHaveLength(1);
    expect(apres[0].franchi_le).toEqual(avant[0].franchi_le);
  });

  test("la table refuse UPDATE et DELETE à app_user", async () => {
    const client = await adminPool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_user");
      await expect(
        client.query(`UPDATE objectifs_franchissements SET montant_cents = 0`),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  });
});

describe("e — la bascule d'exercice ne rejoue rien", () => {
  test("un franchissement de l'an dernier n'empêche pas celui de cette année", async () => {
    const t = await inscrire("bascule");
    await adminPool.query(
      `INSERT INTO objectifs_franchissements (id, tenant_id, objectif, exercice, montant_cents)
       VALUES (gen_random_uuid()::text, $1::uuid, 'seuil_rentabilite', $2, 1000000)`,
      [t.tenantId, anneeCourante - 1],
    );

    await reglage(t.tenantId, CLE_CHARGES_FIXES, "12000000");
    await reglage(t.tenantId, CLE_TAUX_MARGE, "3500");
    await factureEmise(t, 40_000_000, toDateString(new Date()));

    const nouveaux = await evaluerFranchissements(t.tenantId);
    expect(nouveaux.map((f) => f.objectif)).toContain("seuil_rentabilite");
    const lignes = await franchissements(t.tenantId);
    expect(lignes.map((l) => l.exercice).sort()).toEqual([anneeCourante - 1, anneeCourante]);
  });
});

// ── f. L'émission passe avant l'annonce ─────────────────────────────────────

describe("f — une évaluation qui échoue ne fait pas échouer l'émission", () => {
  test("`evaluerFranchissements` ne lève jamais", async () => {
    // Une facture émise est immuable et déjà écrite : l'annonce d'un objectif
    // ne vaut pas qu'on la remette en cause.
    const espion = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // Un tenant inexistant : toutes les requêtes échoueront.
      const r = await evaluerFranchissements("00000000-0000-4000-8000-000000000000");
      expect(r).toEqual([]);
    } finally {
      espion.mockRestore();
    }
  });
});

// ── g. Isolation ────────────────────────────────────────────────────────────

describe("g — isolation", () => {
  test("le franchissement d'un tenant n'apparaît pas chez un autre", async () => {
    const un = await inscrire("iso-1");
    const deux = await inscrire("iso-2");
    await reglage(un.tenantId, CLE_CHARGES_FIXES, "12000000");
    await reglage(un.tenantId, CLE_TAUX_MARGE, "3500");
    await factureEmise(un, 40_000_000, toDateString(new Date()));
    await evaluerFranchissements(un.tenantId);

    expect(await franchissements(deux.tenantId)).toHaveLength(0);

    const { body } = await request(app).get("/api/cockpit/objectifs")
      .set("Cookie", deux.cookie).expect(200);
    const seuil = body.objectifs.find((o: { id: string }) => o.id === "seuil_rentabilite");
    expect(seuil.dejaFranchi ?? false).toBe(false);
  });

  test("le cockpit expose QUAND l'objectif a été franchi", async () => {
    const t = await inscrire("date-franchissement");
    await reglage(t.tenantId, CLE_CHARGES_FIXES, "12000000");
    await reglage(t.tenantId, CLE_TAUX_MARGE, "3500");
    await factureEmise(t, 40_000_000, toDateString(new Date()));
    await evaluerFranchissements(t.tenantId);

    const { body } = await request(app).get("/api/cockpit/objectifs")
      .set("Cookie", t.cookie).expect(200);
    const seuil = body.objectifs.find((o: { id: string }) => o.id === "seuil_rentabilite");
    expect(seuil.dejaFranchi).toBe(true);
    // La DATE, pas seulement un booléen : « franchi » sans quand ne dit rien.
    expect(seuil.franchiLe).toBeTruthy();
  });
});
