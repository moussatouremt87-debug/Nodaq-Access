/*
 * Intentions vocales — ce que le MODÈLE a le droit de produire.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  le modèle produit une INTENTION       — des faits dictés, rien d'autre   ║
 * ║  le serveur RÉSOUT les références      — contre les données du tenant     ║
 * ║  l'utilisateur VALIDE un plan          — un seul geste, tout affiché      ║
 * ║  le serveur EXÉCUTE en une transaction — tout ou rien                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * LA GARANTIE EST STRUCTURELLE, PAS RÉDACTIONNELLE. Le modèle ne peut pas
 * écrire d'identifiant ni de montant parce que les schémas ci-dessous n'en
 * contiennent AUCUN champ — pas parce qu'on le lui a demandé gentiment.
 * `.strict()` fait le reste : une sortie qui en porterait un est REJETÉE, pas
 * nettoyée après coup. Nettoyer laisse croire qu'on a compris ce qui a été
 * proposé ; refuser dit qu'on ne l'a pas compris.
 *
 * Une intention porte les mentions TELLES QUE DICTÉES — « Thomas »,
 * « M. Dupont », « Marly-Gomont », « le 27 août ». Le rapprochement avec une
 * personne ou un objet réel est le travail du serveur : lui seul voit les
 * données du tenant, et lui seul peut dire « il y a deux Dupont ».
 */

import { z } from "zod";
import { toDateString } from "./dates.js";
import { normaliser } from "./rapprochementCatalogue.js";

// ── Les intentions ───────────────────────────────────────────────────────────

/** Un texte dicté : non vide, borné, sans mise en forme. */
const Mention = z.string().trim().min(1).max(300);

/**
 * Statuts d'affaire que la voix peut demander.
 *
 * Liste blanche : un statut ajouté plus tard ne doit pas devenir dictable sans
 * qu'on y ait pensé.
 */
export const STATUTS_AFFAIRE_DICTABLES = [
  "PROSPECT",
  "ACCEPTEE",
  "EN_COURS",
  "TERMINEE",
  "ANNULEE",
] as const;

export const IntentionCreerAffaire = z
  .object({
    type: z.literal("creer_affaire"),
    label: Mention,
    clientMentionne: Mention.nullable().optional(),
    villeMentionnee: Mention.nullable().optional(),
    dateDebutMentionnee: Mention.nullable().optional(),
  })
  .strict();

export const IntentionCreerProspect = z
  .object({
    type: z.literal("creer_prospect"),
    nom: Mention,
    telephoneMentionne: Mention.nullable().optional(),
    villeMentionnee: Mention.nullable().optional(),
  })
  .strict();

export const IntentionMajStatutAffaire = z
  .object({
    type: z.literal("maj_statut_affaire"),
    affaireMentionnee: Mention,
    statut: z.enum(STATUTS_AFFAIRE_DICTABLES),
  })
  .strict();

export const IntentionCreerEcheance = z
  .object({
    type: z.literal("creer_echeance"),
    libelle: Mention,
    dateMentionnee: Mention.nullable().optional(),
  })
  .strict();

export const IntentionCreerEntreeClasseur = z
  .object({
    type: z.literal("creer_entree_classeur"),
    titre: Mention,
    categorieMentionnee: Mention.nullable().optional(),
  })
  .strict();

export const IntentionConsignerActivite = z
  .object({
    type: z.literal("consigner_activite"),
    libelle: Mention,
  })
  .strict();

/**
 * Types d'absence que la voix peut demander. Même liste blanche que
 * `AbsenceBody` dans `routes/equipe.ts` — un type ajouté d'un côté doit
 * l'être des deux, sinon la voix pourrait proposer une absence que l'écran
 * équipe refuserait d'enregistrer.
 */
export const TYPES_ABSENCE_DICTABLES = ["Congés", "Maladie", "RTT", "Autre"] as const;

export const IntentionDeclarerAbsence = z
  .object({
    type: z.literal("declarer_absence"),
    membreMentionne: Mention,
    typeAbsence: z.enum(TYPES_ABSENCE_DICTABLES),
    dateDebutMentionnee: Mention,
    /** Absente ou nulle → absence d'un seul jour, date de fin = date de début. */
    dateFinMentionnee: Mention.nullable().optional(),
  })
  .strict();

