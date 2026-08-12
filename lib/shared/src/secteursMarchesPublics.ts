/*
 * Pertinence sectorielle des marchés publics — QUELS marchés/attributions
 * sont montrés à un tenant donné, pas seulement dans quelle zone.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  UNE VERTICALE SANS MAPPING NE PRODUIT RIEN.                              ║
 * ║  Un menuisier ne veut pas voir des fournitures de peluches pour l'armée   ║
 * ║  ni des prestations de sécurité aéroportuaire — le montrer serait pire    ║
 * ║  qu'un silence : ça rendrait le signal inutilisable, noyé dans du bruit.  ║
 * ║  Une verticale hors de la liste ci-dessous (services_projet,              ║
 * ║  industrie_btp, services, negoce, retail, autre) rend un mapping `null` — ║
 * ║  ce n'est PAS un défaut à corriger en devinant une correspondance, c'est  ║
 * ║  le comportement voulu tant que le mapping n'a pas été validé.            ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ── DEUX MÉCANISMES DE FILTRAGE, PARCE QUE DEUX SOURCES DIFFÉRENTES ─────────
 * DECP (`decp_augmente`) expose un champ structuré `codecpv_division` —
 * confirmé en lisant le schéma réel du jeu de données ce soir. `divisionsCpv`
 * sert à filtrer la requête réseau directement dessus.
 *
 * BOAMP (`boamp`), en revanche, N'EXPOSE AUCUN CHAMP CPV interrogeable —
 * confirmé de la même façon : le schéma du jeu de données ne porte que
 * `descripteur_code`/`descripteur_libelle` (un thésaurus français, pas la
 * nomenclature CPV) et le code CPV réel n'existe que dans le champ `donnees`,
 * une chaîne JSON imbriquée non interrogeable par `where=`. `motsCles` sert
 * donc à une recherche plein texte (`q=`) sur les champs descriptifs — un
 * mécanisme différent, pas un oubli.
 */
import type { Vertical } from "./verticalPacks.js";

export interface SecteurMarchesPublics {
  /** Divisions CPV à deux chiffres — pour filtrer `codecpv_division` (DECP). */
  readonly divisionsCpv: readonly string[];
  /** Termes français — pour une recherche plein texte `q=` (BOAMP). */
  readonly motsCles: readonly string[];
}

/**
 * Seules les verticales dont la correspondance CPV a été établie avec
 * confiance figurent ici. Volontairement partiel — voir l'en-tête du fichier.
 */
const SECTEURS_MARCHES_PUBLICS: Partial<Record<Vertical, SecteurMarchesPublics>> = {
  batiment: {
    divisionsCpv: ["45"],
    motsCles: [
      "bâtiment", "travaux", "construction", "rénovation", "toiture",
      "couverture", "charpente", "maçonnerie", "gros œuvre", "second œuvre",
      "électricité", "plomberie", "peinture", "menuiserie", "isolation",
      "façade", "carrelage", "plâtrerie",
    ],
  },
  paysage: {
    divisionsCpv: ["77"],
    motsCles: [
      "espaces verts", "paysage", "paysagiste", "jardin", "entretien de zones vertes",
      "élagage", "tonte", "horticulture", "plantation",
    ],
  },
  evenementiel: {
    divisionsCpv: ["55", "79"],
    motsCles: [
      "traiteur", "événementiel", "réception", "organisation d'événements",
      "restauration", "organisation d'expositions",
    ],
  },
  maintenance: {
    divisionsCpv: ["50"],
    motsCles: ["maintenance", "entretien", "dépannage", "réparation"],
  },
};

/** Le mapping pour une verticale, ou `null` si aucun n'est établi. */
export function secteurMarchesPublicsPour(vertical: string | null): SecteurMarchesPublics | null {
  if (!vertical) return null;
  return SECTEURS_MARCHES_PUBLICS[vertical as Vertical] ?? null;
}
