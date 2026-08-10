/**
 * LA définition du chiffre d'affaires. Une seule, pour tout le serveur.
 *
 * Elle vivait recopiée dans `cockpit.ts` et `objectifs.ts`, et les deux copies
 * avaient déjà divergé. Un chiffre d'affaires qui vaut deux choses selon
 * l'écran n'est pas un chiffre d'affaires.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LE PIÈGE — à lire avant de toucher à la requête
 *
 * Le réflexe naturel est : « exclure les factures annulées par avoir ET
 * retrancher les avoirs ». Il est FAUX, il déduit deux fois.
 *
 * Quand un avoir consomme la totalité du restant dû, `avoirs.ts` bascule la
 * facture en `ANNULEE_PAR_AVOIR` (ligne 176) mais laisse `amount_cents`
 * INCHANGÉ. Exclure la facture retire déjà son montant ; soustraire l'avoir le
 * retire une seconde fois, et le CA plonge sous le réel.
 *
 * La règle correcte, uniforme sur les avoirs partiels comme totaux :
 *
 *   CA d'une période = somme des `amount_cents` des factures dont le statut est
 *   EMISE, PAYEE ou ANNULEE_PAR_AVOIR et dont la date d'émission tombe dans la
 *   période, MOINS la somme des avoirs (HT + TVA) émis sur la même période.
 *
 * Une facture totalement annulée est donc INCLUSE, puis annulée par son avoir :
 * solde nul, sans double comptage. Un avoir partiel diminue le CA du montant de
 * l'avoir, ce qui est exact puisque `amount_cents` n'est pas retouché.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * POURQUOI UNE LISTE BLANCHE et non une exclusion de `BROUILLON` : un statut
 * ajouté plus tard entrerait silencieusement dans le CA du patron. Ici, il
 * faudra l'ajouter à la main — et donc y penser.
 *
 * POURQUOI PAS `settled` : le CA est ce qui est FACTURÉ. L'encaissement est une
 * autre notion, qu'un artisan distingue parfaitement. Le seul indicateur qui a
 * le droit de filtrer sur `settled` est le taux de recouvrement.
 */
import { sql, type SQL } from "drizzle-orm";

/**
 * Les statuts qui font partie du chiffre d'affaires.
 *
 * `BROUILLON` en est absent, et c'est le cœur du correctif : `factures.ts`
 * renseigne `issued_date` dès la CRÉATION, alors que `statut` vaut
 * `BROUILLON`. Un devis facturé jamais émis portait donc une date d'émission
 * et gonflait la jauge sur laquelle le patron décide d'embaucher.
 */
export const STATUTS_CA = ["EMISE", "PAYEE", "ANNULEE_PAR_AVOIR"] as const;

/** Bornes d'une période, en dates métier (`YYYY-MM-DD`). Fin exclue. */
export interface PeriodeCa {
  readonly debut: string;
  /** `null` = pas de borne haute. Exclue quand elle est fournie. */
  readonly finExclue?: string | null;
}

/** Liste blanche prête à insérer dans un `IN (…)`, paramétrée et non concaténée. */
export const statutsCaSql: SQL = sql.join(
  STATUTS_CA.map((s) => sql`${s}`),
  sql`, `,
);

function bornes(colonne: SQL, p: PeriodeCa): SQL {
  const haute =
    p.finExclue != null ? sql` AND ${colonne} < ${p.finExclue}::date` : sql``;
  return sql`${colonne} >= ${p.debut}::date${haute}`;
}

/** Condition « cette facture compte dans le CA de la période ». */
export function conditionFactureCa(p: PeriodeCa): SQL {
  return sql`statut IN (${statutsCaSql}) AND ${bornes(sql`issued_date::date`, p)}`;
}

/**
 * Expression scalaire du CA net de la période, en centimes.
 *
 * Les deux sous-requêtes s'exécutent sous RLS comme le reste : appelée dans
 * `withTenant`, elles ne voient que le tenant courant.
 */
export function caNetCentsSql(p: PeriodeCa): SQL<number> {
  return sql<number>`(
    (SELECT coalesce(sum(amount_cents), 0) FROM factures WHERE ${conditionFactureCa(p)})
    -
    (SELECT coalesce(sum(montant_ht_cents + montant_tva_cents), 0) FROM avoirs
      WHERE ${bornes(sql`issued_date`, p)})
  )::float`;
}

/**
 * Nombre de factures entrées dans le CA de la période.
 *
 * Même liste blanche que le montant : afficher « 12 factures émises » alors
 * que trois sont des brouillons contredit le montant affiché juste à côté.
 */
export function nbFacturesCaSql(p: PeriodeCa): SQL<number> {
  return sql<number>`(SELECT count(*)::int FROM factures WHERE ${conditionFactureCa(p)})`;
}
