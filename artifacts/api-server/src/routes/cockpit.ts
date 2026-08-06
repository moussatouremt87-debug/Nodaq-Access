import { Router, type IRouter } from "express";
import { db, affairesTable, contratsTable, facturesTable, prospectsTable, pendingActionsTable, activityTable } from "@workspace/db";
import { sql, eq, and } from "drizzle-orm";

const router: IRouter = Router();

router.get("/cockpit/kpis", async (req, res): Promise<void> => {
  const [affairesEnCours] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(affairesTable)
    .where(eq(affairesTable.status, "EN_COURS"));

  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const [caMonth] = await db
    .select({ total: sql<number>`coalesce(sum(amount_cents), 0)` })
    .from(facturesTable)
    .where(and(
      eq(facturesTable.settled, true),
      sql`created_at >= ${firstOfMonth}`
    ));

  const [facturesEnAttente] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(facturesTable)
    .where(eq(facturesTable.settled, false));

  const [totalImpaye] = await db
    .select({ total: sql<number>`coalesce(sum(amount_cents), 0)` })
    .from(facturesTable)
    .where(eq(facturesTable.settled, false));

  const [prospectsPipeline] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(prospectsTable)
    .where(sql`stage NOT IN ('GAGNE', 'PERDU')`);

  const [contratsActifs] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(contratsTable)
    .where(eq(contratsTable.status, "ACTIF"));

  const [pendingCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pendingActionsTable)
    .where(eq(pendingActionsTable.status, "EN_ATTENTE"));

  // Monthly revenue series (last 6 months)
  const monthlySeries = await db.execute(sql`
    SELECT
      to_char(date_trunc('month', created_at), 'YYYY-MM') as month,
      coalesce(sum(amount_cents), 0)::int as "revenueCents",
      count(*)::int as "invoiceCount"
    FROM factures
    WHERE settled = true AND created_at >= now() - interval '6 months'
    GROUP BY date_trunc('month', created_at)
    ORDER BY month ASC
  `);

  // ── YTD (year-to-date) ────────────────────────────────────────────────────
  const year = now.getFullYear();
  const firstOfYear    = `${year}-01-01`;
  const firstOfLastYear = `${year - 1}-01-01`;
  // Same calendar day last year (apples-to-apples comparison)
  const sameDayLastYear = `${year - 1}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const [caYtdRow] = await db
    .select({ total: sql<number>`coalesce(sum(amount_cents), 0)` })
    .from(facturesTable)
    .where(and(eq(facturesTable.settled, true), sql`created_at >= ${firstOfYear}`));

  const [caPrevYearRow] = await db
    .select({ total: sql<number>`coalesce(sum(amount_cents), 0)` })
    .from(facturesTable)
    .where(and(
      eq(facturesTable.settled, true),
      sql`created_at >= ${firstOfLastYear}`,
      sql`created_at <  ${sameDayLastYear}`,
    ));

  const [facturesYtdRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(facturesTable)
    .where(sql`created_at >= ${firstOfYear}`);

  const recRow = await db.execute(sql`
    SELECT
      coalesce(sum(CASE WHEN settled = true THEN amount_cents ELSE 0 END), 0)::float AS paid,
      coalesce(sum(amount_cents), 0)::float AS total
    FROM factures
    WHERE created_at >= ${firstOfYear}
  `);

  const caYtdCents              = caYtdRow?.total ?? 0;
  const caPrevYearSamePeriodCents = caPrevYearRow?.total ?? 0;
  const caGrowthPct             = caPrevYearSamePeriodCents > 0
    ? Math.round(((caYtdCents - caPrevYearSamePeriodCents) / caPrevYearSamePeriodCents) * 100)
    : null;
  const recPaid  = Number(recRow.rows[0]?.paid  ?? 0);
  const recTotal = Number(recRow.rows[0]?.total ?? 0);
  const tauxRecouvrement = recTotal > 0 ? Math.round((recPaid / recTotal) * 100) : 0;

  res.json({
    affairesEnCours: affairesEnCours?.count ?? 0,
    chiffreAffairesMois: caMonth?.total ?? 0,
    facturesEnAttente: facturesEnAttente?.count ?? 0,
    totalImpayeCents: totalImpaye?.total ?? 0,
    prospectsPipeline: prospectsPipeline?.count ?? 0,
    contratsActifs: contratsActifs?.count ?? 0,
    pendingActionsCount: pendingCount?.count ?? 0,
    treasuryBalanceCents: null,
    monthlySeries: monthlySeries.rows ?? [],
    ytd: {
      caYtdCents,
      caPrevYearSamePeriodCents,
      caGrowthPct,
      facturesEmisesYtd: facturesYtdRow?.count ?? 0,
      tauxRecouvrement,
    },
  });
});

router.get("/cockpit/activity", async (_req, res): Promise<void> => {
  const items = await db
    .select()
    .from(activityTable)
    .orderBy(sql`created_at DESC`)
    .limit(20);

  res.json(items.map(i => ({
    id: i.id,
    type: i.type,
    label: i.label,
    meta: i.meta ?? null,
    createdAt: i.createdAt,
  })));
});

export default router;
