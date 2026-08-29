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


/*
 * ── LA RELANCE TÉLÉPHONIQUE, DE BOUT EN BOUT ─────────────────────────────
 *
 * Constaté sur le déploiement le 29/08/2026 : valider « prépare les relances »
 * rendait un bandeau rouge — « Une des opérations n'a pas pu être appliquée »
 * — sans dire pourquoi.
 *
 * `proposerEcritureBrute` rendait `champs: {}` pour cet outil : `appels` était
 * TOUJOURS vide, et `executerPlan` levait systématiquement. Le calcul des
 * impayés joignables vivait dans l'extracteur d'intentions ; en le retirant,
 * on a laissé la capacité sans porteur.
 *
 * Ces gardes exercent le CÂBLAGE — `executeTool`, qui a la base — et non la
 * fonction pure. C'est la leçon du matin : une garde qui reçoit la donnée à la
 * main ne prouve pas que quelqu'un la lui donne.
 */
describe("f — la relance téléphonique passe par l'agent", () => {
  const demander = (l: Locataire) =>
    request(serveurTest(app)).post("/api/chat/messages").set("Cookie", l.cookie)
      .send({ content: "agent-test-relance" }).expect(200);

  test("sans facture en retard, l'agent RÉPOND au lieu de proposer l'impossible", async () => {
    const { body } = await demander(a);

    // Aucune opération : proposer une campagne vide serait une impasse
    // découverte au moment de cliquer.
    expect(body.operations ?? []).toHaveLength(0);
    expect(body.planId).toBeNull();
    expect(body.message.content).toMatch(/aucune facture en retard/i);
  });

  test("avec une facture en retard et un téléphone, la campagne porte ses appels", async () => {
    const clientId = crypto.randomUUID();
    await adminPool.query(
      `INSERT INTO clients (id, tenant_id, nom, telephone) VALUES ($1, $2::uuid, $3, $4)`,
      [clientId, a.tenantId, "Girard Retard", "0612345678"],
    );
    await adminPool.query(
      `INSERT INTO factures (id, tenant_id, number, customer_name, client_id, amount_cents,
                             issued_date, due_date, statut)
       VALUES ($1, $2::uuid, 'F-RETARD-1', 'Girard Retard', $3, 120000,
               CURRENT_DATE - 60, CURRENT_DATE - 30, 'EMISE')`,
      [crypto.randomUUID(), a.tenantId, clientId],
    );

    const { body } = await demander(a);

    expect(body.operations).toHaveLength(1);
    const appels = JSON.parse(body.operations[0].champs.appels);
    expect(appels).toHaveLength(1);
    expect(appels[0].numero).toBe("0612345678");
    expect(appels[0].montantCents).toBe(120000);
    // Le libellé annonce le nombre ET le montant : on valide ce qu'on voit.
    expect(body.operations[0].libelle).toMatch(/1 facture/);
    expect(body.operations[0].libelle).toMatch(/1200/);
  });

  /*
   * Une facture en retard SANS téléphone est comptée à part, jamais ignorée en
   * silence : l'artisan doit savoir combien de relances il ne pourra pas
   * passer, et pourquoi.
   */
  test("un impayé sans téléphone est annoncé, pas escamoté", async () => {
    await adminPool.query(
      `INSERT INTO factures (id, tenant_id, number, customer_name, amount_cents,
                             issued_date, due_date, statut)
       VALUES ($1, $2::uuid, 'F-RETARD-2', 'Sans Numero', 90000,
               CURRENT_DATE - 60, CURRENT_DATE - 30, 'EMISE')`,
      [crypto.randomUUID(), b.tenantId],
    );

    const { body } = await demander(b);

    expect(body.operations ?? []).toHaveLength(0);
    expect(body.message.content).toMatch(/num[ée]ro de t[ée]l[ée]phone/i);
    expect(body.message.content).toMatch(/1 facture/);
  });
});


/*
 * ── NE PAS PROPOSER UN BOUTON QUI VA ÉCHOUER ─────────────────────────────
 *
 * Constaté le 29/08/2026 : le Cockpit affichait « Approuver » sur un plan de
 * relance sans appel. Le clic rendait « Impossible d'approuver cette action »
 * — la cause exacte étant jetée deux fois, côté serveur puis côté écran.
 *
 * L'applicabilité est calculée par SIMULATION : le vrai chemin d'exécution,
 * joué puis annulé. Pas une seconde série de vérifications — ce serait la
 * quatrième fois dans ce projet qu'un même métier est écrit deux fois, et à
 * chaque fois les deux implémentations ont divergé.
 */
