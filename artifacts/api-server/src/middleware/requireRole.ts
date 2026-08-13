/**
 * requireRole(roles) — gate on membership role.
 *
 * Must run after requireAuth + resolveTenant + requireMembership.
 *
 * Usage:
 *   router.use([...biz, requireRole(FINANCIAL_ROLES)], facturesRouter);
 */
import type { Request, Response, NextFunction } from "express";
import type { MembershipRole } from "@nodaq/shared";

export function requireRole(allowedRoles: readonly MembershipRole[]) {
  return function (req: Request, res: Response, next: NextFunction): void {
    const role = req.session?.role;
    if (!role || !(allowedRoles as readonly string[]).includes(role)) {
      res.status(403).json({
        error: `Accès refusé — rôle requis : ${allowedRoles.join(" ou ")}.`,
      });
      return;
    }
    next();
  };
}
