import { Router, type IRouter } from "express";
import { withTenant, contratsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { toDateString, hasFinancialAccess } from "@nodaq/shared";
import {
  CreateContratBody,
  UpdateContratBody,
  UpdateContratParams,
  DeleteContratParams,
} from "@workspace/api-zod";
import { maskFinancialFields } from "../lib/maskFinancialFields.js";
import { indexerAuClasseur, nomAuClasseur } from "../lib/indexation-classeur.js";
import { messageValidation } from "../lib/message-validation.js";

function nextOccurrence(startDate: string | null, cadence: string): string | null {
  if (!startDate) return null;
  const d = new Date(startDate);
  const now = new Date();
  const cadenceMonths: Record<string, number> = {
    mensuel: 1, trimestriel: 3, semestriel: 6, annuel: 12,
  };
  const months = cadenceMonths[cadence] ?? 1;
  while (d <= now) { d.setMonth(d.getMonth() + months); }
  return toDateString(d);
}

const router: IRouter = Router();

router.get("/contrats", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const financier = hasFinancialAccess(req.session?.role);
  const contrats = await withTenant(tenantId, async (tx) =>
    tx.select().from(contratsTable).orderBy(desc(contratsTable.createdAt))
  );
  res.json(contrats.map(c => maskFinancialFields(
    { ...c, nextOccurrenceDate: nextOccurrence(c.startDate, c.cadence) },
    ["amountCents"],
    financier,
  )));
});

router.post("/contrats", async (req, res): Promise<void> => {
  const parsed = CreateContratBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
  const data = parsed.data;
  const toStr = (v: unknown) => v instanceof Date ? toDateString(v) : (v as string | null | undefined) ?? null;
  const tenantId = req.tenantId!;

  const [contrat] = await withTenant(tenantId, async (tx) => {
    const [c] = await tx.insert(contratsTable).values({
      tenantId,
      label: data.label,
      clientName: data.clientName ?? null,
      cadence: data.cadence ?? "mensuel",
      amountCents: data.amountCents ?? null,
      startDate: toStr(data.startDate),
      endDate: toStr(data.endDate),
      notes: data.notes ?? null,
      status: "ACTIF",
    }).returning();
    await indexerAuClasseur(tx, {
      tenantId, sourceType: "CONTRAT", sourceId: c!.id,
      nom: nomAuClasseur("CONTRAT", c!.label, c!.id),
    });
    return [c];
  });

  res.status(201).json({ ...contrat, nextOccurrenceDate: nextOccurrence(contrat!.startDate, contrat!.cadence) });
});

router.patch("/contrats/:id", async (req, res): Promise<void> => {
  const params = UpdateContratParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: messageValidation(params.error) }); return; }
  const parsed = UpdateContratBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
  const data = parsed.data;
  const updateData: Record<string, unknown> = {};
  if (data.label !== undefined) updateData.label = data.label;
  if (data.clientName !== undefined) updateData.clientName = data.clientName;
  if (data.cadence !== undefined) updateData.cadence = data.cadence;
  if (data.amountCents !== undefined) updateData.amountCents = data.amountCents;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.startDate !== undefined) updateData.startDate = data.startDate;
  if (data.endDate !== undefined) updateData.endDate = data.endDate;
  if (data.notes !== undefined) updateData.notes = data.notes;

  const tenantId = req.tenantId!;
  const [contrat] = await withTenant(tenantId, async (tx) =>
    tx.update(contratsTable).set(updateData).where(eq(contratsTable.id, params.data.id)).returning()
  );
  if (!contrat) { res.status(404).json({ error: "Contrat not found" }); return; }
  res.json({ ...contrat, nextOccurrenceDate: nextOccurrence(contrat.startDate, contrat.cadence) });
});

router.delete("/contrats/:id", async (req, res): Promise<void> => {
  const params = DeleteContratParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: messageValidation(params.error) }); return; }
  const tenantId = req.tenantId!;
  const [deleted] = await withTenant(tenantId, async (tx) =>
    tx.delete(contratsTable).where(eq(contratsTable.id, params.data.id)).returning()
  );
  if (!deleted) { res.status(404).json({ error: "Contrat not found" }); return; }
  res.sendStatus(204);
});

export default router;
