#!/usr/bin/env node
/**
 * Reprise de `connectors.config` — sort les champs sensibles du `jsonb`.
 *
 *   node lib/db/scripts/migrate-connector-secrets.mjs
 *
 * ── POURQUOI UN SCRIPT ET NON LA MIGRATION 013 ──────────────────────────────
 * Le déplacement exige de CHIFFRER. Le faire en SQL exigerait de faire voyager
 * la clé dans l'instruction, donc dans `pg_stat_activity`, `pg_stat_statements`
 * et les journaux du serveur — précisément ce que ce lot interdit. La migration
 * SQL se contente donc de constater qu'il reste des lignes à reprendre ; le
 * déplacement se fait ici, dans l'application, où vit la clé.
 *
 * ── AUCUNE LIGNE N'EST CONCERNÉE AUJOURD'HUI ────────────────────────────────
 * Ce script existe pour FIGER LE FORMAT avant qu'un vrai connecteur ne dépose
 * un jeton. Écrit après coup, il serait écrit dans l'urgence, sur des données
 * de production, par quelqu'un qui découvre le problème.
 *
 * ── LE FORMAT ───────────────────────────────────────────────────────────────
 * Avant :  { "api_url": "https://…", "api_key": "sk-…", "token": "…" }
 * Après :  { "api_url": "https://…", "__secrets": ["api_key", "token"] }
 *
 * et dans `tenant_secrets` : « connecteur.<id>.api_key », « connecteur.<id>.token ».
 *
 * Le `jsonb` garde le NOM du champ sensible et non sa valeur : l'interface doit
 * pouvoir dire « une clé d'API est enregistrée » sans la lire.
 *
 * Idempotent : une ligne qui porte déjà `__secrets` est laissée en place.
 * N'affiche aucune valeur, seulement des décomptes.
 */
import pg from "pg";
import { chiffrer, verifierConfigurationChiffrement } from "@nodaq/crypto";

const { Pool } = pg;

/** Ce qui, dans un nom de champ, annonce un secret. Même liste que la garde. */
const MOTS_SENSIBLES = ["password", "secret", "token", "api_key", "credential"];

const estSensible = (champ) => MOTS_SENSIBLES.some((m) => champ.toLowerCase().includes(m));

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[connector-secrets] DATABASE_URL doit être définie (rôle propriétaire).");
    process.exit(1);
  }
  verifierConfigurationChiffrement();

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let reprises = 0;
  let ignorees = 0;
  let deplaces = 0;

  try {
    const { rows } = await pool.query(
      "SELECT id, tenant_id, config FROM connectors WHERE config IS NOT NULL ORDER BY id",
    );

    for (const r of rows) {
      const config = r.config ?? {};
      if (Object.prototype.hasOwnProperty.call(config, "__secrets")) {
        ignorees++;
        continue;
      }

      const sensibles = Object.keys(config).filter(estSensible);
      if (sensibles.length === 0) {
        ignorees++;
        continue;
      }

      // Une transaction par connecteur : soit les secrets sont rangés ET le
      // `jsonb` nettoyé, soit rien. L'entre-deux laisserait la valeur en clair
      // dans le `jsonb` alors qu'on la croit déplacée.
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const champ of sensibles) {
          const cle = `connecteur.${r.id}.${champ}`;
          const { valeur, versionCle } = chiffrer(String(config[champ]), {
            tenantId: r.tenant_id,
            cle,
          });
          await client.query(
            `INSERT INTO tenant_secrets (tenant_id, cle, valeur_chiffree, version_cle)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (tenant_id, cle)
             DO UPDATE SET valeur_chiffree = EXCLUDED.valeur_chiffree,
                           version_cle     = EXCLUDED.version_cle,
                           updated_at      = NOW()`,
            [r.tenant_id, cle, valeur, versionCle],
          );
          deplaces++;
        }

        const restant = Object.fromEntries(
          Object.entries(config).filter(([k]) => !estSensible(k)),
        );
        restant.__secrets = sensibles;
        await client.query("UPDATE connectors SET config = $1, updated_at = NOW() WHERE id = $2", [
          JSON.stringify(restant),
          r.id,
        ]);
        await client.query("COMMIT");
        reprises++;
      } catch (err) {
        await client.query("ROLLBACK");
        // L'identifiant du connecteur, jamais le contenu de sa configuration.
        console.error(`[connector-secrets] échec sur le connecteur ${r.id}`);
        throw err;
      } finally {
        client.release();
      }
    }

    console.log(
      `[connector-secrets] connecteurs repris: ${reprises} | secrets déplacés: ${deplaces} | déjà à jour ou sans secret: ${ignorees}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[connector-secrets]", err instanceof Error ? err.message : "échec");
  process.exit(1);
});
