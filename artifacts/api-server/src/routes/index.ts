import { Router, type IRouter, type RequestHandler } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import cockpitRouter from "./cockpit";
import affairesRouter from "./affaires";
import contratsRouter from "./contrats";
import facturesRouter from "./factures";
import avoirsRouter from "./avoirs";
import prospectsRouter from "./prospects";
import briefRouter from "./brief";
import pendingActionsRouter from "./pending_actions";
import chatRouter from "./chat";
import chatMediaRouter from "./chat-media";
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
import entreprisesRouter from "./entreprises";
import publicRouter from "./public";
import { onboardingReadRouter, onboardingWriteRouter } from "./onboarding";
import analyticsRouter from "./analytics";
import pointagesRouter from "./pointages";
import catalogueRouter from "./catalogue";
import devisDicteeRouter from "./devis-dictee";
import parametresEnvoiRouter from "./parametres-envoi";
import objectifsRouter from "./objectifs";
import voixRouter from "./voix";
import clientsRouter from "./clients";
import paiementsRouter from "./paiements";
import affectationsRouter from "./affectations";

import { requireAuth } from "../middleware/requireAuth";
import { resolveTenant } from "../middleware/resolveTenant";
import { requireMembership } from "../middleware/requireMembership";
import { requireRole } from "../middleware/requireRole";

const router: IRouter = Router();

// ── Public (no auth) ──────────────────────────────────────────────────────
router.use(healthRouter);
router.use(authRouter);
router.use(publicRouter);   // /public/devis/:token/accept-page, /public/devis/:token/accept

// ── Auth middleware chain applied to all business routes ──────────────────
const biz: RequestHandler[] = [requireAuth, resolveTenant, requireMembership];
const ownerOnly: RequestHandler[] = [...biz, requireRole(["OWNER"])];

// ── Business routes (MEMBER+) ─────────────────────────────────────────────
router.use(biz, cockpitRouter);
router.use(biz, affairesRouter);
router.use(biz, contratsRouter);
router.use(biz, briefRouter);
router.use(biz, pendingActionsRouter);
router.use(biz, chatRouter);
router.use(biz, chatMediaRouter);
router.use(biz, devisRouter);
router.use(biz, classeurRouter);
router.use(biz, echeancesRouter);
router.use(biz, margeRouter);
router.use(biz, rapportsRouter);
router.use(biz, compteResultatRouter);
router.use(biz, facturesRouter);
router.use(biz, avoirsRouter);
router.use(biz, prospectsRouter);
router.use(biz, votreMetierRouter);
router.use(biz, onboardingReadRouter);
router.use(biz, analyticsRouter);
router.use(biz, pointagesRouter);
router.use(biz, catalogueRouter);
router.use(biz, devisDicteeRouter);
router.use(biz, parametresEnvoiRouter);
router.use(biz, objectifsRouter);
router.use(biz, voixRouter);
router.use(biz, clientsRouter);
router.use(biz, paiementsRouter);
router.use(biz, affectationsRouter);

// ── OWNER-only routes ─────────────────────────────────────────────────────
router.use(ownerOnly, equipeRouter);
router.use(ownerOnly, connecteursRouter);
router.use(ownerOnly, parametresRouter);
router.use(ownerOnly, entreprisesRouter);
router.use(ownerOnly, onboardingWriteRouter);

export default router;
