import { Router, type IRouter } from "express";
import { withTenant, chargesRecurrentesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { toDateString } from "@nodaq/shared";
import {
  ListChargesRecurrentesQueryParams,
  CreateChargeRecurrenteBody,
  UpdateChargeRecurrenteParams,
  UpdateChargeRecurrenteBody,
  DeleteChargeRecurrenteParams,
} from "@workspace/api-zod";
import { messageValidation } from "../lib/message-validation.js";

const router: IRouter = Router();

function toDateStr(v: Date | string | null | undefined): string | undefined {
  if (!v) return undefined;
  if (v instanceof Date) return toDateString(v);
  return String(v);
}

router.get("/charges-recurrentes", async (req, res): Promise<void> => {
  const parsed = ListChargesRecurrentesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
  const tenantId = req.tenantId!;

  let all = await withTenant(tenantId, async (tx) =>
    tx.select().from(chargesRecurrentesTable).orderBy(asc(chargesRecurrentesTable.startDate))
  );
  // `zod.coerce.boolean()` appelle `Boolean(valeur)` : la CHAÎNE "false" est
  // non vide, donc coercée à `true` — piège connu de Zod, jamais déclenché
  // ailleurs dans ce dépôt (le seul autre filtre booléen n'est jamais envoyé
  // à `false` explicitement). On relit la query string BRUTE plutôt que de
  // faire confiance à `parsed.data.active`.
  if (typeof req.query.active === "string") {
    const veutActives = req.query.active === "true";
    all = all.filter(c => c.active === veutActives);
  }

  res.json(all);
});

router.post("/charges-recurrentes", async (req, res): Promise<void> => {
  const parsed = CreateChargeRecurrenteBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
  const tenantId = req.tenantId!;

  const insertData: Record<string, unknown> = {
    tenantId,
    label: parsed.data.label,
    category: parsed.data.category,
    cadence: parsed.data.cadence,
    startDate: toDateStr(parsed.data.startDate as unknown as Date | string),
    amountCents: parsed.data.amountCents,
  };
  if (parsed.data.endDate != null) insertData.endDate = toDateStr(parsed.data.endDate as unknown as Date | string);
  if (parsed.data.active !== undefined) insertData.active = parsed.data.active;
  if (parsed.data.notes) insertData.notes = parsed.data.notes;

  const [c] = await withTenant(tenantId, async (tx) =>
    tx.insert(chargesRecurrentesTable).values(insertData as any).returning()
  );
  res.status(201).json(c);
});

router.patch("/charges-recurrentes/:id", async (req, res): Promise<void> => {
  const params = UpdateChargeRecurrenteParams.safeParse(req.params);
  const body = UpdateChargeRecurrenteBody.safeParse(req.body);
  if (!params.success || !body.success) { res.status(400).json({ error: "Invalid input" }); return; }
  const tenantId = req.tenantId!;

  const [existing] = await withTenant(tenantId, async (tx) =>
    tx.select().from(chargesRecurrentesTable).where(eq(chargesRecurrentesTable.id, params.data.id))
  );
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  const updateData: Record<string, unknown> = {};
  if (body.data.label !== undefined) updateData.label = body.data.label;
  if (body.data.category !== undefined) updateData.category = body.data.category;
  if (body.data.cadence !== undefined) updateData.cadence = body.data.cadence;
  if (body.data.startDate !== undefined) updateData.startDate = toDateStr(body.data.startDate as unknown as Date | string);
  if (body.data.endDate !== undefined) updateData.endDate = toDateStr(body.data.endDate as unknown as Date | string) ?? null;
  if (body.data.amountCents !== undefined) updateData.amountCents = body.data.amountCents;
  if (body.data.active !== undefined) updateData.active = body.data.active;
  if (body.data.notes !== undefined) updateData.notes = body.data.notes || null;

  const [updated] = await withTenant(tenantId, async (tx) =>
    tx.update(chargesRecurrentesTable).set(updateData as any).where(eq(chargesRecurrentesTable.id, params.data.id)).returning()
  );
  res.json(updated);
});

router.delete("/charges-recurrentes/:id", async (req, res): Promise<void> => {
  const parsed = DeleteChargeRecurrenteParams.safeParse(req.params);
  if (!parsed.success) { res.status(400).json({ error: messageValidation(parsed.error) }); return; }
  const tenantId = req.tenantId!;

  const [existing] = await withTenant(tenantId, async (tx) =>
    tx.select().from(chargesRecurrentesTable).where(eq(chargesRecurrentesTable.id, parsed.data.id))
  );
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }

  await withTenant(tenantId, async (tx) =>
    tx.delete(chargesRecurrentesTable).where(eq(chargesRecurrentesTable.id, parsed.data.id))
  );
  res.status(204).send();
});

export default router;
