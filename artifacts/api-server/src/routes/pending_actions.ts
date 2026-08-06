import { Router, type IRouter } from "express";
import { withTenant, pendingActionsTable, activityTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  ApprovePendingActionParams,
  RejectPendingActionParams,
} from "@workspace/api-zod";
import { getDefaultTenantId } from "../lib/defaultTenant";

const router: IRouter = Router();

router.get("/pending-actions", async (_req, res): Promise<void> => {
  const tenantId = await getDefaultTenantId();
  const actions = await withTenant(tenantId, async (tx) =>
    tx.select().from(pendingActionsTable).orderBy(desc(pendingActionsTable.createdAt))
  );
  res.json(actions);
});

router.post("/pending-actions/:id/approve", async (req, res): Promise<void> => {
  const params = ApprovePendingActionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const tenantId = await getDefaultTenantId();

  const action = await withTenant(tenantId, async (tx) => {
    const [action] = await tx
      .update(pendingActionsTable)
      .set({ status: "APPROUVE", decidedAt: new Date() })
      .where(eq(pendingActionsTable.id, params.data.id))
      .returning();
    if (!action) return null;
    await tx.insert(activityTable).values({
      tenantId,
      type: "action_approved",
      label: `Action approuvée : ${action.label}`,
      meta: null,
    });
    return action;
  });

  if (!action) { res.status(404).json({ error: "Action not found" }); return; }
  res.json(action);
});

router.post("/pending-actions/:id/reject", async (req, res): Promise<void> => {
  const params = RejectPendingActionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const tenantId = await getDefaultTenantId();

  const [action] = await withTenant(tenantId, async (tx) =>
    tx.update(pendingActionsTable)
      .set({ status: "REJETE", decidedAt: new Date() })
      .where(eq(pendingActionsTable.id, params.data.id))
      .returning()
  );
  if (!action) { res.status(404).json({ error: "Action not found" }); return; }
  res.json(action);
});

export default router;
