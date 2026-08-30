/**
 * Abonnement — l'écran Réglages → Abonnement, et rien d'autre.
 *
 * Deux routeurs, comme `regles-relance.ts` : la LECTURE est `biz` (tout
 * membre voit la formule et les compteurs — un MEMBER qui prépare une
 * campagne doit savoir où en est le quota d'appels), l'ÉCRITURE est
 * `ownerOnly` (changer de formule engage le compte).
 *
 * ── Pas d'encaissement ici ────────────────────────────────────────────────
 * Stripe Billing est un ticket séparé. Ces routes posent l'état (formule,
 * périodicité, module) et sa trace — aucun paiement n'est déclenché.
 *
 * ── Immédiat ou à l'échéance ──────────────────────────────────────────────
 * Passer à une formule PLUS CHÈRE (ou souscrire depuis l'essai / la lecture
 * seule) prend effet immédiatement. Revenir à une formule MOINS CHÈRE prend
 * effet à l'échéance de la période en cours : ce qui est payé reste dû, et
 * personne ne perd en cours de mois une capacité qu'il a réglée.
 * L'offre Fondateurs est à part : la souscrire, c'est réclamer une des 50
 * places — toujours immédiat, et `price_locked_at` matérialise le
 * « garanti à vie ».
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";
import { withTenant, subscriptionsTable, activityTable } from "@workspace/db";
import { PLAN_IDS, PERIODICITES } from "@nodaq/shared";
import {
  abonnementCourant,
  constaterJalonsEssai,
  etatAbonnement,
  placesFondateurs,
  reclamerPlaceFondateurs,
  tousLesPlans,
} from "../lib/abonnement.js";
import { messageValidation } from "../lib/message-validation.js";

export const abonnementReadRouter: IRouter = Router();
export const abonnementWriteRouter: IRouter = Router();

abonnementReadRouter.get("/abonnement", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  // Jalons d'essai (4.43 §5) : constatés à l'occasion de la lecture, sans
  // retarder la réponse — l'unicité en base rend le tir concurrent inoffensif.
  void constaterJalonsEssai(tenantId).catch(() => {});
  const etat = await etatAbonnement(tenantId);
  const fondateurs = await placesFondateurs();
  const plans = await tousLesPlans();
  res.json({ ...etat, fondateurs, plans });
});

/** Fin de la période en cours, faute d'échéancier de facturation (Stripe est
 *  un ticket séparé) : l'anniversaire du dernier changement de formule. */
function finDePeriode(depuis: Date, periodicite: string): Date {
  const fin = new Date(depuis);
  if (periodicite === "ANNUEL") fin.setFullYear(fin.getFullYear() + 1);
  else fin.setMonth(fin.getMonth() + 1);
  return fin;
}

const CorpsFormule = z.object({
  planId: z.enum(PLAN_IDS),
  periodicite: z.enum(PERIODICITES).optional(),
});

