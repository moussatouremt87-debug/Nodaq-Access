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
import prospectionRouter from "./prospection";
import clientsRouter from "./clients";
import paiementsRouter from "./paiements";
import affectationsRouter from "./affectations";

import { requireAuth } from "../middleware/requireAuth";
import { resolveTenant } from "../middleware/resolveTenant";
import { requireMembership } from "../middleware/requireMembership";
import { requireRole } from "../middleware/requireRole";
import { requireMfaVerified } from "../middleware/requireMfaVerified";
import { FINANCIAL_ROLES } from "@nodaq/shared";
import membresRouter, { membresPublicRouter } from "./membres";
import mfaRouter from "./mfa";

const router: IRouter = Router();

// ── Public (no auth) ──────────────────────────────────────────────────────
router.use(healthRouter);
router.use(authRouter);
router.use(publicRouter);   // /public/devis/:token/accept-page, /public/devis/:token/accept
router.use(membresPublicRouter); // /membres/inviter/:token (lecture + acceptation)

// ── MFA (ticket 4.15) — requireAuth SEUL, pas la chaîne biz ────────────────
// Une session bloquée par requireMfaVerified doit pouvoir atteindre ces
// routes pour en sortir ; resolveTenant/requireMembership n'ont rien à voir
// avec « cette personne possède-t-elle le bon secret TOTP ».
router.use([requireAuth], mfaRouter);

// ── Auth middleware chain applied to all business routes ──────────────────
// requireMfaVerified en dernier : bloque toute session OWNER/ACCOUNTANT sans
// second facteur prouvé CETTE session, avant qu'elle n'atteigne quoi que ce
// soit — ownerOnly et financierOnly en héritent en composant `biz`.
const biz: RequestHandler[] = [requireAuth, resolveTenant, requireMembership, requireMfaVerified];
const ownerOnly: RequestHandler[] = [...biz, requireRole(["OWNER"])];
// Routeurs EXCLUSIVEMENT financiers — bloqués en entier pour un MEMBER, pas
// seulement masqués : contrairement à affaires/contrats (voir plus bas), ils
// n'ont aucun contenu qu'un MEMBER aurait légitimement besoin de voir.
const financierOnly: RequestHandler[] = [...biz, requireRole(FINANCIAL_ROLES)];

// ── Business routes (MEMBER+) ─────────────────────────────────────────────
// affairesRouter et contratsRouter restent MEMBER+ : ils mêlent des données
// de travail qu'un MEMBER doit voir (libellé, client, statut, dates) à des
// champs monétaires. Le masquage se fait CHAMP PAR CHAMP dans ces routeurs
// eux-mêmes (voir maskFinancialFields), pas en bloquant l'accès au routeur.
router.use(biz, cockpitRouter);
router.use(biz, affairesRouter);
router.use(biz, contratsRouter);
router.use(biz, briefRouter);
router.use(biz, pendingActionsRouter);
router.use(biz, chatRouter);
router.use(biz, chatMediaRouter);
router.use(biz, devisRouter);
router.use(biz, classeurRouter);
router.use(biz, prospectsRouter);
router.use(biz, votreMetierRouter);
router.use(biz, onboardingReadRouter);
router.use(biz, pointagesRouter);
router.use(biz, catalogueRouter);
router.use(biz, devisDicteeRouter);
router.use(biz, parametresEnvoiRouter);
router.use(biz, objectifsRouter);
router.use(biz, voixRouter);
router.use(biz, prospectionRouter);
router.use(biz, clientsRouter);
router.use(biz, affectationsRouter);

// ── Business routes (OWNER ou ACCOUNTANT seulement) ───────────────────────
router.use(financierOnly, echeancesRouter);
router.use(financierOnly, margeRouter);
router.use(financierOnly, rapportsRouter);
router.use(financierOnly, compteResultatRouter);
router.use(financierOnly, facturesRouter);
router.use(financierOnly, avoirsRouter);
router.use(financierOnly, analyticsRouter);
router.use(financierOnly, paiementsRouter);

// ── OWNER-only routes ─────────────────────────────────────────────────────
router.use(ownerOnly, equipeRouter);
router.use(ownerOnly, connecteursRouter);
router.use(ownerOnly, parametresRouter);
router.use(ownerOnly, entreprisesRouter);
router.use(ownerOnly, onboardingWriteRouter);
router.use(ownerOnly, membresRouter);

export default router;
