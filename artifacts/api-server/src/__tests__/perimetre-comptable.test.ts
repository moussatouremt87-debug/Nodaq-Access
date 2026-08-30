/**
 * Le PÉRIMÈTRE du comptable — prouvé par le refus, pas par le menu.
 *
 * ── CE QUI A ÉTÉ CONSTATÉ ─────────────────────────────────────────────────
 * Le 29/08/2026, le fondateur ouvre l'accès comptable de son propre espace et
 * y trouve « Envoi des documents » — l'écran qui porte le mot de passe SMTP
 * de sa messagerie. `ACCOUNTANT` figure dans `FINANCIAL_ROLES` (il voit les
 * montants) mais RIEN ne limitait les écrans qu'il atteint : il avait
 * exactement ceux d'un patron.
 *
 * ── POURQUOI CES TESTS PORTENT SUR L'API, PAS SUR LA NAVIGATION ───────────
 * Masquer une entrée de menu n'est pas une protection : l'URL reste tapable,
 * et la requête part quand même. Ce fichier n'ouvre donc aucun écran — il
 * appelle les routes, et vérifie qu'elles REFUSENT.
 *
 * Le dépôt fait déjà cette distinction pour le tiers de confiance
 * (`ECRANS_TIERS_LECTURE` côté API, `ROUTES_TIERS_LECTURE` côté écran). On la
 * tient ici aussi.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import {
  createTestTenant,
  createTestUser,
  createTestMembership,
  createTestSession,
  cookieHeader,
  cleanupTenants,
  cleanupUsers,
  serveurTest,
  type TestTenant,
} from "./helpers";

const tenantIds: string[] = [];
const emails: string[] = [];

let tenant: TestTenant;
let comptable: string;
let patron: string;
let ouvrier: string;

beforeAll(async () => {
  tenant = await createTestTenant("perimetre");
  tenantIds.push(tenant.id);

  const c = await createTestUser("comptable");
  const o = await createTestUser("patron");
  emails.push(c.email, o.email);
  await createTestMembership(c.id, tenant.id, "ACCOUNTANT");
  await createTestMembership(o.id, tenant.id, "OWNER");

  const w = await createTestUser("ouvrier");
  emails.push(w.email);
  await createTestMembership(w.id, tenant.id, "OUVRIER" as "MEMBER");

  comptable = cookieHeader((await createTestSession(c.id, tenant.id)).id);
  patron = cookieHeader((await createTestSession(o.id, tenant.id)).id);
  ouvrier = cookieHeader((await createTestSession(w.id, tenant.id)).id);
}, 120_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

const get = (cookie: string, chemin: string) =>
  request(serveurTest(app)).get(`/api${chemin}`).set("Cookie", cookie);

describe("ce que le comptable ATTEINT", () => {
  /*
   * Sa matière : ce qu'il saisit et ce qu'il exporte. Si l'une de ces routes
   * se fermait, il ne pourrait plus tenir la comptabilité — une restriction
   * trop large est aussi un défaut, moins visible mais tout aussi réel.
   */
  /*
   * Ces routes viennent d'`acces-financier-membres.test.ts`, qui exigeait
   * DÉJÀ que le comptable les atteigne. Ma première liste blanche les
   * fermait, et c'est cette garde-là qui l'a rattrapé.
   *
   * Elles sont reprises ici pour que le lien soit visible depuis le fichier
   * qui définit le périmètre : quelqu'un qui rétrécira la liste demain verra
   * rougir le test qui parle de son sujet, pas un fichier voisin dont il
   * ignore l'existence.
   */
  test.each([
    ["/analytics/indicateurs"],
    ["/paiements"],
    ["/contrats"],
    ["/compte-resultat"],
    ["/factures"],
    ["/avoirs"],
    ["/classeur"],
    ["/charges-recurrentes"],
    ["/rapports/mensuel"],
    ["/echeances"],
  ])("%s lui est ouvert", async (chemin) => {
    const res = await get(comptable, chemin);
    expect(res.status, `${chemin} refusé au comptable`).not.toBe(403);
  });

  /*
   * Décision du fondateur : son cabinet fait du conseil de gestion, pas
   * seulement de la saisie. Ce n'est pas une règle générale du produit —
   * c'est un choix, et il se change dans `ECRANS_COMPTABLE`.
   */
  test.each([["/marge"], ["/previsionnel-tresorerie"]])(
    "%s lui est ouvert — il conseille, il ne fait pas que saisir",
    async (chemin) => {
      expect((await get(comptable, chemin)).status).not.toBe(403);
    },
  );
});

