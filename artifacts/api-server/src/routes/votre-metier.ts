import { Router, type IRouter } from "express";
import { db, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDefaultTenantId } from "../lib/defaultTenant";

const router: IRouter = Router();

const KEY = "votre-metier.metier";
const DEFAULT_METIER = "industrie_btp";

const PatchBody = z.object({
  metier: z.string().min(1),
});

router.get("/votre-metier", async (_req, res): Promise<void> => {
  const [row] = await db.select().from(settingsTable).where(eq(settingsTable.key, KEY));
  res.json({ metier: row?.value ?? DEFAULT_METIER });
});

router.patch("/votre-metier", async (req, res): Promise<void> => {
  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { metier } = parsed.data;
  const tenantId = await getDefaultTenantId();
  await db.insert(settingsTable).values({ tenantId, key: KEY, value: metier })
    .onConflictDoUpdate({ target: [settingsTable.tenantId, settingsTable.key], set: { value: metier, updatedAt: new Date() } });

  res.json({ metier });
});

export default router;
