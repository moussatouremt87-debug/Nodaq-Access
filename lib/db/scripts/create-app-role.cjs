/**
 * Idempotent script — creates (or resets the password of) app_user and grants
 * it the minimum privileges needed to run the application.
 *
 * Run with the OWNER credentials (DATABASE_URL) — NEVER with DATABASE_URL_APP.
 *
 *   node lib/db/scripts/create-app-role.cjs
 *
 * The script prints a DATABASE_URL_APP value to stdout.
 * Copy it into the DATABASE_URL_APP Replit Secret.
 *
 * When to re-run: if the database is recreated or the app_user password is lost.
 */
"use strict";

const { Pool } = require("pg");
const crypto = require("crypto");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const ownerPool = new Pool({ connectionString: process.env.DATABASE_URL });
const password = crypto.randomBytes(24).toString("hex");

const CREATE_OR_RESET = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD '${password.replace(/'/g, "''")}';
  ELSE
    ALTER ROLE app_user WITH PASSWORD '${password.replace(/'/g, "''")}';
  END IF;
END
$$;
`;

const GRANTS = [
  `GRANT USAGE ON SCHEMA public TO app_user`,
  `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user`,
  `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user`,
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public
     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user`,
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public
     GRANT USAGE, SELECT ON SEQUENCES TO app_user`,
];

ownerPool.connect().then(async (client) => {
  try {
    await client.query(CREATE_OR_RESET);
    for (const sql of GRANTS) {
      await client.query(sql);
    }
    client.release();

    // Build DATABASE_URL_APP from DATABASE_URL, substituting user + password
    const appUrl = new URL(process.env.DATABASE_URL);
    appUrl.username = "app_user";
    appUrl.password = password;

    console.log("\n✓ app_user created / password reset");
    console.log("\nAdd this to your Replit Secrets as DATABASE_URL_APP:");
    console.log(appUrl.toString());
  } catch (err) {
    client.release();
    console.error("Failed:", err.message);
    process.exit(1);
  } finally {
    await ownerPool.end();
  }
});
