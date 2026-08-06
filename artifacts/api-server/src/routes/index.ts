import { Router, type IRouter } from "express";
import healthRouter from "./health";
import cockpitRouter from "./cockpit";
import affairesRouter from "./affaires";
import contratsRouter from "./contrats";
import facturesRouter from "./factures";
import prospectsRouter from "./prospects";
import briefRouter from "./brief";
import pendingActionsRouter from "./pending_actions";
import chatRouter from "./chat";
import devisRouter from "./devis";
import classeurRouter from "./classeur";
import echeancesRouter from "./echeances";
import margeRouter from "./marge";
import rapportsRouter from "./rapports";
import compteResultatRouter from "./compte-resultat";
import equipeRouter from "./equipe";
import connecteursRouter from "./connecteurs";
import parametresRouter from "./parametres";
import votreMetierRouter from "./votre-metier";
import authRouter from "./auth";
import { requireAuth } from "../middleware/requireAuth";
import { db, facturesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

// Public routes
router.use(healthRouter);
router.use(authRouter);

// Business routes (unauthenticated — consistent with existing app posture)
router.use(cockpitRouter);
router.use(affairesRouter);
router.use(contratsRouter);
router.use(facturesRouter);
router.use(prospectsRouter);
router.use(briefRouter);
router.use(pendingActionsRouter);
router.use(chatRouter);
router.use(devisRouter);
router.use(classeurRouter);
router.use(echeancesRouter);
router.use(margeRouter);
router.use(rapportsRouter);
router.use(compteResultatRouter);

// Platform routes — require authentication
router.use(requireAuth, equipeRouter);
router.use(requireAuth, connecteursRouter);
router.use(requireAuth, parametresRouter);
router.use(requireAuth, votreMetierRouter);

// Protected destructive operations on otherwise-public business resources
router.delete("/factures/:id", requireAuth, async (req, res): Promise<void> => {
  const id = req.params["id"] as string;
  if (!id) { res.status(400).json({ error: "id required" }); return; }
  const [deleted] = await db.delete(facturesTable).where(eq(facturesTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Facture not found" }); return; }
  res.status(204).send();
});

export default router;
