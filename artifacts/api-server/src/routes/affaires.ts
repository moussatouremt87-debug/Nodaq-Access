import { Router, type IRouter } from "express";
import { withTenant, affairesTable, activityTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import {
  CreateAffaireBody,
  UpdateAffaireBody,
  GetAffaireParams,
  UpdateAffaireParams,
  DeleteAffaireParams,
  ListAffairesQueryParams,
} from "@workspace/api-zod";
import { getDefaultTenantId } from "../lib/defaultTenant";

const router: IRouter = Router();

router.get("/affaires/stats", async (_req, res): Promise<void> => {
  const tenantId = await getDefaultTenantId();
  const { byStatus } = await withTenant(tenantId, async (tx) => {
    const rows = await tx.execute(sql`
      SELECT
        status,
        count(*)::int as count,
        coalesce(sum(quoted_amount_cents), 0)::int as "totalCents"
      FROM affaires
      GROUP BY status
      ORDER BY status
    `);
    return { byStatus: rows.rows as Array<{ status: string; count: number; totalCents: number }> };
  });

  const totalPipelineValueCents = byStatus
    .filter(r => !["PERDUE", "ARCHIVEE"].includes(r.status))
    .reduce((acc, r) => acc + (r.totalCents ?? 0), 0);

  res.json({ byStatus, totalPipelineValueCents });
});

router.get("/affaires", async (req, res): Promise<void> => {
  const parsed = ListAffairesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { statut, inclureArchivees } = parsed.data;

  const tenantId = await getDefaultTenantId();
  const { affaires } = await withTenant(tenantId, async (tx) => {
    let query = tx.select().from(affairesTable).$dynamic();
    if (statut) {
      query = query.where(eq(affairesTable.status, statut));
    } else if (!inclureArchivees) {
      query = query.where(sql`status != 'ARCHIVEE'`);
    }
    query = query.orderBy(desc(affairesTable.createdAt));
    return { affaires: await query };
  });

  const totalQuotedCents = affaires.reduce((acc, a) => acc + (a.quotedAmountCents ?? 0), 0);
  res.json({ affaires, total: affaires.length, totalQuotedCents });
});

router.post("/affaires", async (req, res): Promise<void> => {
  const parsed = CreateAffaireBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const data = parsed.data;
  const tenantId = await getDefaultTenantId();
  const refNum = String(Date.now()).slice(-6);
  const rawStart = data.startDate as unknown as Date | string | undefined;
  const startDate = rawStart instanceof Date ? rawStart.toISOString().slice(0, 10) : (rawStart ?? null);

  const affaire = await withTenant(tenantId, async (tx) => {
    const [affaire] = await tx.insert(affairesTable).values({
      tenantId,
      label: data.label,
      clientName: data.clientName ?? null,
      status: data.status ?? "PROSPECT",
      quotedAmountCents: data.quotedAmountCents ?? null,
      notes: data.notes ?? null,
      startDate,
      reference: `AFF-${refNum}`,
    }).returning();
    await tx.insert(activityTable).values({
      tenantId,
      type: "affaire_created",
      label: `Nouvelle affaire : ${affaire!.label}`,
      meta: affaire!.clientName ?? null,
    });
    return affaire;
  });

  res.status(201).json(affaire);
});

router.get("/affaires/:id", async (req, res): Promise<void> => {
  const params = GetAffaireParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const tenantId = await getDefaultTenantId();
  const [affaire] = await withTenant(tenantId, async (tx) =>
    tx.select().from(affairesTable).where(eq(affairesTable.id, params.data.id))
  );
  if (!affaire) { res.status(404).json({ error: "Affaire not found" }); return; }
  res.json(affaire);
});

router.patch("/affaires/:id", async (req, res): Promise<void> => {
  const params = UpdateAffaireParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateAffaireBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const data = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (data.label !== undefined) updateData.label = data.label;
  if (data.clientName !== undefined) updateData.clientName = data.clientName;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.quotedAmountCents !== undefined) updateData.quotedAmountCents = data.quotedAmountCents;
  if (data.invoicedAmountCents !== undefined) updateData.invoicedAmountCents = data.invoicedAmountCents;
  if (data.marginCents !== undefined) updateData.marginCents = data.marginCents;
  if (data.notes !== undefined) updateData.notes = data.notes;
  if (data.startDate !== undefined) updateData.startDate = data.startDate;
  if (data.completedAt !== undefined) updateData.completedAt = data.completedAt;

  const tenantId = await getDefaultTenantId();
  const [affaire] = await withTenant(tenantId, async (tx) =>
    tx.update(affairesTable).set(updateData).where(eq(affairesTable.id, params.data.id)).returning()
  );
  if (!affaire) { res.status(404).json({ error: "Affaire not found" }); return; }
  res.json(affaire);
});

router.delete("/affaires/:id", async (req, res): Promise<void> => {
  const params = DeleteAffaireParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const tenantId = await getDefaultTenantId();
  const [deleted] = await withTenant(tenantId, async (tx) =>
    tx.delete(affairesTable).where(eq(affairesTable.id, params.data.id)).returning()
  );
  if (!deleted) { res.status(404).json({ error: "Affaire not found" }); return; }
  res.sendStatus(204);
});

export default router;
