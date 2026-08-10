#!/usr/bin/env node
/**
 * Purge des contacts de prospection sans interaction depuis trois ans.
 *
 *   node lib/db/scripts/purger-prospection.mjs [--jours 1095]
 *
 * ── POURQUOI UN SCRIPT ET NON UNE ROUTE ─────────────────────────────────────
 * `contact_bases` est APPEND-ONLY : `app_user` n'a que SELECT et INSERT. Une
 * route applicative ne peut donc PAS purger, et c'est voulu — le journal des
 * bases légales est ce qui tient le jour d'un contrôle.
 *
 * La purge de conservation est une opération de PROPRIÉTAIRE, comme la purge
 * du journal d'envois que la migration 009 confie déjà au propriétaire. Elle
 * tourne avec `DATABASE_URL`, pas `DATABASE_URL_APP`.
 *
 * Donner le DELETE à `app_user` pour faire tenir la purge dans une route
 * aurait détruit l'append-only pour toutes les autres écritures. Le coût est
 * une tâche d'exploitation ; le bénéfice est un journal qui ne se réécrit pas.
 *
 * ── CE QU'ELLE ÉPARGNE ──────────────────────────────────────────────────────
 * Les contacts rattachés à un CLIENT. Ce n'est plus de la prospection, c'est
 * la relation client, et sa conservation suit la durée comptable.
 *
 * ── CE QU'ELLE EMPORTE ──────────────────────────────────────────────────────
 * Les bases légales du contact partent avec lui : conserver la trace d'une
 * base légale pour une personne qu'on a effacée reviendrait à conserver la
 * personne. Les OPPOSITIONS, elles, restent — c'est une empreinte, pas une
 * identité, et l'effacer ferait ressusciter la personne au prochain import.
 */
import pg from "pg";

const { Pool } = pg;

/** Trois ans, comme la recommandation de la CNIL pour la prospection. */
const JOURS_PAR_DEFAUT = 3 * 365;

function jours() {
  const i = process.argv.indexOf("--jours");
  if (i === -1) return JOURS_PAR_DEFAUT;
  const n = Number(process.argv[i + 1]);
  if (!Number.isInteger(n) || n <= 0) {
    console.error("[purge] --jours attend un entier positif.");
    process.exit(1);
  }
  return n;
}

/** Date métier limite, en composantes LOCALES. Jamais un instant. */
function dateLimite(retentionJours) {
  const d = new Date();
  d.setDate(d.getDate() - retentionJours);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[purge] DATABASE_URL doit être définie (rôle propriétaire).");
    process.exit(1);
  }

  const retentionJours = jours();
  const limite = dateLimite(retentionJours);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT id FROM contacts_prospection
          WHERE client_id IS NULL
            AND coalesce(derniere_interaction_le, created_at::date) < $1::date`,
        [limite],
      );
      const ids = rows.map((r) => r.id);
      if (ids.length > 0) {
        await client.query(`DELETE FROM contact_bases WHERE contact_id = ANY($1::text[])`, [ids]);
        await client.query(`DELETE FROM contacts_prospection WHERE id = ANY($1::text[])`, [ids]);
      }
      await client.query("COMMIT");
      // Un décompte, jamais un nom ni une adresse.
      console.log(`[purge] contacts supprimés: ${ids.length} | limite: ${limite}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[purge]", err instanceof Error ? err.message : "échec");
  process.exit(1);
});
