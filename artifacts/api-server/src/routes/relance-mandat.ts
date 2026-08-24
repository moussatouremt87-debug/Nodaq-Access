/**
 * La passerelle de mandat du worker vocal — ticket 4.18, US-3/US-4.
 *
 *   GET  /relance/appel/ouverture     — l'annonce, mot pour mot
 *   GET  /relance/appel/insistance    — peut-on relancer une fois de plus ?
 *   POST /relance/appel/echelonnement — que répond-on à une demande d'étalement ?
 *   POST /relance/appel/demarre       — la conversation commence
 *
 * Les chemins sont déclarés RELATIFS : le routeur est monté sous
 * `/relance/appel`, de sorte que `requireAppelVocal` ne s'exécute que pour ces
 * routes-là (voir `routes/index.ts`).
 *
 * Toutes montées derrière `requireAppelVocal` : le tenant vient du jeton, donc
 * de la base, jamais du corps.
 *
 * ── Pourquoi le worker ne décide de rien ───────────────────────────────────
 * Ces trois questions ont des réponses qui engagent l'entreprise. Les faire
 * calculer par le worker — ou pire, par le modèle — reviendrait à déplacer un
 * engagement contractuel dans un runtime qu'on ne teste pas comme tel. Le
 * noyau (`decisionAppel.ts`) répond ; le worker exécute.
 *
 * ── La règle FIGÉE, pas la règle en vigueur ────────────────────────────────
 * `deciderEchelonnement` reçoit la version de règle que la campagne a gelée à
 * sa validation (`regleVersion`), et non la dernière en date. C'est la promesse
 * de l'US-9 : ce qui a été validé est ce qui s'applique. Un propriétaire qui
 * resserre sa règle pendant qu'un appel sonne ne change pas ce que l'agent a
 * le droit d'accorder à ce débiteur-là — il change ce que les campagnes
 * SUIVANTES pourront accorder.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import {
  withTenant,
  campagnesRelanceTable,
  reglesRelanceTable,
  appelsRelanceTable,
} from "@workspace/db";
import {
  INSISTANCES_MAX,
  REGLE_RELANCE_DEFAUT,
  annonceOuverture,
  deciderEchelonnement,
  toDateString,
  type MandatCampagne,
  type RegleRelance,
} from "@nodaq/shared";
import { loadCompanySettings } from "../lib/seller-info.js";
import { poserOppositionAppel } from "../lib/appels-relance.js";
import { constaterUsageVocal } from "../lib/abonnement.js";
import { emettreLienPaiement } from "../lib/lien-paiement.js";

const router: IRouter = Router();

const DemandeEchelonnement = z.object({
  versements: z.number().int().min(1).max(60),
  premierVersementDansJours: z.number().int().min(0).max(3650),
  dernierVersementRetardJours: z.number().int().min(0).max(3650),
});

/** Le mandat figé de la campagne, et la règle dans la version qu'elle a gelée. */
async function cadreDeLAppel(
  tenantId: string,
  campagneId: string,
): Promise<{ mandat: MandatCampagne; regle: RegleRelance } | null> {
  return withTenant(tenantId, async (tx) => {
    const [campagne] = await tx
      .select({
        mandat: campagnesRelanceTable.mandat,
        regleVersion: campagnesRelanceTable.regleVersion,
      })
      .from(campagnesRelanceTable)
      .where(eq(campagnesRelanceTable.id, campagneId));

    if (!campagne?.mandat) return null;

    // Version 0 = aucune règle n'avait été posée à la validation : le défaut
    // prudent s'applique (échelonnement et remise fermés), et non la première
    // règle écrite depuis.
    if (!campagne.regleVersion) {
      return { mandat: campagne.mandat as MandatCampagne, regle: REGLE_RELANCE_DEFAUT };
    }

    const [ligne] = await tx
      .select()
      .from(reglesRelanceTable)
      .where(
        and(
          eq(reglesRelanceTable.tenantId, tenantId),
          eq(reglesRelanceTable.version, campagne.regleVersion),
        ),
      );

    // Une version gelée qui a disparu : on retombe sur le défaut prudent
    // plutôt que sur la règle courante. Se rabattre sur « la dernière » serait
    // appliquer une règle que personne n'a validée POUR CETTE campagne — et
    // elle pourrait être plus large.
    const regle: RegleRelance = ligne
      ? {
          echelonnementAutorise: ligne.echelonnementAutorise,
          maxVersements: ligne.maxVersements,
          delaiMaxPremierVersementJours: ligne.delaiMaxPremierVersementJours,
          retardMaxJours: ligne.retardMaxJours,
          lienPaiementAutorise: ligne.lienPaiementAutorise,
          remiseAutorisee: ligne.remiseAutorisee,
        }
      : REGLE_RELANCE_DEFAUT;

    return { mandat: campagne.mandat as MandatCampagne, regle };
  });
}

