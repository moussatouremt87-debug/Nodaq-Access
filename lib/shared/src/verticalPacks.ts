/*
 * Packs verticaux (ticket 4.2) — CONFIG VERSIONNÉE DATÉE, et surtout LE
 * fichier qui porte les métiers.
 *
 * LA RÈGLE D'ARCHITECTURE QUE CE FICHIER EXISTE POUR TENIR (ADR-007) :
 * « un vertical = un fichier de données, jamais une ligne de code métier. »
 * Un `if (vertical === "batiment")` dans une feature transforme un produit en
 * cinq produits à maintenir — le jour du pack traiteur, on repaie chaque
 * occurrence. Une feature lit `affaireWords(vertical)` ou `verticalLabel()`
 * et ne sait rien de plus. Si un pack semble exiger du code, c'est le MOTEUR
 * qu'il faut étendre, pas le pack qu'il faut brancher.
 *
 * CE FICHIER ABSORBE `affaireVocabulary.ts` (4.1), qui s'annonçait lui-même
 * comme provisoire : ses cinq verticaux étaient ceux de l'ancienne
 * segmentation (industrie/BTP, retail, négoce, services) et ne recouvraient
 * pas la cible du pivot.
 *
 * POURQUOI DIX VERTICAUX ET NON CINQ. La cible du pivot en compte cinq
 * (bâtiment, paysage, événementiel, maintenance, services au projet). Les
 * cinq anciens RESTENT, et ce n'est pas de la timidité :
 *
 * - ils portent des OBLIGATIONS LÉGALES. `information-prix` (Code de la
 *   consommation, art. L112-1) est rattachée à `retail`/`negoce` dans la
 *   veille réglementaire. Supprimer ces verticaux retirerait silencieusement
 *   une obligation à un commerçant, par refonte d'un découpage commercial.
 *   Le coût des deux erreurs est asymétrique : un vertical de trop dans une
 *   liste se voit et se corrige, une obligation disparue ne se voit pas.
 * - CORRECTION (US-A1.1) : une table `tenant_profiles` avec `CHECK` était
 *   prévue mais n'a jamais été construite — vérifié, elle n'existe nulle
 *   part dans `lib/db`. Le vertical d'un tenant est stocké via le mécanisme
 *   `settings` générique (clé `votre-metier.metier`), validé par
 *   `z.enum(VERTICALS)` à la frontière API plutôt que par un `CHECK` en
 *   base — pas de nouvelle table pour ce ticket.
 *
 * `inTarget` dit lesquels sont la cible du pivot ; aucune feature n'a besoin
 * d'en savoir plus, et rien n'est supprimé.
 *
 * US-A1.1 (backlog v3) ÉTEND ce fichier à sept verticaux supplémentaires
 * (restauration/CHR, services à la personne, professions libérales,
 * artisanat de service, services aux entreprises, transport, santé
 * libérale) pour couvrir les neuf secteurs minimum exigés par l'onboarding,
 * et ajoute `proposalWord` (« Devis » / « Proposition commerciale ») — un
 * second axe de vocabulaire, orthogonal à `AffaireWords`, que ce fichier ne
 * portait pas encore.
 */

/** Bump à chaque ajout de pack ou correction de vocabulaire. */
export const VERTICAL_PACKS_VERSION = "2026-08-17";

/**
 * Verticaux STORABLES, dans l'ordre d'affichage : la cible du pivot d'abord,
 * l'ancienne segmentation ensuite, le neutre en dernier.
 *
 * Tuple `as const` et non dérivé des packs : `z.enum()` réclame des littéraux,
 * et la route de profil s'en sert pour valider l'entrée. La synchronisation
 * avec `VERTICAL_PACKS` est garantie par `Record<Vertical, …>` dans un sens et
 * par un test dans l'autre.
 *
 * **Toute modification ici exige une migration** : `tenant_profiles` porte un
 * `CHECK` sur cette liste (défense en profondeur), et un test vérifie que les
 * deux ne divergent pas.
 */
