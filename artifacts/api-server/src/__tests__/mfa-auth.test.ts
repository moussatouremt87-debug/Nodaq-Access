/**
 * MFA (TOTP) — ticket 4.15, phase 1.
 *
 * Ce que ces tests protègent :
 *   a. OWNER/ACCOUNTANT sans MFA enrôlé → toute route `biz` → 403, mais
 *      /api/mfa/* restent atteignables sur la même session (sinon un OWNER
 *      neuf ne pourrait jamais s'enrôler) ;
 *   b. MEMBER n'est JAMAIS bloqué, quel que soit son état MFA — non-régression ;
 *   c. un code d'enrôlement FAUX ne persiste RIEN — le compte reste non enrôlé ;
 *   d. le MFA se prouve UNE FOIS PAR SESSION, pas une fois pour toutes — une
 *      deuxième session du même utilisateur, déjà enrôlé, reste bloquée tant
 *      qu'elle n'a pas elle-même appelé /mfa/verify ;
 *   e. les codes de récupération sont à usage UNIQUE, et jamais stockés en
 *      clair (hash bcrypt) ;
 *   f. le secret TOTP est illisible en dump brut (format `v1:...`, comme
 *      tenant_secrets — voir secrets-chiffres.test.ts) ;
 *   g. /api/auth/login rend le bon `mfaStatus`, sans tenantId ni role tant
 *      que le second facteur n'est pas prouvé.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { genererCodeCourant } from "../lib/totp";
import {
  adminPool,
  cookieHeader,
  createTestTenant,
  createTestUser,
  createTestMembership,
  createTestSession,
  cleanupTenants,
  cleanupUsers,
} from "./helpers";

let tenantId: string;
const tenantIds: string[] = [];
const emails: string[] = [];

interface Fixture { userId: string; email: string; password: string }

async function creerUtilisateur(
  role: "OWNER" | "ACCOUNTANT" | "MEMBER",
  label: string,
): Promise<Fixture> {
  const email = `mfa-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.nodaq`;
  emails.push(email);
  const password = "Test1234!";
  const user = await createTestUser(email, password);
  await createTestMembership(user.id, tenantId, role);
  return { userId: user.id, email, password };
}

/** Session « en attente » — mfaVerified=false, comme un login qui vient de se produire. */
async function sessionEnAttente(userId: string): Promise<string> {
  const session = await createTestSession(userId, tenantId, undefined, false);
  return cookieHeader(session.id);
}

beforeAll(async () => {
  const tenant = await createTestTenant("MFA-Test");
  tenantId = tenant.id;
  tenantIds.push(tenant.id);
});

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
});

// ── a. OWNER/ACCOUNTANT non enrôlé → biz bloqué, /mfa/* atteignable ──────────

describe("a — bloqué avant MFA, mais /mfa/* reste atteignable", () => {
  test("OWNER sans MFA enrôlé → 403 sur une route biz, mfaStatus enroll_required", async () => {
    const u = await creerUtilisateur("OWNER", "owner-bloque");
    const cookie = await sessionEnAttente(u.userId);

    const res = await request(app).get("/api/cockpit/kpis").set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("mfa_required");
    expect(res.body.mfaStatus).toBe("enroll_required");
  });

  test("ACCOUNTANT sans MFA enrôlé → 403 sur une route financière", async () => {
    const u = await creerUtilisateur("ACCOUNTANT", "accountant-bloque");
    const cookie = await sessionEnAttente(u.userId);

    const res = await request(app).get("/api/cockpit/kpis").set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("mfa_required");
  });

  test("/api/mfa/status et /api/mfa/enroll restent 200 pour une session bloquée", async () => {
    const u = await creerUtilisateur("OWNER", "owner-mfa-routes");
    const cookie = await sessionEnAttente(u.userId);

    const statut = await request(app).get("/api/mfa/status").set("Cookie", cookie);
    expect(statut.status).toBe(200);
    expect(statut.body.enabled).toBe(false);

    const enrol = await request(app).post("/api/mfa/enroll").set("Cookie", cookie);
    expect(enrol.status).toBe(200);
    expect(enrol.body.secret).toBeTruthy();
    expect(enrol.body.qrDataUri).toMatch(/^data:image\/png;base64,/);
  });
});

// ── b. MEMBER jamais bloqué ───────────────────────────────────────────────────

