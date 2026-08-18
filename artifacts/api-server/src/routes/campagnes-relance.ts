/**
 * Campagnes de relance vocale — ticket 4.18, US-1.
 *
 * PROPOSER une campagne ne compose aucun appel : ça crée une `pending_action`
 * dans la file existante du cockpit. La règle 4 du CLAUDE.md n'admet pas
 * d'exception ici, et le ticket l'écrit noir sur blanc — « aucun appel n'est
 * composé sans pending_action approuvée », y compris « juste pour tester ».
 *
 * On réutilise la file existante plutôt que d'inventer un mécanisme : le
 * groupe `relances` de `PENDING_ACTION_GROUPS` accueille déjà `send_dunning`
 * (la relance écrite) ; l'appel vocal y devient `call_dunning`.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withTenant, campagnesRelanceTable, pendingActionsTable } from "@workspace/db";
import { depassementsMandat, restreindreMandat, mandatEstRestreint } from "@nodaq/shared";
import {
  TYPE_CAMPAGNE_RELANCE,
  regleEnVigueur,
  listerCampagnes,
} from "../lib/campagnes-relance.js";

export const campagnesRelanceReadRouter: IRouter = Router();
export const campagnesRelanceWriteRouter: IRouter = Router();

const AppelPropose = z.object({
  clientId: z.string().nullable().default(null),
  factureId: z.string().min(1),
  montantCents: z.number().int().nonnegative(),
  numero: z.string().min(1),
  clientNom: z.string().min(1),
});

const DemandeMandat = z
  .object({
    echelonnementAutorise: z.boolean(),
    maxVersements: z.number().int(),
    delaiMaxPremierVersementJours: z.number().int(),
    retardMaxJours: z.number().int(),
    lienPaiementAutorise: z.boolean(),
    remiseAutorisee: z.boolean(),
  })
  .partial();

const CorpsCampagne = z.object({
  appels: z.array(AppelPropose).min(1),
  /** Restrictions demandées. Absent = on garde la règle du tenant. */
  mandat: DemandeMandat.optional(),
  fenetreDebutHeure: z.number().int().min(0).max(23).optional(),
  fenetreFinHeure: z.number().int().min(1).max(24).optional(),
  maxTentatives: z.number().int().min(1).max(5).optional(),
});

campagnesRelanceReadRouter.get("/relance/campagnes", async (req, res): Promise<void> => {
  res.json({ campagnes: await listerCampagnes(req.tenantId!) });
});

campagnesRelanceWriteRouter.post("/relance/campagnes", async (req, res): Promise<void> => {
  const parsed = CorpsCampagne.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { appels, mandat: demande, ...fenetre } = parsed.data;

  if (fenetre.fenetreDebutHeure !== undefined && fenetre.fenetreFinHeure !== undefined
      && fenetre.fenetreFinHeure <= fenetre.fenetreDebutHeure) {
    res.status(400).json({
      error: "La fenêtre d'appel doit se fermer après s'être ouverte.",
    });
    return;
  }

  const tenantId = req.tenantId!;

  const resultat = await withTenant(tenantId, async (tx) => {
    const { regle } = await regleEnVigueur(tx, tenantId);

    // Ce qui est ENREGISTRÉ est déjà restreint : même si la campagne n'est pas
    // encore validée, aucun mandat plus large que la règle ne doit exister en
    // base, fût-ce à l'état de proposition. Il sera recalculé au gel, contre la
    // règle qui vaudra à ce moment-là.
    const mandatPropose = restreindreMandat(regle, demande ?? {});
    const depassements = depassementsMandat(regle, demande ?? {});

    const [action] = await tx
      .insert(pendingActionsTable)
      .values({
        tenantId,
        type: TYPE_CAMPAGNE_RELANCE,
        label: `Relance téléphonique — ${appels.length} appel${appels.length > 1 ? "s" : ""}`,
        description:
          "Chaque appel de cette liste sera passé par l'assistant vocal, dans les limites du mandat ci-dessous.",
        amountCents: appels.reduce((total, a) => total + a.montantCents, 0),
        payload: { appels, mandat: mandatPropose },
      })
      .returning();

    const [campagne] = await tx
      .insert(campagnesRelanceTable)
      .values({
        tenantId,
        pendingActionId: action!.id,
        appels,
        mandat: mandatPropose,
        ...fenetre,
      })
      .returning();

    return { action: action!, campagne: campagne!, mandatPropose, depassements, regle };
  });

  res.status(201).json({
    campagne: resultat.campagne,
    pendingActionId: resultat.action.id,
    mandat: resultat.mandatPropose,
    /** Non vide = l'appelant a demandé plus large que la règle ; c'est ramené. */
    depassements: resultat.depassements,
    restreintLaRegle: mandatEstRestreint(resultat.regle, resultat.mandatPropose),
  });
});

/** Retirer un débiteur de la liste avant validation (US-1). */
const ExclureParams = z.object({ id: z.string().min(1), factureId: z.string().min(1) });

