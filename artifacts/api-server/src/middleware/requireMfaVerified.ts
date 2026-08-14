/**
 * requireMfaVerified — bloque une session OWNER/ACCOUNTANT qui n'a pas encore
 * prouvé son second facteur. Ticket 4.15.
 *
 * Doit tourner après requireAuth + resolveTenant + requireMembership (a
 * besoin du rôle FRAIS que requireMembership vient de reposer).
 *
 * MEMBER n'est jamais bloqué — le MFA reste optionnel pour ce rôle. La menace
 * visée est « cette identité peut lire largement à travers les tenants », pas
 * « cette route précise est sensible » : posé sur `biz`, dont héritent
 * `ownerOnly` et `financierOnly`, plutôt que sur un sous-ensemble de routes.
 */
import type { Request, Response, NextFunction } from "express";
import { hasFinancialAccess } from "@nodaq/shared";

export function requireMfaVerified(req: Request, res: Response, next: NextFunction): void {
  if (!hasFinancialAccess(req.session?.role)) {
    next();
    return;
  }
  if (!req.session?.mfaVerifiedAt) {
    res.status(403).json({
      error: "mfa_required",
      mfaStatus: req.session?.mfaEnabled ? "verify_required" : "enroll_required",
    });
    return;
  }
  next();
}
