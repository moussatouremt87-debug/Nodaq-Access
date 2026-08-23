/*
 * Le QR de virement SEPA imprimé sur la facture — reste du ticket 4.21.
 *
 * ── Ce qu'il est, et ce qu'il n'est pas ───────────────────────────────────
 * Le client scanne le QR avec son application bancaire : bénéficiaire, IBAN,
 * montant et référence arrivent PRÉ-REMPLIS. Il lui reste à valider. Ce qui
 * disparaît, c'est la recopie d'un IBAN à la main — la faute de frappe la plus
 * coûteuse du métier, celle qui envoie l'argent nulle part et qu'on met trois
 * semaines à voir.
 *
 * Ce n'est PAS le rail de paiement immédiat du ticket 4.19. Celui-là passe par
 * Bridge, confirme en quelques secondes et alimente le journal des paiements
 * tout seul. Le QR, lui, ne confirme rien : personne n'est prévenu quand le
 * virement part. Les deux ne se remplacent pas — le QR vit sur le document, le
 * lien Bridge vit à la fin d'un appel. Et le QR a un avantage que le rail n'a
 * pas aujourd'hui : il fonctionne, sans activation chez personne.
 *
 * ── Format : EPC069-12, version 002 ───────────────────────────────────────
 * La norme du Conseil européen des paiements, celle que lisent les
 * applications bancaires de la zone SEPA. Version 002 : le BIC devient
 * FACULTATIF pour un IBAN de l'Espace économique européen — c'est ce qui nous
 * permet de ne pas réclamer un champ de plus à l'artisan.
 *
 * ── Aucune décision, aucun calcul ─────────────────────────────────────────
 * Ce module MET EN FORME. Le montant lui est donné en centimes par
 * l'appelant ; il ne l'additionne pas, ne le déduit pas, ne l'arrondit pas.
 * Un QR qui porterait un montant différent de celui imprimé au-dessus de lui
 * serait un piège, et c'est le client qui le paierait.
 */

import { verifierIban, messageRefusIban, normaliserIban } from "./iban.js";

/** Ce que le QR encode. Tout est fourni ; rien n'est deviné. */
export interface VirementSepa {
  /** Le bénéficiaire, tel qu'il doit apparaître dans l'application bancaire. */
  readonly beneficiaire: string;
  readonly iban: string;
  /** Facultatif : la version 002 s'en passe pour un IBAN de l'EEE. */
  readonly bic?: string | undefined;
  /** En centimes d'euro, comme partout ailleurs dans le produit. */
  readonly montantCents: number;
  /** Ce que le bénéficiaire lira sur son relevé — le numéro de facture. */
  readonly reference: string;
}

/** Longueurs maximales de la norme. Dépassées, le QR devient illisible. */
const MAX_BENEFICIAIRE = 70;
const MAX_REFERENCE = 140;
const MAX_OCTETS = 331;

/** Bornes de la norme, en centimes : 0,01 € à 999 999 999,99 €. */
const MONTANT_MIN_CENTS = 1;
const MONTANT_MAX_CENTS = 99_999_999_999;

/**
 * Pourquoi un virement ne peut pas être encodé. `null` quand il le peut.
 *
 * Un motif, pas un booléen : ce texte est destiné à l'artisan, qui doit savoir
 * quoi corriger. « Pas de QR sur vos factures » sans raison est un défaut qu'on
 * ne signale jamais.
 */
