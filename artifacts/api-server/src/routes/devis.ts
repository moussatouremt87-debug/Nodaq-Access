import { Router, type IRouter } from "express";
import { withTenant, devisTable, affairesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  ListDevisQueryParams,
  CreateDevisBody,
  GetDevisParams,
  UpdateDevisParams,
  UpdateDevisBody,
  DeleteDevisParams,
  ConvertDevisToAffaireParams,
} from "@workspace/api-zod";
import { getDefaultTenantId } from "../lib/defaultTenant";

const router: IRouter = Router();

function calcTotals(lines: { quantity: number; unitPriceCents: number }[], tvaRate: number, remise: number) {
  const subtotalCents = lines.reduce((acc, l) => acc + l.quantity * l.unitPriceCents, 0);
  const afterRemiseCents = Math.round(subtotalCents * (1 - remise / 100));
  const totalHTCents = afterRemiseCents;
  const totalTTCCents = Math.round(totalHTCents * (1 + tvaRate / 100));
  return { totalHTCents, totalTTCCents };
}

function nextRef(count: number) {
  return `DEV-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
}

function toDateStr(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

router.get("/devis", async (req, res): Promise<void> => {
  const parsed = ListDevisQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { statut, search } = parsed.data;
  const tenantId = await getDefaultTenantId();

  let all = await withTenant(tenantId, async (tx) =>
    tx.select().from(devisTable).orderBy(desc(devisTable.createdAt))
  );
  if (statut) all = all.filter(d => d.status === statut);
  if (search) {
    const q = search.toLowerCase();
    all = all.filter(d => d.clientName.toLowerCase().includes(q) || d.reference.toLowerCase().includes(q));
  }

  const totalTTCCents = all.reduce((acc, d) => acc + d.totalTTCCents, 0);
  res.json({ devis: all, total: all.length, totalTTCCents });
});

router.post("/devis", async (req, res): Promise<void> => {
  const parsed = CreateDevisBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { clientName, lines = [], tvaRate = 20, remise = 0, notes, validUntil } = parsed.data;
  const { totalHTCents, totalTTCCents } = calcTotals(lines, tvaRate, remise);
  const linesWithId = lines.map(l => ({ ...l, id: crypto.randomUUID() }));
  const tenantId = await getDefaultTenantId();

  const created = await withTenant(tenantId, async (tx) => {
    const count = (await tx.select().from(devisTable)).length;
    const [created] = await tx.insert(devisTable).values({
      tenantId,
      reference: nextRef(count),
      clientName,
      status: parsed.data.status ?? "BROUILLON",
      lines: linesWithId,
      totalHTCents,
      totalTTCCents,
      tvaRate,
      remise,
      ...(notes ? { notes } : {}),
      ...(validUntil ? { validUntil: toDateStr(validUntil as unknown as Date | string) } : {}),
    }).returning();
    return created;
  });

  res.status(201).json(created);
});

router.get("/devis/:id", async (req, res): Promise<void> => {
  const parsed = GetDevisParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = await getDefaultTenantId();
  const [d] = await withTenant(tenantId, async (tx) =>
    tx.select().from(devisTable).where(eq(devisTable.id, parsed.data.id))
  );
  if (!d) { res.status(404).json({ error: "Not found" }); return; }
  res.json(d);
});

router.patch("/devis/:id", async (req, res): Promise<void> => {
  const params = UpdateDevisParams.safeParse(req.params);
  const body = UpdateDevisBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const tenantId = await getDefaultTenantId();

  const updated = await withTenant(tenantId, async (tx) => {
    const [existing] = await tx.select().from(devisTable).where(eq(devisTable.id, params.data.id));
    if (!existing) return null;
    const lines = body.data.lines ?? existing.lines;
    const tvaRate = body.data.tvaRate ?? existing.tvaRate;
    const remise  = body.data.remise  ?? existing.remise;
    const { totalHTCents, totalTTCCents } = calcTotals(lines, tvaRate, remise);
    const { validUntil: rawValidUntil, notes, clientName, status, ...rest } = body.data;
    const updatePayload: Record<string, unknown> = {
      ...rest,
      lines: lines.map(l => ({ ...l, id: (l as any).id ?? crypto.randomUUID() })),
      totalHTCents, totalTTCCents, tvaRate, remise,
    };
    if (clientName !== undefined) updatePayload.clientName = clientName;
    if (status !== undefined) updatePayload.status = status;
    if (notes !== undefined) updatePayload.notes = notes || null;
    if (rawValidUntil !== undefined) updatePayload.validUntil = toDateStr(rawValidUntil as unknown as Date | string);
    const [updated] = await tx.update(devisTable).set(updatePayload as any).where(eq(devisTable.id, params.data.id)).returning();
    return updated;
  });

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(updated);
});

router.delete("/devis/:id", async (req, res): Promise<void> => {
  const parsed = DeleteDevisParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = await getDefaultTenantId();
  await withTenant(tenantId, async (tx) =>
    tx.delete(devisTable).where(eq(devisTable.id, parsed.data.id))
  );
  res.status(204).send();
});

router.post("/devis/:id/convert", async (req, res): Promise<void> => {
  const parsed = ConvertDevisToAffaireParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenantId = await getDefaultTenantId();

  const result = await withTenant(tenantId, async (tx) => {
    const [d] = await tx.select().from(devisTable).where(eq(devisTable.id, parsed.data.id));
    if (!d) return { error: "Not found", status: 404 };
    if (d.status !== "ACCEPTE") return { error: "Seuls les devis acceptés peuvent être convertis en affaire.", status: 422 };

    if (d.affaireId) {
      const [existing] = await tx.select().from(affairesTable).where(eq(affairesTable.id, d.affaireId));
      if (existing) return { affaire: existing };
    }

    const count = (await tx.select().from(affairesTable)).length;
    const ref = `AFF-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;
    const [affaire] = await tx.insert(affairesTable).values({
      tenantId,
      reference: ref,
      label: `Affaire ${d.clientName}`,
      clientName: d.clientName,
      status: "ACCEPTEE",
      quotedAmountCents: d.totalTTCCents,
      ...(d.notes ? { notes: d.notes } : {}),
      startDate: new Date().toISOString().slice(0, 10),
    }).returning();
    await tx.update(devisTable).set({ status: "ACCEPTE", affaireId: affaire!.id }).where(eq(devisTable.id, d.id));
    return { affaire };
  });

  if ("error" in result) { res.status(result.status ?? 422).json({ error: result.error }); return; }
  res.json(result.affaire);
});

export default router;
