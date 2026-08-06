import { Router, type IRouter } from "express";
import { db, echeancesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { getDefaultTenantId } from "../lib/defaultTenant";
import {
  ListEcheancesQueryParams,
  CreateEcheanceBody,
  UpdateEcheanceParams,
  UpdateEcheanceBody,
  DeleteEcheanceParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

/** Coerce a possible Date object (from Zod body coercion) to an ISO date string */
function toDateStr(v: Date | string | null | undefined): string {
  if (!v) return new Date().toISOString().slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function computeStatus(dueDate: string, currentStatus: string): string {
  if (currentStatus === "PAYEE") return "PAYEE";
  const due = new Date(dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today ? "EN_RETARD" : "A_VENIR";
}

router.get("/echeances", async (req, res): Promise<void> => {
  const parsed = ListEcheancesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  let all = await db.select().from(echeancesTable).orderBy(asc(echeancesTable.dueDate));

  // Auto-update statuses for overdue items
  all = all.map(e => ({
    ...e,
    status: computeStatus(e.dueDate, e.status),
  }));

  if (parsed.data.statut) {
    all = all.filter(e => e.status === parsed.data.statut);
  }

  res.json(all);
});

router.post("/echeances", async (req, res): Promise<void> => {
  const parsed = CreateEcheanceBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const dueDate = toDateStr(parsed.data.dueDate as unknown as Date | string);
  const tenantId = await getDefaultTenantId();

  const insertData: Record<string, unknown> = {
    tenantId,
    type: parsed.data.type,
    label: parsed.data.label,
    dueDate,
    status: "A_VENIR",
  };
  if (parsed.data.estimatedCents != null) insertData.estimatedCents = parsed.data.estimatedCents;
  if (parsed.data.notes) insertData.notes = parsed.data.notes;

  const [e] = await db.insert(echeancesTable).values(insertData as any).returning();
  res.status(201).json(e);
});

router.patch("/echeances/:id", async (req, res): Promise<void> => {
  const params = UpdateEcheanceParams.safeParse(req.params);
  const body = UpdateEcheanceBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid input" }); return; }

  const [existing] = await db.select().from(echeancesTable).where(eq(echeancesTable.id, params.data.id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

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

  const [updated] = await db.update(echeancesTable)
    .set(updateData as any)
    .where(eq(echeancesTable.id, params.data.id))
    .returning();

  res.json(updated);
});

router.delete("/echeances/:id", async (req, res): Promise<void> => {
  const parsed = DeleteEcheanceParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [existing] = await db.select().from(echeancesTable).where(eq(echeancesTable.id, parsed.data.id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  await db.delete(echeancesTable).where(eq(echeancesTable.id, parsed.data.id));
  res.status(204).send();
});

export default router;
