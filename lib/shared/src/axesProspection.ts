/*
 * Axes de prospection — QUI démarcher, à partir du métier et de la zone.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  UNIQUEMENT DES CIBLES PROFESSIONNELLES.                                  ║
 * ║                                                                           ║
 * ║  Depuis le 11 août 2026, la prospection téléphonique vers un PARTICULIER  ║
 * ║  exige un consentement préalable — le ticket rappelle une sanction        ║
 * ║  pouvant atteindre 75 000 € par appel. Ce module ne peut donc pas         ║
 * ║  proposer de cible « particulier » : ce n'est pas un filtre appliqué      ║
 * ║  après coup, c'est un champ qui n'existe pas dans le type de sortie.      ║
 * ║                                                                           ║
 * ║  Un filtre s'oublie ; un type qui ne peut pas porter la valeur, non.      ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ── UNE SUGGESTION SANS SOURCE N'EXISTE PAS ─────────────────────────────────
 * Chaque axe porte une `source` obligatoire — un registre public, nommé et
 * citable. Sans elle, l'axe n'est pas construit : le type l'exige, et
 * `axesPourMetier` n'en produit aucun quand la configuration ne fournit pas de
 * source. Une suggestion qu'on ne peut pas justifier devant la personne
 * démarchée n'a rien à faire à l'écran.
 *
 * ── ZÉRO RÉSEAU, ZÉRO BASE ──────────────────────────────────────────────────
 * Ce module propose des AXES DE RECHERCHE, pas des entreprises. Interroger une
 * source publique est le travail de l'appelant, avec un transport injecté.
 */

/**
 * Nature de cible. Fermée, et volontairement SANS « particulier ».
 *
 * Ajouter cette valeur serait une décision juridique, pas un ajout technique :
 * elle ne se glisse pas dans un `switch` sans que quelqu'un la voie.
 */
export const CIBLES_PROSPECTION = [
  "syndic",
  "agence_immobiliere",
  "bailleur_social",
  "architecte",
  "entreprise_generale",
  "collectivite",
  "commerce",
  "industrie",
] as const;
export type CibleProspection = (typeof CIBLES_PROSPECTION)[number];

/** Une source publique, nommée et citable. */
export interface SourcePublique {
  /** Nom lisible, affiché tel quel à l'artisan. */
  readonly label: string;
  /** Adresse de la source, pour qu'il puisse vérifier lui-même. */
  readonly url: string;
}

export interface AxeProspection {
  readonly cible: CibleProspection;
  /** Libellé prêt à lire par un artisan. */
  readonly libelle: string;
  /** Pourquoi cette cible pour ce métier — une phrase, pas un score. */
  readonly pourquoi: string;
  /** Zone visée, telle que le tenant l'a renseignée. */
  readonly zone: string;
  /** OBLIGATOIRE. Sans elle, l'axe n'est pas construit. */
  readonly source: SourcePublique;
}

/** Ce que l'appelant sait du tenant. Rien n'est deviné. */
export interface ContexteTenant {
  /** Secteur déclaré par le tenant. `null` = non renseigné. */
  readonly secteur: string | null;
  /** Ville ou département. `null` = non renseigné. */
  readonly zone: string | null;
  /** Sources publiques configurées. VIDE = aucune suggestion possible. */
  readonly sources: readonly SourcePublique[];
}

/**
 * Cibles pertinentes par secteur.
 *
 * Une correspondance EXPLICITE, pas un modèle : on doit pouvoir dire à
 * l'artisan pourquoi on lui propose un syndic, et la réponse doit être la même
 * demain. Un secteur inconnu ne produit rien — inventer une cible plausible
 * serait exactement ce que ce module refuse de faire.
 */
