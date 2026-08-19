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
  type MandatCampagne,
  type RegleRelance,
} from "@nodaq/shared";
import { loadCompanySettings } from "../lib/seller-info.js";

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
  res.json({ ok: true });
});

export default router;
