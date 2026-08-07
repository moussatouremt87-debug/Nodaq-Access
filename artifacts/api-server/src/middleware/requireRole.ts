/**
 * requireRole(roles) — gate on membership role.
 *
 * Must run after requireAuth + resolveTenant + requireMembership.
 *
 * Usage:
 *   router.post("/members/invite", requireRole(["OWNER"]), handler);
 */
import type { Request, Response, NextFunction } from "express";

export function requireRole(allowedRoles: string[]) {
  return function (req: Request, res: Response, next: NextFunction): void {
    const role = req.session?.role;
    if (!role || !allowedRoles.includes(role)) {
      res.status(403).json({
        error: `Accès refusé — rôle requis : ${allowedRoles.join(" ou ")}.`,
      });
      return;
    }
    next();
  };
}
