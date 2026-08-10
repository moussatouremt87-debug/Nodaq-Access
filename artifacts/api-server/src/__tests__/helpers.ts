/**
 * RLS test helpers.
 *
 * - adminPool  — connects with DATABASE_URL (postgres superuser).
 *                Superusers always bypass RLS, so insertions here
 *                are not filtered by tenant_isolation policies.
 * - signCookie — creates the signed `nodaq_sid` cookie value that
 *                matches what Express cookie-parser produces and
 *                verifies, so test requests can authenticate without
 *                going through the real register/login endpoints.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

// ── Admin pool (superuser — bypasses RLS for fixture setup/tear-down) ─────

export const adminPool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

// ── Cookie signing ────────────────────────────────────────────────────────
// Mirrors Express cookie-parser's signed-cookie format:
//   signed value  = sessionId + '.' + HMAC-SHA256(sessionId, secret).base64NoPad
//   cookie header = nodaq_sid=s%3A<url-encoded signed value>

export function signCookie(sessionId: string): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET must be set in the test environment");
  const hmac = crypto
    .createHmac("sha256", secret)
    .update(sessionId)
    .digest("base64")
    .replace(/=+$/, "");
  return `s%3A${encodeURIComponent(`${sessionId}.${hmac}`)}`;
}

/** Returns a Cookie header string for a given session UUID. */
export function cookieHeader(sessionId: string): string {
  return `nodaq_sid=${signCookie(sessionId)}`;
}

// ── Fixture creation helpers ──────────────────────────────────────────────

export interface TestTenant { id: string; nom: string }
export interface TestUser   { id: string; email: string; passwordHash: string }
export interface TestMember { id: string; name: string; tenantId: string }
export interface TestSession { id: string; userId: string; tenantId: string; expiresAt: Date }

export async function createTestTenant(nom = "Test Tenant"): Promise<TestTenant> {
  const { rows } = await adminPool.query<TestTenant>(
    "INSERT INTO tenants (id, nom) VALUES (gen_random_uuid(), $1) RETURNING id, nom",
    [nom + " " + Date.now()],
  );
  return rows[0]!;
}

export async function createTestUser(
  email: string,
  password = "testpassword1234",
): Promise<TestUser & { password: string }> {
  const passwordHash = await bcrypt.hash(password, 4); // low rounds for speed
  const { rows } = await adminPool.query<TestUser>(
    "INSERT INTO users (id, email, password_hash, nom) VALUES (gen_random_uuid(), $1, $2, $1) RETURNING id, email, password_hash",
    [email, passwordHash],
  );
  return { ...rows[0]!, password };
}

export async function createTestMembership(
  userId: string,
  tenantId: string,
  role: "OWNER" | "MEMBER" | "ACCOUNTANT" = "MEMBER",
): Promise<void> {
  await adminPool.query(
    "INSERT INTO memberships (id, user_id, tenant_id, role) VALUES (gen_random_uuid(), $1, $2, $3) ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = $3",
    [userId, tenantId, role],
  );
}

export async function createTestSession(
  userId: string,
  tenantId: string,
  expiresAt?: Date,
): Promise<TestSession> {
  const exp = expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const { rows } = await adminPool.query<TestSession>(
    `INSERT INTO sessions (id, user_id, tenant_id, expires_at)
     VALUES (gen_random_uuid(), $1, $2, $3)
     RETURNING id, user_id AS "userId", tenant_id AS "tenantId", expires_at AS "expiresAt"`,
    [userId, tenantId, exp],
  );
  return rows[0]!;
}

export async function createTestTeamMember(
  tenantId: string,
  name = "Test Member",
): Promise<TestMember> {
  const { rows } = await adminPool.query<TestMember>(
    `INSERT INTO team_members (id, name, tenant_id)
     VALUES (gen_random_uuid()::text, $1, $2)
     RETURNING id, name, tenant_id AS "tenantId"`,
    [name, tenantId],
  );
  return rows[0]!;
}

