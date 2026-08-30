import { Router, type IRouter } from "express";
import { withTenant, affairesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { GetMargeStatsQueryParams } from "@workspace/api-zod";
import { planPermetMargeChantier, MESSAGE_MARGE_EQUIPE } from "@nodaq/shared";
import { abonnementCourant } from "../lib/abonnement.js";
import { montantFactureParAffaire, montantFactureAffaire } from "../lib/montant-facture-affaire.js";
import { statutsCaSql } from "../lib/chiffreAffaires.js";

const router: IRouter = Router();

router.get("/marge", async (req, res): Promise<void> => {
  const parsed = GetMargeStatsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const tenantId = req.tenantId!;

  // Grille tarifaire (4.43 §3) : la marge par chantier est un contenu
  // d'Équipe, même en usage mono-utilisateur — c'est le chemin d'upgrade des
  // artisans qui grossissent sans embaucher. En Solo, l'écran affiche l'état
  // verrouillé que ce refus transporte (jamais un bouton mort). L'essai
  // (limites Équipe) passe : plan_id vaut 'equipe' pendant TRIAL.
  const abonnement = await abonnementCourant(tenantId);
  if (!planPermetMargeChantier(abonnement.planId)) {
    res.status(403).json({ error: MESSAGE_MARGE_EQUIPE, formule: "equipe_requise" });
    return;
  }

  const { affaires, monthly, factureParAffaire } = await withTenant(tenantId, async (tx) => {
    // Le montant facturé d'un chantier est DÉRIVÉ de ses factures : la colonne
    // `invoiced_amount_cents` n'est écrite par aucun chemin de facturation.
    const factureParAffaire = await montantFactureParAffaire(tx);
    let affaires = await tx.select().from(affairesTable);
    if (parsed.data.statut) {
      affaires = affaires.filter(a => a.status === parsed.data.statut);
    }

    const statusClause = parsed.data.statut
      ? sql`AND a.status = ${parsed.data.statut}`
      : sql``;
    /*
     * ── LA COURBE SUIT LES FACTURES, PLUS LA CRÉATION DU CHANTIER ───────────
     *
     * Elle groupait sur `affaires.created_at` en sommant `invoiced_amount_cents`
     * — deux fautes à la fois : la colonne n'est jamais écrite, donc la courbe
     * était plate à zéro ; et même alimentée, elle aurait rangé tout le chiffre
     * d'affaires d'un chantier dans le mois où il a été CRÉÉ, pas dans ceux où
     * il a été facturé. Un chantier ouvert en janvier et facturé en juin aurait
     * fait un pic en janvier.
     *
     * Le mois d'une recette, c'est la date d'émission de la facture.
     * La marge, elle, reste portée par le chantier : c'est la seule
     * granularité où elle est mesurée.
     */
    const monthly = await tx.execute(sql`
      SELECT
        to_char(f.issued_date::date, 'YYYY-MM') as month,
        coalesce(sum(CASE WHEN f.total_ht_cents > 0 THEN f.total_ht_cents ELSE f.amount_cents END), 0)::float as "revenueCents",
        coalesce(sum(a.margin_cents), 0)::float as "marginCents"
      FROM factures f
      JOIN affaires a ON a.id = f.affaire_id
      WHERE f.issued_date::date >= (now() - interval '6 months')::date
        AND f.statut IN (${statutsCaSql})
      ${statusClause}
      GROUP BY to_char(f.issued_date::date, 'YYYY-MM')
      ORDER BY month ASC
    `);

    return { affaires, monthly, factureParAffaire };
  });

  // Une marge INCONNUE n'est pas une marge NULLE. `?? 0` la faisait entrer dans
  // les totaux comme un zéro : une affaire dont personne n'a jamais calculé la
  // marge tirait la moyenne vers le bas et s'affichait « 0 % », ce qui se lit
  // « ce chantier n'a rien rapporté ». On ne totalise que le connu, et on dit
  // combien d'affaires ne le sont pas.
  /** Montant facturé retenu : les factures du chantier, sinon la saisie manuelle. */
  const facture = (a: { id: string; invoicedAmountCents: number | null }): number | null =>
    montantFactureAffaire(a.id, factureParAffaire, a.invoicedAmountCents);

  const affairesMargeConnue = affaires.filter((a) => a.marginCents !== null);
  const affairesMargeInconnue = affaires.length - affairesMargeConnue.length;

  const totalRevenueCents = affaires.reduce((acc, a) => acc + (facture(a) ?? 0), 0);
  const totalMarginCents = affairesMargeConnue.length
    ? affairesMargeConnue.reduce((acc, a) => acc + (a.marginCents ?? 0), 0)
    : null;
  // Le CA de référence est celui des SEULES affaires à marge connue : rapporter
  // une marge partielle au CA total inventerait un pourcentage trop bas.
  const revenueMargeConnueCents = affairesMargeConnue.reduce(
    (acc, a) => acc + (facture(a) ?? 0),
    0,
  );
  const marginPct =
    totalMarginCents !== null && revenueMargeConnueCents > 0
      ? Math.round((totalMarginCents / revenueMargeConnueCents) * 1000) / 10
      : null;

  const margeAffaires = affaires
    .filter(a => (facture(a) ?? 0) > 0 || a.marginCents !== null)
    .map(a => ({
      id: a.id,
      label: a.label,
      clientName: a.clientName,
      status: a.status,
      invoicedAmountCents: facture(a),
      /** `null` = marge non mesurée. À afficher comme telle, jamais comme 0. */
      marginCents: a.marginCents,
      marginPct: a.marginCents !== null && (facture(a) ?? 0) > 0
        ? (a.marginCents / (facture(a) as number)) * 100
        : null,
    }))
    .sort((a, b) => (b.invoicedAmountCents ?? 0) - (a.invoicedAmountCents ?? 0));

  res.json({
    totalRevenueCents,
    /** `null` = aucune marge mesurée sur la période. */
    totalMarginCents,
    marginPct,
    /** Combien d'affaires n'ont AUCUNE marge mesurée — l'écran doit le dire. */
    affairesMargeInconnue,
    affaires: margeAffaires,
    mensuelle: monthly.rows,
  });
});

export default router;
