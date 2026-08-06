/**
 * Auth routes: POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
 *
 * Single-tenant: the admin password is SESSION_SECRET (or ADMIN_PASSWORD if set).
 * A valid login sets a signed cookie `nodaq_sid` that the requireAuth middleware checks.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";

const router: IRouter = Router();

const adminPassword = process.env.ADMIN_PASSWORD;
if (!adminPassword) {
  console.error("[auth] ADMIN_PASSWORD environment variable is required — refusing to start without an explicit admin credential");
  process.exit(1);
}

const COOKIE_NAME = "nodaq_sid";
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "strict" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 8 * 60 * 60 * 1000, // 8 hours
  signed: true,
};

router.post("/auth/login", (req, res): void => {
  const parsed = z.object({ password: z.string() }).safeParse(req.body);
  if (!parsed.success || parsed.data.password !== adminPassword) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  res.cookie(COOKIE_NAME, "authenticated", COOKIE_OPTS);
  res.json({ ok: true });
});

router.post("/auth/logout", (_req, res): void => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get("/auth/me", (req, res): void => {
  const cookies = (req as any).signedCookies ?? {};
  if (cookies[COOKIE_NAME] === "authenticated") {
    res.json({ authenticated: true });
  } else {
    res.status(401).json({ authenticated: false });
  }
});

export default router;