describe("ce que le comptable ne DOIT PAS atteindre", () => {
  /*
   * LA garde née du constat. Cet écran porte le mot de passe SMTP du tenant :
   * un comptable n'a aucune raison de le lire, et encore moins de le changer.
   */
  test("les paramètres d'envoi lui sont REFUSÉS", async () => {
    const res = await get(comptable, "/parametres-envoi");
    expect(res.status).toBe(403);
    // Et rien du contenu ne fuit dans le corps du refus.
    expect(JSON.stringify(res.body)).not.toMatch(/smtp|mot de passe|password/i);
  });

  /*
   * Ce ne sont pas des données comptables : c'est l'activité commerciale et
   * les commandes de l'entreprise. Un comptable tient des comptes, il ne
   * pilote pas la prospection.
   */
  test.each([["/prospection/contacts"], ["/prospection/axes"]])(
    "%s lui est refusé",
    async (chemin) => {
      expect((await get(comptable, chemin)).status).toBe(403);
    },
  );

  /*
   * LISTE BLANCHE, jamais liste noire : une route inventée aujourd'hui, qui
   * n'existera peut-être que demain, est refusée par défaut. Un oubli de
   * liste noire serait silencieux — le mode de défaillance qu'on ne peut pas
   * se permettre sur un accès accordé à quelqu'un d'extérieur.
   */
  test("une route non déclarée est refusée par DÉFAUT", async () => {
    expect((await get(comptable, "/un-ecran-qui-nexiste-pas-encore")).status).toBe(403);
  });
});

describe("le patron n'est restreint par rien", () => {
  /*
   * L'absence de restriction d'`OWNER` est EXPLICITE dans la carte
   * `PERIMETRE_API_PAR_ROLE` — il n'y figure pas. Ce test la fige : une
   * entrée ajoutée par erreur pour `OWNER` enfermerait le patron hors de son
   * propre espace, et c'est le genre de régression qui se découvre en
   * production.
   */
  test("les paramètres d'envoi lui restent ouverts", async () => {
    expect((await get(patron, "/parametres-envoi")).status).not.toBe(403);
  });

  test("la prospection lui reste ouverte", async () => {
    expect((await get(patron, "/prospection/contacts")).status).not.toBe(403);
  });
});


/*
 * ── L'OUVRIER ────────────────────────────────────────────────────────────
 *
 * Il n'existait qu'un rôle `MEMBER` pour deux métiers sans rapport : une
 * secrétaire qui établit des devis et suit les clients, et un compagnon qui
 * pointe ses heures. Les deux avaient exactement les mêmes droits.
 *
 * Le rôle AJOUTÉ est le plus étroit : redéfinir `MEMBER` aurait changé
 * silencieusement les droits des membres existants.
 */
describe("l'ouvrier voit son chantier, rien du commerce", () => {
  test.each([["/pointages"], ["/affaires"], ["/classeur"], ["/brief"]])(
    "%s lui est ouvert",
    async (chemin) => {
      expect((await get(ouvrier, chemin)).status).not.toBe(403);
    },
  );

  /*
   * LA garde. Un compagnon n'a pas à connaître le pipeline commercial de son
   * patron — ni ce qu'il facture, ni qui il démarche.
   */
  test.each([["/devis"], ["/prospects"], ["/contrats"], ["/factures"], ["/marge"]])(
    "%s lui est refusé",
    async (chemin) => {
      expect((await get(ouvrier, chemin)).status).toBe(403);
    },
  );

  test("une route non déclarée lui est refusée par DÉFAUT", async () => {
    expect((await get(ouvrier, "/un-ecran-de-demain")).status).toBe(403);
  });
});
