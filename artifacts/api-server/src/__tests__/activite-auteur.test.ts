/**
 * QUI a fait quoi — et ce que le patron lit le matin.
 *
 * ── CE QUI MANQUAIT ───────────────────────────────────────────────────────
 * `activity` ne portait que `type`, `label`, `meta`, `created_at`. L'écran
 * « Activité récente » affichait « Nouvelle affaire : réfection toiture » sans
 * jamais dire par qui. Un patron ne pouvait pas savoir que sa secrétaire avait
 * fait un devis ni qu'un salarié avait modifié le planning.
 *
 * Signalé le 29/08/2026. Décision du fondateur : tout remonte dans le BRIEF
 * MATIN, sans notification — seuls les actes qui engagent méritent
 * d'interrompre quelqu'un.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { withTenant } from "@workspace/db";
import {
  adminPool, createTestTenant, createTestUser, createTestMembership,
  createTestSession, cookieHeader, cleanupTenants, cleanupUsers, serveurTest,
  type TestTenant,
} from "./helpers";
import app from "../app";
import { consignerActivite, auteurDeLaSession } from "../lib/consigner-activite";

const tenantIds: string[] = [];
const emails: string[] = [];
let tenant: TestTenant;
let cookie: string;
let userId: string;

beforeAll(async () => {
  tenant = await createTestTenant("auteur");
  tenantIds.push(tenant.id);
  const u = await createTestUser("sophie");
  emails.push(u.email);
  userId = u.id;
  await createTestMembership(u.id, tenant.id, "OWNER");
  cookie = cookieHeader((await createTestSession(u.id, tenant.id)).id);
}, 120_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
}, 30_000);

describe("l'auteur d'une activité", () => {
  test("est enregistré avec son NOM, copié au moment des faits", async () => {
    await withTenant(tenant.id, (tx) =>
      consignerActivite(tx, tenant.id, { type: "devis_created", label: "Devis DEV-0009" },
        { userId, nom: "Sophie Marchand" }),
    );

    const { rows } = await adminPool.query(
      `SELECT auteur_user_id, auteur_nom FROM activity WHERE tenant_id = $1::uuid AND label = 'Devis DEV-0009'`,
      [tenant.id],
    );
    expect(rows[0].auteur_user_id).toBe(userId);
    // Le nom est COPIÉ, pas joint : un départ ne doit pas effacer l'historique.
    expect(rows[0].auteur_nom).toBe("Sophie Marchand");
  });

  /*
   * `null` n'est PAS une donnée manquante : c'est le système qui a agi — un
   * renouvellement d'abonnement, un objectif franchi. Forcer un auteur aurait
   * fait afficher un nom là où personne n'a rien fait.
   */
  test("une activité SYSTÈME n'en porte aucun, et c'est voulu", async () => {
    await withTenant(tenant.id, (tx) =>
      consignerActivite(tx, tenant.id, { type: "abonnement", label: "Renouvellement" }, null),
    );

    const { rows } = await adminPool.query(
      `SELECT auteur_user_id FROM activity WHERE tenant_id = $1::uuid AND label = 'Renouvellement'`,
      [tenant.id],
    );
    expect(rows[0].auteur_user_id).toBeNull();
  });

  test("auteurDeLaSession rend null sans session, jamais un auteur inventé", () => {
    expect(auteurDeLaSession(undefined)).toBeNull();
    expect(auteurDeLaSession({ nom: "X" })).toBeNull();
    expect(auteurDeLaSession({ userId: "u1", nom: null })).toEqual({ userId: "u1", nom: null });
  });
});

describe("le brief matin dit qui a fait quoi", () => {
  test("l'activité de l'équipe y figure, avec son auteur", async () => {
    await withTenant(tenant.id, (tx) =>
      consignerActivite(tx, tenant.id, { type: "affaire_created", label: "Nouvelle affaire : Toiture" },
        { userId, nom: "Sophie Marchand" }),
    );

    const { body } = await request(serveurTest(app)).get("/api/brief").set("Cookie", cookie).expect(200);
    const equipe = body.sections.find((s: { type: string }) => s.type === "equipe");

    expect(equipe, "aucune section équipe dans le brief").toBeDefined();
    expect(JSON.stringify(equipe.items)).toContain("Sophie Marchand");
  });

  /*
   * LA garde du bruit. Cette section est de l'INFORMATION, pas une urgence :
   * la marquer urgente diluerait les impayés et les habilitations expirées,
   * qui doivent, eux, attirer l'œil.
   */
  test("elle n'est jamais marquée urgente", async () => {
    const { body } = await request(serveurTest(app)).get("/api/brief").set("Cookie", cookie).expect(200);
    const equipe = body.sections.find((s: { type: string }) => s.type === "equipe");
    expect(equipe.items.every((i: { urgent: boolean }) => i.urgent === false)).toBe(true);
  });

  /*
   * « nodaq a créé une affaire » n'apprend rien à personne. Le brief ne
   * remonte que ce qu'un HUMAIN a fait.
   */
  test("les activités du système n'y remontent pas", async () => {
    const { body } = await request(serveurTest(app)).get("/api/brief").set("Cookie", cookie).expect(200);
    const equipe = body.sections.find((s: { type: string }) => s.type === "equipe");
    expect(JSON.stringify(equipe.items)).not.toContain("Renouvellement");
  });
});