// ── Cleanup ───────────────────────────────────────────────────────────────
// Cleans everything owned by the given test tenants.
// Order matters — FK constraints cascade from business tables → infra tables.

// Order matters — pointages has FKs to team_members and affaires, so it must be
// deleted before them.
const BUSINESS_TABLES = [
  "pointages", "catalogue_lignes",
  "absences", "activity", "affaires", "analytics_tool_logs", "archived_pdfs", "chat_messages", "classeur_documents",
  "connectors", "contrats", "cr_entries", "devis", "echeances",
  "avoirs", "facture_sequences", "factures",
  "pending_actions", "prospects", "settings", "team_members",
];

export async function cleanupTenants(...tenantIds: string[]): Promise<void> {
  if (tenantIds.length === 0) return;
  const ids = tenantIds;
  const params = ids.map((_, i) => `$${i + 1}`).join(", ");
  for (const table of BUSINESS_TABLES) {
    await adminPool.query(`DELETE FROM ${table} WHERE tenant_id::text = ANY(ARRAY[${params}])`, ids);
  }
  await adminPool.query(`DELETE FROM sessions   WHERE tenant_id::text = ANY(ARRAY[${params}])`, ids);
  await adminPool.query(`DELETE FROM memberships WHERE tenant_id::text = ANY(ARRAY[${params}])`, ids);
  await adminPool.query(`DELETE FROM tenants     WHERE id::text = ANY(ARRAY[${params}])`, ids);
}

export async function cleanupUsers(...emails: string[]): Promise<void> {
  if (emails.length === 0) return;
  const params = emails.map((_, i) => `$${i + 1}`).join(", ");
  await adminPool.query(`DELETE FROM users WHERE email = ANY(ARRAY[${params}])`, emails);
}

// ── Minimal SQL inserts for all 15 business tables ────────────────────────
// Returns a SQL string and parameters to insert one test row for a given tenantId.
// All values are intentionally minimal — only NOT-NULL-without-default columns are set.