export const IntentionAffecterMembre = z
  .object({
    type: z.literal("affecter_membre"),
    membreMentionne: Mention,
    affaireMentionnee: Mention,
    dateDebutMentionnee: Mention,
    dateFinMentionnee: Mention.nullable().optional(),
    // Pas d'heures/jour ici : le modèle ne fixe aucun nombre (règle 3 du
    // dépôt) — le serveur applique un défaut fixe à l'exécution.
  })
  .strict();


/**
 * Pointer des heures (ticket 4.21, lot 1).
 *
 * « Trois heures chez Delacroix aujourd'hui. » C'est la saisie qu'on repousse
 * au vendredi et qu'on finit par faire de mémoire, donc mal — et c'est la
 * seule qui se dicte naturellement en descendant du chantier, une main sur le
 * volant posée.
 *
 * `heures` est un NOMBRE dicté, pas un nombre calculé : l'utilisateur le
 * prononce, le modèle l'extrait, et la garde des chiffres inventés refuse
 * tout ce qui n'était pas dans la phrase. La règle 3 interdit au modèle de
 * calculer un total, pas de transcrire ce qu'il entend.
 *
 * Le rattachement est une MENTION, résolue par le serveur contre les affaires
 * du tenant — jamais un identifiant fabriqué par le modèle.
 */
export const IntentionPointerHeures = z
  .object({
    type: z.literal("pointer_heures"),
    affaireMentionnee: Mention,
    membreMentionne: Mention.nullable().optional(),
    /** Quart d'heure minimum, journée maximum : au-delà, c'est une erreur de
     *  dictée, pas une longue journée. */
    heures: z.number().min(0.25).max(24),
    dateMentionnee: Mention.nullable().optional(),
  })
  .strict();


/**
 * Créer un client (ticket 4.21, lot 2).
 *
 * L'asymétrie la plus visible du vocabulaire vocal : on pouvait dicter un
 * PROSPECT mais pas un CLIENT — alors que le client est l'objet auquel se
 * rattachent affaires, devis et factures. « Nouveau client, Menuiserie
 * Delacroix, à Rouen. »
 *
 * Le TYPE (particulier ou professionnel) n'est pas dicté : il commande des
 * règles de démarchage différentes (voir `canauxProspection`), et le déduire
 * d'un nom d'entreprise entendu serait une décision juridique prise par un
 * modèle. Le serveur applique le défaut de la table, l'écran corrige.
 */
export const IntentionCreerClient = z
  .object({
    type: z.literal("creer_client"),
    nom: Mention,
    telephoneMentionne: Mention.nullable().optional(),
    emailMentionne: Mention.nullable().optional(),
    villeMentionnee: Mention.nullable().optional(),
  })
  .strict();


/**
 * Enregistrer un règlement reçu (ticket 4.21, lot 3).
 *
 * « Delacroix m'a réglé la 181. » L'artisan qui reçoit un chèque sur un
 * chantier peut le consigner sur place, au lieu de le retrouver trois
 * semaines plus tard dans une poche de veste.
 *
 * ── Aucun montant dans ce schéma, et c'est une garde qui l'a imposé ───────
 * La première version acceptait un `montantEuros` dicté. Le test « AUCUN
 * schéma d'intention ne déclare de champ monétaire » l'a refusée, et il avait
 * raison : ce champ aurait fait produire un montant PAR LE MODÈLE, ce que la
 * règle 3 interdit — un chiffre entendu de travers sur un règlement se
 * retrouve en comptabilité.
 *
 * Le montant proposé est donc le SOLDE, calculé par le serveur depuis le
 * journal des paiements. Un règlement partiel reste possible, et par le bon
 * chemin : l'écran de validation affiche ce solde et laisse le CORRIGER
 * (`CHAMPS_CORRIGEABLES`). Le chiffre vient alors des doigts de
 * l'utilisateur, jamais de l'oreille de la machine.
 */
export const MOYENS_REGLEMENT_DICTABLES = ["VIREMENT", "CHEQUE", "ESPECES", "CB"] as const;

export const IntentionEnregistrerReglement = z
  .object({
    type: z.literal("enregistrer_reglement"),
    factureMentionnee: Mention,
    moyen: z.enum(MOYENS_REGLEMENT_DICTABLES).nullable().optional(),
  })
  .strict();


