/**
 * Facturation migration — devis étendu, factures conformes, séquences, avoirs.
 *
 * Idempotent — safe to run on a fresh or already-migrated database.
 * Requires DATABASE_URL (owner/superuser) OR falls back to DATABASE_URL_APP.
 *
 *   node lib/db/scripts/migrate-facturation.cjs
 */
"use strict";

const { Pool } = require("pg");

const connStr = process.env.DATABASE_URL || process.env.DATABASE_URL_APP;
if (!connStr) {
  console.error("DATABASE_URL or DATABASE_URL_APP must be set");
  process.exit(1);
}

const pool = new Pool({ connectionString: connStr });

async function colExists(client, table, col) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, col],
  );
  return rows.length > 0;
}

async function tableExists(client, table) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return rows.length > 0;
}

async function addCol(client, table, col, definition) {
  if (await colExists(client, table, col)) {
    console.log(`  ~ ${table}.${col} already exists`);
  } else {
    await client.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${definition}`);
    console.log(`  + ${table}.${col} added`);
  }
}

pool.connect().then(async (client) => {
  try {
    console.log("[Facturation] Migrating devis…");

    // devis — new columns
    await addCol(client, "devis", "client_address", "JSONB");
    await addCol(client, "devis", "chantier_address", "JSONB");
    await addCol(client, "devis", "autoliquidation", "BOOLEAN NOT NULL DEFAULT FALSE");
    await addCol(client, "devis", "retenue_garantie_pct", "REAL NOT NULL DEFAULT 0");
    await addCol(client, "devis", "accept_token", "TEXT");
    await addCol(client, "devis", "accepted_at", "TIMESTAMPTZ");
    await addCol(client, "devis", "accepted_by", "TEXT");
    await addCol(client, "devis", "accepted_ip", "TEXT");
    await addCol(client, "devis", "date_envoi", "TIMESTAMPTZ");

    console.log("[Facturation] Migrating factures…");

    // factures — new columns
    await addCol(client, "factures", "statut", "TEXT NOT NULL DEFAULT 'BROUILLON'");
    await addCol(client, "factures", "lines", "JSONB NOT NULL DEFAULT '[]'");
    await addCol(client, "factures", "total_ht_cents", "INTEGER NOT NULL DEFAULT 0");
    await addCol(client, "factures", "total_tva_cents", "INTEGER NOT NULL DEFAULT 0");
    await addCol(client, "factures", "client_address", "JSONB");
    await addCol(client, "factures", "chantier_address", "JSONB");
    await addCol(client, "factures", "autoliquidation", "BOOLEAN NOT NULL DEFAULT FALSE");
    await addCol(client, "factures", "attestation_tva_fournie", "BOOLEAN NOT NULL DEFAULT FALSE");
    await addCol(client, "factures", "pdf_path", "TEXT");
    await addCol(client, "factures", "pdf_sha256", "TEXT");
    await addCol(client, "factures", "avoir_id", "TEXT");

    // Backfill statut for existing rows: settled → PAYEE, else EMISE
    const { rowCount } = await client.query(`
      UPDATE factures
      SET statut = CASE WHEN settled = TRUE THEN 'PAYEE' ELSE 'EMISE' END
      WHERE statut = 'BROUILLON' AND number IS NOT NULL AND number != ''
    `);
    if (rowCount > 0) console.log(`  ~ factures: ${rowCount} rows backfilled with statut`);

    console.log("[Facturation] Creating facture_sequences…");

    if (!(await tableExists(client, "facture_sequences"))) {
      await client.query(`
        CREATE TABLE facture_sequences (
          tenant_id UUID    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          year      INTEGER NOT NULL,
          seq       INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (tenant_id, year)
        )
      `);
      console.log("  + facture_sequences created");
    } else {
      console.log("  ~ facture_sequences already exists");
    }

    // Grant app_user privileges on the new table (if app_user role exists)
    try {
      await client.query(`GRANT SELECT, INSERT, UPDATE ON facture_sequences TO app_user`);
      console.log("  ~ facture_sequences: GRANT to app_user");
    } catch {
      // app_user may not exist in all environments (e.g. fresh dev)
    }

    console.log("[Facturation] Applying RLS to facture_sequences…");
    try {
      await client.query(`ALTER TABLE facture_sequences ENABLE ROW LEVEL SECURITY`);
      await client.query(`ALTER TABLE facture_sequences FORCE ROW LEVEL SECURITY`);
      await client.query(`DROP POLICY IF EXISTS tenant_isolation ON facture_sequences`);
      await client.query(`
        CREATE POLICY tenant_isolation ON facture_sequences
          USING  (tenant_id::text = current_setting('app.current_tenant_id', true))
          WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true))
      `);
      console.log("  ✓ facture_sequences RLS applied");
    } catch (err) {
      console.log(`  ~ facture_sequences RLS (may need owner creds): ${err.message}`);
    }

    console.log("[Facturation] Creating avoirs…");

    if (!(await tableExists(client, "avoirs"))) {
      await client.query(`
        CREATE TABLE avoirs (
          id               TEXT        PRIMARY KEY,
          tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          numero           TEXT        NOT NULL,
          facture_ref_id   TEXT        NOT NULL,
          montant_ht_cents INTEGER     NOT NULL,
          montant_tva_cents INTEGER    NOT NULL DEFAULT 0,
          motif            TEXT        NOT NULL,
          pdf_sha256       TEXT,
          pdf_path         TEXT,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      console.log("  + avoirs created");
    } else {
      console.log("  ~ avoirs already exists");
    }

    try {
      await client.query(`GRANT SELECT, INSERT ON avoirs TO app_user`);
      console.log("  ~ avoirs: GRANT to app_user");
    } catch {
      // ignore
    }

    console.log("[Facturation] Applying RLS to avoirs…");
    try {
      await client.query(`ALTER TABLE avoirs ENABLE ROW LEVEL SECURITY`);
      await client.query(`ALTER TABLE avoirs FORCE ROW LEVEL SECURITY`);
      await client.query(`DROP POLICY IF EXISTS tenant_isolation ON avoirs`);
      await client.query(`
        CREATE POLICY tenant_isolation ON avoirs
          USING  (tenant_id::text = current_setting('app.current_tenant_id', true))
          WITH CHECK (tenant_id::text = current_setting('app.current_tenant_id', true))
      `);
      console.log("  ✓ avoirs RLS applied");
    } catch (err) {
      console.log(`  ~ avoirs RLS (may need owner creds): ${err.message}`);
    }

    // Also add an avoir sequence in facture_sequences (we'll use year=0 as a sentinel)
    // Actually avoirs use their own sequence column pattern — nothing extra needed in DB.

    console.log("\n✓ Facturation migration complete");
  } catch (err) {
    console.error("\nFacturation migration failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
});
