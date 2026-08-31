/**
 * Mot de passe oublié — le chemin de retour, et ce qu'il ne doit pas dire.
 *
 * ── LE DÉFAUT QUE CE LOT RÉPARE ─────────────────────────────────────────────
 *
 * Il n'existait AUCUN moyen de réinitialiser un mot de passe. Ni route, ni
 * écran, ni lien. Un artisan qui l'oubliait était enfermé dehors
 * définitivement, et le seul recours aurait été de modifier sa ligne en base.
 * Sur cinquante comptes payants, cela arrive dans la première semaine.
 *
 * ── LES DEUX PROPRIÉTÉS QUI COMPTENT ────────────────────────────────────────
 *
 * 1. La demande ne dit JAMAIS si le compte existe. Sinon le formulaire devient
 *    un outil d'énumération : on y essaie une liste d'adresses et on apprend
 *    lesquelles sont clientes.
 * 2. Réinitialiser REPREND le compte : sessions supprimées, appareils de
 *    confiance révoqués. Quelqu'un qui réinitialise dit « je n'ai plus la
 *    main » — lui rendre son mot de passe en laissant ouvertes les sessions de
 *    celui qui la lui a prise n'aurait aucun sens.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import {
  adminPool, cleanupTenants, cleanupUsers,
  completeMfaForRegisteredOwner, serveurTest,
} from "./helpers";
import { poserCode, verifierCode } from "../lib/code-connexion";

const tenantIds: string[] = [];
const emails: string[] = [];
let email = "";
let userId = "";
let tenantId = "";

const MDP_INITIAL = "test-pass-1234";
const MDP_NOUVEAU = "un-nouveau-mot-de-passe-9";

/**
 * Le code en clair n'existe qu'à l'émission : on le pose nous-mêmes.
 *
 * La fenêtre horaire est vidée avant chaque pose. La limite de cinq codes par
 * heure est réelle et elle a son propre test ci-dessous ; la laisser courir
 * ici rendrait simplement ce fichier dépendant de l'ordre des tests — le
 * sixième échouerait pour une raison sans rapport avec ce qu'il vérifie.
 */
async function codeDeReinitialisation(): Promise<string> {
  await adminPool.query(`DELETE FROM codes_connexion WHERE user_id = $1::uuid`, [userId]);
  const r = await poserCode(userId, "reinitialisation");
  if (r.kind !== "ok") throw new Error(`émission impossible : ${r.kind}`);
  return r.code;
}

