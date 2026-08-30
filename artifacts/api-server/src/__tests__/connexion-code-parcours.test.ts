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
    const cookieAppareil = (verif.headers["set-cookie"] ?? [])
      .find((c: string) => c.startsWith("nodaq_appareil="))!;
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
