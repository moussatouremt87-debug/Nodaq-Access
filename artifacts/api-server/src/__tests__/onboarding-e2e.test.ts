/**
 * Test e2e : parcours inscription → découverte onboarding → validation bloc reprise.
 *
 * Ce test vérifie que l'API supporte le parcours complet d'un nouvel OWNER :
 *   1. Inscription (POST /api/auth/register)
 *   2. Profil vide détectable (GET /api/onboarding/profil → company.siret absent)
 *   3. Recherche entreprise (POST /api/entreprises/recherche — réponse structurée)
 *   4. Confirmation profil (POST /api/onboarding/profil/confirmer)
 *   5. Profil lisible après confirmation (GET /api/onboarding/profil → siret présent)
 *   6. Blocs de reprise accessibles (GET /api/reprise/blocs)
 *   7. Bloc ca_ytd validé et persisté (POST /api/reprise/blocs/ca_ytd)
 *   8. Profil contient les valeurs de reprise (GET /api/onboarding/profil)
 *
 * Isolation : tenant propre créé + nettoyé par beforeAll/afterAll.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import {
  adminPool,
  cleanupTenants,
  cleanupUsers,
  completeMfaForRegisteredOwner,
} from "./helpers";
import pg from "pg";

// ── Shared state ──────────────────────────────────────────────────────────────

const suffix = Date.now().toString(36);
const email = `e2e-onboarding-${suffix}@test.nodaq`;
const password = "OnboardingE2E2026!";
const tenantNom = `E2E Onboarding ${suffix}`;
let cookie: string = "";
let tenantId: string = "";

beforeAll(async () => {
  // Créer le compte via l'API (comme un vrai utilisateur)
  const res = await request(app)
    .post("/api/auth/register")
    .send({ email, password, nom: "E2E Test", tenantNom })
    .expect(201);

  await completeMfaForRegisteredOwner(res.body.userId);

  // Récupérer le cookie de session de la réponse
  const setCookie = res.headers["set-cookie"] as string[] | string | undefined;
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie ?? ""];
  cookie = cookies.find((c) => c.startsWith("nodaq_sid=")) ?? "";

  // Récupérer le tenantId depuis la DB pour le nettoyage
  const { rows } = await adminPool.query<{ id: string }>(
    "SELECT t.id FROM tenants t JOIN memberships m ON m.tenant_id = t.id JOIN users u ON u.id = m.user_id WHERE u.email = $1 LIMIT 1",
    [email],
  );
  tenantId = rows[0]?.id ?? "";
});

afterAll(async () => {
  if (tenantId) await cleanupTenants(tenantId);
  await cleanupUsers(email);
});

const api = () => ({
  get: (url: string) =>
    request(app).get(url).set("Cookie", cookie),
  post: (url: string, body: unknown) =>
    request(app).post(url).set("Cookie", cookie).send(body as Record<string, unknown>),
  patch: (url: string, body: unknown) =>
    request(app).patch(url).set("Cookie", cookie).send(body as Record<string, unknown>),
});

// ── Parcours complet ──────────────────────────────────────────────────────────

describe("Parcours e2e : nouvel OWNER → onboarding → reprise", () => {
  test("1. Le profil est vide à la première connexion (company.siret absent)", async () => {
    const res = await api().get("/api/onboarding/profil");
    expect(res.status).toBe(200);
    expect(res.body.profile["company.siret"]).toBeUndefined();
  });

  test("2. La recherche entreprise renvoie un résultat structuré", async () => {
    const res = await api().post("/api/entreprises/recherche", { q: "La Poste" });
    // L'API gouvernementale (recherche-entreprises.api.gouv.fr) est un service
    // TIERS. Elle peut être rate-limitée (429 → rateLimited) ou injoignable
    // (502) depuis un runner CI. Aucun de ces deux cas n'est un défaut de
    // NOTRE code : on ne fait pas rougir la CI pour une panne externe.
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      console.warn(
        `[onboarding-e2e] API entreprises injoignable (HTTP ${res.status}) — assertion ignorée.`,
      );
      return;
    }
    expect(res.status).toBe(200);
    if (res.body.rateLimited) {
      expect(res.body.rateLimited).toBe(true);
      return; // test skippé gracieusement
    }
    expect(Array.isArray(res.body.results)).toBe(true);
    if (res.body.results.length > 0) {
      const r = res.body.results[0];
      // Le SIRET vient bien de siege.siret (14 chiffres)
      expect(r.siret).toMatch(/^\d{14}$/);
      expect(r.siren).toMatch(/^\d{9}$/);
      expect(r.raisonSociale).toBeTruthy();
    }
  });

  test("3. La confirmation du profil persiste les données company.*", async () => {
    const res = await api().post("/api/onboarding/profil/confirmer", {
      siret: "35600000000048",
      siren: "356000000",
      raison_sociale: "LA POSTE",
      forme_juridique: "5510",
      adresse: "9 RUE DU COLONEL PIERRE AVIA",
      code_postal: "75015",
      commune: "PARIS",
      code_naf: "53.10Z",
      pack_metier: "generique",
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test("4. Le profil contient maintenant le SIRET confirmé", async () => {
    const res = await api().get("/api/onboarding/profil");
    expect(res.status).toBe(200);
    expect(res.body.profile["company.siret"]).toBe("35600000000048");
    expect(res.body.profile["company.raison_sociale"]).toBe("LA POSTE");
    expect(res.body.profile["company.pack_metier"]).toBe("generique");
  });

  test("5. Les blocs de reprise sont accessibles et initialement tous non passés", async () => {
    const res = await api().get("/api/reprise/blocs");
    expect(res.status).toBe(200);
    expect(res.body.blocs).toHaveLength(6);
    // Aucun bloc ne doit être passé pour ce tenant fraîchement créé
    expect(res.body.blocs_passes).toEqual([]);
  });

  test("6. Valider le bloc ca_ytd persiste les valeurs et marque le bloc done", async () => {
    const res = await api().post("/api/reprise/blocs/ca_ytd", {
      data: { ca_facture_ytd: 85000, ca_encaisse_ytd: 72000, date_debut_exercice: "2026-01-01" },
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const state = await api().get("/api/reprise/blocs");
    expect(state.body.blocs_passes).toContain("ca_ytd");
  });

  test("7. Les valeurs ca_ytd sont lisibles depuis le profil", async () => {
    const res = await api().get("/api/onboarding/profil");
    expect(res.status).toBe(200);
    expect(res.body.profile["reprise.ca_facture_ytd"]).toBe("85000");
    expect(res.body.profile["reprise.ca_encaisse_ytd"]).toBe("72000");
    expect(res.body.profile["reprise.date_debut_exercice"]).toBe("2026-01-01");
  });

  test("8. Passer un bloc le marque done sans erreur", async () => {
    const res = await api().post("/api/reprise/blocs/planning", { passer: true });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.donneesInsuffisantes).toBeFalsy();

    const state = await api().get("/api/reprise/blocs");
    expect(state.body.blocs_passes).toContain("planning");
  });

  test("9. Payload montant invalide (string non numérique) → 400 sans marquer done", async () => {
    const before = await api().get("/api/reprise/blocs");
    const passesBefore = new Set<string>(before.body.blocs_passes as string[]);

    const res = await api().post("/api/reprise/blocs/impay%C3%A9s", {
      data: { "impayés": [{ client: "Client Test", montant: "abc", dateFacture: "2026-01-01" }] },
    });
    expect(res.status).toBe(400);

    // Le bloc ne doit pas être passé
    const after = await api().get("/api/reprise/blocs");
    expect(after.body.blocs_passes).toEqual(before.body.blocs_passes);
  });
});
