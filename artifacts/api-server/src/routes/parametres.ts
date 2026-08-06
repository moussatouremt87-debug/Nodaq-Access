import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

const DEFAULTS: Record<string, string> = {
  "metier.raisonSociale": "",
  "metier.siret": "",
  "metier.secteur": "",
  "notif.nouvelleFact": "true",
  "notif.actionAvalider": "true",
  "notif.prospectQualifie": "false",
  "notif.echeanceFiscale": "true",
  "modules.classeur": "true",
  "modules.marge": "true",
  "modules.rapport": "true",
};

const SetSettingsBody = z.record(z.string(), z.string());

async function ensureDefaults() {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    await db.insert(settingsTable).values({ key, value })
      .onConflictDoNothing();
  }
}

router.get("/parametres", async (_req, res): Promise<void> => {
  await ensureDefaults();
  const rows = await db.select().from(settingsTable);
  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  // merge with defaults for any missing keys
  res.json({ ...DEFAULTS, ...settings });
});

router.patch("/parametres", async (req, res): Promise<void> => {
  const parsed = SetSettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  for (const [key, value] of Object.entries(parsed.data)) {
    await db.insert(settingsTable).values({ key, value })
      .onConflictDoUpdate({ target: settingsTable.key, set: { value, updatedAt: new Date() } });
  }

  const keys = Object.keys(parsed.data);
  const updated = await db.select().from(settingsTable).where(inArray(settingsTable.key, keys));
  const result = Object.fromEntries(updated.map(r => [r.key, r.value]));
  res.json(result);
});

export default router;
