/**
 * Idempotent, non-interactive migration for the three platform tables:
 * team_members, connectors, settings.
 *
 * Runs standalone (no drizzle-kit) so it never prompts for input.
 * Safe to run on a fresh or an already-migrated database.
 */
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS team_members (
    id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name        TEXT        NOT NULL,
    role        TEXT        NOT NULL DEFAULT 'Collaborateur',
    email       TEXT,
    availability TEXT       NOT NULL DEFAULT 'DISPONIBLE',
    schedule    TEXT        NOT NULL DEFAULT '[]',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS connectors (
    id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    type        TEXT        NOT NULL,
    label       TEXT        NOT NULL,
    description TEXT,
    status      TEXT        NOT NULL DEFAULT 'NON_CONNECTE',
    config      JSONB       NOT NULL DEFAULT '{}',
    last_sync_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `DO $$ BEGIN
     IF NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'connectors_type_unique'
     ) THEN
       ALTER TABLE connectors ADD CONSTRAINT connectors_type_unique UNIQUE (type);
     END IF;
   END $$`,
  `CREATE TABLE IF NOT EXISTS settings (
    key        TEXT        PRIMARY KEY,
    value      TEXT        NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
];

const client = await pool.connect();
try {
  for (const sql of STATEMENTS) {
    await client.query(sql);
  }
  console.log("✓ Platform tables ready (team_members, connectors, settings)");
} finally {
  client.release();
  await pool.end();
}
