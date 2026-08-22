/**
 * /api/votre-metier — le réglage de secteur (US-A1.1).
 *
 * Avant US-A1.1, `PATCH` acceptait n'importe quelle chaîne non vide — aucune
 * garde contre une valeur qui ne correspond à aucun pack de
 * `verticalPacks.ts`. Ces tests couvrent la validation `z.enum(VERTICALS)`
 * et le repli par défaut sur le vocabulaire BTP historique.
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
} from "./helpers";

let cookie: string;
const tenantIds: string[] = [];
const emails: string[] = [];

beforeAll(async () => {
  const tenant = await createTestTenant("VotreMetier Tenant");
  tenantIds.push(tenant.id);
  const email = `votre-metier-${Date.now()}@test.nodaq`;
  emails.push(email);
  const user = await createTestUser(email);
  await createTestMembership(user.id, tenant.id, "OWNER");
  const session = await createTestSession(user.id, tenant.id);
  cookie = cookieHeader(session.id);
});

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
});

describe("GET /api/votre-metier", () => {
  test("un tenant qui n'a jamais répondu garde le vocabulaire BTP historique", async () => {
    const res = await request(serveurTest(app)).get("/api/votre-metier").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.metier).toBe("industrie_btp");
  });
});

describe("PATCH /api/votre-metier", () => {
  test("un vertical connu est accepté et relu tel quel", async () => {
    const patch = await request(serveurTest(app)).patch("/api/votre-metier").set("Cookie", cookie)
      .send({ metier: "professions_liberales" });
    expect(patch.status).toBe(200);
    expect(patch.body.metier).toBe("professions_liberales");

    const reread = await request(serveurTest(app)).get("/api/votre-metier").set("Cookie", cookie);
    expect(reread.body.metier).toBe("professions_liberales");
  });

  test("un secteur inconnu est refusé en 400, rien n'est modifié", async () => {
    const avant = await request(serveurTest(app)).get("/api/votre-metier").set("Cookie", cookie);

    const res = await request(serveurTest(app)).patch("/api/votre-metier").set("Cookie", cookie)
      .send({ metier: "secteur-invente-qui-n-existe-pas" });
    expect(res.status).toBe(400);

    const apres = await request(serveurTest(app)).get("/api/votre-metier").set("Cookie", cookie);
    expect(apres.body.metier).toBe(avant.body.metier);
  });

  test("chacun des 9 secteurs minimum requis par la story est accepté", async () => {
    const secteurs = [
      "batiment", "retail", "restauration_chr", "services_personne",
      "professions_liberales", "artisanat_service", "services_entreprises",
      "transport", "sante_liberale",
    ];
    for (const metier of secteurs) {
      const res = await request(serveurTest(app)).patch("/api/votre-metier").set("Cookie", cookie).send({ metier });
      expect(res.status, `secteur ${metier}`).toBe(200);
      expect(res.body.metier).toBe(metier);
    }
  });
});
