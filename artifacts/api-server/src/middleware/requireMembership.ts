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

  // Refresh role from DB (in case it changed since login)
  req.session!.role = membership.role;
  next();
}
