import { Router, type IRouter } from "express";
import { withTenant, echeancesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { toDateString } from "@nodaq/shared";
import {
  ListEcheancesQueryParams,
  CreateEcheanceBody,
  UpdateEcheanceParams,
  UpdateEcheanceBody,
  DeleteEcheanceParams,
} from "@workspace/api-zod";
import { messageValidation } from "../lib/message-validation.js";

const router: IRouter = Router();

function toDateStr(v: Date | string | null | undefined): string {
  if (!v) return toDateString(new Date());
  if (v instanceof Date) return toDateString(v);
  return String(v);
}

/** Exportée pour le prévisionnel de trésorerie (routes/previsionnel-tresorerie.ts) — une seule définition d'À_VENIR/EN_RETARD, jamais dupliquée. */
export function computeEcheanceStatus(dueDate: string, currentStatus: string): string {
  if (currentStatus === "PAYEE") return "PAYEE";
  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today ? "EN_RETARD" : "A_VENIR";
}

router.get("/echeances", async (req, res): Promise<void> => {
  const parsed = ListEcheancesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
  const tenantId = req.tenantId!;

  let all = await withTenant(tenantId, async (tx) =>
    tx.select().from(echeancesTable).orderBy(asc(echeancesTable.dueDate))
  );
  all = all.map(e => ({ ...e, status: computeEcheanceStatus(e.dueDate, e.status) }));
  if (parsed.data.statut) all = all.filter(e => e.status === parsed.data.statut);

  res.json(all);
});

router.post("/echeances", async (req, res): Promise<void> => {
  const parsed = CreateEcheanceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
  const dueDate = toDateStr(parsed.data.dueDate as unknown as Date | string);
  const tenantId = req.tenantId!;

  const insertData: Record<string, unknown> = {
    tenantId,
    type: parsed.data.type,
    label: parsed.data.label,
    dueDate,
    status: "A_VENIR",
  };
  if (parsed.data.estimatedCents != null) insertData.estimatedCents = parsed.data.estimatedCents;
  if (parsed.data.notes) insertData.notes = parsed.data.notes;

  const [e] = await withTenant(tenantId, async (tx) =>
    tx.insert(echeancesTable).values(insertData as any).returning()
  );
  res.status(201).json(e);
});

router.patch("/echeances/:id", async (req, res): Promise<void> => {
  const params = UpdateEcheanceParams.safeParse(req.params);
  const body = UpdateEcheanceBody.safeParse(req.body);
  // Deux gardes distinctes, et non un ternaire : `params.success ? …` ne
  // restreint pas le type de `body`, si bien que `body.error` restait
  // possiblement indéfini et le compilateur refusait. Séparées, elles disent
  // en plus À L'UTILISATEUR laquelle des deux parties ne va pas.
  if (!params.success) { res.status(400).json({ error: messageValidation(params.error) }); return; }
  if (!body.success) { res.status(400).json({ error: messageValidation(body.error) }); return; }

  const [existing] = await withTenant(req.tenantId!, async (tx) =>
    tx.select().from(echeancesTable).where(eq(echeancesTable.id, params.data.id))
  );
  if (!existing) { res.status(404).json({ error: "Échéance introuvable." }); return; }

  const updateData: Record<string, unknown> = {};
  if (body.data.label !== undefined) updateData.label = body.data.label;
  if (body.data.dueDate !== undefined) updateData.dueDate = toDateStr(body.data.dueDate as unknown as Date | string);
  if (body.data.estimatedCents !== undefined) updateData.estimatedCents = body.data.estimatedCents;
  if (body.data.paidCents !== undefined) updateData.paidCents = body.data.paidCents;
  if (body.data.notes !== undefined) updateData.notes = body.data.notes || null;
  if (body.data.status !== undefined) {
    updateData.status = body.data.status;
    if (body.data.status === "PAYEE" && existing.status !== "PAYEE") {
      updateData.paidAt = new Date();
    }
  }

  const tenantId = req.tenantId!;
  const [updated] = await withTenant(tenantId, async (tx) =>
    tx.update(echeancesTable).set(updateData as any).where(eq(echeancesTable.id, params.data.id)).returning()
  );
  res.json(updated);
});

router.delete("/echeances/:id", async (req, res): Promise<void> => {
  const parsed = DeleteEcheanceParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
  const tenantId = req.tenantId!;

  const [existing] = await withTenant(tenantId, async (tx) =>
    tx.select().from(echeancesTable).where(eq(echeancesTable.id, parsed.data.id))
  );
  if (!existing) { res.status(404).json({ error: "Échéance introuvable." }); return; }

  await withTenant(tenantId, async (tx) =>
    tx.delete(echeancesTable).where(eq(echeancesTable.id, parsed.data.id))
  );
  res.status(204).send();
});

export default router;
