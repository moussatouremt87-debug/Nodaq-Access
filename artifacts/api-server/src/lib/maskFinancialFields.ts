/**
 * Masque des champs financiers sur une ligne, pour un rôle qui n'y a pas
 * accès — généralise le patron déjà présent dans `cockpit.ts` (`estOwner`
 * nullait un seul champ à la main) plutôt que de le dupliquer à chaque site.
 *
 * NULL, jamais 0 ou une chaîne vide : un membre qui verrait « 0 € » croirait
 * à une absence de chiffre d'affaires, pas à un accès restreint. `null` est
 * sans ambiguïté et se distingue à l'écran par un texte, pas par un chiffre
 * qui pourrait être confondu avec une vraie valeur.
 */
export function maskFinancialFields<T extends Record<string, unknown>>(
  row: T,
  champs: readonly (keyof T)[],
  peutVoir: boolean,
): T {
  if (peutVoir) return row;
  const masque = { ...row };
  for (const champ of champs) {
    masque[champ] = null as T[keyof T];
  }
  return masque;
}
