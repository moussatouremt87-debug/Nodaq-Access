/**
 * US-A5.4 — Accès en lecture seule pour un tiers de confiance.
 *
 * Ce que ces tests protègent :
 *   a. un `VIEWER` LIT les écrans du dossier financier — et y voit les
 *      montants EN CLAIR (il est dans `FINANCIAL_ROLES`) ;
 *   b. il n'écrit RIEN : toute méthode autre que GET est refusée, y compris
 *      sur un écran qu'il a le droit de lire ;
 *   c. il n'atteint QUE la liste blanche — et la garde ÉCHOUE FERMÉE : un
 *      chemin absent de la liste est refusé par défaut, ce qui est la
 *      propriété qui protégera les routeurs pas encore écrits. Testée pour
 *      elle-même, pas déduite des deux cas ci-dessus (règle 7 du CLAUDE.md) ;
 *   d. l'échéance ferme l'accès dès la requête SUIVANTE, sans reconnexion ;
 *   e. non-régression : une adhésion sans échéance (tous les rôles
 *      existants) n'est touchée par rien de tout cela ;
 *   f. l'invitation d'un tiers exige une date de fin, future ;
 *   g. `PATCH /membres/:id/role` ne fabrique pas de tiers permanent.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import { ECRANS_TIERS_LECTURE } from "@nodaq/shared";
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

/** Un `VIEWER` est dans FINANCIAL_ROLES : `requireMfaVerified` lui impose le
 *  second facteur, comme à un OWNER. Sans cet enrôlement, tout renverrait 403
 *  pour la mauvaise raison et les tests ne prouveraient rien. */
async function marquerMfaEnrole(userId: string): Promise<void> {
  await adminPool.query(`UPDATE users SET mfa_enabled_at = now() WHERE id = $1`, [userId]);
}

async function creerUtilisateur(
  role: "OWNER" | "MEMBER" | "ACCOUNTANT" | "VIEWER",
  label: string,
  expiresAt: Date | null = null,
): Promise<{ userId: string; email: string; cookie: string }> {
  const email = `a54-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.nodaq`;
  emails.push(email);
  const user = await createTestUser(email);
  // `createTestMembership` ne connaît pas l'échéance — poser le rôle puis la
  // date, plutôt que d'élargir un helper partagé par toute la suite.
  await adminPool.query(
    "INSERT INTO memberships (id, user_id, tenant_id, role, expires_at) VALUES (gen_random_uuid(), $1, $2, $3, $4)",
    [user.id, tenantId, role, expiresAt],
  );
  await marquerMfaEnrole(user.id);
  const session = await createTestSession(user.id, tenantId);
  return { userId: user.id, email, cookie: cookieHeader(session.id) };
}

beforeAll(async () => {
  const tenant = await createTestTenant("A54-Tiers-Lecture");
  tenantId = tenant.id;
  tenantIds.push(tenant.id);
});

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
});

// ── a, b. Lit le dossier financier, n'écrit rien ──────────────────────────

describe("a, b — le tiers lit le dossier financier et n'écrit rien", () => {
  test("GET sur un écran autorisé → 200, montants en clair", async () => {
    const v = await creerUtilisateur("VIEWER", "lecture");

    const cr = await request(app)
      .get("/api/compte-resultat?from=2026-01-01&to=2026-12-31")
      .set("Cookie", v.cookie);
    expect(cr.status).toBe(200);
    // Dans FINANCIAL_ROLES → aucun masquage : les totaux sont des nombres,
    // pas des `null` (voir maskFinancialFields, qui masque avec null).
    expect(typeof cr.body.totals.resultatExercice).toBe("number");

    const kpis = await request(app).get("/api/cockpit/kpis").set("Cookie", v.cookie);
    expect(kpis.status).toBe(200);
    expect(kpis.body.chiffreAffairesMois).not.toBeNull();
  });

  test("toute méthode autre que GET est refusée, même sur un écran autorisé", async () => {
    const v = await creerUtilisateur("VIEWER", "ecriture");

    const patch = await request(app)
      .patch("/api/compte-resultat/lignes")
      .set("Cookie", v.cookie)
      .send({ periodKey: "2026-01-01:2026-12-31", lines: [{ lineCode: "SALAIRES", amountCents: 1 }] });
    expect(patch.status).toBe(403);
    expect(patch.body.error).toMatch(/lecture seule/i);

    const post = await request(app)
      .post("/api/factures")
      .set("Cookie", v.cookie)
      .send({ clientName: "X", amountCents: 100 });
    expect(post.status).toBe(403);

    const del = await request(app).delete("/api/factures/nimporte-quoi").set("Cookie", v.cookie);
    expect(del.status).toBe(403);
  });

  test("un OWNER, lui, écrit toujours sur les mêmes routes — la garde ne vise que VIEWER", async () => {
    const o = await creerUtilisateur("OWNER", "owner-ecrit");
    const patch = await request(app)
      .patch("/api/compte-resultat/lignes")
      .set("Cookie", o.cookie)
      .send({ periodKey: "2026-01-01:2026-12-31", lines: [{ lineCode: "SALAIRES", amountCents: 4200 }] });
    expect(patch.status).toBe(200);
  });
});

