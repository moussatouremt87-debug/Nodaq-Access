import { Router, type IRouter } from "express";
import { db, facturesTable, activityTable } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { getDefaultTenantId } from "../lib/defaultTenant";
import {
  CreateFactureBody,
  UpdateFactureBody,
  UpdateFactureParams,
  ListFacturesQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/factures", async (req, res): Promise<void> => {
  const parsed = ListFacturesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { settled } = parsed.data;

  let query = db.select().from(facturesTable).$dynamic();
  if (settled !== undefined) {
    query = query.where(eq(facturesTable.settled, settled));
  }
  query = query.orderBy(desc(facturesTable.createdAt));

  const factures = await query;
  const totalAmountCents = factures.reduce((acc, f) => acc + (f.amountCents ?? 0), 0);
  const totalOverdueCents = factures
    .filter(f => !f.settled && new Date(f.dueDate) < new Date())
    .reduce((acc, f) => acc + (f.residualCents ?? f.amountCents ?? 0), 0);

  res.json({ factures, totalAmountCents, totalOverdueCents });
});

router.post("/factures", async (req, res): Promise<void> => {
  const parsed = CreateFactureBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const toStr = (v: unknown) => v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '');
  const tenantId = await getDefaultTenantId();
  const [facture] = await db.insert(facturesTable).values({
    tenantId,
    customerName: data.customerName,
    number: data.number,
    issuedDate: toStr(data.issuedDate),
    dueDate: toStr(data.dueDate),
    amountCents: data.amountCents,
    residualCents: data.amountCents,
    settled: false,
    affaireId: data.affaireId ?? null,
  }).returning();

  res.status(201).json(facture);
});

router.patch("/factures/:id", async (req, res): Promise<void> => {
  const params = UpdateFactureParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateFactureBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (data.settled !== undefined) updateData.settled = data.settled;
  if (data.residualCents !== undefined) updateData.residualCents = data.residualCents;
  if (data.affaireId !== undefined) updateData.affaireId = data.affaireId;

  const [facture] = await db.update(facturesTable).set(updateData).where(eq(facturesTable.id, params.data.id)).returning();
  if (!facture) {
    res.status(404).json({ error: "Facture not found" });
    return;
  }

  if (data.settled) {
    const tenantId = await getDefaultTenantId();
    await db.insert(activityTable).values({
      tenantId,
      type: "facture_paid",
      label: `Facture réglée : ${facture.number}`,
      meta: facture.customerName,
    });
  }

  res.json(facture);
});

export default router;
