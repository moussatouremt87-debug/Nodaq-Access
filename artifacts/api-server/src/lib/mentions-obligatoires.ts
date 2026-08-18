/**
 * Mentions obligatoires sur un document émis — table déclarative (US-A7.1).
 *
 * ── Ce que ce fichier remplace ───────────────────────────────────────────
 * `auditMentionsFR` était une suite de `if` impératifs. Deux d'entre eux
 * étaient déjà conditionnés au secteur (`decennaleApplicable`), mais la
 * condition vivait au milieu du corps de la fonction : ajouter une obligation
 * sectorielle, c'était ajouter un `if` de plus au même endroit, pour tout le
 * monde. Le point d'attention de la story l'interdit — le moteur doit être
 * « généralisé en un système déclaratif par secteur, pas réécrit secteur par
 * secteur ».
 *
 * Désormais : **une obligation = une entrée dans `REGLES_MENTIONS`**. Le
 * moteur (`auditMentionsFR`) ne change plus.
 *
 * ── La convention `verticals`, et pourquoi elle règle l'AC3 ──────────────
 * `verticals` absent = socle commun, évalué partout (SIRET, client, date,
 * franchise TVA). `verticals` présent = la règle n'est évaluée QUE pour ces
 * secteurs. Un secteur sans obligation particulière ne rencontre donc aucune
 * vérification supplémentaire — ce n'est pas une branche qu'on a pensé à
 * écrire, c'est la structure qui l'empêche. Même convention que
 * `RegulatoryItem.verticals` (`lib/shared/src/regulatoryWatch.ts`).
 *
 * ── Les citations légales ────────────────────────────────────────────────
 * Reprises MOT POUR MOT de l'implémentation d'origine. Une citation qu'on
 * reformule en migrant est une citation qu'on n'a pas vérifiée.
 */
import { decennaleApplicable, VERTICALS, type Vertical } from "@nodaq/shared";
import type { FactureForPdf } from "./pdf-generation.js";

export interface RegleMention {
  /** Code stable, rendu tel quel au client HTTP en cas de blocage. */
  readonly code: string;
  readonly message: string;
  /** `true` = l'émission est refusée. `false` = avertissement seul. */
  readonly bloquant: boolean;
  /**
   * Secteurs concernés. ABSENT = tous — c'est le socle commun.
   * Voir la note sur l'AC3 en tête de fichier.
   */
  readonly verticals?: readonly Vertical[];
  /** Vrai quand la mention manque, donc quand l'anomalie doit être signalée. */
  readonly enDefaut: (data: FactureForPdf) => boolean;
}

/**
 * Les secteurs exposés aux obligations liées aux travaux, DÉRIVÉS de
 * `decennaleApplicable` plutôt que recopiés. Une liste recopiée finirait par
 * diverger de celle de `regulatoryWatch.ts`, et deux vérités sur « qui est
 * concerné par les travaux » valent moins qu'une.
 */
const VERTICALS_TRAVAUX: readonly Vertical[] = VERTICALS.filter(decennaleApplicable);

/**
 * Professions à ordre : le numéro d'inscription figure sur les documents
 * professionnels (US-A7.1, AC1). `SellerInfo.numeroOrdre` existait déjà mais
 * n'était qu'AFFICHÉ s'il était renseigné — jamais exigé.
 */
const VERTICALS_ORDRE: readonly Vertical[] = ["professions_liberales", "sante_liberale"];

export const REGLES_MENTIONS: readonly RegleMention[] = [
  // ── Socle commun : aucune condition de secteur ──────────────────────────
  {
    code: "siret_vendeur_manquant",
    message:
      "SIRET de l'entreprise absent — mention obligatoire (art. 242 nonies A CGI). L'émission est bloquée jusqu'à renseignement dans Profil entreprise.",
    bloquant: true,
    enDefaut: (d) => !d.seller.siret?.replace(/\D/g, ""),
  },
  {
    code: "client_manquant",
    message: "Nom du client absent — la facture ne peut pas être identifiée.",
    bloquant: true,
    enDefaut: (d) => !d.clientName?.trim(),
  },
  {
    code: "date_emission_invalide",
    message: "Date d'émission absente ou au mauvais format.",
    bloquant: true,
    enDefaut: (d) => !d.issuedDate?.match(/^\d{4}-\d{2}-\d{2}$/),
  },
  {
    code: "aucune_ligne",
    message: "Facture sans aucune ligne — émission impossible.",
    bloquant: false,
    enDefaut: (d) => d.lines.length === 0,
  },
  {
    // US-A1.3 : une entreprise en franchise en base de TVA (art. 293 B CGI) ne
    // peut légalement facturer aucune TVA. Une ligne à taux non nul serait un
    // document juridiquement faux — bloquer plutôt que l'émettre.
    code: "franchise_tva_incoherente",
    message:
      "Le profil entreprise est déclaré en franchise en base de TVA (art. 293 B du CGI), mais une ligne porte un taux de TVA non nul. Corrigez le profil entreprise ou les lignes de la facture avant d'émettre.",
    bloquant: true,
    enDefaut: (d) => Boolean(d.seller.tvaFranchise) && d.lines.some((l) => (l.vatRate ?? 0) > 0),
  },

  // ── Travaux : gaté sur les secteurs exposés ─────────────────────────────
  {
    code: "attestation_tva_manquante",
    message:
      "Ligne(s) au taux réduit (10 % ou 5,5 %) sans attestation TVA signée par le client. L'émission est bloquée : récupérez et cochez l'attestation avant d'émettre.",
    bloquant: true,
    verticals: VERTICALS_TRAVAUX,
    enDefaut: (d) =>
      d.lines.some((l) => l.vatRate === 10 || l.vatRate === 5.5) && !d.attestationTvaFournie,
  },
  {
    code: "decennale_manquante",
    message:
      "Assurance décennale non renseignée dans Profil entreprise. La mention est obligatoire sur les factures de travaux (art. L.241-1 C.assur.). Complétez votre profil.",
    bloquant: false,
    verticals: VERTICALS_TRAVAUX,
    enDefaut: (d) => !d.seller.decennaleAssureur && !d.autoliquidation,
  },

  // ── Professions à ordre (US-A7.1) ───────────────────────────────────────
  {
    code: "numero_ordre_manquant",
    message:
      "Numéro d'inscription à l'ordre professionnel non renseigné dans Profil entreprise. Il est attendu sur les documents des professions réglementées à ordre. Complétez votre profil.",
    // NON BLOQUANT, délibérément — et c'est le point à relire le jour où la
    // santé sera ouverte.
    //
    // Rendre cette mention bloquante suppose une base légale précise, par
    // profession, que je n'ai pas pu vérifier ; `regulatoryWatch.ts` exige que
    // toute obligation porte sa source « vérifiée contre les textes cités », et
    // une citation inventée serait pire que l'absence de règle. Le backlog
    // impose lui-même une revue juridique AVANT l'ouverture des secteurs santé
    // et droit (US-A7.2, US-B9.2).
    //
    // Le jour où cette revue tranche : passer `bloquant` à `true`. Rien
    // d'autre ne bouge — c'est précisément ce que la table déclarative permet.
    bloquant: false,
    verticals: VERTICALS_ORDRE,
    enDefaut: (d) => !d.seller.numeroOrdre?.trim(),
  },
];
