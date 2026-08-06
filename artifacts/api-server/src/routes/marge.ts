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

  const totalRevenueCents = affaires.reduce((acc, a) => acc + (a.invoicedAmountCents ?? 0), 0);
  const totalMarginCents  = affaires.reduce((acc, a) => acc + (a.marginCents ?? 0), 0);
  const marginPct         = totalRevenueCents > 0 ? (totalMarginCents / totalRevenueCents) * 100 : 0;

  const margeAffaires = affaires
    .filter(a => (a.invoicedAmountCents ?? 0) > 0 || (a.marginCents ?? 0) !== 0)
    .map(a => ({
      id: a.id,
      label: a.label,
      clientName: a.clientName,
      status: a.status,
      invoicedAmountCents: a.invoicedAmountCents,
      marginCents: a.marginCents,
      marginPct: a.invoicedAmountCents && a.invoicedAmountCents > 0
        ? ((a.marginCents ?? 0) / a.invoicedAmountCents) * 100
        : null,
    }))
    .sort((a, b) => (b.invoicedAmountCents ?? 0) - (a.invoicedAmountCents ?? 0));

  res.json({
    totalRevenueCents,
    totalMarginCents,
    marginPct: Math.round(marginPct * 10) / 10,
    affaires: margeAffaires,
    mensuelle: monthly.rows,
  });
});

export default router;
