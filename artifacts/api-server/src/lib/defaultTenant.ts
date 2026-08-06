/**
 * Phase 2 shim — provides the Migration tenant ID for INSERT operations.
 *
 * Phase 3 will replace all direct `db` usage with `withTenant(tenantId, ...)`,
 * where tenantId comes from the authenticated session. Until then, all writes
 * go to the single Migration tenant created by migrate-multitenant.cjs.
 */
import { pool } from "@workspace/db";

let cachedTenantId: string | null = null;

export async function getDefaultTenantId(): Promise<string> {
  if (cachedTenantId) return cachedTenantId;
  const result = await pool.query<{ id: string }>(
    `SELECT id FROM tenants ORDER BY created_at LIMIT 1`,
  );
  if (result.rows.length === 0) {
    throw new Error(
      "No tenant found in database. Run `node lib/db/scripts/migrate-multitenant.cjs` first.",
    );
  }
  cachedTenantId = result.rows[0].id;
  return cachedTenantId;
}