export const VERTICALS = [
  // Cible du pivot (ADR-007).
  "batiment",
  "paysage",
  "evenementiel",
  "maintenance",
  "services_projet",
  // Ancienne segmentation (3.7) — conservée : voir l'en-tête de fichier.
  "industrie_btp",
  "services",
  "negoce",
  "retail",
  // Cible du pivot multi-secteur (US-A1.1, backlog v3 Epic A1) — les 9 secteurs
  // que l'onboarding doit couvrir au minimum, moins bâtiment (déjà `batiment`)
  // et commerce (déjà `retail`).
  "restauration_chr",
  "services_personne",
  "professions_liberales",
  "artisanat_service",
  "services_entreprises",
  "transport",
  "sante_liberale",
  "autre",
] as const;

export type Vertical = (typeof VERTICALS)[number];

/** Les cinq métiers que le pivot vise. Dérivé, jamais recopié. */
export const PIVOT_VERTICALS = [
  "batiment",
  "paysage",
  "evenementiel",
  "maintenance",
  "services_projet",
] as const satisfies readonly Vertical[];

/** Les mots d'un métier pour désigner son unité de travail. */
export interface AffaireWords {
  /** « chantier » — minuscule, l'écran capitalise s'il en a besoin. */
  readonly singular: string;
  readonly plural: string;
  /** « un chantier » / « une mission » : l'article évite d'accorder à la main. */
  readonly indefinite: string;
  /** « le chantier » / « la mission ». */
  readonly definite: string;
  /** Libellé d'action, déjà accordé — « Nouveau chantier », « Nouvelle mission ». */
  readonly newLabel: string;
  /** Vide accordé — « Aucun chantier », « Aucune mission ». Le genre appartient
   *  au vocabulaire : un écran qui teste `singular === "affaire"` pour choisir
   *  un « e » réintroduit une règle de langue dans une feature. */
  readonly noneLabel: string;
}

export interface VerticalPack {
  readonly id: Vertical;
  /** Français, prêt à afficher — sélecteur d'onboarding, fiche réglementaire. */
  readonly label: string;
  /**
   * Ce métier fait-il partie de la cible du pivot (ADR-007) ?
   *
   * `false` ne veut dire NI éteint NI déprécié : le tenant fonctionne
   * normalement. C'est une information de cadrage produit, pas une frontière
   * de sécurité et pas un interrupteur.
   */
  readonly inTarget: boolean;
  readonly words: AffaireWords;
  /**
   * Le mot du document de proposition commerciale — « Devis » pour les
   * métiers de travaux/exécution, « Proposition commerciale » pour les
   * métiers de conseil (US-A1.1). Un simple mot d'affichage, pas une
   * structure `AffaireWords` complète : la story ne demande pas d'accord
   * grammatical riche sur cet axe.
   */
  readonly proposalWord: string;
  /**
   * Délai de paiement usuel du secteur, en jours (US-A3.1). `0` = encaissement
   * comptant (commerce, restauration) ; sinon le délai B2B standard. Sert
   * UNIQUEMENT à calibrer la sévérité d'une facture déjà en retard — jamais à
   * décider QUAND elle l'est : chaque facture porte sa propre `dueDate`,
   * convenue par le tenant, qui reste l'unique déclencheur (`estFactureEnRetard`,
   * `artifacts/api-server/src/lib/facturesEnRetard.ts`). Voir
   * `retardPaiement.ts` pour le calcul de sévérité qui consomme ce champ.
   */
  readonly delaiPaiementUsuelJours: number;
  /**
   * Le mot pour un prestataire externe (indépendant, intérimaire,
   * sous-traitant) — coûté dans les affaires, jamais compté dans la
   * capacité RH interne (US-A4.3). Même doctrine que `proposalWord` : des
   * mots bruts, pas une structure `AffaireWords` complète — aucun usage
   * actuel n'a besoin d'article ni d'accord.
   */
  readonly externalWorkerWords: { readonly singular: string; readonly plural: string };
  /**
   * Les unités de facturation TYPIQUES du secteur (US-A2.2).
   *
   * Elles ne contraignent rien : l'utilisateur dicte l'unité qu'il veut, et
   * le catalogue porte la sienne. Elles servent d'EXEMPLES au modèle, et
   * c'est précisément là que le biais se logeait — la liste écrite en dur
   * commençait par « m², ml », deux unités de chantier, sur chaque appel et
   * quel que soit le métier. Une coiffeuse ou une infirmière voyait donc le
   * modèle amorcé sur du gros œuvre avant d'avoir dit un mot.
   *
   * Le point d'attention d'US-A2.2 nomme exactement ce risque : « vérifier
   * que le modèle n'a pas été implicitement biaisé (prompt, exemples
   * few-shot) vers un vocabulaire de chantier ».
   */
  readonly unitesExemples: readonly string[];
}

