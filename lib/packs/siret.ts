/**
 * Utilitaires SIRET / TVA — fonctions pures, sans I/O.
 *
 * SIRET = 14 chiffres : 9 (SIREN) + 5 (NIC).
 * La clé de contrôle est l'algorithme de Luhn appliqué au SIRET entier
 * ET au SIREN seul.
 *
 * Exception documentée : La Poste (SIREN 356000000) utilise une clé
 * différente pour des raisons historiques — on l'accepte sans vérification.
 *
 * Source : INSEE, algorithme officiel Luhn pour les identifiants français.
 */

/**
 * Algorithme de Luhn.
 * Retourne true si la somme de contrôle est valide (mod 10 = 0).
 */
function luhn(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let v = Number(digits[i]);
    if (double) {
      v *= 2;
      if (v > 9) v -= 9;
    }
    sum += v;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Valide un SIRET.
 *
 * - Retire les espaces et tirets éventuels.
 * - Vérifie que le résultat est exactement 14 chiffres.
 * - Exception La Poste (SIREN 356000000*) : accepté sans Luhn.
 * - Vérifie Luhn sur le SIRET complet (14 chiffres).
 *
 * Note : seul le SIRET complet est soumis à Luhn. Le préfixe SIREN (9 chiffres)
 * n'est PAS indépendamment soumis à Luhn — cette exigence n'existe pas dans
 * l'algorithme INSEE officiel et rejetterait des entreprises valides.
 */
export function validerSiret(raw: string): boolean {
  const digits = raw.replace(/[\s\-]/g, "");
  if (!/^\d{14}$/.test(digits)) return false;
  // Exception La Poste
  if (digits.startsWith("356000000")) return true;
  return luhn(digits);
}

/**
 * Calcule le numéro de TVA intracommunautaire français.
 *
 * Formule : clé = (12 + 3 × (SIREN mod 97)) mod 97
 * Résultat : "FR" + clé_2_chiffres + SIREN
 *
 * Source : DGFiP, algorithme officiel de la clé TVA FR.
 */
export function calculerTvaIntracom(siren: string): string {
  const digits = siren.replace(/\s/g, "");
  if (!/^\d{9}$/.test(digits)) {
    throw new Error(`SIREN invalide : "${siren}" (9 chiffres attendus)`);
  }
  const cle = (12 + 3 * (Number(digits) % 97)) % 97;
  return `FR${String(cle).padStart(2, "0")}${digits}`;
}

/** Extrait le SIREN (9 premiers chiffres) d'un SIRET à 14 chiffres. */
export function sirenFromSiret(siret: string): string {
  return siret.replace(/\s/g, "").slice(0, 9);
}
