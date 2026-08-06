import { Router, type IRouter } from "express";
import { db, prospectsTable, activityTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { getDefaultTenantId } from "../lib/defaultTenant";
import {
  CreateProspectBody,
  UpdateProspectBody,
  UpdateProspectParams,
  DeleteProspectParams,
  ListProspectsQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/prospects", async (req, res): Promise<void> => {
  const parsed = ListProspectsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { stage } = parsed.data;

  let query = db.select().from(prospectsTable).$dynamic();
  if (stage) {
    query = query.where(eq(prospectsTable.stage, stage));
  }
  query = query.orderBy(desc(prospectsTable.createdAt));

  const prospects = await query;
  res.json(prospects);
});

router.post("/prospects", async (req, res): Promise<void> => {
  const parsed = CreateProspectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const tenantId = await getDefaultTenantId();
  const [prospect] = await db.insert(prospectsTable).values({
    tenantId,
    name: data.name,
    companyName: data.companyName ?? null,
    phone: data.phone ?? null,
    email: data.email ?? null,
    stage: data.stage ?? "NOUVEAU",
    source: data.source ?? "AUTRE",
    estimatedValueCents: data.estimatedValueCents ?? null,
    notes: data.notes ?? null,
  }).returning();

  await db.insert(activityTable).values({
    tenantId,
    type: "prospect_added",
    label: `Nouveau prospect : ${prospect!.name}`,
    meta: prospect!.companyName ?? null,
  });

  res.status(201).json(prospect);
});

router.patch("/prospects/:id", async (req, res): Promise<void> => {
  const params = UpdateProspectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateProspectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.companyName !== undefined) updateData.companyName = data.companyName;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.stage !== undefined) updateData.stage = data.stage;
  if (data.source !== undefined) updateData.source = data.source;
  if (data.estimatedValueCents !== undefined) updateData.estimatedValueCents = data.estimatedValueCents;
  if (data.notes !== undefined) updateData.notes = data.notes;

  const [prospect] = await db.update(prospectsTable).set(updateData).where(eq(prospectsTable.id, params.data.id)).returning();
  if (!prospect) {
    res.status(404).json({ error: "Prospect not found" });
    return;
  }
  res.json(prospect);
});

router.delete("/prospects/:id", async (req, res): Promise<void> => {
  const params = DeleteProspectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(prospectsTable).where(eq(prospectsTable.id, params.data.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Prospect not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
