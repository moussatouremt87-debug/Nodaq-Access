/*
 * Type de profil entreprise (US-A1.3) — pilote UNIQUEMENT l'affichage
 * conditionnel de l'écran de complétion du profil (progressive disclosure).
 * Le rendu PDF et l'audit des mentions légales (`pdf-generation.ts`) ne
 * lisent JAMAIS cette valeur : chaque mention (franchise TVA, numéro
 * d'ordre, capital social + RCS) se déclenche sur la présence de sa propre
 * donnée dans `SellerInfo`, pas sur un switch de catégorie — un profil
 * "société" sans capital renseigné n'affiche simplement rien, exactement
 * comme un profil sans décennale aujourd'hui.
 */
export const COMPANY_TYPE_PROFIL = ["micro_entreprise", "profession_liberale", "societe"] as const;
export type CompanyTypeProfil = (typeof COMPANY_TYPE_PROFIL)[number];
