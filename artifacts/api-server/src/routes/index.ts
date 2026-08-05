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

const router: IRouter = Router();

router.use(healthRouter);
router.use(cockpitRouter);
router.use(affairesRouter);
router.use(contratsRouter);
router.use(facturesRouter);
router.use(prospectsRouter);
router.use(briefRouter);
router.use(pendingActionsRouter);
router.use(chatRouter);

export default router;
