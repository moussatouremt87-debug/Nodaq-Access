/**
 * Simple signed-cookie auth middleware.
 * A valid `nodaq_sid` signed cookie (set by POST /api/auth/login) grants access.
 */
import type { Request, Response, NextFunction } from "express";

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // cookie-parser (with secret) attaches signedCookies
  const cookies = (req as any).signedCookies ?? {};
  if (cookies["nodaq_sid"] === "authenticated") {
    next();
    return;
  }
  res.status(401).json({ error: "Authentication required" });
}
