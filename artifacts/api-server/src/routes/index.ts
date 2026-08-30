import { Router, type IRouter, type RequestHandler } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import cockpitRouter from "./cockpit";
import affairesRouter from "./affaires";
import contratsRouter from "./contrats";
import facturesRouter from "./factures";
import facturationTempsRouter from "./facturation-temps";
import facturationRecurrenteRouter from "./facturation-recurrente";
import attestationsSapRouter from "./attestations-sap";
import sitesRouter from "./sites";
import avoirsRouter from "./avoirs";
import prospectsRouter from "./prospects";
import briefRouter from "./brief";
import pendingActionsRouter from "./pending_actions";
import chatRouter from "./chat";
import supportRouter, { aidePubliqueRouter } from "./support";
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
import { webhookAgentVocalRouter } from "./webhook-agent-vocal";
import { paiementWebhookRouter } from "./webhooks-paiement";
import chargesRecurrentesRouter from "./charges-recurrentes";
import previsionnelTresorerieRouter from "./previsionnel-tresorerie";

import { requireAuth } from "../middleware/requireAuth";
import { resolveTenant } from "../middleware/resolveTenant";
import { requireMembership } from "../middleware/requireMembership";
import { requireRole } from "../middleware/requireRole";
import { requireMfaVerified } from "../middleware/requireMfaVerified";
import { lectureSeuleMethode, lectureSeulePerimetre } from "../middleware/lectureSeule";
import { perimetreSante } from "../middleware/perimetreSante";
import { FINANCIAL_ROLES } from "@nodaq/shared";
import journalDecisionsRouter from "./journal-decisions";
import souveraineteRouter from "./souverainete";
import { modulesReadRouter, modulesWriteRouter } from "./modules";
import { reglesRelanceReadRouter, reglesRelanceWriteRouter } from "./regles-relance";
import relanceCommercialeRouter from "./relance-commerciale";
import agentFeedbackRouter from "./agent-feedback";
import { campagnesRelanceReadRouter, campagnesRelanceWriteRouter } from "./campagnes-relance";
import { liensPaiementReadRouter, liensPaiementWriteRouter } from "./liens-paiement";
import relanceFormulationRouter from "./relance-formulation";
import relanceMandatRouter from "./relance-mandat";
import { requireAppelVocal } from "../middleware/requireAppelVocal";
import membresRouter, { membresPublicRouter } from "./membres";
import mfaRouter from "./mfa";
import { abonnementReadRouter, abonnementWriteRouter } from "./abonnement";
import { abonnementLectureSeule } from "../middleware/abonnementLectureSeule";

const router: IRouter = Router();

// ── Public (no auth) ──────────────────────────────────────────────────────
router.use(healthRouter);
router.use(authRouter);
router.use(publicRouter);   // /public/devis/:token/accept-page, /public/devis/:token/accept
router.use(membresPublicRouter); // /membres/inviter/:token (lecture + acceptation)
// L'aide est PUBLIQUE, sans session : celui qui n'arrive pas à se connecter est
// précisément celui qui en a le plus besoin d'elle.
router.use(aidePubliqueRouter);  // /aide/llms.txt, /aide/articles, /aide/:slug.md
// Webhook PA (US-A2.6) : pas de session, authentifié par signature HMAC —
// voir facturation-electronique.ts. Aucune PA réelle contractée à ce jour ;
// route non testable bout en bout, seulement son authentification.
router.use(facturationElectroniqueWebhookRouter);
// Webhook Bridge (connecteur bancaire) : pas de session, authentifié par
// signature HMAC — voir webhooks-banque.ts. Un seul webhook applicatif,
// tenant résolu via la policy RLS étroite bank_connections_webhook_lookup.
router.use(banqueWebhookRouter);
// Webhook post-call de la plateforme vocale (4.18-bis) : signature HMAC
// vérifiée sur le corps BRUT, tenant résolu par policy étroite depuis le
// conversation_id — jamais reçu du client. Public par nature, comme le
// webhook bancaire au-dessus.
router.use(webhookAgentVocalRouter);
// Webhook de paiement Bridge (4.19) : public, authentifié par signature sur
// le corps brut — même famille que les deux précédents.
router.use(paiementWebhookRouter);

