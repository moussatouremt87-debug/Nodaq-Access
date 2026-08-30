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

/**
 * Les statuts qu'aucune échéance ne met en retard.
 *
 * `BROUILLON` en fait partie, et c'est le cœur du correctif du 29/08/2026 :
 * `factures.ts` renseigne `due_date` dès la CRÉATION, alors que le statut vaut
 * encore `BROUILLON`. L'échéance existe donc AVANT que le document n'existe
 * pour le client. Un brouillon de 12 000 €, jamais émis et jamais envoyé,
 * gonflait le total « en retard » de l'écran Factures.
 *
 * La portée n'était pas cosmétique : cette définition alimente le Cockpit, le
 * Brief matin, l'écran Factures ET la liste d'impayés que l'agent propose de
 * relancer. Une relance pouvait partir chez un client pour une facture qu'il
 * n'avait jamais reçue.
 *
 * `STATUTS_CA` (`chiffreAffaires.ts`) avait déjà exclu `BROUILLON` pour la même
 * raison, écrite dans les mêmes termes. Les deux listes se rejoignent ici.
 *
 * Exportée pour que le test puisse vérifier que la version SQL ci-dessous en
 * dérive réellement — c'était le vrai risque de divergence.
 */
export const STATUTS_JAMAIS_EN_RETARD = ["PAYEE", "ANNULEE_PAR_AVOIR", "BROUILLON"] as const;

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
  // Dérivée de la MÊME constante que la version JS, et non recopiée : la liste
  // était écrite en dur ici, si bien qu'ajouter un statut au-dessus n'aurait
  // rien changé au SQL. Les deux chemins auraient répondu différemment sans
  // qu'aucun test ne s'en aperçoive — exactement le mode de divergence que
  // l'en-tête de ce fichier dit vouloir éviter.
  //
  // Paramétré, jamais concaténé : `sql.join` produit des placeholders.
  const exclus = sql.join(
    STATUTS_JAMAIS_EN_RETARD.map((s) => sql`${s}`),
    sql`, `,
  );
  return sql`statut NOT IN (${exclus}) AND due_date < ${aujourdhui}`;
}

/** Montant restant dû d'une facture — solde partiel s'il existe, sinon le montant total. */
export function residuelFactureCents(f: { residualCents?: number | null; amountCents?: number | null }): number {
  return f.residualCents ?? f.amountCents ?? 0;
}
