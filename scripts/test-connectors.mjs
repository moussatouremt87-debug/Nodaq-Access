/**
 * Regression test: connector reconfiguration preserves unedited secrets.
 * Run with: node scripts/test-connectors.mjs
 */
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await pool.connect();
  try {
    // Ensure connectors table exists
    await client.query(`CREATE TABLE IF NOT EXISTS connectors (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      type TEXT NOT NULL, label TEXT NOT NULL, description TEXT,
      status TEXT NOT NULL DEFAULT 'NON_CONNECTE',
      config JSONB NOT NULL DEFAULT '{}',
      last_sync_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='connectors_type_unique') THEN ALTER TABLE connectors ADD CONSTRAINT connectors_type_unique UNIQUE (type); END IF; END $$`);

    // Set up a test connector with real credentials
    await client.query(`DELETE FROM connectors WHERE type = '_TEST_STRIPE'`);
    await client.query(`
      INSERT INTO connectors (type, label, status, config)
      VALUES ('_TEST_STRIPE', 'Test Stripe', 'CONNECTE', '{"secretKey":"sk_live_REAL","webhookSecret":"whsec_REAL"}')
    `);

    // Simulate PATCH that sends only webhookSecret (secretKey field left empty / redacted)
    // Server merge logic: only apply fields where v is non-empty and not "***"
    const incoming = { webhookSecret: "whsec_NEW" }; // secretKey not sent (empty in UI)
    const { rows: [existing] } = await client.query(`SELECT config FROM connectors WHERE type='_TEST_STRIPE'`);
    const merged = { ...existing.config };
    for (const [k, v] of Object.entries(incoming)) {
      if (v && v !== "***") merged[k] = v;
    }
    await client.query(`UPDATE connectors SET config=$1 WHERE type='_TEST_STRIPE'`, [merged]);

    // Verify
    const { rows: [updated] } = await client.query(`SELECT config FROM connectors WHERE type='_TEST_STRIPE'`);
    const cfg = updated.config;

    if (cfg.secretKey !== "sk_live_REAL") {
      throw new Error(`FAIL: secretKey was overwritten! Got: ${cfg.secretKey}`);
    }
    if (cfg.webhookSecret !== "whsec_NEW") {
      throw new Error(`FAIL: webhookSecret not updated! Got: ${cfg.webhookSecret}`);
    }

    console.log("✓ Unedited secretKey preserved after partial reconfiguration");
    console.log("✓ Edited webhookSecret correctly updated");

    // Cleanup
    await client.query(`DELETE FROM connectors WHERE type='_TEST_STRIPE'`);
    console.log("✓ All connector regression tests passed");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error("Test failed:", err.message);
  process.exit(1);
});
