/**
 * Exécution d'un plan validé à l'écran.
 *
 * « Vous ne tapez plus jamais rien. » La voix pour dire et pour commander ;
 * l'ÉCRAN pour confirmer. On ne fait pas valider un plan à l'oral : personne ne
 * signe un devis qu'il n'a pas lu.
 *
 *   POST /voix/executer — relit le plan EN BASE et l'applique
 *
 * ── CE FICHIER A PERDU SA MOITIÉ ────────────────────────────────────────────
 * `POST /voix/interpreter` vivait ici : un extracteur d'intentions, sans
 * mémoire ni outils, écrit en parallèle de l'agent de discussion. Le micro
 * lui parlait, si bien qu'une phrase de suite — « pour le même client… » —
 * ne pouvait renvoyer à rien. Le micro passe désormais par `/chat/messages`,
 * l'agent RÉEL, et cette route n'avait plus d'appelant.
 *
 * Ce qui RESTE est le cœur : le magasin de plans est commun aux deux chemins
 * depuis toujours (`enregistrerPlan`), et cette route applique un plan sans
 * savoir qui l'a produit. C'est elle qui tient la règle 4.
 *
 * Le modèle ne touche jamais la base : il rend des intentions, dont le schéma
 * ne contient AUCUN identifiant. Ce n'est pas une consigne de rédaction — c'est
 * `@nodaq/shared`.`SortieModele` qui refuse.
 *
 * Il peut en revanche rapporter un montant PRONONCÉ (`montantEuros`), sur les
 * seules intentions dont l'humain détient le chiffre. Recopier n'est pas
 * fixer : la règle 3 interdit au modèle de CALCULER un prix, pas de rendre
 * celui qu'on vient de dire. Deux verrous plutôt qu'un interdit : le montant
 * doit se retrouver dans la transcription, et l'écran l'affiche avant écriture.
 * Voir `INTENTIONS_MONTANT_DICTABLE` et `centimesDepuisDictee`.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { executerPlan } from "../lib/plan-vocal.js";
import { logger } from "../lib/logger.js";
import { messageValidation } from "../lib/message-validation.js";

const router: IRouter = Router();



const ExecuterBody = z.object({
  planId: z.string().min(1),
  /**
   * Corrections saisies à l'écran de validation : index d'opération → champ →
   * valeur. Un nom propre entendu par une machine devient facilement autre
   * chose ; l'écran laisse rectifier avant d'écrire.
   *
   * Le SERVEUR décide de ce qui est corrigeable (`CHAMPS_CORRIGEABLES`) : ce
   * schéma accepte la forme, pas le contenu.
   */
  corrections: z.record(z.string(), z.record(z.string(), z.string())).optional(),
});


router.post("/voix/executer", async (req, res): Promise<void> => {
  const parsed = ExecuterBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
  const tenantId = req.tenantId!;

  let resultat;
  try {
    resultat = await executerPlan(
      tenantId,
      parsed.data.planId,
      { userId: req.session!.userId, email: req.session!.email },
      parsed.data.corrections,
    );
  } catch (err) {
    // Une opération a échoué : la transaction a tout annulé, y compris le
    // marquage. Le plan reste applicable une fois la cause corrigée.
    logger.error({ err: err instanceof Error ? err.message : "erreur" }, "[voix] exécution impossible");
    /*
     * ── DIRE CE QUI A ÉCHOUÉ ────────────────────────────────────────────────
     * Ce message était générique : « Une des opérations n'a pas pu être
     * appliquée. » L'utilisateur voyait un bandeau rouge sans savoir laquelle,
     * ni pourquoi, ni quoi faire — alors que la cause était connue au mot près
     * (« Campagne de relance sans appel ») et jetée juste ici.
     *
     * Les messages levés par `executerPlan` sont RÉDIGÉS pour être lus : ils
     * décrivent un refus métier, pas une pile d'appels. On les relaie.
     *
     * Une erreur inattendue — un défaut du moteur, une contrainte violée —
     * n'est PAS relayée : elle porterait des noms de colonnes et des détails
     * d'implémentation, et n'aiderait personne. Elle reste dans le journal.
     */
    const motif = err instanceof Error && err.name === "Error" ? err.message : null;
    res.status(409).json({
      error: motif
        ? `${motif}. Rien n'a été enregistré.`
        : "Une des opérations n'a pas pu être appliquée. Rien n'a été enregistré.",
    });
    return;
  }

  switch (resultat.kind) {
    case "introuvable":
      res.status(404).json({ error: "Plan introuvable." });
      return;
    case "correction_refusee":
      // L'écran ne propose JAMAIS ces champs : une correction qui en porte un
      // vient d'une requête forgée, pas d'un utilisateur. Rien n'a été écrit.
      logger.warn({ champs: resultat.champs }, "[voix] correction hors liste blanche");
      res.status(400).json({ error: "Correction non autorisée sur ce champ." });
      return;
    case "champ_manquant":
      // 422 et pas 409 : rien n'est en conflit, il manque une donnée que la
      // voix ne peut pas fournir et que seul l'utilisateur détient.
      res.status(422).json({
        error: resultat.champs
          .map((c) =>
            c.motif === "vide"
              ? `Renseignez « ${c.champ} » avant de valider : je ne devine pas un montant, et je ne l'invente pas.`
              : `« ${c.champ} » attend un montant en centimes, sans virgule : 45 € s'écrit 4500.`,
          )
          .join(" "),
        champs: resultat.champs,
      });
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
