/**
 * Tests d'autorisation pour les routes onboarding/reprise.
 *
 * Règle : les écrits (POST confirmer, PATCH profil, POST blocs/:bloc) sont
 * OWNER uniquement. Un MEMBER reçoit 403 sur chaque write.
 * Les lectures (GET profil, GET blocs) sont accessibles à tous les membres.
 *
 * Test de régression : importer 3 chantiers ne doit PAS produire donneesInsuffisantes:true.
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

// ── Fixtures ──────────────────────────────────────────────────────────────────

let tenantId: string;
let cookieOwner: string;
let cookieMember: string;
const tenantIds: string[] = [];
const emails: string[] = [];

beforeAll(async () => {
  const tenant = await createTestTenant("AuthTest-Onboarding");
  tenantId = tenant.id;
  tenantIds.push(tenant.id);

  for (const [role, label] of [["OWNER", "owner"], ["MEMBER", "member"]] as const) {
    const email = `auth-${label}-${Date.now()}@test.nodaq`;
    emails.push(email);
    const user = await createTestUser(email, "Test1234!");
    await createTestMembership(user.id, tenant.id, role);
    const session = await createTestSession(user.id, tenant.id);
    if (role === "OWNER") cookieOwner = cookieHeader(session.id);
    else cookieMember = cookieHeader(session.id);
  }
});

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
});

const asOwner  = () => ({ get: (u: string) => request(serveurTest(app)).get(u).set("Cookie", cookieOwner),
                           post: (u: string, b: unknown) => request(serveurTest(app)).post(u).set("Cookie", cookieOwner).send(b as Record<string, unknown>),
                           patch: (u: string, b: unknown) => request(serveurTest(app)).patch(u).set("Cookie", cookieOwner).send(b as Record<string, unknown>) });
const asMember = () => ({ get: (u: string) => request(serveurTest(app)).get(u).set("Cookie", cookieMember),
                           post: (u: string, b: unknown) => request(serveurTest(app)).post(u).set("Cookie", cookieMember).send(b as Record<string, unknown>),
                           patch: (u: string, b: unknown) => request(serveurTest(app)).patch(u).set("Cookie", cookieMember).send(b as Record<string, unknown>) });

// ── Lectures : accessibles à MEMBER ──────────────────────────────────────────

describe("GET (lectures) — accessibles à MEMBER", () => {
  test("GET /api/onboarding/profil → 200 pour un MEMBER", async () => {
    const res = await asMember().get("/api/onboarding/profil");
    expect(res.status).toBe(200);
    expect(res.body.profile).toBeDefined();
  });

  test("GET /api/reprise/blocs → 200 pour un MEMBER", async () => {
    const res = await asMember().get("/api/reprise/blocs");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.blocs)).toBe(true);
  });
});

// ── Écrits : OWNER only, MEMBER → 403 ────────────────────────────────────────

describe("Écrits — MEMBER reçoit 403", () => {
  test("POST /api/entreprises/recherche → 403 pour un MEMBER", async () => {
    const res = await asMember().post("/api/entreprises/recherche", { q: "test" });
    expect(res.status).toBe(403);
  });

  test("POST /api/onboarding/profil/confirmer → 403 pour un MEMBER", async () => {
    const res = await asMember().post("/api/onboarding/profil/confirmer", {
      siret: "35600000000048",
      siren: "356000000",
      raison_sociale: "TEST",
    });
    expect(res.status).toBe(403);
  });

  test("PATCH /api/onboarding/profil → 403 pour un MEMBER", async () => {
    const res = await asMember().patch("/api/onboarding/profil", {
      "company.decennale_assureur": "Test Assureur",
    });
    expect(res.status).toBe(403);
  });

  test("POST /api/reprise/blocs/chantiers → 403 pour un MEMBER", async () => {
    const res = await asMember().post("/api/reprise/blocs/chantiers", {
      data: { chantiers: [{ label: "Chantier A" }] },
    });
    expect(res.status).toBe(403);
  });

  test("POST /api/reprise/blocs/ca_ytd → 403 pour un MEMBER", async () => {
    const res = await asMember().post("/api/reprise/blocs/ca_ytd", {
      data: { ca_facture_ytd: 50000 },
    });
    expect(res.status).toBe(403);
  });

  test("POST /api/reprise/blocs/equipe → 403 pour un MEMBER", async () => {
    const res = await asMember().post("/api/reprise/blocs/equipe", {
      data: { equipe: [{ name: "Alice", typeLien: "SALARIE", joursParSemaine: 5 }] },
    });
    expect(res.status).toBe(403);
  });
});

// ── OWNER peut écrire ──────────────────────────────────────────────────────────

describe("Écrits — OWNER peut écrire", () => {
  test("POST /api/onboarding/profil/confirmer → 200 pour OWNER", async () => {
    const res = await asOwner().post("/api/onboarding/profil/confirmer", {
      siret: "35600000000048",
      siren: "356000000",
      raison_sociale: "TEST OWNER",
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test("PATCH /api/onboarding/profil → 200 pour OWNER", async () => {
    const res = await asOwner().patch("/api/onboarding/profil", {
      "company.decennale_assureur": "MAAF Pro",
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// ── Régression : corps sans action valide → 400 sans muter blocs_passes ──────

describe("Corps sans action valide → 400 sans marquer done", () => {
  const noActionCases = [
    { label: "body vide {}",           body: {}                              },
    { label: "passer: false sans data", body: { passer: false }              },
    { label: "passer: undefined sans data", body: { passer: undefined }       },
  ] as const;

  for (const { label, body } of noActionCases) {
    test(`${label} → 400 et bloc non marqué done`, async () => {
      const before = await asOwner().get("/api/reprise/blocs");
      const passesBefore: string[] = before.body.blocs_passes;

      const res = await asOwner().post("/api/reprise/blocs/devis", body);
      expect(res.status).toBe(400);

      const after = await asOwner().get("/api/reprise/blocs");
      expect(after.body.blocs_passes).toEqual(passesBefore);
    });
  }

  test("data présent mais invalide → 400 et bloc non marqué done", async () => {
    const before = await asOwner().get("/api/reprise/blocs");
    const passesBefore: string[] = before.body.blocs_passes;

    const res = await asOwner().post("/api/reprise/blocs/ca_ytd", {
      data: { ca_facture_ytd: "pas-un-nombre" },
    });
    expect(res.status).toBe(400);

    const after = await asOwner().get("/api/reprise/blocs");
    expect(after.body.blocs_passes).toEqual(passesBefore);
  });

  test("passer: true sans data → 200 et bloc marqué done", async () => {
    const res = await asOwner().post("/api/reprise/blocs/equipe", { passer: true });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    const after = await asOwner().get("/api/reprise/blocs");
    expect(after.body.blocs_passes).toContain("equipe");
  });
});

// ── Régression seuil de silence ───────────────────────────────────────────────

describe("Régression — importer 3 chantiers ne retourne pas donneesInsuffisantes", () => {
  test("importer 3 chantiers sur un tenant vierge → donneesInsuffisantes:false", async () => {
    // Ce tenant n'a aucune affaire avant le test
    const res = await asOwner().post("/api/reprise/blocs/chantiers", {
      data: {
        chantiers: [
          { label: "Chantier 1", client: "Client A" },
          { label: "Chantier 2", client: "Client B" },
          { label: "Chantier 3", client: "Client C" },
        ],
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Avec 0 existants + 3 entrants = 3 ≥ 3 → pas insuffisant
    expect(res.body.donneesInsuffisantes).toBe(false);
  });

  test("importer 2 chantiers sur un tenant vierge → donneesInsuffisantes:true", async () => {
    // Créer un tenant frais pour ce test
    const t = await createTestTenant("Silence-2-chantiers");
    tenantIds.push(t.id);
    const email2 = `silence-2-${Date.now()}@test.nodaq`;
    emails.push(email2);
    const u = await createTestUser(email2, "Test1234!");
    await createTestMembership(u.id, t.id, "OWNER");
    const s = await createTestSession(u.id, t.id);
    const cookie2 = cookieHeader(s.id);

    const res = await request(serveurTest(app))
      .post("/api/reprise/blocs/chantiers")
      .set("Cookie", cookie2)
      .send({
        data: {
          chantiers: [
            { label: "Chantier A", client: "Client X" },
            { label: "Chantier B", client: "Client Y" },
          ],
        },
      });
    expect(res.status).toBe(200);
    // 0 existants + 2 entrants = 2 < 3 → insuffisant
    expect(res.body.donneesInsuffisantes).toBe(true);
  });
});
