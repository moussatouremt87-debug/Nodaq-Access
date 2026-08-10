import { Router, type IRouter } from "express";
import { withTenant, settingsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import { verifierReglagesObjectifs } from "@nodaq/shared";

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

router.get("/parametres", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;

  const rows = await withTenant(tenantId, async (tx) => {
    // Ensure defaults exist for this tenant
    for (const [key, value] of Object.entries(DEFAULTS)) {
      await tx.insert(settingsTable).values({ tenantId, key, value }).onConflictDoNothing();
    }
    return tx.select().from(settingsTable);
  });

  const settings = Object.fromEntries(rows.map(r => [r.key, r.value]));
  res.json({ ...DEFAULTS, ...settings });
});

router.patch("/parametres", async (req, res): Promise<void> => {
  const parsed = SetSettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // ── Bornes des réglages d'objectif ──────────────────────────────────────
  //
  // C'est LA ROUTE qui refuse, pas l'écran. Le formulaire convertissait déjà
  // correctement ; rien ne protégeait une valeur arrivant autrement — reprise
  // de données, support, ou couche vocale. Un taux de 35 points de base au
  // lieu de 3500 produisait un seuil de rentabilité vingt fois trop grand,
  // affiché sans le moindre avertissement.
  const refus = verifierReglagesObjectifs(parsed.data);
  if (refus.length > 0) {
    res.status(400).json({ error: refus.map((r) => r.message).join(" "), refus });
    return;
  }

  const tenantId = req.tenantId!;

  const updated = await withTenant(tenantId, async (tx) => {
    for (const [key, value] of Object.entries(parsed.data)) {
      await tx.insert(settingsTable).values({ tenantId, key, value })
        .onConflictDoUpdate({ target: [settingsTable.tenantId, settingsTable.key], set: { value, updatedAt: new Date() } });
    }
    const keys = Object.keys(parsed.data);
    return tx.select().from(settingsTable).where(inArray(settingsTable.key, keys));
  });

  res.json(Object.fromEntries(updated.map(r => [r.key, r.value])));
});

export default router;
