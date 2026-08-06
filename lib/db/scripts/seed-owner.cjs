/**
 * NODAQ — Owner seed script
 *
 * Creates the first tenant + OWNER user in a single atomic transaction.
 * Run once at first deployment (with DATABASE_URL = owner credentials):
 *
 *   node lib/db/scripts/seed-owner.cjs
 *
 * Or via pnpm:
 *   pnpm --filter @workspace/db run seed-owner
 *
 * The script prints generated credentials to stdout.
 * After running, you can delete the ADMIN_PASSWORD secret — it is no longer used.
 */
"use strict";

const { Pool }   = require("pg");
const bcrypt     = require("bcryptjs");
const readline   = require("node:readline");

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL must be set (owner credentials).");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: dbUrl });

  const tenantNom = (await prompt("Nom du cabinet / entreprise [NODAQ]: ")) || "NODAQ";
  const email     = await prompt("Email de l'admin (OWNER): ");
  const password  = await prompt("Mot de passe (min 10 caractères): ");
  const nom       = await prompt("Nom complet de l'admin [optionnel]: ");

  if (!email || !email.includes("@")) { console.error("Email invalide."); process.exit(1); }
  if (!password || password.length < 10) { console.error("Mot de passe trop court (min 10 caractères)."); process.exit(1); }

  const passwordHash = await bcrypt.hash(password, 12);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const tenantRes = await client.query(
      "INSERT INTO tenants (id, nom) VALUES (gen_random_uuid(), $1) RETURNING id, nom",
      [tenantNom],
    );
    const tenant = tenantRes.rows[0];

    const userRes = await client.query(
      "INSERT INTO users (id, email, password_hash, nom) VALUES (gen_random_uuid(), $1, $2, $3) RETURNING id",
      [email.toLowerCase().trim(), passwordHash, nom || email],
    );
    const userId = userRes.rows[0].id;

    await client.query(
      "INSERT INTO memberships (id, user_id, tenant_id, role) VALUES (gen_random_uuid(), $1, $2, 'OWNER')",
      [userId, tenant.id],
    );

    await client.query("COMMIT");

    console.log("\n✅  Seed complete!");
    console.log(`   Tenant  : ${tenant.nom} (${tenant.id})`);
    console.log(`   User    : ${email} (${userId})`);
    console.log(`   Role    : OWNER`);
    console.log("\n⚠️   You can now delete the ADMIN_PASSWORD secret — it is no longer used.\n");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed failed:", err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
