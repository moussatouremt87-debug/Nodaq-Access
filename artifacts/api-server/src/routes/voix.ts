/**
 * Commande vocale — interprétation puis exécution, en deux temps.
 *
 * « Vous ne tapez plus jamais rien. » La voix pour dire et pour commander ;
 * l'ÉCRAN pour confirmer. On ne fait pas valider un plan à l'oral : personne ne
 * signe un devis qu'il n'a pas lu.
 *
 *   POST /voix/interpreter  — rend un plan, n'écrit que le plan
 *   POST /voix/executer     — relit le plan EN BASE et l'applique
 *
 * Le modèle ne touche jamais la base : il rend des intentions, dont le schéma
 * ne contient ni identifiant ni montant. Ce n'est pas une consigne de rédaction
 * — c'est `@nodaq/shared`.`SortieModele` qui refuse.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { getConfig, chatCompletion, LlmConfigError } from "@nodaq/llm";
import { SortieModele, TYPES_INTENTION, STATUTS_AFFAIRE_DICTABLES } from "@nodaq/shared";
import {
  chargerContexte,
  construirePlan,
  enregistrerPlan,
  executerPlan,
} from "../lib/plan-vocal.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

/**
 * Extrait l'objet JSON d'une réponse qui peut être entourée de texte ou d'un
 * bloc de code. Rend la chaîne d'origine quand rien ne ressemble à un objet —
 * `JSON.parse` lèvera alors, et l'appelant rendra un plan vide.
 */
function extraireJson(brut: string): string {
  const debut = brut.indexOf("{");
  const fin = brut.lastIndexOf("}");
  return debut >= 0 && fin > debut ? brut.slice(debut, fin + 1) : brut;
}

const InterpreterBody = z.object({
  texte: z.string().trim().min(1, "Dites quelque chose").max(10_000),
});

const ExecuterBody = z.object({
  planId: z.string().min(1),
});

/**
 * La consigne donnée au modèle.
 *
 * Elle décrit le format, mais elle ne PROTÈGE rien : c'est le schéma Zod qui
 * protège. Un modèle qui renverrait un identifiant ou un prix verrait sa
 * sortie refusée, pas corrigée.
 */
function consigne(): string {
  return [
    "Tu transformes une phrase dictée par un artisan du bâtiment en INTENTIONS.",
    "",
    "Tu ne calcules rien, tu ne fixes aucun prix, tu n'inventes aucun identifiant.",
    "Tu rends UNIQUEMENT les faits dictés, tels qu'ils ont été dits.",
    "",
    `Types d'intention disponibles : ${TYPES_INTENTION.join(", ")}.`,
    `Statuts d'affaire : ${STATUTS_AFFAIRE_DICTABLES.join(", ")}.`,
    "",
    "Les noms de personnes, de chantiers et de villes sont rendus TELS QUELS.",
    "Ne cherche pas à deviner à qui ils correspondent : ce n'est pas ton travail.",
    "Les dates sont rendues telles que dictées (« le 27 août », « lundi prochain »).",
    "",
    "Mets dans `nonCompris` tout morceau de phrase qui n'a produit aucune intention.",
    "Ne tais RIEN : un plan silencieux sur ce qu'il a raté est un plan qui ment.",
    "",
    'Réponds en JSON strict : { "intentions": [...], "nonCompris": [...] }.',
  ].join("\n");
}

router.post("/voix/interpreter", async (req, res): Promise<void> => {
  const parsed = InterpreterBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;

  let config;
  try {
    config = getConfig();
  } catch (err) {
    // Configuration LLM absente : 503, jamais 500 — c'est le déploiement qui
    // est en cause, pas la requête.
    if (err instanceof LlmConfigError) {
      res.status(503).json({ error: "L'assistant n'est pas configuré sur ce déploiement." });
      return;
    }
    throw err;
  }

  let brut: string;
  try {
    const reponse = await chatCompletion(
      config,
      [
        { role: "system", content: consigne() },
        { role: "user", content: parsed.data.texte },
      ],
      undefined,
      { response_format: { type: "json_object" } },
    );
    const contenu = reponse.choices?.[0]?.message?.content ?? "";
    brut = typeof contenu === "string" ? contenu : "";
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : "erreur" }, "[voix] modèle indisponible");
    res.status(503).json({ error: "L'assistant est momentanément indisponible." });
    return;
  }

  let sortie: z.infer<typeof SortieModele>;
  try {
    sortie = SortieModele.parse(JSON.parse(extraireJson(brut)));
  } catch {
    // Sortie non conforme — un identifiant, un montant, un type inconnu. On
    // NE NETTOIE PAS : on rend un plan vide qui dit qu'on n'a pas compris.
    // Nettoyer laisserait croire qu'on a compris ce qui a été proposé.
    const planVide = {
      operations: [],
      questions: [],
      nonCompris: [parsed.data.texte],
    };
    const planId = await enregistrerPlan(tenantId, planVide);
    res.json({ planId, ...planVide });
    return;
  }

  const contexte = await chargerContexte(tenantId);
  const plan = construirePlan(sortie.intentions, sortie.nonCompris, contexte);
  const planId = await enregistrerPlan(tenantId, plan);

  res.json({ planId, ...plan });
});

router.post("/voix/executer", async (req, res): Promise<void> => {
  const parsed = ExecuterBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;

  let resultat;
  try {
    resultat = await executerPlan(tenantId, parsed.data.planId);
  } catch (err) {
    // Une opération a échoué : la transaction a tout annulé, y compris le
    // marquage. Le plan reste applicable une fois la cause corrigée.
    logger.error({ err: err instanceof Error ? err.message : "erreur" }, "[voix] exécution impossible");
    res.status(409).json({
      error: "Une des opérations n'a pas pu être appliquée. Rien n'a été enregistré.",
    });
    return;
  }

  switch (resultat.kind) {
    case "introuvable":
      res.status(404).json({ error: "Plan introuvable." });
      return;
    case "expire":
      res.status(410).json({
        error: "Ce plan a expiré. Redictez votre phrase — vos données ont pu changer entre-temps.",
      });
      return;
    case "deja_applique":
      res.status(200).json({ applique: true, deja: true, executeLe: resultat.executeLe });
      return;
    case "ok":
      res.status(200).json({ applique: true, deja: false, nbOperations: resultat.nbOperations });
      return;
  }
});

export default router;
