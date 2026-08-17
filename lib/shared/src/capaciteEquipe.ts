/*
 * Capacité RH — sous-traitant coûté, jamais compté (US-A4.3).
 *
 * Cette règle vivait en deux copies indépendantes : `routes/onboarding.ts`
 * (`GET /reprise/capacite-equipe`, calcul one-shot) l'appliquait déjà ;
 * `services/planning-service.ts` (`buildSemaines`, vu chaque jour sur
 * `/equipe`) l'ignorait complètement — un sous-traitant comptait pleinement
 * dans la capacité affichée au quotidien, à l'exact opposé de la règle censée
 * s'appliquer. Une seule source évite qu'un troisième site la réécrive une
 * troisième fois, divergente.
 *
 * Le principe n'est pas spécifique au bâtiment : un consultant qui fait appel
 * à un freelance, un restaurant à un extra, suivent la même règle — le coût
 * de leur temps compte, leur présence ne dit rien de la capacité RH interne.
 */

export const TYPE_LIEN_VALUES = ["SALARIE", "SOUS_TRAITANT", "APPRENTI"] as const;
export type TypeLien = (typeof TYPE_LIEN_VALUES)[number];

/** Un membre de ce type de lien compte-t-il dans la capacité RH interne ? */
export function compteDansCapacite(typeLien: string): boolean {
  return typeLien !== "SOUS_TRAITANT";
}
