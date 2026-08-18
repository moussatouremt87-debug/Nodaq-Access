/**
 * requireMembership middleware — re-validates that the session user still holds
 * an active membership for the resolved tenant.
 *
 * Must run after requireAuth + resolveTenant.
 * Updates req.session.role with the fresh DB value.
 */
import type { Request, Response, NextFunction } from "express";
import { checkMembership } from "../lib/authService";

export async function requireMembership(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { userId, tenantId } = req.session ?? {};

  if (!userId || !tenantId) {
    res.status(401).json({ error: "Session incomplète." });
    return;
  }

  const membership = await checkMembership(userId, tenantId);

  if (!membership) {
    res
      .status(403)
      .json({ error: "Vous n'êtes pas membre de cet espace de travail." });
    return;
  }

  // US-A5.4 — échéance de l'accès. `null` = permanent, ce que sont toutes les
  // adhésions sauf celle d'un tiers de confiance : le chemin existant n'est
  // pas touché. Contrôlée ICI et pas à la connexion, pour la même raison que
  // l'adhésion elle-même l'est : ce middleware tourne à CHAQUE requête, donc
  // l'accès se referme dès la requête suivant l'échéance, sans attendre
  // l'expiration du cookie ni une reconnexion.
  //
  // Message distinct de « vous n'êtes pas membre » : le tiers doit comprendre
  // que son accès a simplement pris fin, et l'artisan doit pouvoir le
  // rouvrir sans croire à une erreur.
  if (membership.expiresAt && membership.expiresAt.getTime() <= Date.now()) {
    res
      .status(403)
      .json({ error: "Votre accès à cet espace a expiré." });
    return;
  }

  // Refresh role from DB (in case it changed since login)
  req.session!.role = membership.role;
  next();
}
