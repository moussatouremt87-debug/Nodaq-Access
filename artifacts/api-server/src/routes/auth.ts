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
import { hasFinancialAccess, verticalLabel, type Vertical } from "@nodaq/shared";
import { secondFacteurSuspendu } from "../lib/mfa-suspension.js";
import { withTenant, affairesTable, settingsTable, type User, type Session } from "@workspace/db";
import { sql, inArray } from "drizzle-orm";
import {
  findUserByEmail,
  createUserTenantOwner,
  createSession,
  findValidSession,
  deleteSession,
  touchLastLogin,
  findUserMemberships,
  listUserMemberships,
  basculerEspace,
} from "../lib/authService";
import { verticalDepuisTx } from "../lib/vertical-tenant.js";

const router: IRouter = Router();

export const COOKIE_NAME = "nodaq_sid";
export const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  // PAS un test sur NODE_ENV : cette variable vaut "production" même en
  // local, dès qu'on sert le SPA construit (app.ts) — un cookie "secure"
  // serait alors posé sur une connexion HTTP simple (test depuis un
  // téléphone sur le même Wi-Fi que le Mac, par exemple), et le navigateur
  // refuse purement et simplement de le garder : la connexion semble
  // réussir puis "s'oublie" aussitôt.
  //
  // Le bon signal est PUBLIC_URL — l'origine canonique RÉELLE de ce
  // déploiement. Si elle est en HTTPS, on est dans un vrai déploiement
  // public et le cookie DOIT être secure. Si elle est en HTTP (localhost en
  // dev, ou une IP de réseau local pour un test), il ne peut pas l'être.
  secure: (process.env.PUBLIC_URL ?? "").startsWith("https://"),
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

  // MFA (ticket 4.15) — une session neuve n'a jamais mfaVerifiedAt posé. Pour
  // OWNER/ACCOUNTANT, ne rien renvoyer de plus que ce qu'il faut pour router
  // vers l'écran MFA : ni tenantId ni role tant que le second facteur n'est
  // pas prouvé. Ce branchement arrive APRÈS la vérification du mot de passe
  // existante — le chemin mauvais-mot-de-passe garde exactement son coût et
  // son timing actuels, aucun nouveau signal n'est introduit ici.
  if (hasFinancialAccess(preferred.role)) {
    res.json({ ok: true, mfaStatus: user.mfaEnabledAt ? "verify_required" : "enroll_required" });
    return;
  }

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

// MFA (ticket 4.15) — trois états, volontairement minimal tant que le second
// facteur n'est pas prouvé : ni tenantId ni role ni email avant que mfaStatus
// ne vaille "verified"/"not_required". Partagé par /auth/me ET
// /auth/basculer-espace (US-A5.2) — la bascule renvoie la même forme que
// /auth/me pour le nouveau tenant, sans dupliquer ce branchement.
function reponseAuthentification(
  user: Pick<User, "id" | "email" | "nom" | "mfaEnabledAt">,
  session: Pick<Session, "mfaVerifiedAt">,
  role: string,
  tenantId: string,
) {
  // Suspendu : l'écran ne doit pas exiger un second facteur que le serveur
  // n'attend plus. La condition est LUE au même endroit que celle du
  // middleware — deux copies auraient divergé.
  if (hasFinancialAccess(role) && !secondFacteurSuspendu()) {
    if (!user.mfaEnabledAt) return { authenticated: true, mfaStatus: "enroll_required" as const };
    if (!session.mfaVerifiedAt) return { authenticated: true, mfaStatus: "verify_required" as const };
    return {
      authenticated: true,
      mfaStatus: "verified" as const,
      userId: user.id,
      email: user.email,
      nom: user.nom,
      tenantId,
      role,
    };
  }
  return {
    authenticated: true,
    mfaStatus: "not_required" as const,
    userId: user.id,
    email: user.email,
    nom: user.nom,
    tenantId,
    role,
  };
}

