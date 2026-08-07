/**
 * withTenant — the only authorised entry point for business-table queries.
 *
 * Opens a Drizzle transaction, injects `set_config('app.current_tenant_id',
 * tenantId, true)` (the third argument `true` makes the setting transactional
 * — it is automatically reverted when the transaction ends), then calls the
 * supplied callback with the transaction object.
 *
 * PostgreSQL RLS policies on business tables read this GUC via
 *   tenant_id::text = current_setting('app.current_tenant_id', true)
 * so all SELECT / INSERT / UPDATE / DELETE are automatically scoped to the
 * tenant for the lifetime of the transaction.
 *
 * Usage:
 *   import { withTenant } from "@workspace/db";
 *   const result = await withTenant(tenantId, async (tx) => {
 *     return tx.select().from(affairesTable);
 *   });
 */
import { sql } from "drizzle-orm";
import { db } from "./index";

/** Exact type of the `tx` object Drizzle passes to a transaction callback. */
export type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function withTenant<T>(
  tenantId: string,
  fn: (tx: DrizzleTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // set_config third arg = true → local to current transaction
    await tx.execute(
      sql`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`,
    );
    return fn(tx);
  });
}
