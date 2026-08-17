/**
 * US-A5.2 — Cabinet comptable multi-secteurs.
 *
 * Ce que ces tests protègent :
 *   a. GET /auth/mes-espaces liste TOUS les tenants d'un utilisateur, avec le
 *      rôle et le secteur PROPRES à chacun ; un indicateur (affaires en
 *      cours) apparaît pour OWNER/ACCOUNTANT, jamais pour MEMBER ;
 *   b. POST /auth/basculer-espace bascule la session EN PLACE vers un tenant
 *      où l'utilisateur est membre — reflété immédiatement par GET /auth/me,
 *      sans redemander le MFA — et refuse (403) un tenant où il ne l'est pas ;
 *   c. la bascule isole réellement les données : après bascule, une route
 *      scopée au tenant ne voit QUE les données du nouveau tenant courant,
 *      jamais celles de l'ancien — c'est le risque exact que ce mécanisme
 *      introduit ;
 *   d. GET /cabinet/export consolide, en un seul CSV, le compte de résultat
 *      PCG de chaque client où l'utilisateur a un accès financier, sans
 *      mélanger les montants d'un client dans le bloc d'un autre.
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

async function setVertical(tenantId: string, vertical: string): Promise<void> {
  await adminPool.query(
    `INSERT INTO settings (tenant_id, key, value) VALUES ($1, 'votre-metier.metier', $2)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = $2`,
    [tenantId, vertical],
  );
}

async function insertAffaire(tenantId: string, label: string, status: string): Promise<void> {
  await adminPool.query(
    `INSERT INTO affaires (id, tenant_id, label, status) VALUES ($1, $2, $3, $4)`,
    [crypto.randomUUID(), tenantId, label, status],
  );
}

/** MFA déjà pleinement prouvé — évite enroll_required/verify_required dans
 *  reponseAuthentification pour un OWNER/ACCOUNTANT (hasFinancialAccess). */
async function marquerMfaEnrole(userId: string): Promise<void> {
  await adminPool.query(`UPDATE users SET mfa_enabled_at = now() WHERE id = $1`, [userId]);
}

async function insertCrEntry(
  tenantId: string,
  periodKey: string,
  lineCode: string,
  amountCents: number,
): Promise<void> {
  await adminPool.query(
    `INSERT INTO cr_entries (id, tenant_id, period_key, line_code, amount_cents)
     VALUES ($1, $2, $3, $4, $5)`,
    [crypto.randomUUID(), tenantId, periodKey, lineCode, amountCents],
  );
}

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
});

// ── a. GET /auth/mes-espaces ────────────────────────────────────────────────

describe("a — GET /auth/mes-espaces liste le portefeuille, rôle et secteur par tenant", () => {
  test("un utilisateur avec 2 memberships voit les deux, secteur et rôle corrects ; indicateur pour OWNER/ACCOUNTANT, absent pour MEMBER", async () => {
    const tenantOwner = await createTestTenant("Cabinet-A-Owner");
    const tenantMember = await createTestTenant("Cabinet-A-Member");
    tenantIds.push(tenantOwner.id, tenantMember.id);
    await setVertical(tenantOwner.id, "professions_liberales");
    // tenantMember reste sur le défaut (industrie_btp) — pas besoin de le poser.

    const email = `cabinet-mes-espaces-${Date.now()}@test.nodaq`;
    emails.push(email);
    const user = await createTestUser(email);
    await createTestMembership(user.id, tenantOwner.id, "OWNER");
    await createTestMembership(user.id, tenantMember.id, "MEMBER");
    await insertAffaire(tenantOwner.id, "Mission en cours", "EN_COURS");
    await insertAffaire(tenantOwner.id, "Mission acceptée", "ACCEPTEE");
    await insertAffaire(tenantOwner.id, "Prospect", "PROSPECT"); // ne doit PAS compter
    await insertAffaire(tenantMember.id, "Chantier en cours", "EN_COURS"); // MEMBER : aucun indicateur malgré ça

    const session = await createTestSession(user.id, tenantOwner.id);
    const cookie = cookieHeader(session.id);

    const res = await request(app).get("/api/auth/mes-espaces").set("Cookie", cookie).expect(200);
    const espaces = res.body.espaces as Array<{
      tenantId: string; role: string; secteurLabel: string; affairesEnCours: number | null;
    }>;
    expect(espaces).toHaveLength(2);

    const owner = espaces.find(e => e.tenantId === tenantOwner.id)!;
    expect(owner.role).toBe("OWNER");
    expect(owner.secteurLabel).toBe("Professions libérales");
    expect(owner.affairesEnCours).toBe(2);

    const member = espaces.find(e => e.tenantId === tenantMember.id)!;
    expect(member.role).toBe("MEMBER");
    expect(member.secteurLabel).toBe("Industrie / BTP (ancien découpage)");
    expect(member.affairesEnCours).toBeNull();
  });
});