/**
 * Lancer une campagne de relance (ticket 4.21, lot 3).
 *
 * « Relance mes impayés. » L'intention est VOLONTAIREMENT nue : aucun seuil,
 * aucune liste de clients, aucun montant.
 *
 * ── Pourquoi si peu de champs ─────────────────────────────────────────────
 * Le serveur sait déjà quelles factures sont en retard — il en existe UNE
 * définition, partagée, dont un commentaire raconte le bug qu'avait causé sa
 * duplication. Laisser le modèle proposer un seuil (« celles de plus de
 * trente jours ») produirait une seconde définition du retard, entendue au
 * téléphone.
 *
 * Et le tri fin n'a pas à se faire à la voix : la campagne arrive dans la
 * file « à valider », où l'écran existant permet déjà d'EXCLURE un appel, de
 * resserrer le mandat et de voir chaque montant. La voix déclenche, l'écran
 * arbitre — c'est la règle 4 du dépôt, pas une limitation.
 */
export const IntentionLancerRelance = z
  .object({
    type: z.literal("lancer_relance"),
  })
  .strict();


/**
 * Facturer un devis accepté (ticket 4.21, lot 3).
 *
 * « Facture le devis Delacroix. » Aucun montant ici, et pour la même raison
 * qu'ailleurs : le total vient du devis signé, calculé par le serveur. Un
 * chiffre entendu au téléphone n'a rien à faire sur un document opposable.
 *
 * Le résultat est un BROUILLON. Facturer d'un mot et émettre d'un autre n'est
 * pas une lourdeur : émettre attribue un numéro de séquence et archive un
 * PDF, sans retour possible. On ne dicte pas un acte irréversible.
 */
export const IntentionFacturerDevis = z
  .object({
    type: z.literal("facturer_devis"),
    devisMentionne: Mention,
  })
  .strict();


// ── Lot 4 : la configuration ────────────────────────────────────────────────
//
// Catalogue, charges récurrentes, contrats. Les trois portent un MONTANT
// obligatoire, et aucun des trois ne peut le recevoir de la voix.
//
// ── Pourquoi, et pourquoi ce n'est pas une limitation ─────────────────────
// Aux lots précédents, un montant dicté avait déjà été refusé par la garde
// « aucun schéma d'intention ne déclare de champ monétaire », et la parade
// était de faire CALCULER le chiffre par le serveur (le solde d'une facture,
// le total d'un devis signé) pour le donner à corriger.
//
// Ici cette parade ne s'applique pas : le prix d'un article de catalogue, le
// montant d'un loyer ou d'un contrat sont des DÉCISIONS de l'artisan. Le
// serveur n'a rien à proposer, et le modèle n'a pas le droit d'inventer.
//
// Le champ reste donc VIDE, et l'écran de validation le réclame avant
// d'écrire quoi que ce soit. Ce n'est pas un demi-chemin : sur le catalogue
// c'est même le seul chemin acceptable, parce qu'un prix entendu de travers
// n'abîme pas une ligne — il contamine tous les devis à venir, sans que rien
// ne le signale. Le rayon de dégât est ce qui décide, pas la commodité.

/**
 * Ajouter un article au catalogue tarifaire.
 *
 * « Ajoute au catalogue la pose de placo, au mètre carré. » Le prix se tape à
 * l'écran de validation — voir `CHAMPS_A_COMPLETER`.
 */
export const IntentionCreerArticleCatalogue = z
  .object({
    type: z.literal("creer_article_catalogue"),
    designation: z.string().min(1).max(300),
    /** « au mètre carré », « à l'heure », « au forfait ». Libre, court. */
    unite: z.string().max(20).nullable().optional(),
  })
  .strict();

export const CADENCES_DICTABLES = ["mensuel", "trimestriel", "semestriel", "annuel"] as const;
export const CATEGORIES_CHARGE_DICTABLES = [
  "LOYER",
  "MASSE_SALARIALE",
  "ABONNEMENT",
  "ASSURANCE",
  "AUTRE",
] as const;

/**
 * Déclarer une charge récurrente. « Note une charge mensuelle, assurance
 * décennale. »
 *
 * `categorie` est dictable et ce n'est pas une entorse : ranger « assurance
 * décennale » dans ASSURANCE est une CLASSIFICATION dans une liste fermée,
 * pas un calcul ni un prix. Une erreur de rangement se voit et se corrige ;
 * un montant faux, non.
 */
export const IntentionCreerChargeRecurrente = z
  .object({
    type: z.literal("creer_charge_recurrente"),
    libelle: z.string().min(1).max(300),
    cadence: z.enum(CADENCES_DICTABLES),
    categorie: z.enum(CATEGORIES_CHARGE_DICTABLES).nullable().optional(),
  })
  .strict();

/**
 * Créer un contrat récurrent. « Contrat d'entretien annuel chez Delacroix. »
 *
 * Le client est une MENTION, rapprochée par le serveur comme partout ailleurs
 * — jamais un identifiant venu du modèle.
 */