// ── GET /auth/me ──────────────────────────────────────────────────────────

router.get("/auth/me", async (req, res): Promise<void> => {
  const cookies = (req as any).signedCookies ?? {};
  const sessionId = cookies[COOKIE_NAME];
  if (!sessionId) { res.status(401).json({ authenticated: false }); return; }

  const ctx = await findValidSession(sessionId);
  if (!ctx) { res.status(401).json({ authenticated: false }); return; }

  if (!ctx.membership) {
    // Valid session but membership was revoked between login and this request.
    res.status(403).json({ authenticated: false, error: "Membership révoqué" });
    return;
  }

  res.json(reponseAuthentification(ctx.user, ctx.session, ctx.membership.role, ctx.session.tenantId));
});

// ── GET /auth/mes-espaces ────────────────────────────────────────────────
// US-A5.2 — portefeuille de tenants d'un utilisateur (console cabinet).
// Chaque espace listé porte SON PROPRE rôle : l'accès financier (et donc
// l'indicateur) se juge par tenant, jamais d'après le rôle de la session
// d'origine.

// Même définition du "vendu" que revenusAcquis.ts (non exportée de là,
// dupliquée ici à l'identique plutôt que de réorganiser ce module existant
// pour un seul appelant).
const AFFAIRES_EN_COURS_STATUSES = ["ACCEPTEE", "EN_COURS"];

router.get("/auth/mes-espaces", async (req, res): Promise<void> => {
  const cookies = (req as any).signedCookies ?? {};
  const sessionId = cookies[COOKIE_NAME];
  if (!sessionId) { res.status(401).json({ authenticated: false }); return; }

  const ctx = await findValidSession(sessionId);
  if (!ctx) { res.status(401).json({ authenticated: false }); return; }

  const memberships = await listUserMemberships(ctx.user.id);

  const espaces = await Promise.all(
    memberships.map(async (m) => {
      const financier = hasFinancialAccess(m.role);
      const { secteurLabel, affairesEnCours } = await withTenant(m.tenantId, async (tx) => {
    const vertical = await verticalDepuisTx(tx);
        const secteurLabel = verticalLabel(vertical);

        // Pas de MEMBER simple ici : zéro donnée financière, y compris un
        // simple compte d'affaires en cours.
        if (!financier) return { secteurLabel, affairesEnCours: null as number | null };

        const [row] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(affairesTable)
          .where(inArray(affairesTable.status, AFFAIRES_EN_COURS_STATUSES));
        return { secteurLabel, affairesEnCours: row?.count ?? 0 };
      });

      return {
        tenantId: m.tenantId,
        tenantNom: m.tenantNom,
        role: m.role,
        secteurLabel,
        affairesEnCours,
      };
    }),
  );

  res.json({ espaces });
});

// ── POST /auth/basculer-espace ───────────────────────────────────────────
// US-A5.2 — bascule la session courante vers un autre tenant du même
// utilisateur, EN PLACE (voir authService.basculerEspace pour le détail).

const BasculerEspaceBody = z.object({
  tenantId: z.string().min(1),
});

router.post("/auth/basculer-espace", async (req, res): Promise<void> => {
  const cookies = (req as any).signedCookies ?? {};
  const sessionId = cookies[COOKIE_NAME];
  if (!sessionId) { res.status(401).json({ authenticated: false }); return; }

  const ctx = await findValidSession(sessionId);
  if (!ctx) { res.status(401).json({ authenticated: false }); return; }

  const parsed = BasculerEspaceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Espace invalide" }); return; }

  const membership = await basculerEspace(sessionId, ctx.user.id, parsed.data.tenantId);
  if (!membership) {
    res.status(403).json({ error: "Vous n'êtes pas membre de cet espace." });
    return;
  }

  res.json(reponseAuthentification(ctx.user, ctx.session, membership.role, parsed.data.tenantId));
});

export default router;
