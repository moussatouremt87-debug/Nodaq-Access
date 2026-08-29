import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { optionsTls } from "./tls";

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
/*
 * Le TLS est décidé ICI, pas dans la chaîne de connexion.
 *
 * Mesuré le 29/08/2026 : le serveur de production accepte le clair, et rien
 * n'obligeait l'application à chiffrer. Une propriété de sécurité qui dépend
 * de ce qu'on a tapé dans un secret n'est pas une propriété : personne ne la
 * relit, et une omission ne se voit jamais. Voir `tls.ts`.
 *
 * En production sans `DATABASE_CA_PEM`, `optionsTls` LÈVE : l'application ne
 * démarre pas. C'est voulu — tomber est bruyant, fuir ne l'est pas.
 */
const ssl = optionsTls(process.env.DATABASE_URL_APP);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL_APP,
  ...(ssl ? { ssl } : {}),
});
export const db = drizzle(pool, { schema });

export * from "./schema";
export { optionsTls, DbTlsError, hoteDe, type OptionsTls } from "./tls";
export { withTenant, type DrizzleTx } from "./withTenant";
