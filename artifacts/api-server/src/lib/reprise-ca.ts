/**
 * Le chiffre d'affaires déclaré à la mise en route (US-A1.2).
 *
 * Enregistré par l'onboarding en EUROS, dans `settings` — la conversion en
 * centimes appartient à `productionVendue`, qui est testée pour ça.
 *
 * Extrait de `routes/compte-resultat.ts` le 29/08/2026, sans changer une
 * ligne de son comportement : le rapport mensuel doit lire la MÊME reprise que
 * le compte de résultat, et un module de route n'a pas à en importer un autre.
 */
import { eq } from "drizzle-orm";
import { settingsTable, type DrizzleTx } from "@workspace/db";
import type { RepriseCA } from "@nodaq/shared";

export async function chargerReprise(tx: DrizzleTx): Promise<RepriseCA> {
  const lire = async (cle: string): Promise<string | null> => {
    const [row] = await tx.select({ value: settingsTable.value })
      .from(settingsTable).where(eq(settingsTable.key, cle));
    return row?.value ?? null;
  };
  const ca = await lire("reprise.ca_facture_ytd");
  const nombre = ca === null ? null : Number(ca);
  return {
    // Une valeur illisible vaut absence : mieux vaut une ligne sans reprise
    // qu'un `NaN` propagé jusqu'au total d'un compte de résultat.
    caFactureEuros: nombre === null || !Number.isFinite(nombre) ? null : nombre,
    dateDebutExercice: await lire("reprise.date_debut_exercice"),
  };
}
