import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// The application runtime must connect as app_user (a non-owner role) so that
// PostgreSQL RLS policies are enforced. DATABASE_URL_APP is required; there is
// no fallback to the owner credentials.
//
// To provision app_user and obtain this value, run:
//   node lib/db/scripts/create-app-role.cjs
// then store the printed URL as the DATABASE_URL_APP Replit Secret.
if (!process.env.DATABASE_URL_APP) {
  throw new Error(
    "DATABASE_URL_APP must be set. " +
      "Run `node lib/db/scripts/create-app-role.cjs` (with DATABASE_URL owner credentials) " +
      "and store the printed connection string as the DATABASE_URL_APP Replit Secret.",
  );
}

/**
 * Application pool — authenticates as app_user (non-owner, restricted privileges).
 * Use this for all runtime queries. Never use owner credentials in the API server.
 *
 * Owner credentials (DATABASE_URL) are only consumed by standalone migration
 * scripts (migrate-platform.cjs, etc.) that run outside the application process.
 */
export const pool = new Pool({ connectionString: process.env.DATABASE_URL_APP });
export const db = drizzle(pool, { schema });

export * from "./schema";
export { withTenant, type DrizzleTx } from "./withTenant";
