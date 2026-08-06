/**
 * Phase 2 — Multi-tenant schema migration.
 *
 * Idempotent — safe to run on a fresh or an already-migrated database.
 * Must be run with OWNER credentials (DATABASE_URL), not DATABASE_URL_APP.
 *
 *   node lib/db/scripts/migrate-multitenant.cjs
 */
"use strict";

const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── Helpers ─────────────────────────────────────────────────────────────────

async function colExists(client, table, col) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, col],
  );
  return rows.length > 0;
}

async function constraintExists(client, name) {
  const { rows } = await client.query(
    `SELECT 1 FROM pg_constraint WHERE conname = $1`,
    [name],
  );
  return rows.length > 0;
}

async function indexExists(client, name) {
  const { rows } = await client.query(
    `SELECT 1 FROM pg_indexes WHERE indexname = $1`,
    [name],
  );
  return rows.length > 0;
}

async function addTenantId(client, table) {
  if (!(await colExists(client, table, "tenant_id"))) {
    await client.query(
      `ALTER TABLE ${table} ADD COLUMN tenant_id UUID`,
    );
    console.log(`  + ${table}.tenant_id column added`);
  }
}

async function backfill(client, table, tenantId) {
  const { rowCount } = await client.query(
    `UPDATE ${table} SET tenant_id = $1 WHERE tenant_id IS NULL`,
    [tenantId],
  );
  if (rowCount > 0) console.log(`  ~ ${table}: ${rowCount} rows backfilled`);
}

async function setNotNull(client, table) {
  // PostgreSQL ignores SET NOT NULL if column is already NOT NULL (idempotent)
  await client.query(
    `ALTER TABLE ${table} ALTER COLUMN tenant_id SET NOT NULL`,
  );
}

async function addForeignKey(client, table) {
  const conname = `${table}_tenant_id_fkey`;
  if (!(await constraintExists(client, conname))) {
    await client.query(
      `ALTER TABLE ${table}
       ADD CONSTRAINT ${conname}
       FOREIGN KEY (tenant_id) REFERENCES tenants(id)`,
    );
  }
}

async function addIndexes(client, table, hasCreatedAt) {
  const idxId = `${table}_tenant_id_id_idx`;
  if (!(await indexExists(client, idxId))) {
    await client.query(
      `CREATE INDEX ${idxId} ON ${table} (tenant_id, id)`,
    );
  }
  if (hasCreatedAt) {
    const idxCa = `${table}_tenant_id_created_at_idx`;
    if (!(await indexExists(client, idxCa))) {
      await client.query(
        `CREATE INDEX ${idxCa} ON ${table} (tenant_id, created_at)`,
      );
    }
  }
}

/** Apply the full standard flow for a business table that has an `id` column. */
async function migrateStandard(client, table, tenantId, hasCreatedAt = true) {
  await addTenantId(client, table);
  await backfill(client, table, tenantId);
  await setNotNull(client, table);
  await addForeignKey(client, table);
  await addIndexes(client, table, hasCreatedAt);
}

// ── Migration steps ──────────────────────────────────────────────────────────

async function createInfrastructureTables(client) {
  console.log("\n[1] Creating infrastructure tables…");

  await client.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      nom        TEXT        NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      email         TEXT        NOT NULL,
      password_hash TEXT        NOT NULL,
      nom           TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ,
      UNIQUE (email)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS memberships (
      id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      role       TEXT        NOT NULL DEFAULT 'MEMBER',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, tenant_id)
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      user_agent TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  console.log("  ✓ tenants, users, memberships, sessions");
}

async function ensureMigrationTenant(client) {
  console.log("\n[2] Ensuring Migration tenant…");
  let { rows } = await client.query(
    `SELECT id FROM tenants WHERE nom = 'Migration' LIMIT 1`,
  );
  if (rows.length === 0) {
    const res = await client.query(
      `INSERT INTO tenants (nom) VALUES ('Migration') RETURNING id`,
    );
    rows = res.rows;
    console.log(`  + Migration tenant created: ${rows[0].id}`);
  } else {
    console.log(`  ~ Migration tenant already exists: ${rows[0].id}`);
  }
  return rows[0].id;
}