describe("b — MEMBER n'est jamais bloqué par requireMfaVerified", () => {
  test("MEMBER, session en attente (mfa_verified_at NULL) → route biz accessible", async () => {
    const u = await creerUtilisateur("MEMBER", "membre");
    const cookie = await sessionEnAttente(u.userId);

    const res = await request(app).get("/api/cockpit/kpis").set("Cookie", cookie);
    expect(res.status).toBe(200);
  });
});

// ── c, d. Enrôlement : code faux ne persiste rien, code correct déverrouille ─
// CETTE session, pas les autres.

describe("c, d — enrôlement et portée par session", () => {
  test("code faux → 400, rien persisté, route biz toujours bloquée ; code correct → déverrouille CETTE session, pas une autre", async () => {
    const u = await creerUtilisateur("OWNER", "owner-enrolement");
    const cookie1 = await sessionEnAttente(u.userId);

    const { body: enrol } = await request(app)
      .post("/api/mfa/enroll")
      .set("Cookie", cookie1)
      .expect(200);
    const { secret } = enrol as { secret: string };

    // Code faux — RIEN ne doit être persisté.
    const mauvais = await request(app)
      .post("/api/mfa/verify")
      .set("Cookie", cookie1)
      .send({ secret, code: "000000" });
    expect(mauvais.status).toBe(400);

    const { rows: avant } = await adminPool.query(
      `SELECT mfa_enabled_at FROM users WHERE id = $1`,
      [u.userId],
    );
    expect(avant[0].mfa_enabled_at).toBeNull();

    const bloqueEncore = await request(app).get("/api/cockpit/kpis").set("Cookie", cookie1);
    expect(bloqueEncore.status).toBe(403);

    // Code correct — termine l'enrôlement pour CETTE session.
    const codeCorrect = await genererCodeCourant(secret);
    const bon = await request(app)
      .post("/api/mfa/verify")
      .set("Cookie", cookie1)
      .send({ secret, code: codeCorrect });
    expect(bon.status).toBe(200);
    expect(bon.body.recoveryCodes).toHaveLength(10);

    const { rows: apres } = await adminPool.query(
      `SELECT mfa_enabled_at FROM users WHERE id = $1`,
      [u.userId],
    );
    expect(apres[0].mfa_enabled_at).not.toBeNull();

    const debloque = await request(app).get("/api/cockpit/kpis").set("Cookie", cookie1);
    expect(debloque.status).toBe(200);

    // Une DEUXIÈME session du même utilisateur maintenant enrôlé : toujours
    // bloquée — le MFA se prouve par session, pas une fois pour toutes.
    const cookie2 = await sessionEnAttente(u.userId);
    const session2Bloquee = await request(app).get("/api/cockpit/kpis").set("Cookie", cookie2);
    expect(session2Bloquee.status).toBe(403);
    expect(session2Bloquee.body.mfaStatus).toBe("verify_required");

    // Cette session vérifie à son tour (chemin normal, sans `secret`) — et SE
    // débloque, elle, sans affecter les autres.
    const codeCourant = await genererCodeCourant(secret);
    const verif2 = await request(app)
      .post("/api/mfa/verify")
      .set("Cookie", cookie2)
      .send({ code: codeCourant });
    expect(verif2.status).toBe(200);

    const session2Debloquee = await request(app).get("/api/cockpit/kpis").set("Cookie", cookie2);
    expect(session2Debloquee.status).toBe(200);
  });
});

// ── e. Codes de récupération — usage unique, jamais en clair ─────────────────

