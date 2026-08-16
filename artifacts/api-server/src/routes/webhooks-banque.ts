/**
 * POST /webhooks/banque — webhook Bridge (connecteur bancaire).
 *
 * Un seul webhook au niveau de toute l'application (Bridge n'en autorise
 * pas un par tenant) — contrairement au webhook plateforme-agreee
 * (US-A2.6), qui porte le tenantId dans le segment d'URL. Le payload Bridge
 * ne porte que des identifiants internes (`user_uuid`, `item_id`,
 * `account_id`) — jamais notre tenantId.
 *
 * Résolution du tenant : policy RLS étroite `bank_connections_webhook_lookup`
 * (migration 034), même patron que `lookupByToken` (routes/public.ts,
 * acceptation publique de devis) — un OEUF-ET-POULE resolu en posant un
 * réglage de session que SEULE cette policy sait lire, avant tout contexte
 * de tenant normal.
 *
 * Authentification : signature `BridgeApi-Signature` (HMAC-SHA256 du corps
 * BRUT, secret applicatif unique — voir `config.webhookSecret`, résolu par
 * `getConfig()`) — vérifiée AVANT toute lecture en base.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, withTenant, bankConnectionsTable, bankAccountsTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { getConfig, verifierSignatureWebhook, listerComptes, BanqueConfigError } from "@nodaq/banque-agreee";
import { logger } from "../lib/logger.js";

export const banqueWebhookRouter: IRouter = Router();

const EvenementBridge = z.object({
  type: z.string(),
  content: z.object({
    user_uuid: z.string(),
    item_id: z.union([z.string(), z.number()]).optional(),
    status_code: z.union([z.string(), z.number()]).optional(),
  }),
});

/**
 * Résout le tenant propriétaire d'un `bridge_user_uuid`, via la policy
 * étroite — SANS jamais poser de contexte tenant normal. `set_config`
 * scopé à la transaction (troisième argument `true`), même règle que
 * `withTenant`.
 */
async function resoudreLocataire(bridgeUserUuid: string): Promise<string | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.bridge_lookup_user_uuid', ${bridgeUserUuid}, true)`);
    const [row] = await tx
      .select({ tenantId: bankConnectionsTable.tenantId })
      .from(bankConnectionsTable)
      .where(eq(bankConnectionsTable.bridgeUserUuid, bridgeUserUuid));
    return row?.tenantId ?? null;
  });
}

/** Resynchronise l'intégralité des comptes du tenant depuis Bridge. */
async function resynchroniserComptes(
  config: ReturnType<typeof getConfig>,
  tenantId: string,
  connectionId: string,
): Promise<void> {
  const comptes = await listerComptes(config, tenantId);
  await withTenant(tenantId, async (tx) => {
    for (const compte of comptes) {
      await tx
        .insert(bankAccountsTable)
        .values({
          id: compte.id,
          tenantId,
          connectionId,
          label: compte.label,
          balanceCents: compte.balanceCents,
          devise: compte.devise,
        })
        .onConflictDoUpdate({
          target: bankAccountsTable.id,
          set: { label: compte.label, balanceCents: compte.balanceCents, devise: compte.devise, updatedAt: new Date() },
        });
    }
  });
}

banqueWebhookRouter.post("/webhooks/banque", async (req, res): Promise<void> => {
  let config;
  try {
    config = getConfig();
  } catch (err) {
    if (err instanceof BanqueConfigError) { res.status(503).json({ error: "Non configuré." }); return; }
    throw err;
  }

  if (!req.rawBody || !verifierSignatureWebhook(req.rawBody, req.headers as Record<string, string>, config.webhookSecret)) {
    res.status(401).json({ error: "Non autorisé." });
    return;
  }

  const parsed = EvenementBridge.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Corps invalide." }); return; }
  const { type, content } = parsed.data;

  const tenantId = await resoudreLocataire(content.user_uuid);
  if (!tenantId) { res.status(404).json({ error: "Introuvable." }); return; }

  const [connexion] = await withTenant(tenantId, (tx) =>
    tx.select().from(bankConnectionsTable).where(eq(bankConnectionsTable.tenantId, tenantId)),
  );
  if (!connexion) { res.status(404).json({ error: "Introuvable." }); return; }

  switch (type) {
    case "item.created": {
      await withTenant(tenantId, (tx) =>
        tx
          .update(bankConnectionsTable)
          .set({
            statut: "connecte",
            ...(content.item_id !== undefined ? { bridgeItemId: String(content.item_id) } : {}),
            updatedAt: new Date(),
          })
          .where(eq(bankConnectionsTable.tenantId, tenantId)),
      );
      break;
    }
    case "item.account.created":
    case "item.account.updated": {
      // Resynchronisation complète plutôt que d'exploiter le contenu exact
      // de CET événement : la forme du payload varie selon `data_access`
      // (le solde peut être absent) — un GET /accounts fait toujours foi.
      await resynchroniserComptes(config, tenantId, connexion.id);
      break;
    }
    case "item.refreshed": {
      // Statut d'erreur journalisé, pas encore écrit en base — voir le plan
      // (ré-authentification SCA hors périmètre de ce lot).
      if (content.status_code) {
        logger.info({ tenantId, statusCode: content.status_code }, "[banque] item.refreshed en erreur");
      }
      break;
    }
    default:
      // Type d'événement non géré (ex. user.deleted) — accusé réception
      // sans action, pour ne jamais déclencher les tentatives de Bridge.
      break;
  }

  res.status(200).json({ received: true });
});