const CIBLES_PAR_SECTEUR: Record<string, ReadonlyArray<{ cible: CibleProspection; pourquoi: string }>> = {
  batiment: [
    { cible: "syndic", pourquoi: "Les syndics arbitrent les travaux des parties communes et rappellent les mêmes entreprises." },
    { cible: "agence_immobiliere", pourquoi: "Les agences font remettre en état les biens entre deux locataires." },
    { cible: "bailleur_social", pourquoi: "Les bailleurs passent des marchés d'entretien récurrents." },
    { cible: "architecte", pourquoi: "Les architectes cherchent des entreprises fiables pour leurs chantiers." },
    { cible: "entreprise_generale", pourquoi: "La sous-traitance de lot est le premier apporteur d'affaires du bâtiment." },
    { cible: "collectivite", pourquoi: "Les communes publient des marchés d'entretien à leur échelle." },
  ],
  paysage: [
    { cible: "syndic", pourquoi: "Les copropriétés confient l'entretien des espaces verts à l'année." },
    { cible: "bailleur_social", pourquoi: "Les bailleurs entretiennent des espaces extérieurs sur contrat pluriannuel." },
    { cible: "collectivite", pourquoi: "Les communes externalisent l'entretien des espaces publics." },
  ],
  maintenance: [
    { cible: "syndic", pourquoi: "Les contrats d'entretien d'immeuble se renouvellent chaque année." },
    { cible: "commerce", pourquoi: "Les commerces ont besoin d'interventions rapides et récurrentes." },
    { cible: "industrie", pourquoi: "Les sites industriels contractualisent la maintenance préventive." },
  ],
};

/**
 * Propose des axes. Rend une liste VIDE quand on ne peut rien justifier.
 *
 * Trois raisons de ne rien rendre, toutes explicites côté appelant :
 *   — aucune source publique configurée : on ne suggère pas sans pouvoir citer ;
 *   — secteur non renseigné ou inconnu : on ne devine pas le métier ;
 *   — zone non renseignée : une cible sans périmètre n'est pas actionnable.
 *
 * Rendre une liste vide est un résultat, pas une panne. L'écran doit dire
 * laquelle des trois manque — c'est `raisonSilence` qui le permet.
 */
export function axesPourMetier(contexte: ContexteTenant): AxeProspection[] {
  if (contexte.sources.length === 0) return [];
  if (!contexte.secteur || !contexte.zone) return [];

  const cibles = CIBLES_PAR_SECTEUR[contexte.secteur.trim().toLowerCase()];
  if (!cibles) return [];

  const zone = contexte.zone.trim();
  // Chaque axe reçoit une source : la première configurée. L'appelant peut en
  // fournir plusieurs, l'axe en cite toujours UNE — un axe sans source ne peut
  // pas être construit, le type l'interdit.
  const source = contexte.sources[0]!;

  return cibles.map(({ cible, pourquoi }) => ({
    cible,
    libelle: `${LIBELLES[cible]} — ${zone}`,
    pourquoi,
    zone,
    source,
  }));
}

const LIBELLES: Record<CibleProspection, string> = {
  syndic: "Syndics de copropriété",
  agence_immobiliere: "Agences immobilières",
  bailleur_social: "Bailleurs sociaux",
  architecte: "Architectes",
  entreprise_generale: "Entreprises générales",
  collectivite: "Collectivités",
  commerce: "Commerces",
  industrie: "Sites industriels",
};

export type RaisonSilence =
  | "aucune_source"
  | "secteur_absent"
  | "zone_absente"
  | "secteur_inconnu"
  | null;

/** Pourquoi aucun axe n'est proposé. `null` quand il y en a. */
export function raisonSilence(contexte: ContexteTenant): RaisonSilence {
  if (contexte.sources.length === 0) return "aucune_source";
  if (!contexte.secteur) return "secteur_absent";
  if (!contexte.zone) return "zone_absente";
  if (!CIBLES_PAR_SECTEUR[contexte.secteur.trim().toLowerCase()]) return "secteur_inconnu";
  return null;
}

/** Phrase affichable, en français, pour chaque raison. */
export const MESSAGES_SILENCE: Record<NonNullable<RaisonSilence>, string> = {
  aucune_source:
    "Aucune source publique n'est configurée sur ce déploiement. Nous ne proposons " +
    "pas de piste que vous ne pourriez pas vérifier.",
  secteur_absent: "Renseignez votre secteur d'activité pour que nous proposions des pistes.",
  zone_absente: "Renseignez votre ville ou votre département pour délimiter la recherche.",
  secteur_inconnu:
    "Nous n'avons pas de piste établie pour ce secteur. Plutôt que d'en inventer une, " +
    "nous préférons ne rien proposer.",
};