describe("e — codes de récupération", () => {
  test("un code consommé débloque une session, mais ne peut pas être réutilisé", async () => {
    const u = await creerUtilisateur("OWNER", "owner-recuperation");
    const cookie1 = await sessionEnAttente(u.userId);

    const { body: enrol } = await request(app)
      .post("/api/mfa/enroll")
      .set("Cookie", cookie1)
      .expect(200);
    const codeCorrect = await genererCodeCourant(enrol.secret);
    const { body: fin } = await request(app)
      .post("/api/mfa/verify")
      .set("Cookie", cookie1)
      .send({ secret: enrol.secret, code: codeCorrect })
      .expect(200);
    const codeRecuperation = fin.recoveryCodes[0] as string;

    // Une nouvelle session, bloquée, débloquée via le code de récupération.
    const cookie2 = await sessionEnAttente(u.userId);
    const premiereUtilisation = await request(app)
      .post("/api/mfa/recovery")
      .set("Cookie", cookie2)
      .send({ code: codeRecuperation });
    expect(premiereUtilisation.status).toBe(200);
    const debloquee = await request(app).get("/api/cockpit/kpis").set("Cookie", cookie2);
    expect(debloquee.status).toBe(200);

    // Réutilisation du MÊME code, sur une AUTRE session bloquée → refusé.
    const cookie3 = await sessionEnAttente(u.userId);
    const reutilisation = await request(app)
      .post("/api/mfa/recovery")
      .set("Cookie", cookie3)
      .send({ code: codeRecuperation });
    expect(reutilisation.status).toBe(400);
    const toujoursBloquee = await request(app).get("/api/cockpit/kpis").set("Cookie", cookie3);
    expect(toujoursBloquee.status).toBe(403);

    // Jamais stockés en clair : chaque hash ressemble à un hash bcrypt, pas au code.
    const { rows } = await adminPool.query(
      `SELECT mfa_recovery_codes FROM users WHERE id = $1`,
      [u.userId],
    );
    const codes = rows[0].mfa_recovery_codes as Array<{ hash: string; usedAt: string | null }>;
    expect(codes).toHaveLength(10);
    for (const c of codes) {
      expect(c.hash).toMatch(/^\$2[aby]\$/);
      expect(c.hash).not.toBe(codeRecuperation);
    }
    expect(codes.filter((c) => c.usedAt !== null)).toHaveLength(1);
  });
});

// ── f. Secret illisible en dump brut ──────────────────────────────────────────

describe("f — secret TOTP illisible en base", () => {
  test("mfa_secret_chiffre ne contient jamais le secret en clair, et respecte le format v1:", async () => {
    const u = await creerUtilisateur("OWNER", "owner-secret-illisible");
    const cookie = await sessionEnAttente(u.userId);

    const { body: enrol } = await request(app)
      .post("/api/mfa/enroll")
      .set("Cookie", cookie)
      .expect(200);
    const codeCorrect = await genererCodeCourant(enrol.secret);
    await request(app)
      .post("/api/mfa/verify")
      .set("Cookie", cookie)
      .send({ secret: enrol.secret, code: codeCorrect })
      .expect(200);

    const { rows } = await adminPool.query(
      `SELECT to_jsonb(u) AS ligne, mfa_secret_chiffre FROM users u WHERE id = $1`,
      [u.userId],
    );
    expect(JSON.stringify(rows[0].ligne)).not.toContain(enrol.secret);
    const parts = String(rows[0].mfa_secret_chiffre).split(":");
    expect(parts[0]).toBe("v1");
    expect(parts).toHaveLength(5);
  });
});

// ── g. /api/auth/login — mfaStatus correct, sans fuite avant preuve ──────────

describe("g — POST /api/auth/login reflète l'état MFA sans fuiter tenantId/role", () => {
  test("OWNER jamais enrôlé → enroll_required, sans tenantId ni role", async () => {
    const u = await creerUtilisateur("OWNER", "login-enroll");
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: u.email, password: u.password })
      .expect(200);
    expect(res.body.mfaStatus).toBe("enroll_required");
    expect(res.body.tenantId).toBeUndefined();
    expect(res.body.role).toBeUndefined();
  });

  test("OWNER déjà enrôlé → verify_required, sans tenantId ni role", async () => {
    const u = await creerUtilisateur("OWNER", "login-verify");
    const cookie = await sessionEnAttente(u.userId);
    const { body: enrol } = await request(app)
      .post("/api/mfa/enroll")
      .set("Cookie", cookie)
      .expect(200);
    const codeCorrect = await genererCodeCourant(enrol.secret);
    await request(app)
      .post("/api/mfa/verify")
      .set("Cookie", cookie)
      .send({ secret: enrol.secret, code: codeCorrect })
      .expect(200);

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: u.email, password: u.password })
      .expect(200);
    expect(res.body.mfaStatus).toBe("verify_required");
    expect(res.body.tenantId).toBeUndefined();
    expect(res.body.role).toBeUndefined();
  });

  test("MEMBER → réponse inchangée, aucun champ mfaStatus", async () => {
    const u = await creerUtilisateur("MEMBER", "login-membre");
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: u.email, password: u.password })
      .expect(200);
    expect(res.body.tenantId).toBe(tenantId);
    expect(res.body.role).toBe("MEMBER");
    expect(res.body.mfaStatus).toBeUndefined();
  });
});