/**
 * L'annonce d'ouverture (US-2, AI Act).
 *
 * Produite par le noyau, mot pour mot. Elle ne passe jamais par le modèle :
 * une annonce qu'un runtime est libre de reformuler est une annonce qui peut,
 * un jour, ne plus annoncer.
 */
router.get("/ouverture", async (req, res): Promise<void> => {
  const reglages = await loadCompanySettings(req.tenantId!);
  const nom = reglages["company.raison_sociale"]?.trim();

  // Pas de repli « Entreprise » ici : l'agent DIT ce nom au téléphone, et
  // s'annoncer comme « l'assistant automatique de Entreprise » sonne comme une
  // arnaque — exactement l'effet que l'annonce doit éviter. Sans raison
  // sociale, on refuse de composer plutôt que de se présenter mal.
  if (!nom) {
    res.status(409).json({
      error:
        "La raison sociale n'est pas renseignée : l'agent ne peut pas s'annoncer. Complétez le profil entreprise avant de lancer des appels.",
    });
    return;
  }

  res.json({ annonce: annonceOuverture(nom) });
});

/**
 * Peut-on insister une fois de plus pour obtenir une date ?
 *
 * Le plafond vient du noyau, jamais d'un compteur local comparé à une
 * constante recopiée dans le worker.
 */
router.get("/insistance", async (req, res): Promise<void> => {
  const faites = Number(req.query["faites"] ?? 0);
  if (!Number.isInteger(faites) || faites < 0) {
    res.status(400).json({ error: "Paramètre `faites` invalide." });
    return;
  }
  res.json({ autorise: faites < INSISTANCES_MAX, plafond: INSISTANCES_MAX });
});

/** Que répond-on quand le débiteur demande à payer en plusieurs fois (US-3) ? */
router.post("/echelonnement", async (req, res): Promise<void> => {
  const parsed = DemandeEchelonnement.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const cadre = await cadreDeLAppel(req.tenantId!, req.appelVocal!.campagneId);
  if (!cadre) {
    res.status(409).json({ error: "Campagne introuvable ou sans mandat." });
    return;
  }

  const decision = deciderEchelonnement(cadre.regle, cadre.mandat, parsed.data);

  if (decision.kind === "accorde") {
    res.json({
      accorde: true,
      versements: decision.versements,
      premierVersementDansJours: decision.premierVersementDansJours,
    });
    return;
  }

  // Le MOTIF et le message au dirigeant ne partent PAS vers le worker : ils
  // décrivent une configuration interne, et le worker les transmettrait au
  // modèle, qui pourrait les prononcer. Le débiteur entend un renvoi neutre ;
  // le dirigeant lit le détail dans le cockpit.
  res.json({ accorde: false });
});

/**
 * Le worker signale que la conversation a commencé.
 *
 * Fait basculer l'appel en `EN_COURS`. Le jeton reste valable — la policy
 * accepte les deux statuts — mais l'état devient visible au cockpit.
 */
router.post("/demarre", async (req, res): Promise<void> => {
  const { appelId } = req.appelVocal!;
  await withTenant(req.tenantId!, (tx) =>
    tx
      .update(appelsRelanceTable)
      .set({ statut: "EN_COURS", startedAt: new Date() })
      .where(eq(appelsRelanceTable.id, appelId)),
  );
  // Grille tarifaire : le compteur du mois avance à l'instant où l'appel
  // démarre — c'est ici que le franchissement des 80 % se constate, pas
  // quand quelqu'un ouvre l'écran. Au-delà des appels inclus on COMPTE, on
  // ne coupe jamais un appel ni un mois en cours.
  await constaterUsageVocal(req.tenantId!);
  res.json({ ok: true });
});

