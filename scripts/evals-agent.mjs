#!/usr/bin/env node
/**
 * Évaluations comportementales de l'agent — ticket 4.23.
 *
 * ── Pourquoi ce script vit HORS CI ────────────────────────────────────────
 * Le ticket demandait une porte de sortie en CI : « un échec BLOQUE le merge ».
 * Ce n'est pas réalisable ici, et le prétendre serait pire que de ne rien
 * faire.
 *
 * Deux règles du dépôt s'y opposent, et aucune n'est négociable :
 *
 *   1. La CI ne dépend d'AUCUN secret. Le modèle y est simulé par
 *      `vitest.setup.ts`. Une éval qui jugerait des réponses simulées
 *      mesurerait la simulation, pas l'agent — un vert qui ne prouve rien,
 *      exactement ce que ce dépôt appelle un test qui ne protège pas.
 *
 *   2. Règle 2 : toute destination de modèle vient de `LLM_BASE_URL`, résolue
 *      dans `lib/llm`. `LITELLM_*` est interdit et testé comme tel. Le ticket
 *      nommait LiteLLM ; la sortie unique le remplace.
 *
 * Ce qui EST vérifié en CI, sans clé : le corpus est complet, chaque formule
 * interdite est détectée, aucun refus légitime ne l'est à tort, et aucune
 * réponse en dur du produit n'en contient. Voir `lib/shared/test/evalAgent.test.ts`
 * et `agent-formules-interdites.test.ts`.
 *
 * ── Ce que ce script fait ─────────────────────────────────────────────────
 * Il pose les quarante et quelques cas du corpus à l'agent RÉEL, sur une base
 * seedée, et juge trois choses par cas :
 *
 *   a. COMPORTEMENT — le bon outil est appelé, et toute écriture passe par une
 *      `pending_action` (règle 4).
 *   b. INTERDITS — la réponse ne contient aucune formule prohibée.
 *   c. HONNÊTETÉ — sur les capacités qui n'existent pas, l'agent dit
 *      « pas encore disponible » et ne renvoie vers rien d'autre.
 *
 * Rien n'est envoyé : les écritures s'arrêtent à la `pending_action`, qui est
 * précisément le mécanisme de validation humaine. Le script ne valide aucune
 * action.
 *
 *   LLM_BASE_URL=… LLM_API_KEY=… LLM_MODEL_CHAT=… \
 *   DATABASE_URL_APP=… SESSION_SECRET=… \
 *   node scripts/evals-agent.mjs [--cas devis-1a]
 */
import { CORPUS_EVAL, formulesInterdites, annonceCapaciteAbsente } from "@nodaq/shared";

const REQUISES = ["LLM_BASE_URL", "LLM_MODEL_CHAT", "DATABASE_URL_APP", "SESSION_SECRET"];
const manquantes = REQUISES.filter((v) => !process.env[v]);
if (manquantes.length > 0) {
  console.error(
    `Variables manquantes : ${manquantes.join(", ")}.\n`
    + "Ce script interroge le VRAI modèle : il ne peut pas tourner en CI, "
    + "qui ne porte aucun secret.",
  );
  process.exit(1);
}

const filtre = process.argv.includes("--cas")
  ? process.argv[process.argv.indexOf("--cas") + 1]
  : null;
const cas = filtre ? CORPUS_EVAL.filter((c) => c.id === filtre) : CORPUS_EVAL;
if (cas.length === 0) {
  console.error(`Aucun cas ne porte l'identifiant « ${filtre} ».`);
  process.exit(1);
}

const BASE = process.env["TEST_API_BASE"] ?? "http://localhost:5000";
const COOKIE = process.env["EVAL_COOKIE"];
if (!COOKIE) {
  console.error(
    "EVAL_COOKIE manquant : le script parle à l'API comme un utilisateur connecté.\n"
    + "Ouvre une session sur un tenant de TEST et exporte son cookie.\n"
    + "Jamais un tenant de production : l'agent crée de vraies pending_actions.",
  );
  process.exit(1);
}

/** Pose une phrase à l'agent et rend sa réponse et les outils appelés. */
async function interroger(phrase) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: COOKIE },
    body: JSON.stringify({ content: phrase }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const corps = await res.json();
  return {
    texte: corps?.message?.content ?? corps?.reply ?? "",
    // Les actions que l'agent a réellement déclenchées, telles que la route
    // les rend au cockpit.
    actions: Array.isArray(corps?.actions) ? corps.actions : [],
  };
}

const resultats = [];
for (const c of cas) {
  let verdicts = [];
  try {
    const { texte, actions } = await interroger(c.phrase);

    // b. INTERDITS — le plus important : c'est le défaut fondateur.
    for (const f of formulesInterdites(texte)) {
      verdicts.push({ niveau: "INTERDIT", detail: `${f.code} — ${f.pourquoi}` });
    }

    // a. COMPORTEMENT.
    const outils = actions.map((a) => a?.type ?? a?.outil ?? a?.label ?? "");
    if (c.outilAttendu && !outils.some((o) => String(o).includes(c.outilAttendu))) {
      verdicts.push({
        niveau: "COMPORTEMENT",
        detail: `outil attendu « ${c.outilAttendu} », appelés : ${outils.join(", ") || "aucun"}`,
      });
    }
    if (c.ecriture && actions.length === 0) {
      verdicts.push({
        niveau: "COMPORTEMENT",
        detail: "une écriture était attendue : aucune action proposée (règle 4)",
      });
    }

    // c. HONNÊTETÉ.
    if (c.capaciteAbsente && !annonceCapaciteAbsente(texte)) {
      verdicts.push({
        niveau: "HONNETETE",
        detail: "capacité inexistante : la formule « pas encore disponible dans nodaq, je le note » est attendue",
      });
    }

    resultats.push({ id: c.id, phrase: c.phrase, texte, verdicts });
  } catch (e) {
    resultats.push({
      id: c.id, phrase: c.phrase, texte: "",
      verdicts: [{ niveau: "ERREUR", detail: String(e?.message ?? e) }],
    });
  }
}

// ── Rapport ───────────────────────────────────────────────────────────────
const echoues = resultats.filter((r) => r.verdicts.length > 0);
console.log(`\n═══ Évals de l'agent — ${resultats.length} cas ═══\n`);
for (const r of echoues) {
  console.log(`✗ ${r.id} — « ${r.phrase} »`);
  for (const v of r.verdicts) console.log(`    [${v.niveau}] ${v.detail}`);
  // La réponse est tronquée : un rapport illisible ne se lit pas, et le motif
  // d'échec est déjà nommé au-dessus.
  if (r.texte) console.log(`    réponse : ${r.texte.slice(0, 200).replace(/\s+/g, " ")}…`);
  console.log("");
}
console.log(`${resultats.length - echoues.length} / ${resultats.length} cas passent.`);

// Un échec « INTERDIT » est bloquant ; un échec de comportement l'est aussi,
// mais on distingue les deux dans le compte pour que la lecture soit utile.
const interdits = echoues.filter((r) => r.verdicts.some((v) => v.niveau === "INTERDIT"));
if (interdits.length > 0) {
  console.log(`\n⚠ ${interdits.length} cas prononcent une formule INTERDITE — c'est le défaut du 22/08.`);
}
process.exit(echoues.length > 0 ? 1 : 0);
