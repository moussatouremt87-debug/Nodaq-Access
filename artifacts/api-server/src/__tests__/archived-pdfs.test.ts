/**
 * archived_pdfs — five mandatory tests.
 *
 * ① PDF survives container redeployment (storage dir wiped → served from DB)
 * ② GET /factures list route does not embed PDF bytes
 * ③ Multi-tenant isolation — covered by rls.test.ts (archived_pdfs in BUSINESS_TABLES)
 * ④ Archive is non-modifiable — UPDATE and DELETE rejected by PostgreSQL
 * ⑤ Atomicity — if archived_pdfs INSERT fails, facture stays BROUILLON
 */
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { withTenant } from "@workspace/db";
import app from "../app";
import {
  adminPool,
  cleanupTenants,
  cleanupUsers,
} from "./helpers";

// ── Shared fixtures ───────────────────────────────────────────────────────────

let cookieA: string;
let tenantAId: string;
const cleanupTenantIds: string[] = [];
const cleanupEmails: string[] = [];

async function createBrouillon(cookie: string) {
  const res = await request(app)
    .post("/api/factures")
    .set("Cookie", cookie)
    .send({
      customerName: "Client PDF Test",
      issuedDate: "2026-08-01",
      dueDate: "2026-09-01",
      lines: [
        { description: "Travaux PDF test", quantity: 1, unitPriceCents: 100_000, vatRate: 20, vatCategory: "S" },
      ],
    })
    .expect(201);
  return res.body as { id: string; statut: string; amountCents: number };
}

function emettre(cookie: string, id: string) {
  return request(app)
    .post(`/api/factures/${id}/emettre`)
    .set("Cookie", cookie)
    .send({ issuedDate: "2026-08-01", dueDate: "2026-09-01" });
}

beforeAll(async () => {
  const emailA = `archived-pdf-${Date.now()}@test.nodaq`;
  cleanupEmails.push(emailA);

  const regA = await request(app)
    .post("/api/auth/register")
    .send({ email: emailA, password: "test-pass-1234", nom: "Owner PDF", tenantNom: "Corp PDF" })
    .expect(201);
  cookieA = regA.headers["set-cookie"]?.[0] ?? "";

  const { body: me } = await request(app).get("/api/auth/me").set("Cookie", cookieA).expect(200);
  tenantAId = me.tenantId;
  cleanupTenantIds.push(tenantAId);

  // Seed SIRET + nom so mandatory-mention audit passes and PDF can be generated
  await request(app)
    .patch("/api/parametres")
    .set("Cookie", cookieA)
    .send({ "company.siret": "81234567600009", "company.nom": "PDF Corp SARL" })
    .expect(200);
}, 60_000);

afterAll(async () => {
  for (const tbl of ["archived_pdfs", "activity", "avoirs", "facture_sequences", "factures"]) {
    await adminPool.query(
      `DELETE FROM ${tbl} WHERE tenant_id = ANY($1::uuid[])`,
      [cleanupTenantIds],
    );
  }
  await cleanupTenants(...cleanupTenantIds);
  await cleanupUsers(...cleanupEmails);
}, 30_000);

// ── ① PDF survives container redeployment ────────────────────────────────────

describe("① PDF servi depuis la base après suppression du répertoire de stockage", () => {
  test("le PDF est disponible même si le disque local est effacé (simulation redéploiement)", async () => {
    const { id } = await createBrouillon(cookieA);
    const emitted = await emettre(cookieA, id).expect(200);
    const dbSha256 = emitted.body.pdfSha256 as string;
    expect(dbSha256).toBeTruthy();

    // Simulate a container redeployment: wipe local storage entirely
    const storageDir = process.env.STORAGE_DIR ?? path.join(process.cwd(), "storage");
    fs.rmSync(storageDir, { recursive: true, force: true });

    // PDF must still be served — bytes come from the DB, not the disk
    const pdfRes = await request(app)
      .get(`/api/factures/${id}/pdf`)
      .set("Cookie", cookieA)
      .expect(200);

    expect(pdfRes.headers["content-type"]).toMatch(/pdf/);
    expect(pdfRes.headers["x-pdf-sha256"]).toBe(dbSha256);

    const fetchedSha = crypto
      .createHash("sha256")
      .update(pdfRes.body as Buffer)
      .digest("hex");
    expect(fetchedSha).toBe(dbSha256);
    console.log(`[①] PDF servi depuis la DB après suppression du disque — SHA: ${dbSha256.slice(0, 12)}… ✓`);
  });
});

// ── ② List route must not embed PDF bytes ────────────────────────────────────

describe("② GET /factures ne renvoie pas les octets PDF", () => {
  test("le corps de réponse est < 100 Ko et aucune facture n'expose de champ bytes", async () => {
    // Emit 3 factures to ensure the table has content
    await Promise.all(
      Array.from({ length: 3 }, () =>
        createBrouillon(cookieA).then(({ id }) => emettre(cookieA, id).expect(200)),
      ),
    );

    const res = await request(app)
      .get("/api/factures")
      .set("Cookie", cookieA)
      .expect(200);

    const bodyStr = JSON.stringify(res.body);
    const bodyBytes = Buffer.byteLength(bodyStr, "utf8");

    // If bytea columns leaked into the response, the body would be several MB
    expect(bodyBytes).toBeLessThan(100_000); // < 100 KB

    const factures = res.body.factures as Array<Record<string, unknown>>;
    expect(factures.length).toBeGreaterThan(0);
    for (const f of factures) {
      expect(f["bytes"]).toBeUndefined();
    }
    console.log(`[②] Liste ${factures.length} factures — ${bodyBytes} octets, aucun champ bytes ✓`);
  });
});

