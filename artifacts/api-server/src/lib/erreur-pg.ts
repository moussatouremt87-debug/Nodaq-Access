/**
 * Champs d'une erreur PostgreSQL, prêts pour le journal.
 *
 * ── POURQUOI ────────────────────────────────────────────────────────────────
 * `console.error("…:", err)` ne dit rien d'exploitable : dans un journal de
 * production, l'objet est aplati en une chaîne où le code SQLSTATE — la seule
 * chose qui distingue un verrou d'un doublon — se perd.
 *
 * Or c'est ce code qui tranche :
 *
 *   23505  unique_violation        → deux fois le même numéro
 *   40001  serialization_failure   → transactions concurrentes rejouées
 *   40P01  deadlock_detected       → interblocage
 *   55P03  lock_not_available      → verrou déjà pris
 *   57014  query_canceled          → délai dépassé
 *
 * ── CE QU'ON NE JOURNALISE PAS ──────────────────────────────────────────────
 * `detail` est délibérément absent. PostgreSQL y met les VALEURS des colonnes
 * en cause — « Key (tenant_id, number)=(…, …) already exists ». C'est
 * précisément le genre de contenu que ce dépôt refuse de laisser filer dans un
 * journal. Le nom de la contrainte suffit à savoir laquelle a parlé.
 */

/** Ce qu'on retient d'une erreur, qu'elle vienne du moteur ou d'ailleurs. */
export interface ChampsErreur {
  /** SQLSTATE, présent seulement si l'erreur vient de PostgreSQL. */
  readonly code?: string;
  /** Nom de la contrainte violée — `factures_tenant_number_unique` par exemple. */
  readonly contrainte?: string;
  readonly table?: string;
  /** Fonction interne du moteur ayant levé l'erreur. Utile sur les verrous. */
  readonly routine?: string;
  readonly message?: string;
}

function chaine(source: Record<string, unknown>, cle: string): string | undefined {
  const valeur = source[cle];
  return typeof valeur === "string" && valeur.length > 0 ? valeur : undefined;
}

/** Extrait les champs utiles d'une erreur inconnue, sans jamais lever. */
export function champsErreur(err: unknown): ChampsErreur {
  if (typeof err !== "object" || err === null) {
    return { message: typeof err === "string" ? err : undefined };
  }
  const source = err as Record<string, unknown>;
  return {
    code: chaine(source, "code"),
    contrainte: chaine(source, "constraint"),
    table: chaine(source, "table"),
    routine: chaine(source, "routine"),
    message: chaine(source, "message"),
  };
}
