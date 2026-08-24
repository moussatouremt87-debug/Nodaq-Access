/**
 * Lecture seule d'abonnement — l'essai échu ne détruit RIEN.
 *
 * À l'échéance des 14 jours sans souscription, l'espace passe en lecture
 * seule : toutes les données restent visibles, aucune n'est supprimée, et
 * toute écriture est refusée avec un message qui dit comment reprendre la
 * main. C'est la promesse de la grille (« JAMAIS de suppression de
 * données ») rendue structurelle — le même choix qu'US-A5.4 : une garde
 * unique dans `biz` plutôt que 97 modifications de routes, pour couvrir
 * aussi celles qui n'existent pas encore.
 *
 * ── Ce qui reste ouvert, et pourquoi ──────────────────────────────────────
 * Les routes `/abonnement` : souscrire est la porte de sortie de la lecture
 * seule — la fermer enfermerait l'utilisateur dehors, exactement le piège
 * que `lectureSeule.ts` documente pour le MFA.
 *
 * ── Coût ──────────────────────────────────────────────────────────────────
 * Un SELECT par requête MUTANTE seulement (GET/HEAD/OPTIONS passent sans
 * lire la base), sur une ligne unique indexée par tenant. La bascule
 * TRIAL → READONLY est constatée par `abonnementCourant`, paresseusement.
 */
import type { Request, Response, NextFunction } from "express";
import { abonnementCourant } from "../lib/abonnement.js";

export async function abonnementLectureSeule(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    next();
    return;
  }
  if (req.path.startsWith("/abonnement")) {
    next();
    return;
  }
  const sub = await abonnementCourant(req.tenantId!);
  if (sub.statut !== "READONLY") {
    next();
    return;
  }
  res.status(403).json({
    error:
      "L'essai est terminé : votre espace est en lecture seule et toutes vos données sont conservées. Choisissez une formule dans Réglages → Abonnement pour reprendre la main.",
    abonnement: "LECTURE_SEULE",
  });
}
