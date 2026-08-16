/**
 * GET /previsionnel-tresorerie — prévisionnel de trésorerie sur 8 semaines
 * (US-A3.5, PR 3/3).
 *
 * Ce fichier assemble les données RÉELLES (solde bancaire, factures
 * impayées, échéances à venir, charges récurrentes actives) et délègue tout
 * le calcul à `calculerPrevisionnelTresorerie` (lib/shared) — fonction pure,
 * testée en isolation sans base. Ce fichier ne fait QUE la collecte et le
 * filtrage, jamais l'arithmétique.
 */
import { Router, type IRouter } from "express";
import {
  withTenant,
  facturesTable,
  echeancesTable,
  chargesRecurrentesTable,
  bankAccountsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { toDateString, calculerPrevisionnelTresorerie, type Cadence } from "@nodaq/shared";
import { computeEcheanceStatus } from "./echeances.js";

const router: IRouter = Router();

router.get("/previsionnel-tresorerie", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const aujourdhui = toDateString(new Date());

  const { soldeDepartCents, facturesImpayees, echeancesAVenir, chargesRecurrentes } =
    await withTenant(tenantId, async (tx) => {
      const [tresorerie] = await tx
        .select({
          count: sql<number>`count(*)::int`,
          total: sql<number>`coalesce(sum(balance_cents), 0)::int`,
        })
        .from(bankAccountsTable);

      const factures = await tx.select().from(facturesTable);
      // Même définition de « impayée » que GET /factures (totalOverdueCents)
      // — pas de seconde définition inventée ici.
      const facturesImpayees = factures
        .filter((f) => f.statut !== "PAYEE" && f.statut !== "ANNULEE_PAR_AVOIR")
        .map((f) => ({
          id: f.id,
          dueDate: f.dueDate,
          montantCents: f.residualCents ?? f.amountCents ?? 0,
        }));

      const echeances = await tx.select().from(echeancesTable);
      // Même statut dérivé que l'Échéancier fiscal — une échéance EN_RETARD
      // n'est pas recomptée ici, elle est déjà signalée ailleurs (décision
      // produit explicite).
      const echeancesAVenir = echeances
        .filter((e) => computeEcheanceStatus(e.dueDate, e.status) === "A_VENIR")
        .map((e) => ({
          id: e.id,
          label: e.label,
          dueDate: e.dueDate,
          estimatedCents: e.estimatedCents ?? null,
        }));

      const charges = await tx
        .select()
        .from(chargesRecurrentesTable)
        .where(eq(chargesRecurrentesTable.active, true));
      const chargesRecurrentes = charges.map((c) => ({
        id: c.id,
        label: c.label,
        cadence: c.cadence as Cadence,
        startDate: c.startDate,
        endDate: c.endDate,
        amountCents: c.amountCents,
      }));

      return {
        soldeDepartCents: (tresorerie?.count ?? 0) > 0 ? tresorerie!.total : null,
        facturesImpayees,
        echeancesAVenir,
        chargesRecurrentes,
      };
    });

  const previsionnel = calculerPrevisionnelTresorerie({
    soldeDepartCents,
    aujourdhui,
    facturesImpayees,
    echeancesAVenir,
    chargesRecurrentes,
  });

  res.json(previsionnel);
});

export default router;