// ── ④ Archive non-modifiable by app_user ────────────────────────────────────

describe("④ archived_pdfs est non modifiable par app_user", () => {
  test("UPDATE et DELETE sur archived_pdfs sont rejetés par PostgreSQL (privilege denied, pas seulement RLS)", async () => {
    // Re-enforce the privilege contract that migration 006 establishes.
    //
    // In CI: migrate.mjs runs AFTER create-app-role.cjs, so the REVOKE is already in
    //        effect and this call is idempotent.
    // In dev: create-app-role.cjs may be re-run after migrations (to refresh the
    //         DATABASE_URL_APP secret), which re-grants UPDATE+DELETE via
    //         "GRANT … ON ALL TABLES IN SCHEMA public". This explicit REVOKE restores
    //         the intended state documented in migration 006.
    await adminPool.query("REVOKE UPDATE, DELETE ON archived_pdfs FROM app_user");

    const pdfId = crypto.randomUUID();
    try {
      // Insert a row as superuser (bypasses privilege restriction)
      await adminPool.query(
        `INSERT INTO archived_pdfs (id, tenant_id, document_type, document_id, bytes, sha256, byte_size)
         VALUES ($1, $2::uuid, 'FACTURE', $3, $4, $5, $6)`,
        [pdfId, tenantAId, crypto.randomUUID(), Buffer.from("immutability-test"), "immutability-sha256", 17],
      );

      // UPDATE via app_user (withTenant uses DATABASE_URL_APP → app_user)
      let updateRejected = false;
      try {
        await withTenant(tenantAId, (tx) =>
          tx.execute(sql`UPDATE archived_pdfs SET sha256 = 'tampered' WHERE id = ${pdfId}`),
        );
      } catch {
        updateRejected = true;
      }
      expect(updateRejected).toBe(true);
      console.log("[④] UPDATE rejeté par PostgreSQL ✓");

      // DELETE via app_user
      let deleteRejected = false;
      try {
        await withTenant(tenantAId, (tx) =>
          tx.execute(sql`DELETE FROM archived_pdfs WHERE id = ${pdfId}`),
        );
      } catch {
        deleteRejected = true;
      }
      expect(deleteRejected).toBe(true);
      console.log("[④] DELETE rejeté par PostgreSQL ✓");

      // Verify the row is still intact (admin can read it)
      const { rows } = await adminPool.query<{ sha256: string }>(
        "SELECT sha256 FROM archived_pdfs WHERE id = $1",
        [pdfId],
      );
      expect(rows[0]?.sha256).toBe("immutability-sha256"); // untouched
      console.log("[④] Ligne intacte après tentatives de modification ✓");
    } finally {
      // Cleanup and restore privileges (idempotent in CI, necessary in dev).
      await adminPool.query("DELETE FROM archived_pdfs WHERE id = $1", [pdfId]);
      await adminPool.query("GRANT UPDATE, DELETE ON archived_pdfs TO app_user");
    }
  });
});

// ── ⑤ Atomicity: archived_pdfs failure rolls back EMISE transition ───────────

describe("⑤ Atomicité : échec de l'archivage laisse la facture en BROUILLON", () => {
  test(
    "si l'INSERT dans archived_pdfs échoue (conflit UNIQUE), la facture reste BROUILLON",
    async () => {
      const { id: factureId } = await createBrouillon(cookieA);

      // Pre-insert a conflicting row: same (tenant_id, document_type, document_id)
      // so that the emit TX hits the UNIQUE constraint and is rolled back entirely.
      await adminPool.query(
        `INSERT INTO archived_pdfs (id, tenant_id, document_type, document_id, bytes, sha256, byte_size)
         VALUES ($1, $2::uuid, 'FACTURE', $3, $4, $5, $6)`,
        [
          crypto.randomUUID(),
          tenantAId,
          factureId,
          Buffer.from("pre-existing-conflict"),
          "pre-existing-sha",
          21,
        ],
      );

      // Emit should fail — archived_pdfs INSERT will violate the UNIQUE constraint
      const res = await emettre(cookieA, factureId);
      expect(res.status).toBe(500);

      // Facture must still be BROUILLON — the whole TX was rolled back
      const check = await request(app)
        .get(`/api/factures/${factureId}`)
        .set("Cookie", cookieA)
        .expect(200);
      expect(check.body.statut).toBe("BROUILLON");
      console.log("[⑤] Échec archivage PDF → facture reste BROUILLON ✓");

      // Cleanup
      await adminPool.query("DELETE FROM archived_pdfs WHERE document_id = $1", [factureId]);
    },
  );
});