describe("h — l'applicabilité d'un plan, sans rien écrire", () => {
  const lister = (l: Locataire) =>
    request(serveurTest(app)).get("/api/pending-actions").set("Cookie", l.cookie).expect(200);

  test("un plan sain est applicable, ET n'a rien écrit pour le dire", async () => {
    const planId = await poser(a, [creerAffaire("Simulation Dupont")]);

    const { body } = await lister(a);
    const action = body.find((x: { id: string }) => x.id === planId);
    expect(action.applicable).toBe(true);
    expect(action.motifNonApplicable).toBeNull();

    // LA garde de la simulation : la transaction a été ANNULÉE. Sans le
    // rollback, l'affaire existerait et le plan serait marqué appliqué.
    expect(await compterAffaires(a, "Simulation Dupont")).toBe(0);
    const { rows } = await adminPool.query(
      "SELECT execute_le FROM pending_actions WHERE id = $1", [planId],
    );
    expect(rows[0].execute_le).toBeNull();
  });

  test("un plan expiré n'est pas applicable, et le motif le dit", async () => {
    const planId = await poser(a, [creerAffaire("Simulation périmée")]);
    await adminPool.query(
      `UPDATE pending_actions SET expire_le = NOW() - interval '1 minute' WHERE id = $1`, [planId],
    );

    const { body } = await lister(a);
    const action = body.find((x: { id: string }) => x.id === planId);
    expect(action.applicable).toBe(false);
    expect(action.motifNonApplicable).toMatch(/expir/i);
  });

  /*
   * Le cas RÉEL qui a déclenché ce lot : une cible disparue entre la
   * proposition et la validation. Le Cockpit ne doit plus offrir le bouton.
   */
  test("une cible disparue rend le plan inapplicable, avec sa raison", async () => {
    const planId = await poser(a, [{
      type: "creer_echeance",
      libelle: "Échéance sur une affaire disparue",
      champs: { label: "Fantôme simulé", affaireId: crypto.randomUUID(), dueDate: "2026-12-01" },
      certitude: "aucune_resolution",
      aCompleter: [],
    }]);

    const { body } = await lister(a);
    const action = body.find((x: { id: string }) => x.id === planId);
    expect(action.applicable).toBe(false);
    expect(typeof action.motifNonApplicable).toBe("string");
    expect(action.motifNonApplicable.length).toBeGreaterThan(0);
  });

  /*
   * Une simulation ne doit pas empêcher la VRAIE exécution ensuite : si le
   * rollback laissait le plan marqué, l'artisan verrait « déjà appliqué »
   * sur un plan qu'il n'a jamais validé.
   */
  test("après une simulation, le plan s'applique toujours pour de vrai", async () => {
    const planId = await poser(a, [creerAffaire("Après simulation")]);
    await lister(a);                              // simule
    await executer(a, planId).expect(200);        // puis applique

    expect(await compterAffaires(a, "Après simulation")).toBe(1);
  });
});


/*
 * ── UN IDENTIFIANT INVENTÉ N'EST PAS UNE RÉFÉRENCE ───────────────────────
 *
 * Constaté le 29/08/2026 : l'agent a proposé « Enregistrer un règlement sur
 * la facture facture_id » — il avait recopié le NOM DU PARAMÈTRE. La
 * validation échouait ensuite sur « Facture facture_id introuvable », APRÈS
 * que l'artisan eut cliqué.
 *
 * Le dépôt l'interdit sans ambiguïté : « le modèle rend des intentions dont
 * le schéma ne contient AUCUN identifiant — ce n'est pas une consigne de
 * rédaction, c'est SortieModele qui refuse ». Ce refus existait sur l'ancien
 * chemin vocal ; il n'a jamais existé sur celui de l'agent, où
 * « Identifiant obtenu via list_factures » n'est qu'une phrase dans une
 * description d'outil.
 *
 * La garde porte sur le CÂBLAGE — `executeTool`, qui a la base — et non sur
 * une fonction pure qui recevrait l'identifiant à la main.
 */
describe("i — une cible inexistante n'est jamais proposée", () => {
  const demander = (l: Locataire, texte: string) =>
    request(serveurTest(app)).post("/api/chat/messages").set("Cookie", l.cookie)
      .send({ content: texte }).expect(200);

  test("un règlement sur une facture inconnue devient une RÉPONSE, pas une opération", async () => {
    const { body } = await demander(a, "agent-test-reglement-fantome");

    // Aucune opération : faire cliquer sur une écriture condamnée est une
    // impasse découverte au pire moment.
    expect(body.operations ?? []).toHaveLength(0);
    expect(body.planId).toBeNull();
    // Et l'agent propose la SUITE UTILE plutôt que de constater l'échec.
    expect(body.message.content).toMatch(/facture/i);
  });
});
