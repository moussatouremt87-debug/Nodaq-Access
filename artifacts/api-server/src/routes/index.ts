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
import equipeRouter from "./equipe";
import connecteursRouter from "./connecteurs";
import parametresRouter from "./parametres";
import authRouter from "./auth";
import { requireAuth } from "../middleware/requireAuth";

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

// Platform routes — require authentication
router.use(requireAuth, equipeRouter);
router.use(requireAuth, connecteursRouter);
router.use(requireAuth, parametresRouter);

export default router;
