import { Router, type IRouter } from "express";
import { withTenant, affairesTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { GetMargeStatsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/marge", async (req, res): Promise<void> => {
  const parsed = GetMargeStatsQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const tenantId = req.tenantId!;

  const { affaires, monthly } = await withTenant(tenantId, async (tx) => {
    let affaires = await tx.select().from(affairesTable);
    if (parsed.data.statut) {
      affaires = affaires.filter(a => a.status === parsed.data.statut);
    }

    const statusClause = parsed.data.statut
      ? sql`AND status = ${parsed.data.statut}`
      : sql``;
    const monthly = await tx.execute(sql`
      SELECT
        to_char(created_at, 'YYYY-MM') as month,
        coalesce(sum(invoiced_amount_cents), 0)::float as "revenueCents",
        coalesce(sum(margin_cents), 0)::float as "marginCents"
      FROM affaires
      WHERE created_at >= now() - interval '6 months'
      ${statusClause}
      GROUP BY to_char(created_at, 'YYYY-MM')
      ORDER BY month ASC
    `);

    return { affaires, monthly };
  });

  // Une marge INCONNUE n'est pas une marge NULLE. `?? 0` la faisait entrer dans
  // les totaux comme un zéro : une affaire dont personne n'a jamais calculé la
  // marge tirait la moyenne vers le bas et s'affichait « 0 % », ce qui se lit
  // « ce chantier n'a rien rapporté ». On ne totalise que le connu, et on dit
  // combien d'affaires ne le sont pas.
  const affairesMargeConnue = affaires.filter((a) => a.marginCents !== null);
  const affairesMargeInconnue = affaires.length - affairesMargeConnue.length;

  const totalRevenueCents = affaires.reduce((acc, a) => acc + (a.invoicedAmountCents ?? 0), 0);
  const totalMarginCents = affairesMargeConnue.length
    ? affairesMargeConnue.reduce((acc, a) => acc + (a.marginCents ?? 0), 0)
    : null;
  // Le CA de référence est celui des SEULES affaires à marge connue : rapporter
  // une marge partielle au CA total inventerait un pourcentage trop bas.
  const revenueMargeConnueCents = affairesMargeConnue.reduce(
    (acc, a) => acc + (a.invoicedAmountCents ?? 0),
    0,
  );
  const marginPct =
    totalMarginCents !== null && revenueMargeConnueCents > 0
      ? Math.round((totalMarginCents / revenueMargeConnueCents) * 1000) / 10
      : null;

  const margeAffaires = affaires
    .filter(a => (a.invoicedAmountCents ?? 0) > 0 || a.marginCents !== null)
    .map(a => ({
      id: a.id,
      label: a.label,
      clientName: a.clientName,
      status: a.status,
      invoicedAmountCents: a.invoicedAmountCents,
      /** `null` = marge non mesurée. À afficher comme telle, jamais comme 0. */
      marginCents: a.marginCents,
      marginPct: a.marginCents !== null && a.invoicedAmountCents && a.invoicedAmountCents > 0
        ? (a.marginCents / a.invoicedAmountCents) * 100
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
