/**
 * Règle de négociation de la relance — ticket 4.18, US-9.
 *
 * Ce que ces tests protègent :
 *   a. le DÉFAUT prudent — un tenant qui n'a jamais ouvert l'écran a un agent
 *      qui ne concède rien. L'US-9 l'exige : « l'autonomie de négociation est
 *      un choix explicite, jamais un défaut silencieux » ;
 *   b. le VERSIONNEMENT — c'est lui, et lui seul, qui rend tenable la promesse
 *      « un changement de règle ne modifie jamais rétroactivement une campagne
 *      déjà validée ». Une version posée reste lisible après modification ;
 *   c. l'APPEND-ONLY au niveau du moteur — l'application ne peut PAS réécrire
 *      une version passée, même en le voulant. Une règle réécrite après coup,
 *      c'est un mandat qu'on peut nier avoir donné ;
 *   d. les rôles — un MEMBER LIT la règle (il valide des campagnes dans son
 *      cadre) mais ne l'écrit pas ;
 *   e. la cohérence refusée AVANT écriture, avec un message lisible.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import app from "../app";
import { REGLE_RELANCE_DEFAUT } from "@nodaq/shared";
import {
  adminPool,
  cookieHeader,
  createTestUser,
  createTestMembership,
  createTestSession,
  cleanupTenants,
  cleanupUsers,
  completeMfaForRegisteredOwner,
} from "./helpers";

const tenantIds: string[] = [];
const emails: string[] = [];
let tenantId: string;
let ownerCookie: string;
let membreCookie: string;

const REGLE_OUVERTE = {
  echelonnementAutorise: true,
  maxVersements: 4,
  delaiMaxPremierVersementJours: 10,
  retardMaxJours: 45,
  lienPaiementAutorise: true,
  remiseAutorisee: false,
};

beforeAll(async () => {
  const email = `rr-owner-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(app)
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron", tenantNom: "Relance SARL" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  tenantId = reg.body.tenantId;
  tenantIds.push(tenantId);
  ownerCookie = reg.headers["set-cookie"][0];

  const emailMembre = `rr-membre-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(emailMembre);
  const membre = await createTestUser(emailMembre);
  await createTestMembership(membre.id, tenantId, "MEMBER");
  await adminPool.query(`UPDATE users SET mfa_enabled_at = now() WHERE id = $1`, [membre.id]);
  membreCookie = cookieHeader((await createTestSession(membre.id, tenantId)).id);
}, 90_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

// ── a. Le défaut prudent ───────────────────────────────────────────────────

describe("a — sans réglage, l'agent ne concède rien", () => {
  test("la règle par défaut ferme l'échelonnement et la remise", async () => {
    const r = await request(app)
      .get("/api/relance/regles")
      .set("Cookie", ownerCookie)
      .expect(200);

    expect(r.body.version, "aucune version posée").toBe(0);
    expect(r.body.echelonnementAutorise).toBe(false);
    expect(r.body.remiseAutorisee).toBe(false);
    expect(r.body.lienPaiementAutorise).toBe(false);
    // Et le défaut du serveur est bien celui déclaré côté partagé — deux
    // défauts qui divergeraient donneraient un écran qui ment.
    expect(r.body.echelonnementAutorise).toBe(REGLE_RELANCE_DEFAUT.echelonnementAutorise);
    expect(r.body.retardMaxJours).toBe(REGLE_RELANCE_DEFAUT.retardMaxJours);
  });

  test("le résumé dit explicitement que rien n'est accordé", async () => {
    const r = await request(app).get("/api/relance/regles").set("Cookie", ownerCookie);
    expect(r.body.resume).toMatch(/n'accorde rien d'autre/i);
  });
});

// ── b. Versionnement ───────────────────────────────────────────────────────

describe("b — chaque modification pose une version, l'ancienne survit", () => {
  test("enregistrer incrémente la version et n'écrase pas la précédente", async () => {
    const un = await request(app)
      .put("/api/relance/regles")
      .set("Cookie", ownerCookie)
      .send(REGLE_OUVERTE)
      .expect(200);
    expect(un.body.version).toBe(1);
    expect(un.body.echelonnementAutorise).toBe(true);

    const deux = await request(app)
      .put("/api/relance/regles")
      .set("Cookie", ownerCookie)
      .send({ ...REGLE_OUVERTE, echelonnementAutorise: false })
      .expect(200);
    expect(deux.body.version).toBe(2);
    expect(deux.body.echelonnementAutorise).toBe(false);

    // LE POINT DE LA STORY : la version 1 existe toujours, telle qu'elle était.
    // Sans cela, une campagne validée sous la v1 se retrouverait rétroactivement
    // régie par la v2 — exactement ce que l'US-9 interdit.
    const { rows } = await adminPool.query(
      `SELECT version, echelonnement_autorise FROM regles_relance
       WHERE tenant_id = $1 ORDER BY version`,
      [tenantId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].version).toBe(1);
    expect(rows[0].echelonnement_autorise).toBe(true);
  });

  test("la version courante est celle de numéro le plus élevé", async () => {
    const r = await request(app).get("/api/relance/regles").set("Cookie", ownerCookie);
    expect(r.body.version).toBe(2);
  });

  test("l'auteur de la version est conservé", async () => {
    const r = await request(app).get("/api/relance/regles").set("Cookie", ownerCookie);
    expect(r.body.poseeParEmail).toContain("@test.nodaq");
    expect(r.body.poseeLe).toBeTruthy();
  });
});

// ── c. Append-only, au niveau du moteur ────────────────────────────────────

describe("c — une version posée ne se réécrit pas", () => {
  test("`app_user` n'a ni UPDATE ni DELETE sur la table", async () => {
    // La garantie est dans le MOTEUR, pas dans le code : c'est ce qui la rend
    // vraie même pour un futur code qui tenterait la correction « juste cette
    // fois ». Même doctrine que `archived_pdfs` et `journal_decisions`.
    const { rows } = await adminPool.query(
      `SELECT privilege_type FROM information_schema.role_table_grants
       WHERE table_name = 'regles_relance' AND grantee = 'app_user'
       ORDER BY privilege_type`,
    );
    const droits = rows.map((r) => r.privilege_type);
    expect(droits).toEqual(["INSERT", "SELECT"]);
    expect(droits).not.toContain("UPDATE");
    expect(droits).not.toContain("DELETE");
  });
});

// ── d. Les rôles ───────────────────────────────────────────────────────────

describe("d — un MEMBER lit la règle, il ne la pose pas", () => {
  test("un MEMBER peut la lire — il valide des campagnes dans son cadre", async () => {
    const r = await request(app).get("/api/relance/regles").set("Cookie", membreCookie);
    expect(r.status).toBe(200);
    expect(r.body.version).toBe(2);
  });

  test("un MEMBER ne peut pas l'écrire", async () => {
    const r = await request(app)
      .put("/api/relance/regles")
      .set("Cookie", membreCookie)
      .send(REGLE_OUVERTE);
    expect(r.status).toBe(403);
  });

  test("sans session, rien", async () => {
    await request(app).get("/api/relance/regles").expect(401);
  });
});

// ── e. Cohérence refusée avant écriture ────────────────────────────────────

describe("e — une règle incohérente est refusée avec un message lisible", () => {
  test("un échelonnement à un seul versement n'est pas un échelonnement", async () => {
    const r = await request(app)
      .put("/api/relance/regles")
      .set("Cookie", ownerCookie)
      .send({ ...REGLE_OUVERTE, echelonnementAutorise: true, maxVersements: 1 });

    expect(r.status).toBe(422);
    // Un message que le dirigeant peut lire, pas une erreur de contrainte SQL.
    expect(r.body.error).toMatch(/au moins deux versements/i);
    expect(r.body.error).not.toMatch(/constraint|check|violates/i);
  });

  test("une borne hors limites est refusée", async () => {
    const r = await request(app)
      .put("/api/relance/regles")
      .set("Cookie", ownerCookie)
      .send({ ...REGLE_OUVERTE, retardMaxJours: 900 });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/entre 0 et 365/);
  });

  test("un refus n'a rien écrit", async () => {
    const r = await request(app).get("/api/relance/regles").set("Cookie", ownerCookie);
    expect(r.body.version, "une version aurait été posée malgré le refus").toBe(2);
  });

  test("un corps mal typé est refusé", async () => {
    const r = await request(app)
      .put("/api/relance/regles")
      .set("Cookie", ownerCookie)
      .send({ ...REGLE_OUVERTE, echelonnementAutorise: "oui" });
    expect(r.status).toBe(400);
  });
});
