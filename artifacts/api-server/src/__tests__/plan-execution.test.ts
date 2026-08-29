/**
 * L'EXÉCUTION d'un plan validé — ce qui reste quand l'extracteur s'en va.
 *
 * ── POURQUOI CE FICHIER EXISTE ────────────────────────────────────────────
 * Ces garanties étaient éprouvées à travers `POST /voix/interpreter`, la
 * route de l'ancien extracteur d'intentions. Elle a été retirée : le micro
 * parle désormais à l'agent de discussion, qui a la mémoire et les outils.
 *
 * Mais `/voix/executer` et le magasin de plans, eux, sont bien VIVANTS — c'est
 * ce couple qui tient la règle 4 du dépôt : aucune écriture agentique ne
 * s'applique sans validation humaine. Supprimer les anciens tests sans
 * reporter ces garanties aurait retiré les gardes en même temps que le code
 * mort, et personne n'aurait vu la régression.
 *
 * Les plans sont donc posés ICI par `enregistrerPlan`, directement — le même
 * appel que fait la route de discussion. Aucun modèle n'intervient : ce
 * fichier teste l'exécution, pas l'interprétation.
 *
 * Ce qu'il protège :
 *   a. tout ou rien — une opération qui échoue en annule trois ;
 *   b. rejeu — deux exécutions du même plan n'écrivent qu'une fois ;
 *   c. expiration — un plan périmé est refusé en 410 ;
 *   d. isolation — un plan de A n'est ni lisible ni exécutable par B ;
 *   e. cible disparue entre la proposition et la validation → 409, zéro
 *      ligne orpheline ;
 *   f. c'est la CORRECTION saisie à l'écran qui est écrite, pas la dictée ;
 *   g. les écritures PAR TYPE aboutissent vraiment — client, absence. Ces
 *      allers-retours vivaient dans `voix-equipe.test.ts` : les perdre avec
 *      l'extracteur aurait retiré la preuve que chaque type d'opération écrit
 *      la bonne ligne, alors que `executerPlan` les traite toujours.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, completeMfaForRegisteredOwner, serveurTest } from "./helpers";
import { enregistrerPlan, type OperationPlanifiee } from "../lib/plan-vocal.js";

interface Locataire { cookie: string; tenantId: string }

const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

let a: Locataire;
let b: Locataire;

async function inscrire(nom: string): Promise<Locataire> {
  const email = `plan-${nom}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  cleanupEmails.push(email);
  const reg = await request(serveurTest(app)).post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: `Patron ${nom}`, tenantNom: `Tenant ${nom}` })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  const cookie = reg.headers["set-cookie"]?.[0] ?? "";
  const { body: me } = await request(serveurTest(app)).get("/api/auth/me").set("Cookie", cookie).expect(200);
  cleanupTenantIds.push(me.tenantId);
  return { cookie, tenantId: me.tenantId };
}

/** Une opération d'affaire, la plus simple qui écrive vraiment. */
const creerAffaire = (label: string): OperationPlanifiee => ({
  type: "creer_affaire",
  libelle: `Créer l'affaire « ${label} »`,
  champs: { label },
  certitude: "aucune_resolution",
  aCompleter: [],
});

/** Pose un plan comme le fait la route de discussion, sans modèle. */
const poser = (l: Locataire, operations: OperationPlanifiee[]) =>
  enregistrerPlan(l.tenantId, { operations, questions: [], nonCompris: [] });

const executer = (l: Locataire, planId: string, corrections?: unknown) =>
  request(serveurTest(app)).post("/api/voix/executer").set("Cookie", l.cookie)
    .send({ planId, ...(corrections ? { corrections } : {}) });

const compterAffaires = async (l: Locataire, label: string): Promise<number> => {
  const { rows } = await adminPool.query(
    `SELECT count(*)::int AS n FROM affaires WHERE tenant_id = $1::uuid AND label = $2`,
    [l.tenantId, label],
  );
  return rows[0].n as number;
};

