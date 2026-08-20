#!/usr/bin/env node
/**
 * Contrôle préalable de l'agent vocal — ticket 4.18-bis / 4.19.
 *
 *   node scripts/verifier-vocal.mjs
 *
 * À lancer AVANT tout appel supervisé. Il répond à une question : est-ce que
 * tout ce dont l'appel a besoin est en place, et de la bonne FORME ?
 *
 * Né d'un appel refusé au dernier moment parce que
 * `ELEVENLABS_PHONE_NUMBER_ID` portait le numéro (`+1661…`) au lieu de
 * l'identifiant (`phnum_…`). Notre serveur ne journalise que le code HTTP
 * (règle 6) : le défaut était invisible, et il a coûté un appel pour rien.
 *
 * Tout est en LECTURE SEULE : aucun appel n'est composé, aucun SMS envoyé.
 * Aucun secret n'est imprimé — seulement des noms, des formes et des issues.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_EL = "https://api.elevenlabs.io";

for (const ligne of readFileSync(resolve(RACINE, ".env"), "utf8").split("\n")) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(ligne);
  if (m && !(m[1] in process.env)) process.env[m[1]] = (m[2] ?? "").trim().split(/\s/)[0] ?? "";
}

const cle = process.env.ELEVENLABS_API_KEY || process.env.VOICE_TTS_API_KEY;
let echecs = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const ko = (m) => { console.log(`  ✗ ${m}`); echecs++; };

async function elevenlabs(chemin) {
  const r = await fetch(`${BASE_EL}${chemin}`, { headers: { "xi-api-key": cle ?? "" } });
  return { statut: r.status, corps: r.ok ? await r.json() : null };
}

console.log("\n── Identité et forme des réglages ──");
if (!cle) ko("ELEVENLABS_API_KEY (ou VOICE_TTS_API_KEY) absente");
else ok("clé d'API présente");

const agentId = process.env.ELEVENLABS_AGENT_ID ?? "";
const telId = process.env.ELEVENLABS_PHONE_NUMBER_ID ?? "";

// La FORME d'abord : c'est elle qui a manqué. Un identifiant de numéro
// commence par `phnum_` ; un numéro de téléphone commence par `+`. Les
// confondre produit un 404 au moment de composer, jamais avant.
if (!agentId) ko("ELEVENLABS_AGENT_ID absente");
else if (!agentId.startsWith("agent_")) ko(`ELEVENLABS_AGENT_ID mal formée : attendu « agent_… »`);
else ok("ELEVENLABS_AGENT_ID bien formée");

if (!telId) ko("ELEVENLABS_PHONE_NUMBER_ID absente");
else if (telId.startsWith("+")) ko("ELEVENLABS_PHONE_NUMBER_ID contient un NUMÉRO, pas un identifiant « phnum_… »");
else if (!telId.startsWith("phnum_")) ko("ELEVENLABS_PHONE_NUMBER_ID mal formée : attendu « phnum_… »");
else ok("ELEVENLABS_PHONE_NUMBER_ID bien formée");

console.log("\n── Existence chez la plateforme ──");
if (cle && agentId.startsWith("agent_")) {
  const a = await elevenlabs(`/v1/convai/agents/${agentId}`);
  a.statut === 200 ? ok(`agent trouvé : « ${a.corps.name} »`) : ko(`agent introuvable (HTTP ${a.statut})`);
}
if (cle && telId.startsWith("phnum_")) {
  const n = await elevenlabs("/v1/convai/phone-numbers");
  const trouve = Array.isArray(n.corps) ? n.corps.find((x) => x.phone_number_id === telId) : null;
  if (!trouve) ko(`numéro introuvable au compte (HTTP ${n.statut})`);
  else {
    ok(`numéro trouvé : ${trouve.phone_number}`);
    // Un numéro non rattaché à l'agent compose… avec un autre agent.
    const lie = trouve.assigned_agent?.agent_id;
    lie === agentId
      ? ok("numéro rattaché à CET agent")
      : ko(`numéro rattaché à un autre agent (${lie ?? "aucun"})`);
  }
}

console.log("\n── Le chemin de retour (tools et webhook) ──");
const tools = (process.env.VOICE_TOOLS_BASE_URL ?? "").replace(/\/$/, "");
if (!tools.startsWith("https://")) ko("VOICE_TOOLS_BASE_URL absente ou non https");
else {
  try {
    const r = await fetch(`${tools}/api/health`, { signal: AbortSignal.timeout(10_000) });
    // Les tools sont appelés PAR la plateforme : un tunnel fermé rend l'agent
    // muet sur le mandat, sans que rien ne le dise pendant l'appel.
    r.ok ? ok(`API joignable par le tunnel (HTTP ${r.status})`) : ko(`tunnel debout mais API muette (HTTP ${r.status})`);
  } catch {
    ko("tunnel injoignable");
  }
}
process.env.ELEVENLABS_WEBHOOK_SECRET ? ok("secret du webhook post-appel présent") : ko("ELEVENLABS_WEBHOOK_SECRET absente");

console.log("\n── Liste blanche des numéros ──");
const appelant = process.env.TELEPHONY_CALLER_ID ?? "";
const blanche = (process.env.VOICE_TEST_NUMBERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
if (!appelant.startsWith("+1")) {
  ok(`appelant ${appelant || "(absent)"} — la liste blanche est DÉSARMÉE`);
} else if (blanche.length === 0) {
  ko("appelant américain et liste VIDE : aucun numéro n'est joignable");
} else {
  ok(`armée, ${blanche.length} numéro(s) autorisé(s)`);
}

console.log(`\n${echecs === 0 ? "✓ prêt pour un appel supervisé" : `✗ ${echecs} point(s) à corriger avant de composer`}\n`);
process.exit(echecs === 0 ? 0 : 1);
