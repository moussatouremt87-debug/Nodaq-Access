/**
 * Public routes — no authentication required.
 *
 * Token lookups use the narrow `devis_public_token_lookup` RLS policy
 * (created by migrate-public-token-policy.cjs) which allows app_user to SELECT
 * a devis row only when the session GUC `app.devis_accept_token` matches.
 *
 * After identifying the row and its tenant_id, all writes go through
 * withTenant() to maintain full tenant isolation.
 *
 * GET  /public/devis/:token/accept-page  — renders acceptance metadata
 * POST /public/devis/:token/accept       — records "bon pour accord"
 */
import { Router, type IRouter } from "express";
import { db, devisTable, withTenant } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

const AcceptBody = z.object({
  signataire: z.string().min(1, "Le nom du signataire est obligatoire"),
});

/**
 * Look up a devis by its public accept_token using the narrow RLS policy.
 * Sets the session GUC so the policy predicate matches, without bypassing RLS.
 * Returns null if the token is unknown or expired.
 */
async function lookupByToken(token: string) {
  return db.transaction(async tx => {
    // Activate the narrow public-token RLS policy for this transaction.
    await tx.execute(sql`SET LOCAL "app.devis_accept_token" = ${token}`);
    const [row] = await tx
      .select()
      .from(devisTable)
      .where(eq(devisTable.acceptToken, token));
    return row ?? null;
  });
}

/** Public: get devis metadata for the acceptance page (no auth). */
router.get("/public/devis/:token/accept-page", async (req, res): Promise<void> => {
  const { token } = req.params;
  if (!token) { res.status(400).json({ error: "Token manquant" }); return; }

  const devis = await lookupByToken(token);

  if (!devis) {
    res.status(404).json({ error: "Lien invalide ou expiré." });
    return;
  }

  if (devis.acceptedAt) {
    res.json({
      alreadyAccepted: true,
      acceptedAt: devis.acceptedAt,
      acceptedBy: devis.acceptedBy,
      reference: devis.reference,
      clientName: devis.clientName,
    });
    return;
  }

  if (devis.validUntil && new Date(devis.validUntil) < new Date()) {
    res.json({ expired: true, validUntil: devis.validUntil, reference: devis.reference });
    return;
  }

  res.json({
    reference: devis.reference,
    clientName: devis.clientName,
    totalTTCCents: devis.totalTTCCents,
    validUntil: devis.validUntil,
    alreadyAccepted: false,
    expired: false,
  });
});

/** Public: record "bon pour accord" (no auth). */
router.post("/public/devis/:token/accept", async (req, res): Promise<void> => {
  const { token } = req.params;
  if (!token) { res.status(400).json({ error: "Token manquant" }); return; }

  const parsed = AcceptBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Step 1: token lookup via narrow RLS policy (no tenant context needed yet)
  const devis = await lookupByToken(token);

  if (!devis) {
    res.status(404).json({ error: "Lien invalide ou expiré." });
    return;
  }
  if (devis.acceptedAt) {
    res.status(409).json({ error: "Ce devis a déjà été accepté.", acceptedAt: devis.acceptedAt });
    return;
  }
  if (devis.validUntil && new Date(devis.validUntil) < new Date()) {
    res.status(410).json({ error: "Ce devis est expiré.", validUntil: devis.validUntil });
    return;
  }

  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.socket.remoteAddress ??
    "unknown";

  // Step 2: write through withTenant — preserves full tenant isolation.
  //   Condition acceptedAt IS NULL prevents a concurrent request from overwriting
  //   the first signer's timestamp (TOCTOU race: both requests pass the pre-check
  //   above, but only one will find an unaccepted row in the UPDATE).
  const [updated] = await withTenant(devis.tenantId, tx =>
    tx
      .update(devisTable)
      .set({
        status: "ACCEPTE",
        acceptedAt: new Date(),
        acceptedBy: parsed.data.signataire,
        acceptedIp: ip,
      })
      .where(and(eq(devisTable.acceptToken, token), isNull(devisTable.acceptedAt)))
      .returning(),
  );

  if (!updated) {
    // Another concurrent request accepted the devis first.
    res.status(409).json({ error: "Ce devis vient d'être accepté par une autre session simultanée.", reference: devis.reference });
    return;
  }

  res.json({
    accepted: true,
    acceptedAt: updated.acceptedAt,
    acceptedBy: updated.acceptedBy,
    reference: devis.reference,
  });
});

export default router;
