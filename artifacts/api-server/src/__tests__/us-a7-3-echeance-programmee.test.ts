/**
 * US-A7.3 — Révocation d'accès programmée à l'avance.
 *
 * Ce que ces tests protègent :
 *   a. AC2, le cœur — une échéance posée sur un salarié ferme son accès dès la
 *      requête suivant la date, sans aucun geste manuel le jour venu. Et PAS
 *      avant : une date future ne doit rien fermer ;
 *   b. AC1 — inviter sans échéance reste possible pour tout rôle sauf VIEWER :
 *      la saisonnalité n'ajoute aucune étape obligatoire ;
 *   c. LA GARDE DU DERNIER OWNER — une révocation programmée est une
 *      révocation différée. Sans le même comptage que `DELETE`, elle serait la
 *      porte dérobée qui le contourne, et le tenant se retrouverait sans accès
 *      propriétaire à une date que plus personne ne surveille. Ce point ne
 *      figure dans aucun critère d'acceptation ;
 *   d. les invariants d'US-A5.4 survivent — un VIEWER garde toujours une fin
 *      d'accès, et une invitation VIEWER sans date reste refusée ;
 *   e. AC3 — une série de créations et de révocations n'ouvre aucune brèche.
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

const tenantIds: string[] = [];
const emails: string[] = [];
let tenantId: string;
let ownerCookie: string;

async function marquerMfaEnrole(userId: string): Promise<void> {
  await adminPool.query(`UPDATE users SET mfa_enabled_at = now() WHERE id = $1`, [userId]);
}

async function creerMembre(
  role: "OWNER" | "MEMBER" | "ACCOUNTANT" | "VIEWER",
  label: string,
  expiresAt: Date | null = null,
): Promise<{ userId: string; membershipId: string; cookie: string }> {
  const email = `a73-${label}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const user = await createTestUser(email);
  const { rows } = await adminPool.query<{ id: string }>(
    "INSERT INTO memberships (id, user_id, tenant_id, role, expires_at) VALUES (gen_random_uuid(), $1, $2, $3, $4) RETURNING id",
    [user.id, tenantId, role, expiresAt],
  );
  await marquerMfaEnrole(user.id);
  const session = await createTestSession(user.id, tenantId);
  return { userId: user.id, membershipId: rows[0]!.id, cookie: cookieHeader(session.id) };
}

beforeAll(async () => {
  const tenant = await createTestTenant("A73-Echeance");
  tenantId = tenant.id;
  tenantIds.push(tenant.id);
  // Deux OWNER : la plupart des cas ont besoin d'un propriétaire qui agit sans
  // être « le dernier ».
  const o1 = await creerMembre("OWNER", "owner-1");
  await creerMembre("OWNER", "owner-2");
  ownerCookie = o1.cookie;
});

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
});

// ── a. AC2 — la fermeture se fait toute seule ──────────────────────────────

describe("a — AC2 : l'accès se ferme à l'échéance, sans geste le jour venu", () => {
  test("une échéance future ne ferme rien ; une fois passée, l'accès tombe à la requête suivante", async () => {
    const saisonnier = await creerMembre("MEMBER", "saisonnier");

    // Programmée pour dans un mois : rien ne change aujourd'hui.
    const prog = await request(app)
      .patch(`/api/membres/${saisonnier.membershipId}/echeance`)
      .set("Cookie", ownerCookie)
      .send({ expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString() })
      .expect(200);
    expect(prog.body.expiresAt).toBeTruthy();

    const avant = await request(app).get("/api/cockpit/kpis").set("Cookie", saisonnier.cookie);
    expect(avant.status).toBe(200);

    // Le jour venu — simulé en base, exactement comme le temps le ferait.
    // AUCUNE action de l'employeur entre les deux.
    await adminPool.query(
      "UPDATE memberships SET expires_at = now() - interval '1 minute' WHERE id = $1",
      [saisonnier.membershipId],
    );

    const apres = await request(app).get("/api/cockpit/kpis").set("Cookie", saisonnier.cookie);
    expect(apres.status).toBe(403);
    expect(apres.body.error).toMatch(/expir/i);
  });

  test("une date déjà passée est refusée — on programme, on ne rétrodate pas", async () => {
    const m = await creerMembre("MEMBER", "retro");
    const res = await request(app)
      .patch(`/api/membres/${m.membershipId}/echeance`)
      .set("Cookie", ownerCookie)
      .send({ expiresAt: new Date(Date.now() - 86_400_000).toISOString() });
    expect(res.status).toBe(400);
  });

  test("l'échéance se repousse — un contrat prolongé ne demande pas de réinviter", async () => {
    const m = await creerMembre("MEMBER", "prolonge", new Date(Date.now() + 86_400_000));
    const nouvelle = new Date(Date.now() + 60 * 86_400_000);
    const res = await request(app)
      .patch(`/api/membres/${m.membershipId}/echeance`)
      .set("Cookie", ownerCookie)
      .send({ expiresAt: nouvelle.toISOString() })
      .expect(200);
    expect(new Date(res.body.expiresAt).getTime()).toBe(nouvelle.getTime());
  });

  test("l'échéance se retire pour un salarié qui devient permanent", async () => {
    const m = await creerMembre("MEMBER", "permanent", new Date(Date.now() + 86_400_000));
    const res = await request(app)
      .patch(`/api/membres/${m.membershipId}/echeance`)
      .set("Cookie", ownerCookie)
      .send({ expiresAt: null })
      .expect(200);
    expect(res.body.expiresAt).toBeNull();
  });
});

// ── b. AC1 — aucune étape supplémentaire ───────────────────────────────────

describe("b — AC1 : la saisonnalité n'impose aucune étape de plus", () => {
  test("inviter un MEMBER sans date reste possible", async () => {
    const email = `a73-invite-sans-date-${Date.now()}@test.nodaq`;
    emails.push(email);
    const res = await request(app)
      .post("/api/membres/inviter")
      .set("Cookie", ownerCookie)
      .send({ email, role: "MEMBER" });
    expect(res.status).toBe(201);
  });

  test("inviter un MEMBER AVEC une date de fin est désormais accepté", async () => {
    // C'est le refus qu'US-A5.4 posait et qu'A7.3 lève : la fin de contrat se
    // programme dès l'invitation.
    const email = `a73-invite-avec-date-${Date.now()}@test.nodaq`;
    emails.push(email);
    const echeance = new Date(Date.now() + 90 * 86_400_000);
    const res = await request(app)
      .post("/api/membres/inviter")
      .set("Cookie", ownerCookie)
      .send({ email, role: "MEMBER", accesExpireAt: echeance.toISOString() })
      .expect(201);
    expect(new Date(res.body.accesExpireAt).getTime()).toBe(echeance.getTime());
  });
});

// ── c. La garde du dernier OWNER ───────────────────────────────────────────

describe("c — un propriétaire unique ne peut pas programmer sa propre sortie", () => {
  test("dernier OWNER → 403 ; avec un second OWNER → autorisé", async () => {
    // Un tenant à part, pour maîtriser le nombre de propriétaires.
    const t = await createTestTenant("A73-Dernier-Owner");
    tenantIds.push(t.id);

    const email = `a73-seul-owner-${Date.now()}@test.nodaq`;
    emails.push(email);
    const user = await createTestUser(email);
    const { rows } = await adminPool.query<{ id: string }>(
      "INSERT INTO memberships (id, user_id, tenant_id, role) VALUES (gen_random_uuid(), $1, $2, 'OWNER') RETURNING id",
      [user.id, t.id],
    );
    await marquerMfaEnrole(user.id);
    const session = await createTestSession(user.id, t.id);
    const cookie = cookieHeader(session.id);
    const seulOwnerId = rows[0]!.id;

    const refus = await request(app)
      .patch(`/api/membres/${seulOwnerId}/echeance`)
      .set("Cookie", cookie)
      .send({ expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(refus.status).toBe(403);
    expect(refus.body.error).toMatch(/dernier propriétaire/i);

    // Un second propriétaire, et la programmation devient légitime.
    const email2 = `a73-second-owner-${Date.now()}@test.nodaq`;
    emails.push(email2);
    const user2 = await createTestUser(email2);
    await createTestMembership(user2.id, t.id, "OWNER");

    const ok = await request(app)
      .patch(`/api/membres/${seulOwnerId}/echeance`)
      .set("Cookie", cookie)
      .send({ expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    expect(ok.status).toBe(200);
  });
});

// ── d. Les invariants d'US-A5.4 ────────────────────────────────────────────

describe("d — les garanties du tiers de confiance survivent", () => {
  test("retirer l'échéance d'un VIEWER → 403", async () => {
    const v = await creerMembre("VIEWER", "tiers", new Date(Date.now() + 86_400_000));
    const res = await request(app)
      .patch(`/api/membres/${v.membershipId}/echeance`)
      .set("Cookie", ownerCookie)
      .send({ expiresAt: null });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/date de fin/i);
  });

  test("inviter un VIEWER sans date reste refusé", async () => {
    const email = `a73-viewer-sans-date-${Date.now()}@test.nodaq`;
    emails.push(email);
    const res = await request(app)
      .post("/api/membres/inviter")
      .set("Cookie", ownerCookie)
      .send({ email, role: "VIEWER" });
    expect(res.status).toBe(400);
  });
});

// ── e. AC3 — le volume n'ouvre pas de brèche ───────────────────────────────

describe("e — AC3 : le volume ne fait sauter aucune étape de sécurité", () => {
  test("après une série de créations et de fermetures, aucune adhésion expirée ne repasse", async () => {
    const membres = [];
    for (let i = 0; i < 8; i++) {
      membres.push(await creerMembre(i % 2 === 0 ? "MEMBER" : "ACCOUNTANT", `vol-${i}`));
    }

    // La moitié voit son accès se fermer, l'autre non.
    for (const [i, m] of membres.entries()) {
      if (i % 2 === 0) {
        await adminPool.query(
          "UPDATE memberships SET expires_at = now() - interval '1 minute' WHERE id = $1",
          [m.membershipId],
        );
      }
    }

    for (const [i, m] of membres.entries()) {
      const res = await request(app).get("/api/cockpit/kpis").set("Cookie", m.cookie);
      if (i % 2 === 0) {
        expect(res.status, `le membre ${i} est expiré, il ne doit pas passer`).toBe(403);
      } else {
        // Toujours ouvert — et toujours soumis aux mêmes contrôles : ces
        // comptes sont MFA-enrôlés, sinon `requireMfaVerified` les bloquerait.
        expect(res.status, `le membre ${i} n'est pas expiré, il doit passer`).toBe(200);
      }
    }
  });
});
