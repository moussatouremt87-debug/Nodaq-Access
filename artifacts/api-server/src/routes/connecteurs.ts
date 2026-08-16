import { Router, type IRouter } from "express";
import { withTenant, connectorsTable, bankConnectionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getConfig, creerUtilisateur, creerSessionConnexion, BanqueConfigError } from "@nodaq/banque-agreee";

const router: IRouter = Router();

const UpdateConnectorBody = z.object({
  status: z.enum(["NON_CONNECTE", "CONNECTE", "ERREUR"]).optional(),
  config: z.record(z.string()).optional(),
});

const DEFAULTS = [
  { type: "BANQUE",       label: "Banque",        description: "Synchronisation des transactions bancaires", status: "NON_CONNECTE" },
  { type: "PENNYLANE",    label: "Pennylane",     description: "Comptabilité et facturation synchronisées",  status: "NON_CONNECTE" },
  { type: "STRIPE",       label: "Stripe",        description: "Paiements en ligne et abonnements",           status: "NON_CONNECTE" },
  { type: "GOOGLE_DRIVE", label: "Google Drive",  description: "Stockage et partage de documents",           status: "NON_CONNECTE" },
  { type: "SLACK",        label: "Slack",         description: "Notifications et alertes d'équipe",          status: "NON_CONNECTE" },
  { type: "ZAPIER",       label: "Zapier",        description: "Automatisation de workflows",                status: "NON_CONNECTE" },
];

function redactConfig(config: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(config).map(k => [k, "***"]));
}

router.get("/connecteurs", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;

  const connectors = await withTenant(tenantId, async (tx) => {
    let existing = await tx.select().from(connectorsTable);
    if (existing.length === 0) {
      for (const d of DEFAULTS) {
        await tx.insert(connectorsTable).values({
          tenantId, type: d.type, label: d.label, description: d.description, status: d.status, config: {},
        }).onConflictDoNothing();
      }
      existing = await tx.select().from(connectorsTable);
    }
    return existing;
  });

  const connected = connectors.filter(c => c.status === "CONNECTE").length;
  const withError  = connectors.filter(c => c.status === "ERREUR").length;
  const safe = connectors.map(c => ({ ...c, config: redactConfig(c.config as Record<string, string>) }));
  res.json({ connectors: safe, connected, withError, total: connectors.length });
});

router.patch("/connecteurs/:type", async (req, res): Promise<void> => {
  const { type } = req.params;
  const parsed = UpdateConnectorBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = req.tenantId!;

  const updated = await withTenant(tenantId, async (tx) => {
    const [existing] = await tx.select().from(connectorsTable).where(eq(connectorsTable.type, type));
    if (!existing) return null;

    const disconnecting = parsed.data.status === "NON_CONNECTE";
    const updateData: Record<string, unknown> = {};

    if (parsed.data.status !== undefined) {
      updateData.status = parsed.data.status;
      updateData.lastSyncAt = parsed.data.status === "CONNECTE" ? new Date() : null;
    }

    if (disconnecting) {
      updateData.config = {};
    } else if (parsed.data.config !== undefined) {
      const stored = existing.config as Record<string, string> ?? {};
      const incoming = parsed.data.config as Record<string, string>;
      const merged: Record<string, string> = { ...stored };
      for (const [k, v] of Object.entries(incoming)) {
        if (v && v !== "***") merged[k] = v;
      }
      updateData.config = merged;
    }

    const [updated] = await tx.update(connectorsTable)
      .set(updateData as any)
      .where(eq(connectorsTable.type, type))
      .returning();
    return updated;
  });

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...updated, config: redactConfig(updated.config as Record<string, string>) });
});

/**
 * POST /connecteurs/banque/session
 *
 * Crée (au premier appel) l'utilisateur Bridge du tenant, puis une session
 * Bridge Connect — le front redirige le navigateur sur l'`url` renvoyée.
 * L'appel réseau vers Bridge reste EN DEHORS de toute transaction : une
 * latence Bridge ne doit jamais tenir une connexion Postgres ouverte.
 */
router.post("/connecteurs/banque/session", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;

  let config;
  try {
    config = getConfig();
  } catch (err) {
    if (err instanceof BanqueConfigError) {
      res.status(503).json({ error: "Connecteur bancaire non configuré." });
      return;
    }
    throw err;
  }

  const [existante] = await withTenant(tenantId, (tx) =>
    tx.select().from(bankConnectionsTable).where(eq(bankConnectionsTable.tenantId, tenantId)),
  );

  if (!existante) {
    const utilisateur = await creerUtilisateur(config, tenantId);
    await withTenant(tenantId, (tx) =>
      tx.insert(bankConnectionsTable).values({
        tenantId,
        bridgeUserUuid: utilisateur.uuid,
        statut: "en_attente",
      }),
    );
  }

  // APP_URL : base des liens client-facing (même patron que prospection.ts,
  // membres.ts) — repli sur le site vitrine en dev seulement, jamais en prod
  // (garde au démarrage dans index.ts).
  const callbackUrl = `${process.env["APP_URL"] ?? "https://nodaq.fr"}/connecteurs`;
  const session = await creerSessionConnexion(config, tenantId, callbackUrl);
  res.json({ url: session.url });
});

export default router;
