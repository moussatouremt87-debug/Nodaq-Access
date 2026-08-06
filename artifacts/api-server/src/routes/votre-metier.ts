import { Router, type IRouter } from "express";
import { withTenant, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const router: IRouter = Router();

const KEY = "votre-metier.metier";
const DEFAULT_METIER = "industrie_btp";

const PatchBody = z.object({
  metier: z.string().min(1),
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