// ── b, c. POST /auth/basculer-espace ────────────────────────────────────────

describe("b, c — POST /auth/basculer-espace bascule en place, isole les données, refuse un tenant étranger", () => {
  test("bascule vers un tenant possédé → /auth/me reflète immédiatement, sans redemander le MFA ; bascule vers un tenant étranger → 403", async () => {
    const tenantA = await createTestTenant("Cabinet-B-A");
    const tenantB = await createTestTenant("Cabinet-B-B");
    const tenantEtranger = await createTestTenant("Cabinet-B-Etranger");
    tenantIds.push(tenantA.id, tenantB.id, tenantEtranger.id);

    const email = `cabinet-bascule-${Date.now()}@test.nodaq`;
    emails.push(email);
    const user = await createTestUser(email);
    await createTestMembership(user.id, tenantA.id, "OWNER");
    await createTestMembership(user.id, tenantB.id, "ACCOUNTANT");
    await marquerMfaEnrole(user.id);

    // Session déjà MFA-vérifiée (mfaVerified=true, comportement par défaut du helper).
    const session = await createTestSession(user.id, tenantA.id);
    const cookie = cookieHeader(session.id);

    const avant = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
    expect(avant.body.tenantId).toBe(tenantA.id);
    expect(avant.body.mfaStatus).toBe("verified");

    const bascule = await request(app)
      .post("/api/auth/basculer-espace")
      .set("Cookie", cookie)
      .send({ tenantId: tenantB.id })
      .expect(200);
    expect(bascule.body.tenantId).toBe(tenantB.id);
    expect(bascule.body.role).toBe("ACCOUNTANT");
    // Toujours "verified" — le témoin MFA de la session survit à la bascule,
    // aucun nouveau contrôle demandé.
    expect(bascule.body.mfaStatus).toBe("verified");

    // MÊME cookie, aucune nouvelle session — /auth/me reflète tenantB dès la
    // requête suivante.
    const apres = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
    expect(apres.body.tenantId).toBe(tenantB.id);
    expect(apres.body.role).toBe("ACCOUNTANT");

    // Bascule vers un tenant où l'utilisateur n'est PAS membre → 403, et la
    // session reste sur tenantB (non modifiée par la tentative refusée).
    const refus = await request(app)
      .post("/api/auth/basculer-espace")
      .set("Cookie", cookie)
      .send({ tenantId: tenantEtranger.id })
      .expect(403);
    expect(refus.body.error).toBeTruthy();

    const inchange = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
    expect(inchange.body.tenantId).toBe(tenantB.id);
  });

  test("aucune fuite de données de l'ancien tenant après bascule — même session", async () => {
    const tenantA = await createTestTenant("Cabinet-C-A");
    const tenantB = await createTestTenant("Cabinet-C-B");
    tenantIds.push(tenantA.id, tenantB.id);

    const email = `cabinet-no-leak-${Date.now()}@test.nodaq`;
    emails.push(email);
    const user = await createTestUser(email);
    await createTestMembership(user.id, tenantA.id, "OWNER");
    await createTestMembership(user.id, tenantB.id, "OWNER");

    const periode = "from=2026-01-01&to=2026-12-31";
    await insertCrEntry(tenantA.id, "2026-01-01:2026-12-31", "AUTRES_PRODUITS", 111100);
    await insertCrEntry(tenantB.id, "2026-01-01:2026-12-31", "AUTRES_PRODUITS", 222200);

    const session = await createTestSession(user.id, tenantA.id);
    const cookie = cookieHeader(session.id);

    const surA = await request(app).get(`/api/compte-resultat?${periode}`).set("Cookie", cookie).expect(200);
    const ligneA = surA.body.lines.find((l: { lineCode: string }) => l.lineCode === "AUTRES_PRODUITS");
    expect(ligneA.manualAmountCents).toBe(111100);

    await request(app)
      .post("/api/auth/basculer-espace")
      .set("Cookie", cookie)
      .send({ tenantId: tenantB.id })
      .expect(200);

    const surB = await request(app).get(`/api/compte-resultat?${periode}`).set("Cookie", cookie).expect(200);
    const ligneB = surB.body.lines.find((l: { lineCode: string }) => l.lineCode === "AUTRES_PRODUITS");
    expect(ligneB.manualAmountCents).toBe(222200);
    expect(ligneB.manualAmountCents).not.toBe(111100);
  });
});

