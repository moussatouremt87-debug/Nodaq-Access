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
import cabinetRouter from "./cabinet";
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
import facturationElectroniqueRouter, {
  facturationElectroniqueWebhookRouter,
} from "./facturation-electronique";
import eReportingRouter from "./e-reporting";
import { banqueWebhookRouter } from "./webhooks-banque";
import chargesRecurrentesRouter from "./charges-recurrentes";
import previsionnelTresorerieRouter from "./previsionnel-tresorerie";

import { requireAuth } from "../middleware/requireAuth";
import { resolveTenant } from "../middleware/resolveTenant";
import { requireMembership } from "../middleware/requireMembership";
import { requireRole } from "../middleware/requireRole";
import { requireMfaVerified } from "../middleware/requireMfaVerified";
import { lectureSeuleMethode, lectureSeulePerimetre } from "../middleware/lectureSeule";
import { FINANCIAL_ROLES } from "@nodaq/shared";
import membresRouter, { membresPublicRouter } from "./membres";
import mfaRouter from "./mfa";

const router: IRouter = Router();

// ── Public (no auth) ──────────────────────────────────────────────────────
router.use(healthRouter);
router.use(authRouter);
router.use(publicRouter);   // /public/devis/:token/accept-page, /public/devis/:token/accept
router.use(membresPublicRouter); // /membres/inviter/:token (lecture + acceptation)
// Webhook PA (US-A2.6) : pas de session, authentifié par signature HMAC —
// voir facturation-electronique.ts. Aucune PA réelle contractée à ce jour ;
// route non testable bout en bout, seulement son authentification.
router.use(facturationElectroniqueWebhookRouter);
// Webhook Bridge (connecteur bancaire) : pas de session, authentifié par
// signature HMAC — voir webhooks-banque.ts. Un seul webhook applicatif,
// tenant résolu via la policy RLS étroite bank_connections_webhook_lookup.
router.use(banqueWebhookRouter);

// ── MFA (ticket 4.15) — requireAuth SEUL, pas la chaîne biz ────────────────
// Une session bloquée par requireMfaVerified doit pouvoir atteindre ces
// routes pour en sortir ; resolveTenant/requireMembership n'ont rien à voir
// avec « cette personne possède-t-elle le bon secret TOTP ».
router.use([requireAuth], mfaRouter);

// ── Auth middleware chain applied to all business routes ──────────────────
// requireMfaVerified en dernier : bloque toute session OWNER/ACCOUNTANT sans
// second facteur prouvé CETTE session, avant qu'elle n'atteigne quoi que ce
// soit — ownerOnly et financierOnly en héritent en composant `biz`.
// US-A5.4 — les deux gardes du tiers de confiance viennent APRÈS
// requireMembership (qui vient de relire le rôle en base) et sont posées ici,
// dans `biz`, plutôt que sur un sous-ensemble de routeurs : c'est ce qui les
// rend valables pour les 97 routes mutantes actuelles ET pour celles qui
// n'existent pas encore. Voir middleware/lectureSeule.ts.
const biz: RequestHandler[] = [
  requireAuth, resolveTenant, requireMembership, requireMfaVerified,
  lectureSeuleMethode, lectureSeulePerimetre,
];
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
router.use(financierOnly, chargesRecurrentesRouter);
router.use(financierOnly, previsionnelTresorerieRouter);
router.use(financierOnly, margeRouter);
router.use(financierOnly, rapportsRouter);
router.use(financierOnly, compteResultatRouter);
router.use(financierOnly, facturesRouter);
router.use(financierOnly, avoirsRouter);
router.use(financierOnly, analyticsRouter);
router.use(financierOnly, paiementsRouter);
router.use(financierOnly, eReportingRouter);
// US-A5.2 — boucle elle-même sur PLUSIEURS tenants (listUserMemberships),
// pas sur req.tenantId ; financierOnly ne sert ici qu'à exiger un accès
// financier sur le tenant COURANT avant d'exposer le portefeuille entier.
router.use(financierOnly, cabinetRouter);

// ── OWNER-only routes ─────────────────────────────────────────────────────
router.use(ownerOnly, equipeRouter);
router.use(ownerOnly, connecteursRouter);
router.use(ownerOnly, parametresRouter);
router.use(ownerOnly, entreprisesRouter);
router.use(ownerOnly, onboardingWriteRouter);
router.use(ownerOnly, membresRouter);
router.use(ownerOnly, facturationElectroniqueRouter);

export default router;
