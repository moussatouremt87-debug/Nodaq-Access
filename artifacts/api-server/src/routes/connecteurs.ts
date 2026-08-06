import { Router, type IRouter } from "express";
import { db, connectorsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

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

async function ensureDefaults() {
  const existing = await db.select().from(connectorsTable);
  if (existing.length === 0) {
    for (const d of DEFAULTS) {
      await db.insert(connectorsTable).values({
        type: d.type, label: d.label, description: d.description, status: d.status, config: {},
      }).onConflictDoNothing();
    }
  }
}

/** Strip credential values from config before sending to client */
function redactConfig(config: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(config).map(k => [k, "***"]));
}

router.get("/connecteurs", async (_req, res): Promise<void> => {
  await ensureDefaults();
  const connectors = await db.select().from(connectorsTable);
  const connected = connectors.filter(c => c.status === "CONNECTE").length;
  const withError = connectors.filter(c => c.status === "ERREUR").length;
  const safe = connectors.map(c => ({ ...c, config: redactConfig(c.config as Record<string, string>) }));
  res.json({ connectors: safe, connected, withError, total: connectors.length });
});

router.patch("/connecteurs/:type", async (req, res): Promise<void> => {
  const { type } = req.params;
  const parsed = UpdateConnectorBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  await ensureDefaults();
  const [existing] = await db.select().from(connectorsTable).where(eq(connectorsTable.type, type));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const disconnecting = parsed.data.status === "NON_CONNECTE";
  const updateData: Record<string, unknown> = {};

  if (parsed.data.status !== undefined) {
    updateData.status = parsed.data.status;
    updateData.lastSyncAt = parsed.data.status === "CONNECTE" ? new Date() : null;
  }

  if (disconnecting) {
    // Disconnect is authoritative: always clear credentials, skip merge entirely.
    updateData.config = {};
  } else if (parsed.data.config !== undefined) {
    // Merge new fields into existing config — unedited credential fields
    // (returned as "***" to the client) must be preserved from the DB.
    const stored = (await db.select({ config: connectorsTable.config })
      .from(connectorsTable).where(eq(connectorsTable.type, type)))[0]?.config as Record<string, string> ?? {};
    const incoming = parsed.data.config as Record<string, string>;
    const merged: Record<string, string> = { ...stored };
    for (const [k, v] of Object.entries(incoming)) {
      // Apply the value only when the user typed something real (not the redacted placeholder)
      if (v && v !== "***") merged[k] = v;
    }
    updateData.config = merged;
  }

  const [updated] = await db.update(connectorsTable)
    .set(updateData as any)
    .where(eq(connectorsTable.type, type))
    .returning();

  res.json({ ...updated, config: redactConfig(updated!.config as Record<string, string>) });
});

export default router;