async function migrateBusinessTables(client, tenantId) {
  console.log("\n[3] Migrating 15 business tables (incl. absences)…");

  // Standard tables (have id + created_at)
  for (const table of [
    "affaires", "contrats", "factures", "prospects",
    "pending_actions", "chat_messages", "activity", "devis",
    "classeur_documents", "echeances", "team_members",
  ]) {
    await migrateStandard(client, table, tenantId, true);
  }

  // ── connectors (has created_at; also fix unique constraint from type → tenant_id+type)
  await addTenantId(client, "connectors");
  await backfill(client, "connectors", tenantId);
  await setNotNull(client, "connectors");
  await addForeignKey(client, "connectors");
  await addIndexes(client, "connectors", true);
  // Migrate unique(type) → unique(tenant_id, type)
  if (
    (await constraintExists(client, "connectors_type_unique")) &&
    !(await constraintExists(client, "connectors_tenant_type_unique"))
  ) {
    await client.query(
      `ALTER TABLE connectors DROP CONSTRAINT connectors_type_unique`,
    );
    await client.query(
      `ALTER TABLE connectors ADD CONSTRAINT connectors_tenant_type_unique UNIQUE (tenant_id, type)`,
    );
    console.log("  ~ connectors: unique(type) → unique(tenant_id, type)");
  }

  // ── settings (no id column; PK must change from key → (tenant_id, key))
  await addTenantId(client, "settings");
  await backfill(client, "settings", tenantId);
  // Change PK if it's still single-column (just "key")
  if (
    (await constraintExists(client, "settings_pkey")) &&
    !(await constraintExists(client, "settings_tenant_key_pkey"))
  ) {
    await client.query(`ALTER TABLE settings DROP CONSTRAINT settings_pkey`);
    await client.query(
      `ALTER TABLE settings ADD CONSTRAINT settings_tenant_key_pkey PRIMARY KEY (tenant_id, key)`,
    );
    console.log("  ~ settings: PK (key) → PK (tenant_id, key)");
  }
  await setNotNull(client, "settings");
  await addForeignKey(client, "settings");
  // settings has no id or created_at — index only on tenant_id
  if (!(await indexExists(client, "settings_tenant_id_idx"))) {
    await client.query(
      `CREATE INDEX settings_tenant_id_idx ON settings (tenant_id)`,
    );
  }

  // ── absences (has id + created_at; also add FK on membre_id → team_members)
  await addTenantId(client, "absences");
  await backfill(client, "absences", tenantId);
  await setNotNull(client, "absences");
  await addForeignKey(client, "absences");
  // absences-specific indexes
  if (!(await indexExists(client, "absences_tenant_id_idx"))) {
    await client.query(`CREATE INDEX absences_tenant_id_idx ON absences (tenant_id)`);
  }
  if (!(await indexExists(client, "absences_membre_date_fin_idx"))) {
    await client.query(`CREATE INDEX absences_membre_date_fin_idx ON absences (membre_id, date_fin)`);
  }

  // ── cr_entries (has id, no created_at; fix unique(period_key,line_code) → tenant-scoped)
  await addTenantId(client, "cr_entries");
  await backfill(client, "cr_entries", tenantId);
  // Update unique constraint to include tenant_id
  if (
    !(await constraintExists(client, "cr_entries_tenant_period_line"))
  ) {
    // Drop the old constraint if it exists without tenant_id
    const oldConstraints = ["cr_entries_period_key_line_code_key"];
    for (const c of oldConstraints) {
      if (await constraintExists(client, c)) {
        await client.query(`ALTER TABLE cr_entries DROP CONSTRAINT ${c}`);
        console.log(`  ~ cr_entries: dropped old unique constraint ${c}`);
      }
    }
    await client.query(
      `ALTER TABLE cr_entries ADD CONSTRAINT cr_entries_tenant_period_line
       UNIQUE (tenant_id, period_key, line_code)`,
    );
    console.log("  ~ cr_entries: UNIQUE now (tenant_id, period_key, line_code)");
  }
  await setNotNull(client, "cr_entries");
  await addForeignKey(client, "cr_entries");
  await addIndexes(client, "cr_entries", false);
}

async function logRowCounts(client) {
  console.log("\n[4] Row counts after migration:");
  const tables = [
    "affaires", "contrats", "factures", "prospects",
    "pending_actions", "chat_messages", "activity", "devis",
    "classeur_documents", "echeances", "team_members",
    "connectors", "settings", "cr_entries", "absences",
  ];
  for (const table of tables) {
    const { rows } = await client.query(
      `SELECT COUNT(*) AS total,
              COUNT(tenant_id) AS with_tenant
       FROM ${table}`,
    );
    const { total, with_tenant } = rows[0];
    const ok = total === with_tenant ? "✓" : "✗ BACKFILL INCOMPLETE";
    console.log(`  ${table}: ${with_tenant}/${total} rows have tenant_id ${ok}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

pool.connect().then(async (client) => {
  try {
    await createInfrastructureTables(client);
    const tenantId = await ensureMigrationTenant(client);
    await migrateBusinessTables(client, tenantId);
    await logRowCounts(client);
    console.log("\n✓ Phase 2 migration complete");
  } catch (err) {
    console.error("\nMigration failed:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
});
