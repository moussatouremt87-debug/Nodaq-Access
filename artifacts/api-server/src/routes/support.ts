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
import { consigneSupport } from "../lib/support-connaissances.js";
import {
  OUTILS_DIAGNOSTIC, OUTIL_TRANSMISSION, executerDiagnostic, transmettreALEquipe,
} from "../lib/support-diagnostics.js";
import { sendDocument } from "../lib/canal-emission.js";
import { articlesAide, indexLlms } from "../lib/aide-articles.js";

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
    { role: "system", content: consigneSupport() },
    ...parsed.data.historique.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.contenu,
    })),
    { role: "user", content: parsed.data.message },
  ];

  try {
    const config = getConfig();
    const tenantId = req.tenantId!;

    /*
     * ── NIVEAU 2 : IL REGARDE, IL N'ÉCRIT PAS ──────────────────────────────
     *
     * Les outils passés ici sont TOUS en lecture seule et passent par
     * `withTenant` : l'artisan ne voit que ses données. Aucun n'écrit, donc
     * aucun chemin d'écriture n'échappe au parcours de validation de la
     * règle 4 — et un test le vérifie sur le source.
     *
     * Deux tours au maximum. Le modèle demande un diagnostic, le reçoit, puis
     * répond. Sans plafond, une boucle d'outils tournerait sans fin sur une
     * question qu'il ne sait pas trancher.
     */
    const outils = [...OUTILS_DIAGNOSTIC, OUTIL_TRANSMISSION];
    /** Une promesse de transmission doit correspondre à une transmission. */
    let transmission: { transmis: boolean; reference?: string } | null = null;
    /** Un diagnostic consulté = un problème concret signalé. */
    let aDiagnostique = false;
    let reponse = await chatCompletion(config, messages, outils, {
      temperature: 0.2,
      max_tokens: 700,
    });

    for (let tour = 0; tour < 2; tour++) {
      const appels = reponse.choices?.[0]?.message?.tool_calls ?? [];
      if (appels.length === 0) break;
      messages.push(reponse.choices[0]!.message as never);
      for (const appel of appels) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(appel.function.arguments || "{}"); } catch { args = {}; }
        const resultat =
          appel.function.name === "transmettre_a_l_equipe"
            ? (transmission = await transmettreALEquipe(
                {
                  tenantId,
                  // L'adresse vient de la SESSION. Jamais du texte de la
                  // conversation : une phrase bien tournée ferait sinon écrire
                  // l'assistant à n'importe qui.
                  emailUtilisateur: req.session!.email,
                  role: req.session?.role ?? "?",
                  historique: [...parsed.data.historique, { role: "user", contenu: parsed.data.message }],
                },
                typeof args["resume"] === "string" ? args["resume"] : parsed.data.message,
                async (opts) => {
                  const envoi = await sendDocument({
                    canal: "EMAIL",
                    tenantId: opts.tenantId,
                    to: opts.to,
                    subject: opts.subject,
                    body: opts.body,
                    documentType: "ESCALADE_SUPPORT",
                  });
                  return envoi.success;
                },
              ))
            : ((aDiagnostique = true), await executerDiagnostic(tenantId, appel.function.name, args));
        messages.push({
          role: "tool",
          tool_call_id: appel.id,
          content: JSON.stringify(resultat),
        } as never);
      }
      reponse = await chatCompletion(config, messages, outils, {
        temperature: 0.2,
        max_tokens: 700,
      });
    }

    let texte = reponse.choices?.[0]?.message?.content?.trim();

    /*
     * ── LA TRANSMISSION EST DÉCIDÉE PAR LE CODE, PAS PAR LA PROSE ────────────
     *
     * Trois tentatives ont échoué le 30/08/2026, chacune en croyant la
     * précédente suffisante :
     *
     *   1. la consigne demandait d'appeler l'outil    → il ne l'appelait pas ;
     *   2. la consigne l'exigeait plus fermement      → il annonçait sans faire ;
     *   3. un repli cherchait « transmis » dans le texte → il écrivait
     *      « je le signale », et inventait une référence par-dessus.
     *
     * Courir après les formulations est sans fin. La règle devient donc
     * structurelle : dès qu'un DIAGNOSTIC a été consulté — c'est-à-dire dès que
     * l'utilisateur a signalé quelque chose de concret — le dossier part. Le
     * modèle n'a plus rien à décider, et son éventuel oubli n'a plus d'effet.
     *
     * Le coût d'un ticket de trop est nul ; celui d'un problème perdu ne l'est
     * pas.
     */
    if (!transmission?.transmis && aDiagnostique) {
      transmission = await transmettreALEquipe(
        {
          tenantId,
          emailUtilisateur: req.session!.email,
          role: req.session?.role ?? "?",
          historique: [...parsed.data.historique, { role: "user", contenu: parsed.data.message }],
        },
        texte ?? parsed.data.message,
        async (opts) => {
          const envoi = await sendDocument({
            canal: "EMAIL", tenantId: opts.tenantId, to: opts.to,
            subject: opts.subject, body: opts.body, documentType: "ESCALADE_SUPPORT",
          });
          return envoi.success;
        },
      );
    }

    if (texte) {
      /*
       * Les références INVENTÉES sont retirées. Le modèle en a fabriqué une
       * (« NODAQ-8475 ») alors qu'aucun dossier n'existait : un numéro faux
       * donné à un utilisateur est une promesse impossible à honorer.
       * La vraie référence, si elle existe, est ajoutée ensuite.
       */
      texte = texte.replace(/\b[A-Z]{3,}[-\s]?\d{3,}\b/g, "").replace(/ {2,}/g, " ");
      if (transmission?.transmis) {
        texte += `\n\nVotre référence : ${transmission.reference}. `
          + "La réponse arrivera par courriel.";
      }
    }

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

/*
 * ── LA DOCUMENTATION, SERVIE AUX HUMAINS ET AUX MODÈLES ─────────────────────
 *
 * Trois routes PUBLIQUES, sans session : une page d'aide qu'il faut être
 * connecté pour lire ne sert pas celui qui n'arrive pas à se connecter — et
 * c'est précisément lui qui en a le plus besoin.
 *
 * Elles ne rendent que des fichiers versionnés dans le dépôt. Aucune donnée
 * d'entreprise ne passe par là.
 */
export const aidePubliqueRouter: IRouter = Router();

/** L'index destiné aux modèles, au format publié par ElevenLabs. */
aidePubliqueRouter.get("/aide/llms.txt", (req, res): void => {
  const base = process.env["PUBLIC_URL"]?.replace(/\/$/, "") ?? `${req.protocol}://${req.get("host")}`;
  res.type("text/plain; charset=utf-8").send(indexLlms(base));
});

/** La liste, pour l'écran d'aide. */
aidePubliqueRouter.get("/aide/articles", (_req, res): void => {
  res.json({
    articles: articlesAide().map((a) => ({ slug: a.slug, titre: a.titre, sujets: a.sujets })),
  });
});

/** Une page, en markdown brut — lisible par un humain comme par un agent. */
aidePubliqueRouter.get("/aide/:slug.md", (req, res): void => {
  const article = articlesAide().find((a) => a.slug === req.params.slug);
  if (!article) { res.status(404).type("text/plain").send("Article introuvable."); return; }
  // Le corps porte déjà son titre : le préfixer en ajouterait un second.
  const contenu = article.corps.startsWith("#")
    ? article.corps
    : `# ${article.titre}\n\n${article.corps}`;
  res.type("text/markdown; charset=utf-8").send(`${contenu}\n`);
});

export default router;
