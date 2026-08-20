/**
 * MFA (TOTP) — ticket 4.15, phase 1.
 *
 *   POST /api/mfa/enroll    — génère un secret + QR, ne persiste rien
 *   POST /api/mfa/verify    — vérifie un code ; termine l'enrôlement ou lève
 *                             le blocage de la session courante
 *   POST /api/mfa/recovery  — consomme un code de récupération
 *   GET  /api/mfa/status    — état MFA de l'utilisateur courant
 *
 * Gardé par requireAuth SEUL — pas la chaîne `biz` complète : une session
 * bloquée par requireMfaVerified doit pouvoir atteindre ces routes pour en
 * sortir. Ce n'est pas un oubli, c'est ce qui rend le blocage traversable.
 *
 * Auth-adjacent, comme routes/auth.ts : schémas Zod écrits à la main ici,
 * pas de passage par l'OpenAPI/orval qui sert les fonctionnalités métier —
 * même convention que /auth/login, /auth/register, /auth/me, qui n'y
 * figurent pas non plus.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { marquerSessionMfaVerifiee } from "../lib/authService.js";
import {
  genererSecretProvisoire,
  genererQrDataUri,
  verifierCode,
  enregistrerSecretMfa,
  lireSecretMfa,
  genererCodesRecuperation,
  hacherCodesRecuperation,
  consommerCodeRecuperation,
} from "../lib/totp.js";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

// ── POST /mfa/enroll ─────────────────────────────────────────────────────

router.post("/mfa/enroll", async (req, res): Promise<void> => {
  const userId = req.session!.userId;
  const email = req.session!.email;

  const { secret, otpauthUri } = genererSecretProvisoire(email);
  const qrDataUri = await genererQrDataUri(otpauthUri);

  // `otpauthUri` part AUSSI vers le navigateur (ticket 4.20) : sur un
  // téléphone, un QR code affiché sur l'écran qu'on tient est inutilisable —
  // on ne se photographie pas soi-même. L'URI, elle, s'ouvre d'un appui dans
  // l'application d'authentification.
  //
  // Aucun secret supplémentaire n'est exposé : l'URI contient exactement le
  // `secret` déjà présent dans cette réponse, et le QR l'encode depuis
  // toujours. C'est la même donnée sous une troisième forme.
  res.json({ secret, qrDataUri, otpauthUri });
});

// ── POST /mfa/verify ─────────────────────────────────────────────────────

const VerifyBody = z.object({
  secret: z.string().optional(),
  code: z.string().length(6).regex(/^\d+$/, "Le code doit comporter 6 chiffres."),
});

router.post("/mfa/verify", async (req, res): Promise<void> => {
  const parsed = VerifyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Requête invalide" });
    return;
  }
  const { secret, code } = parsed.data;
  const userId = req.session!.userId;

  if (secret) {
    // Fin d'enrôlement — le secret n'est PAS encore persisté. Un code faux ne
    // laisse RIEN en base : le compte reste non enrôlé.
    const valide = await verifierCode(secret, code);
    if (!valide) {
      res.status(400).json({ error: "Code incorrect." });
      return;
    }
    await enregistrerSecretMfa(userId, secret);

    // Codes de récupération générés une seule fois, à l'enrôlement — montrés
    // au client dans CETTE réponse, jamais renvoyés ensuite en clair.
    const codes = genererCodesRecuperation();
    const hashes = await hacherCodesRecuperation(codes);
    await db.update(usersTable).set({ mfaRecoveryCodes: hashes }).where(eq(usersTable.id, userId));

    await marquerSessionMfaVerifiee(req.session!.id);
    res.json({ ok: true, recoveryCodes: codes });
    return;
  }

  // Vérification normale — l'utilisateur est déjà enrôlé.
  const secretClair = await lireSecretMfa(userId);
  if (!secretClair) {
    res.status(409).json({ error: "Aucun MFA enrôlé pour ce compte." });
    return;
  }
  const valide = await verifierCode(secretClair, code);
  if (!valide) {
    res.status(400).json({ error: "Code incorrect." });
    return;
  }
  await marquerSessionMfaVerifiee(req.session!.id);
  res.json({ ok: true });
});

// ── POST /mfa/recovery ───────────────────────────────────────────────────

const RecoveryBody = z.object({
  code: z.string().min(1),
});

router.post("/mfa/recovery", async (req, res): Promise<void> => {
  const parsed = RecoveryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Requête invalide" });
    return;
  }
  const userId = req.session!.userId;

  const consomme = await consommerCodeRecuperation(userId, parsed.data.code);
  if (!consomme) {
    // Même forme de réponse qu'un code TOTP faux — pas de signal distinct.
    res.status(400).json({ error: "Code incorrect." });
    return;
  }
  await marquerSessionMfaVerifiee(req.session!.id);
  res.json({ ok: true });
});

// ── GET /mfa/status ──────────────────────────────────────────────────────

router.get("/mfa/status", async (req, res): Promise<void> => {
  const userId = req.session!.userId;
  const [ligne] = await db
    .select({ mfaEnabledAt: usersTable.mfaEnabledAt, mfaRecoveryCodes: usersTable.mfaRecoveryCodes })
    .from(usersTable)
    .where(eq(usersTable.id, userId));

  const enabled = ligne?.mfaEnabledAt !== null && ligne?.mfaEnabledAt !== undefined;
  const recoveryCodesRemaining = ligne?.mfaRecoveryCodes?.filter((c) => c.usedAt === null).length;

  res.json({ enabled, ...(enabled ? { recoveryCodesRemaining } : {}) });
});

export default router;
