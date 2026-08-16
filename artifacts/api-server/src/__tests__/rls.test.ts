/**
 * RLS Phase 5 — 7 required isolation test cases.
 *
 * All tests touch a real PostgreSQL database — no mocks.
 *
 * Run locally:
 *   pnpm --filter @workspace/api-server run test
 *
 * Required env vars (set as Replit Secrets):
 *   DATABASE_URL       — owner/superuser connection (for admin fixture setup)
 *   DATABASE_URL_APP   — app_user connection (subject to RLS, used by withTenant)
 *   SESSION_SECRET     — cookie signing secret
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import pg from "pg";
import app from "../app";
import { withTenant } from "@workspace/db";
import { sql } from "drizzle-orm";
import { pool as drizzlePool } from "@workspace/db";
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
  tableInsertSql,
  completeMfaForRegisteredOwner,
} from "./helpers";

// Helper: count rows in a table under a given tenant context via withTenant.
// Casts tx.execute() through unknown to avoid Drizzle's opaque QueryResult type.
async function countRows(tenantId: string, table: string): Promise<number> {
  const res = await withTenant(tenantId, (tx) =>
    tx.execute(sql`SELECT count(*)::int AS cnt FROM ${sql.raw(table)}`)
  );
  const rows = (res as unknown as { rows: Array<{ cnt: number }> }).rows;
  return rows[0]?.cnt ?? 0;
}

// ── Shared state populated by beforeAll ───────────────────────────────────
let tenantA: Awaited<ReturnType<typeof createTestTenant>>;
let tenantB: Awaited<ReturnType<typeof createTestTenant>>;
let memberA: Awaited<ReturnType<typeof createTestTeamMember>>;
let memberB: Awaited<ReturnType<typeof createTestTeamMember>>;

// HTTP-auth users
let cookieOwner: string;  // OWNER in tenantA
let cookieMember: string; // MEMBER in tenantA
let tenantIds: string[] = [];
let testEmails: string[] = [];

const BUSINESS_TABLES = [
  "activity", "affaires", "analytics_tool_logs", "archived_pdfs", "chat_messages", "classeur_documents", "classeur_document_bytes",
  "connectors", "contrats", "cr_entries", "devis", "echeances", "factures",
  "avoirs", "facture_sequences", "incidents_facturation",
  "pending_actions", "prospects", "settings", "team_members", "absences",
  "pointages", "catalogue_alias", "catalogue_lignes", "envois_journal", "parametres_envoi", "objectifs_franchissements",
  "tenant_secrets",
  "clients", "paiements", "affectations",
  "contacts_prospection", "contact_bases", "oppositions",
  "tenant_invites",
  "pa_documents_recus", "pa_transmissions",
  "bank_connections", "bank_accounts",
] as const;

// ────────────────────────────────────────────────────────────────────────────
// GLOBAL SETUP / TEARDOWN
// ────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Create two isolated tenants for DB-level tests
  tenantA = await createTestTenant("RLS-Test-Tenant-A");
  tenantB = await createTestTenant("RLS-Test-Tenant-B");
  tenantIds.push(tenantA.id, tenantB.id);

  // Team members needed for absences rows
  memberA = await createTestTeamMember(tenantA.id, "Collab A");
  memberB = await createTestTeamMember(tenantB.id, "Collab B");

  // ── HTTP test users ──────────────────────────────────────────────────────
  // OWNER: register via API to get a real signed cookie
  const ownerEmail = `rls-owner-${Date.now()}@test.nodaq`;
  const ownerPassword = "rls-owner-password-phase5";
  testEmails.push(ownerEmail);

  const regRes = await request(app)
    .post("/api/auth/register")
    .send({ email: ownerEmail, password: ownerPassword, nom: "RLS Owner", tenantNom: "RLS Test Corp" })
    .expect(201);

  await completeMfaForRegisteredOwner(regRes.body.userId);
  cookieOwner = regRes.headers["set-cookie"]?.[0] ?? "";
  if (!cookieOwner) throw new Error("register did not set a cookie");

  // Remember owner's tenant for cleanup
  const { body: meOwner } = await request(app)
    .get("/api/auth/me")
    .set("Cookie", cookieOwner)
    .expect(200);
  tenantIds.push(meOwner.tenantId);
  const ownerTenantId: string = meOwner.tenantId;
  const ownerUserId: string = meOwner.userId;

  // MEMBER: create user in DB, add MEMBER membership, login
  const memberEmail = `rls-member-${Date.now()}@test.nodaq`;
  testEmails.push(memberEmail);
  const memberUser = await createTestUser(memberEmail);
  await createTestMembership(memberUser.id, ownerTenantId, "MEMBER");
  testEmails.push(memberEmail);

  const memberLogin = await request(app)
    .post("/api/auth/login")
    .send({ email: memberEmail, password: memberUser.password })
    .expect(200);
  cookieMember = memberLogin.headers["set-cookie"]?.[0] ?? "";
  if (!cookieMember) throw new Error("member login did not set a cookie");
}, 60_000);

afterAll(async () => {
  await cleanupTenants(...tenantIds);
  await cleanupUsers(...testEmails);
  // Do NOT end drizzlePool — it is shared with the running application.
  // adminPool is shared across test files; let the process close it naturally
}, 30_000);

// ────────────────────────────────────────────────────────────────────────────
// CASE a — ISOLATION
// For each of the 15 business tables: insert rows under tenants A and B via
// the superuser (bypasses RLS), then query via withTenant and verify isolation.
// ────────────────────────────────────────────────────────────────────────────

describe("a — ISOLATION", () => {
  beforeAll(async () => {
    // Seed one row per table for each tenant using the admin pool (superuser, no RLS)
    for (const table of BUSINESS_TABLES) {
      const [sqlA, paramsA] = tableInsertSql(table, tenantA.id, memberA.id);
      const [sqlB, paramsB] = tableInsertSql(table, tenantB.id, memberB.id);
      if (sqlA !== "SELECT 1") await adminPool.query(sqlA, paramsA);
      if (sqlB !== "SELECT 1") await adminPool.query(sqlB, paramsB);
    }
  });

  for (const table of BUSINESS_TABLES) {
    test(`${table}: context A sees only A's rows`, async () => {
      // Count rows visible to each tenant via withTenant (app_user + RLS)
      const countA = await countRows(tenantA.id, table);
      const countB = await countRows(tenantB.id, table);

      // Admin can see rows for BOTH tenants (superuser bypasses RLS)
      const { rows: adminRows } = await adminPool.query<{ total: number }>(
        `SELECT count(*)::int AS total FROM ${table} WHERE tenant_id IN ($1, $2)`,
        [tenantA.id, tenantB.id],
      );
      const totalAdmin = adminRows[0]?.total ?? 0;

      // Own-row visibility: each tenant MUST see its own seeded fixture.
      // (countA === 0 would mean the policy is hiding even the correct-tenant rows.)
      expect(countA).toBeGreaterThanOrEqual(1);
      expect(countB).toBeGreaterThanOrEqual(1);

      // Foreign-row exclusion: each context MUST see fewer rows than the combined total.
      // (countA === totalAdmin would mean tenant A can see tenant B's rows.)
      expect(countA).toBeLessThan(totalAdmin);
      expect(countB).toBeLessThan(totalAdmin);
    });
  }

  test("[PROOF] disabling the policy breaks isolation; re-enabling restores it", async () => {
    // Insert 1 affaire row for each tenant (they may already exist from the loop above)
    const idProofA = crypto.randomUUID();
    const idProofB = crypto.randomUUID();
    await adminPool.query(
      "INSERT INTO affaires (id, label, tenant_id) VALUES ($1, 'proof-row', $2)",
      [idProofA, tenantA.id],
    );
    await adminPool.query(
      "INSERT INTO affaires (id, label, tenant_id) VALUES ($1, 'proof-row', $2)",
      [idProofB, tenantB.id],
    );

    // BEFORE: tenant A sees only its own rows
    const beforeCount = await countRows(tenantA.id, "affaires");
    const { rows: adminBefore } = await adminPool.query<{ total: number }>(
      "SELECT count(*)::int AS total FROM affaires WHERE tenant_id IN ($1, $2)",
      [tenantA.id, tenantB.id],
    );
    const totalAdmin = adminBefore[0]!.total;
    expect(beforeCount).toBeLessThan(totalAdmin);
    console.log(
      `[PROOF] Before disabling — tenant A sees ${beforeCount} row(s); admin sees ${totalAdmin} total`,
    );

    // DISABLE RLS — postgres superuser can do this even with FORCE ROW LEVEL SECURITY
    await adminPool.query("ALTER TABLE affaires DISABLE ROW LEVEL SECURITY");
    try {
      // With RLS disabled, app_user sees ALL rows regardless of GUC
      const duringCount = await countRows(tenantA.id, "affaires");
      expect(duringCount).toBeGreaterThanOrEqual(totalAdmin);
      console.log(
        `[PROOF] RLS DISABLED — tenant A context sees ${duringCount} row(s) (including tenant B) ✓`,
      );
    } finally {
      // Always restore — failure here would break subsequent tests
      await adminPool.query("ALTER TABLE affaires ENABLE ROW LEVEL SECURITY");
    }

    // AFTER RE-ENABLE: isolation restored
    const afterCount = await countRows(tenantA.id, "affaires");
    expect(afterCount).toBeLessThan(totalAdmin);
    console.log(
      `[PROOF] RLS RE-ENABLED — tenant A sees ${afterCount} row(s) again (B hidden) ✓`,
    );

    // Cleanup proof rows
    await adminPool.query("DELETE FROM affaires WHERE id IN ($1, $2)", [idProofA, idProofB]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CASE b — INSERTION CROISÉE
// Under tenant A's context, try to INSERT a row with tenant_id = B.
// PostgreSQL's WITH CHECK (= USING) must reject it.
// ────────────────────────────────────────────────────────────────────────────

describe("b — INSERTION CROISÉE", () => {
  test("INSERT with wrong tenant_id is rejected by RLS WITH CHECK", async () => {
    const fakeId = crypto.randomUUID();
    let thrown = false;

    try {
      await withTenant(tenantA.id, async (tx) => {
        await tx.execute(
          sql`INSERT INTO affaires (id, label, tenant_id) VALUES (${fakeId}, 'cross-tenant', ${tenantB.id})`,
        );
      });
    } catch (err) {
      thrown = true;
      // Drizzle wraps the pg error: check both message and cause for the RLS violation text.
      const text = [
        err instanceof Error ? err.message : "",
        err instanceof Error && err.cause instanceof Error ? err.cause.message : "",
        JSON.stringify(err),
      ].join(" ");
      expect(text).toMatch(/row.level security|policy|42501/i);
      console.log("[CROSS-TENANT INSERT] RLS violation correctly raised ✓");
    }

    expect(thrown).toBe(true);
    // Confirm the row was NOT actually inserted (transaction rolled back)
    const { rows } = await adminPool.query(
      "SELECT id FROM affaires WHERE id = $1",
      [fakeId],
    );
    expect(rows.length).toBe(0);
  });

  test("INSERT with correct tenant_id succeeds inside the same context", async () => {
    const goodId = crypto.randomUUID();
    await expect(
      withTenant(tenantA.id, async (tx) => {
        await tx.execute(
          sql`INSERT INTO affaires (id, label, tenant_id) VALUES (${goodId}, 'valid-insert', ${tenantA.id})`,
        );
      }),
    ).resolves.not.toThrow();

    await adminPool.query("DELETE FROM affaires WHERE id = $1", [goodId]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CASE c — FUITE DE CONTEXTE
// After withTenant(A) completes, the GUC is transaction-local and resets.
// A subsequent raw query on the same pool MUST NOT inherit the previous context.
// ────────────────────────────────────────────────────────────────────────────

describe("c — FUITE DE CONTEXTE", () => {
  test("GUC is reset to empty after withTenant transaction ends", async () => {
    // Ensure tenant A has at least one affaire row
    const seedId = crypto.randomUUID();
    await adminPool.query(
      "INSERT INTO affaires (id, label, tenant_id) VALUES ($1, 'ctx-leak-test', $2)",
      [seedId, tenantA.id],
    );

    // Run a withTenant query (sets GUC for the duration of the transaction)
    const duringCount = await countRows(tenantA.id, "affaires");
    expect(duringCount).toBeGreaterThan(0);

    // After the transaction ends, acquire a connection from the SAME Drizzle pool
    // used by withTenant.  If set_config were accidentally called at session scope
    // (third arg = false), the GUC would persist on this connection — exactly the
    // kind of leak we need to catch.
    const client = await drizzlePool.connect();
    try {
      const { rows } = await client.query<{ guc: string }>(
        "SELECT current_setting('app.current_tenant_id', true) AS guc",
      );
      const guc = rows[0]?.guc ?? "";
      expect(guc).toBe(""); // Transaction-local GUC must have been reset
      console.log(`[CONTEXT LEAK] GUC after transaction: "${guc}" (empty — no leak) ✓`);

      // Verify: without the GUC, app_user sees 0 rows (RLS policy matches nothing)
      const { rows: leaked } = await client.query<{ c: number }>(
        "SELECT count(*)::int AS c FROM affaires",
      );
      expect(leaked[0]!.c).toBe(0);
      console.log(`[CONTEXT LEAK] Raw query without GUC returns 0 rows ✓`);
    } finally {
      client.release();
      await adminPool.query("DELETE FROM affaires WHERE id = $1", [seedId]);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CASE d — TENANT FALSIFIÉ
// A tenantId field in the request body must NOT override the session's tenantId.
// The row must be created under the session's tenant, not the body's.
// ────────────────────────────────────────────────────────────────────────────

describe("d — TENANT FALSIFIÉ", () => {
  const fakeTenantId = "00000000-0000-0000-0000-000000000001";

  test("body tenantId is ignored; session tenantId is used", async () => {
    const res = await request(app)
      .post("/api/affaires")
      .set("Cookie", cookieOwner)
      .send({ label: "Forged Body Test", tenantId: fakeTenantId })
      .expect(201);

    expect(res.body.tenantId).not.toBe(fakeTenantId);
    expect(res.body.tenantId).toBeDefined();
    console.log(`[FORGED TENANT / body] session wins: ${res.body.tenantId} ✓`);
    if (res.body.id) await adminPool.query("DELETE FROM affaires WHERE id = $1", [res.body.id]);
  });

  test("X-Tenant-Id header is ignored; session tenantId is used", async () => {
    const res = await request(app)
      .post("/api/affaires")
      .set("Cookie", cookieOwner)
      .set("X-Tenant-Id", fakeTenantId)
      .send({ label: "Forged Header Test" })
      .expect(201);

    expect(res.body.tenantId).not.toBe(fakeTenantId);
    expect(res.body.tenantId).toBeDefined();
    console.log(`[FORGED TENANT / header] session wins: ${res.body.tenantId} ✓`);
    if (res.body.id) await adminPool.query("DELETE FROM affaires WHERE id = $1", [res.body.id]);
  });

  test("?tenantId= query param is ignored; session tenantId is used", async () => {
    const res = await request(app)
      .post(`/api/affaires?tenantId=${fakeTenantId}`)
      .set("Cookie", cookieOwner)
      .send({ label: "Forged Query Test" })
      .expect(201);

    expect(res.body.tenantId).not.toBe(fakeTenantId);
    expect(res.body.tenantId).toBeDefined();
    console.log(`[FORGED TENANT / query] session wins: ${res.body.tenantId} ✓`);
    if (res.body.id) await adminPool.query("DELETE FROM affaires WHERE id = $1", [res.body.id]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CASE e — APPARTENANCE
// An authenticated user whose membership is deleted receives 403 on business routes.
// ────────────────────────────────────────────────────────────────────────────

describe("e — APPARTENANCE", () => {
  test("deleted membership → 403 on next request", async () => {
    const email = `rls-orphan-${Date.now()}@test.nodaq`;
    testEmails.push(email);

    // Create a new OWNER user via the real register endpoint
    const regRes = await request(app)
      .post("/api/auth/register")
      .send({
        email,
        password: "orphan-password-phase5",
        nom: "Orphan User",
        tenantNom: "Orphan Corp",
      })
      .expect(201);

    await completeMfaForRegisteredOwner(regRes.body.userId);
    const cookie = regRes.headers["set-cookie"]?.[0] ?? "";
    const { body: me } = await request(app)
      .get("/api/auth/me")
      .set("Cookie", cookie)
      .expect(200);
    tenantIds.push(me.tenantId);

    // Confirm access works before deleting membership
    await request(app)
      .get("/api/cockpit/kpis")
      .set("Cookie", cookie)
      .expect(200);

    // Delete the membership — simulates revocation
    await adminPool.query(
      "DELETE FROM memberships WHERE user_id = $1 AND tenant_id = $2",
      [me.userId, me.tenantId],
    );

    // requireMembership middleware re-queries memberships on every request
    const forbidden = await request(app)
      .get("/api/cockpit/kpis")
      .set("Cookie", cookie);
    expect(forbidden.status).toBe(403);
    console.log("[MEMBERSHIP] Revoked membership → 403 ✓");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CASE f — SESSION
// Missing, forged, and expired cookies must all result in 401.
// ────────────────────────────────────────────────────────────────────────────

describe("f — SESSION", () => {
  test("missing cookie → 401", async () => {
    const res = await request(app).get("/api/cockpit/kpis");
    expect(res.status).toBe(401);
  });

  test("forged / unsigned cookie → 401", async () => {
    const res = await request(app)
      .get("/api/cockpit/kpis")
      .set("Cookie", "nodaq_sid=totally-fake-not-a-uuid");
    expect(res.status).toBe(401);
  });

  test("valid signature but non-existent session ID → 401", async () => {
    // Sign a UUID that was never stored in the sessions table
    const ghost = crypto.randomUUID();
    const res = await request(app)
      .get("/api/cockpit/kpis")
      .set("Cookie", cookieHeader(ghost));
    expect(res.status).toBe(401);
  });

  test("expired session → 401", async () => {
    // Create a real user and a session that already expired
    const email = `rls-expired-${Date.now()}@test.nodaq`;
    testEmails.push(email);

    const user = await createTestUser(email);
    const tenant = await createTestTenant("Expired Session Tenant");
    tenantIds.push(tenant.id);
    await createTestMembership(user.id, tenant.id, "OWNER");

    // Session expired 1 hour ago
    const expiredAt = new Date(Date.now() - 60 * 60 * 1000);
    const session = await createTestSession(user.id, tenant.id, expiredAt);
    const cookie = cookieHeader(session.id);

    const res = await request(app)
      .get("/api/cockpit/kpis")
      .set("Cookie", cookie);
    expect(res.status).toBe(401);
    console.log("[SESSION] Expired session → 401 ✓");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CASE g — RÔLE
// A MEMBER must be denied actions reserved for OWNER.
// ────────────────────────────────────────────────────────────────────────────

describe("g — RÔLE", () => {
  test("OWNER can access OWNER-only routes", async () => {
    const res = await request(app)
      .get("/api/equipe")
      .set("Cookie", cookieOwner);
    expect(res.status).toBe(200);
  });

  test("MEMBER is denied OWNER-only routes (equipe, connecteurs, parametres)", async () => {
    // GET /equipe is OWNER-only
    const equipe = await request(app)
      .get("/api/equipe")
      .set("Cookie", cookieMember);
    expect(equipe.status).toBe(403);

    // PATCH /connecteurs is OWNER-only
    const connRes = await request(app)
      .patch("/api/connecteurs/STRIPE")
      .set("Cookie", cookieMember)
      .send({ status: "CONNECTE", config: {} });
    expect(connRes.status).toBe(403);

    // GET /parametres is OWNER-only
    const params = await request(app)
      .get("/api/parametres")
      .set("Cookie", cookieMember);
    expect(params.status).toBe(403);

    console.log("[ROLE] MEMBER → 403 on equipe/connecteurs/parametres ✓");
  });

  test("MEMBER can access non-OWNER-restricted routes", async () => {
    // cockpit is accessible to all authenticated members
    const kpi = await request(app)
      .get("/api/cockpit/kpis")
      .set("Cookie", cookieMember);
    expect(kpi.status).toBe(200);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CASE h — GARDE STRUCTURELLE
// Static analysis: no route file may query a business table directly via `db`.
// All access to business tables must go through withTenant().
//
// This test fails as soon as a developer adds:
//   db.select().from(affairesTable)   ← direct, bypasses RLS GUC
// to any route file.  The only permitted pattern is:
//   withTenant(tenantId, (tx) => tx.select().from(affairesTable))
// ────────────────────────────────────────────────────────────────────────────

import * as fs from "node:fs";
import * as path from "node:path";

describe("h — GARDE STRUCTURELLE", () => {
  // Drizzle table variable names for all 15 business tables.
  // Extend this list when a new business table is added to the schema.
  const BUSINESS_TABLE_VARS = [
    "activityTable",
    "affairesTable",
    "analyticsToolLogsTable",
    "archivedPdfsTable",
    "chatMessagesTable",
    "classeurTable",
    "classeurDocumentBytesTable",
    "connectorsTable",
    "contratsTable",
    "crEntriesTable",
    "devisTable",
    "echeancesTable",
    "facturesTable",
    "pendingActionsTable",
    "prospectsTable",
    "settingsTable",
    "teamMembersTable",
    "absencesTable",
  ];

  test("no route file queries a business table directly via `db` (must use withTenant)", () => {
    const routesDir = path.resolve(__dirname, "..", "routes");
    const files = fs.readdirSync(routesDir).filter((f) => f.endsWith(".ts"));

    const violations: string[] = [];

    for (const fileName of files) {
      const filePath = path.join(routesDir, fileName);
      const content = fs.readFileSync(filePath, "utf8");

      // Check whether the file imports `db` directly from @workspace/db.
      // Infra-table routes (auth.ts) legitimately call authService helpers
      // that use `db` internally, but they don't import `db` themselves.
      const importsDrizzleDb =
        /import\s*\{[^}]*\bdb\b[^}]*\}\s*from\s*['"]@workspace\/db['"]/.test(
          content,
        );
      if (!importsDrizzleDb) continue; // no direct db import → safe

      // The file imports db. Scan for any .from(<business_table>) usage,
      // which would indicate a direct query bypassing withTenant.
      for (const tableVar of BUSINESS_TABLE_VARS) {
        // Match: db.select().from(affairesTable) or .from(affairesTable) after db chain
        const directQuery = new RegExp(
          `db\\s*\\.\\s*(select|insert|update|delete|query).*?\\bfrom\\s*\\(\\s*${tableVar}\\s*\\)|` +
          `db\\s*\\.\\s*insert\\s*\\(\\s*${tableVar}\\s*\\)`,
          "s",
        );
        if (directQuery.test(content)) {
          violations.push(
            `${fileName}: direct db.query on \`${tableVar}\` found — must use withTenant()`,
          );
        }
      }
    }

    if (violations.length > 0) {
      console.error("\n[STRUCTURAL GUARD] Business table(s) queried OUTSIDE withTenant:");
      violations.forEach((v) => console.error(`  ✗ ${v}`));
      console.error(
        "\n  Fix: wrap the query in withTenant(req.tenantId!, (tx) => tx.select().from(<table>))",
      );
    }

    expect(violations, "See [STRUCTURAL GUARD] output above for details").toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// CASE h — IMMUTABILITÉ DES TABLES APPEND-ONLY
//
// Un journal que l'application peut modifier ou effacer n'est pas un journal.
// Ce test ne lit AUCUN fichier : il éprouve les privilèges EFFECTIFS en tentant
// réellement l'écriture avec la connexion applicative. Vérifier la présence
// d'un GRANT dans un .sql prouverait seulement qu'une ligne a été écrite, pas
// que le moteur l'applique — et c'est précisément ce qui a échappé à la
// migration 009, dont le GRANT ne retirait rien.
//
// Le code 42501 (insufficient_privilege) est exigé NOMMÉMENT : un `catch`
// attrape-tout passerait aussi sur une faute de frappe SQL ou une table
// absente, et le test serait vert pour une mauvaise raison.
// ────────────────────────────────────────────────────────────────────────────

/** Exécute une requête sous app_user et rend le SQLSTATE en cas de refus. */
async function sqlstateDe(
  tenantId: string,
  requete: ReturnType<typeof sql>,
): Promise<string | null> {
  try {
    await withTenant(tenantId, (tx) => tx.execute(requete));
    return null; // aucune erreur : la requête est passée
  } catch (err) {
    let courant: unknown = err;
    for (let i = 0; courant !== null && courant !== undefined && i < 5; i++) {
      const code = (courant as { code?: string }).code;
      if (typeof code === "string") return code;
      courant = (courant as { cause?: unknown }).cause;
    }
    return "inconnu";
  }
}

