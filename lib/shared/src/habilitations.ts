/*
 * Habilitations de salarié — statut calculé au vol (US-A4.4).
 *
 * Aucun scheduler n'existe dans ce dépôt : une alerte d'expiration ne peut
 * être qu'une LECTURE PASSIVE, recalculée à chaque visite d'écran (brief
 * matin, planning), jamais un envoi poussé par un job de fond. C'est pour
 * ça que ce module ne fait que dériver un statut depuis une date — comme
 * `computeEcheanceStatus` (routes/echeances.ts) dont il reprend l'esprit,
 * mais pas le code : cette fonction-là compare `new Date(dueDate)` à
 * `new Date()`, exactement la construction que ce dépôt interdit pour une
 * date métier (décalage de fuseau près de minuit). Ici, tout reste une
 * comparaison de chaînes `YYYY-MM-DD`.
 */

import { toDateString } from "./dates.js";
import { VERTICALS, type Vertical } from "./verticalPacks.js";

export type StatutHabilitation = "EXPIREE" | "BIENTOT_EXPIREE" | "VALIDE" | "SANS_EXPIRATION";

/**
 * Fenêtre d'alerte avant l'échéance réelle, en jours.
 *
 * 30 jours : le temps de programmer un recyclage (habilitation électrique,
 * FIMO, carte professionnelle) avant que l'échéance ne soit dépassée. Un
 * seuil unique, pas de palier intermédiaire — même sobriété que `urgent:
 * boolean` dans brief.ts, pas un niveau de gravité à trois états.
 */
export const SEUIL_ALERTE_JOURS = 30;

/**
 * Statut d'une habilitation à la date du jour. PURE — aucune horloge lue
 * en dehors du paramètre `aujourdhui`, pour rester testable avec des dates
 * posées à la main.
 *
 * `dateExpiration: null` → SANS_EXPIRATION, jamais EXPIREE : une habilitation
 * sans échéance déclarée (un diplôme d'État, par exemple) reste valable
 * indéfiniment. En inventer une serait mentir sur une donnée absente.
 */
export function statutHabilitation(
  dateExpiration: string | null,
  aujourdhui: string,
  seuilJours: number = SEUIL_ALERTE_JOURS,
): StatutHabilitation {
  if (dateExpiration === null) return "SANS_EXPIRATION";
  if (dateExpiration < aujourdhui) return "EXPIREE";

  const [y, m, d] = aujourdhui.split("-").map(Number) as [number, number, number];
  const seuilDate = new Date(y, m - 1, d);
  seuilDate.setDate(seuilDate.getDate() + seuilJours);
  const seuilDateStr = toDateString(seuilDate);

  return dateExpiration <= seuilDateStr ? "BIENTOT_EXPIREE" : "VALIDE";
}

/** Une suggestion de saisie rapide — jamais un catalogue réglementaire fermé. */
export interface HabilitationSuggestion {
  readonly type: string;
  readonly libelle: string;
}

const ELECTRIQUE_BTP: readonly HabilitationSuggestion[] = [
  { type: "habilitation_electrique", libelle: "Habilitation électrique" },
  { type: "caces", libelle: "CACES" },
];

const TRANSPORT: readonly HabilitationSuggestion[] = [
  { type: "permis_conduire", libelle: "Permis de conduire" },
  { type: "carte_conducteur", libelle: "Carte conducteur (chronotachygraphe)" },
  { type: "fimo_fco", libelle: "FIMO / FCO" },
];

const SANTE: readonly HabilitationSuggestion[] = [
  { type: "diplome_etat", libelle: "Diplôme d'État" },
  { type: "autorisation_exercice", libelle: "Autorisation d'exercice" },
];

const SECURITE_PRO: readonly HabilitationSuggestion[] = [
  { type: "carte_pro_cnaps", libelle: "Carte professionnelle (CNAPS)" },
];

const AUCUNE: readonly HabilitationSuggestion[] = [];

const SUGGESTIONS_PAR_VERTICAL: Record<Vertical, readonly HabilitationSuggestion[]> = {
  batiment: ELECTRIQUE_BTP,
  paysage: ELECTRIQUE_BTP,
  industrie_btp: ELECTRIQUE_BTP,
  maintenance: ELECTRIQUE_BTP,
  transport: TRANSPORT,
  sante_liberale: SANTE,
  // "Sécurité privée" n'est pas un vertical à part (voir verticalPacks.ts —
  // ouvrir un 18e vertical pour une seule suggestion exigerait une migration
  // de CHECK, hors de proportion pour ce ticket) : rattaché au pack le plus
  // proche en registre, la prestation B2B.
  services_entreprises: SECURITE_PRO,
  evenementiel: AUCUNE,
  services_projet: AUCUNE,
  services: AUCUNE,
  negoce: AUCUNE,
  retail: AUCUNE,
  restauration_chr: AUCUNE,
  services_personne: AUCUNE,
  professions_liberales: AUCUNE,
  artisanat_service: AUCUNE,
  autre: AUCUNE,
};

/**
 * Suggestions de saisie pour le secteur d'un tenant. `[]` par défaut — un
 * secteur sans habilitation réglementée notoire n'en reçoit aucune plutôt
 * qu'une invention de complaisance ; le libellé reste de toute façon du
 * texte libre, cette liste n'accélère que la saisie.
 */
export function habilitationsSuggereesParVertical(
  vertical: string | null | undefined,
): readonly HabilitationSuggestion[] {
  if (!vertical) return AUCUNE;
  return (VERTICALS as readonly string[]).includes(vertical)
    ? SUGGESTIONS_PAR_VERTICAL[vertical as Vertical]
    : AUCUNE;
}
