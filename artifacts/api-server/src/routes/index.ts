import { Router, type IRouter, type RequestHandler } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import cockpitRouter from "./cockpit";
import affairesRouter from "./affaires";
import contratsRouter from "./contrats";
import facturesRouter from "./factures";
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

import { requireAuth } from "../middleware/requireAuth";
import { resolveTenant } from "../middleware/resolveTenant";
import { requireMembership } from "../middleware/requireMembership";
import { requireRole } from "../middleware/requireRole";
import { withTenant, facturesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

// ── Public (no auth) ──────────────────────────────────────────────────────
router.use(healthRouter);
router.use(authRouter);

// ── Auth middleware chain applied to all business routes ──────────────────
// requireAuth       — validates session cookie in DB, attaches req.session
// resolveTenant     — copies session.tenantId → req.tenantId
// requireMembership — re-validates membership from DB, refreshes req.session.role
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
router.use(biz, prospectsRouter);
router.use(biz, votreMetierRouter);

// ── OWNER-only routes ─────────────────────────────────────────────────────
router.use(ownerOnly, equipeRouter);       // team member management
router.use(ownerOnly, connecteursRouter);  // external service connections
router.use(ownerOnly, parametresRouter);   // global workspace settings

// ── DELETE /factures/:id — OWNER-only destructive operation ───────────────
router.delete(
  "/factures/:id",
  ...ownerOnly,
  async (req, res): Promise<void> => {
    const id = req.params["id"] as string;
    if (!id) { res.status(400).json({ error: "id required" }); return; }
    const tenantId = req.tenantId!;
    const [deleted] = await withTenant(tenantId, async (tx) =>
      tx.delete(facturesTable).where(eq(facturesTable.id, id)).returning()
    );
    if (!deleted) { res.status(404).json({ error: "Facture not found" }); return; }
    res.status(204).send();
  },
);

export default router;
