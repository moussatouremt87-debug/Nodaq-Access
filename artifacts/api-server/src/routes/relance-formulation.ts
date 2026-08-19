/**
 * La formulation des répliques de l'agent vocal — ticket 4.18.
 *
 *   POST /relance/formulation — rend UNE réplique à prononcer
 *
 * Le noyau (`decisionAppel.ts`) a déjà décidé ; cette route fait mettre la
 * décision en mots par le modèle. C'est la règle 3 du CLAUDE.md appliquée
 * telle qu'elle est écrite : le modèle ne calcule rien, ne fixe rien, il
 * FORMULE. Les chiffres arrivent tout faits dans `faits` et la garde
 * `chiffresInventes` refuse tout nombre qui n'en vient pas.
 *
 * ── Pourquoi la formulation passe par le serveur et non par le worker ──────
 * Deux raisons, et la seconde suffirait. D'abord la règle 2 : toute sortie
 * vers un modèle passe par `lib/llm` et `LLM_BASE_URL` ; le worker Python n'y
 * a pas accès, et lui donner sa propre clé ouvrirait une deuxième porte de
 * sortie. Ensuite les gardes : elles vivent dans `@nodaq/shared`, avec les
 * règles qu'elles protègent, et une garde recopiée dans un second runtime est
 * une garde qui dérive.
 *
 * ── Authentification ───────────────────────────────────────────────────────
 * Montée derrière `requireAppelVocal`, comme la passerelle de mandat : le
 * worker présente le jeton frappé pour l'appel en cours, et `req.tenantId` est
 * posé depuis la ligne trouvée en base. Le corps ne porte aucun tenant, donc
 * aucun tenant ne peut être forgé.
 *
 * Elle n'est exposée à aucune interface : rien dans `artifacts/nodaq` ne
 * l'appelle, et un humain n'a pas de jeton d'appel.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { getConfig, chatCompletion, LlmConfigError } from "@nodaq/llm";
import {
  INTENTIONS_REPLIQUE,
  REPLIQUES_DE_SECOURS,
  consigneFormulation,
  messageFormulation,
  verifierReplique,
  type AnomalieReplique,
  type FaitsReplique,
  type IntentionReplique,
  type TourParole,
} from "@nodaq/shared";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

const CorpsFormulation = z.object({
  intention: z.enum(INTENTIONS_REPLIQUE),
  /**
   * Les seuls chiffres que le modèle a le droit de prononcer. Bornés en taille
   * : ce champ part vers un sous-traitant de synthèse vocale aux États-Unis
   * (ADR 002), et rien n'y entre qui n'ait été mis là explicitement.
   */
  faits: z.record(z.string(), z.string().max(200)).default({}),
  historique: z
    .array(
      z.object({
        locuteur: z.enum(["agent", "debiteur"]),
        propos: z.string().max(2000),
      }),
    )
    .max(40)
    .default([]),
});

/**
 * Deux essais, pas plus.
 *
 * Un modèle qui échoue deux fois sur la même consigne n'échouera pas mieux au
 * troisième : ce serait de la latence achetée sans contrepartie, dans une
 * conversation où chaque centaine de millisecondes s'entend.
 */
const ESSAIS_MAX = 2;

/**
 * Assez pour trois ou quatre phrases parlées, pas pour un monologue.
 *
 * La consigne demande déjà d'être bref, mais une consigne se contourne. Le
 * plafond de jetons, non — et `verifierReplique` refuse de toute façon
 * au-delà de quatre phrases.
 */
const JETONS_MAX = 160;

/**
 * Assez haut pour que deux appels ne produisent pas la même phrase.
 *
 * C'est le but même de ce lot : des répliques figées récitent, et un débiteur
 * l'entend en deux tours de parole. La variation est ici une exigence, pas un
 * effet de bord — les gardes de sortie sont ce qui la rend sûre.
 */
const TEMPERATURE = 0.8;

function nettoyer(brut: string): string {
  // Un modèle encadre volontiers sa réponse de guillemets, malgré la consigne.
  // On retire l'enrobage, jamais le contenu : une réplique qui menace est
  // REFUSÉE, pas corrigée — la corriger laisserait croire qu'elle a été comprise.
  return brut.trim().replace(/^["«»\s]+|["«»\s]+$/g, "");
}

router.post("/", async (req, res): Promise<void> => {
  const parsed = CorpsFormulation.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { intention, faits, historique } = parsed.data;

  const secours = (raison: string): void => {
    // Journal : l'intention et la raison, jamais la réplique ni l'historique.
    // Règle 6 — aucun verbatim de conversation dans un journal.
    logger.warn({ intention, raison }, "[formulation] repli sur la réplique de secours");
    res.json({
      replique: REPLIQUES_DE_SECOURS[intention as IntentionReplique](faits as FaitsReplique),
      source: "secours",
    });
  };

  let config;
  try {
    config = getConfig();
  } catch (err) {
    // Modèle non configuré : on ne rend pas 503. L'agent est AU TÉLÉPHONE avec
    // quelqu'un — un silence est pire qu'une phrase moins vivante. C'est
    // exactement ce à quoi sert le filet.
    if (err instanceof LlmConfigError) {
      secours("llm_non_configure");
      return;
    }
    throw err;
  }

  const messages = [
    { role: "system" as const, content: consigneFormulation() },
    {
      role: "user" as const,
      content: messageFormulation(
        intention as IntentionReplique,
        faits as FaitsReplique,
        historique as TourParole[],
      ),
    },
  ];

  let derniereAnomalies: AnomalieReplique[] = [];

  for (let essai = 1; essai <= ESSAIS_MAX; essai++) {
    let replique: string;
    try {
      const reponse = await chatCompletion(config, messages, undefined, {
        temperature: TEMPERATURE,
        max_tokens: JETONS_MAX,
      });
      const contenu = reponse.choices?.[0]?.message?.content ?? "";
      replique = nettoyer(typeof contenu === "string" ? contenu : "");
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : "erreur", intention },
        "[formulation] modèle indisponible",
      );
      secours("modele_indisponible");
      return;
    }

    const anomalies = verifierReplique(replique, faits as FaitsReplique);
    if (anomalies.length === 0) {
      res.json({ replique, source: "modele", essais: essai });
      return;
    }
    derniereAnomalies = anomalies;
  }

  // Deux échecs : on prononce le filet. On ne rend JAMAIS une réplique qui a
  // échoué aux gardes, même « presque » bonne.
  logger.warn(
    // Les NATURES seules — un détail d'anomalie contient le texte fautif, donc
    // potentiellement un montant ou un nom.
    { intention, natures: derniereAnomalies.map((a) => a.nature) },
    "[formulation] sortie refusée deux fois",
  );
  secours("gardes_non_franchies");
});

export default router;
