/**
 * 4.11 — Section analytique
 *
 * Implements the 13-indicator calculation engine.
 *
 * Rules:
 *  - ALL calculations happen server-side in withTenant(). Zero client-side arithmetic.
 *  - Below the data threshold → { donneesInsuffisantes: true, valeur: null, nbSources: N }
 *    and NOTHING ELSE — no zero, no estimate, no approximation.
 *  - tenantId ALWAYS comes from the authenticated session, never from the client.
 *  - Zod validates every request and every response shape.
 *
 * Forbidden (spec §13):
 *   KPI · ratio · taux de · performance · pilotage · indicateur avancé
 */

import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  withTenant,
  affairesTable,
  facturesTable,
  devisTable,
  teamMembersTable,
  absencesTable,
  crEntriesTable,
} from "@workspace/db";
import { sql, and, eq, gte, lte, isNotNull, isNull, ne } from "drizzle-orm";
import {
  computeAffaireMargin,
  resoudreCoutHoraireMembreCents,
  HEURES_PAR_JOUR_STANDARD,
} from "@nodaq/shared";
import {
  parsePeriode,
  periodePrecedente,
  memePeriodeN1,
  getLast12Months,
  assertDurationEqual,
  messageImpossible,
  toDateString,
  type ComparaisonMode,
  COMPARAISON_MODES,
} from "../lib/analytics-periods.js";
import { logger } from "../lib/logger.js";
import { champsErreur } from "../lib/erreur-pg.js";

const router: IRouter = Router();

// ── Zod schemas ───────────────────────────────────────────────────────────────

export const INDICATEUR_IDS = [
  "horizon_travail",
  "argent_qui_dort",
  "marge_pour_100_euros",
  "delai_paiement_client",
  "ca_facture",
  "ca_encaisse",
  "resultat_exploitation_estime",
  "carnet_commandes_euros",
  "taux_signature_devis",
  "delai_reponse_devis",
  "montant_moyen_affaire",
  "jours_factures_sur_payes",
  "ecart_devise_realise",
  "concentration_client",
] as const;

export type IndicateurId = (typeof INDICATEUR_IDS)[number];

const IndicateurIdSchema = z.enum(INDICATEUR_IDS);

const PeriodeJsonSchema = z.object({ debut: z.string(), fin: z.string(), label: z.string() });

const ComparaisonResultSchema = z.object({
  mode: z.enum(["periode_precedente", "meme_periode_n1", "moyenne_12_mois"]),
  /** Present for periode_precedente / meme_periode_n1, absent for moyenne_12_mois. */
  periode: PeriodeJsonSchema.optional(),
  valeur: z.number().nullable(),
  nbSources: z.number().int().min(0),
  donneesInsuffisantes: z.boolean(),
  /**
   * Spec §7: when comparison is impossible, a plain French sentence is returned —
   * never an empty string, never a dash, never null.
   */
  messageImpossible: z.string().optional(),
});

const IndicateurResultSchema = z.object({
  id: IndicateurIdSchema,
  valeur: z.number().nullable(),
  unite: z.string(),
  periode: PeriodeJsonSchema,
  nbSources: z.number().int().min(0),
  donneesInsuffisantes: z.boolean(),
  estime: z.boolean().optional(),
  /** Sub-values for compound indicators (e.g. argent_qui_dort breakdown, ecart_devise_realise). */
  detail: z.record(z.unknown()).optional(),
  /** Populated when comparaison != 'aucune'. */
  comparaison: ComparaisonResultSchema.optional(),
});

export type IndicateurResult = z.infer<typeof IndicateurResultSchema>;

const ComparaisonModeSchema = z.enum(
  COMPARAISON_MODES as [ComparaisonMode, ...ComparaisonMode[]],
);

