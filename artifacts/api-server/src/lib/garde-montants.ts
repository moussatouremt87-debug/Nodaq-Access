/**
 * Garde des montants — US-A6.3.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  Règle 3 du CLAUDE.md : « un chiffre affiché à l'utilisateur vient       ║
 * ║  toujours d'un calcul déterministe, jamais du modèle. »                  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * Cette règle était STRUCTURELLE sur la dictée de devis — les prix viennent du
 * catalogue, le modèle ne rend que des libellés — et purement RÉDACTIONNELLE
 * sur le chat : le prompt le demandait, rien ne le vérifiait, et la réponse
 * partait telle quelle à l'utilisateur. Un « ça doit tourner autour de
 * 3 000 € » n'était arrêté par rien.
 *
 * ── Comparer des MONTANTS, pas des chaînes ───────────────────────────────
 * Le modèle reformate légitimement : un outil rend `quotedAmountCents: 150000`,
 * il écrit « 1 500 € ». Comparer les textes ferait crier la garde sur chaque
 * réponse correcte. On extrait donc les montants énoncés, on les normalise en
 * centimes, et on vérifie qu'ils viennent d'une source.
 *
 * ── Un total calculé par le modèle EST un montant inventé ────────────────
 * Si le modèle additionne trois factures lui-même, la somme n'est dans aucune
 * source et sera bloquée. Ce n'est pas un faux positif : c'est précisément ce
 * que la règle 3 interdit. Un total doit venir d'un outil.
 */

/**
 * Ce que l'utilisateur lit quand un montant sans source a été intercepté.
 *
 * Remplace la réponse ENTIÈRE, et non le seul chiffre : retirer le montant en
 * silence livrerait une phrase mutilée dont l'utilisateur ignorerait qu'elle a
 * été modifiée — il lirait une réponse qui semble complète et qui ne l'est pas.
 *
 * Formulé pour être compris sans jargon (AC3) : ce qui s'est passé, pourquoi,
 * et quoi faire ensuite.
 */
export const MESSAGE_REFUS_CHIFFRAGE = [
  "Je ne peux pas donner ce chiffre : il ne provient d'aucune de vos données.",
  "",
  "Je ne calcule jamais un montant moi-même et je n'estime jamais un prix — je",
  "ne peux que reprendre ce qui a été enregistré dans votre catalogue, vos",
  "documents ou vos indicateurs. Sinon, je vous donnerais un chiffre inventé.",
  "",
  "Pour obtenir ce montant : renseignez la ligne correspondante dans votre",
  "catalogue, ou demandez-moi un indicateur précis sur une période donnée.",
].join("\n");

/**
 * Tous les nombres présents dans les sources, ramenés à un ensemble de valeurs
 * acceptables EN CENTIMES.
 *
 * Chaque nombre lu est versé sous ses deux lectures possibles : tel quel (il
 * venait d'un champ `…Cents`) et multiplié par cent (il venait d'un texte déjà
 * formaté en euros, comme l'état de l'entreprise du prompt système). On ne
 * peut pas savoir laquelle est la bonne sans connaître la provenance de chaque
 * nombre ; accepter les deux élargit la garde du bon côté — elle laisse passer
 * un montant réel plutôt que de bloquer une réponse honnête.
 */
export function montantsSources(textes: readonly string[]): Set<number> {
  const acceptables = new Set<number>();
  for (const texte of textes) {
    if (!texte) continue;
    // Nombres avec séparateurs français (espace fine, espace insécable,
    // apostrophe) ou anglais (virgule de milliers), décimales en `,` ou `.`.
    for (const brut of texte.matchAll(/\d[\d\s  ',.]*/g)) {
      const n = normaliserNombre(brut[0]);
      if (n === null) continue;
      acceptables.add(Math.round(n));
      acceptables.add(Math.round(n * 100));
    }
  }
  return acceptables;
}

/**
 * Les montants ÉNONCÉS dans un texte, en centimes.
 *
 * Seuls les nombres explicitement monétaires comptent : suivis de `€`, `EUR`
 * ou « euros ». Un nombre nu (« 7 affaires », « 2026 ») n'est pas un montant —
 * le confondre ferait bloquer des réponses qui ne chiffrent rien.
 */
export function montantsEnonces(texte: string): number[] {
  const montants: number[] = [];
  const motif = /(\d[\d\s  ',.]*)\s*(?:€|EUR\b|euros?\b)/gi;
  for (const m of texte.matchAll(motif)) {
    const n = normaliserNombre(m[1]!);
    if (n !== null) montants.push(Math.round(n * 100));
  }
  return montants;
}

/**
 * Les montants de `reponse` qu'aucune source ne justifie. Vide = la réponse
 * peut partir telle quelle.
 */
export function montantsNonSources(
  reponse: string,
  sources: readonly string[],
): number[] {
  const enonces = montantsEnonces(reponse);
  if (enonces.length === 0) return [];
  const acceptables = montantsSources(sources);
  return enonces.filter((cents) => !acceptables.has(cents));
}

/**
 * Normalise un nombre écrit à la française ou à l'anglaise vers un `number`.
 *
 * Le point dur : `1.500` vaut mille cinq cents en français et un et demi en
 * anglais. On tranche sur la forme — un séparateur suivi d'exactement trois
 * chiffres, sans autre séparateur décimal, est un séparateur de MILLIERS.
 * Le doute résiduel est sans conséquence ici : les deux lectures sont versées
 * dans l'ensemble des valeurs acceptables, jamais dans la décision de blocage.
 */
function normaliserNombre(brut: string): number | null {
  const nettoye = brut.replace(/[\s  ']/g, "").replace(/[.,]$/, "");
  if (!/\d/.test(nettoye)) return null;

  const virgule = nettoye.lastIndexOf(",");
  const point = nettoye.lastIndexOf(".");
  const dernier = Math.max(virgule, point);

  if (dernier === -1) {
    const n = Number(nettoye);
    return Number.isFinite(n) ? n : null;
  }

  const apres = nettoye.length - dernier - 1;
  const separateurDeMilliers = apres === 3;
  const sansSeparateurs = separateurDeMilliers
    ? nettoye.replace(/[.,]/g, "")
    : nettoye.slice(0, dernier).replace(/[.,]/g, "") + "." + nettoye.slice(dernier + 1);

  const n = Number(sansSeparateurs);
  return Number.isFinite(n) ? n : null;
}
