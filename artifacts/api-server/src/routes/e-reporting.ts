/**
 * E-reporting (US-A2.6) — obligatoire dès le 1er septembre 2026, quelle que
 * soit la taille de l'entreprise (contrairement à l'émission, différée à
 * 2027 pour les TPE/PME — voir le plan).
 *
 * `aggregateEReporting()` (lib/facturx) est PURE et fait déjà l'essentiel :
 * cette route ne fait que lui fournir le ledger (la table `factures`, seule
 * source de vérité aujourd'hui — voir le plan pour pourquoi « Pennylane /
 * démo / FEC » désigne en pratique cette même table) et transmettre le
 * résultat. La TVA n'est PAS dérivée du ledger — l'agrégat ne porte pas
 * cette donnée de façon fiable — le tenant la déclare lui-même à la
 * transmission.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { notInArray } from "drizzle-orm";
import { withTenant, facturesTable, paTransmissionsTable } from "@workspace/db";
import { aggregateEReporting, type EReportingSourceInvoice } from "@nodaq/facturx";
import { getConfig, submitInvoice, PaConfigError } from "@nodaq/plateforme-agreee";

const router: IRouter = Router();

// Même filtre que l'indicateur ca_facture (analytics.ts) : une facture
// annulée, un avoir ou un brouillon ne sont pas du chiffre réalisé.
const STATUTS_EXCLUS = ["ANNULEE", "AVOIR", "BROUILLON"];

const PeriodeQuery = z.object({
  periodeDebut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodeFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * PAS de filtre de période ici, volontairement : aggregateEReporting() fait
 * elle-même le calcul de bornes et COMPTE ce qui tombe hors période plutôt
 * que de le faire disparaître silencieusement (`outOfPeriodCount`, pensé
 * pour que le tenant puisse élargir sa fenêtre en connaissance de cause). Un
 * pré-filtre SQL sur la période empêcherait cette fonction de voir — donc de
 * compter — ce qu'elle est censée signaler.
 */
async function ledger(tenantId: string): Promise<EReportingSourceInvoice[]> {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ amountCents: facturesTable.totalHTCents, date: facturesTable.issuedDate })
      .from(facturesTable)
      .where(notInArray(facturesTable.statut, STATUTS_EXCLUS)),
  );
  return rows.map((r) => ({ amountCents: r.amountCents, date: r.date, currency: "EUR" as const }));
}

router.get("/e-reporting/apercu", async (req, res): Promise<void> => {
  const parsed = PeriodeQuery.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { periodeDebut, periodeFin } = parsed.data;
  const tenantId = req.tenantId!;

  try {
    const invoices = await ledger(tenantId);
    const aggregate = aggregateEReporting(invoices, periodeDebut, periodeFin);
    res.json(aggregate);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Période invalide." });
  }
});

const DeclarerBody = z.object({
  periodeDebut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodeFin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  // La TVA n'est jamais dérivée du ledger (voir ereporting.ts) — le tenant
  // la déclare explicitement au moment de la transmission.
  tvaDeclareeCents: z.number().int().min(0),
});

router.post("/e-reporting/declarer", async (req, res): Promise<void> => {
  const parsed = DeclarerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { periodeDebut, periodeFin, tvaDeclareeCents } = parsed.data;
  const tenantId = req.tenantId!;

  let config;
  try {
    config = getConfig();
  } catch (err) {
    if (err instanceof PaConfigError) {
      res.status(503).json({
        error: "Aucune plateforme agréée n'est configurée sur ce déploiement.",
        variableManquante: err.missingVar,
      });
      return;
    }
    throw err;
  }

  let aggregate;
  try {
    const invoices = await ledger(tenantId);
    aggregate = aggregateEReporting(invoices, periodeDebut, periodeFin);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Période invalide." });
    return;
  }

  const documentId = `${periodeDebut}:${periodeFin}`;
  const payload = JSON.stringify({ ...aggregate, tvaDeclareeCents });

  let resultat;
  try {
    resultat = await submitInvoice(config, {
      documentType: "E_REPORTING",
      documentId,
      payload,
    });
  } catch {
    await withTenant(tenantId, (tx) =>
      tx
        .insert(paTransmissionsTable)
        .values({ tenantId, documentType: "E_REPORTING", documentId, statut: "erreur" })
        .onConflictDoUpdate({
          target: [paTransmissionsTable.tenantId, paTransmissionsTable.documentType, paTransmissionsTable.documentId],
          set: { statut: "erreur", updatedAt: new Date() },
        }),
    );
    res.status(502).json({ error: "La transmission à la plateforme agréée a échoué." });
    return;
  }

  await withTenant(tenantId, (tx) =>
    tx
      .insert(paTransmissionsTable)
      .values({
        tenantId,
        documentType: "E_REPORTING",
        documentId,
        submissionId: resultat.submissionId,
        statut: resultat.status,
      })
      .onConflictDoUpdate({
        target: [paTransmissionsTable.tenantId, paTransmissionsTable.documentType, paTransmissionsTable.documentId],
        set: { submissionId: resultat.submissionId, statut: resultat.status, updatedAt: new Date() },
      }),
  );

  res.status(201).json({ submissionId: resultat.submissionId, statut: resultat.status });
});

export default router;