export const IntentionCreerContrat = z
  .object({
    type: z.literal("creer_contrat"),
    libelle: z.string().min(1).max(300),
    cadence: z.enum(CADENCES_DICTABLES),
    clientMentionne: Mention.nullable().optional(),
  })
  .strict();

export const Intention = z.discriminatedUnion("type", [
  IntentionCreerAffaire,
  IntentionCreerProspect,
  IntentionMajStatutAffaire,
  IntentionCreerEcheance,
  IntentionCreerEntreeClasseur,
  IntentionConsignerActivite,
  IntentionDeclarerAbsence,
  IntentionAffecterMembre,
  IntentionPointerHeures,
  IntentionCreerClient,
  IntentionEnregistrerReglement,
  IntentionLancerRelance,
  IntentionFacturerDevis,
  IntentionCreerArticleCatalogue,
  IntentionCreerChargeRecurrente,
  IntentionCreerContrat,
]);
export type Intention = z.infer<typeof Intention>;

/** Ce que le modèle rend, et rien d'autre. */
export const SortieModele = z
  .object({
    intentions: z.array(Intention).max(20),
    /**
     * Les morceaux de la phrase qui n'ont produit aucune intention.
     *
     * Obligatoire, et c'est délibéré : un plan qui fait silence sur ce qu'il a
     * raté est un plan qui ment. L'écran doit pouvoir dire « je n'ai pas
     * compris *…* ».
     */
    nonCompris: z.array(z.string().max(300)).max(20).default([]),
  })
  .strict();
export type SortieModele = z.infer<typeof SortieModele>;

export const TYPES_INTENTION = [
  "creer_affaire",
  "creer_prospect",
  "maj_statut_affaire",
  "creer_echeance",
  "creer_entree_classeur",
  "consigner_activite",
  "declarer_absence",
  "affecter_membre",
  "pointer_heures",
  "creer_client",
  "enregistrer_reglement",
  "lancer_relance",
  "facturer_devis",
  "creer_article_catalogue",
  "creer_charge_recurrente",
  "creer_contrat",
] as const;
export type TypeIntention = (typeof TYPES_INTENTION)[number];

// ── Rapprochement d'un nom mentionné ─────────────────────────────────────────

export interface Candidat {
  readonly id: string;
  readonly libelle: string;
}

export type Resolution =
  | { readonly etat: "resolu"; readonly candidat: Candidat; readonly certitude: "exacte" | "partielle" }
  | { readonly etat: "ambigu"; readonly candidats: readonly Candidat[] }
  | { readonly etat: "introuvable" };

/**
 * Rapproche une mention d'une liste de candidats.
 *
 * La normalisation est celle de `rapprochementCatalogue.ts`, réutilisée telle
 * quelle : deux normalisations dans le même produit finissent par diverger.
 *
 * UNE AMBIGUÏTÉ NE SE TRANCHE PAS. Deux Dupont donnent `ambigu`, jamais le
 * premier de la liste : sur un produit vocal, choisir au hasard écrit une
 * erreur avant que l'artisan l'ait vue.
 */
export function resoudreMention(
  mention: string,
  candidats: readonly Candidat[],
): Resolution {
  const cible = normaliser(mention);
  if (cible.length === 0) return { etat: "introuvable" };

  const exacts = candidats.filter((c) => normaliser(c.libelle) === cible);
  if (exacts.length === 1) return { etat: "resolu", candidat: exacts[0]!, certitude: "exacte" };
  if (exacts.length > 1) return { etat: "ambigu", candidats: exacts };

  const partiels = candidats.filter((c) => {
    const n = normaliser(c.libelle);
    return n.includes(cible) || cible.includes(n);
  });
  if (partiels.length === 1) return { etat: "resolu", candidat: partiels[0]!, certitude: "partielle" };
  if (partiels.length > 1) return { etat: "ambigu", candidats: partiels };

  return { etat: "introuvable" };
}

// ── Dates dictées en français ────────────────────────────────────────────────

const MOIS: Record<string, number> = {
  janvier: 0, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5,
  juillet: 6, aout: 7, septembre: 8, octobre: 9, novembre: 10, decembre: 11,
};

const JOURS: Record<string, number> = {
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
};