abonnementWriteRouter.post("/abonnement/formule", async (req, res): Promise<void> => {
  const parsed = CorpsFormule.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: messageValidation(parsed.error) });
    return;
  }
  const tenantId = req.tenantId!;
  const email = req.session?.email ?? null;
  const { planId } = parsed.data;

  const sub = await abonnementCourant(tenantId);
  const plans = await tousLesPlans();
  const cible = plans.find((p) => p.id === planId)!;
  const courant = plans.find((p) => p.id === sub.planId)!;
  const periodicite =
    parsed.data.periodicite ?? (sub.periodicite as (typeof PERIODICITES)[number]);

  if (periodicite === "ANNUEL" && cible.prixAnnuelCents === null) {
    res.status(422).json({
      error: "Cette formule n'existe pas en version annuelle.",
    });
    return;
  }
  if (sub.statut === "ACTIVE" && sub.planId === planId && sub.periodicite === periodicite) {
    res.status(409).json({ error: "C'est déjà votre formule actuelle." });
    return;
  }
  if (sub.priceLockedAt && sub.planId === "fondateurs" && planId !== "fondateurs") {
    // Quitter Fondateurs est permis, mais il faut le dire : la place et le
    // prix garanti à vie ne se retrouvent pas.
    if (req.body?.confirmeAbandonFondateurs !== true) {
      res.status(409).json({
        error:
          "Votre tarif Fondateurs est garanti à vie tant que vous le gardez. Le quitter est définitif : l'offre est réservée aux 50 premiers, votre place ne vous sera pas réservée. Confirmez pour continuer.",
        confirmationRequise: "confirmeAbandonFondateurs",
      });
      return;
    }
  }

  const resultat = await withTenant(tenantId, async (tx) => {
    // Souscription depuis l'essai ou la lecture seule, ou montée en gamme :
    // effet immédiat. Retour vers une formule aux capacités MOINDRES : à
    // l'échéance. Le critère est la capacité, pas le prix — quitter
    // Fondateurs (29 €, tout Équipe) pour Solo (49 €) coûte PLUS cher et
    // reste un retour : appliqué en cours de mois, il couperait l'accès de
    // l'équipe du jour au lendemain.
    const souscription = sub.statut !== "ACTIVE";
    const rang: Record<string, number> = { solo: 1, equipe: 2, fondateurs: 2 };
    const immediat =
      souscription ||
      planId === "fondateurs" ||
      (rang[planId] ?? 0) >= (rang[sub.planId] ?? 0);

    if (planId === "fondateurs") {
      const place = await reclamerPlaceFondateurs(tx);
      if (!place) return { kind: "fondateurs_ferme" as const };
    }

    if (immediat) {
      await tx
        .update(subscriptionsTable)
        .set({
          planId,
          periodicite,
          statut: "ACTIVE",
          trialEndsAt: null,
          planSuivant: null,
          echeance: null,
          priceLockedAt: planId === "fondateurs" ? new Date() : sub.priceLockedAt,
          updatedAt: new Date(),
        })
        .where(eq(subscriptionsTable.id, sub.id));
      await tx.insert(activityTable).values({
        tenantId,
        type: souscription ? "abonnement.souscrit" : "abonnement.change",
        label: souscription
          ? `Abonnement ${cible.libelle} souscrit (${periodicite === "ANNUEL" ? "annuel, deux mois offerts" : "mensuel"}).`
          : `Formule changée : ${courant.libelle} → ${cible.libelle}, effet immédiat.`,
        meta: JSON.stringify({ dePlan: sub.planId, versPlan: planId, periodicite, par: email }),
      });
      return { kind: "immediat" as const };
    }

    const echeance = finDePeriode(sub.updatedAt, sub.periodicite);
    await tx
      .update(subscriptionsTable)
      .set({ planSuivant: planId, echeance, updatedAt: sub.updatedAt })
      .where(eq(subscriptionsTable.id, sub.id));
    await tx.insert(activityTable).values({
      tenantId,
      type: "abonnement.change_programme",
      label: `Retour vers ${cible.libelle} programmé pour la fin de la période en cours (${echeance.toLocaleDateString("fr-FR")}). Rien ne change d'ici là.`,
      meta: JSON.stringify({ dePlan: sub.planId, versPlan: planId, echeance, par: email }),
    });
    return { kind: "echeance" as const, echeance };
  });

  if (resultat.kind === "fondateurs_ferme") {
    res.status(409).json({
      error:
        "L'offre Fondateurs est complète : les 50 places sont prises. Les formules Solo et Équipe restent ouvertes.",
    });
    return;
  }
  const etat = await etatAbonnement(tenantId);
  res.json({
    ...etat,
    effet: resultat.kind === "immediat" ? "immediat" : "a_l_echeance",
    ...(resultat.kind === "echeance" ? { echeance: resultat.echeance } : {}),
  });
});

const CorpsModule = z.object({ actif: z.boolean() });

abonnementWriteRouter.post("/abonnement/module-vocal", async (req, res): Promise<void> => {
  const parsed = CorpsModule.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: messageValidation(parsed.error) });
    return;
  }
  const tenantId = req.tenantId!;
  const email = req.session?.email ?? null;
  const sub = await abonnementCourant(tenantId);
  const plans = await tousLesPlans();
  const module = plans.find((p) => p.id === "module_vocal")!;

  if (sub.moduleVocal === parsed.data.actif) {
    res.status(409).json({
      error: parsed.data.actif ? "Le module est déjà actif." : "Le module est déjà désactivé.",
    });
    return;
  }

  await withTenant(tenantId, async (tx) => {
    await tx
      .update(subscriptionsTable)
      .set({
        moduleVocal: parsed.data.actif,
        moduleVocalDepuis: parsed.data.actif ? new Date() : sub.moduleVocalDepuis,
        updatedAt: new Date(),
      })
      .where(
        and(eq(subscriptionsTable.id, sub.id), sql`${subscriptionsTable.moduleVocal} = ${sub.moduleVocal}`),
      );
    await tx.insert(activityTable).values({
      tenantId,
      type: parsed.data.actif ? "abonnement.module_vocal_active" : "abonnement.module_vocal_coupe",
      label: parsed.data.actif
        ? `Module Relance vocale activé : ${(module.prixMensuelCents / 100).toLocaleString("fr-FR")} € HT/mois, ${module.dossiersInclus} dossiers de relance inclus par mois, puis ${((module.prixDossierSuppCents ?? 0) / 100).toLocaleString("fr-FR")} € HT par dossier — un dossier est un impayé relancé dans le mois, quel que soit le nombre d'appels. Activer le module vaut acceptation de ce tarif.`
        : "Module Relance vocale désactivé. Les dossiers du mois déjà ouverts restent comptés.",
      meta: JSON.stringify({ par: email }),
    });
  });

  res.json(await etatAbonnement(tenantId));
});