beforeAll(async () => {
  email = `oubli-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: MDP_INITIAL, nom: "Patron", tenantNom: "Oubli SARL" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  userId = reg.body.userId;
  tenantId = reg.body.tenantId;
  tenantIds.push(tenantId);
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

describe("la demande ne révèle jamais si le compte existe", () => {
  test("une adresse inconnue répond comme une adresse connue", async () => {
    /*
     * LA propriété. Deux réponses différentes suffiraient à transformer ce
     * formulaire en annuaire de vos clients : on y essaie une liste
     * d'adresses, et celles qui répondent autrement sont les bonnes.
     */
    const connue = await request(serveurTest(app))
      .post("/api/auth/mot-de-passe/oublie").send({ email }).expect(200);
    const inconnue = await request(serveurTest(app))
      .post("/api/auth/mot-de-passe/oublie")
      .send({ email: `personne-${crypto.randomUUID()}@test.nodaq` }).expect(200);

    expect(inconnue.status).toBe(connue.status);
    expect(inconnue.body).toEqual(connue.body);
  });

  test("la réponse ne contient ni adresse ni identifiant", async () => {
    const r = await request(serveurTest(app))
      .post("/api/auth/mot-de-passe/oublie").send({ email }).expect(200);
    const corps = JSON.stringify(r.body);
    expect(corps).not.toContain(email);
    expect(corps).not.toContain(userId);
  });
});

describe("un code de connexion ne réinitialise pas un mot de passe", () => {
  test("les deux usages sont cloisonnés", async () => {
    /*
     * Ouvrir une session et reprendre un compte n'ont pas la même
     * conséquence. Quelqu'un qui se fait dicter son code de connexion au
     * téléphone — par un faux support, ou par un vrai à qui il le lit — ne
     * doit pas donner du même coup le pouvoir de changer son mot de passe.
     */
    const emissionConnexion = await poserCode(userId, "connexion");
    if (emissionConnexion.kind !== "ok") throw new Error("émission impossible");

    // Le code de CONNEXION présenté comme code de RÉINITIALISATION : refusé.
    const croise = await verifierCode(userId, emissionConnexion.code, "reinitialisation");
    expect(croise.kind).not.toBe("ok");

    // Et il reste valable pour ce à quoi il sert.
    expect((await verifierCode(userId, emissionConnexion.code, "connexion")).kind).toBe("ok");
  });
});

describe("réinitialiser reprend le compte, pas seulement le mot de passe", () => {
  test("le nouveau mot de passe fonctionne, l'ancien ne vaut plus rien", async () => {
    const code = await codeDeReinitialisation();
    await request(serveurTest(app))
      .post("/api/auth/mot-de-passe/reinitialiser")
      .send({ email, code, motDePasse: MDP_NOUVEAU })
      .expect(200);

    await request(serveurTest(app))
      .post("/api/auth/login").send({ email, password: MDP_INITIAL }).expect(401);
    await request(serveurTest(app))
      .post("/api/auth/login").send({ email, password: MDP_NOUVEAU }).expect(200);
  });

  test("les sessions ouvertes et les appareils de confiance tombent", async () => {
    /*
     * Le test est AUTONOME : il ouvre une session, puis réinitialise, puis
     * compte. Une première version comptait après coup, sans voir que le test
     * précédent venait de se connecter avec le nouveau mot de passe — il
     * trouvait donc une session et accusait le code. Une assertion qui dépend
     * de ce qu'un autre test a laissé derrière lui ne prouve rien.
     */
    await request(serveurTest(app))
      .post("/api/auth/login").send({ email, password: MDP_NOUVEAU }).expect(200);
    await adminPool.query(
      `INSERT INTO appareils_confiance (id, user_id, jeton_sha256, expires_at)
       VALUES ($1, $2::uuid, $3, now() + interval '90 days')`,
      [crypto.randomUUID(), userId, crypto.randomBytes(32).toString("hex")],
    );

    const avant = await adminPool.query(
      `SELECT (SELECT count(*)::int FROM sessions WHERE user_id = $1::uuid) AS sessions,
              (SELECT count(*)::int FROM appareils_confiance
                WHERE user_id = $1::uuid AND revoked_at IS NULL) AS appareils`,
      [userId],
    );
    expect(avant.rows[0].sessions).toBeGreaterThanOrEqual(1);
    expect(avant.rows[0].appareils).toBeGreaterThanOrEqual(1);

    const code = await codeDeReinitialisation();
    await request(serveurTest(app))
      .post("/api/auth/mot-de-passe/reinitialiser")
      .send({ email, code, motDePasse: "encore-un-mot-de-passe-3" }).expect(200);

    // Une session volée ne survit pas à la reprise du compte : c'est le sens
    // même du geste.
    const apres = await adminPool.query(
      `SELECT (SELECT count(*)::int FROM sessions WHERE user_id = $1::uuid) AS sessions,
              (SELECT count(*)::int FROM appareils_confiance
                WHERE user_id = $1::uuid AND revoked_at IS NULL) AS appareils`,
      [userId],
    );
    expect(apres.rows[0].sessions, "une session a survécu").toBe(0);
    expect(apres.rows[0].appareils, "un appareil de confiance a survécu").toBe(0);
  });
});

describe("le code se comporte comme celui de la connexion", () => {
  test("cinq demandes par heure, pas six", async () => {
    /*
     * Sans plafond, ce formulaire devient un moyen d'inonder la boîte de
     * quelqu'un dont on connaît l'adresse — et de noyer, au passage, les
     * courriels que nodaq lui envoie vraiment.
     *
     * La limite est celle de la connexion, réutilisée telle quelle. Elle est
     * comptée PAR USAGE : demander des codes de réinitialisation ne doit pas
     * empêcher la personne de se connecter.
     */
    await adminPool.query(`DELETE FROM codes_connexion WHERE user_id = $1::uuid`, [userId]);
    for (let i = 0; i < 5; i++) {
      expect((await poserCode(userId, "reinitialisation")).kind).toBe("ok");
    }
    expect((await poserCode(userId, "reinitialisation")).kind).toBe("trop_de_demandes");

    // La connexion, elle, reste possible : les compteurs sont séparés.
    expect((await poserCode(userId, "connexion")).kind).toBe("ok");
  });

  test("un code déjà utilisé ne resert pas", async () => {
    const code = await codeDeReinitialisation();
    await request(serveurTest(app))
      .post("/api/auth/mot-de-passe/reinitialiser")
      .send({ email, code, motDePasse: "encore-un-autre-mdp-7" }).expect(200);
    const r = await request(serveurTest(app))
      .post("/api/auth/mot-de-passe/reinitialiser")
      .send({ email, code, motDePasse: "et-encore-un-autre-8" }).expect(400);
    expect(r.body.error).toMatch(/nouveau|valable|correspond/i);
  });

  test("un mot de passe trop court est refusé AVANT de brûler le code", async () => {
    /*
     * L'ordre compte pour l'utilisateur : si le code était consommé par une
     * saisie trop courte, il devrait en redemander un pour une faute qui n'a
     * rien à voir avec lui.
     */
    const code = await codeDeReinitialisation();
    const court = await request(serveurTest(app))
      .post("/api/auth/mot-de-passe/reinitialiser")
      .send({ email, code, motDePasse: "court" }).expect(400);
    expect(court.body.error).toMatch(/10 caractères/);

    await request(serveurTest(app))
      .post("/api/auth/mot-de-passe/reinitialiser")
      .send({ email, code, motDePasse: "un-mot-de-passe-valable-1" }).expect(200);
  });

  test("un code inconnu est refusé sans dire pourquoi il l'est", async () => {
    const r = await request(serveurTest(app))
      .post("/api/auth/mot-de-passe/reinitialiser")
      .send({ email, code: "000000", motDePasse: "un-autre-mot-de-passe-2" })
      .expect(400);
    expect(r.body.error).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toContain(userId);
  });
});
