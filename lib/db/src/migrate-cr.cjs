/**
 * Idempotent migration for the cr_entries (Compte de Résultat) table.
 * CommonJS — runs with plain `node`, no tsx/ts-node required.
 */
"use strict";

const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS cr_entries (
    id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    period_key  TEXT        NOT NULL,
    line_code   TEXT        NOT NULL,
    amount_cents INTEGER    NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (period_key, line_code)
  )`,
];

async function run() {
  const client = await pool.connect();
  try {
    for (const sql of STATEMENTS) {
      await client.query(sql);
      console.log("OK:", sql.slice(0, 60).replace(/\s+/g, " "));
    }
    console.log("Migration complete.");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
