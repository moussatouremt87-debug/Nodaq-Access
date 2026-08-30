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
import { abonnementCourant, constaterJalonsEssai } from "../lib/abonnement.js";

export const MESSAGE_ABONNEMENT_LECTURE_SEULE =
  "L'essai est terminé : votre espace est en lecture seule et toutes vos données sont conservées. Choisissez une formule dans Réglages → Abonnement pour reprendre la main.";

/**
 * Même en lecture seule, retirer un accès externe doit rester possible.
 * L'exception est volontairement plus étroite que la route PATCH : un seul
 * statut, aucune configuration, et seulement les types intégrés connus.
 */
function estDeconnexionConnecteur(req: Request): boolean {
  if (req.method !== "PATCH") return false;
  if (!/^\/connecteurs\/(?:BANQUE|PENNYLANE|STRIPE|GOOGLE_DRIVE|SLACK|ZAPIER)$/.test(req.path)) return false;
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return false;
  const body = req.body as Record<string, unknown>;
  if (body["status"] !== "NON_CONNECTE") return false;
  const config = body["config"];
  if (config !== undefined && (
    !config
    || typeof config !== "object"
    || Array.isArray(config)
    || Object.keys(config as Record<string, unknown>).length > 0
  )) return false;
  if (
    body["externalRevocationConfirmed"] !== undefined
    && body["externalRevocationConfirmed"] !== true
  ) return false;
  if (
    body["externalRevocationId"] !== undefined
    && typeof body["externalRevocationId"] !== "string"
  ) return false;
  if (body["connectionId"] !== undefined && typeof body["connectionId"] !== "string") return false;
  return Object.keys(body).every((key) => (
    key === "status"
    || key === "config"
    || key === "externalRevocationConfirmed"
    || key === "externalRevocationId"
    || key === "connectionId"
  ));
}

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
    // Jalons d'essai (4.43 §5) : une requête mutante est le signe d'un tenant
    // actif — l'occasion de constater J7/J10, sans retarder la requête.
    if (sub.statut === "TRIAL") void constaterJalonsEssai(req.tenantId!).catch(() => {});
    next();
    return;
  }
  if (estDeconnexionConnecteur(req)) {
    next();
    return;
  }
  res.status(403).json({
    error: MESSAGE_ABONNEMENT_LECTURE_SEULE,
    abonnement: "LECTURE_SEULE",
  });
}
