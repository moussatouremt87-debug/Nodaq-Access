/**
 * Oralité des répliques de l'agent — ticket 4.18, style oral.
 *
 * Un agent qui parle comme une lettre recommandée se fait raccrocher au nez.
 * Le débiteur entend une machine, se braque, et l'appel est perdu avant la
 * première question.
 *
 * ── Pourquoi une garde et pas seulement une consigne de prompt ───────────
 * Une consigne de prompt dérive. Le modèle reformule, quelqu'un ajuste une
 * phrase « pour être plus clair », et six mois plus tard l'agent dit « nous
 * vous prions de bien vouloir procéder au règlement ». Personne ne s'en
 * aperçoit, parce qu'aucun test ne regarde le REGISTRE.
 *
 * Cette garde regarde le registre. Elle est mécanique, donc partielle — voir
 * ce qu'elle n'attrape pas, plus bas — mais elle attrape ce qui se mesure :
 * la longueur des phrases et les tournures administratives.
 *
 * ── Ce qu'elle NE fait PAS ───────────────────────────────────────────────
 * Elle ne juge pas si une phrase « sonne » naturelle. Un texte peut passer
 * toutes ces règles et rester froid. La garde est un plancher, pas un
 * certificat : l'oreille reste juge, et c'est pour ça que les répliques sont
 * aussi écoutées en conditions téléphoniques avant d'être validées.
 */

/**
 * Au-delà, on n'est plus dans du parlé.
 *
 * Quinze mots, c'est déjà long à l'oral : une phrase de vingt mots oblige
 * l'interlocuteur à retenir le début pour comprendre la fin, ce qu'on ne fait
 * pas au téléphone avec quelqu'un qui vous réclame de l'argent.
 */
export const MOTS_MAX_PAR_PHRASE = 15;

/**
 * Marqueurs d'oral. Leur PRÉSENCE est souhaitable, jamais obligatoire.
 *
 * Les exiger phrase par phrase produirait une caricature — « alors, du coup,
 * en fait, voilà » — qui sonne plus faux qu'une phrase neutre. On vérifie
 * qu'un ÉCHANGE en contient, pas chaque réplique.
 */
export const MARQUEURS_ORAUX = [
  "du coup",
  "en fait",
  "alors",
  "voilà",
  "bon",
  "hein",
  "d'accord",
  "écoutez",
  "euh",
] as const;

export interface TournureEcrite {
  readonly motif: RegExp;
  readonly libelle: string;
}

/**
 * Tournures qui trahissent l'écrit administratif.
 *
 * Choisies parce qu'elles sont mécaniquement détectables ET sans ambiguïté :
 * aucune ne s'emploie spontanément dans une conversation téléphonique.
 */
export const TOURNURES_ECRITES: readonly TournureEcrite[] = [
  { motif: /nous vous prions/i, libelle: "« nous vous prions »" },
  { motif: /veuillez\b/i, libelle: "« veuillez »" },
  { motif: /bien vouloir/i, libelle: "« bien vouloir »" },
  { motif: /dans les meilleurs d[ée]lais/i, libelle: "« dans les meilleurs délais »" },
  { motif: /par la pr[ée]sente/i, libelle: "« par la présente »" },
  { motif: /nous accusons r[ée]ception/i, libelle: "« nous accusons réception »" },
  { motif: /je me permets de vous/i, libelle: "« je me permets de »" },
  { motif: /dans l'attente de/i, libelle: "« dans l'attente de »" },
  { motif: /le cas [ée]ch[ée]ant/i, libelle: "« le cas échéant »" },
  { motif: /il conviendrait que/i, libelle: "« il conviendrait que »" },
  { motif: /aux fins de/i, libelle: "« aux fins de »" },
  { motif: /sous r[ée]serve de/i, libelle: "« sous réserve de »" },
  /*
   * Subjonctif imparfait. Personne ne dit « qu'il réglât » au téléphone.
   *
   * Motif ÉTROIT, et il a fallu le resserrer : `\w+[âê]t` attrapait « prêt »,
   * « intérêt », « arrêt », « forêt » — du français parlé parfaitement banal.
   * Une garde qui refuse ce qu'elle protège finit désactivée dans la semaine.
   *
   * `-ît` est écarté pour la même raison : « paraît », « connaît », « plaît »
   * sont de l'indicatif présent. On garde `-ât` précédé d'au moins deux
   * caractères — ce qui écarte « bât » et « mât » — et la poignée de formes
   * irrégulières qui n'ont pas d'homonyme courant.
   */
  { motif: /\b\w{2,}ât\b/i, libelle: "subjonctif imparfait" },
  { motif: /\b(f[ûu]t|e[ûu]t|p[ûu]t|d[ûu]t|voul[ûu]t|s[ûu]t)\b(?=\s+(que|qu'|le|la|les|ce))/i, libelle: "subjonctif imparfait irrégulier" },
  { motif: /\b\w+assent\b|\b\w+ussent\b/i, libelle: "subjonctif imparfait pluriel" },
];

export type NatureAnomalieOralite = "phrase_trop_longue" | "tournure_ecrite";

export interface AnomalieOralite {
  readonly nature: NatureAnomalieOralite;
  readonly detail: string;
}

/** Découpe en phrases sur la ponctuation forte. */
function phrases(texte: string): string[] {
  return texte
    .split(/[.!?…]+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function compterMots(phrase: string): number {
  return phrase.split(/\s+/).filter((m) => /[a-zà-ÿ]/i.test(m)).length;
}

/**
 * Ce qui, dans ce texte, sonne comme un courrier.
 *
 * Vide = rien de mécaniquement détectable. Ce n'est pas la même chose que
 * « ça sonne bien » — voir l'en-tête.
 */
export function verifierOralite(texte: string): AnomalieOralite[] {
  const anomalies: AnomalieOralite[] = [];

  for (const phrase of phrases(texte)) {
    const mots = compterMots(phrase);
    if (mots > MOTS_MAX_PAR_PHRASE) {
      anomalies.push({
        nature: "phrase_trop_longue",
        detail: `${mots} mots : « ${phrase.slice(0, 60)}… »`,
      });
    }
  }

  for (const { motif, libelle } of TOURNURES_ECRITES) {
    if (motif.test(texte)) {
      anomalies.push({ nature: "tournure_ecrite", detail: libelle });
    }
  }

  return anomalies;
}

/**
 * Le texte contient-il au moins un marqueur d'oral ?
 *
 * Comparaison sur les FRONTIÈRES DE MOT et non par sous-chaîne : « bon » se
 * trouvait dans « bonne journée », et « Je vous remercie, bonne journée »
 * passait donc pour une réplique orale alors qu'elle est neutre. Une détection
 * qui répond vrai à tout ne mesure rien.
 */
export function contientMarqueurOral(texte: string): boolean {
  const bas = texte.toLowerCase();
  return MARQUEURS_ORAUX.some((m) => {
    const motif = new RegExp(`(^|[^a-zà-ÿ])${m.replace(/'/g, "['’]")}([^a-zà-ÿ]|$)`, "i");
    return motif.test(bas);
  });
}
