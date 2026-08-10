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

export const Intention = z.discriminatedUnion("type", [
  IntentionCreerAffaire,
  IntentionCreerProspect,
  IntentionMajStatutAffaire,
  IntentionCreerEcheance,
  IntentionCreerEntreeClasseur,
  IntentionConsignerActivite,
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
