/**
 * Le parcours complet, du point de vue de l'artisan.
 *
 * C'est LA promesse du lot : un patron qui n'a installé aucune application
 * doit pouvoir entrer, et ne plus rien saisir la fois suivante sur le même
 * appareil.
 *
 * Les tests unitaires (`code-connexion.test.ts`) éprouvent les plafonds. Celui-ci
 * éprouve l'enchaînement — c'est-à-dire la seule chose que l'utilisateur vit.
 */
import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import app from "../app";
import { adminPool, cleanupTenants, cleanupUsers, serveurTest, createTestTenant, createTestUser, createTestMembership } from "./helpers";

/** Le courriel est intercepté : c'est le seul endroit où le code est lisible. */
const codesEnvoyes: string[] = [];
vi.mock("../lib/envoi-code-connexion.js", async (原) => {
  const vrai = await 原<typeof import("../lib/envoi-code-connexion.js")>();
  return {
    ...vrai,
    envoyerCodeConnexion: async (_t: string, _d: string, code: string) => {
      codesEnvoyes.push(code);
    },
  };
});

let email: string;
let motDePasse: string;
let tenantId: string;
let userId: string;
const tenants: string[] = [];
const emails: string[] = [];

beforeAll(async () => {
  const t = await createTestTenant("parcours-code");
  // Une VRAIE adresse : `/auth/login` valide le format, contrairement aux
  // tests qui fabriquent une session directement.
  const u = await createTestUser(`parcours-code-${Date.now()}@test.nodaq`);
  await createTestMembership(u.id, t.id, "OWNER");
  tenantId = t.id; userId = u.id; email = u.email; motDePasse = u.password;
  tenants.push(t.id); emails.push(u.email);
}, 120_000);

afterAll(async () => {
  await adminPool.query("DELETE FROM codes_connexion WHERE user_id = $1::uuid", [userId]);
  await adminPool.query("DELETE FROM appareils_confiance WHERE user_id = $1::uuid", [userId]);
  await cleanupTenants(...tenants);
  await cleanupUsers(...emails);
}, 30_000);

const connexion = () =>
  request(serveurTest(app)).post("/api/auth/login").send({ email, password: motDePasse });

/*
 * ── L'INSCRIPTION AUSSI ENVOIE LE CODE ──────────────────────────────────────
 *
 * Constaté en production le 30/08/2026, sur le PREMIER compte créé après la
 * mise en ligne : zéro code généré, zéro ligne au journal d'envois. Le code
 * était branché sur la connexion seule — or celui qui vient de s'inscrire ne
 * passe pas par là. L'écran l'accueillait avec « Nous venons de vous envoyer
 * un code », une phrase fausse, devant six cases vides.
 *
 * Le test précédent ne l'avait pas vu parce qu'il fabriquait son utilisateur
 * en base au lieu de passer par l'inscription. Un parcours éprouvé à partir du
 * MILIEU laisse le début sans garde.
 */
describe("celui qui vient de s'inscrire reçoit son code", () => {
  test("l'inscription envoie un code, sans passer par la connexion", async () => {
    codesEnvoyes.length = 0;
    const adresse = `inscription-${Date.now()}@test.nodaq`;
    const res = await request(serveurTest(app))
      .post("/api/auth/register")
      .send({ email: adresse, password: "test-pass-1234", nom: "Patron", tenantNom: "Nouvelle entreprise" })
      .expect(201);

    expect(res.body.mfaStatus).toBe("code_envoye");
    expect(codesEnvoyes).toHaveLength(1);

    // L'adresse est rendue ENTIÈRE : c'est ce qui rend une coquille visible.
    expect(res.body.destinataire).toBe(adresse);

    // Et le code saisi ouvre l'application dans la foulée.
    const cookie = res.headers["set-cookie"]![0]!;
    await request(serveurTest(app))
      .post("/api/mfa/code/verifier").set("Cookie", cookie)
      .send({ code: codesEnvoyes[0] }).expect(200);
    await request(serveurTest(app))
      .get("/api/cockpit/kpis").set("Cookie", cookie).expect(200);

    await adminPool.query("DELETE FROM users WHERE email = $1", [adresse]);
  }, 60_000);

  /*
   * ── LA GARDE QUI MANQUAIT, ET QUI A COÛTÉ LA MISE EN LIGNE ────────────────
   *
   * Le code était accepté, la session marquée en base, les routes métier
   * ouvertes — et `/auth/me` répondait encore « code requis ». La garde de
   * route renvoyait l'utilisateur sur l'écran du code, en boucle.
   *
   * Aucun test ne regardait l'état APRÈS vérification. Ils s'arrêtaient tous
   * juste avant, ou vérifiaient une route métier — qui, elle, lisait la bonne
   * colonne. Le seul point de vue non couvert était celui de l'écran.
   */
  test("APRÈS vérification, l'état dit « verified » et porte le rôle", async () => {
    codesEnvoyes.length = 0;
    const adresse = `apres-verif-${Date.now()}@test.nodaq`;
    const reg = await request(serveurTest(app))
      .post("/api/auth/register")
      .send({ email: adresse, password: "test-pass-1234", nom: "Patron", tenantNom: "Entreprise" })
      .expect(201);
    const cookie = reg.headers["set-cookie"]![0]!;

    await request(serveurTest(app))
      .post("/api/mfa/code/verifier").set("Cookie", cookie)
      .send({ code: codesEnvoyes[0] }).expect(200);

    const me = await request(serveurTest(app))
      .get("/api/auth/me").set("Cookie", cookie).expect(200);

    expect(me.body.mfaStatus).toBe("verified");
    // `role` est ce que la garde de route exige pour laisser passer. Sans lui,
    // elle renvoie sur l'écran du code — quoi qu'en dise `mfaStatus`.
    expect(me.body.role).toBe("OWNER");
    expect(me.body.tenantId).toBeTruthy();

    await adminPool.query("DELETE FROM users WHERE email = $1", [adresse]);
  }, 60_000);

  test("l'état rendu par /auth/me porte l'adresse, pour qu'une coquille se voie", async () => {
    codesEnvoyes.length = 0;
    const adresse = `coquille-${Date.now()}@test.nodaq`;
    const res = await request(serveurTest(app))
      .post("/api/auth/register")
      .send({ email: adresse, password: "test-pass-1234", nom: "Patron", tenantNom: "Entreprise" })
      .expect(201);
    const cookie = res.headers["set-cookie"]![0]!;

    const me = await request(serveurTest(app))
      .get("/api/auth/me").set("Cookie", cookie).expect(200);
    expect(me.body.mfaStatus).toBe("code_requis");
    expect(me.body.destinataire).toBe(adresse);

    await adminPool.query("DELETE FROM users WHERE email = $1", [adresse]);
  }, 60_000);
});

