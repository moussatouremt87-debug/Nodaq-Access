import { Router, type IRouter } from "express";
import { db, pendingActionsTable, activityTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  ApprovePendingActionParams,
  RejectPendingActionParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/pending-actions", async (_req, res): Promise<void> => {
  const actions = await db
    .select()
    .from(pendingActionsTable)
    .orderBy(desc(pendingActionsTable.createdAt));
  res.json(actions);
});

router.post("/pending-actions/:id/approve", async (req, res): Promise<void> => {
  const params = ApprovePendingActionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [action] = await db
    .update(pendingActionsTable)
    .set({ status: "APPROUVE", decidedAt: new Date() })
    .where(eq(pendingActionsTable.id, params.data.id))
    .returning();
  if (!action) {
    res.status(404).json({ error: "Action not found" });
    return;
  }
  await db.insert(activityTable).values({
    type: "action_approved",
    label: `Action approuvée : ${action.label}`,
    meta: null,
  });
  res.json(action);
});

router.post("/pending-actions/:id/reject", async (req, res): Promise<void> => {
  const params = RejectPendingActionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [action] = await db
    .update(pendingActionsTable)
    .set({ status: "REJETE", decidedAt: new Date() })
    .where(eq(pendingActionsTable.id, params.data.id))
    .returning();
  if (!action) {
    res.status(404).json({ error: "Action not found" });
    return;
  }
  res.json(action);
});

export default router;
