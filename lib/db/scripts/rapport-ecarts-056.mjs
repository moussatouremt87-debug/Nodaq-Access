#!/usr/bin/env node
/**
 * Rend lisible la table d'écarts de la migration 056.
 *
 * ── Pourquoi un script et pas un fichier écrit par la migration ───────────
 * Une migration SQL n'écrit pas sur disque, et le disque d'un conteneur est
 * éphémère. La migration consigne donc ses écarts dans une TABLE, et ce
 * script la rend en Markdown — pour une description de pull request, pour un
 * dossier d'audit, ou simplement pour répondre six mois plus tard à « d'où
 * vient ce centime ».
 *
 * Rejouable autant de fois qu'on veut : il ne fait que lire.
 *
 *   node lib/db/scripts/rapport-ecarts-056.mjs
 *
 * Lit `DATABASE_URL` (le rôle propriétaire) : `app_user` n'a aucun droit sur
 * cette table, qui est un artefact d'exploitation et non une donnée métier.
 */
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL doit être définie (rôle propriétaire).");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const { rows: presente } = await client.query(
  "SELECT to_regclass('public.migration_056_ecarts') IS NOT NULL AS ok",
);
if (!presente[0]?.ok) {
  console.error("La table migration_056_ecarts n'existe pas : la migration 056 n'a pas été appliquée sur cette base.");
  await client.end();
  process.exit(1);
}

const { rows } = await client.query(`
  SELECT nom_table, colonne, ligne_id, avant_cents, apres_cents, origine,
         apres_cents - avant_cents AS delta
    FROM migration_056_ecarts
   ORDER BY abs(apres_cents - avant_cents) DESC, nom_table, colonne
`);

const euros = (c) =>
  (Number(c) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";

console.log("# Migration 056 — rapport d'écarts\n");

if (rows.length === 0) {
  console.log("**Aucun écart.** Aucune valeur n'a bougé d'un centime : la base ne");
  console.log("portait aucun montant au-delà de 167 772,16 €, et les totaux stockés");
  console.log("étaient déjà cohérents avec leur source exacte.\n");
  console.log("Ce n'est pas une preuve que le défaut n'existait pas — c'en est une");
  console.log("qu'il n'avait pas encore mordu sur CETTE base.");
  await client.end();
  process.exit(0);
}

// Le total signé, pas la somme des valeurs absolues : c'est le déplacement net
// de la créance, le chiffre qu'un comptable regarderait en premier.
const net = rows.reduce((s, r) => s + Number(r.delta), 0);
const exactes = rows.filter((r) => r.origine === "source_exacte").length;
const suspectes = rows.filter((r) => r.origine === "suspect_au_dela_du_seuil").length;

console.log(`**${exactes} valeur(s) corrigée(s)**, déplacement net **${euros(net)}**.`);
if (suspectes > 0) {
  console.log(`**${suspectes} valeur(s) SUSPECTE(S)** : au-delà de 167 772,16 €, sans source`);
  console.log(`exacte pour les recalculer. Elles ne bougent pas — l'original n'existe`);
  console.log(`plus nulle part — mais elles peuvent différer de ce qui a été saisi.`);
}
console.log("");

console.log("| Table | Colonne | Ligne | Avant | Après | Écart | Origine |");
console.log("|---|---|---|---|---|---|---|");
for (const r of rows) {
  console.log(
    `| \`${r.nom_table}\` | \`${r.colonne}\` | \`${String(r.ligne_id).slice(0, 8)}…\` `
    + `| ${euros(r.avant_cents)} | ${euros(r.apres_cents)} | ${euros(r.delta)} | ${r.origine} |`,
  );
}

console.log("\n> `source_exacte` : la valeur a été relue depuis la ventilation du");
console.log("> document, le journal des paiements ou les factures rattachées — elle");
console.log("> est juste, et l'écart mesure ce que le flottant avait faussé.");
console.log(">");
console.log("> `suspect_au_dela_du_seuil` : montant saisi à la main (contrat, prospect,");
console.log("> provision fiscale) dépassant 167 772,16 €. Il n'a pas bougé pendant la");
console.log("> migration — il avait été faussé À L'ÉCRITURE, bien avant. Aucune source");
console.log("> ne permet de le recalculer et l'original n'existe plus : à faire");
console.log("> vérifier par l'utilisateur, une valeur à la fois.");

await client.end();
