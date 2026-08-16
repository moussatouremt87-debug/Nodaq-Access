/**
 * LA définition d'une facture « en retard ». Une seule, pour tout le
 * serveur — elle vivait recopiée dans `factures.ts` (filtre JS sur les
 * lignes déjà chargées) et, en divergence, dans `cockpit.ts` (`totalImpaye`
 * comptait TOUTE facture non soldée, sans jamais vérifier l'échéance — un
 * bug direct : une facture fraîchement émise, à échéance future, s'affichait
 * comme "en retard" sur le tableau de bord principal).
 *
 * `dueDate` est une date métier (`AAAA-MM-JJ`), pas un instant. La comparer à
 * l'heure exacte ferait passer en retard une échéance du jour même dès la
 * première seconde après minuit UTC — absurde pour un modèle comptant
 * (US-A3.4). Comparaison chaîne contre chaîne : une échéance n'est en retard
 * qu'à partir de DEMAIN.
 */
import { sql, type SQL } from "drizzle-orm";

const STATUTS_JAMAIS_EN_RETARD = ["PAYEE", "ANNULEE_PAR_AVOIR"] as const;

/** Version JS — filtre sur des lignes déjà chargées (`factures.ts`). */
export function estFactureEnRetard(
  f: { statut: string; dueDate: string },
  aujourdhui: string,
): boolean {
  return !(STATUTS_JAMAIS_EN_RETARD as readonly string[]).includes(f.statut) && f.dueDate < aujourdhui;
}

/**
 * Version SQL — condition prête à insérer dans un `WHERE` (`cockpit.ts`).
 *
 * PAS de cast `::date` : `due_date` est stocké en `text` (`AAAA-MM-JJ`), par
 * choix délibéré (voir `estFactureEnRetard` ci-dessus — comparaison chaîne
 * contre chaîne, jamais une horloge). Comparer `text < ${x}::date` échoue à
 * l'exécution (« operator does not exist: text < date ») ; `brief.ts` a
 * déjà la bonne version, sans cast, reprise ici à l'identique.
 */
export function conditionFactureEnRetardSql(aujourdhui: string): SQL {
  return sql`statut NOT IN ('PAYEE', 'ANNULEE_PAR_AVOIR') AND due_date < ${aujourdhui}`;
}

/** Montant restant dû d'une facture — solde partiel s'il existe, sinon le montant total. */
export function residuelFactureCents(f: { residualCents?: number | null; amountCents?: number | null }): number {
  return f.residualCents ?? f.amountCents ?? 0;
}
