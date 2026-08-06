import { Router, type IRouter } from "express";
import { db, devisTable, affairesTable } from "@workspace/db";
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

const router: IRouter = Router();

function calcTotals(lines: { quantity: number; unitPriceCents: number }[], tvaRate: number, remise: number) {
  const subtotalCents = lines.reduce((acc, l) => acc + l.quantity * l.unitPriceCents, 0);
  const afterRemiseCents = Math.round(subtotalCents * (1 - remise / 100));
  const totalHTCents = afterRemiseCents;
  const totalTTCCents = Math.round(totalHTCents * (1 + tvaRate / 100));
  return { totalHTCents, totalTTCCents };
}

function nextRef(count: number) {
  const n = String(count + 1).padStart(4, "0");
  const y = new Date().getFullYear();
  return `DEV-${y}-${n}`;
}

/** Coerce a possible Date object (from Zod body coercion) to an ISO date string */
function toDateStr(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

router.get("/devis", async (req, res): Promise<void> => {
  const parsed = ListDevisQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { statut, search } = parsed.data;

  let all = await db.select().from(devisTable).orderBy(desc(devisTable.createdAt));
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
  const count = (await db.select().from(devisTable)).length;
  const { totalHTCents, totalTTCCents } = calcTotals(lines, tvaRate, remise);

  const linesWithId = lines.map(l => ({ ...l, id: crypto.randomUUID() }));
  const [created] = await db.insert(devisTable).values({
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

  res.status(201).json(created);
});

router.get("/devis/:id", async (req, res): Promise<void> => {
  const parsed = GetDevisParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [d] = await db.select().from(devisTable).where(eq(devisTable.id, parsed.data.id));
  if (!d) { res.status(404).json({ error: "Not found" }); return; }
  res.json(d);
});

router.patch("/devis/:id", async (req, res): Promise<void> => {
  const params = UpdateDevisParams.safeParse(req.params);
  const body = UpdateDevisBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const [existing] = await db.select().from(devisTable).where(eq(devisTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const lines = body.data.lines ?? existing.lines;
  const tvaRate = body.data.tvaRate ?? existing.tvaRate;
  const remise = body.data.remise ?? existing.remise;
  const { totalHTCents, totalTTCCents } = calcTotals(lines, tvaRate, remise);

  // Strip Zod-coerced Date objects back to strings and build a clean update payload
  const { validUntil: rawValidUntil, notes, clientName, status, ...rest } = body.data;
  const updatePayload: Record<string, unknown> = {
    ...rest,
    lines: lines.map(l => ({ ...l, id: (l as any).id ?? crypto.randomUUID() })),
    totalHTCents,
    totalTTCCents,
    tvaRate,
    remise,
  };
  if (clientName !== undefined) updatePayload.clientName = clientName;
  if (status !== undefined) updatePayload.status = status;
  if (notes !== undefined) updatePayload.notes = notes || null;
  if (rawValidUntil !== undefined) {
    updatePayload.validUntil = toDateStr(rawValidUntil as unknown as Date | string);
  }

  const [updated] = await db.update(devisTable).set(updatePayload as any)
    .where(eq(devisTable.id, params.data.id)).returning();

  res.json(updated);
});

router.delete("/devis/:id", async (req, res): Promise<void> => {
  const parsed = DeleteDevisParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  await db.delete(devisTable).where(eq(devisTable.id, parsed.data.id));
  res.status(204).send();
});

router.post("/devis/:id/convert", async (req, res): Promise<void> => {
  const parsed = ConvertDevisToAffaireParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [d] = await db.select().from(devisTable).where(eq(devisTable.id, parsed.data.id));
  if (!d) { res.status(404).json({ error: "Not found" }); return; }

  // Precondition: must be accepted
  if (d.status !== "ACCEPTE") {
    res.status(422).json({ error: "Seuls les devis acceptés peuvent être convertis en affaire." });
    return;
  }

  // Idempotency: if already converted, return the existing affaire
  if (d.affaireId) {
    const [existing] = await db.select().from(affairesTable).where(eq(affairesTable.id, d.affaireId));
    if (existing) { res.json(existing); return; }
  }

  const count = (await db.select().from(affairesTable)).length;
  const ref = `AFF-${new Date().getFullYear()}-${String(count + 1).padStart(4, "0")}`;

  const [affaire] = await db.insert(affairesTable).values({
    reference: ref,
    label: `Affaire ${d.clientName}`,
    clientName: d.clientName,
    status: "ACCEPTEE",
    quotedAmountCents: d.totalTTCCents,
    ...(d.notes ? { notes: d.notes } : {}),
    startDate: new Date().toISOString().slice(0, 10),
  }).returning();

  await db.update(devisTable).set({ status: "ACCEPTE", affaireId: affaire.id }).where(eq(devisTable.id, d.id));

  res.json(affaire);
});

export default router;
