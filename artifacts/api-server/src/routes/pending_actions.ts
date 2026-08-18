import { Router, type IRouter } from "express";
import { withTenant, pendingActionsTable, activityTable, journalDecisionsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import {
  ApprovePendingActionParams,
  RejectPendingActionParams,
} from "@workspace/api-zod";
import { executerPlan, TYPE_PLAN } from "../lib/plan-vocal.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/pending-actions", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const actions = await withTenant(tenantId, async (tx) =>
    tx.select().from(pendingActionsTable).orderBy(desc(pendingActionsTable.createdAt))
  );
  res.json(actions);
});

router.post("/pending-actions/:id/approve", async (req, res): Promise<void> => {
  const params = ApprovePendingActionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const tenantId = req.tenantId!;

  const [avant] = await withTenant(tenantId, (tx) =>
    tx.select({ type: pendingActionsTable.type })
      .from(pendingActionsTable)
      .where(eq(pendingActionsTable.id, params.data.id)),
  );
  if (!avant) { res.status(404).json({ error: "Action not found" }); return; }

  // Un plan vocal ne se flippe pas : il s'EXÉCUTE. C'est executerPlan, seul,
  // qui écrit — /voix/executer et ce bouton doivent converger sur le même
  // chemin, pas en dupliquer un second qui ne fait que changer un statut
  // sans jamais écrire (c'était le bug : approuver depuis le cockpit ne
  // produisait aucune des opérations proposées par l'agent de chat).
  if (avant.type === TYPE_PLAN) {
    let resultat;
    try {
      resultat = await executerPlan(tenantId, params.data.id, {
        userId: req.session!.userId,
        email: req.session!.email,
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : "erreur" },
        "[pending-actions] exécution impossible",
      );
      res.status(409).json({
        error: "Une des opérations n'a pas pu être appliquée. Rien n'a été enregistré.",
      });
      return;
    }

    switch (resultat.kind) {
      case "introuvable":
        res.status(404).json({ error: "Action not found" });
        return;
      case "expire":
        res.status(410).json({
          error: "Ce plan a expiré. Redictez votre phrase — vos données ont pu changer entre-temps.",
        });
        return;
      case "deja_applique":
      case "ok": {
        const [action] = await withTenant(tenantId, (tx) =>
          tx.select().from(pendingActionsTable).where(eq(pendingActionsTable.id, params.data.id)),
        );
        res.json(action);
        return;
      }
    }
    return;
  }

  // Chemin conservé pour tout type de pending_action qui ne s'exécute pas via
  // executerPlan — aucun n'existe aujourd'hui (TYPE_PLAN est le seul type
  // jamais inséré dans pending_actions), gardé pour ne pas casser un futur
  // type qui n'aurait besoin que d'un changement de statut.
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
    // US-A6.4 — même transaction que la décision.
    await tx.insert(journalDecisionsTable).values({
      tenantId,
      actionId: action.id,
      actionType: action.type,
      actionLabel: action.label,
      actionPayload: action.payload,
      decision: "APPROUVEE",
      decideePar: req.session!.userId,
      decideeParEmail: req.session!.email,
    });
    return action;
  });

  if (!action) { res.status(404).json({ error: "Action not found" }); return; }
  res.json(action);
});

router.post("/pending-actions/:id/reject", async (req, res): Promise<void> => {
  const params = RejectPendingActionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const tenantId = req.tenantId!;

  const [action] = await withTenant(tenantId, async (tx) => {
    const lignes = await tx.update(pendingActionsTable)
      .set({ status: "REJETE", decidedAt: new Date() })
      .where(eq(pendingActionsTable.id, params.data.id))
      .returning();
    const rejetee = lignes[0];
    // US-A6.4 — un rejet est une décision : il se prouve autant qu'une
    // approbation. Journalisé dans la même transaction.
    if (rejetee) {
      await tx.insert(journalDecisionsTable).values({
        tenantId,
        actionId: rejetee.id,
        actionType: rejetee.type,
        actionLabel: rejetee.label,
        actionPayload: rejetee.payload,
        decision: "REJETEE",
        decideePar: req.session!.userId,
        decideeParEmail: req.session!.email,
      });
    }
    return lignes;
  });
  if (!action) { res.status(404).json({ error: "Action not found" }); return; }
  res.json(action);
});

export default router;
