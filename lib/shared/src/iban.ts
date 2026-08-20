/**
 * Validation d'IBAN — ticket 4.19.
 *
 * Un IBAN saisi ici est le compte qui RECEVRA l'argent des liens de paiement.
 * Une faute de frappe n'affiche pas un message d'erreur plus tard : elle
 * envoie un virement au mauvais bénéficiaire, ou fait échouer tous les liens
 * d'un tenant sans que personne comprenne pourquoi. C'est pourquoi la clé de
 * contrôle est vérifiée AVANT l'enregistrement, dans la route — pas dans
 * l'écran, qu'une reprise de données ou le support contournent.
 *
 * La vérification est celle de la norme ISO 13616 : les quatre premiers
 * caractères passent à la fin, chaque lettre devient sa position dans
 * l'alphabet + 9, et le nombre obtenu doit être congru à 1 modulo 97.
 */

/** Longueur attendue par pays, pour les pays de la zone SEPA courante. */
const LONGUEURS: Readonly<Record<string, number>> = {
  FR: 27, MC: 27, BE: 16, DE: 22, ES: 24, IT: 27, PT: 25, NL: 18,
  LU: 20, IE: 22, AT: 20, FI: 18, GR: 27, CH: 21, GB: 22, PL: 28,
};

/** Retire espaces et tirets, et met en majuscules — la forme de comparaison. */
export function normaliserIban(saisie: string): string {
  return saisie.replace(/[\s-]/g, "").toUpperCase();
}

/** Formatage lisible par groupes de 4, tel qu'on l'écrit sur un document. */
export function formaterIban(iban: string): string {
  return normaliserIban(iban).replace(/(.{4})/g, "$1 ").trim();
}

export type RefusIban =
  | "vide"
  | "caracteres_invalides"
  | "pays_inconnu"
  | "longueur"
  | "cle_de_controle";

/**
 * L'IBAN est-il valide ? Rend `null` si oui, le motif de refus sinon.
 *
 * Le motif est destiné à l'appelant, pas à l'utilisateur : c'est la route qui
 * choisit le message français à afficher.
 */
export function verifierIban(saisie: string): RefusIban | null {
  const iban = normaliserIban(saisie);
  if (iban.length === 0) return "vide";
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) return "caracteres_invalides";

  const pays = iban.slice(0, 2);
  const longueurAttendue = LONGUEURS[pays];
  if (longueurAttendue === undefined) return "pays_inconnu";
  if (iban.length !== longueurAttendue) return "longueur";

  // ISO 13616 : les 4 premiers caractères passent à la fin.
  const reordonne = iban.slice(4) + iban.slice(0, 4);
  // Chaque lettre vaut sa position dans l'alphabet + 9 (A=10 … Z=35). Le
  // nombre résultant dépasse tout entier natif : le modulo se calcule par
  // tranches, comme le fait la norme elle-même.
  let reste = 0;
  for (const caractere of reordonne) {
    const valeur = /[0-9]/.test(caractere)
      ? caractere
      : String(caractere.charCodeAt(0) - 55);
    for (const chiffre of valeur) {
      reste = (reste * 10 + Number(chiffre)) % 97;
    }
  }

  return reste === 1 ? null : "cle_de_controle";
}

/** Message français destiné à l'utilisateur, pour chaque motif de refus. */
export function messageRefusIban(refus: RefusIban): string {
  switch (refus) {
    case "vide":
      return "L'IBAN est vide.";
    case "caracteres_invalides":
      return "Cet IBAN contient des caractères inattendus. Il commence par deux lettres de pays, puis deux chiffres.";
    case "pays_inconnu":
      return "Le pays de cet IBAN n'est pas reconnu.";
    case "longueur":
      return "Cet IBAN n'a pas la bonne longueur pour son pays. Un IBAN français fait 27 caractères.";
    case "cle_de_controle":
      return "Cet IBAN est invalide : sa clé de contrôle ne tombe pas juste. Vérifiez la saisie, un chiffre a sans doute été inversé.";
  }
}
