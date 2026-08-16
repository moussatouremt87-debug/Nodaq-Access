import { Router, type IRouter } from "express";
import { withTenant, affairesTable, contratsTable, facturesTable, prospectsTable, pendingActionsTable, activityTable, incidentsFacturationTable, bankAccountsTable } from "@workspace/db";
import { sql, eq, isNull } from "drizzle-orm";
import {
  toDateString,
  debutExercice,
  debutExercicePrecedent,
  memeJourExercicePrecedent,
  hasFinancialAccess,
} from "@nodaq/shared";
import { caNetCentsSql, nbFacturesCaSql, conditionFactureCa } from "../lib/chiffreAffaires.js";
import { maskFinancialFields } from "../lib/maskFinancialFields.js";

const router: IRouter = Router();

function execRows<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

router.get("/cockpit/kpis", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  // Un incident de facturation révèle une incohérence de FACTURATION —
  // exactement le genre de sujet réservé au propriétaire/comptable ailleurs
  // dans ce fichier (cf. /cockpit/objectifs). Un MEMBER ne le voit pas :
  // `null`, pas `0`, pour ne jamais laisser croire qu'il n'y a rien à
  // vérifier. Même garde pour tout le chiffre d'affaires ci-dessous.
  const financier = hasFinancialAccess(req.session?.role);

  const data = await withTenant(tenantId, async (tx) => {
    const [affairesEnCours] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(affairesTable)
      .where(eq(affairesTable.status, "EN_COURS"));

    const now = new Date();
    // Date métier d'émission, en composantes locales. `created_at` est la date
    // d'insertion de la ligne : une facture saisie le 28 décembre et émise le
    // 3 janvier tombait sur le mauvais exercice.
    //
    // La définition du CA — liste blanche de statuts, avoirs déduits, jamais de
    // filtre `settled` — vit dans `lib/chiffreAffaires.ts`. Le raisonnement qui
    // interdit de déduire deux fois y est écrit en entier ; ne le ré-invente
    // pas ici.
    const firstOfMonth = toDateString(new Date(now.getFullYear(), now.getMonth(), 1));
    const [caMonth] = execRows<{ total: number }>(
      await tx.execute(sql`SELECT ${caNetCentsSql({ debut: firstOfMonth })} AS total`),
    );

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

    // `count` distingue « pas encore connecté » (aucune ligne, treasuryBalanceCents
    // reste null) de « connecté mais soldes à zéro » (une ligne existe, la somme
    // fait foi même si elle vaut 0) — même doctrine que incidentsFacturationCount
    // ci-dessus : null n'est jamais confondu avec une vraie valeur nulle.
    const [tresorerie] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<number>`coalesce(sum(balance_cents), 0)::int`,
      })
      .from(bankAccountsTable);

    // Distinct du compteur ci-dessus : un incident de facturation n'est PAS
    // une action à valider (CLAUDE.md §4) — le mélanger fausserait ce que le
    // cockpit annonce pouvoir résoudre d'un clic. Requête posée seulement
    // pour OWNER/ACCOUNTANT : inutile de l'exécuter pour un rôle qui ne la
    // verra pas.
    const incidentsFacturationCount = financier
      ? (await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(incidentsFacturationTable)
          .where(isNull(incidentsFacturationTable.resoluLe)))[0]
      : undefined;

    // Série mensuelle sur six mois — même définition du CA que partout
    // ailleurs. Les avoirs entrent comme des lignes négatives dans le mois où
    // ils sont émis, et ne comptent pas dans `invoiceCount` : un avoir n'est
    // pas une facture.
    const sixMois = toDateString(new Date(now.getFullYear(), now.getMonth() - 6, 1));
    const monthlySeries = await tx.execute(sql`
      SELECT
        to_char(mois, 'YYYY-MM') as month,
        sum(montant)::int as "revenueCents",
        sum(nb)::int as "invoiceCount"
      FROM (
        SELECT date_trunc('month', issued_date::date) AS mois,
               amount_cents AS montant,
               1 AS nb
          FROM factures
         WHERE ${conditionFactureCa({ debut: sixMois })}
        UNION ALL
        SELECT date_trunc('month', issued_date),
               -(montant_ht_cents + montant_tva_cents),
               0
          FROM avoirs
         WHERE issued_date >= ${sixMois}::date
      ) t
      GROUP BY mois
      ORDER BY month ASC
    `);

    // ── YTD (year-to-date) ────────────────────────────────────────────────────
    const firstOfYear     = debutExercice(now);
    const firstOfLastYear = debutExercicePrecedent(now);
    // Le recollage de composantes produisait « 2027-02-29 » un 29 février quand
    // le millésime précédent n'est pas bissextile : date inexistante, requête
    // en échec. La borne est désormais ramenée au dernier jour du mois visé.
    const sameDayLastYear = memeJourExercicePrecedent(now);

    const [caYtdRow] = execRows<{ total: number }>(
      await tx.execute(sql`SELECT ${caNetCentsSql({ debut: firstOfYear })} AS total`),
    );

    const [caPrevYearRow] = execRows<{ total: number }>(
      await tx.execute(sql`
        SELECT ${caNetCentsSql({ debut: firstOfLastYear, finExclue: sameDayLastYear })} AS total
      `),
    );

    const [facturesYtdRow] = execRows<{ count: number }>(
      await tx.execute(sql`SELECT ${nbFacturesCaSql({ debut: firstOfYear })} AS count`),
    );

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
      incidentsFacturationCount,
      tresorerie,
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

  res.json(maskFinancialFields(
    {
      affairesEnCours: data.affairesEnCours?.count ?? 0,
      chiffreAffairesMois: data.caMonth?.total ?? 0,
      facturesEnAttente: data.facturesEnAttente?.count ?? 0,
      totalImpayeCents: data.totalImpaye?.total ?? 0,
      prospectsPipeline: data.prospectsPipeline?.count ?? 0,
      contratsActifs: data.contratsActifs?.count ?? 0,
      pendingActionsCount: data.pendingCount?.count ?? 0,
      // `null` pour un rôle sans accès financier — jamais `0` : voir le
      // commentaire au-dessus de `financier`.
      incidentsFacturationCount: data.incidentsFacturationCount?.count ?? null,
      treasuryBalanceCents: (data.tresorerie?.count ?? 0) > 0 ? data.tresorerie!.total : null,
      monthlySeries: data.monthlySeries,
      ytd: {
        caYtdCents,
        caPrevYearSamePeriodCents,
        caGrowthPct,
        facturesEmisesYtd: data.facturesYtdRow?.count ?? 0,
        tauxRecouvrement,
      },
    },
    ["chiffreAffairesMois", "totalImpayeCents", "treasuryBalanceCents", "monthlySeries", "ytd"],
    financier,
  ));
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
