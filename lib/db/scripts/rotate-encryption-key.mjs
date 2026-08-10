#!/usr/bin/env node
/**
 * Rotation de la clé de chiffrement.
 *
 *   ENCRYPTION_KEY_PREVIOUS=<ancienne> ENCRYPTION_KEY=<nouvelle> \
 *     node lib/db/scripts/rotate-encryption-key.mjs
 *
 * Déchiffre chaque secret avec l'ancienne clé, le rechiffre avec la nouvelle,
 * et incrémente `version_cle`.
 *
 * ── IDEMPOTENT ──────────────────────────────────────────────────────────────
 * Le critère n'est pas `version_cle`, qui peut avoir été écrite à la main :
 * c'est « cette ligne s'ouvre-t-elle DÉJÀ avec la clé courante ? ». Si oui, on
 * n'y touche pas. Relancé dix fois, le script ne réécrit rien la deuxième fois.
 *
 * ── CE QU'IL N'ÉCRIT NULLE PART ─────────────────────────────────────────────
 * Aucun clair sur disque, aucune valeur à l'écran, aucune clé. La sortie est un
 * DÉCOMPTE, et rien d'autre. Un script de rotation qui affiche ce qu'il déplace
 * transforme un terminal, un historique de shell et un journal de CI en dépôt
 * de secrets.
 *
 * ── POURQUOI IL PARLE À LA BASE EN PROPRIÉTAIRE ─────────────────────────────
 * Il traverse TOUS les tenants, donc il ne peut pas passer par `withTenant`,
 * qui n'en voit qu'un. Il emploie `DATABASE_URL` (le propriétaire) et non
 * `DATABASE_URL_APP`. C'est une opération d'exploitation, pas une requête
 * applicative — et c'est la raison pour laquelle elle n'est PAS exposée par une
 * route.
 */
import pg from "pg";
import { dechiffrer, chiffrer, dejaAJour, verifierConfigurationChiffrement } from "@nodaq/crypto";

const { Pool } = pg;

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[rotate] DATABASE_URL doit être définie (rôle propriétaire).");
    process.exit(1);
  }
  if (!process.env.ENCRYPTION_KEY_PREVIOUS) {
    console.error(
      "[rotate] ENCRYPTION_KEY_PREVIOUS doit être définie : sans ancienne clé, il n'y a rien à faire tourner.",
    );
    process.exit(1);
  }

  // Lève si une clé manque, est mal encodée, ou si les deux sont identiques.
  verifierConfigurationChiffrement();

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  let inchanges = 0;
  let tournes = 0;
  let echecs = 0;

  try {
    const { rows } = await pool.query(
      "SELECT tenant_id, cle, valeur_chiffree, version_cle FROM tenant_secrets ORDER BY tenant_id, cle",
    );

    for (const r of rows) {
      const identite = { tenantId: r.tenant_id, cle: r.cle };

      if (dejaAJour(r.valeur_chiffree, identite)) {
        inchanges++;
        continue;
      }

      try {
        // `dechiffrer` essaie la courante puis la précédente ; on est ici parce
        // que la courante a échoué, donc c'est la précédente qui ouvre.
        const clair = dechiffrer(r.valeur_chiffree, identite);
        const { valeur } = chiffrer(clair, identite, (r.version_cle ?? 1) + 1);
        await pool.query(
          "UPDATE tenant_secrets SET valeur_chiffree = $1, version_cle = $2, updated_at = NOW() WHERE tenant_id = $3 AND cle = $4",
          [valeur, (r.version_cle ?? 1) + 1, r.tenant_id, r.cle],
        );
        tournes++;
      } catch {
        // Ni la clé courante ni la précédente n'ouvrent cette ligne. On ne
        // rapporte QUE le nom de la clé logique — pas le tenant, pas le
        // chiffré : ce message finira dans un journal d'exploitation.
        console.error(`[rotate] illisible : « ${r.cle} »`);
        echecs++;
      }
    }

    console.log(`[rotate] tournés: ${tournes} | déjà à jour: ${inchanges} | illisibles: ${echecs}`);
    if (echecs > 0) {
      console.error(
        "[rotate] Des secrets sont illisibles avec les deux clés fournies. Ils doivent être ressaisis.",
      );
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  // Message seul, jamais la pile : une pile peut porter des valeurs.
  console.error("[rotate]", err instanceof Error ? err.message : "échec");
  process.exit(1);
});
