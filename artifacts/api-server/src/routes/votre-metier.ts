import { Router, type IRouter } from "express";
import { withTenant, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { VERTICALS } from "@nodaq/shared";
import { VERTICAL_SETTING_KEY, DEFAULT_VERTICAL } from "../lib/vertical-tenant.js";

const router: IRouter = Router();

const KEY = VERTICAL_SETTING_KEY;
// Le produit est né BTP : un tenant qui n'a jamais répondu (créé avant
// US-A1.1, ou onboarding pas encore arrivé à l'écran secteur) garde le
// vocabulaire BTP historique plutôt que de basculer silencieusement en
// vocabulaire neutre — ce serait une régression visible pour toute la base
// existante, pas une neutralité prudente.
const DEFAULT_METIER = DEFAULT_VERTICAL;

// US-A1.1 : la valeur doit être un vertical connu de verticalPacks.ts, pas
// n'importe quelle chaîne — la garde vit ici (frontière API), pas en base
// (voir la note d'architecture dans verticalPacks.ts sur `tenant_profiles`).
const PatchBody = z.object({
  metier: z.enum(VERTICALS),
});

router.get("/votre-metier", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const [row] = await withTenant(tenantId, async (tx) =>
    tx.select().from(settingsTable).where(eq(settingsTable.key, KEY))
  );
  res.json({ metier: row?.value ?? DEFAULT_METIER });
});

router.patch("/votre-metier", async (req, res): Promise<void> => {
  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { metier } = parsed.data;
  const tenantId = req.tenantId!;

  await withTenant(tenantId, async (tx) =>
    tx.insert(settingsTable).values({ tenantId, key: KEY, value: metier })
      .onConflictDoUpdate({ target: [settingsTable.tenantId, settingsTable.key], set: { value: metier, updatedAt: new Date() } })
  );

  res.json({ metier });
});

export default router;
