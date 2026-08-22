/**
 * Régression #41 — GET /analytics/indicateurs lançait tous ses calculs sur
 * `Promise.all`, plusieurs requêtes concurrentes sur UNE seule connexion
 * Postgres (`tx`, une transaction). Dès qu'une échouait, Postgres abandonnait
 * la transaction entière et chaque autre requête « en vol » sur ce même
 * client échouait en cascade — avec le texte SQL brut de l'erreur exposé au
 * client (`err.message` d'une `DrizzleQueryError` contient la requête
 * complète et ses paramètres).
 *
 * Reproduit ici avec un tenant réellement peuplé (affaires, factures, devis,
 * pointages), comme dans l'issue — `ids=all` est le mode par défaut de
 * l'écran Analytique.
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import app from "../app";
import {
  adminPool,
  cookieHeader,
  createTestTenant,
  createTestUser,
  createTestMembership,
  createTestSession,
  createTestTeamMember,
  cleanupTenants,
  cleanupUsers,
  serveurTest,
} from "./helpers";
import { INDICATEUR_IDS } from "../routes/analytics";

let tenantId: string;
let cookie: string;
const tenantIds: string[] = [];
const emails: string[] = [];

beforeAll(async () => {
  const tenant = await createTestTenant("AnalyticsConcurrence");
  tenantId = tenant.id;
  tenantIds.push(tenant.id);

  const email = `analytics-concurrence-${Date.now()}@test.nodaq`;
  emails.push(email);
  const user = await createTestUser(email, "Test1234!");
  await createTestMembership(user.id, tenant.id, "OWNER");
  const session = await createTestSession(user.id, tenant.id);
  cookie = cookieHeader(session.id);

  // Un jeu de données réel et varié — plusieurs affaires, factures (réglées
  // et non), devis (acceptés et non), pointages — pour que plusieurs
  // calculateurs différents aient effectivement quelque chose à agréger,
  // comme dans le tenant réel qui a révélé le défaut.
  const affaireIds: string[] = [];
  for (let i = 0; i < 8; i++) {
    const { rows } = await adminPool.query<{ id: string }>(
      `INSERT INTO affaires (id, tenant_id, label, status, quoted_amount_cents, created_at)
       VALUES (gen_random_uuid()::text, $1::uuid, $2, $3, 500000, now() - ($4 || ' days')::interval)
       RETURNING id`,
      [tenantId, `Affaire ${i}`, i % 3 === 0 ? "TERMINEE" : "EN_COURS", i * 10],
    );
    affaireIds.push(rows[0]!.id);
  }

  for (let i = 0; i < 8; i++) {
    const affaireId = affaireIds[i % affaireIds.length];
    await adminPool.query(
      `INSERT INTO factures (id, tenant_id, affaire_id, statut, total_ht_cents, issued_date, settled, lines,
                             customer_name, number, due_date, amount_cents, created_at)
       VALUES (gen_random_uuid()::text, $1::uuid, $2, 'EMISE', $3, (current_date - $4::int)::text, $5, '[]',
               $6, $7, (current_date + 30)::text, $8, now())`,
      [
        tenantId,
        affaireId,
        50000 + i * 1000,
        i * 5,
        i % 2 === 0,
        `Client ${i}`,
        `F-CONC-${String(i).padStart(3, "0")}`,
        50000 + i * 1000,
      ],
    );
  }

  for (let i = 0; i < 7; i++) {
    const affaireId = affaireIds[i % affaireIds.length];
    await adminPool.query(
      `INSERT INTO devis (id, tenant_id, affaire_id, status, retenue_garantie_pct, total_ht_cents,
                          reference, client_name, created_at)
       VALUES (gen_random_uuid()::text, $1::uuid, $2, $3, 0, $4, $5, $6, now() - ($7 || ' days')::interval)`,
      [
        tenantId,
        affaireId,
        i % 2 === 0 ? "ACCEPTE" : "ENVOYE",
        40000 + i * 1000,
        `DEV-CONC-${String(i).padStart(3, "0")}`,
        `Client ${i}`,
        i * 3,
      ],
    );
  }

  const membre = await createTestTeamMember(tenantId, "Compagnon Concurrence");
  for (let i = 0; i < 12; i++) {
    const affaireId = affaireIds[i % affaireIds.length];
    await adminPool.query(
      `INSERT INTO pointages (id, tenant_id, membre_id, affaire_id, date, heures)
       VALUES (gen_random_uuid()::text, $1::uuid, $2, $3, current_date - $4::int, 7)
       ON CONFLICT DO NOTHING`,
      [tenantId, membre.id, affaireId, i],
    );
  }
});

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...emails);
});

/** Aucun indicateur ne doit exposer de texte de requête SQL au client. */
function assertePasDeFuiteSql(body: unknown[]): void {
  for (const item of body) {
    const r = item as { detail?: { erreur?: string }; comparaison?: { messageImpossible?: string } };
    if (r.detail?.erreur) {
      expect(r.detail.erreur).not.toMatch(/select|failed query|insert|update/i);
    }
    if (r.comparaison?.messageImpossible) {
      expect(r.comparaison.messageImpossible).not.toMatch(/select|failed query|insert|update/i);
    }
  }
}

describe("régression #41 — GET /analytics/indicateurs sur tenant peuplé", () => {
  test("ids=all avec comparaison meme_periode_n1 : tous les indicateurs répondent, sans fuite SQL", async () => {
    const res = await request(serveurTest(app))
      .get("/api/analytics/indicateurs")
      .query({ ids: "all", periode: "12_mois", comparaison: "meme_periode_n1" })
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(INDICATEUR_IDS.length);
    assertePasDeFuiteSql(res.body);

    // Avec ce jeu de données, ca_facture a de vraies factures EMISE : la
    // cascade de #41 le faisait échouer (donneesInsuffisantes avec erreur
    // SQL) même si sa propre requête n'avait rien d'invalide.
    const caFacture = res.body.find((r: { id: string }) => r.id === "ca_facture");
    expect(caFacture).toBeDefined();
    expect(caFacture.donneesInsuffisantes).toBe(false);
    expect(typeof caFacture.valeur).toBe("number");
    expect(caFacture.valeur).toBeGreaterThan(0);
  });

  test("ids=all avec comparaison moyenne_12_mois : pas de fuite SQL (second site de concurrence)", async () => {
    const res = await request(serveurTest(app))
      .get("/api/analytics/indicateurs")
      .query({ ids: "all", periode: "12_mois", comparaison: "moyenne_12_mois" })
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(INDICATEUR_IDS.length);
    assertePasDeFuiteSql(res.body);
  });

  test("GET /analytics/indicateurs/:id/serie : pas de fuite SQL (troisième site de concurrence)", async () => {
    const res = await request(serveurTest(app))
      .get("/api/analytics/indicateurs/ca_facture/serie")
      .query({ n: 12 })
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(12);
    for (const point of res.body) {
      expect(typeof point.valeur === "number" || point.valeur === null).toBe(true);
    }
  });

  test("demander un seul indicateur réussit (déjà vrai avant #41, sert de témoin)", async () => {
    const res = await request(serveurTest(app))
      .get("/api/analytics/indicateurs")
      .query({ ids: "ca_facture", periode: "12_mois" })
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].donneesInsuffisantes).toBe(false);
  });
});
