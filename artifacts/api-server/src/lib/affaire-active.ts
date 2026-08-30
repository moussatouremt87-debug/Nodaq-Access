/**
 * LA définition d'une affaire ACTIVE — un chantier en cours, au sens métier.
 *
 * ── CE QUI A ÉTÉ CONSTATÉ ───────────────────────────────────────────────────
 *
 * Le 29/08/2026, sur une base peuplée par les routes réelles : quatre chantiers
 * acceptés, avec leurs devis signés, leurs heures pointées et leurs factures.
 * Le Cockpit affichait « Chantiers en cours : 0 ».
 *
 * Six endroits comptaient les affaires actives, avec trois réponses :
 *
 *   EN_COURS seul              cockpit.ts, brief.ts, mistralAgent.ts (×2)
 *   ACCEPTEE + EN_COURS        pointages.ts, auth.ts
 *   + variantes accentuées     planning-service.ts
 *
 * Or la conversion d'un devis accepté crée l'affaire en `ACCEPTEE`, et RIEN ne
 * la fait jamais passer en `EN_COURS` — seul l'import de reprise écrit ce
 * statut. Les trois premiers ne voyaient donc jamais aucun chantier. L'agent
 * non plus : « quels sont mes chantiers en cours ? » répondait « aucun ».
 *
 * ── POURQUOI LES VARIANTES ACCENTUÉES RESTENT ──────────────────────────────
 *
 * `ACCEPTÉ` et `ACCEPTÉE` traînaient dans la liste du planning. Aucun chemin
 * d'écriture actuel ne les produit — l'import pose `EN_COURS` en dur. Elles
 * sont vestigiales.
 *
 * Elles sont conservées quand même : les retirer exclurait silencieusement des
 * chantiers d'un tenant dont la base porte encore ces valeurs, et un chantier
 * qui disparaît du planning ne se remarque pas tout de suite. À élaguer le jour
 * où une requête sur les bases réelles confirme qu'aucune ligne ne les porte —
 * pas avant.
 */
import { sql, inArray, type SQL } from "drizzle-orm";
import { affairesTable } from "@workspace/db";

export const STATUTS_AFFAIRE_ACTIVE = [
  "ACCEPTEE",
  "EN_COURS",
  // Variantes historiques — voir l'en-tête avant de les retirer.
  "ACCEPTÉ",
  "ACCEPTÉE",
] as const;

/** Version Drizzle, pour un `.where(...)`. */
export const conditionAffaireActive = () =>
  inArray(affairesTable.status, STATUTS_AFFAIRE_ACTIVE as unknown as string[]);

/**
 * Version SQL brute, dérivée de la MÊME constante.
 *
 * Paramétrée, jamais concaténée. La leçon vient de `facturesEnRetard.ts`, où
 * la version SQL était une copie figée de la liste JS : ajouter un statut
 * n'aurait rien changé au SQL, et personne ne l'aurait vu.
 */
export const statutsAffaireActiveSql: SQL = sql.join(
  STATUTS_AFFAIRE_ACTIVE.map((s) => sql`${s}`),
  sql`, `,
);

/** Version JS — pour filtrer des lignes déjà chargées. */
export function estAffaireActive(status: string | null | undefined): boolean {
  return (STATUTS_AFFAIRE_ACTIVE as readonly string[]).includes(status ?? "");
}