// ── Les server tools du ticket 4.18-bis ────────────────────────────────────
//
// Depuis le pivot vers ElevenLabs Agents (ADR 005), c'est le LLM de la
// plateforme qui formule les répliques. Ces routes sont donc LE point où
// l'invariant applicable vit désormais : l'agent peut dire ce qu'il veut, il ne
// peut rien ENREGISTRER que le serveur n'ait validé. Une promesse hors mandat
// n'est pas « déconseillée » — elle est refusée ici, et le refus est testé.
//
// Les réponses sont des DONNÉES, jamais des répliques : le LLM formule. Et un
// refus ne porte jamais le motif interne (règle du lot 6a — le modèle pourrait
// le prononcer).

/** L'entrée de campagne de CET appel : numéro et montant dû. */
async function entreeDeLAppel(
  tenantId: string,
  campagneId: string,
  appelId: string,
): Promise<{ numero: string; montantCents: number } | null> {
  return withTenant(tenantId, async (tx) => {
    const [appel] = await tx
      .select({ factureId: appelsRelanceTable.factureId })
      .from(appelsRelanceTable)
      .where(eq(appelsRelanceTable.id, appelId));

    const [campagne] = await tx
      .select({ appels: campagnesRelanceTable.appels })
      .from(campagnesRelanceTable)
      .where(eq(campagnesRelanceTable.id, campagneId));

    const entrees = (campagne?.appels ?? []) as {
      factureId?: string;
      numero?: string;
      montantCents?: number;
    }[];
    const entree = entrees.find((e) => e.factureId === appel?.factureId);
    return entree?.numero
      ? { numero: entree.numero, montantCents: entree.montantCents ?? 0 }
      : null;
  });
}

const CorpsPromesse = z.object({
  montantCents: z.number().int().positive(),
  /** Jour calendaire `YYYY-MM-DD` — une promesse se tient un jour, pas un instant. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /**
   * L'agent affirme que le débiteur a confirmé la reformulation (US-3). C'est
   * une AFFIRMATION du LLM, pas une preuve — la preuve viendra de l'audit du
   * transcript (lot D). Mais sans elle, rien n'est écrit du tout.
   */
  confirme: z.boolean(),
});

/**
 * `record_promise` — la seule porte vers une promesse enregistrée.
 *
 * C'est ici que vit l'invariant depuis l'ADR 005 : quoi que le LLM ait dit au
 * téléphone, une promesse hors mandat ou non confirmée n'existe pas pour le
 * produit. Le refus rend une raison NEUTRE que l'agent peut relayer, jamais le
 * réglage interne qui l'explique.
 */
router.post("/promesse", async (req, res): Promise<void> => {
  const parsed = CorpsPromesse.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { montantCents, date, confirme } = parsed.data;
  const { appelId, campagneId } = req.appelVocal!;
  const tenantId = req.tenantId!;

  if (!confirme) {
    // US-3 : pas de promesse sans reformulation confirmée. L'agent doit
    // récapituler, entendre le « oui », PUIS rappeler ce tool.
    res.json({
      enregistree: false,
      consigne: "Récapitule le montant et la date, obtiens une confirmation, puis réessaie.",
    });
    return;
  }

  const cadre = await cadreDeLAppel(tenantId, campagneId);
  const entree = await entreeDeLAppel(tenantId, campagneId, appelId);
  if (!cadre || !entree) {
    res.status(409).json({ error: "Campagne introuvable ou sans mandat." });
    return;
  }

  // La date promise doit tomber dans le retard que le MANDAT accepte — la
  // version figée à la validation, pas la règle du jour (US-9). `toDateString`
  // et non `toISOString` : un jour métier se compare en local.
  const aujourdHui = toDateString(new Date());
  const limite = new Date();
  limite.setDate(limite.getDate() + cadre.mandat.retardMaxJours);
  if (date < aujourdHui || date > toDateString(limite)) {
    res.json({
      enregistree: false,
      consigne:
        "Cette date ne peut pas être retenue. Propose une date plus proche, ou note la demande pour transmission.",
    });
    return;
  }

  // On ne promet pas PLUS que le montant dû : un trop-perçu enregistré ferait
  // réclamer au débiteur une somme qu'il ne doit pas.
  if (entree.montantCents > 0 && montantCents > entree.montantCents) {
    res.json({
      enregistree: false,
      consigne: "Le montant dépasse ce qui est dû. Reprends le montant exact avec la personne.",
    });
    return;
  }

  await withTenant(tenantId, (tx) =>
    tx
      .update(appelsRelanceTable)
      .set({ promesseMontantCents: montantCents, promesseDate: date, issue: "promise" })
      .where(eq(appelsRelanceTable.id, appelId)),
  );
  res.json({ enregistree: true });
});

