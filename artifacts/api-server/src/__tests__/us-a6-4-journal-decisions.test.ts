/**
 * US-A6.4 — Historique des décisions exploitable en cas de contrôle.
 *
 * Ce que ces tests protègent :
 *   a. AC1 — après une décision, le journal porte la DATE, l'AUTEUR et le
 *      CONTENU EXACT proposé. L'instantané compte : `pending_actions` peut
 *      être purgée, et une preuve qui pointerait vers une ligne effacée ne
 *      prouverait plus rien ;
 *   b. IMMUABILITÉ — `app_user` ne peut ni modifier ni supprimer une ligne du
 *      journal, et c'est PostgreSQL qui le refuse, pas une convention de code.
 *      C'est LE test de cette story : le point d'attention interdit une
 *      traçabilité elle-même modifiable ;
 *   c. AC3 — une action expirée sans décision ressort avec un statut DISTINCT
 *      d'une approbation et d'un rejet ;
 *   d. AC2 — l'export est un CSV lisible par un tiers, une ligne par décision ;
 *   e. la purge journalise AVANT de supprimer — sinon câbler un jour
 *      `purgerPlansExpires` viderait l'historique en silence.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant } from "@workspace/db";
import app from "../app";
import { purgerPlansExpires, TYPE_PLAN } from "../lib/plan-vocal";
import {
  adminPool,
  cleanupTenants,
  cleanupUsers,
  completeMfaForRegisteredOwner,
  serveurTest,
} from "./helpers";

const tenantIds: string[] = [];
const emails: string[] = [];
let cookie: string;
let tenantId: string;
let email: string;

/** Pose un plan en attente, prêt à être décidé. */
async function poserPlan(labels: string[], expireLe?: Date): Promise<string> {
  const id = crypto.randomUUID();
  const plan = { operations: labels.map((l) => ({ type: "consigner_activite", libelle: l, champs: { libelle: l }, certitude: "exacte" })), questions: [], nonCompris: [] };
  await adminPool.query(
    `INSERT INTO pending_actions (id, tenant_id, type, status, label, payload, expire_le)
     VALUES ($1, $2, $3, 'EN_ATTENTE', $4, $5::jsonb, $6)`,
    [id, tenantId, TYPE_PLAN, labels[0] ?? "Plan", JSON.stringify(plan), expireLe ?? new Date(Date.now() + 3600_000)],
  );
  return id;
}

beforeAll(async () => {
  email = `a64-${Date.now()}-${crypto.randomBytes(3).toString("hex")}@test.nodaq`;
  emails.push(email);
  const reg = await request(serveurTest(app))
    .post("/api/auth/register")
    .send({ email, password: "test-pass-1234", nom: "Patron A64", tenantNom: "Tenant A64" })
    .expect(201);
  await completeMfaForRegisteredOwner(reg.body.userId);
  tenantId = reg.body.tenantId;
  tenantIds.push(tenantId);
  cookie = reg.headers["set-cookie"][0];
});

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
});

// ── a. AC1 — date, auteur, contenu exact ───────────────────────────────────

describe("a — AC1 : la décision est consignée avec sa date, son auteur et le contenu proposé", () => {
  test("une approbation journalise l'auteur et un instantané du contenu", async () => {
    const planId = await poserPlan(["Poser le carrelage salle de bain"]);

    await request(serveurTest(app))
      .post(`/api/pending-actions/${planId}/approve`)
      .set("Cookie", cookie)
      .expect(200);

    const journal = await request(serveurTest(app)).get("/api/journal-decisions").set("Cookie", cookie).expect(200);
    const ligne = journal.body.find((l: { actionId: string }) => l.actionId === planId);

    expect(ligne).toBeTruthy();
    expect(ligne.decision).toBe("APPROUVEE");
    expect(ligne.decideeParEmail).toBe(email);
    expect(new Date(ligne.decideeLe).getTime()).toBeGreaterThan(Date.now() - 60_000);
    // Le CONTENU EXACT, pas une référence : l'instantané doit survivre à la
    // disparition de la ligne d'origine.
    expect(ligne.actionLabel).toBe("Poser le carrelage salle de bain");
    expect(JSON.stringify(ligne.actionPayload)).toContain("Poser le carrelage salle de bain");
  });

  test("un rejet est consigné aussi — un refus se prouve autant qu'un accord", async () => {
    const planId = await poserPlan(["Facturer Dupont"]);

    await request(serveurTest(app))
      .post(`/api/pending-actions/${planId}/reject`)
      .set("Cookie", cookie)
      .expect(200);

    const journal = await request(serveurTest(app)).get("/api/journal-decisions").set("Cookie", cookie).expect(200);
    const ligne = journal.body.find((l: { actionId: string }) => l.actionId === planId);
    expect(ligne.decision).toBe("REJETEE");
    expect(ligne.decideeParEmail).toBe(email);
  });

  test("l'instantané survit à la disparition de l'action d'origine", async () => {
    const planId = await poserPlan(["Action éphémère"]);
    await request(serveurTest(app)).post(`/api/pending-actions/${planId}/reject`).set("Cookie", cookie).expect(200);

    // La ligne d'origine disparaît — le journal, lui, doit rester complet.
    await adminPool.query("DELETE FROM pending_actions WHERE id = $1", [planId]);

    const journal = await request(serveurTest(app)).get("/api/journal-decisions").set("Cookie", cookie).expect(200);
    const ligne = journal.body.find((l: { actionId: string }) => l.actionId === planId);
    expect(ligne).toBeTruthy();
    expect(ligne.actionLabel).toBe("Action éphémère");
  });
});

