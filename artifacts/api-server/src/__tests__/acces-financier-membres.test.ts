/**
 * Accès financier (OWNER + ACCOUNTANT) et gestion des membres/invitations.
 *
 * Trois volets :
 * - Les routeurs exclusivement financiers refusent un MEMBER (403) et
 *   laissent passer OWNER/ACCOUNTANT.
 * - Les champs financiers d'affaires/contrats/cockpit sont `null` pour un
 *   MEMBER, présents pour OWNER/ACCOUNTANT (jamais `0` — voir
 *   maskFinancialFields.ts).
 * - `/membres/*` : lecture/écriture réservée à OWNER. US-A5.1 — plusieurs
 *   OWNER à égalité sont possibles PAR INVITATION d'un OWNER existant (Zod
 *   ET la contrainte CHECK en base l'acceptent désormais, éprouvés
 *   séparément) ; la PROMOTION d'un membre déjà présent en OWNER via
 *   `PATCH .../role` reste refusée, ainsi que sa démotion — seule
 *   l'invitation crée un co-OWNER. Le DERNIER OWNER d'un tenant reste
 *   protégé contre la révocation (`DELETE`), mais plus que lui : la garde
 *   est un comptage, pas un blocage inconditionnel. Couvre aussi le flux
 *   d'acceptation d'invitation (compte existant / nouveau compte, jeton
 *   réutilisé/expiré) et l'isolation par tenant de `memberships`/`users` —
 *   des tables INFRA sans RLS, filtrées à la main (voir membres.ts), donc
 *   pas couvertes par la garde RLS générique de rls.test.ts.
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
  completeMfaForRegisteredOwner,
  serveurTest,
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
  get: (u: string) => request(serveurTest(app)).get(u).set("Cookie", cookie),
  post: (u: string, b?: unknown) => request(serveurTest(app)).post(u).set("Cookie", cookie).send((b ?? {}) as Record<string, unknown>),
  patch: (u: string, b?: unknown) => request(serveurTest(app)).patch(u).set("Cookie", cookie).send((b ?? {}) as Record<string, unknown>),
  delete: (u: string) => request(serveurTest(app)).delete(u).set("Cookie", cookie),
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

  test("GET /api/cockpit/kpis — chiffreAffairesMois/totalImpayeCents/treasuryBalanceCents/monthlySeries/ytd null pour MEMBER", async () => {
    const resMember = await as(cookieMember).get("/api/cockpit/kpis");
    expect(resMember.status).toBe(200);
    expect(resMember.body.chiffreAffairesMois).toBeNull();
    expect(resMember.body.totalImpayeCents).toBeNull();
    expect(resMember.body.treasuryBalanceCents).toBeNull();
    expect(resMember.body.monthlySeries).toBeNull();
    expect(resMember.body.ytd).toBeNull();

    const resAcct = await as(cookieAccountant).get("/api/cockpit/kpis");
    expect(resAcct.status).toBe(200);
    expect(typeof resAcct.body.chiffreAffairesMois).toBe("number");
    expect(typeof resAcct.body.totalImpayeCents).toBe("number");
    // Pas encore connecté dans ce fixture — treasuryBalanceCents reste null
    // même pour un rôle financier, distinct d'un masquage.
    expect(resAcct.body.treasuryBalanceCents).toBeNull();
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

  test("POST /api/membres/inviter → role OWNER accepté (US-A5.1) : Zod et la contrainte CHECK l'autorisent désormais", async () => {
    const email = `af-invite-owner-${Date.now()}@test.nodaq`;
    const res = await as(cookieOwner).post("/api/membres/inviter", { email, role: "OWNER", libelle: "Associée fondatrice" });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe("OWNER");
    expect(res.body.libelle).toBe("Associée fondatrice");

    const { rows } = await adminPool.query("SELECT role, libelle FROM tenant_invites WHERE email = $1", [email.toLowerCase()]);
    expect(rows[0]?.role).toBe("OWNER");
    expect(rows[0]?.libelle).toBe("Associée fondatrice");
  });

  test("un MEMBER ne peut pas inviter (donc a fortiori pas inviter un OWNER) — inviter-en-OWNER n'élève jamais un privilège qu'un OWNER n'avait pas déjà", async () => {
    const email = `af-invite-owner-member-${Date.now()}@test.nodaq`;
    const res = await as(cookieMember).post("/api/membres/inviter", { email, role: "OWNER" });
    expect(res.status).toBe(403);
  });

  test("PATCH /api/membres/:id/role — la PROMOTION d'un MEMBER en OWNER est refusée (seule l'invitation crée un co-OWNER)", async () => {
    const res = await as(cookieOwner).patch(`/api/membres/${memberMembershipId}/role`, { role: "OWNER" });
    expect(res.status).toBe(403);

    // Le membership visé n'a pas bougé.
    const { rows } = await adminPool.query("SELECT role FROM memberships WHERE id = $1", [memberMembershipId]);
    expect(rows[0]?.role).toBe("MEMBER");
  });

  test("PATCH /api/membres/:id/role — la DÉMOTION d'un OWNER est refusée", async () => {
    const res = await as(cookieOwner).patch(`/api/membres/${ownerMembershipId}/role`, { role: "ACCOUNTANT" });
    expect(res.status).toBe(403);
  });

  test("PATCH /api/membres/:id/role — un passage OWNER→OWNER est permis (met à jour libelle sans toucher au rôle)", async () => {
    const res = await as(cookieOwner).patch(`/api/membres/${ownerMembershipId}/role`, { role: "OWNER", libelle: "Gérant associé" });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("OWNER");
    expect(res.body.libelle).toBe("Gérant associé");
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

  test("DELETE /api/membres/:id — le DERNIER OWNER ne peut pas être révoqué (comptage, pas un blocage inconditionnel)", async () => {
    const res = await as(cookieOwner).delete(`/api/membres/${ownerMembershipId}`);
    expect(res.status).toBe(403);
  });

  test("US-A5.1 — cycle de vie complet d'un co-OWNER : invitation, acceptation, coexistence, révocation possible tant qu'il en reste un autre", async () => {
    const email = `af-coowner-${Date.now()}@test.nodaq`;
    emails.push(email);

    const invite = await as(cookieOwner).post("/api/membres/inviter", { email, role: "OWNER" });
    expect(invite.status).toBe(201);

    // Le jeton en clair ne transite jamais par l'API (voir plus bas dans ce
    // fichier) — on fabrique nous-mêmes une invitation OWNER acceptable,
    // même patron que les tests "Acceptation d'invitation" existants.
    const token = "coowner-token-" + crypto.randomUUID();
    const tokenSha256 = crypto.createHash("sha256").update(token).digest("hex");
    await adminPool.query(
      `INSERT INTO tenant_invites (id, tenant_id, email, role, token_sha256, invited_by, expires_at)
       VALUES ($1, $2, $3, 'OWNER', $4, $5, now() + interval '7 days')`,
      [crypto.randomUUID(), tenantId, email.toLowerCase(), tokenSha256, ownerUserId],
    );

    const accept = await request(serveurTest(app))
      .post(`/api/membres/inviter/${token}/accepter`)
      .send({ password: "Test1234!", nom: "Coowner Test" });
    expect(accept.status).toBe(200);
    expect(accept.body.role).toBe("OWNER");
    const setCookie = accept.headers["set-cookie"] as string[] | string | undefined;
    const coOwnerCookie = (Array.isArray(setCookie) ? setCookie : [setCookie ?? ""])
      .find((c) => c.startsWith("nodaq_sid=")) ?? "";
    // Le flux d'acceptation réel (contrairement à createTestSession, qui
    // pose mfa_verified_at directement) crée une session NON vérifiée MFA —
    // même garde que pour tout compte fraîchement créé.
    await completeMfaForRegisteredOwner(accept.body.userId);

    // La base compte bien 2 OWNER pour ce tenant — aucune erreur de
    // contrainte (memberships n'a jamais restreint le rôle, voir migration
    // 001 : seule UNIQUE (user_id, tenant_id) existe).
    const { rows: owners } = await adminPool.query(
      "SELECT id FROM memberships WHERE tenant_id = $1 AND role = 'OWNER'",
      [tenantId],
    );
    expect(owners.length).toBe(2);
    const coOwnerMembershipId = owners.find((o: { id: string }) => o.id !== ownerMembershipId)!.id;

    // Le co-OWNER franchit ownerOnly avec SA PROPRE session, indépendamment
    // du premier OWNER — pas de logique "premier arrivé" cachée
    // (requireRole/requireMembership ne lisent que la session de l'appelant).
    const listeVueParCoOwner = await request(serveurTest(app)).get("/api/membres").set("Cookie", coOwnerCookie);
    expect(listeVueParCoOwner.status).toBe(200);
    expect(listeVueParCoOwner.body.membres.some((m: { id: string }) => m.id === coOwnerMembershipId)).toBe(true);

    // Avec 2 OWNER, la révocation de l'un des deux devient possible.
    const revoke = await as(cookieOwner).delete(`/api/membres/${coOwnerMembershipId}`);
    expect(revoke.status).toBe(204);

    // Revenu à 1 seul OWNER : la garde du dernier OWNER s'applique de nouveau.
    const revokeLast = await as(cookieOwner).delete(`/api/membres/${ownerMembershipId}`);
    expect(revokeLast.status).toBe(403);
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
    const res = await request(serveurTest(app)).get("/api/membres/inviter/jeton-inexistant");
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

    const apercu = await request(serveurTest(app)).get(`/api/membres/inviter/${token}`);
    expect(apercu.status).toBe(200);
    expect(apercu.body.compteExistant).toBe(false);
    expect(apercu.body.email).toBe(email);
    expect(apercu.body.expire).toBe(false);
    expect(apercu.body.dejaAcceptee).toBe(false);

    const accept = await request(serveurTest(app))
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
    const second = await request(serveurTest(app))
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

    const apercu = await request(serveurTest(app)).get(`/api/membres/inviter/${token}`);
    expect(apercu.status).toBe(200);
    expect(apercu.body.expire).toBe(true);

    const accept = await request(serveurTest(app))
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

    const apercu = await request(serveurTest(app)).get(`/api/membres/inviter/${token}`);
    expect(apercu.status).toBe(200);
    expect(apercu.body.compteExistant).toBe(true);

    const wrongPassword = await request(serveurTest(app))
      .post(`/api/membres/inviter/${token}/accepter`)
      .send({ password: "mauvais-mot-de-passe" });
    expect(wrongPassword.status).toBe(401);

    const rightPassword = await request(serveurTest(app))
      .post(`/api/membres/inviter/${token}/accepter`)
      .send({ password });
    expect(rightPassword.status).toBe(200);
    expect(rightPassword.body.role).toBe("ACCOUNTANT");
  });
});

// ── Isolation entre tenants (US-A5.1, AC3) ──────────────────────────────────
// `memberships`/`users` sont des tables INFRA SANS RLS (voir l'en-tête de
// membres.ts) : leur isolation par tenant repose ENTIÈREMENT sur le filtre
// manuel `.where(eq(membershipsTable.tenantId, tenantId))` de la route, pas
// sur une policy postgres. C'est exactement le cas — deux structures
// distinctes, proches opérationnellement (un cabinet associatif partageant
// des moyens, par exemple) — que rls.test.ts (générique, RLS uniquement) ne
// peut pas éprouver pour cette route précise.
describe("Isolation entre tenants — memberships/users sans RLS (US-A5.1, AC3)", () => {
  test("GET /api/membres d'un tenant ne révèle jamais les membres/invitations d'un autre tenant, même proche opérationnellement", async () => {
    const tenantA = await createTestTenant("IsolationMembresA");
    const tenantB = await createTestTenant("IsolationMembresB");
    tenantIds.push(tenantA.id, tenantB.id);

    const emailA = `af-isol-a-${Date.now()}@test.nodaq`;
    const emailB = `af-isol-b-${Date.now()}@test.nodaq`;
    emails.push(emailA, emailB);
    const userA = await createTestUser(emailA, "Test1234!");
    const userB = await createTestUser(emailB, "Test1234!");
    await createTestMembership(userA.id, tenantA.id, "OWNER");
    await createTestMembership(userB.id, tenantB.id, "OWNER");
    const sessionA = await createTestSession(userA.id, tenantA.id);
    const cookieA = cookieHeader(sessionA.id);

    await adminPool.query(
      `INSERT INTO tenant_invites (id, tenant_id, email, role, token_sha256, invited_by, expires_at)
       VALUES ($1, $2, 'af-isol-invite-b@test.nodaq', 'MEMBER', 'isol-hash-b', $3, now() + interval '7 days')`,
      [crypto.randomUUID(), tenantB.id, userB.id],
    );

    const vueA = await request(serveurTest(app)).get("/api/membres").set("Cookie", cookieA);
    expect(vueA.status).toBe(200);
    expect(vueA.body.membres.every((m: { email: string }) => m.email !== emailB)).toBe(true);
    expect(vueA.body.invitationsEnAttente).toHaveLength(0);
  });
});