describe("h — APPEND-ONLY (privilèges effectifs, pas déclaratifs)", () => {
  const APPEND_ONLY = ["envois_journal", "archived_pdfs", "objectifs_franchissements", "incidents_facturation", "pa_documents_recus"] as const;

  test("envois_journal : INSERT et SELECT passent, UPDATE et DELETE sont REFUSÉS", async () => {
    const ligneId = `append-only-${Date.now()}`;

    // INSERT — doit réussir.
    const insertion = await sqlstateDe(
      tenantA.id,
      sql`INSERT INTO envois_journal (id, tenant_id, destinataire, document_type, mode, statut)
          VALUES (${ligneId}, ${tenantA.id}::uuid, 'append-only@test.nodaq', 'DEVIS', 'repli_nodaq', 'envoye')`,
    );
    expect(insertion, "INSERT doit être autorisé sur un journal").toBeNull();

    // SELECT — doit réussir.
    const lecture = await sqlstateDe(
      tenantA.id,
      sql`SELECT id FROM envois_journal WHERE id = ${ligneId}`,
    );
    expect(lecture, "SELECT doit être autorisé").toBeNull();

    // UPDATE — doit être refusé par le moteur, code 42501.
    const modification = await sqlstateDe(
      tenantA.id,
      sql`UPDATE envois_journal SET statut = 'echec' WHERE id = ${ligneId}`,
    );
    expect(modification, "UPDATE doit être refusé (42501)").toBe("42501");

    // DELETE — doit être refusé par le moteur, code 42501.
    const suppression = await sqlstateDe(
      tenantA.id,
      sql`DELETE FROM envois_journal WHERE id = ${ligneId}`,
    );
    expect(suppression, "DELETE doit être refusé (42501)").toBe("42501");

    // Et la ligne est intacte, vue par l'administrateur.
    const { rows } = await adminPool.query<{ statut: string }>(
      "SELECT statut FROM envois_journal WHERE id = $1",
      [ligneId],
    );
    expect(rows[0]?.statut).toBe("envoye");

    await adminPool.query("DELETE FROM envois_journal WHERE id = $1", [ligneId]);
  });

  test("pa_documents_recus : INSERT et SELECT passent, UPDATE et DELETE sont REFUSÉS", async () => {
    const docId = `append-only-pa-${Date.now()}`;

    // INSERT — doit réussir.
    const insertion = await sqlstateDe(
      tenantA.id,
      sql`INSERT INTO pa_documents_recus (id, tenant_id, bytes, sha256, byte_size, source)
          VALUES (${docId}, ${tenantA.id}::uuid, ${Buffer.from("append-only-test")}, 'append-only-sha', 16, 'manuel')`,
    );
    expect(insertion, "INSERT doit être autorisé sur un document reçu").toBeNull();

    // SELECT — doit réussir.
    const lecture = await sqlstateDe(
      tenantA.id,
      sql`SELECT id FROM pa_documents_recus WHERE id = ${docId}`,
    );
    expect(lecture, "SELECT doit être autorisé").toBeNull();

    // UPDATE — doit être refusé par le moteur, code 42501.
    const modification = await sqlstateDe(
      tenantA.id,
      sql`UPDATE pa_documents_recus SET sha256 = 'tampered' WHERE id = ${docId}`,
    );
    expect(modification, "UPDATE doit être refusé (42501)").toBe("42501");

    // DELETE — doit être refusé par le moteur, code 42501.
    const suppression = await sqlstateDe(
      tenantA.id,
      sql`DELETE FROM pa_documents_recus WHERE id = ${docId}`,
    );
    expect(suppression, "DELETE doit être refusé (42501)").toBe("42501");

    // Et la ligne est intacte, vue par l'administrateur.
    const { rows } = await adminPool.query<{ sha256: string }>(
      "SELECT sha256 FROM pa_documents_recus WHERE id = $1",
      [docId],
    );
    expect(rows[0]?.sha256).toBe("append-only-sha");

    await adminPool.query("DELETE FROM pa_documents_recus WHERE id = $1", [docId]);
  });

  test.each(APPEND_ONLY)(
    "%s : app_user n'a NI UPDATE NI DELETE au niveau du moteur",
    async (table) => {
      // has_table_privilege interroge le moteur, pas un fichier de migration.
      const { rows } = await adminPool.query<{ peut_modifier: boolean; peut_supprimer: boolean }>(
        `SELECT has_table_privilege('app_user', $1, 'UPDATE') AS peut_modifier,
                has_table_privilege('app_user', $1, 'DELETE') AS peut_supprimer`,
        [table],
      );
      expect(rows[0]?.peut_modifier, `${table} ne doit pas être modifiable`).toBe(false);
      expect(rows[0]?.peut_supprimer, `${table} ne doit pas être supprimable`).toBe(false);
    },
  );
});