// ── Le worker vocal (4.18, lot 6) ────────────────────────────────────────
//
// AVANT le bloc `biz`, et BORNÉ AU CHEMIN. Deux contraintes qui se sont
// rappelées à moi l'une après l'autre :
//
//   * `router.use(mw, sous)` exécute `mw` pour TOUTE requête qui atteint la
//     ligne, pas seulement pour celles que le sous-routeur sait traiter. Sans
//     préfixe, `requireAppelVocal` exigeait un jeton d'appel pour tout ce qui
//     est déclaré plus bas — factures, avoirs, paramètres ;
//   * les routeurs `biz` sont eux aussi montés sans préfixe : placé après eux,
//     ce montage n'était jamais atteint, `requireAuth` ayant déjà refusé la
//     requête faute de cookie.
//
// Le worker est une MACHINE : il n'a pas de session. Le jeton qu'il présente
// désigne UN appel, et `req.tenantId` est posé depuis la ligne trouvée en base
// — jamais depuis le corps. La règle 1 est ainsi tenue par construction : le
// worker n'a aucun moyen de nommer un tenant.
//
// Ces routes ne sont exposées à aucune interface : rien dans `artifacts/nodaq`
// ne les appelle, et un humain n'a pas de jeton d'appel.
router.use("/relance/appel", requireAppelVocal, relanceMandatRouter);
router.use("/relance/formulation", requireAppelVocal, relanceFormulationRouter);

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
  // US-B9.4 — la limite de périmètre en secteur santé. Posée ICI, dans `biz`,
  // pour la même raison que les deux gardes ci-dessus : elle vaut pour les
  // routes actuelles ET pour celles qui n'existent pas encore. Un contrôle
  // posé routeur par routeur serait un « principe d'usage », ce que la story
  // refuse explicitement.
  perimetreSante,
  // Grille tarifaire : un essai échu passe l'espace en lecture seule — les
  // données restent, les écritures sont refusées. Même raisonnement qu'au
  // dessus : une garde dans `biz` vaut pour toutes les routes, y compris
  // celles qui n'existent pas encore. Voir middleware/abonnementLectureSeule.
  abonnementLectureSeule,
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
// Juger une production de l'agent est ouvert à tout membre : c'est celui
// qui s'en sert qui sait si c'était bon.
router.use(biz, agentFeedbackRouter);
router.use(biz, cockpitRouter);
router.use(biz, affairesRouter);
router.use(biz, contratsRouter);
router.use(biz, briefRouter);
router.use(biz, pendingActionsRouter);
router.use(biz, chatRouter);
// L'aide ne lit aucune table métier et n'a aucun outil : elle passe par
// `biz` comme le reste pour rester derrière l'authentification, mais elle
// n'a rien à isoler.
router.use(biz, supportRouter);
router.use(biz, chatMediaRouter);
router.use(biz, devisRouter);
// US-B9.4 — la garde du téléversement vit DANS `classeur.ts`, après multer :
// `affaireId` arrive dans un corps multipart, qui n'est analysé qu'à ce
// moment-là. Montée ici, elle aurait inspecté un corps vide et laissé passer.
// US-B7.1 — les sites d'un contrat multi-sites. MEMBER+ comme les affaires :
// un chef d'équipe doit voir où il intervient. Le `montantCents` est masqué
// pour les rôles non financiers par la même mécanique que les affaires.
router.use(biz, sitesRouter);
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
// Lecture des modules : la NAVIGATION en dépend, donc tout rôle doit pouvoir
// la lire. L'écriture est plus bas, réservée au propriétaire.
router.use(biz, modulesReadRouter);
// Règle de relance : un MEMBER valide des campagnes DANS SON CADRE (4.18 US-9),
// il doit donc pouvoir la lire. L'écriture est plus bas, au propriétaire.
router.use(biz, reglesRelanceReadRouter);
// Abonnement : la LECTURE est ouverte à tout membre — celui qui prépare une
// campagne d'appels doit voir où en est le quota du mois. L'écriture est
// plus bas, réservée au propriétaire : changer de formule engage le compte.
router.use(biz, abonnementReadRouter);
router.use(biz, campagnesRelanceReadRouter);
// Les liens de paiement portent des montants dus : lecture réservée aux rôles
// à accès financier, comme le reste de la relance.
router.use(biz, liensPaiementReadRouter);
// ── Le worker vocal (4.18, lot 6) ────────────────────────────────────────
//
// PAS `biz` : le worker est une machine, il n'a pas de session. Le jeton
// qu'il présente désigne UN appel, et `req.tenantId` est posé depuis la ligne
// trouvée en base — jamais depuis le corps. La règle 1 est ainsi tenue par
// construction : le worker n'a aucun moyen de nommer un tenant.
//
// Ces routes ne sont exposées à aucune interface : rien dans `artifacts/nodaq`
// ne les appelle, et un humain n'a pas de jeton d'appel.

// ── Business routes (OWNER ou ACCOUNTANT seulement) ───────────────────────
router.use(financierOnly, echeancesRouter);
router.use(financierOnly, chargesRecurrentesRouter);
router.use(financierOnly, previsionnelTresorerieRouter);
router.use(financierOnly, margeRouter);
router.use(financierOnly, rapportsRouter);
router.use(financierOnly, compteResultatRouter);
router.use(financierOnly, facturesRouter);
// US-A2.4 — facturer le temps passé. Derrière `financierOnly` comme les
// factures : ces routes en CRÉENT, et un rôle qui ne voit pas le dossier
// financier n'a pas à en produire.
router.use(financierOnly, facturationTempsRouter);
router.use(financierOnly, facturationRecurrenteRouter);
// US-B4.1 — l'attestation porte des montants encaissés par client : elle est
// financière au même titre que les factures.
router.use(financierOnly, attestationsSapRouter);
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
// US-A6.4 — preuve à produire en cas de contrôle : c'est l'OWNER qui la
// produit, pas un collaborateur.
router.use(ownerOnly, journalDecisionsRouter);
router.use(ownerOnly, membresRouter);
router.use(ownerOnly, facturationElectroniqueRouter);
// US-A7.4 — l'attestation engage l'entreprise devant un donneur d'ordre :
// elle se produit depuis le compte du dirigeant.
router.use(ownerOnly, souveraineteRouter);
// Allumer ou éteindre un module engage le compte, pas l'écran de celui qui
// clique : c'est une décision de propriétaire.
router.use(ownerOnly, modulesWriteRouter);
router.use(ownerOnly, reglesRelanceWriteRouter);
// Changer de formule ou activer le module vocal engage le compte et son
// tarif : décision de propriétaire, comme les modules.
router.use(ownerOnly, abonnementWriteRouter);
// Proposer une relance commerciale engage le nom de l'entreprise : réservé à
// qui décide, comme les règles de relance elles-mêmes.
router.use(ownerOnly, relanceCommercialeRouter);
// Proposer une campagne engage le compte : c'est une décision de propriétaire.
router.use(ownerOnly, campagnesRelanceWriteRouter);
// Renvoyer un SMS à un débiteur engage le compte : décision de propriétaire.
router.use(ownerOnly, liensPaiementWriteRouter);

export default router;
