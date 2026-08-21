/*
 * Un montant PRONONCÉ par l'utilisateur, retrouvé dans sa propre phrase.
 *
 * ── Pourquoi ce module existe ─────────────────────────────────────────────
 * La règle 3 du dépôt interdit au modèle de CALCULER un chiffre ou de FIXER un
 * prix. Elle était appliquée par une garde plus large qu'elle : « aucun schéma
 * d'intention ne déclare de champ monétaire », qui interdisait aussi de
 * TRANSCRIRE un montant que l'utilisateur venait de dire à voix haute.
 *
 * Les deux ne se valent pas. « Ajoute au catalogue la pose de placo à 45 euros
 * du mètre » ne demande au modèle aucun calcul et aucune décision : le chiffre
 * sort de la bouche de l'artisan, le modèle ne fait que le recopier. Refuser
 * ça obligeait à retaper à l'écran un nombre qu'on venait de prononcer.
 *
 * ── Ce qui remplace la garde, et qui doit rester vrai ─────────────────────
 * 1. Le montant doit se RETROUVER dans la transcription. C'est ce que fait ce
 *    module. Un modèle qui hallucine « 4500 » sur une phrase qui n'a jamais
 *    porté ce nombre est arrêté ici — sans quoi la relaxe de la règle
 *    ouvrirait exactement le trou qu'elle prétend ne pas ouvrir.
 * 2. Le montant reste AFFICHÉ et corrigeable avant écriture (règle 4). Rien ne
 *    s'écrit sans qu'un humain l'ait vu.
 * 3. Un montant non retrouvé n'est pas « nettoyé » : il est ÉCARTÉ, et le
 *    champ retombe sur le mécanisme du lot 4 — vide, réclamé à l'écran. Le
 *    repli est donc l'état sûr, jamais une écriture au jugé.
 *
 * ── Ce que la règle 3 continue d'interdire, sans exception ────────────────
 * Un montant que le SERVEUR sait calculer ne se dicte pas : le solde d'une
 * facture, le total d'un devis signé. Là, le chiffre a une source faisant foi,
 * et la bouche de l'utilisateur n'en est pas une — facturer autre chose que ce
 * qui a été accepté ne se rattrape pas.
 */

/**
 * Les nombres écrits en chiffres dans un texte, séparateurs recollés.
 *
 * « 1 500 » et « 1500 » sont le même nombre : une transcription vocale place
 * volontiers une espace de milliers, y compris l'espace fine insécable.
 * « 45,50 » est un décimal français ; « 45.50 » le même en notation anglaise.
 */
function nombresDe(texte: string): number[] {
  const normalise = texte
    // Séparateur de milliers : espace ordinaire, insécable, fine insécable.
    .replace(/(\d)[\s  ](?=\d{3}(?!\d))/g, "$1")
    // Virgule décimale française → point, pour que `Number` sache lire.
    .replace(/(\d),(\d)/g, "$1.$2");
  return (normalise.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter(Number.isFinite);
}

/**
 * Tolérance de comparaison : le demi-centime.
 *
 * On compare des euros portés par des flottants ; l'égalité stricte y est un
 * piège classique (0.1 + 0.2 ≠ 0.3). Un demi-centime est plus fin que la plus
 * petite unité représentable en base, donc aucun montant distinct ne peut se
 * confondre avec un autre.
 */
const TOLERANCE_EUROS = 0.005;

/**
 * Ce montant en euros figure-t-il, en chiffres, dans la phrase prononcée ?
 *
 * LIMITE ASSUMÉE, et elle penche du bon côté : un nombre écrit en toutes
 * lettres (« quarante-cinq euros ») n'est pas reconnu. La conséquence n'est pas
 * une écriture fausse mais un repli — le champ redevient à saisir. Chercher à
 * reconnaître les numéraux français buterait sur « un »/« une », articles bien
 * plus souvent que nombres, et produirait des acceptations sur du hasard.
 */
export function montantPrononce(transcription: string, euros: number): boolean {
  if (!Number.isFinite(euros)) return false;
  return nombresDe(transcription).some((n) => Math.abs(n - euros) < TOLERANCE_EUROS);
}

/**
 * Le montant en CENTIMES, s'il est prononcé et exploitable. `null` sinon.
 *
 * La conversion vit ici et nulle part ailleurs. Le modèle ne produit que des
 * EUROS — c'est une garde structurelle, `montantEuros` étant le seul nom de
 * champ monétaire qu'un schéma d'intention ait le droit de déclarer. S'il
 * pouvait rendre des centimes, une sortie « 45 » pour « 45 euros » écrirait
 * 45 centimes : un facteur cent, silencieux, sur la seule source de prix des
 * devis.
 */
export function centimesDepuisDictee(
  transcription: string,
  euros: number | null | undefined,
): number | null {
  if (euros === null || euros === undefined) return null;
  if (!Number.isFinite(euros) || euros < 0) return null;
  if (!montantPrononce(transcription, euros)) return null;
  // `Math.round` et non `Math.trunc` : 45.7 * 100 vaut 4569.999… en flottant,
  // et tronquer écrirait 45,69 € au lieu de 45,70 €.
  return Math.round(euros * 100);
}