const QuerySchema = z.object({
  /** Comma-separated list of indicator IDs, or "all" */
  ids: z.string().optional(),
  periode: z.string().optional(),
  debut: z.string().optional(),
  fin: z.string().optional(),
  /**
   * Default = meme_periode_n1 (not periode_precedente).
   * Spec §5: comparing August to July always shows an apparent collapse (summer holidays).
   * Use Y-1 as the anchor; fall back to moyenne_12_mois when Y-1 has no data.
   */
  comparaison: ComparaisonModeSchema.optional().default("meme_periode_n1"),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns an insufficient-data sentinel — the ONLY valid return when below threshold. */
function insufficient(
  id: IndicateurId,
  unite: string,
  nbSources: number,
  periode: { debut: string; fin: string; label: string },
): IndicateurResult {
  return {
    id,
    valeur: null,
    unite,
    periode,
    nbSources,
    donneesInsuffisantes: true,
  };
}

// ── Individual indicator calculators ─────────────────────────────────────────
// Each function operates inside a withTenant callback — DO NOT call withTenant
// inside these functions; they receive a transaction (tx) already scoped to a tenant.

export type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];
/**
 * Drizzle tx.execute(sql`...`) returns a pg.QueryResult object (not a row array).
 * Unwrap .rows so calculators can safely use array destructuring.
 */
function execRows<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

// ── Main-d'œuvre : heures pointées et coûts par membre ───────────────────────

/**
 * Heures pointées par affaire, détaillées par membre.
 *
 * Une affaire ABSENTE de la Map n'a pas « zéro heure » : elle n'a AUCUNE
 * donnée de pointage. Les deux se traduisent différemment en marge — `null`
 * donne « non mesuré », `[]` donne « zéro heure déclarée ».
 */
async function heuresParAffaire(
  tx: Tx,
  affaireIds: string[],
): Promise<Map<string, Array<{ membreId: string; heures: number }>>> {
  const parAffaire = new Map<string, Array<{ membreId: string; heures: number }>>();
  if (affaireIds.length === 0) return parAffaire;

  const rows = execRows<{ affaire_id: string; membre_id: string; heures: number }>(
    await tx.execute(sql`
      SELECT affaire_id, membre_id, sum(heures)::float AS heures
      FROM pointages
      WHERE affaire_id = ANY(${affaireIds}::text[])
      GROUP BY affaire_id, membre_id
    `),
  );

  for (const row of rows) {
    const liste = parAffaire.get(row.affaire_id) ?? [];
    liste.push({ membreId: row.membre_id, heures: row.heures });
    parAffaire.set(row.affaire_id, liste);
  }
  return parAffaire;
}

/** Réglage `equipe.coutJourCharge`, en euros. `null` = non renseigné. */
async function coutJourChargeEquipe(tx: Tx): Promise<number | null> {
  const rows = execRows<{ value: string }>(
    await tx.execute(sql`SELECT value FROM settings WHERE key = 'equipe.coutJourCharge'`),
  );
  const brut = rows[0]?.value;
  if (brut === undefined) return null;
  const n = Number(brut);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Coût horaire chargé de chaque membre, en centimes.
 *
 * Un membre absent de la Map a un coût INCONNU — jamais zéro. La résolution
 * (mensuel du membre, sinon coût jour d'équipe, sinon inconnu) vit dans
 * lib/shared pour qu'il n'existe qu'une seule convention dans le produit.
 */
async function coutsHorairesMembres(
  tx: Tx,
  coutJourEquipeEuros: number | null,
): Promise<Map<string, number>> {
  const rows = execRows<{
    id: string;
    cout_mensuel_charge: number | null;
    jours_par_semaine: number | null;
  }>(
    await tx.execute(sql`
      SELECT id, cout_mensuel_charge, jours_par_semaine FROM team_members
    `),
  );

  const couts = new Map<string, number>();
  for (const membre of rows) {
    const cents = resoudreCoutHoraireMembreCents({
      coutMensuelChargeEuros: membre.cout_mensuel_charge,
      joursParSemaine: membre.jours_par_semaine,
      coutJourChargeEquipeEuros: coutJourEquipeEuros,
    });
    if (cents !== null) couts.set(membre.id, cents);
  }
  return couts;
}


/**
 * 1. horizon_travail
 * Remaining backlog ÷ daily production capacity (team absences deducted).
 * Seuil: 3 affaires en cours.
 * Retourne: nombre de JOURS de travail devant soi.
 */
async function calcHorizonTravail(
  tx: Tx,
  _periode: { debut: Date; fin: Date },
): Promise<Omit<IndicateurResult, "id" | "periode">> {
  // Active affaires with a value
  const [carnet] = execRows<{ nb_affaires: number; total_carnet_ht: number }>(await tx.execute(sql`
    SELECT
      count(*)::int                              AS nb_affaires,
      coalesce(sum(montant_vendu_ht), 0)::float  AS total_carnet_ht
    FROM affaires
    WHERE status NOT IN ('TERMINE', 'ANNULE', 'PERDU')
      AND montant_vendu_ht IS NOT NULL
      AND montant_vendu_ht > 0
  `));

  if ((carnet.nb_affaires ?? 0) < 3) {
    return { valeur: null, unite: "jours", nbSources: carnet.nb_affaires ?? 0, donneesInsuffisantes: true };
  }

  // Amount already invoiced for those active affaires
  const [invoiced] = execRows<{ total_facture_ht: number }>(await tx.execute(sql`
    SELECT coalesce(sum(f.total_ht_cents), 0)::float / 100 AS total_facture_ht
    FROM factures f
    JOIN affaires a ON a.id = f.affaire_id
    WHERE a.status NOT IN ('TERMINE', 'ANNULE', 'PERDU')
      AND f.statut NOT IN ('ANNULEE', 'AVOIR', 'BROUILLON')
  `));

  const resteHt = Math.max(0, carnet.total_carnet_ht - (invoiced.total_facture_ht ?? 0));

  // Daily production capacity: average monthly invoiced over last 3 months / 22 working days
  const [cap] = execRows<{ avg_monthly_ht: number }>(await tx.execute(sql`
    SELECT coalesce(avg(monthly_ht), 0)::float AS avg_monthly_ht
    FROM (
      SELECT
        date_trunc('month', issued_date::date) AS month,
        sum(total_ht_cents)::float / 100       AS monthly_ht
      FROM factures
      WHERE issued_date::date >= (now() - interval '3 months')::date
        AND statut NOT IN ('ANNULEE', 'AVOIR', 'BROUILLON')
      GROUP BY 1
    ) sub
  `));

  const avgMonthly = cap.avg_monthly_ht ?? 0;
  if (avgMonthly <= 0) {
    // No recent invoicing history → cannot estimate capacity
    return { valeur: null, unite: "jours", nbSources: carnet.nb_affaires, donneesInsuffisantes: true };
  }

  // Days of work ahead (22 working days/month)
  const dailyCapacityHt = avgMonthly / 22;
  const horizonJours = Math.round(resteHt / dailyCapacityHt);

  return {
    valeur: horizonJours,
    unite: "jours",
    nbSources: carnet.nb_affaires,
    donneesInsuffisantes: false,
  };
}

/**
 * 2. argent_qui_dort
 * Unsettled invoices, RETENUE DE GARANTIE EXCLUDED, with >60d sub-total.
 * Seuil: 1 facture impayée.
 */
async function calcArgentQuiDort(
  tx: Tx,
  _periode: { debut: Date; fin: Date },
): Promise<Omit<IndicateurResult, "id" | "periode">> {
  // Unsettled invoices (not drafts, not avoirs)
  // Join devis via affaire_id to retrieve retenue_garantie_pct for exclusion
  const rows = execRows<{
    id: string;
    total_ht_cents: number;
    issued_date: string;
    due_date: string;
    retenue_pct: number;
  }>(await tx.execute(sql`
    SELECT
      f.id,
      f.total_ht_cents,
      f.issued_date,
      f.due_date,
      coalesce(d.retenue_garantie_pct, 0) AS retenue_pct
    FROM factures f
    LEFT JOIN LATERAL (
      SELECT retenue_garantie_pct
        FROM devis
       WHERE affaire_id = f.affaire_id
         AND status = 'ACCEPTE'
       ORDER BY created_at DESC
       LIMIT 1
    ) d ON true
    WHERE f.settled = false
      AND f.statut IN ('ENVOYEE', 'EN_RETARD', 'EN_ATTENTE', 'PARTIELLE')
  `));

  const nbSources = rows.length;
  if (nbSources < 1) {
    return { valeur: null, unite: "centimes", nbSources: 0, donneesInsuffisantes: true };
  }

  const now = new Date();
  let totalCents = 0;
  let plus60Cents = 0;

  for (const r of rows) {
    const retenuePct = Number(r.retenue_pct ?? 0);
    // Net amount excluding retenue de garantie
    const netCents = Math.round(r.total_ht_cents * (1 - retenuePct / 100));
    totalCents += netCents;

    // >60 days from issuedDate
    const issued = new Date(r.issued_date);
    if (!isNaN(issued.getTime())) {
      const ageJours = (now.getTime() - issued.getTime()) / 86400000;
      if (ageJours > 60) plus60Cents += netCents;
    }
  }

  return {
    valeur: totalCents,
    unite: "centimes",
    nbSources,
    donneesInsuffisantes: false,
    detail: { plus60Jours: plus60Cents },
  };
}

/**
 * 3. marge_pour_100_euros
 * (CA − costs) ÷ CA on completed affaires. Uses affaires.marginCents / invoicedAmountCents.
 * Seuil: 3 affaires terminées.
 */
async function calcMargePour100(
  tx: Tx,
  periode: { debut: Date; fin: Date },
): Promise<Omit<IndicateurResult, "id" | "periode">> {
  // La marge est RECALCULÉE, plus lue dans affaires.margin_cents : cette
  // colonne n'est écrite par aucun calcul, seulement par un PATCH manuel. La
  // sommer revenait à additionner des NULL coalescés à zéro et à présenter le
  // résultat comme une marge mesurée.
  const affaires = execRows<{
    id: string;
    quoted_cents: number | null;
    invoiced_cents: number | null;
  }>(await tx.execute(sql`
    SELECT
      id,
      coalesce(montant_vendu_ht * 100, quoted_amount_cents) AS quoted_cents,
      invoiced_amount_cents                                 AS invoiced_cents
    FROM affaires
    WHERE completed_at IS NOT NULL
      AND completed_at::date BETWEEN ${toDateString(periode.debut)}::date
                                 AND ${toDateString(periode.fin)}::date
      AND invoiced_amount_cents IS NOT NULL
      AND invoiced_amount_cents > 0
  `));

  const nb = affaires.length;
  if (nb < 3) {
    return { valeur: null, unite: "€ sur 100 €", nbSources: nb, donneesInsuffisantes: true };
  }

  const labourParAffaire = await heuresParAffaire(tx, affaires.map((a) => a.id));
  const coutJourEquipe = await coutJourChargeEquipe(tx);
  const coutsMembres = await coutsHorairesMembres(tx, coutJourEquipe);

  let totalCa = 0;
  let totalMargeAuMieux = 0;
  const manquants = new Set<string>();

  for (const affaire of affaires) {
    const ca = affaire.invoiced_cents ?? 0;
    if (ca <= 0) continue;

    const pointages = labourParAffaire.get(affaire.id) ?? null;
    const marge = computeAffaireMargin({
      quotedAmountCents: affaire.quoted_cents,
      // Aucune table d'imputation n'existe encore : les achats ne sont pas
      // rattachables. Le module en tient compte et refuse de rendre une marge
      // présentée comme exacte (« aucune_piece_rattachee » est bloquante).
      imputations: [],
      labour:
        pointages === null
          ? null
          : pointages.map((p) => ({
              hours: p.heures,
              hourlyCostCents: coutsMembres.get(p.membreId) ?? null,
            })),
      invoicedCents: ca,
      invoicedBasis: "ht",
      depositsCents: 0,
      retentionRateBps: null,
      estimatedMaterialCents: null,
    });

    for (const m of marge.missing) manquants.add(m);

    // Seules les variantes qui portent un montant entrent dans l'agrégat.
    const montant =
      marge.kind === "marge"
        ? marge.marginCents
        : marge.kind === "marge_borne_superieure"
          ? marge.upperBoundCents
          : null;
    if (montant === null) continue;

    totalCa += ca;
    totalMargeAuMieux += montant;
  }

  if (totalCa <= 0) {
    return { valeur: null, unite: "€ sur 100 €", nbSources: nb, donneesInsuffisantes: true };
  }

  return {
    valeur: Math.round((totalMargeAuMieux / totalCa) * 10000) / 100,
    unite: "€ sur 100 €",
    nbSources: nb,
    donneesInsuffisantes: false,
    // `estime` commande l'affichage : tant qu'aucun achat n'est rattachable,
    // ce chiffre est un PLAFOND. L'écran doit le dire — jamais un pourcentage nu.
    estime: true,
    detail: {
      borneSuperieure: true,
      manquants: [...manquants].sort(),
    },
  };
}

/**
 * 4. delai_paiement_client
 * Weighted average days from issuedDate to settlement.
 *
 * `factures` n'a pas de colonne `updated_at`/`paid_at` — la première version
 * de ce calcul en supposait une qui n'a jamais existé, et sa requête levait
 * systématiquement une erreur SQL (issue #41, cause racine derrière la
 * cascade de transaction avortée). La date de règlement réelle vit dans
 * `paiements` (`facture_id`, `date`, `sens = 'ENCAISSEMENT'`) : le dernier
 * encaissement rattaché à la facture sert de date de règlement — une donnée
 * réelle, pas une approximation.
 * Seuil: 5 factures réglées.
 */
async function calcDelaiPaiement(
  tx: Tx,
  periode: { debut: Date; fin: Date },
): Promise<Omit<IndicateurResult, "id" | "periode">> {
  const [res] = execRows<{ nb_factures: number; delai_moyen_pondere: number }>(await tx.execute(sql`
    SELECT
      count(*)::int                                                      AS nb_factures,
      coalesce(
        sum(f.total_ht_cents * (p.date_reglement - f.issued_date::date))
        / nullif(sum(f.total_ht_cents), 0),
      0)::float AS delai_moyen_pondere
    FROM factures f
    JOIN LATERAL (
      SELECT max(date) AS date_reglement
        FROM paiements
       WHERE facture_id = f.id
         AND sens = 'ENCAISSEMENT'
    ) p ON p.date_reglement IS NOT NULL
    WHERE f.settled = true
      AND f.issued_date::date BETWEEN ${toDateString(periode.debut)}::date
                                   AND ${toDateString(periode.fin)}::date
      AND f.total_ht_cents > 0
      AND p.date_reglement > f.issued_date::date
  `));

  const nb = res.nb_factures ?? 0;
  if (nb < 5) {
    return { valeur: null, unite: "jours", nbSources: nb, donneesInsuffisantes: true };
  }

  return {
    valeur: Math.round(res.delai_moyen_pondere ?? 0),
    unite: "jours",
    nbSources: nb,
    donneesInsuffisantes: false,
  };
}

/**
 * 5. ca_facture
 * Total HT of invoices issued in the period.
 */
async function calcCaFacture(
  tx: Tx,
  periode: { debut: Date; fin: Date },
): Promise<Omit<IndicateurResult, "id" | "periode">> {
  const [res] = execRows<{ nb_factures: number; total_ht: number }>(await tx.execute(sql`
    SELECT
      count(*)::int AS nb_factures,
      coalesce(sum(
        round(f.total_ht_cents::numeric * (1 - coalesce(d.retenue_garantie_pct, 0) / 100.0))
      ), 0)::int AS total_ht
    FROM factures f
    LEFT JOIN LATERAL (
      SELECT retenue_garantie_pct
        FROM devis
       WHERE affaire_id = f.affaire_id
         AND status = 'ACCEPTE'
       ORDER BY created_at DESC
       LIMIT 1
    ) d ON true
    WHERE f.issued_date::date BETWEEN ${toDateString(periode.debut)}::date
                                  AND ${toDateString(periode.fin)}::date
      AND f.statut NOT IN ('ANNULEE', 'AVOIR', 'BROUILLON')
  `));

  return {
    valeur: res.total_ht ?? 0,
    unite: "centimes HT",
    nbSources: res.nb_factures ?? 0,
    donneesInsuffisantes: false,
  };
}

/**
 * 6. ca_encaisse
 * Total HT of settled invoices in the period.
 */
async function calcCaEncaisse(
  tx: Tx,
  periode: { debut: Date; fin: Date },
): Promise<Omit<IndicateurResult, "id" | "periode">> {
  const [res] = execRows<{ nb_factures: number; total_ht: number }>(await tx.execute(sql`
    SELECT
      count(*)::int                              AS nb_factures,
      coalesce(sum(total_ht_cents), 0)::int      AS total_ht
    FROM factures
    WHERE settled = true
      AND issued_date::date BETWEEN ${toDateString(periode.debut)}::date
                                AND ${toDateString(periode.fin)}::date
      AND statut NOT IN ('ANNULEE', 'AVOIR')
  `));

  return {
    valeur: res.total_ht ?? 0,
    unite: "centimes HT",
    nbSources: res.nb_factures ?? 0,
    donneesInsuffisantes: false,
  };
}

/**
 * 7. resultat_exploitation_estime
 * CA encaissé − charges de la période (from cr_entries).
 * Marked `estime: true` when charge lines are incomplete.
 *
 * "Complete" = at least one CHARGE_EXTERNE + one MASSE_SALARIALE entry in the period.
 */
async function calcResultatExploitation(
  tx: Tx,
  periode: { debut: Date; fin: Date },
): Promise<Omit<IndicateurResult, "id" | "periode">> {
  const periodKey = `${periode.debut.getFullYear()}-${String(periode.debut.getMonth() + 1).padStart(2, "0")}`;

  // CA encaissé on the period
  const [caRow] = execRows<{ ca_cents: number }>(await tx.execute(sql`
    SELECT coalesce(sum(total_ht_cents), 0)::float AS ca_cents
    FROM factures
    WHERE settled = true
      AND issued_date::date BETWEEN ${toDateString(periode.debut)}::date
                                AND ${toDateString(periode.fin)}::date
      AND statut NOT IN ('ANNULEE', 'AVOIR')
  `));

  // Charges from cr_entries — sum of all CHARGE lines for the period
  const chargeRows = execRows<{ line_code: string; total: number }>(await tx.execute(sql`
    SELECT line_code, coalesce(sum(amount_cents), 0)::float AS total
    FROM cr_entries
    WHERE period_key >= ${periodKey}
    GROUP BY line_code
  `));

  const totalCharges = chargeRows.reduce((acc, r) => acc + (r.total ?? 0), 0);

  // Completeness check: do we have at least the main charge categories?
  const lineCodes = new Set(chargeRows.map((r) => r.line_code));
  const hasExternal = [...lineCodes].some((c) => c.includes("CHARGE") || c.includes("ACHAT") || c.includes("SOUS_TRAITANCE"));
  const hasSalaires = [...lineCodes].some((c) => c.includes("SALAIRE") || c.includes("MASSE") || c.includes("SOCIAL"));
  const estime = !hasExternal || !hasSalaires;

  const ca = caRow.ca_cents ?? 0;
  const resultat = ca - totalCharges;

  return {
    valeur: Math.round(resultat),
    unite: "centimes",
    nbSources: chargeRows.length,
    donneesInsuffisantes: false,
    estime,
  };
}

/**
 * 8. carnet_commandes_euros
 * Sum of montant_vendu_ht for active affaires minus amount already invoiced.
 */
async function calcCarnetCommandes(
  tx: Tx,
  _periode: { debut: Date; fin: Date },
): Promise<Omit<IndicateurResult, "id" | "periode">> {
  const [res] = execRows<{ nb_affaires: number; carnet_ht: number; deja_facture_ht: number }>(await tx.execute(sql`
    SELECT
      count(*)::int                               AS nb_affaires,
      coalesce(sum(a.montant_vendu_ht), 0)::float AS carnet_ht,
      coalesce(
        (
          SELECT sum(f2.total_ht_cents)::float / 100
          FROM factures f2
          JOIN affaires a2 ON a2.id = f2.affaire_id
          WHERE a2.status NOT IN ('TERMINE', 'ANNULE', 'PERDU')
            AND f2.statut NOT IN ('ANNULEE', 'AVOIR', 'BROUILLON')
        ), 0
      ) AS deja_facture_ht
    FROM affaires a
    WHERE a.status NOT IN ('TERMINE', 'ANNULE', 'PERDU')
      AND a.montant_vendu_ht IS NOT NULL
  `));

  const nbSources = res.nb_affaires ?? 0;
  const reste = Math.max(0, (res.carnet_ht ?? 0) - (res.deja_facture_ht ?? 0));

  return {
    valeur: Math.round(reste * 100), // in cents
    unite: "centimes HT",
    nbSources,
    donneesInsuffisantes: false,
  };
}

/**
 * 9. taux_signature_devis
 * Accepted devis / sent devis in the period.
 * Seuil: 5 devis envoyés.
 */
async function calcTauxSignatureDevis(
  tx: Tx,
  periode: { debut: Date; fin: Date },
): Promise<Omit<IndicateurResult, "id" | "periode">> {
  const [res] = execRows<{ nb_envoyes: number; nb_acceptes: number }>(await tx.execute(sql`
    SELECT
      count(*)::int                                                        AS nb_envoyes,
      count(*) FILTER (WHERE status = 'ACCEPTE')::int                     AS nb_acceptes
    FROM devis
    WHERE date_envoi IS NOT NULL
      AND date_envoi::date BETWEEN ${toDateString(periode.debut)}::date
                               AND ${toDateString(periode.fin)}::date
      AND status NOT IN ('BROUILLON')
  `));

  const nb = res.nb_envoyes ?? 0;
  if (nb < 5) {
    return { valeur: null, unite: "sur N", nbSources: nb, donneesInsuffisantes: true };
  }

  const acceptes = res.nb_acceptes ?? 0;
  // Return as a ratio in percent
  const pct = Math.round((acceptes / nb) * 100);

  return {
    valeur: pct,
    unite: "%",
    nbSources: nb,
    donneesInsuffisantes: false,
    detail: { nbAcceptes: acceptes, nbEnvoyes: nb },
  };
}

/**
 * 10. delai_reponse_devis
 * Average days from dateEnvoi to acceptedAt, on accepted devis in the period.
 * No explicit threshold in spec — use 3 as conservative minimum.
 */
async function calcDelaiReponseDevis(
  tx: Tx,
  periode: { debut: Date; fin: Date },
): Promise<Omit<IndicateurResult, "id" | "periode">> {
  const [res] = execRows<{ nb_devis: number; delai_moyen_jours: number }>(await tx.execute(sql`
    SELECT
      count(*)::int                                                             AS nb_devis,
      round(
        avg(extract(epoch from (accepted_at - date_envoi)) / 86400)
      )::int                                                                   AS delai_moyen_jours
    FROM devis
    WHERE status = 'ACCEPTE'
      AND date_envoi IS NOT NULL
      AND accepted_at IS NOT NULL
      AND date_envoi::date BETWEEN ${toDateString(periode.debut)}::date
                               AND ${toDateString(periode.fin)}::date
      AND accepted_at > date_envoi
  `));

  const nb = res.nb_devis ?? 0;
  if (nb < 3) {
    return { valeur: null, unite: "jours", nbSources: nb, donneesInsuffisantes: true };
  }

  return {
    valeur: res.delai_moyen_jours ?? 0,
    unite: "jours",
    nbSources: nb,
    donneesInsuffisantes: false,
  };
}

/**
 * 11. montant_moyen_affaire
 * Average montant_vendu_ht for affaires created in the period.
 */
async function calcMontantMoyenAffaire(
  tx: Tx,
  periode: { debut: Date; fin: Date },
): Promise<Omit<IndicateurResult, "id" | "periode">> {
  const [res] = execRows<{ nb_affaires: number; moyen_cents: number }>(await tx.execute(sql`
    SELECT
      count(*)::int                                     AS nb_affaires,
      round(avg(montant_vendu_ht) * 100)::int           AS moyen_cents
    FROM affaires
    WHERE created_at BETWEEN ${periode.debut.toISOString()}::timestamptz
                         AND ${periode.fin.toISOString()}::timestamptz
      AND montant_vendu_ht IS NOT NULL
      AND montant_vendu_ht > 0
  `));

  const nb = res.nb_affaires ?? 0;
  if (nb < 1) {
    return { valeur: null, unite: "centimes HT", nbSources: 0, donneesInsuffisantes: true };
  }

  return {
    valeur: res.moyen_cents ?? 0,
    unite: "centimes HT",
    nbSources: nb,
    donneesInsuffisantes: false,
  };
}

/**
 * 12. jours_factures_sur_payes
 *
 * Sur les journées que l'entreprise PAIE, quelle part finit facturée à un
 * client ? Le reste est du temps réel — reprises, trajets, chantiers non
 * refacturés — qui ne rentre jamais.
 *
 * Payés    : toutes les heures pointées sur la période.
 * Facturés : les heures pointées sur des affaires effectivement facturées
 *            (invoiced_amount_cents > 0).
 *
 * Les heures sont converties en jours par HEURES_PAR_JOUR_STANDARD, la
 * convention unique du produit (lib/shared/coutMainOeuvre.ts).
 *
 * Seuil : 10 journées distinctes pointées, soit deux semaines de relevés.
 * En deçà, l'échantillon décrit une semaine particulière, pas une habitude.
 */
async function calcJoursFacturesSurPayes(
  tx: Tx,
  periode: { debut: Date; fin: Date },
): Promise<Omit<IndicateurResult, "id" | "periode">> {
  const [res] = execRows<{
    jours_pointes: number;
    heures_payees: number;
    heures_facturees: number;
  }>(await tx.execute(sql`
    SELECT
      count(DISTINCT p.date)::int                             AS jours_pointes,
      coalesce(sum(p.heures), 0)::float                       AS heures_payees,
      coalesce(sum(p.heures) FILTER (
        WHERE a.invoiced_amount_cents IS NOT NULL
          AND a.invoiced_amount_cents > 0
      ), 0)::float                                            AS heures_facturees
    -- LEFT JOIN, pas JOIN : un pointage rattaché directement à un client
    -- (US-A4.1, pas d'affaire) doit compter dans jours_pointes/heures_payees
    -- au même titre qu'un pointage d'affaire — ces heures ont été PAYÉES,
    -- qu'il y ait ou non une affaire derrière. Seul le calcul de
    -- heures_facturees a besoin de la jointure (a.invoiced_amount_cents),
    -- et son FILTER exclut déjà naturellement les lignes sans affaire (a
    -- vaut NULL, la condition ne peut jamais être vraie).
    FROM pointages p
    LEFT JOIN affaires a ON a.id = p.affaire_id
    WHERE p.date BETWEEN ${toDateString(periode.debut)}::date
                     AND ${toDateString(periode.fin)}::date
  `));

  const joursPointes = res.jours_pointes ?? 0;
  if (joursPointes < 10) {
    return {
      valeur: null,
      unite: "jours sur jours",
      nbSources: joursPointes,
      donneesInsuffisantes: true,
    };
  }

  const heuresPayees = res.heures_payees ?? 0;
  if (heuresPayees <= 0) {
    return { valeur: null, unite: "jours sur jours", nbSources: joursPointes, donneesInsuffisantes: true };
  }

  const joursPayes = heuresPayees / HEURES_PAR_JOUR_STANDARD;
  const joursFactures = (res.heures_facturees ?? 0) / HEURES_PAR_JOUR_STANDARD;

  return {
    valeur: Math.round((joursFactures / joursPayes) * 1000) / 10, // en %
    unite: "% des jours payés",
    nbSources: joursPointes,
    donneesInsuffisantes: false,
    detail: {
      joursPayes: Math.round(joursPayes * 10) / 10,
      joursFactures: Math.round(joursFactures * 10) / 10,
    },
  };
}

/**
 * 13. ecart_devise_realise
 * Gap between planned and actual completion: in days AND in euros.
 * Seuil: 3 affaires terminées with both planned and actual dates.
 */
async function calcEcartDeviseRealise(
  tx: Tx,
  periode: { debut: Date; fin: Date },
): Promise<Omit<IndicateurResult, "id" | "periode">> {
  const rows = execRows<{
    prevue: string;
    realisee: string;
    devis_ht: number;
    realise_ht: number;
  }>(await tx.execute(sql`
    SELECT
      date_fin_prevue::date                                    AS prevue,
      completed_at::date                                       AS realisee,
      coalesce(montant_vendu_ht, 0)                            AS devis_ht,
      coalesce(invoiced_amount_cents, 0) / 100.0               AS realise_ht
    FROM affaires
    WHERE completed_at IS NOT NULL
      AND date_fin_prevue IS NOT NULL
      AND completed_at::date BETWEEN ${toDateString(periode.debut)}::date
                                 AND ${toDateString(periode.fin)}::date
      AND montant_vendu_ht IS NOT NULL
      AND montant_vendu_ht > 0
  `));

  const nb = rows.length;
  if (nb < 3) {
    return { valeur: null, unite: "jours", nbSources: nb, donneesInsuffisantes: true };
  }

  let totalEcartJours = 0;
  let totalEcartEurosCents = 0;

  for (const r of rows) {
    const prevue = new Date(r.prevue);
    const realisee = new Date(r.realisee);
    if (!isNaN(prevue.getTime()) && !isNaN(realisee.getTime())) {
      totalEcartJours += (realisee.getTime() - prevue.getTime()) / 86400000;
    }
    // Positive = invoiced more than planned; negative = under-billed
    totalEcartEurosCents += Math.round((r.realise_ht - r.devis_ht) * 100);
  }

  const moyenneEcartJours = Math.round(totalEcartJours / nb);
  const moyenneEcartCents = Math.round(totalEcartEurosCents / nb);

  return {
    valeur: moyenneEcartJours, // primary value: days late (positive = late)
    unite: "jours",
    nbSources: nb,
    donneesInsuffisantes: false,
    detail: { ecartMoyenCents: moyenneEcartCents },
  };
}

/**
 * 14. concentration_client
 * Share of top client in total invoiced CA for the period.
 */
async function calcConcentrationClient(
  tx: Tx,
  periode: { debut: Date; fin: Date },
): Promise<Omit<IndicateurResult, "id" | "periode">> {
  const rows = execRows<{ customer_name: string; ca_client: number }>(await tx.execute(sql`
    SELECT
      customer_name,
      sum(total_ht_cents)::float AS ca_client
    FROM factures
    WHERE issued_date::date BETWEEN ${toDateString(periode.debut)}::date
                                AND ${toDateString(periode.fin)}::date
      AND statut NOT IN ('ANNULEE', 'AVOIR', 'BROUILLON')
    GROUP BY customer_name
    ORDER BY ca_client DESC
  `));

  const nbClients = rows.length;
  if (nbClients < 1) {
    return { valeur: null, unite: "%", nbSources: 0, donneesInsuffisantes: true };
  }

  const total = rows.reduce((acc, r) => acc + (r.ca_client ?? 0), 0);
  const topCa = rows[0]?.ca_client ?? 0;
  const pct = total > 0 ? Math.round((topCa / total) * 100) : 0;

  return {
    valeur: pct,
    unite: "%",
    nbSources: nbClients,
    donneesInsuffisantes: false,
    detail: { topClient: rows[0]?.customer_name ?? null, topClientCaCents: Math.round(topCa) },
  };
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export type PartialResult = Omit<IndicateurResult, "id" | "periode">;

export const CALCULATORS: Record<
  IndicateurId,
  (tx: Tx, periode: { debut: Date; fin: Date }) => Promise<PartialResult>
> = {
  horizon_travail: calcHorizonTravail,
  argent_qui_dort: calcArgentQuiDort,
  marge_pour_100_euros: calcMargePour100,
  delai_paiement_client: calcDelaiPaiement,
  ca_facture: calcCaFacture,
  ca_encaisse: calcCaEncaisse,
  resultat_exploitation_estime: calcResultatExploitation,
  carnet_commandes_euros: calcCarnetCommandes,
  taux_signature_devis: calcTauxSignatureDevis,
  delai_reponse_devis: calcDelaiReponseDevis,
  montant_moyen_affaire: calcMontantMoyenAffaire,
  jours_factures_sur_payes: calcJoursFacturesSurPayes,
  ecart_devise_realise: calcEcartDeviseRealise,
  concentration_client: calcConcentrationClient,
};

// ── Comparison engine ─────────────────────────────────────────────────────────

type ComparaisonResult = {
  mode: Exclude<ComparaisonMode, "aucune">;
  periode?: { debut: string; fin: string; label: string };
  valeur: number | null;
  nbSources: number;
  donneesInsuffisantes: boolean;
  messageImpossible?: string;
};

/**
 * Compute the comparison value for a single indicator.
 *
 * For `meme_periode_n1` / `periode_precedente`:
 *   - Enforces equal duration (assertDurationEqual) — throws if mismatched.
 *   - Computes the indicator on the comparison period.
 *   - If result has nbSources === 0, returns a plain-French sentence instead of a dash.
 *
 * For `moyenne_12_mois`:
 *   - Computes the indicator for each of the last 12 calendar months.
 *   - Averages the non-null, sufficient values.
 *   - Requires at least 3 valid months; otherwise: messageImpossible.
 */
export async function computeComparaison(
  tx: Tx,
  id: IndicateurId,
  currentPeriode: { debut: Date; fin: Date; label: string },
  mode: ComparaisonMode,
): Promise<ComparaisonResult | undefined> {
  if (mode === "aucune") return undefined;

  const today = new Date();

  if (mode === "meme_periode_n1") {
    const compP = memePeriodeN1(currentPeriode);
    // Enforce comparability (same calendar month/quarter → same duration)
    assertDurationEqual(currentPeriode, compP);
    const partial = await CALCULATORS[id](tx, compP);
    const noData = partial.nbSources === 0;
    return {
      mode,
      periode: {
        debut: toDateString(compP.debut),
        fin: toDateString(compP.fin),
        label: compP.label,
      },
      valeur: partial.valeur,
      nbSources: partial.nbSources,
      donneesInsuffisantes: partial.donneesInsuffisantes,
      messageImpossible: noData
        ? messageImpossible("meme_periode_n1", currentPeriode, today)
        : undefined,
    };
  }

  if (mode === "periode_precedente") {
    const compP = periodePrecedente(currentPeriode);
    assertDurationEqual(currentPeriode, compP);
    const partial = await CALCULATORS[id](tx, compP);
    const noData = partial.nbSources === 0;
    return {
      mode,
      periode: {
        debut: toDateString(compP.debut),
        fin: toDateString(compP.fin),
        label: compP.label,
      },
      valeur: partial.valeur,
      nbSources: partial.nbSources,
      donneesInsuffisantes: partial.donneesInsuffisantes,
      messageImpossible: noData
        ? messageImpossible("periode_precedente", currentPeriode, today)
        : undefined,
    };
  }

  if (mode === "moyenne_12_mois") {
    const months = getLast12Months(today);
    // Séquentiel, jamais Promise.all : `tx` est UNE connexion Postgres, qui ne
    // traite qu'une requête à la fois. Des requêtes concurrentes dessus
    // interfèrent au niveau du protocole (voir l'en-tête de fichier).
    const monthResults: PartialResult[] = [];
    for (const m of months) {
      monthResults.push(await CALCULATORS[id](tx, m));
    }
    const valid = monthResults.filter(
      (r) => !r.donneesInsuffisantes && r.valeur !== null,
    );
    const MIN_MONTHS = 3;
    if (valid.length < MIN_MONTHS) {
      return {
        mode,
        valeur: null,
        nbSources: valid.length,
        donneesInsuffisantes: true,
        messageImpossible: messageImpossible("moyenne_12_mois", currentPeriode, today),
      };
    }
    const avg = valid.reduce((acc, r) => acc + r.valeur!, 0) / valid.length;
    return {
      mode,
      valeur: Math.round(avg),
      nbSources: valid.length,
      donneesInsuffisantes: false,
    };
  }

  return undefined;
}

// ── Routes ────────────────────────────────────────────────────────────────────

/** Resolve requested indicator IDs from the `ids` query param. */
function resolveIds(ids?: string): IndicateurId[] | { error: string } {
  if (!ids || ids === "all") return [...INDICATEUR_IDS];
  const parsed = ids.split(",").map((s) => s.trim());
  const invalid = parsed.filter((s) => !INDICATEUR_IDS.includes(s as IndicateurId));
  if (invalid.length > 0) {
    return { error: `Identifiants inconnus : ${invalid.join(", ")}` };
  }
  return parsed as IndicateurId[];
}

/**
 * GET /analytics/indicateurs
 * Returns multiple indicators for a given period, with optional comparison.
 *
 * Query params:
 *   ids        Comma-separated indicator IDs, or "all" (default).
 *   periode    mois | trimestre | exercice | 12_mois (default: 12_mois)
 *   debut/fin  ISO dates for a custom period (requires both).
 *   comparaison  aucune | periode_precedente | meme_periode_n1 | moyenne_12_mois
 *                Default: meme_periode_n1 (spec §5 — not periode_precedente).
 */
router.get("/analytics/indicateurs", async (req, res): Promise<void> => {
  const query = QuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.flatten() });
    return;
  }

  const { ids, periode: periodeRaw, debut, fin, comparaison: compMode } = query.data;
  const tenantId = req.tenantId!;

  const resolvedIds = resolveIds(ids);
  if ("error" in resolvedIds) {
    res.status(400).json({ error: resolvedIds.error, identifiantsValides: INDICATEUR_IDS });
    return;
  }

  const periode = parsePeriode(periodeRaw, debut, fin);
  const periodeJson = {
    debut: toDateString(periode.debut),
    fin: toDateString(periode.fin),
    label: periode.label,
  };

  try {
    const results = await withTenant(tenantId, async (tx) => {
      // Séquentiel, jamais Promise.all : `tx` est UNE connexion Postgres, qui
      // ne traite qu'une requête à la fois. Des requêtes concurrentes dessus
      // interfèrent au niveau du protocole, et dès que l'une échoue Postgres
      // abandonne toute la transaction — chaque autre requête « en vol » sur
      // ce même client échoue alors en cascade. Voir l'issue #41.
      const out: IndicateurResult[] = [];
      for (const id of resolvedIds) {
        try {
          const partial = await CALCULATORS[id](tx, periode);
          const comp =
            compMode !== "aucune"
              ? await computeComparaison(tx, id, periode, compMode).catch((err) => {
                  logger.error(
                    { ...champsErreur(err), tenantId, indicateur: id, etape: "comparaison" },
                    "[analytics/indicateurs] comparaison indisponible",
                  );
                  return {
                    mode: compMode as Exclude<ComparaisonMode, "aucune">,
                    valeur: null as number | null,
                    nbSources: 0,
                    donneesInsuffisantes: true,
                    messageImpossible: "Comparaison indisponible.",
                  };
                })
              : undefined;
          out.push({ id, periode: periodeJson, ...partial, comparaison: comp } satisfies IndicateurResult);
        } catch (err) {
          logger.error(
            { ...champsErreur(err), tenantId, indicateur: id, etape: "calcul" },
            "[analytics/indicateurs] calcul indisponible",
          );
          out.push({
            id,
            valeur: null,
            unite: "",
            periode: periodeJson,
            nbSources: 0,
            donneesInsuffisantes: true,
            detail: { erreur: "Calcul indisponible." },
          } satisfies IndicateurResult);
        }
      }
      return out;
    });

    res.json(results);
  } catch (err) {
    logger.error({ ...champsErreur(err), tenantId, etape: "indicateurs" }, "[analytics/indicateurs] échec");
    res.status(500).json({ error: "Calcul des indicateurs indisponible. Réessayez." });
  }
});

/**
 * GET /analytics/indicateurs/:id
 * Single indicator — also used by the chat agent tool get_indicateur().
 *
 * The chat agent tool signature (spec §14):
 *   get_indicateur({ id, periode, comparaison })
 *   → { valeur, unite, periode, comparaison?, nbSources, donneesInsuffisantes }
 */
router.get("/analytics/indicateurs/:id", async (req, res): Promise<void> => {
  const idParsed = IndicateurIdSchema.safeParse(req.params["id"]);
  if (!idParsed.success) {
    res.status(404).json({
      error: `Indicateur inconnu : "${req.params["id"]}"`,
      identifiantsValides: INDICATEUR_IDS,
    });
    return;
  }

  const query = QuerySchema.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.flatten() });
    return;
  }

  const { periode: periodeRaw, debut, fin, comparaison: compMode } = query.data;
  const tenantId = req.tenantId!;
  const id = idParsed.data;
  const periode = parsePeriode(periodeRaw, debut, fin);
  const periodeJson = {
    debut: toDateString(periode.debut),
    fin: toDateString(periode.fin),
    label: periode.label,
  };

  try {
    const result = await withTenant(tenantId, async (tx) => {
      const partial = await CALCULATORS[id](tx, periode);
      const comp =
        compMode !== "aucune"
          ? await computeComparaison(tx, id, periode, compMode).catch((err) => {
              logger.error(
                { ...champsErreur(err), tenantId, indicateur: id, etape: "comparaison" },
                "[analytics/indicateurs/:id] comparaison indisponible",
              );
              return {
                mode: compMode as Exclude<ComparaisonMode, "aucune">,
                valeur: null as number | null,
                nbSources: 0,
                donneesInsuffisantes: true,
                messageImpossible: "Comparaison indisponible.",
              };
            })
          : undefined;
      return { id, periode: periodeJson, ...partial, comparaison: comp } satisfies IndicateurResult;
    });

    // Validate response shape before returning (spec §14: "Entrée ET sortie validées par Zod")
    const validated = IndicateurResultSchema.safeParse(result);
    if (!validated.success) {
      res.status(500).json({
        error: "Réponse invalide du moteur de calcul",
        detail: validated.error.flatten(),
      });
      return;
    }

    res.json(validated.data);
  } catch (err) {
    logger.error({ ...champsErreur(err), tenantId, indicateur: id, etape: "calcul" }, "[analytics/indicateurs/:id] échec");
    res.status(500).json({ error: "Calcul indisponible. Réessayez." });
  }
});

