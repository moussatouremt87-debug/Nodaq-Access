import { Router, type IRouter } from "express";
import { withTenant, facturesTable, activityTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  CreateFactureBody,
  UpdateFactureBody,
  UpdateFactureParams,
  ListFacturesQueryParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/factures", async (req, res): Promise<void> => {
  const parsed = ListFacturesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { settled } = parsed.data;
  const tenantId = req.tenantId!;

  const factures = await withTenant(tenantId, async (tx) => {
    let query = tx.select().from(facturesTable).$dynamic();
    if (settled !== undefined) query = query.where(eq(facturesTable.settled, settled));
    return query.orderBy(desc(facturesTable.createdAt));
  });

  const totalAmountCents = factures.reduce((acc, f) => acc + (f.amountCents ?? 0), 0);
  const totalOverdueCents = factures
    .filter(f => !f.settled && new Date(f.dueDate) < new Date())
    .reduce((acc, f) => acc + (f.residualCents ?? f.amountCents ?? 0), 0);

  res.json({ factures, totalAmountCents, totalOverdueCents });
});

router.post("/factures", async (req, res): Promise<void> => {
  const parsed = CreateFactureBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const data = parsed.data;
  const toStr = (v: unknown) => v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '');
  const tenantId = req.tenantId!;

  const [facture] = await withTenant(tenantId, async (tx) =>
    tx.insert(facturesTable).values({
      tenantId,
      customerName: data.customerName,
      number: data.number,
      issuedDate: toStr(data.issuedDate),
      dueDate: toStr(data.dueDate),
      amountCents: data.amountCents,
      residualCents: data.amountCents,
      settled: false,
      affaireId: data.affaireId ?? null,
    }).returning()
  );

  res.status(201).json(facture);
});

router.patch("/factures/:id", async (req, res): Promise<void> => {
  const params = UpdateFactureParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const parsed = UpdateFactureBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const data = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (data.settled !== undefined) updateData.settled = data.settled;
  if (data.residualCents !== undefined) updateData.residualCents = data.residualCents;
  if (data.affaireId !== undefined) updateData.affaireId = data.affaireId;
  const tenantId = req.tenantId!;

  const facture = await withTenant(tenantId, async (tx) => {
    const [facture] = await tx.update(facturesTable).set(updateData).where(eq(facturesTable.id, params.data.id)).returning();
    if (!facture) return null;
    if (data.settled) {
      await tx.insert(activityTable).values({
        tenantId,
        type: "facture_paid",
        label: `Facture réglée : ${facture.number}`,
        meta: facture.customerName,
      });
    }
    return facture;
  });

  if (!facture) { res.status(404).json({ error: "Facture not found" }); return; }
  res.json(facture);
});

export default router;
