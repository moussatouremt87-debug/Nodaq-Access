/*
 * Reconnaître une violation d'unicité à travers l'emballage de Drizzle.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 * PostgreSQL rend `23505` sur une violation d'index unique, mais Drizzle
 * enveloppe l'erreur : le code ne se trouve pas à la racine de l'objet reçu,
 * il est plus bas dans la chaîne des `cause`. Un `err.code === "23505"` naïf
 * ne voit donc rien, et la route rend 500 là où elle devait rendre 409.
 *
 * Ce dépliage avait déjà été écrit deux fois — `facturation-temps.ts` et
 * `facturation-recurrente.ts` — et une troisième copie s'apprêtait à naître.
 * Trois versions du même contrôle, ce sont trois occasions de diverger en
 * silence : la première qui oublie un niveau de `cause` rend un 500 que
 * personne ne rattache à un doublon.
 *
 * ── La profondeur est bornée ──────────────────────────────────────────────
 * Une chaîne de `cause` cyclique ferait tourner la récursion indéfiniment.
 * Cinq niveaux couvrent largement l'emballage observé.
 */

/**
 * Cette erreur est-elle une violation d'unicité ?
 *
 * `indice` restreint la reconnaissance à un index précis — utile quand une
 * table en porte plusieurs et que le refus à rendre n'est pas le même.
 */
export function estViolationUnicite(
  err: unknown,
  indice?: string,
  profondeur = 0,
): boolean {
  if (err === null || typeof err !== "object" || profondeur > 5) return false;
  const o = err as { code?: string; message?: string; cause?: unknown };

  if (indice === undefined) {
    if (o.code === "23505") return true;
    if (typeof o.message === "string" && o.message.includes("duplicate key")) return true;
  } else if (typeof o.message === "string" && o.message.includes(indice)) {
    return true;
  } else if (o.code === "23505" && typeof o.message === "string" && o.message.includes(indice)) {
    return true;
  }

  return estViolationUnicite(o.cause, indice, profondeur + 1);
}