campagnesRelanceWriteRouter.delete(
  "/relance/campagnes/:id/appels/:factureId",
  async (req, res): Promise<void> => {
    const params = ExclureParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const tenantId = req.tenantId!;

    const resultat = await withTenant(tenantId, async (tx) => {
      const [campagne] = await tx
        .select()
        .from(campagnesRelanceTable)
        .where(eq(campagnesRelanceTable.id, params.data.id));

      if (!campagne) return { kind: "introuvable" as const };
      // Après validation, la liste est celle qui a été approuvée : la modifier
      // reviendrait à faire passer des appels que personne n'a validés.
      if (campagne.statut !== "PROPOSEE") return { kind: "verrouillee" as const };

      const restants = campagne.appels.filter((a) => a.factureId !== params.data.factureId);
      if (restants.length === campagne.appels.length) return { kind: "absent" as const };

      await tx
        .update(campagnesRelanceTable)
        .set({ appels: restants })
        .where(eq(campagnesRelanceTable.id, campagne.id));

      // La file de validation doit montrer la même liste que la campagne.
      await tx
        .update(pendingActionsTable)
        .set({
          payload: { appels: restants, mandat: campagne.mandat },
          label: `Relance téléphonique — ${restants.length} appel${restants.length > 1 ? "s" : ""}`,
          amountCents: restants.reduce((t, a) => t + a.montantCents, 0),
        })
        .where(eq(pendingActionsTable.id, campagne.pendingActionId));

      return { kind: "ok" as const, appels: restants };
    });

    switch (resultat.kind) {
      case "introuvable":
        res.status(404).json({ error: "Campagne introuvable." });
        return;
      case "verrouillee":
        res.status(409).json({
          error:
            "Cette campagne est déjà validée : sa liste d'appels ne peut plus changer. Créez-en une nouvelle.",
        });
        return;
      case "absent":
        res.status(404).json({ error: "Cet appel ne fait pas partie de la campagne." });
        return;
      case "ok":
        res.json({ appels: resultat.appels });
        return;
    }
  },
);

/** La campagne portée par une action de la file — ce que l'écran de validation lit. */
campagnesRelanceReadRouter.get(
  "/relance/campagnes/par-action/:pendingActionId",
  async (req, res): Promise<void> => {
    const id = String(req.params["pendingActionId"] ?? "");
    if (!id) {
      res.status(400).json({ error: "Identifiant d'action manquant." });
      return;
    }
    const tenantId = req.tenantId!;

    const resultat = await withTenant(tenantId, async (tx) => {
      const [campagne] = await tx
        .select()
        .from(campagnesRelanceTable)
        .where(eq(campagnesRelanceTable.pendingActionId, id));
      if (!campagne) return null;
      const { regle, version } = await regleEnVigueur(tx, tenantId);
      return { campagne, regle, version };
    });

    if (!resultat) {
      res.status(404).json({ error: "Aucune campagne pour cette action." });
      return;
    }

    res.json({
      campagne: resultat.campagne,
      /* La règle sert au panneau à dire ce qu'il PEUT proposer : un curseur qui
         irait au-delà serait une invitation à demander l'impossible. */
      regle: resultat.regle,
      regleVersion: resultat.version,
      restreintLaRegle: mandatEstRestreint(resultat.regle, resultat.campagne.mandat),
    });
  },
);

/**
 * Resserrer le mandat d'une campagne avant validation (US-1).
 *
 * Ne peut que RESTREINDRE : la demande passe par `restreindreMandat` contre la
 * règle en vigueur, exactement comme à la création. Il n'existe donc aucun
 * chemin — écran, appel direct, corps forgé — par lequel une campagne
 * obtiendrait plus que ce que le dirigeant a autorisé à froid.
 */
campagnesRelanceWriteRouter.patch(
  "/relance/campagnes/:id/mandat",
  async (req, res): Promise<void> => {
    const parsed = DemandeMandat.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const id = String(req.params["id"] ?? "");
    const tenantId = req.tenantId!;

    const resultat = await withTenant(tenantId, async (tx) => {
      const [campagne] = await tx
        .select()
        .from(campagnesRelanceTable)
        .where(eq(campagnesRelanceTable.id, id));
      if (!campagne) return { kind: "introuvable" as const };
      // Après validation, le mandat est GELÉ : le modifier exige une nouvelle
      // validation, c'est le texte même de l'US-1.
      if (campagne.statut !== "PROPOSEE") return { kind: "gele" as const };

      const { regle } = await regleEnVigueur(tx, tenantId);
      const mandat = restreindreMandat(regle, parsed.data);
      const depassements = depassementsMandat(regle, parsed.data);

      await tx
        .update(campagnesRelanceTable)
        .set({ mandat })
        .where(eq(campagnesRelanceTable.id, campagne.id));

      // La file montre le mandat que le dirigeant est en train d'approuver.
      await tx
        .update(pendingActionsTable)
        .set({ payload: { appels: campagne.appels, mandat } })
        .where(eq(pendingActionsTable.id, campagne.pendingActionId));

      return { kind: "ok" as const, mandat, depassements, regle };
    });

    switch (resultat.kind) {
      case "introuvable":
        res.status(404).json({ error: "Campagne introuvable." });
        return;
      case "gele":
        res.status(409).json({
          error:
            "Le mandat de cette campagne est figé depuis sa validation. Créez une nouvelle campagne pour le changer.",
        });
        return;
      case "ok":
        res.json({
          mandat: resultat.mandat,
          depassements: resultat.depassements,
          restreintLaRegle: mandatEstRestreint(resultat.regle, resultat.mandat),
        });
        return;
    }
  },
);

export default campagnesRelanceReadRouter;
