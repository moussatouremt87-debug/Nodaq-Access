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
 *   CA d'une période = somme des bases HT des factures dont le statut est
 *   EMISE, PAYEE ou ANNULEE_PAR_AVOIR et dont la date d'émission tombe dans la
 *   période, MOINS la somme des montants HT des avoirs émis sur la même période.
 *
 * Une facture totalement annulée est donc INCLUSE, puis annulée par son avoir :
 * solde nul, sans double comptage. Un avoir partiel diminue le CA de son montant
 * HT, ce qui est exact puisque la facture n'est pas retouchée.
 *
 * HT DES DEUX CÔTÉS, et c'est le correctif du 29/08/2026. Ce paragraphe disait
 * `amount_cents` — le TTC — et « avoirs (HT + TVA) ». C'était cohérent avec
 * lui-même, mais le compte de résultat, lui, sommait le HT : le Cockpit
 * annonçait 159 822,40 € contre 136 526,00 €, soit la TVA collectée en trop.
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

/**
 * La base HT d'une facture — LA grandeur du chiffre d'affaires.
 *
 * Constaté le 29/08/2026 : le Cockpit annonçait 159 822,40 € là où le compte
 * de résultat, sur exactement les mêmes factures, affichait 136 526,00 €.
 * L'écart valait 23 296,40 € — la TVA collectée, au centime.
 *
 * `amount_cents` est le TTC. La TVA n'est pas un produit : elle est encaissée
 * pour l'État et reversée. L'inclure gonfle la jauge sur laquelle un patron
 * décide d'embaucher — et cette jauge s'affiche en gros sur la page d'accueil.
 *
 * Le repli sur `amount_cents` quand la base HT vaut 0 reprend `htCents()` de
 * `productionVendue.ts`, mot pour mot : les factures REPRISES d'un ancien
 * logiciel n'ont aucune ventilation, et les compter pour zéro effacerait le
 * passé de l'entreprise. Les deux définitions disent désormais la même chose ;
 * c'est tout l'objet du correctif.
 */
const htFactureSql: SQL = sql`CASE WHEN total_ht_cents > 0 THEN total_ht_cents ELSE amount_cents END`;

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
    (SELECT coalesce(sum(${htFactureSql}), 0) FROM factures WHERE ${conditionFactureCa(p)})
    -
    (SELECT coalesce(sum(montant_ht_cents), 0) FROM avoirs
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