export function tableInsertSql(table: string, tenantId: string, memberAId?: string): [string, unknown[]] {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const map: Record<string, [string, unknown[]]> = {
    activity:             [`INSERT INTO activity (id, label, type, tenant_id) VALUES ($1, 'rls-test', 'NOTE', $2)`, [id, tenantId]],
    affaires:             [`INSERT INTO affaires (id, label, tenant_id) VALUES ($1, 'rls-test', $2)`, [id, tenantId]],
    analytics_tool_logs:  [`INSERT INTO analytics_tool_logs (tenant_id, indicateur_id, status) VALUES ($1, 'ca_facture', 'ok')`, [tenantId]],
    chat_messages:      [`INSERT INTO chat_messages (id, content, conversation_id, role, tenant_id) VALUES ($1, 'rls-test', 'conv-rls', 'user', $2)`, [id, tenantId]],
    classeur_documents: [`INSERT INTO classeur_documents (id, name, tenant_id) VALUES ($1, 'rls-test', $2)`, [id, tenantId]],
    connectors:         [`INSERT INTO connectors (id, label, type, tenant_id) VALUES ($1, 'rls-test', 'STRIPE_TEST', $2)`, [id, tenantId]],
    contrats:           [`INSERT INTO contrats (id, label, tenant_id) VALUES ($1, 'rls-test', $2)`, [id, tenantId]],
    // cr_entries: id is a TEXT PK generated by the app (Drizzle $defaultFn) — must be supplied in raw SQL
    cr_entries:         [`INSERT INTO cr_entries (id, line_code, period_key, tenant_id) VALUES ($1, 'RLS_TEST', '2020-01-01:2020-12-31', $2) ON CONFLICT DO NOTHING`, [id, tenantId]],
    devis:              [`INSERT INTO devis (id, client_name, reference, tenant_id) VALUES ($1, 'RLS Client', 'RLS-001', $2)`, [id, tenantId]],
    echeances:          [`INSERT INTO echeances (id, label, type, due_date, tenant_id) VALUES ($1, 'rls-test', 'LOYER', $2, $3)`, [id, now, tenantId]],
    factures:           [`INSERT INTO factures (id, number, customer_name, amount_cents, due_date, issued_date, tenant_id) VALUES ($1, 'RLS-F-001', 'RLS Client', 1000, $2, $2, $3)`, [id, now, tenantId]],
    pending_actions:    [`INSERT INTO pending_actions (id, label, type, tenant_id) VALUES ($1, 'rls-test', 'SIGNATURE', $2)`, [id, tenantId]],
    prospects:          [`INSERT INTO prospects (id, name, tenant_id) VALUES ($1, 'RLS Prospect', $2)`, [id, tenantId]],
    settings:           [`INSERT INTO settings (key, value, tenant_id) VALUES ('rls_test_key', 'v', $1) ON CONFLICT DO NOTHING`, [tenantId]],
    team_members:       [`INSERT INTO team_members (id, name, tenant_id) VALUES ($1, 'RLS Member', $2)`, [id, tenantId]],
    absences:           memberAId
      ? [`INSERT INTO absences (id, membre_id, date_debut, date_fin, tenant_id) VALUES ($1, $2, $3, $3, $4) ON CONFLICT DO NOTHING`, [id, memberAId, now, tenantId]]
      : [`SELECT 1`, []], // skip if no member provided
    // archived_pdfs: id is TEXT PK, bytes is BYTEA — both must be supplied explicitly.
    archived_pdfs:    [`INSERT INTO archived_pdfs (id, tenant_id, document_type, document_id, bytes, sha256, byte_size) VALUES ($1, $2::uuid, 'FACTURE', $3, $4, $5, $6) ON CONFLICT DO NOTHING`, [id, tenantId, crypto.randomUUID(), Buffer.from("rls-test-pdf"), "rls-test-sha256-placeholder", 12]],
    // avoirs: id is a TEXT PK with no default — must be supplied in raw SQL.
    // facture_ref_id carries no FK, so an arbitrary id is fine here.
    avoirs:           [`INSERT INTO avoirs (id, tenant_id, numero, facture_ref_id, montant_ht_cents, motif) VALUES ($1, $2::uuid, 'RLS-AV-001', $3, 1000, 'rls-test') ON CONFLICT DO NOTHING`, [id, tenantId, crypto.randomUUID()]],
    // facture_sequences: composite PK (tenant_id, year) — NO id column.
    // One row per tenant per year, so both test tenants can hold year 2020.
    facture_sequences: [`INSERT INTO facture_sequences (tenant_id, year) VALUES ($1::uuid, 2020) ON CONFLICT DO NOTHING`, [tenantId]],
    // catalogue_lignes: prix en centimes, mots_cles est un text[].
    catalogue_lignes: [`INSERT INTO catalogue_lignes (id, tenant_id, libelle, unite, prix_unitaire_ht_cents, mots_cles) VALUES ($1, $2::uuid, 'Cloison BA13 rls-test', 'm2', 4500, ARRAY['placo','ba13']) ON CONFLICT DO NOTHING`, [id, tenantId]],
    // pointages: needs BOTH a member and an affaire (real FKs). The affaire is
    // created in the same statement via a CTE, so the helper keeps its
    // (table, tenantId, memberAId) signature.
    pointages: memberAId
      ? [
          `WITH nouvelle_affaire AS (
             INSERT INTO affaires (id, label, tenant_id) VALUES ($1, 'rls-test-pointage', $2::uuid)
             RETURNING id
           )
           INSERT INTO pointages (id, tenant_id, membre_id, affaire_id, date, heures)
           SELECT $3, $2::uuid, $4, nouvelle_affaire.id, DATE '2020-01-06', 7.00
           FROM nouvelle_affaire
           ON CONFLICT DO NOTHING`,
          [crypto.randomUUID(), tenantId, id, memberAId],
        ]
      : [`SELECT 1`, []], // skip if no member provided
  };

  return map[table] ?? [`SELECT 1`, []];
}