const AFFAIRE: AffaireWords = {
  singular: "affaire",
  plural: "affaires",
  indefinite: "une affaire",
  definite: "l'affaire",
  newLabel: "Nouvelle affaire",
  noneLabel: "Aucune affaire",
};

const CHANTIER: AffaireWords = {
  singular: "chantier",
  plural: "chantiers",
  indefinite: "un chantier",
  definite: "le chantier",
  newLabel: "Nouveau chantier",
  noneLabel: "Aucun chantier",
};

const MISSION: AffaireWords = {
  singular: "mission",
  plural: "missions",
  indefinite: "une mission",
  definite: "la mission",
  newLabel: "Nouvelle mission",
  noneLabel: "Aucune mission",
};

const EVENEMENT: AffaireWords = {
  singular: "événement",
  plural: "événements",
  indefinite: "un événement",
  definite: "l'événement",
  // « Nouvel », pas « Nouveau » : masculin devant voyelle. C'est exactement le
  // genre de règle qu'on ne veut pas voir dériver dans un écran.
  newLabel: "Nouvel événement",
  noneLabel: "Aucun événement",
};

const INTERVENTION: AffaireWords = {
  singular: "intervention",
  plural: "interventions",
  indefinite: "une intervention",
  definite: "l'intervention",
  newLabel: "Nouvelle intervention",
  noneLabel: "Aucune intervention",
};

const PRESTATION: AffaireWords = {
  singular: "prestation",
  plural: "prestations",
  indefinite: "une prestation",
  definite: "la prestation",
  newLabel: "Nouvelle prestation",
  noneLabel: "Aucune prestation",
};

const DOSSIER: AffaireWords = {
  singular: "dossier",
  plural: "dossiers",
  indefinite: "un dossier",
  definite: "le dossier",
  newLabel: "Nouveau dossier",
  noneLabel: "Aucun dossier",
};

// Mots de prestataire externe (US-A4.3) — mêmes trois registres cités par le
// backlog lui-même : "sous-traitant" (bâtiment), "freelance" (un consultant
// qui fait appel à...), "extra" (un restaurant qui fait appel à...) ; les
// verticaux restants prennent le registre neutre "intérimaire".
const SOUS_TRAITANT_WORDS = { singular: "sous-traitant", plural: "sous-traitants" };
const FREELANCE_WORDS = { singular: "freelance", plural: "freelances" };
const EXTRA_WORDS = { singular: "extra", plural: "extras" };
const INTERIMAIRE_WORDS = { singular: "intérimaire", plural: "intérimaires" };

/**
 * Les packs. Exhaustif par construction (`Record<Vertical, …>`) : ajouter un
 * vertical sans lui écrire de pack ne compile pas.
 */
// Délai de paiement usuel (US-A3.1) — deux valeurs seulement, pas de
// troisième case "mixte" : le ticket ne demande de distinguer que comptant
// vs délai standard. `0` = encaissement immédiat, `30` = B2B standard.
const COMPTANT = 0;
const DELAI_B2B_STANDARD = 30;

