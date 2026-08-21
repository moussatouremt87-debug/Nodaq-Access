/**
 * La liste blanche des numéros joignables en phase de test.
 *
 * Extraite de `campagnes-relance.ts` au ticket 4.19 : elle protégeait les
 * APPELS, et le lot B lui ajoute un second usage — les SMS de lien de
 * paiement. Un numéro qu'on ne s'autorise pas à appeler est un numéro qu'on
 * ne s'autorise pas à démarcher par écrit non plus. Deux copies de cette
 * règle auraient dérivé, et la dérive se serait vue le jour où l'une des
 * deux aurait laissé passer un vrai débiteur.
 */

/**
 * Le numéro est-il joignable ?
 *
 * La garde ne s'ARME que tant que le numéro sortant est américain : c'est
 * l'anomalie de la phase de test (un +1 qui appelle des artisans français
 * inspire la défiance et n'a aucune valeur de démonstration). Le jour où un
 * numéro français est branché, elle se désarme d'elle-même — et les
 * protections de droit commun (opposition, campagne validée) restent seules
 * en vigueur.
 *
 * Liste VIDE = personne n'est joignable. C'est voulu : une liste blanche qui
 * s'ouvre en grand quand on oublie de la remplir n'est pas une liste blanche.
 */
export function numeroAutoriseEnTest(numero: string): boolean {
  const appelant = process.env["TELEPHONY_CALLER_ID"] ?? "";
  if (!appelant.startsWith("+1")) return true;
  const autorises = (process.env["VOICE_TEST_NUMBERS"] ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  return autorises.includes(numero);
}
