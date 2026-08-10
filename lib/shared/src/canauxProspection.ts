/*
 * Ce qu'on a le droit d'envoyer, et à qui.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  CE N'EST PAS L'INTERFACE QUI DÉCIDE, C'EST LE SERVEUR.                  ║
 * ║  Un bouton masqué côté navigateur n'est pas une protection : la route     ║
 * ║  doit REFUSER. Cette fonction est ce que la route interroge.             ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ── Contexte réglementaire — à ne pas réinterpréter ─────────────────────────
 *
 * Vers un PARTICULIER, l'e-mail et le SMS exigent un consentement préalable ;
 * depuis le 11 août 2026, l'appel téléphonique aussi.
 *
 * L'exception « client existant » autorise l'e-mail vers quelqu'un qui a déjà
 * acheté, pour des produits ou services ANALOGUES, avec une opposition facile
 * dans chaque message.
 *
 * Vers un PROFESSIONNEL, sur son adresse professionnelle et pour un message en
 * rapport avec son métier, l'intérêt légitime et un droit d'opposition
 * suffisent.
 *
 * Le COURRIER POSTAL ne relève pas de ce régime : information et droit
 * d'opposition suffisent, y compris vers un particulier.
 *
 * Une donnée PUBLIQUEMENT ACCESSIBLE n'est pas librement réutilisable. Quand
 * elle n'a pas été recueillie auprès de la personne, celle-ci doit être
 * informée au plus tard à la première communication, et on doit lui dire D'OÙ
 * vient son nom (article 14 du RGPD).
 *
 * Les PIXELS DE SUIVI dans les e-mails sont soumis à consentement, y compris en
 * B2B. Aucun suivi d'ouverture n'est implémenté, et une garde le vérifie.
 */

/** Nature du contact. Elle commande tout le reste. */
export const TYPES_CONTACT = ["PARTICULIER", "PRO"] as const;
export type TypeContact = (typeof TYPES_CONTACT)[number];

/** Sur quoi repose le droit de détenir — et parfois de démarcher. */
export const BASES_LEGALES = [
  "CLIENT_EXISTANT",
  "INTERET_LEGITIME_PRO",
  "INTERET_LEGITIME_PARTICULIER",
  "CONSENTEMENT",
] as const;
export type BaseLegale = (typeof BASES_LEGALES)[number];

export interface CanauxAutorises {
  readonly email: boolean;
  readonly telephone: boolean;
  readonly courrier: boolean;
}

const AUCUN: CanauxAutorises = { email: false, telephone: false, courrier: false };

/**
 * Les canaux ouverts pour un contact.
 *
 * `informeLe` : date de l'information de l'article 14, ou `null`. Elle ne
 * compte que pour l'intérêt légitime visant un particulier — une donnée qu'on
 * n'a pas recueillie auprès de la personne.
 *
 * `opposition` : la personne s'est opposée. Ferme TOUT, sans exception et sans
 * examen de la base légale.
 *
 * ── LE CAS QU'IL NE FAUT PAS ASSOUPLIR ──────────────────────────────────────
 * Un particulier repéré dans un registre public, même CORRECTEMENT INFORMÉ, ne
 * peut être NI APPELÉ NI E-MAILÉ — seulement recevoir un courrier.
 * L'information au titre de l'article 14 donne le droit de DÉTENIR la donnée,
 * pas celui de démarcher. C'est la ligne que le produit ne franchira pas, et
 * c'est aussi la plus tentante à franchir.
 */
export function canauxAutorises(
  contactType: TypeContact,
  base: BaseLegale,
  informeLe: string | Date | null,
  opposition: boolean,
): CanauxAutorises {
  // L'opposition l'emporte sur tout. Aucune base légale ne la contourne.
  if (opposition) return AUCUN;

  if (contactType === "PRO") {
    // Un professionnel sollicité sur son adresse professionnelle, pour un
    // message en rapport avec son métier : intérêt légitime + opposition.
    if (base === "INTERET_LEGITIME_PRO" || base === "CONSENTEMENT" || base === "CLIENT_EXISTANT") {
      return { email: true, telephone: true, courrier: true };
    }
    // `INTERET_LEGITIME_PARTICULIER` sur un PRO est une incohérence de saisie :
    // on ne devine pas ce qui était voulu, on ferme.
    return AUCUN;
  }

  // ── PARTICULIER ───────────────────────────────────────────────────────────
  switch (base) {
    case "CONSENTEMENT":
      return { email: true, telephone: true, courrier: true };

    case "CLIENT_EXISTANT":
      // E-mail pour des services ANALOGUES, téléphone si lié au contrat, et
      // courrier. La restriction « analogue » porte sur le CONTENU du message
      // et ne se vérifie pas ici : elle est rappelée à l'écran de rédaction.
      return { email: true, telephone: true, courrier: true };

    case "INTERET_LEGITIME_PARTICULIER":
      // Informé : le COURRIER seul. Non informé : rien du tout.
      return informeLe
        ? { email: false, telephone: false, courrier: true }
        : AUCUN;

    case "INTERET_LEGITIME_PRO":
      // Base « professionnelle » posée sur un particulier : incohérence.
      return AUCUN;
  }
}

/** Les canaux qu'une route peut recevoir. */
export const CANAUX = ["email", "telephone", "courrier"] as const;
export type Canal = (typeof CANAUX)[number];

/**
 * Sous ce nombre d'occurrences, un agrégat de zone n'est pas renvoyé.
 *
 * Dans une commune de trois cents habitants, « un permis de rénovation de
 * toiture ce mois-ci » DÉSIGNE QUELQU'UN. Un agrégat n'anonymise que s'il
 * porte sur assez de monde pour qu'on ne puisse remonter à personne.
 */
export const SEUIL_ANONYMAT = 5;

/** Un agrégat est-il publiable ? */
export function agregatPubliable(occurrences: number): boolean {
  return occurrences >= SEUIL_ANONYMAT;
}

/**
 * Durée de conservation d'un contact de prospection sans interaction.
 *
 * Trois ans, comme la recommandation de la CNIL pour la prospection
 * commerciale. Au-delà, la donnée n'est plus justifiée par la finalité qui
 * l'avait permise.
 */
export const RETENTION_PROSPECTION_JOURS = 3 * 365;
