/**
 * resolveTenant middleware — copies session.tenantId → req.tenantId.
 *
 * Must run after requireAuth. Provides a convenient shorthand for route handlers
 * and ensures the tenantId source is always the authenticated session, never a
 * request parameter, header, or body field.
 */
import type { Request, Response, NextFunction } from "express";

export function resolveTenant(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.session) {
    res.status(401).json({ error: "Session manquante — requireAuth must run first." });
    return;
  }
  req.tenantId = req.session.tenantId;
  next();
}