// ── c. Liste blanche — et elle échoue FERMÉE ──────────────────────────────

describe("c — périmètre : liste blanche, refus par défaut", () => {
  test("les écrans hors liste blanche sont refusés, même en lecture", async () => {
    const v = await creerUtilisateur("VIEWER", "perimetre");

    for (const chemin of ["/api/prospects", "/api/chat/messages", "/api/classeur", "/api/affaires"]) {
      const res = await request(app).get(chemin).set("Cookie", v.cookie);
      expect(res.status, `${chemin} devrait être refusé`).toBe(403);
    }
  });

  /**
   * LA propriété structurelle de cette story. Un chemin qu'aucune route ne
   * sert aujourd'hui renverrait 404 pour un OWNER ; pour un VIEWER il doit
   * être refusé AVANT d'atteindre le routage — c'est ce qui garantit qu'un
   * routeur ajouté demain, sans que personne ne pense à cette liste, sera
   * refusé plutôt qu'ouvert au tiers.
   *
   * Garde éprouvée (règle 7) : on assère le MOTIF, pas seulement le code.
   * Un 403 ne prouverait rien par lui-même — un chemin inconnu traverse
   * aussi les montages `ownerOnly`, dont `requireRole` répond 403 de son
   * côté. Sans vérifier le message, ce test passerait même si la garde de
   * périmètre était retirée.
   */
  test("un chemin inconnu — donc un routeur futur — est refusé PAR LA GARDE DE PÉRIMÈTRE", async () => {
    const v = await creerUtilisateur("VIEWER", "fail-closed");
    const o = await creerUtilisateur("OWNER", "fail-closed-owner");

    const pourOwner = await request(app).get("/api/routeur-qui-nexiste-pas-encore").set("Cookie", o.cookie);
    expect(pourOwner.status).toBe(404);

    const pourViewer = await request(app).get("/api/routeur-qui-nexiste-pas-encore").set("Cookie", v.cookie);
    expect(pourViewer.status).toBe(403);
    expect(pourViewer.body.error).toMatch(/pas inclus dans l'accès/i);
  });

  test("chaque préfixe déclaré dans ECRANS_TIERS_LECTURE laisse passer la garde de périmètre", async () => {
    // Sinon la liste blanche pourrait contenir un chemin mort et personne ne
    // s'en apercevrait — l'écran serait simplement absent pour le tiers.
    //
    // On sonde une route RÉELLE sous chaque préfixe : plusieurs préfixes
    // (`/cockpit`, `/rapports`) ne servent rien en direct, et interroger le
    // préfixe nu tomberait dans les montages `ownerOnly` en aval, dont le
    // 403 de `requireRole` n'a rien à voir avec ce qu'on teste ici.
    const sondes: Record<(typeof ECRANS_TIERS_LECTURE)[number], string> = {
      "/cockpit": "/cockpit/kpis",
      "/compte-resultat": "/compte-resultat?from=2026-01-01&to=2026-12-31",
      "/factures": "/factures",
      "/marge": "/marge",
      "/rapports": "/rapports/mensuel",
      "/echeances": "/echeances",
      "/previsionnel-tresorerie": "/previsionnel-tresorerie",
      "/votre-metier": "/votre-metier",
    };

    const v = await creerUtilisateur("VIEWER", "prefixes");
    for (const prefixe of ECRANS_TIERS_LECTURE) {
      const res = await request(app).get(`/api${sondes[prefixe]}`).set("Cookie", v.cookie);
      expect(res.body?.error ?? "", `${prefixe} ne doit pas être bloqué par le périmètre`)
        .not.toMatch(/pas inclus dans l'accès/i);
    }
  });
});

// ── d, e. Échéance ────────────────────────────────────────────────────────

describe("d, e — échéance de l'accès", () => {
  test("une échéance dépassée ferme l'accès dès la requête suivante, sans reconnexion", async () => {
    // Échéance dans le futur : l'accès fonctionne.
    const v = await creerUtilisateur("VIEWER", "echeance", new Date(Date.now() + 60_000));
    const avant = await request(app).get("/api/cockpit/kpis").set("Cookie", v.cookie);
    expect(avant.status).toBe(200);

    // On recule l'échéance dans le passé — RIEN d'autre. Même session, même
    // cookie, aucune reconnexion.
    await adminPool.query(
      "UPDATE memberships SET expires_at = now() - interval '1 minute' WHERE user_id = $1",
      [v.userId],
    );

    const apres = await request(app).get("/api/cockpit/kpis").set("Cookie", v.cookie);
    expect(apres.status).toBe(403);
    expect(apres.body.error).toMatch(/expir/i);
  });

  test("non-régression : une adhésion sans échéance n'est jamais fermée", async () => {
    for (const role of ["OWNER", "MEMBER", "ACCOUNTANT"] as const) {
      const u = await creerUtilisateur(role, `sans-echeance-${role}`);
      const res = await request(app).get("/api/cockpit/kpis").set("Cookie", u.cookie);
      expect(res.status, `${role} sans échéance doit passer`).toBe(200);
    }
  });
});

// ── f, g. Invitation et changement de rôle ────────────────────────────────

describe("f, g — accorder l'accès passe par l'invitation, avec une date", () => {
  test("inviter un VIEWER sans date de fin → 400 ; avec une date passée → 400 ; avec une date future → 201", async () => {
    const o = await creerUtilisateur("OWNER", "inviteur");

    const sansDate = await request(app)
      .post("/api/membres/inviter")
      .set("Cookie", o.cookie)
      .send({ email: `tiers-sans-date-${Date.now()}@test.nodaq`, role: "VIEWER" });
    expect(sansDate.status).toBe(400);
    expect(sansDate.body.error).toMatch(/date de fin/i);

    const datePassee = await request(app)
      .post("/api/membres/inviter")
      .set("Cookie", o.cookie)
      .send({
        email: `tiers-date-passee-${Date.now()}@test.nodaq`,
        role: "VIEWER",
        accesExpireAt: new Date(Date.now() - 86_400_000).toISOString(),
      });
    expect(datePassee.status).toBe(400);

    const emailOk = `tiers-ok-${Date.now()}@test.nodaq`;
    emails.push(emailOk);
    const echeance = new Date(Date.now() + 30 * 86_400_000);
    const ok = await request(app)
      .post("/api/membres/inviter")
      .set("Cookie", o.cookie)
      .send({ email: emailOk, role: "VIEWER", accesExpireAt: echeance.toISOString() });
    expect(ok.status).toBe(201);
    expect(ok.body.role).toBe("VIEWER");
    expect(new Date(ok.body.accesExpireAt).getTime()).toBe(echeance.getTime());
  });

  test("une échéance sur un rôle qui n'en porte pas est refusée plutôt que silencieusement perdue", async () => {
    const o = await creerUtilisateur("OWNER", "inviteur-accountant");
    const res = await request(app)
      .post("/api/membres/inviter")
      .set("Cookie", o.cookie)
      .send({
        email: `comptable-avec-date-${Date.now()}@test.nodaq`,
        role: "ACCOUNTANT",
        accesExpireAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
    expect(res.status).toBe(400);
  });

  test("PATCH /membres/:id/role ne fabrique pas de tiers permanent, ni ne rend l'écriture à un tiers", async () => {
    const o = await creerUtilisateur("OWNER", "patcheur");
    const membre = await creerUtilisateur("MEMBER", "cible-promotion");
    const tiers = await creerUtilisateur("VIEWER", "cible-demotion", new Date(Date.now() + 86_400_000));

    const [{ id: membreMembershipId }] = (await adminPool.query(
      "SELECT id FROM memberships WHERE user_id = $1", [membre.userId],
    )).rows;
    const [{ id: tiersMembershipId }] = (await adminPool.query(
      "SELECT id FROM memberships WHERE user_id = $1", [tiers.userId],
    )).rows;

    const versViewer = await request(app)
      .patch(`/api/membres/${membreMembershipId}/role`)
      .set("Cookie", o.cookie)
      .send({ role: "VIEWER" });
    expect(versViewer.status).toBe(403);
    expect(versViewer.body.error).toMatch(/invitation/i);

    const depuisViewer = await request(app)
      .patch(`/api/membres/${tiersMembershipId}/role`)
      .set("Cookie", o.cookie)
      .send({ role: "MEMBER" });
    expect(depuisViewer.status).toBe(403);
  });
});
