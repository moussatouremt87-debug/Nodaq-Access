import { Router, type IRouter } from "express";
import { withTenant, classeurTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  ListClasseurQueryParams,
  CreateClasseurDocumentBody,
  DeleteClasseurDocumentParams,
} from "@workspace/api-zod";
import { getDefaultTenantId } from "../lib/defaultTenant";

const router: IRouter = Router();

router.get("/classeur", async (req, res): Promise<void> => {
  const parsed = ListClasseurQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { category, search } = parsed.data;
  const tenantId = await getDefaultTenantId();

  let all = await withTenant(tenantId, async (tx) =>
    tx.select().from(classeurTable).orderBy(desc(classeurTable.createdAt))
  );
  if (category) all = all.filter(d => d.category === category);
  if (search) {
    const q = search.toLowerCase();
    all = all.filter(d => d.name.toLowerCase().includes(q));
  }

  res.json({ documents: all, total: all.length });
});

router.post("/classeur", async (req, res): Promise<void> => {
  const parsed = CreateClasseurDocumentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = await getDefaultTenantId();

  const [doc] = await withTenant(tenantId, async (tx) =>
    tx.insert(classeurTable).values({
      tenantId,
      name: parsed.data.name,
      category: parsed.data.category,
      size: parsed.data.size ?? null,
      mimeType: parsed.data.mimeType ?? null,
      notes: parsed.data.notes ?? null,
      affaireId: parsed.data.affaireId ?? null,
    }).returning()
  );

  res.status(201).json(doc);
});

router.delete("/classeur/:id", async (req, res): Promise<void> => {
  const parsed = DeleteClasseurDocumentParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = await getDefaultTenantId();

  const [existing] = await withTenant(tenantId, async (tx) =>
    tx.select().from(classeurTable).where(eq(classeurTable.id, parsed.data.id))
  );
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  await withTenant(tenantId, async (tx) =>
    tx.delete(classeurTable).where(eq(classeurTable.id, parsed.data.id))
  );
  res.status(204).send();
});

export default router;
