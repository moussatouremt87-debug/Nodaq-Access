/*
 * Codes CPV du bâtiment — ce qui délimite « pertinent pour un artisan BTP »
 * dans les avis BOAMP et les attributions DECP.
 *
 * Ancré sur la division CPV 45 (« Travaux de construction »). Une
 * correspondance EXPLICITE, comme `CIBLES_PAR_SECTEUR` dans
 * `axesProspection.ts` : on doit pouvoir dire à l'artisan pourquoi un marché
 * lui est proposé, et la réponse doit être la même demain — pas un modèle qui
 * devine.
 *
 * Ce n'est PAS la même taxonomie que `CIBLES_PROSPECTION` : celle-ci classe
 * des types de CIBLES (syndic, architecte…), celle-ci classe des NATURES DE
 * TRAVAUX. Les mélanger ferait porter deux idées différentes par un seul type.
 */

export interface SecteurBatiment {
  readonly prefixe: string;
  readonly libelle: string;
}

export const SECTEURS_CPV_BATIMENT: readonly SecteurBatiment[] = [
  { prefixe: "45211", libelle: "Bâtiments" },
  { prefixe: "45260", libelle: "Couverture et charpente" },
  { prefixe: "45262", libelle: "Gros œuvre et maçonnerie" },
  { prefixe: "45310", libelle: "Électricité" },
  { prefixe: "45330", libelle: "Plomberie" },
  { prefixe: "45410", libelle: "Plâtrerie" },
  { prefixe: "45420", libelle: "Menuiserie" },
  { prefixe: "45430", libelle: "Revêtements de sols et murs" },
  { prefixe: "45440", libelle: "Peinture et vitrerie" },
  { prefixe: "45450", libelle: "Autres travaux de finition" },
] as const;

/** Un code CPV relève-t-il du bâtiment ? */
export function estCpvBatiment(code: string): boolean {
  const c = code.trim();
  return SECTEURS_CPV_BATIMENT.some((s) => c.startsWith(s.prefixe));
}

/** Le libellé du secteur pour un code CPV, ou `null` hors bâtiment. */
export function libelleSecteurCpv(code: string): string | null {
  const c = code.trim();
  return SECTEURS_CPV_BATIMENT.find((s) => c.startsWith(s.prefixe))?.libelle ?? null;
}
