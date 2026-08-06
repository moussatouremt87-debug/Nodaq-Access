import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * Owner pool — used exclusively by migration scripts (DATABASE_URL = postgres superuser).
 * Never use this in application routes; use `db` / `pool` (backed by app_user) instead.
 */
export const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * Application pool — backed by `app_user` (non-owner role) when DATABASE_URL_APP is set.
 * Falls back to DATABASE_URL during initial setup (before the secret is configured).
 * The startup check in app.ts enforces that the correct role is active at runtime.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL_APP ?? process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });

export * from "./schema";