/**
 * Interprète une date dictée. Rend `null` quand elle n'est pas comprise.
 *
 * `null` ET NON LA DATE DU JOUR. Une date non comprise qui rendrait
 * « aujourd'hui » poserait une échéance à une date que personne n'a dite, et
 * qui aurait l'air d'avoir été voulue. L'écran doit pouvoir demander.
 *
 * Tout est construit en COMPOSANTES LOCALES et rendu par `toDateString` :
 * jamais `toISOString`, qui rangerait « le 1er janvier » sur l'année
 * précédente pour un serveur à l'est de Greenwich.
 */
export function interpreterDate(
  mention: string,
  aujourdhui: Date = new Date(),
): string | null {
  const t = normaliser(mention);
  if (t.length === 0) return null;

  const jourJ = new Date(
    aujourdhui.getFullYear(),
    aujourdhui.getMonth(),
    aujourdhui.getDate(),
  );

  if (/\baujourd hui\b|\baujourdhui\b/.test(t)) return toDateString(jourJ);
  if (/\bdemain\b/.test(t)) {
    const d = new Date(jourJ);
    d.setDate(d.getDate() + (/\bapres demain\b/.test(t) ? 2 : 1));
    return toDateString(d);
  }
  if (/\bhier\b/.test(t)) {
    const d = new Date(jourJ);
    d.setDate(d.getDate() - 1);
    return toDateString(d);
  }

  // « le 27 août », « 27 aout 2027 », « 1er septembre »
  const jourMois = /\b(\d{1,2})(?:er)?\s+([a-z]+)(?:\s+(\d{4}))?\b/.exec(t);
  if (jourMois) {
    const jour = Number(jourMois[1]);
    const mois = MOIS[jourMois[2]!];
    if (mois !== undefined && jour >= 1 && jour <= 31) {
      const annee = jourMois[3] ? Number(jourMois[3]) : aujourdhui.getFullYear();
      const d = new Date(annee, mois, jour);
      // Un 31 février déborde sur mars : on refuse plutôt que de décaler.
      if (d.getMonth() !== mois || d.getDate() !== jour) return null;
      return toDateString(d);
    }
  }

  // « fin septembre », « début octobre », « mi-novembre »
  const relatifMois = /\b(fin|debut|mi)\s*-?\s*([a-z]+)\b/.exec(t);
  if (relatifMois) {
    const mois = MOIS[relatifMois[2]!];
    if (mois !== undefined) {
      const annee = aujourdhui.getFullYear();
      const dernier = new Date(annee, mois + 1, 0).getDate();
      const jour = relatifMois[1] === "fin" ? dernier : relatifMois[1] === "mi" ? 15 : 1;
      return toDateString(new Date(annee, mois, jour));
    }
  }

  // « lundi prochain », « mardi »
  const jourSemaine = /\b(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/.exec(t);
  if (jourSemaine) {
    const vise = JOURS[jourSemaine[1]!]!;
    const d = new Date(jourJ);
    // « prochain » saute la semaine en cours quand le jour est déjà passé ou
    // que c'est aujourd'hui : « lundi prochain » dit un lundi à venir, pas
    // celui d'il y a trois jours.
    let ecart = (vise - d.getDay() + 7) % 7;
    if (ecart === 0) ecart = 7;
    d.setDate(d.getDate() + ecart);
    return toDateString(d);
  }

  return null;
}

// ── Ce qu'un humain peut CORRIGER avant de valider ──────────────────────────

/**
 * Champs corrigeables à l'écran de validation, par type d'intention.
 *
 * ── Pourquoi cette liste existe ───────────────────────────────────────────
 * Un nom propre entendu par une machine devient facilement autre chose :
 * « Menuiserie Delacroix » ressort en « Menuiserie de la Croix », et on ne
 * s'en aperçoit qu'une fois la fiche créée. L'écran montrait ce qui allait
 * être écrit sans permettre de le rectifier : il fallait tout annuler et
 * redicter, ce que personne ne fait deux fois.
 *
 * ── Pourquoi une LISTE BLANCHE, et pas « tout est corrigeable » ───────────
 * Les corrections voyagent depuis le navigateur, et le plan attend en base
 * jusqu'à une heure. Laisser corriger n'importe quel champ reviendrait à
 * laisser réécrire le plan : un `affaireId` remplacé à la main ne serait plus
 * une correction de transcription, mais le choix d'une AUTRE cible que celle
 * que le serveur a résolue et montrée à l'écran.
 *
 * Ne figurent donc ici que les champs issus de la DICTÉE — du texte et des
 * nombres prononcés. Jamais un identifiant, jamais un résultat de
 * rapprochement.
 *
 * Corriger `heures` est légitime et même souhaitable : la règle 3 interdit au
 * MODÈLE de fixer un nombre, pas à l'utilisateur de rectifier le sien.
 */
export const CHAMPS_CORRIGEABLES: Record<TypeIntention, readonly string[]> = {
  creer_affaire: ["label", "ville"],
  creer_prospect: ["nom", "telephone", "ville"],
  creer_client: ["nom", "telephone", "email", "ville"],
  maj_statut_affaire: [],
  creer_echeance: ["libelle"],
  creer_entree_classeur: ["titre"],
  consigner_activite: ["libelle"],
  declarer_absence: [],
  affecter_membre: [],
  pointer_heures: ["heures"],
  // Le montant se corrige — c'est un chiffre prononcé, et l'entendre de
  // travers sur un règlement coûte cher. La FACTURE visée, elle, est un
  // rapprochement : la changer désignerait un autre dossier.
  enregistrer_reglement: ["montantCents"],
  // Rien à corriger : la campagne ne porte aucun texte dicté. Le tri se fait
  // dans la file de validation, où l'on exclut un appel d'un clic.
  lancer_relance: [],
  // Rien à corriger : le devis est un rapprochement, et les montants viennent
  // du document signé. Corriger l'un ou l'autre reviendrait à facturer autre
  // chose que ce qui a été accepté.
  facturer_devis: [],
  // Le PRIX se tape, il ne se dicte pas — voir `CHAMPS_A_COMPLETER`. La
  // désignation et l'unité, elles, sortent de la bouche de l'artisan.
  creer_article_catalogue: ["libelle", "unite", "prixUnitaireHtCents"],
  creer_charge_recurrente: ["libelle", "montantCents"],
  // `clientName` est du texte libre en base, pas une clé étrangère : il
  // reste donc de la dictée, et se corrige. Contraste avec `affaireId` ou
  // `devisId`, qui sont des rapprochements et n'ont rien à faire ici.
  creer_contrat: ["libelle", "clientName", "montantCents"],
};

/**
 * Champs que la voix laisse VOLONTAIREMENT vides, et que l'écran de
 * validation doit réclamer avant d'écrire.
 *
 * ── En quoi c'est différent d'un champ corrigeable ────────────────────────
 * Un champ corrigeable a une valeur, proposée par le serveur, qu'on rectifie
 * si l'oreille a fauté. Un champ à compléter n'en a AUCUNE, et ne peut pas en
 * avoir : ni le modèle (règle 3), ni le serveur (il n'a rien à calculer — le
 * prix d'un article neuf est une décision commerciale). Il est vide parce
 * qu'il doit l'être.
 *
 * Deux conséquences, et les deux sont tenues par des tests :
 *
 * 1. Tout champ listé ici est aussi listé dans `CHAMPS_CORRIGEABLES` — sans
 *    quoi il serait réclamé à l'écran et refusé au retour, une impasse.
 * 2. L'exécution REFUSE tant qu'il est vide. Le blocage du bouton à l'écran
 *    n'est qu'un confort ; les corrections voyagent depuis le navigateur et
 *    le plan attend en base jusqu'à une heure, donc c'est le serveur qui
 *    tranche.
 */
export const CHAMPS_A_COMPLETER: Record<TypeIntention, readonly string[]> = {
  creer_affaire: [],
  creer_prospect: [],
  creer_client: [],
  maj_statut_affaire: [],
  creer_echeance: [],
  creer_entree_classeur: [],
  consigner_activite: [],
  declarer_absence: [],
  affecter_membre: [],
  pointer_heures: [],
  enregistrer_reglement: [],
  lancer_relance: [],
  facturer_devis: [],
  creer_article_catalogue: ["prixUnitaireHtCents"],
  creer_charge_recurrente: ["montantCents"],
  creer_contrat: ["montantCents"],
};

/** Les champs encore vides d'une opération, parmi ceux qu'elle réclame. */
export function champsManquants(
  type: string,
  champs: Readonly<Record<string, string | null>>,
): readonly string[] {
  const requis = CHAMPS_A_COMPLETER[type as TypeIntention] ?? [];
  return requis.filter((c) => {
    const v = champs[c];
    return v === null || v === undefined || v.trim() === "";
  });
}

/** Le champ est-il corrigeable pour ce type d'opération ? */
export function champCorrigeable(type: string, champ: string): boolean {
  const liste = CHAMPS_CORRIGEABLES[type as TypeIntention];
  return liste !== undefined && liste.includes(champ);
}
