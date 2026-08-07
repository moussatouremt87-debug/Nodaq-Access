/**
 * Mapping code NAF → pack métier NODAQ.
 *
 * CONFIG VERSIONNÉE DATÉE SOURCÉE (doctrine du repo).
 * Source : INSEE — Nomenclature d'Activités Française, rév. 2 (NAF rév. 2).
 *   https://www.insee.fr/fr/information/2120875
 * Consulté le 2026-08-07.
 *
 * L'application ne contient AUCUN `if (secteur === 'batiment')` —
 * le pack est injecté une seule fois depuis ce fichier au moment de
 * l'onboarding, puis stocké dans les settings du tenant.
 */

export const NAF_VERSION = "2026-08-07";

export type PackMetier = "batiment" | "generique";

/** Préfixes NAF reconnus comme relevant du bâtiment. */
const BATIMENT_PREFIXES: readonly string[] = [
  // Construction de bâtiments résidentiels et non résidentiels
  "41.1", "41.2",
  // Génie civil (routes, réseaux, travaux spécialisés)
  "42.1", "42.2", "42.9",
  // Travaux de construction spécialisés (électricité, plomberie, isolation…)
  "43.1", "43.2", "43.3", "43.9",
];

/**
 * Détermine le pack métier depuis un code NAF.
 *
 * Le code peut être dans l'un ou l'autre des formats courants :
 *   "4321Z", "43.21Z", "43.21 Z", "4321" (sans lettre).
 *
 * Retourne "batiment" si l'un des préfixes ci-dessus correspond,
 * "generique" sinon. Jamais d'exception — un code inconnu donne "generique".
 */
export function packFromNaf(code: string): PackMetier {
  if (!code) return "generique";

  // Normaliser : retirer espaces, mettre en majuscule, insérer le point si absent.
  const cleaned = code.replace(/\s/g, "").toUpperCase();
  // "4321Z" → "43.21Z"  |  "43.21Z" → "43.21Z"
  const normalized = cleaned.match(/^\d{2}\.\d{2}/)
    ? cleaned                                   // déjà "XX.XXY"
    : cleaned.replace(/^(\d{2})(\d{2})/, "$1.$2"); // "4321Z" → "43.21Z"

  for (const prefix of BATIMENT_PREFIXES) {
    if (normalized.startsWith(prefix)) return "batiment";
  }
  return "generique";
}

/** Libellé court du pack pour l'affichage. */
export const PACK_LABELS: Record<PackMetier, string> = {
  batiment: "Bâtiment & travaux",
  generique: "Artisan / TPE",
};
