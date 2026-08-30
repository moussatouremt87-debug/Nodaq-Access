/**
 * L'assistant d'AIDE — distinct de l'agent métier, et volontairement infirme.
 *
 * ── CE QUI LE SÉPARE DE L'AGENT ─────────────────────────────────────────────
 *
 * L'agent (`/chat`) agit : il propose des devis, des factures, des règlements,
 * et chacune de ses propositions crée une action à valider. Il lit les données
 * du tenant et dispose d'outils.
 *
 * Celui-ci n'a AUCUN outil et ne lit AUCUNE table métier. Il explique comment
 * se servir du produit, rien de plus. C'est ce qui permet de l'exposer sans
 * réfléchir à l'isolation : il n'a rien à isoler.
 *
 * Cette séparation est aussi une protection : un assistant d'aide qui pourrait
 * écrire serait un chemin d'écriture supplémentaire, hors du parcours de
 * validation de la règle 4. Il n'en est pas un.
 *
 * ── LA CONVERSATION N'EST PAS CONSERVÉE ─────────────────────────────────────
 *
 * L'historique est renvoyé par l'écran à chaque tour et n'est écrit nulle part.
 * Une question d'aide contient souvent un bout de situation réelle (« ma
 * facture de 12 000 € à la mairie ») ; la règle 6 interdit de journaliser un
 * contenu de message, et le plus sûr est de ne pas le stocker du tout.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { chatCompletion, getConfig, LlmConfigError, type LlmMessage } from "@nodaq/llm";
import { messageValidation } from "../lib/message-validation.js";
import { CONSIGNE_SUPPORT } from "../lib/support-connaissances.js";

const router: IRouter = Router();

/** Au-delà, on ne renvoie plus tout l'historique : la question du jour suffit. */
const MAX_TOURS = 12;

const CorpsSupport = z.object({
  message: z.string().trim().min(1, "Écrivez votre question.").max(2000),
  historique: z
    .array(z.object({
      role: z.enum(["user", "assistant"]),
      contenu: z.string().max(4000),
    }))
    .max(MAX_TOURS * 2)
    .optional()
    .default([]),
});

router.post("/support/messages", async (req, res): Promise<void> => {
  const parsed = CorpsSupport.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: messageValidation(parsed.error) });
    return;
  }

  const messages: LlmMessage[] = [
    { role: "system", content: CONSIGNE_SUPPORT },
    ...parsed.data.historique.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.contenu,
    })),
    { role: "user", content: parsed.data.message },
  ];

  try {
    const config = getConfig();
    // AUCUN outil n'est passé : cet assistant ne peut rien déclencher.
    const reponse = await chatCompletion(config, messages, undefined, {
      temperature: 0.2,
      max_tokens: 700,
    });
    const texte = reponse.choices?.[0]?.message?.content?.trim();
    if (!texte) {
      res.status(502).json({
        error: "L'assistant n'a pas répondu. Réessayez dans un instant.",
      });
      return;
    }
    res.json({ reponse: texte });
  } catch (err) {
    if (err instanceof LlmConfigError) {
      // 503 et non 500 : la configuration manque, le service est indisponible
      // — ce n'est pas une panne de code. Même traitement que partout ailleurs.
      res.status(503).json({
        error: "L'assistant d'aide est momentanément indisponible.",
      });
      return;
    }
    // Le contenu du message n'est JAMAIS journalisé (règle 6) : seule la nature
    // de l'erreur l'est.
    console.error("[support] échec:", err instanceof Error ? err.name : "inconnu");
    res.status(502).json({
      error: "L'assistant n'a pas pu répondre. Réessayez dans un instant.",
    });
  }
});

export default router;
