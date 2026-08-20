#!/usr/bin/env node
/**
 * Diagnostic des identifiants Bridge — ticket 4.19.
 *
 *   node scripts/verifier-bridge.mjs
 *
 * Répond à une question simple, et une seule : est-ce que ce qui est dans le
 * `.env` FONCTIONNE ? Coller une valeur ne dit rien ; un aller-retour avec
 * Bridge le dit. Ce script est né d'une configuration réputée bonne qui ne
 * l'était pas — deux apps mélangées sous les mêmes noms.
 *
 * ── Deux montages, deux vérifications ─────────────────────────────────────
 * AGRÉGATION  : BRIDGE_CLIENT_ID / _SECRET → GET /v3/aggregation/users
 * PAIEMENT    : BRIDGE_PAYMENT_CLIENT_ID / _SECRET, à défaut ceux du haut
 *               → GET /v3/payment/payment-links
 *
 * Les deux appels sont en LECTURE SEULE : ils ne créent rien, ne déplacent
 * aucun argent, et n'écrivent pas une ligne chez le fournisseur.
 *
 * Aucun secret n'est imprimé, ni en clair, ni tronqué (règle 6). En cas
 * d'erreur, le corps de réponse est filtré des valeurs connues avant
 * affichage — un message d'erreur d'API reprend parfois ce qu'on lui a envoyé.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "https://api.bridgeapi.io";
const VERSION = "2025-01-15";

for (const ligne of readFileSync(resolve(RACINE, ".env"), "utf8").split("\n")) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(ligne);
  if (m && !(m[1] in process.env)) process.env[m[1]] = (m[2] ?? "").trim().split(/\s/)[0] ?? "";
}

/** Toutes les valeurs sensibles, pour les retirer d'un message d'erreur. */
const SECRETS = [
  process.env.BRIDGE_CLIENT_SECRET,
  process.env.BRIDGE_PAYMENT_CLIENT_SECRET,
  process.env.BRIDGE_WEBHOOK_SECRET,
  process.env.BRIDGE_PAYMENT_WEBHOOK_SECRET,
].filter(Boolean);

function masquer(texte) {
  let sortie = texte;
  for (const s of SECRETS) sortie = sortie.split(s).join("[masqué]");
  return sortie;
}

async function essayer(nom, chemin, clientId, clientSecret) {
  if (!clientId || !clientSecret) {
    console.log(`  ✗ ${nom} : identifiants absents du .env`);
    return false;
  }
  let reponse;
  try {
    reponse = await fetch(`${BASE}${chemin}`, {
      headers: {
        "Bridge-Version": VERSION,
        "Client-Id": clientId,
        "Client-Secret": clientSecret,
        Accept: "application/json",
      },
    });
  } catch (err) {
    console.log(`  ✗ ${nom} : réseau injoignable (${err.name})`);
    return false;
  }

  if (reponse.ok) {
    console.log(`  ✓ ${nom} : identifiants acceptés (HTTP ${reponse.status})`);
    return true;
  }

  const corps = masquer((await reponse.text().catch(() => "")).slice(0, 300));
  console.log(`  ✗ ${nom} : refusé — HTTP ${reponse.status}`);
  if (corps) console.log(`      ${corps}`);
  // 401/403 sur des identifiants complets = mauvaise app, secret périmé, ou
  // produit non activé. Le corps de Bridge le dit ; on le montre tel quel.
  return false;
}

console.log("\n── Agrégation bancaire (lecture des comptes) ──");
const agregation = await essayer(
  "BRIDGE_CLIENT_ID / _SECRET",
  "/v3/aggregation/users",
  process.env.BRIDGE_CLIENT_ID,
  process.env.BRIDGE_CLIENT_SECRET,
);

console.log("\n── Initiation de paiement (liens) ──");
const dedie = Boolean(process.env.BRIDGE_PAYMENT_CLIENT_ID || process.env.BRIDGE_PAYMENT_CLIENT_SECRET);
console.log(
  dedie
    ? "  (app dédiée déclarée : BRIDGE_PAYMENT_CLIENT_ID / _SECRET)"
    : "  (aucune app dédiée : ce sont les identifiants d'agrégation qui servent)",
);
const paiement = await essayer(
  dedie ? "BRIDGE_PAYMENT_CLIENT_ID / _SECRET" : "BRIDGE_CLIENT_ID / _SECRET",
  "/v3/payment/payment-links",
  dedie ? process.env.BRIDGE_PAYMENT_CLIENT_ID : process.env.BRIDGE_CLIENT_ID,
  dedie ? process.env.BRIDGE_PAYMENT_CLIENT_SECRET : process.env.BRIDGE_CLIENT_SECRET,
);

console.log("\n── Secrets de webhook (présence seule — ils ne se testent pas d'ici) ──");
for (const [nom, role] of [
  ["BRIDGE_WEBHOOK_SECRET", "webhook d'agrégation"],
  ["BRIDGE_PAYMENT_WEBHOOK_SECRET", "webhook de paiement"],
]) {
  console.log(`  ${process.env[nom] ? "✓" : "✗"} ${nom} — ${role}`);
}

console.log(
  `\n${agregation && paiement ? "✓ les deux usages sont opérationnels" : "✗ au moins un usage est hors service (détail ci-dessus)"}\n`,
);
process.exit(agregation && paiement ? 0 : 1);
