/**
 * Dernier filet quand le moteur ne peut plus réparer lui-même une incohérence
 * de facturation. Aujourd'hui, un seul déclencheur : la compensation d'un
 * avoir (routes/avoirs.ts) qui échoue à son tour, laissant une facture
 * ANNULEE_PAR_AVOIR (ou son résiduel diminué) sans avoir correspondant — ce
 * qui gonfle le chiffre d'affaires du montant de la facture (voir
 * lib/chiffreAffaires.ts et la migration 026).
 *
 * Une ligne de journal dans un conteneur que personne ne lit ne protège pas
 * de ça : cette fonction écrit une trace DURABLE (incidents_facturation),
 * visible du propriétaire du tenant. Si CETTE écriture échoue aussi — le
 * pire cas — le dernier recours est un journal structuré qui ne porte que le
 * SQLSTATE et le nom de la contrainte, jamais `detail` (qui contient les
 * valeurs des colonnes) ni aucune donnée métier (CLAUDE.md §6).
 */
import { withTenant, incidentsFacturationTable } from "@workspace/db";
import { logger } from "./logger.js";

export interface ChargeUtileAvoirCompensationEchouee {
  factureId: string;
  factureNumero: string;
  /** Résiduel (centimes) que la compensation aurait dû restaurer. */
  residuelARestaurerCents: number;
  /** Statut de la facture avant que TX1 ne la réclame — toujours "EMISE". */
  statutPrecedent: string;
  /** Numéro d'avoir attribué en TX1 et jamais devenu un vrai avoir. */
  numeroAvoirBrule: string;
  /** Motif saisi par l'artisan pour l'avoir manqué. */
  motif: string;
  /** SQLSTATE de l'échec qui a déclenché la compensation (TX2 ou PDF). */
  sqlstateDeclenchant: string | null;
  /** SQLSTATE de l'échec de la compensation elle-même. */
  sqlstateCompensation: string | null;
}

/** Violation Postgres à travers l'enveloppe Drizzle — même doctrine que routes/catalogue.ts. */
function infosErreurPg(err: unknown): { code?: string; constraint?: string } {
  let courant: unknown = err;
  for (let i = 0; courant !== null && courant !== undefined && i < 5; i++) {
    const c = courant as { code?: string; constraint?: string; cause?: unknown };
    if (typeof c.code === "string") return { code: c.code, constraint: c.constraint };
    courant = c.cause;
  }
  return {};
}

export async function enregistrerIncidentAvoirCompensationEchouee(
  tenantId: string,
  chargeUtile: ChargeUtileAvoirCompensationEchouee,
): Promise<void> {
  try {
    await withTenant(tenantId, tx =>
      tx.insert(incidentsFacturationTable).values({
        tenantId,
        type: "AVOIR_COMPENSATION_ECHOUEE",
        factureId: chargeUtile.factureId,
        chargeUtile,
      }),
    );
  } catch (err) {
    // Dernier recours : même l'incident n'a pas pu s'écrire. SQLSTATE et
    // contrainte SEULEMENT — jamais `err.detail` (valeurs des colonnes),
    // jamais `chargeUtile` (motif, montants) dans ce journal.
    const { code, constraint } = infosErreurPg(err);
    logger.error(
      { sqlstate: code, constraint },
      "[incidents-facturation] écriture de l'incident elle-même en échec — révision manuelle requise",
    );
  }
}
