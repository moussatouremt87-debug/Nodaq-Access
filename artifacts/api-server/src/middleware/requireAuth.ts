/**
 * requireAuth middleware — DB-backed session validation.
 *
 * Reads the signed `nodaq_sid` cookie, looks up the session in the database,
 * validates expiry, and attaches a typed `req.session` for downstream middlewares.
 * Also extends the session TTL on each valid request (sliding expiry).
 */
import type { Request, Response, NextFunction } from "express";
import { COOKIE_NAME } from "../routes/auth";
import { findValidSession, extendSession } from "../lib/authService";

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const cookies = (req as any).signedCookies ?? {};
  const sessionId: string | undefined = cookies[COOKIE_NAME];

  if (!sessionId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  const ctx = await findValidSession(sessionId);

  if (!ctx) {
    res.clearCookie(COOKIE_NAME);
    res.status(401).json({ error: "Session expirée ou invalide — veuillez vous reconnecter." });
    return;
  }

  // Attach typed context
  req.session = {
    id:       ctx.session.id,
    userId:   ctx.user.id,
    tenantId: ctx.session.tenantId,
    role:     ctx.membership.role,
    email:    ctx.user.email,
    nom:      ctx.user.nom,
  };

  // Sliding expiry — fire-and-forget (don't await, avoid adding latency)
  extendSession(sessionId).catch(() => { /* non-fatal */ });

  next();
}