describe("un patron sans application d'authentification", () => {
  test("entre avec un code reçu par courriel, puis n'a plus rien à saisir", async () => {
    codesEnvoyes.length = 0;

    // 1. Il se connecte. Un code part ; ni tenantId ni rôle ne sont rendus.
    const premiere = await connexion().expect(200);
    expect(premiere.body.mfaStatus).toBe("code_envoye");
    expect(premiere.body.tenantId).toBeUndefined();
    expect(codesEnvoyes).toHaveLength(1);
    const cookieSession = premiere.headers["set-cookie"]![0]!;

    // 2. Tant que le code n'est pas saisi, l'application reste fermée.
    await request(serveurTest(app))
      .get("/api/cockpit/kpis").set("Cookie", cookieSession).expect(403);

    // 3. Il saisit le code reçu.
    const verif = await request(serveurTest(app))
      .post("/api/mfa/code/verifier")
      .set("Cookie", cookieSession)
      .send({ code: codesEnvoyes[0] })
      .expect(200);
    expect(verif.body.appareilMemorise).toBe(true);

    // 4. L'application s'ouvre.
    await request(serveurTest(app))
      .get("/api/cockpit/kpis").set("Cookie", cookieSession).expect(200);

    // 5. LA promesse. Il revient demain sur le même appareil : aucun code.
    const entetes = verif.headers["set-cookie"];
    const cookies: string[] = Array.isArray(entetes) ? entetes : entetes ? [entetes] : [];
    const cookieAppareil = cookies.find(c => c.startsWith("nodaq_appareil="))!;
    expect(cookieAppareil).toBeTruthy();

    codesEnvoyes.length = 0;
    const seconde = await request(serveurTest(app))
      .post("/api/auth/login")
      .set("Cookie", cookieAppareil.split(";")[0]!)
      .send({ email, password: motDePasse })
      .expect(200);

    expect(seconde.body.mfaStatus).toBe("verified");
    expect(seconde.body.appareilReconnu).toBe(true);
    // Aucun courriel n'est parti : c'est ce qui fait passer le second facteur
    // de trois cents fois par an à trois ou quatre.
    expect(codesEnvoyes).toHaveLength(0);

    // Et la session est ouverte immédiatement, sans étape intermédiaire.
    await request(serveurTest(app))
      .get("/api/cockpit/kpis")
      .set("Cookie", seconde.headers["set-cookie"]![0]!)
      .expect(200);
  }, 60_000);

  /*
   * Le cookie d'appareil ne vaut RIEN sans le mot de passe. C'est ce qui
   * autorise à le garder 90 jours : il atteste d'un second facteur déjà
   * prouvé, il n'ouvre aucune porte à lui seul.
   */
  test("le cookie d'appareil seul n'ouvre rien", async () => {
    codesEnvoyes.length = 0;
    const r = await connexion().expect(200);
    const cookieSession = r.headers["set-cookie"]![0]!;
    await request(serveurTest(app))
      .post("/api/mfa/code/verifier").set("Cookie", cookieSession)
      .send({ code: codesEnvoyes[0] }).expect(200);

    const mauvais = await request(serveurTest(app))
      .post("/api/auth/login")
      .send({ email, password: "mauvais-mot-de-passe" })
      .expect(401);
    expect(mauvais.body.tenantId).toBeUndefined();
  }, 60_000);
});