export function motifRefusQr(v: VirementSepa): string | null {
  // La validation d'IBAN est celle du ticket 4.19 (`iban.ts`), pas une
  // seconde : deux vérifications finiraient par diverger, et c'est l'IBAN
  // imprimé sur toutes les factures d'un tenant qui en paierait le prix.
  const refusIban = verifierIban(v.iban);
  if (refusIban !== null) {
    return `${messageRefusIban(refusIban)} Le QR de paiement n'a donc pas été imprimé.`;
  }
  if (!v.beneficiaire.trim()) {
    return "Le nom de votre entreprise n'est pas renseigné : le QR de paiement ne peut pas être imprimé.";
  }
  if (!Number.isInteger(v.montantCents)) {
    return "Le montant à payer n'est pas exploitable : le QR de paiement n'a pas été imprimé.";
  }
  if (v.montantCents < MONTANT_MIN_CENTS) {
    // Un avoir, une facture à zéro : il n'y a rien à virer, et c'est normal.
    return "Aucun montant à payer : pas de QR de paiement.";
  }
  if (v.montantCents > MONTANT_MAX_CENTS) {
    return "Le montant dépasse ce qu'un virement SEPA peut porter : le QR de paiement n'a pas été imprimé.";
  }
  return null;
}

/**
 * Longueur en octets une fois encodé en UTF-8.
 *
 * Écrit à la main plutôt que `TextEncoder` ou `Buffer.byteLength` : ce module
 * tourne des deux côtés — le PDF est fabriqué par le serveur, mais l'écran
 * affiche le motif de refus. `Buffer` n'existe pas dans un navigateur, et
 * `TextEncoder` n'est pas dans les libs TypeScript de ce paquet.
 */
function octetsUtf8(texte: string): number {
  let total = 0;
  for (const caractere of texte) {
    const point = caractere.codePointAt(0)!;
    total += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
  }
  return total;
}

/**
 * Le montant au format de la norme : `EUR` suivi d'unités.centimes.
 *
 * ── Pourquoi en arithmétique entière ──────────────────────────────────────
 * `(centimes / 100).toFixed(2)` donne le même résultat sur toute la plage
 * SEPA — vérifié en injectant la variante flottante : aucun test ne bouge. Ce
 * n'est donc PAS un correctif de bug, et le commentaire ne prétendra pas le
 * contraire.
 *
 * C'est un choix de robustesse : le format du montant est la seule chose de ce
 * module qu'on ne peut pas relire sur le document imprimé. Une expression dont
 * la justesse tient à la plage des valeurs demande, à chaque relecture, de
 * refaire le raisonnement sur les doubles. Deux entiers et un `padStart` n'en
 * demandent aucun.
 */
function montantEpc(centimes: number): string {
  const unites = Math.trunc(centimes / 100);
  const cents = centimes % 100;
  return `EUR${unites}.${String(cents).padStart(2, "0")}`;
}

/**
 * La charge utile EPC069-12, ou `null` si le virement n'est pas encodable.
 *
 * Douze lignes séparées par des sauts de ligne, dans un ordre que la norme fixe
 * et dont aucune ne peut être omise au milieu — une ligne vide reste une ligne.
 *
 * ── Le repli est le silence, jamais un QR approximatif ────────────────────
 * `null` plutôt qu'un QR « au mieux ». Un QR mal formé n'échoue pas
 * bruyamment : il s'ouvre dans l'application bancaire du client avec un champ
 * de travers, et c'est lui qui le découvre.
 */
export function chargeUtileEpc(v: VirementSepa): string | null {
  if (motifRefusQr(v) !== null) return null;

  const lignes = [
    "BCD",                                          // marqueur de service
    "002",                                          // version — BIC facultatif
    "1",                                            // jeu de caractères : UTF-8
    "SCT",                                          // virement SEPA
    (v.bic ?? "").trim().toUpperCase(),
    v.beneficiaire.trim().slice(0, MAX_BENEFICIAIRE),
    normaliserIban(v.iban),
    montantEpc(v.montantCents),
    "",                                             // code motif (non utilisé)
    "",                                             // référence structurée…
    v.reference.trim().slice(0, MAX_REFERENCE),     // …ou libre : jamais les deux
    "",                                             // note au bénéficiaire
  ];

  const charge = lignes.join("\n");

  // La norme plafonne la charge utile à 331 octets. Au-delà, les lecteurs
  // divergent : certains tronquent en silence, et un montant tronqué est pire
  // qu'un QR absent.
  if (octetsUtf8(charge) > MAX_OCTETS) return null;

  return charge;
}
