/**
 * Sévérité d'un retard de paiement (US-A3.1) — PURE, sans I/O ni horloge
 * implicite (mêmes entrées, mêmes sorties, comme `previsionnelTresorerie.ts`).
 *
 * Une facture est « en retard » dès que sa propre `dueDate` (convenue par le
 * tenant) est dépassée — ça, `estFactureEnRetard` (côté serveur,
 * `artifacts/api-server/src/lib/facturesEnRetard.ts`) le décide déjà, et ce
 * module ne le refait pas.
 *
 * Ce module répond à une question DIFFÉRENTE : ce retard est-il notable
 * compte tenu du cycle réel du secteur ? Un commerce (délai usuel 0 jour) n'a
 * aucune marge — tout retard y est déjà anormal. Un B2B/conseil (délai usuel
 * 30 jours) absorbe naturellement quelques jours de flottement ; le signal ne
 * doit s'allumer qu'au-delà de son propre cycle habituel, pas au premier jour.
 *
 * `dueDate`/`aujourdhui` sont des dates métier (`AAAA-MM-JJ`), comparées en
 * composantes LOCALES — jamais `new Date(chaîne)` ni `toISOString()`, qui
 * décalent le jour calendaire hors UTC (voir `dates.ts`).
 */
import { toDateString } from "./dates.js";

const DATE_METIER = /^(\d{4})-(\d{2})-(\d{2})$/;

function ajouterJours(dateMetier: string, jours: number): string {
  const m = DATE_METIER.exec(dateMetier);
  if (!m) throw new Error(`Date métier invalide : ${dateMetier}`);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setDate(d.getDate() + jours);
  return toDateString(d);
}

/**
 * `true` si `aujourdhui` dépasse `dueDate` de PLUS que le délai usuel du
 * secteur — pas seulement `dueDate` elle-même. Implique déjà « en retard »
 * (le seuil ne peut être atteint qu'après `dueDate`) : aucun appel séparé à
 * `estFactureEnRetard` n'est nécessaire avant celui-ci.
 */
export function estRetardSignificatif(
  dueDate: string,
  aujourdhui: string,
  delaiPaiementUsuelJours: number,
): boolean {
  return aujourdhui > ajouterJours(dueDate, delaiPaiementUsuelJours);
}

/**
 * Date-seuil équivalente à `estRetardSignificatif`, pour un usage SQL :
 * `dueDate < seuilRetardSignificatif(aujourdhui, délai)` ⟺
 * `estRetardSignificatif(dueDate, aujourdhui, délai)` (algébriquement,
 * `aujourdhui > dueDate + délai ⟺ dueDate < aujourdhui − délai`). Permet de
 * réutiliser `conditionFactureEnRetardSql` (`facturesEnRetard.ts`) telle
 * quelle avec cette date à la place d'aujourd'hui, plutôt que d'écrire une
 * deuxième condition SQL qui pourrait diverger de la première.
 */
export function seuilRetardSignificatif(aujourdhui: string, delaiPaiementUsuelJours: number): string {
  return ajouterJours(aujourdhui, -delaiPaiementUsuelJours);
}
