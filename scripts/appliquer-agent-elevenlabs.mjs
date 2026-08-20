#!/usr/bin/env node
/**
 * Applique `voice-agent/agent.config.mjs` sur le compte ElevenLabs — le seul
 * chemin autorisé pour toucher l'agent (ticket 4.18-bis : jamais de dashboard).
 *
 *   node scripts/appliquer-agent-elevenlabs.mjs           # montre le diff, applique
 *   node scripts/appliquer-agent-elevenlabs.mjs --dry-run # montre le diff, s'arrête
 *
 * Idempotent : sans ELEVENLABS_AGENT_ID, crée l'agent et imprime l'identifiant
 * à mettre en variable d'environnement ; avec, compare et met à jour.
 *
 * Prérequis : `pnpm --filter @nodaq/shared build` (le prompt importe les règles
 * de style depuis lib/shared/dist — source unique, pas de copie qui dérive).
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Le `.env` comme repli, l'environnement réel prioritaire — même doctrine que
// `config_env` du worker : la valeur s'arrête au premier blanc.
for (const ligne of readFileSync(resolve(RACINE, ".env"), "utf8").split("\n")) {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(ligne);
  if (m && !(m[1] in process.env)) {
    const brut = m[2].trim();
    process.env[m[1]] = brut.startsWith('"') || brut.startsWith("'")
      ? brut.slice(1, brut.indexOf(brut[0], 1) > 0 ? brut.indexOf(brut[0], 1) : undefined)
      : brut.split(/\s/)[0];
  }
}

// Le fondateur a annoncé ELEVENLABS_API_KEY ; le dépôt porte VOICE_TTS_API_KEY
// (même compte, clé posée au lot 6). On lit l'un PUIS l'autre plutôt que
// d'exiger un renommage — mais jamais de valeur par défaut.
const cle = process.env.ELEVENLABS_API_KEY || process.env.VOICE_TTS_API_KEY;
const voiceId = process.env.VOICE_TTS_VOICE_ID;
const toolsBaseUrl = (process.env.VOICE_TOOLS_BASE_URL || "").replace(/\/$/, "");
const agentId = process.env.ELEVENLABS_AGENT_ID || "";
const base = (process.env.ELEVENLABS_BASE_URL || "https://api.elevenlabs.io").replace(/\/$/, "");

if (!cle) { console.error("ELEVENLABS_API_KEY (ou VOICE_TTS_API_KEY) manquante."); process.exit(2); }
if (!voiceId) { console.error("VOICE_TTS_VOICE_ID manquante."); process.exit(2); }
if (!toolsBaseUrl.startsWith("https://")) {
  // Les tools sont appelés PAR ElevenLabs : localhost ne veut rien dire pour
  // eux. En développement, c'est l'URL du tunnel pointé sur l'API (port 8080).
  console.error("VOICE_TOOLS_BASE_URL doit être une URL https publique (tunnel vers l'API).");
  process.exit(2);
}

const { configurationAgent } = await import(resolve(RACINE, "voice-agent/agent.config.mjs"));
const voulu = configurationAgent({
  toolsBaseUrl,
  voiceId,
  // Optionnelle : absente, la plateforme garde son défaut. L'énumération des
  // valeurs acceptées vit chez eux — leur message d'erreur la liste.
  llm: process.env.VOICE_AGENT_LLM || undefined,
});

async function api(methode, chemin, corps) {
  const r = await fetch(`${base}${chemin}`, {
    method: methode,
    headers: { "xi-api-key": cle, "Content-Type": "application/json" },
    body: corps ? JSON.stringify(corps) : undefined,
  });
  const texte = await r.text();
  if (!r.ok) {
    // Le corps d'erreur de l'API dit précisément quel champ est refusé : c'est
    // notre outil de validation de forme. La clé, elle, n'y figure jamais.
    console.error(`ElevenLabs a refusé (${methode} ${chemin} → HTTP ${r.status}) :`);
    console.error(texte.slice(0, 1500).replaceAll(cle, "[clé masquée]"));
    process.exit(1);
  }
  return texte ? JSON.parse(texte) : {};
}

const dryRun = process.argv.includes("--dry-run");

if (!agentId) {
  console.log(`→ aucun ELEVENLABS_AGENT_ID : création de « ${voulu.name} »`);
  if (dryRun) { console.log(JSON.stringify(voulu, null, 2)); process.exit(0); }
  const cree = await api("POST", "/v1/convai/agents/create", voulu);
  console.log("→ agent créé.");
  console.log("");
  console.log("  Ajoute à ton .env :");
  console.log(`  ELEVENLABS_AGENT_ID=${cree.agent_id}`);
  process.exit(0);
}

const actuel = await api("GET", `/v1/convai/agents/${agentId}`);

// Diff volontairement grossier : les deux JSON canonicalisés. Le but n'est pas
// un patch minimal, c'est de VOIR qu'on va changer quelque chose avant de le
// faire — et de ne rien envoyer quand rien ne change (idempotence).
const projete = JSON.stringify(voulu.conversation_config);
const enPlace = JSON.stringify(actuel.conversation_config ?? {});
if (projete === enPlace) {
  console.log("→ l'agent est déjà conforme à la configuration versionnée. Rien à faire.");
  process.exit(0);
}

console.log("→ la configuration diverge de ce qui est en place :");
console.log(`   prompt : ${voulu.conversation_config.agent.prompt.prompt.length} caractères`);
console.log(`   tools  : ${voulu.conversation_config.agent.prompt.tools.map((t) => t.name).join(", ")}`);
console.log(`   voix   : ${voulu.conversation_config.tts.voice_id}`);
if (dryRun) { console.log("→ --dry-run : rien n'est appliqué."); process.exit(0); }

await api("PATCH", `/v1/convai/agents/${agentId}`, voulu);
console.log(`→ agent ${agentId} mis à jour.`);