beforeAll(async () => {
  a = await inscrire("a");
  b = await inscrire("b");
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

describe("a — tout ou rien", () => {
  /*
   * Une opération qui échoue doit en annuler trois. Sans transaction, un plan
   * à moitié appliqué laisserait l'artisan avec des données qu'il n'a pas
   * validées et dont il ignore l'existence.
   */
  test("un plan de trois opérations dont une échoue n'en écrit aucune", async () => {
    const planId = await poser(a, [
      creerAffaire("Tout-ou-rien 1"),
      // `affaireId` inexistant : l'écriture échouera au moment de l'appliquer.
      {
        type: "creer_echeance",
        libelle: "Échéance orpheline",
        champs: { label: "Orpheline", affaireId: crypto.randomUUID(), dueDate: "2026-12-01" },
        certitude: "aucune_resolution",
        aCompleter: [],
      },
      creerAffaire("Tout-ou-rien 3"),
    ]);

    await executer(a, planId).expect((r) => {
      expect(r.status, "une opération impossible doit faire échouer le plan").toBeGreaterThanOrEqual(400);
    });

    expect(await compterAffaires(a, "Tout-ou-rien 1")).toBe(0);
    expect(await compterAffaires(a, "Tout-ou-rien 3")).toBe(0);
  });
});

describe("b — rejouer un plan n'écrit pas deux fois", () => {
  test("deux exécutions → une seule écriture", async () => {
    const planId = await poser(a, [creerAffaire("Rejeu Dupont")]);

    await executer(a, planId).expect(200);
    await executer(a, planId);          // le second appel, quel que soit son code

    expect(await compterAffaires(a, "Rejeu Dupont")).toBe(1);
  });

  /*
   * Les plans vivent une heure. Passé ce délai, l'utilisateur ne se souvient
   * plus de ce qu'il a dicté : appliquer serait écrire à l'aveugle.
   */
  test("un plan expiré est refusé en 410", async () => {
    const planId = await poser(a, [creerAffaire("Périmé")]);
    await adminPool.query(
      `UPDATE pending_actions SET expire_le = NOW() - interval '1 minute' WHERE id = $1`,
      [planId],
    );

    await executer(a, planId).expect(410);
    expect(await compterAffaires(a, "Périmé")).toBe(0);
  });
});

describe("c — un plan appartient à son tenant", () => {
  /*
   * Vérifié sur le CORPS autant que sur le code : un 200 qui rendrait le
   * libellé du plan d'un autre locataire serait déjà une fuite, même sans
   * écriture.
   */
  test("le tenant B ne peut ni lire ni exécuter le plan de A", async () => {
    const planId = await poser(a, [creerAffaire("Secret de A")]);

    const res = await executer(b, planId);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).not.toContain("Secret de A");

    expect(await compterAffaires(a, "Secret de A")).toBe(0);
    expect(await compterAffaires(b, "Secret de A")).toBe(0);
  });
});

describe("d — la cible a disparu entre la proposition et la validation", () => {
  /*
   * Le monde bouge entre le moment où l'agent propose et celui où l'humain
   * valide. Une cible supprimée entre-temps ne doit pas produire une ligne
   * orpheline rattachée à rien.
   */
  test("identifiant fantôme → refus, ZÉRO ligne orpheline", async () => {
    const fantome = crypto.randomUUID();
    const planId = await poser(a, [{
      type: "creer_echeance",
      libelle: "Échéance sur une affaire disparue",
      champs: { label: "Fantôme", affaireId: fantome, dueDate: "2026-12-01" },
      certitude: "aucune_resolution",
      aCompleter: [],
    }]);

    const res = await executer(a, planId);
    expect(res.status).toBeGreaterThanOrEqual(400);

    const { rows } = await adminPool.query(
      `SELECT count(*)::int AS n FROM echeances WHERE tenant_id = $1::uuid AND label = 'Fantôme'`,
      [a.tenantId],
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("e — l'humain corrige avant que ça s'écrive", () => {
  /*
   * « Menuiserie Delacroix » ressort en « Menuiserie de la Croix ». L'écran
   * permet de rectifier AVANT validation, et c'est la correction qui doit
   * être écrite — sinon le champ affiché mentirait sur ce qui va entrer en
   * base.
   */
  test("un nom mal entendu se corrige, et c'est la CORRECTION qui est écrite", async () => {
    const planId = await poser(a, [creerAffaire("Menuiserie de la Croix")]);

    await executer(a, planId, { 0: { label: "Menuiserie Delacroix" } }).expect(200);

    expect(await compterAffaires(a, "Menuiserie Delacroix")).toBe(1);
    expect(await compterAffaires(a, "Menuiserie de la Croix")).toBe(0);
  });
});


describe("g — chaque type d'écriture aboutit vraiment", () => {
  /*
   * Ces allers-retours étaient éprouvés à travers l'extracteur. Le chemin de
   * proposition a changé ; `executerPlan`, lui, traite toujours ces types.
   * La garde porte donc désormais sur l'ÉCRITURE, sans passer par un modèle.
   */
  test("creer_client → une fiche réelle en base", async () => {
    const planId = await poser(a, [{
      type: "creer_client",
      libelle: "Créer la fiche client « Martin »",
      champs: { nom: "Martin Toiture", ville: "Rouen", email: null, telephone: null },
      certitude: "aucune_resolution",
      aCompleter: [],
    }]);

    await executer(a, planId).expect(200);

    const { rows } = await adminPool.query(
      `SELECT ville FROM clients WHERE tenant_id = $1::uuid AND nom = $2`,
      [a.tenantId, "Martin Toiture"],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].ville).toBe("Rouen");
  });

  test("declarer_absence → une ligne réelle, sur le bon membre", async () => {
    const membreId = crypto.randomUUID();
    await adminPool.query(
      `INSERT INTO team_members (id, tenant_id, name, role) VALUES ($1, $2::uuid, $3, 'OUVRIER')`,
      [membreId, a.tenantId, "Karim Absent"],
    );

    const planId = await poser(a, [{
      type: "declarer_absence",
      libelle: "Déclarer une absence (conges_payes)",
      champs: {
        membreId,
        typeAbsence: "conges_payes",
        dateDebut: "2026-09-07",
        dateFin: "2026-09-11",
        affaireId: null,
      },
      certitude: "exacte",
      aCompleter: [],
    }]);

    await executer(a, planId).expect(200);

    const { rows } = await adminPool.query(
      `SELECT date_debut, date_fin FROM absences WHERE tenant_id = $1::uuid AND membre_id = $2`,
      [a.tenantId, membreId],
    );
    expect(rows).toHaveLength(1);
  });
});