// ── d. GET /cabinet/export ───────────────────────────────────────────────────

describe("d — GET /cabinet/export consolide les clients en un seul CSV homogène", () => {
  test("deux clients de secteurs différents → un CSV avec les deux blocs PCG, sans contamination croisée", async () => {
    const tenantBtp = await createTestTenant("Cabinet-D-Btp");
    const tenantConseil = await createTestTenant("Cabinet-D-Conseil");
    const tenantNonFinancier = await createTestTenant("Cabinet-D-Membre");
    tenantIds.push(tenantBtp.id, tenantConseil.id, tenantNonFinancier.id);
    await setVertical(tenantConseil.id, "professions_liberales");

    const email = `cabinet-export-${Date.now()}@test.nodaq`;
    emails.push(email);
    const user = await createTestUser(email);
    await createTestMembership(user.id, tenantBtp.id, "OWNER");
    await createTestMembership(user.id, tenantConseil.id, "ACCOUNTANT");
    // MEMBER simple : ne doit PAS apparaître dans l'export (pas d'accès financier).
    await createTestMembership(user.id, tenantNonFinancier.id, "MEMBER");

    const periodKey = "2026-01-01:2026-12-31";
    await insertCrEntry(tenantBtp.id, periodKey, "AUTRES_PRODUITS", 500000);
    await insertCrEntry(tenantConseil.id, periodKey, "AUTRES_PRODUITS", 900000);

    const session = await createTestSession(user.id, tenantBtp.id);
    const cookie = cookieHeader(session.id);

    const res = await request(app)
      .get("/api/cabinet/export?from=2026-01-01&to=2026-12-31")
      .set("Cookie", cookie)
      .expect(200);
    const csv = (res.text as string).replace(/^﻿/, "");

    expect(csv).toContain(tenantBtp.nom);
    expect(csv).toContain(tenantConseil.nom);
    expect(csv).toContain("Industrie / BTP (ancien découpage)");
    expect(csv).toContain("Professions libérales");
    expect(csv).not.toContain(tenantNonFinancier.nom);

    // Chaque montant apparaît, et seul le bon bloc le porte : découper le CSV
    // au niveau des en-têtes "Client :" et vérifier montant par bloc.
    const blocs = csv.split(/(?="Client :)/);
    const blocBtp = blocs.find(b => b.includes(tenantBtp.nom))!;
    const blocConseil = blocs.find(b => b.includes(tenantConseil.nom))!;
    expect(blocBtp).toContain("5000,00");
    expect(blocBtp).not.toContain("9000,00");
    expect(blocConseil).toContain("9000,00");
    expect(blocConseil).not.toContain("5000,00");
  });
});
