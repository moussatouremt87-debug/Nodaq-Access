import { Router, type IRouter } from "express";
import { withTenant, affairesTable, contratsTable, facturesTable, prospectsTable, pendingActionsTable, activityTable } from "@workspace/db";
import { sql, eq, and } from "drizzle-orm";
import {
  toDateString,
  debutExercice,
  debutExercicePrecedent,
  memeJourExercicePrecedent,
} from "@nodaq/shared";

const router: IRouter = Router();

router.get("/cockpit/kpis", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;

  const data = await withTenant(tenantId, async (tx) => {
    const [affairesEnCours] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(affairesTable)
      .where(eq(affairesTable.status, "EN_COURS"));

    const now = new Date();
    // Date métier d'émission, en composantes locales. `created_at` est la date
    // d'insertion de la ligne : une facture saisie le 28 décembre et émise le
    // 3 janvier tombait sur le mauvais exercice.
    const firstOfMonth = toDateString(new Date(now.getFullYear(), now.getMonth(), 1));
    const [caMonth] = await tx
      .select({ total: sql<number>`coalesce(sum(amount_cents), 0)` })
      .from(facturesTable)
      // PAS de filtre `settled` : le chiffre d'affaires est ce qui est
      // FACTURÉ. Filtrer sur l'encaissement donnait le règlement reçu sous le
      // nom de « chiffre d'affaires » — deux notions qu'un artisan distingue
      // parfaitement et qu'on lui mélangeait.
      .where(sql`issued_date::date >= ${firstOfMonth}::date`);

    const [facturesEnAttente] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(facturesTable)
      .where(eq(facturesTable.settled, false));

    const [totalImpaye] = await tx
      .select({ total: sql<number>`coalesce(sum(amount_cents), 0)` })
      .from(facturesTable)
      .where(eq(facturesTable.settled, false));

    const [prospectsPipeline] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(prospectsTable)
      .where(sql`stage NOT IN ('GAGNE', 'PERDU')`);

    const [contratsActifs] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(contratsTable)
      .where(eq(contratsTable.status, "ACTIF"));

    const [pendingCount] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(pendingActionsTable)
      .where(eq(pendingActionsTable.status, "EN_ATTENTE"));

    // Monthly revenue series (last 6 months)
    const monthlySeries = await tx.execute(sql`
      SELECT
        to_char(date_trunc('month', issued_date::date), 'YYYY-MM') as month,
        coalesce(sum(amount_cents), 0)::int as "revenueCents",
        count(*)::int as "invoiceCount"
      FROM factures
      WHERE issued_date::date >= (CURRENT_DATE - interval '6 months')
      GROUP BY date_trunc('month', issued_date::date)
      ORDER BY month ASC
    `);

    // ── YTD (year-to-date) ────────────────────────────────────────────────────
    const firstOfYear     = debutExercice(now);
    const firstOfLastYear = debutExercicePrecedent(now);
    // Le recollage de composantes produisait « 2027-02-29 » un 29 février quand
    // le millésime précédent n'est pas bissextile : date inexistante, requête
    // en échec. La borne est désormais ramenée au dernier jour du mois visé.
    const sameDayLastYear = memeJourExercicePrecedent(now);

    const [caYtdRow] = await tx
      .select({ total: sql<number>`coalesce(sum(amount_cents), 0)` })
      .from(facturesTable)
      .where(sql`issued_date::date >= ${firstOfYear}::date`);

    const [caPrevYearRow] = await tx
      .select({ total: sql<number>`coalesce(sum(amount_cents), 0)` })
      .from(facturesTable)
      .where(and(
        sql`issued_date::date >= ${firstOfLastYear}::date`,
        sql`issued_date::date <  ${sameDayLastYear}::date`,
      ));

    const [facturesYtdRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(facturesTable)
      .where(sql`issued_date::date >= ${firstOfYear}::date`);

    // Le taux de recouvrement, LUI, parle bien d'encaissement : `settled` y est
    // à sa place. C'est le seul endroit de ce fichier où il l'est.
    const recRow = await tx.execute(sql`
      SELECT
        coalesce(sum(CASE WHEN settled = true THEN amount_cents ELSE 0 END), 0)::float AS paid,
        coalesce(sum(amount_cents), 0)::float AS total
      FROM factures
      WHERE issued_date::date >= ${firstOfYear}::date
    `);

    return {
      affairesEnCours,
      caMonth,
      facturesEnAttente,
      totalImpaye,
      prospectsPipeline,
      contratsActifs,
      pendingCount,
      monthlySeries: monthlySeries.rows ?? [],
      caYtdRow,
      caPrevYearRow,
      facturesYtdRow,
      recRow,
    };
  });

  const now = new Date();
  const caYtdCents              = data.caYtdRow?.total ?? 0;
  const caPrevYearSamePeriodCents = data.caPrevYearRow?.total ?? 0;
  const caGrowthPct             = caPrevYearSamePeriodCents > 0
    ? Math.round(((caYtdCents - caPrevYearSamePeriodCents) / caPrevYearSamePeriodCents) * 100)
    : null;
  const recPaid  = Number(data.recRow.rows[0]?.paid  ?? 0);
  const recTotal = Number(data.recRow.rows[0]?.total ?? 0);
  const tauxRecouvrement = recTotal > 0 ? Math.round((recPaid / recTotal) * 100) : 0;

  res.json({
    affairesEnCours: data.affairesEnCours?.count ?? 0,
    chiffreAffairesMois: data.caMonth?.total ?? 0,
    facturesEnAttente: data.facturesEnAttente?.count ?? 0,
    totalImpayeCents: data.totalImpaye?.total ?? 0,
    prospectsPipeline: data.prospectsPipeline?.count ?? 0,
    contratsActifs: data.contratsActifs?.count ?? 0,
    pendingActionsCount: data.pendingCount?.count ?? 0,
    treasuryBalanceCents: null,
    monthlySeries: data.monthlySeries,
    ytd: {
      caYtdCents,
      caPrevYearSamePeriodCents,
      caGrowthPct,
      facturesEmisesYtd: data.facturesYtdRow?.count ?? 0,
      tauxRecouvrement,
    },
  });
});

router.get("/cockpit/activity", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;

  const items = await withTenant(tenantId, async (tx) => {
    return tx
      .select()
      .from(activityTable)
      .orderBy(sql`created_at DESC`)
      .limit(20);
  });

  res.json(items.map(i => ({
    id: i.id,
    type: i.type,
    label: i.label,
    meta: i.meta ?? null,
    createdAt: i.createdAt,
  })));
});

export default router;