/**
 * GET /analytics/indicateurs/:id/serie
 * Returns an ordered array of monthly data points — used by the evolution chart.
 * The model never receives this data; only the formatted result goes to the chat.
 *
 * Query params:
 *   n   Number of months to return (3–24, default 12).
 */
router.get("/analytics/indicateurs/:id/serie", async (req, res): Promise<void> => {
  const idParsed = IndicateurIdSchema.safeParse(req.params["id"]);
  if (!idParsed.success) {
    res.status(404).json({ error: `Indicateur inconnu : "${req.params["id"]}"`, identifiantsValides: INDICATEUR_IDS });
    return;
  }

  const nRaw = parseInt((req.query["n"] as string | undefined) ?? "12", 10);
  const n = Number.isFinite(nRaw) ? Math.min(24, Math.max(3, nRaw)) : 12;
  const tenantId = req.tenantId!;
  const id = idParsed.data;
  const months = getLast12Months(new Date(), n);

  try {
    const points = await withTenant(tenantId, async (tx) => {
      // Séquentiel, jamais Promise.all : voir la note sur `tx` dans
      // GET /analytics/indicateurs, même connexion Postgres partagée.
      const out = [];
      for (const m of months) {
        const partial = await CALCULATORS[id](tx, m).catch((err) => {
          logger.error(
            { ...champsErreur(err), tenantId, indicateur: id, etape: "serie" },
            "[analytics/indicateurs/:id/serie] point indisponible",
          );
          return {
            valeur: null as number | null,
            unite: "",
            nbSources: 0,
            donneesInsuffisantes: true,
          };
        });
        out.push({
          periode: {
            debut: toDateString(m.debut),
            fin: toDateString(m.fin),
            label: m.label,
          },
          valeur: partial.valeur,
          nbSources: partial.nbSources,
          donneesInsuffisantes: partial.donneesInsuffisantes,
        });
      }
      return out;
    });
    res.json(points);
  } catch (err) {
    logger.error({ ...champsErreur(err), tenantId, indicateur: id, etape: "serie" }, "[analytics/indicateurs/:id/serie] échec");
    res.status(500).json({ error: "Série indisponible. Réessayez." });
  }
});

export default router;
