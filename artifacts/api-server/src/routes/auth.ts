/**
 * Auth routes:
 *   POST /api/auth/register  — create tenant + OWNER user (first-time setup)
 *   POST /api/auth/login     — email/password → DB-backed session + opaque cookie
 *   POST /api/auth/logout    — delete session + clear cookie
 *   GET  /api/auth/me        — return session info (no DB hit; reads cookie → session via requireAuth)
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../lib/password";
import {
  findUserByEmail,
  createUserTenantOwner,
  createSession,
  findValidSession,
  deleteSession,
  touchLastLogin,
  findUserMemberships,
} from "../lib/authService";

const router: IRouter = Router();

export const COOKIE_NAME = "nodaq_sid";
export const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (sliding — middleware extends DB record)
  signed: true,
};

// ── POST /auth/register ───────────────────────────────────────────────────

const RegisterBody = z.object({
  email:      z.string().email(),
  password:   z.string().min(10, "Le mot de passe doit comporter au moins 10 caractères"),
  nom:        z.string().optional(),
  tenantNom:  z.string().min(1).optional(),
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }); return; }

  const { email, password, nom, tenantNom } = parsed.data;

  const existing = await findUserByEmail(email);
  if (existing) { res.status(409).json({ error: "Un compte avec cet email existe déjà." }); return; }

  const passwordHash = await hashPassword(password);
  const { userId, tenantId } = await createUserTenantOwner(
    email, passwordHash,
    nom ?? email,
    tenantNom ?? "Mon entreprise",
  );

  const session = await createSession(userId, tenantId, req.headers["user-agent"]);
  res.cookie(COOKIE_NAME, session.id, COOKIE_OPTS);
  res.status(201).json({ ok: true, userId, tenantId });
});

// ── POST /auth/login ──────────────────────────────────────────────────────

const LoginBody = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Email ou mot de passe invalide" }); return; }

  const { email, password } = parsed.data;
  const user = await findUserByEmail(email);

  // Constant-time check — verify even if user not found to prevent timing oracle
  const hashToVerify = user?.passwordHash ?? "$2b$12$invalidhashpadding0000000000000000000000000000000000000";
  const valid = await verifyPassword(password, hashToVerify);

  if (!user || !valid) {
    res.status(401).json({ error: "Email ou mot de passe incorrect" });
    return;
  }

  // Find the user's active tenantId from their primary membership
  const memberships = await findUserMemberships(user.id);
  if (memberships.length === 0) {
    res.status(403).json({ error: "Aucun espace de travail associé à ce compte." });
    return;
  }

  // Prefer OWNER membership, fallback to first available
  const preferred = memberships.find(m => m.role === "OWNER") ?? memberships[0]!;
  const session = await createSession(user.id, preferred.tenantId, req.headers["user-agent"]);
  await touchLastLogin(user.id);

  res.cookie(COOKIE_NAME, session.id, COOKIE_OPTS);
  res.json({ ok: true, tenantId: preferred.tenantId, role: preferred.role });
});

// ── POST /auth/logout ─────────────────────────────────────────────────────

router.post("/auth/logout", async (req, res): Promise<void> => {
  const cookies = (req as any).signedCookies ?? {};
  const sessionId = cookies[COOKIE_NAME];
  if (sessionId) {
    try { await deleteSession(sessionId); } catch { /* already deleted */ }
  }
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

// ── GET /auth/me ──────────────────────────────────────────────────────────

router.get("/auth/me", async (req, res): Promise<void> => {
  const cookies = (req as any).signedCookies ?? {};
  const sessionId = cookies[COOKIE_NAME];
  if (!sessionId) { res.status(401).json({ authenticated: false }); return; }

  const ctx = await findValidSession(sessionId);
  if (!ctx) { res.status(401).json({ authenticated: false }); return; }

  res.json({
    authenticated: true,
    userId: ctx.user.id,
    email: ctx.user.email,
    nom: ctx.user.nom,
    tenantId: ctx.session.tenantId,
    role: ctx.membership.role,
  });
});

export default router;