/** `record_dispute` — une contestation se note et se transmet, jamais ne se discute (US-4). */
router.post("/contestation", async (req, res): Promise<void> => {
  const { appelId } = req.appelVocal!;
  await withTenant(req.tenantId!, (tx) =>
    tx
      .update(appelsRelanceTable)
      .set({ issue: "dispute" })
      .where(eq(appelsRelanceTable.id, appelId)),
  );
  res.json({ enregistree: true, consigne: "Prends congé poliment : quelqu'un reviendra vers la personne." });
});

/** `request_human_callback` — la demande d'un humain clôt l'échange (US-2). */
router.post("/rappel-humain", async (req, res): Promise<void> => {
  const { appelId } = req.appelVocal!;
  await withTenant(req.tenantId!, (tx) =>
    tx
      .update(appelsRelanceTable)
      .set({ issue: "callback_requested" })
      .where(eq(appelsRelanceTable.id, appelId)),
  );
  res.json({ enregistree: true, consigne: "Confirme qu'un humain rappellera, puis prends congé." });
});

/**
 * `set_do_not_call` — l'opposition est DÉFINITIVE et immédiate (US-7).
 *
 * Le numéro n'est pas demandé au LLM : il est lu depuis l'entrée de campagne de
 * cet appel. Un agent qui pourrait opposer un numéro arbitraire pourrait aussi
 * en radier un qu'on ne lui a pas confié.
 */
router.post("/opposition", async (req, res): Promise<void> => {
  const { appelId, campagneId } = req.appelVocal!;
  const tenantId = req.tenantId!;
  const entree = await entreeDeLAppel(tenantId, campagneId, appelId);
  if (!entree) {
    res.status(409).json({ error: "Appel sans entrée de campagne." });
    return;
  }
  await poserOppositionAppel(tenantId, entree.numero);
  await withTenant(tenantId, (tx) =>
    tx
      .update(appelsRelanceTable)
      .set({ issue: "refused" })
      .where(eq(appelsRelanceTable.id, appelId)),
  );
  res.json({ enregistree: true, consigne: "Confirme que la personne ne sera plus appelée, puis prends congé." });
});

/**
 * `send_payment_link` — le lien de paiement, envoyé pendant l'appel (4.19).
 *
 * L'outil ne prend AUCUN paramètre, et c'est le point : montant, destinataire
 * et bénéficiaire sont lus en base depuis l'appel en cours. Un outil qui
 * accepterait un montant laisserait le modèle fixer une somme à encaisser —
 * exactement ce que la règle 3 interdit.
 *
 * Les réponses sont des DONNÉES, jamais des répliques, et un refus ne porte
 * jamais son motif interne : « hors mandat » deviendrait « je n'ai pas le
 * droit, c'est bloqué dans les réglages » dans la bouche de l'agent.
 */
router.post("/lien-paiement", async (req, res): Promise<void> => {
  const { appelId } = req.appelVocal!;
  const resultat = await emettreLienPaiement({ tenantId: req.tenantId!, appelId });

  switch (resultat.kind) {
    case "envoye":
      res.json({
        envoye: true,
        consigne:
          "Dis que le SMS vient de partir sur ce numéro, et que le lien mène à un virement à valider dans sa banque.",
      });
      return;

    case "sms_non_parti":
      // Le lien existe mais n'a pas pu être remis : ne PAS le faire annoncer
      // comme envoyé. Le dirigeant le renverra depuis le cockpit.
      res.json({
        envoye: false,
        consigne: "Dis que l'envoi n'a pas abouti, et que quelqu'un le renverra. N'insiste pas.",
      });
      return;

    default:
      // Tous les autres cas — hors mandat, sans IBAN, numéro non autorisé,
      // montant inconnu, refus de la banque, connecteur non configuré — se
      // présentent à l'agent de la MÊME façon. Il n'a pas à savoir pourquoi,
      // et surtout pas à le dire.
      res.json({
        envoye: false,
        consigne: "Dis que tu peux pas envoyer de lien maintenant, et propose de noter un règlement.",
      });
      return;
  }
});

export default router;