export const VERTICAL_PACKS: Record<Vertical, VerticalPack> = {
  batiment: {
    id: "batiment",
    label: "Bâtiment / travaux",
    inTarget: true,
    words: CHANTIER,
    proposalWord: "Devis",
    delaiPaiementUsuelJours: DELAI_B2B_STANDARD,
    externalWorkerWords: SOUS_TRAITANT_WORDS,
    unitesExemples: ["m²", "ml", "u", "forfait"],
  },
  paysage: {
    id: "paysage",
    label: "Paysage / espaces verts",
    inTarget: true,
    // Un paysagiste dit « chantier » comme un maçon : le mot suit le métier,
    // pas la nomenclature.
    words: CHANTIER,
    proposalWord: "Devis",
    delaiPaiementUsuelJours: DELAI_B2B_STANDARD,
    externalWorkerWords: SOUS_TRAITANT_WORDS,
    unitesExemples: ["m²", "ml", "u", "forfait"],
  },
  evenementiel: {
    id: "evenementiel",
    label: "Événementiel / traiteur",
    inTarget: true,
    words: EVENEMENT,
    proposalWord: "Devis",
    // Prestation ponctuelle, réglée à l'événement (acompte + solde à la
    // prestation) — pas un cycle B2B à délai long.
    delaiPaiementUsuelJours: COMPTANT,
    externalWorkerWords: EXTRA_WORDS,
    unitesExemples: ["u", "jour", "forfait"],
  },
  maintenance: {
    id: "maintenance",
    label: "Maintenance / dépannage",
    inTarget: true,
    words: INTERVENTION,
    proposalWord: "Devis",
    delaiPaiementUsuelJours: DELAI_B2B_STANDARD,
    externalWorkerWords: SOUS_TRAITANT_WORDS,
    unitesExemples: ["u", "h", "forfait"],
  },
  services_projet: {
    id: "services_projet",
    label: "Services au projet",
    inTarget: true,
    words: MISSION,
    proposalWord: "Proposition commerciale",
    delaiPaiementUsuelJours: DELAI_B2B_STANDARD,
    externalWorkerWords: FREELANCE_WORDS,
    unitesExemples: ["jour", "h", "forfait"],
  },
  industrie_btp: {
    id: "industrie_btp",
    label: "Industrie / BTP (ancien découpage)",
    inTarget: false,
    // Conservé tel quel plutôt que renommé en `batiment` : « industrie ET BTP »
    // est plus large que « bâtiment ». Renommer d'office reclasserait un
    // industriel en entreprise de travaux, sans que personne l'ait demandé.
    words: CHANTIER,
    proposalWord: "Devis",
    delaiPaiementUsuelJours: DELAI_B2B_STANDARD,
    externalWorkerWords: SOUS_TRAITANT_WORDS,
    unitesExemples: ["m²", "ml", "t", "u", "forfait"],
  },
  services: {
    id: "services",
    label: "Services (ancien découpage)",
    inTarget: false,
    words: MISSION,
    proposalWord: "Proposition commerciale",
    delaiPaiementUsuelJours: DELAI_B2B_STANDARD,
    externalWorkerWords: INTERIMAIRE_WORDS,
    unitesExemples: ["h", "jour", "forfait"],
  },
  negoce: {
    id: "negoce",
    label: "Négoce",
    inTarget: false,
    // Négoce et retail ne travaillent pas « à l'affaire » — ils sont hors
    // cible. Le mot neutre est le seul honnête : inventer un mot de métier
    // pour un métier qu'on ne sert pas serait une promesse en trop.
    words: AFFAIRE,
    proposalWord: "Devis",
    // Vente comptant en majorité, comme le retail.
    delaiPaiementUsuelJours: COMPTANT,
    externalWorkerWords: INTERIMAIRE_WORDS,
    unitesExemples: ["u", "lot", "palette", "forfait"],
  },
  retail: {
    id: "retail",
    label: "Commerce de détail",
    inTarget: false,
    words: AFFAIRE,
    proposalWord: "Devis",
    // Le cas nommé explicitement par l'AC1 de US-A3.1.
    delaiPaiementUsuelJours: COMPTANT,
    externalWorkerWords: INTERIMAIRE_WORDS,
    unitesExemples: ["u", "lot", "forfait"],
  },
  // ── Cible du pivot multi-secteur (US-A1.1) ──────────────────────────────
  restauration_chr: {
    id: "restauration_chr",
    label: "Restauration / CHR",
    inTarget: true,
    // Un restaurateur ne travaille pas « à l'affaire » — pas de chantier, pas
    // de mission au sens où ce produit les entend. Mot neutre, honnête.
    words: AFFAIRE,
    proposalWord: "Devis",
    // Paiement à table/caisse, immédiat.
    delaiPaiementUsuelJours: COMPTANT,
    externalWorkerWords: EXTRA_WORDS,
    unitesExemples: ["couvert", "u", "h", "forfait"],
  },
  services_personne: {
    id: "services_personne",
    label: "Services à la personne",
    inTarget: true,
    words: INTERVENTION,
    proposalWord: "Devis",
    // Ambigu (mandataire CESU vs prestataire facturé à échéance, US-B4.2) —
    // tranché prudemment vers le délai standard : classer à tort en comptant
    // masquerait un indicateur utile, l'erreur inverse est sans conséquence.
    delaiPaiementUsuelJours: DELAI_B2B_STANDARD,
    externalWorkerWords: INTERIMAIRE_WORDS,
    unitesExemples: ["h", "intervention", "forfait"],
  },
  professions_liberales: {
    id: "professions_liberales",
    label: "Professions libérales",
    inTarget: true,
    words: MISSION,
    proposalWord: "Proposition commerciale",
    delaiPaiementUsuelJours: DELAI_B2B_STANDARD,
    externalWorkerWords: FREELANCE_WORDS,
    unitesExemples: ["h", "jour", "forfait"],
  },
  artisanat_service: {
    id: "artisanat_service",
    label: "Artisanat de service",
    inTarget: true,
    words: PRESTATION,
    proposalWord: "Devis",
    // Regroupe coiffure (comptant) et réparation avec devis préalable (délai
    // possible) — même compromis que le mot générique déjà retenu pour ce
    // pack (`words: PRESTATION`) : un choix unique et prudent, pas une
    // sous-catégorie que ce fichier ne porte pas.
    delaiPaiementUsuelJours: DELAI_B2B_STANDARD,
    externalWorkerWords: INTERIMAIRE_WORDS,
    unitesExemples: ["prestation", "u", "h", "forfait"],
  },
  services_entreprises: {
    id: "services_entreprises",
    label: "Services aux entreprises",
    inTarget: true,
    words: INTERVENTION,
    proposalWord: "Proposition commerciale",
    delaiPaiementUsuelJours: DELAI_B2B_STANDARD,
    externalWorkerWords: SOUS_TRAITANT_WORDS,
    unitesExemples: ["h", "passage", "m²", "forfait"],
  },
  transport: {
    id: "transport",
    label: "Transport",
    inTarget: true,
    // Le backlog dit lui-même « mission unitaire vs contrat de transport
    // récurrent » — le mot suit la source.
    words: MISSION,
    proposalWord: "Devis",
    delaiPaiementUsuelJours: DELAI_B2B_STANDARD,
    externalWorkerWords: SOUS_TRAITANT_WORDS,
    unitesExemples: ["km", "course", "h", "forfait"],
  },
  sante_liberale: {
    id: "sante_liberale",
    label: "Santé libérale",
    inTarget: true,
    words: DOSSIER,
    proposalWord: "Devis",
    // Tiers payant/mutuelle = délai structurel, souvent plus long qu'un B2B
    // classique — même côté de la frontière que le délai standard.
    delaiPaiementUsuelJours: DELAI_B2B_STANDARD,
    externalWorkerWords: INTERIMAIRE_WORDS,
    unitesExemples: ["séance", "consultation", "forfait"],
  },
  autre: {
    id: "autre",
    label: "Autre",
    inTarget: false,
    words: AFFAIRE,
    proposalWord: "Devis",
    // Neutre et prudent — c'est aussi le repli effectif d'un nouveau tenant
    // avant qu'il ait choisi son métier (`verticalPack()` route tout
    // vertical inconnu ici ; `DEFAULT_METIER` d'onboarding vaut
    // `industrie_btp`, lui-même délai standard).
    delaiPaiementUsuelJours: DELAI_B2B_STANDARD,
    externalWorkerWords: INTERIMAIRE_WORDS,
    unitesExemples: ["u", "h", "forfait"],
  },
};