// ── b. Immuabilité — refusée par le MOTEUR ─────────────────────────────────

describe("b — le journal est append-only, et c'est PostgreSQL qui le garantit", () => {
  test("UPDATE et DELETE sur journal_decisions sont refusés à app_user", async () => {
    // Même précaution que archived-pdfs.test.ts : `create-app-role.cjs` peut
    // avoir été relancé après les migrations et re-accordé les quatre droits
    // par son GRANT massif. On rétablit l'état que la migration 040 décrit.
    await adminPool.query("REVOKE UPDATE, DELETE ON journal_decisions FROM app_user");

    const id = crypto.randomUUID();
    await adminPool.query(
      `INSERT INTO journal_decisions (id, tenant_id, action_id, action_type, action_label, decision)
       VALUES ($1, $2, 'act-immuable', 'PLAN_VOCAL', 'Preuve à ne pas réécrire', 'APPROUVEE')`,
      [id, tenantId],
    );

    let updateRefuse = false;
    try {
      await withTenant(tenantId, (tx) =>
        tx.execute(sql`UPDATE journal_decisions SET decision = 'REJETEE' WHERE id = ${id}`),
      );
    } catch {
      updateRefuse = true;
    }
    expect(updateRefuse).toBe(true);

    let deleteRefuse = false;
    try {
      await withTenant(tenantId, (tx) =>
        tx.execute(sql`DELETE FROM journal_decisions WHERE id = ${id}`),
      );
    } catch {
      deleteRefuse = true;
    }
    expect(deleteRefuse).toBe(true);

    // Et la ligne est intacte : ni réécrite, ni effacée.
    const { rows } = await adminPool.query<{ decision: string }>(
      "SELECT decision FROM journal_decisions WHERE id = $1",
      [id],
    );
    expect(rows[0]?.decision).toBe("APPROUVEE");
  });
});

// ── c. AC3 — l'expiration est un statut distinct ───────────────────────────

describe("c — AC3 : une expiration se distingue d'une approbation et d'un rejet", () => {
  test("une action expirée sans décision ressort EXPIREE, sans auteur", async () => {
    const planId = await poserPlan(["Plan jamais décidé"], new Date(Date.now() - 3600_000));

    const journal = await request(serveurTest(app)).get("/api/journal-decisions").set("Cookie", cookie).expect(200);
    const ligne = journal.body.find((l: { actionId: string }) => l.actionId === planId);

    expect(ligne).toBeTruthy();
    expect(ligne.decision).toBe("EXPIREE");
    expect(ligne.decision).not.toBe("APPROUVEE");
    expect(ligne.decision).not.toBe("REJETEE");
    // Personne n'a décidé : l'absence d'auteur EST l'information.
    expect(ligne.decideeParEmail).toBeNull();
  });
});

// ── d. AC2 — export CSV exploitable par un tiers ───────────────────────────

describe("d — AC2 : l'export est lisible sans l'interface NODAQ", () => {
  test("le CSV porte un en-tête explicite et une ligne par décision", async () => {
    const planId = await poserPlan(["Ligne à exporter"]);
    await request(serveurTest(app)).post(`/api/pending-actions/${planId}/reject`).set("Cookie", cookie).expect(200);

    const res = await request(serveurTest(app)).get("/api/journal-decisions/export").set("Cookie", cookie).expect(200);
    expect(res.headers["content-type"]).toContain("text/csv");

    const csv = (res.text as string).replace(/^﻿/, "");
    const lignes = csv.split("\r\n");
    expect(lignes[0]).toContain("Date de décision");
    expect(lignes[0]).toContain("Auteur");
    expect(lignes[0]).toContain("Contenu exact");
    expect(csv).toContain("Ligne à exporter");
    expect(csv).toContain("Rejetée");
    expect(csv).toContain(email);
  });

  test("une expiration s'exporte avec une mention explicite d'absence d'auteur", async () => {
    await poserPlan(["Expirée à exporter"], new Date(Date.now() - 7200_000));

    const res = await request(serveurTest(app)).get("/api/journal-decisions/export").set("Cookie", cookie).expect(200);
    const csv = res.text as string;
    expect(csv).toContain("Expirée sans décision");
    // Une case vide se lirait comme une donnée perdue.
    expect(csv).toContain("aucune décision humaine");
  });
});

// ── e. La purge ne fait pas disparaître la trace ───────────────────────────

describe("e — purgerPlansExpires journalise avant de supprimer", () => {
  test("après purge, l'action supprimée reste dans le journal", async () => {
    const planId = await poserPlan(["À purger"], new Date(Date.now() - 3600_000));

    await purgerPlansExpires(tenantId);

    const { rows: restantes } = await adminPool.query(
      "SELECT id FROM pending_actions WHERE id = $1",
      [planId],
    );
    expect(restantes).toHaveLength(0);

    const { rows: journal } = await adminPool.query<{ decision: string; action_label: string }>(
      "SELECT decision, action_label FROM journal_decisions WHERE action_id = $1",
      [planId],
    );
    expect(journal).toHaveLength(1);
    expect(journal[0]!.decision).toBe("EXPIREE");
    expect(journal[0]!.action_label).toBe("À purger");
  });
});
