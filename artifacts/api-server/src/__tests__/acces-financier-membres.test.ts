/**
 * Accès financier (OWNER + ACCOUNTANT) et gestion des membres/invitations.
 *
 * Trois volets :
 * - Les routeurs exclusivement financiers refusent un MEMBER (403) et
 *   laissent passer OWNER/ACCOUNTANT.
 * - Les champs financiers d'affaires/contrats/cockpit sont `null` pour un
 *   MEMBER, présents pour OWNER/ACCOUNTANT (jamais `0` — voir
 *   maskFinancialFields.ts).
 * - `/membres/*` : lecture/écriture réservée à OWNER, garde explicite contre
 *   la modification d'un membership OWNER, et le flux d'acceptation
 *   d'invitation (compte existant / nouveau compte, jeton réutilisé/expiré).
 *   Le rôle OWNER par invitation est refusé à la fois par Zod ET par la
 *   contrainte CHECK en base — les deux sont éprouvées séparément.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
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
} from "./helpers";

let tenantId: string;
let cookieOwner: string;
let cookieMember: string;
let cookieAccountant: string;
let ownerUserId: string;
let memberMembershipId: string;
let ownerMembershipId: string;
const tenantIds: string[] = [];
const emails: string[] = [];

beforeAll(async () => {
  const tenant = await createTestTenant("AccesFinancierMembres");
  tenantId = tenant.id;
  tenantIds.push(tenant.id);

  for (const [role, label] of [
    ["OWNER", "owner"],
    ["MEMBER", "member"],
    ["ACCOUNTANT", "accountant"],
  ] as const) {
    const email = `af-${label}-${Date.now()}@test.nodaq`;
    emails.push(email);
    const user = await createTestUser(email, "Test1234!");
    await createTestMembership(user.id, tenant.id, role);
    const session = await createTestSession(user.id, tenant.id);
    if (role === "OWNER") { cookieOwner = cookieHeader(session.id); ownerUserId = user.id; }
    if (role === "MEMBER") cookieMember = cookieHeader(session.id);
    if (role === "ACCOUNTANT") cookieAccountant = cookieHeader(session.id);
  }

  const { rows } = await adminPool.query<{ id: string; role: string }>(
    "SELECT id, role FROM memberships WHERE tenant_id = $1",
    [tenantId],
  );
  ownerMembershipId = rows.find((r) => r.role === "OWNER")!.id;
  memberMembershipId = rows.find((r) => r.role === "MEMBER")!.id;
});

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
});

const as = (cookie: string) => ({
  get: (u: string) => request(app).get(u).set("Cookie", cookie),
  post: (u: string, b?: unknown) => request(app).post(u).set("Cookie", cookie).send((b ?? {}) as Record<string, unknown>),
  patch: (u: string, b?: unknown) => request(app).patch(u).set("Cookie", cookie).send((b ?? {}) as Record<string, unknown>),
  delete: (u: string) => request(app).delete(u).set("Cookie", cookie),
});

// ── Verrouillage des routeurs exclusivement financiers ──────────────────────

describe("Verrouillage des routeurs financiers", () => {
  const endpoints = [
    "/api/echeances",
    "/api/marge",
    "/api/rapports/mensuel",
    "/api/compte-resultat",
    "/api/factures",
    "/api/avoirs",
    "/api/analytics/indicateurs",
    "/api/paiements",
  ];

  test.each(endpoints)("%s → 403 pour un MEMBER", async (path) => {
    const res = await as(cookieMember).get(path);
    expect(res.status).toBe(403);
  });

  test.each(endpoints)("%s → pas 403 pour un OWNER", async (path) => {
    const res = await as(cookieOwner).get(path);
    expect(res.status).not.toBe(403);
  });

  test.each(endpoints)("%s → pas 403 pour un ACCOUNTANT", async (path) => {
    const res = await as(cookieAccountant).get(path);
    expect(res.status).not.toBe(403);
  });
});

// ── Masquage des champs financiers (affaires/contrats/cockpit) ──────────────

describe("Masquage des champs financiers", () => {
  test("GET /api/affaires/stats — totalPipelineValueCents null pour MEMBER, nombre pour OWNER", async () => {
    const resMember = await as(cookieMember).get("/api/affaires/stats");
    expect(resMember.status).toBe(200);
    expect(resMember.body.totalPipelineValueCents).toBeNull();

    const resOwner = await as(cookieOwner).get("/api/affaires/stats");
    expect(resOwner.status).toBe(200);
    expect(typeof resOwner.body.totalPipelineValueCents).toBe("number");
  });

  test("GET /api/affaires — montants masqués pour MEMBER, visibles pour OWNER", async () => {
    const created = await as(cookieOwner).post("/api/affaires", {
      label: "Affaire masquage",
      quotedAmountCents: 123456,
    });
    expect(created.status).toBe(201);

    const resMember = await as(cookieMember).get("/api/affaires");
    expect(resMember.status).toBe(200);
    expect(resMember.body.totalQuotedCents).toBeNull();
    const affaireMember = resMember.body.affaires.find((a: { label: string }) => a.label === "Affaire masquage");
    expect(affaireMember.quotedAmountCents).toBeNull();

    const resOwner = await as(cookieOwner).get("/api/affaires");
    const affaireOwner = resOwner.body.affaires.find((a: { label: string }) => a.label === "Affaire masquage");
    expect(affaireOwner.quotedAmountCents).toBe(123456);
  });

  test("GET /api/affaires — montantVenduHt (reprise) masqué comme les autres montants ; avancementPct/dateFinPrevue restent visibles pour un MEMBER", async () => {
    const created = await as(cookieOwner).post("/api/affaires", { label: "Affaire reprise" });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const updated = await as(cookieOwner).patch(`/api/affaires/${id}`, {
      montantVenduHt: 850000,
      avancementPct: 40,
      dateFinPrevue: "2026-10-15",
    });
    expect(updated.status).toBe(200);

    const resMember = await as(cookieMember).get(`/api/affaires/${id}`);
    expect(resMember.status).toBe(200);
    expect(resMember.body.montantVenduHt).toBeNull();
    expect(resMember.body.avancementPct).toBe(40);
    expect(resMember.body.dateFinPrevue).toBe("2026-10-15");

    const resOwner = await as(cookieOwner).get(`/api/affaires/${id}`);
    expect(resOwner.body.montantVenduHt).toBe(850000);
    expect(resOwner.body.avancementPct).toBe(40);

    const listMember = await as(cookieMember).get("/api/affaires");
    const rowMember = listMember.body.affaires.find((a: { id: string }) => a.id === id);
    expect(rowMember.montantVenduHt).toBeNull();
  });

  test("GET /api/affaires — le total et la liste retombent sur montantVenduHt quand quotedAmountCents est absent (reprise)", async () => {
    const created = await as(cookieOwner).post("/api/affaires", { label: "Affaire reprise sans devis" });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    await as(cookieOwner).patch(`/api/affaires/${id}`, { montantVenduHt: 200000 });

    const res = await as(cookieOwner).get("/api/affaires");
    expect(res.status).toBe(200);
    const row = res.body.affaires.find((a: { id: string }) => a.id === id);
    expect(row.quotedAmountCents).toBeNull();
    expect(row.montantVenduHt).toBe(200000);
    expect(res.body.totalQuotedCents).toBeGreaterThanOrEqual(200000);
  });

  test("GET /api/contrats — amountCents masqué pour MEMBER, visible pour ACCOUNTANT", async () => {
    const created = await as(cookieOwner).post("/api/contrats", {
      label: "Contrat masquage",
      cadence: "mensuel",
      amountCents: 5000,
    });
    expect(created.status).toBe(201);

    const resMember = await as(cookieMember).get("/api/contrats");
    expect(resMember.status).toBe(200);
    const contratMember = resMember.body.find((c: { label: string }) => c.label === "Contrat masquage");
    expect(contratMember.amountCents).toBeNull();

    const resAcct = await as(cookieAccountant).get("/api/contrats");
    const contratAcct = resAcct.body.find((c: { label: string }) => c.label === "Contrat masquage");
    expect(contratAcct.amountCents).toBe(5000);
  });

  test("GET /api/cockpit/kpis — chiffreAffairesMois/totalImpayeCents/monthlySeries/ytd null pour MEMBER", async () => {
    const resMember = await as(cookieMember).get("/api/cockpit/kpis");
    expect(resMember.status).toBe(200);
    expect(resMember.body.chiffreAffairesMois).toBeNull();
    expect(resMember.body.totalImpayeCents).toBeNull();
    expect(resMember.body.monthlySeries).toBeNull();
    expect(resMember.body.ytd).toBeNull();

    const resAcct = await as(cookieAccountant).get("/api/cockpit/kpis");
    expect(resAcct.status).toBe(200);
    expect(typeof resAcct.body.chiffreAffairesMois).toBe("number");
    expect(typeof resAcct.body.totalImpayeCents).toBe("number");
    expect(Array.isArray(resAcct.body.monthlySeries)).toBe(true);
    expect(resAcct.body.ytd).not.toBeNull();
  });
});

// ── /membres — réservé au OWNER ──────────────────────────────────────────────

describe("Gestion des membres — réservée au OWNER", () => {
  test("GET /api/membres → 403 pour un MEMBER, 200 pour un OWNER", async () => {
    const resMember = await as(cookieMember).get("/api/membres");
    expect(resMember.status).toBe(403);

    const resOwner = await as(cookieOwner).get("/api/membres");
    expect(resOwner.status).toBe(200);
    expect(Array.isArray(resOwner.body.membres)).toBe(true);
    expect(resOwner.body.membres.length).toBeGreaterThanOrEqual(3);
  });

  test("POST /api/membres/inviter → 403 pour un MEMBER, 201 pour un OWNER", async () => {
    const email = `af-invite-${Date.now()}@test.nodaq`;
    const resMember = await as(cookieMember).post("/api/membres/inviter", { email, role: "MEMBER" });
    expect(resMember.status).toBe(403);

    const resOwner = await as(cookieOwner).post("/api/membres/inviter", { email, role: "ACCOUNTANT" });
    expect(resOwner.status).toBe(201);
    expect(resOwner.body.email).toBe(email.toLowerCase());
    expect(resOwner.body.role).toBe("ACCOUNTANT");

    const { rows } = await adminPool.query("SELECT role FROM tenant_invites WHERE email = $1", [email.toLowerCase()]);
    expect(rows[0]?.role).toBe("ACCOUNTANT");
  });

  test("POST /api/membres/inviter → role OWNER refusé par Zod (400)", async () => {
    const email = `af-invite-owner-${Date.now()}@test.nodaq`;
    const res = await as(cookieOwner).post("/api/membres/inviter", { email, role: "OWNER" });
    expect(res.status).toBe(400);
  });

  test("tenant_invites.role rejette OWNER par contrainte CHECK, indépendamment de Zod", async () => {
    await expect(
      adminPool.query(
        `INSERT INTO tenant_invites (id, tenant_id, email, role, token_sha256, invited_by, expires_at)
         VALUES ($1, $2, 'check-owner@test.nodaq', 'OWNER', 'check-owner-hash', $3, now() + interval '7 days')`,
        [crypto.randomUUID(), tenantId, ownerUserId],
      ),
    ).rejects.toThrow();
  });

  test("PATCH /api/membres/:id/role — ne peut jamais cibler un OWNER", async () => {
    const res = await as(cookieOwner).patch(`/api/membres/${ownerMembershipId}/role`, { role: "ACCOUNTANT" });
    expect(res.status).toBe(403);
  });

  test("PATCH /api/membres/:id/role → 403 pour un MEMBER, 200 pour un OWNER changeant un MEMBER", async () => {
    const resMember = await as(cookieMember).patch(`/api/membres/${memberMembershipId}/role`, { role: "ACCOUNTANT" });
    expect(resMember.status).toBe(403);

    const resOwner = await as(cookieOwner).patch(`/api/membres/${memberMembershipId}/role`, { role: "ACCOUNTANT" });
    expect(resOwner.status).toBe(200);
    expect(resOwner.body.role).toBe("ACCOUNTANT");

    // Remis à MEMBER pour ne pas perturber les autres tests de ce fichier.
    await as(cookieOwner).patch(`/api/membres/${memberMembershipId}/role`, { role: "MEMBER" });
  });

  test("DELETE /api/membres/:id — ne peut jamais révoquer un OWNER", async () => {
    const res = await as(cookieOwner).delete(`/api/membres/${ownerMembershipId}`);
    expect(res.status).toBe(403);
  });

  test("DELETE /api/membres/:id → 403 pour un MEMBER, 204 pour un OWNER révoquant un membership jetable", async () => {
    const user = await createTestUser(`af-revoke-${Date.now()}@test.nodaq`, "Test1234!");
    emails.push(user.email);
    await createTestMembership(user.id, tenantId, "MEMBER");
    const { rows } = await adminPool.query<{ id: string }>(
      "SELECT id FROM memberships WHERE tenant_id = $1 AND user_id = $2",
      [tenantId, user.id],
    );
    const membershipId = rows[0]!.id;

    const resMember = await as(cookieMember).delete(`/api/membres/${membershipId}`);
    expect(resMember.status).toBe(403);

    const resOwner = await as(cookieOwner).delete(`/api/membres/${membershipId}`);
    expect(resOwner.status).toBe(204);
  });
});

// ── Acceptation d'invitation (public, sans authentification) ────────────────
// Chaque invitation est insérée directement en base (invited_by = ownerUserId,
// qui référence users.id) : le jeton en clair ne transite jamais par l'API,
// donc le seul moyen d'en connaître un pour ces tests est de le fabriquer soi-même.

describe("Acceptation d'invitation — public", () => {
  test("GET /api/membres/inviter/:token — jeton inconnu → 404 indifférencié", async () => {
    const res = await request(app).get("/api/membres/inviter/jeton-inexistant");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Lien invalide ou expiré.");
  });

  test("un jeton valide pour un e-mail sans compte propose la création de compte", async () => {
    const email = `af-accept-new-${Date.now()}@test.nodaq`;
    const token = crypto.randomBytes(32).toString("hex");
    const tokenSha256 = crypto.createHash("sha256").update(token).digest("hex");
    await adminPool.query(
      `INSERT INTO tenant_invites (id, tenant_id, email, role, token_sha256, invited_by, expires_at)
       VALUES ($1, $2, $3, 'MEMBER', $4, $5, now() + interval '7 days')`,
      [crypto.randomUUID(), tenantId, email, tokenSha256, ownerUserId],
    );

    const apercu = await request(app).get(`/api/membres/inviter/${token}`);
    expect(apercu.status).toBe(200);
    expect(apercu.body.compteExistant).toBe(false);
    expect(apercu.body.email).toBe(email);
    expect(apercu.body.expire).toBe(false);
    expect(apercu.body.dejaAcceptee).toBe(false);

    const accept = await request(app)
      .post(`/api/membres/inviter/${token}/accepter`)
      .send({ nom: "Nouveau Collaborateur", password: "motdepasse123" });
    expect(accept.status).toBe(200);
    expect(accept.body.tenantId).toBe(tenantId);
    expect(accept.body.role).toBe("MEMBER");
    expect(accept.headers["set-cookie"]).toBeDefined();
    emails.push(email);

    const { rows } = await adminPool.query(
      "SELECT m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = $1 AND m.tenant_id = $2",
      [email, tenantId],
    );
    expect(rows[0]?.role).toBe("MEMBER");

    // Jeton déjà utilisé → 409, ne peut pas être ré-accepté.
    const second = await request(app)
      .post(`/api/membres/inviter/${token}/accepter`)
      .send({ nom: "Rejoue", password: "motdepasse123" });
    expect(second.status).toBe(409);
  });

  test("un jeton expiré est refusé (410), avant même la vérification du mot de passe", async () => {
    const email = `af-accept-expired-${Date.now()}@test.nodaq`;
    const token = crypto.randomBytes(32).toString("hex");
    const tokenSha256 = crypto.createHash("sha256").update(token).digest("hex");
    await adminPool.query(
      `INSERT INTO tenant_invites (id, tenant_id, email, role, token_sha256, invited_by, expires_at)
       VALUES ($1, $2, $3, 'MEMBER', $4, $5, now() - interval '1 day')`,
      [crypto.randomUUID(), tenantId, email, tokenSha256, ownerUserId],
    );

    const apercu = await request(app).get(`/api/membres/inviter/${token}`);
    expect(apercu.status).toBe(200);
    expect(apercu.body.expire).toBe(true);

    const accept = await request(app)
      .post(`/api/membres/inviter/${token}/accepter`)
      .send({ nom: "Trop tard", password: "motdepasse123" });
    expect(accept.status).toBe(410);
  });

  test("un compte existant doit fournir le bon mot de passe", async () => {
    const password = "motdepasse456";
    const user = await createTestUser(`af-accept-existing-${Date.now()}@test.nodaq`, password);
    emails.push(user.email);

    const token = crypto.randomBytes(32).toString("hex");
    const tokenSha256 = crypto.createHash("sha256").update(token).digest("hex");
    await adminPool.query(
      `INSERT INTO tenant_invites (id, tenant_id, email, role, token_sha256, invited_by, expires_at)
       VALUES ($1, $2, $3, 'ACCOUNTANT', $4, $5, now() + interval '7 days')`,
      [crypto.randomUUID(), tenantId, user.email, tokenSha256, ownerUserId],
    );

    const apercu = await request(app).get(`/api/membres/inviter/${token}`);
    expect(apercu.status).toBe(200);
    expect(apercu.body.compteExistant).toBe(true);

    const wrongPassword = await request(app)
      .post(`/api/membres/inviter/${token}/accepter`)
      .send({ password: "mauvais-mot-de-passe" });
    expect(wrongPassword.status).toBe(401);

    const rightPassword = await request(app)
      .post(`/api/membres/inviter/${token}/accepter`)
      .send({ password });
    expect(rightPassword.status).toBe(200);
    expect(rightPassword.body.role).toBe("ACCOUNTANT");
  });
});