export interface VerticalChoice {
  readonly id: Vertical;
  readonly label: string;
}

/**
 * Les métiers proposables, EN DEUX GROUPES — pour un `<optgroup>`.
 *
 * Une version précédente masquait purement et simplement l'ancien découpage,
 * sauf s'il était déjà la valeur du tenant. C'était une régression, et de la
 * pire espèce : un tenant qui n'était pas déjà `retail` ne pouvait PLUS se
 * déclarer commerçant, donc ne recevrait jamais l'obligation d'information sur
 * les prix. Le `CHECK` gardait la valeur, l'écran la rendait inatteignable —
 * même résultat produit que si on l'avait supprimée, c'est-à-dire exactement
 * ce que la migration déclare inacceptable. Elle était en prime à sens unique :
 * un tenant passé de `industrie_btp` à `batiment` n'avait plus aucun moyen de
 * revenir.
 *
 * Les deux groupes sont donc TOUJOURS rendus. Le libellé du groupe suffit à
 * dire lequel est d'actualité ; c'est un guidage, pas une porte fermée.
 */
export function verticalChoices(): { cible: VerticalChoice[]; ancien: VerticalChoice[] } {
  const cible: VerticalChoice[] = [];
  const ancien: VerticalChoice[] = [];
  for (const id of VERTICALS) {
    const pack = VERTICAL_PACKS[id];
    // `autre` n'est pas un métier : c'est le refus de choisir, et il doit
    // rester à portée immédiate plutôt que rangé dans « ancien découpage ».
    (pack.inTarget || id === "autre" ? cible : ancien).push({ id, label: pack.label });
  }
  return { cible, ancien };
}

/**
 * Mots à afficher pour un tenant. `null`, inconnu, ou vertical non renseigné →
 * « affaire ». Ne devine JAMAIS à partir du nom de l'entreprise ou de ses
 * pièces : se tromper de mot devant un client est gratuit et ridicule.
 */
export function affaireWords(vertical: string | null | undefined): AffaireWords {
  return verticalPack(vertical).words;
}

/** Libellé affichable d'un vertical — inconnu compris, jamais une chaîne vide. */
export function verticalLabel(vertical: string | null | undefined): string {
  return verticalPack(vertical).label;
}

/** Délai de paiement usuel (jours) du secteur d'un tenant — voir `VerticalPack.delaiPaiementUsuelJours`. */
export function delaiPaiementUsuelJours(vertical: string | null | undefined): number {
  return verticalPack(vertical).delaiPaiementUsuelJours;
}

/** Pack d'un tenant, avec repli neutre. Seule porte d'accès aux données métier
 *  d'un vertical : une feature qui indexerait `VERTICAL_PACKS` à la main
 *  planterait sur une valeur inconnue venue de la base. */
/**
 * Secteurs dont l'exercice est couvert par un SECRET PROFESSIONNEL légal
 * (US-A7.2). Le praticien engage sa responsabilité propre sur ce que l'outil
 * fait de la donnée de ses patients ou de ses clients — pas seulement celle de
 * NODAQ.
 *
 * Ces deux secteurs sont proposés à l'onboarding aujourd'hui : la question
 * n'est pas théorique.
 *
 * Le point d'attention de la story est explicite et vaut d'être répété ici :
 * ouvrir réellement un secteur à secret professionnel renforcé demande une
 * revue juridique dédiée. Cette liste sert le classement technique, elle ne
 * vaut pas validation légale.
 */
export const SECRET_PROFESSIONNEL_VERTICALS = [
  "sante_liberale",
  "professions_liberales",
] as const satisfies readonly Vertical[];

export function estSecretProfessionnel(vertical: string | null | undefined): boolean {
  return (SECRET_PROFESSIONNEL_VERTICALS as readonly string[]).includes(vertical ?? "");
}

export function verticalPack(vertical: string | null | undefined): VerticalPack {
  if (!vertical) return VERTICAL_PACKS.autre;
  return (VERTICALS as readonly string[]).includes(vertical)
    ? VERTICAL_PACKS[vertical as Vertical]
    : VERTICAL_PACKS.autre;
}
