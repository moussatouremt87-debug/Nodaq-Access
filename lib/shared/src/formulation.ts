/**
 * La FORMULATION des répliques de l'agent — ticket 4.18, style oral.
 *
 * Le noyau (`decisionAppel.ts`) DÉCIDE ; ce module fait dire au modèle ce que le
 * noyau a décidé. C'est la règle 3 du CLAUDE.md prise au mot : le modèle ne
 * calcule rien, ne fixe rien, mais il FORMULE.
 *
 * ── Pourquoi ce détour, plutôt que des phrases écrites en dur ──────────────
 * Des répliques écrites à l'avance ne conversent pas. Elles récitent : le même
 * mot au même endroit à chaque appel, aucune reprise de ce que la personne
 * vient de dire, aucune adaptation au ton. Un débiteur l'entend en deux tours
 * de parole. Le modèle, lui, rebondit — c'est exactement ce pour quoi il est
 * bon, et c'est tout ce qu'on lui confie.
 *
 * ── Ce que le modèle ne formule JAMAIS ─────────────────────────────────────
 * L'annonce d'ouverture. Elle reste produite par `annonceOuverture()`, mot pour
 * mot, parce que l'US-2 en fait une obligation de transparence : une annonce
 * qu'un modèle est libre de reformuler est une annonce qui peut, un jour, ne
 * plus annoncer. `INTENTIONS_REPLIQUE` ne contient donc aucune entrée pour elle, et
 * `formulation.test.ts` vérifie cette absence.
 *
 * ── Les trois gardes de sortie ─────────────────────────────────────────────
 * Ce que le modèle rend est vérifié AVANT d'être prononcé :
 *
 *   1. oralité — registre parlé, phrases courtes (`oralite.ts`) ;
 *   2. registres interdits — menace, contentieux, culpabilisation
 *      (`decisionAppel.ts`, US-4) ;
 *   3. **chiffres non fournis** — la plus importante. Tout nombre prononcé doit
 *      figurer dans les faits transmis. Un modèle qui annonce un montant ou un
 *      délai que personne ne lui a donné vient de fixer un prix, ce que la
 *      règle 3 interdit.
 *
 * Une réplique qui échoue est régénérée une fois ; si elle échoue encore, on
 * prononce `REPLIQUES_DE_SECOURS`. D'où le rôle de ces phrases écrites : un
 * filet, jamais le chemin normal.
 */

import { registresInterdits } from "./decisionAppel.js";
import { verifierOralite, type AnomalieOralite } from "./oralite.js";

// ── Les intentions conversationnelles ──────────────────────────────────────

/**
 * Les mouvements de conversation que le modèle peut formuler.
 *
 * Une intention dit ce que l'agent VEUT FAIRE ; le modèle choisit les mots. Le
 * découpage suit les issues de l'US-6 et les branches de l'US-3, pas une
 * arborescence de dialogue : c'est le modèle qui conduit l'échange, pas un
 * automate.
 */
export const INTENTIONS_REPLIQUE = [
  "demander_date",
  "offrir_echelonnement",
  "refuser_et_transmettre",
  "recapituler_promesse",
  "clore_contestation",
  "clore_paiement_annonce",
  "clore_rappel_humain",
  "clore_opposition",
] as const;

export type IntentionReplique = (typeof INTENTIONS_REPLIQUE)[number];

/** Faits transmis au modèle. Tout ce qu'il a le droit de dire, et rien d'autre. */
export type FaitsReplique = Readonly<Record<string, string>>;

/** Un tour de parole déjà échangé, pour que le modèle sache où il en est. */
export interface TourParole {
  readonly locuteur: "agent" | "debiteur";
  readonly propos: string;
}

// ── La consigne ────────────────────────────────────────────────────────────

/**
 * Nombre de phrases au-delà duquel une réplique devient un monologue.
 *
 * `oralite.ts` borne déjà chaque phrase à quinze mots ; rien n'empêche pour
 * autant d'empiler douze phrases courtes. Au téléphone, un tour de parole de
 * plus de quatre phrases n'est plus une conversation : l'autre décroche
 * mentalement, ou coupe.
 */
export const PHRASES_MAX_PAR_REPLIQUE = 4;

/**
 * Ce qu'on demande au modèle, et ce qu'on lui interdit.
 *
 * Cette consigne ne PROTÈGE rien — les gardes de sortie protègent. Elle sert à
 * obtenir le bon registre du premier coup ; une consigne dérive, une assertion
 * non. C'est la même répartition que dans `voix.ts`, où le schéma Zod refuse ce
 * que la consigne se contente de demander.
 */
export function consigneFormulation(): string {
  return [
    "Tu es un assistant qui appelle au téléphone pour une relance de facture impayée.",
    "Tu parles. Tu n'écris pas. C'est une conversation, pas un courrier.",
    "",
    "STYLE — non négociable :",
    "- Français PARLÉ et FAMILIER. Phrases courtes, quinze mots maximum.",
    `- ${PHRASES_MAX_PAR_REPLIQUE} phrases maximum par réplique. Souvent une ou deux suffisent.`,
    "- Marqueurs d'oral quand c'est naturel : « du coup », « en fait », « alors », « voilà ».",
    "- Tu RÉAGIS à ce que la personne vient de dire avant d'enchaîner.",
    // Registre familier, dit en règles applicables plutôt qu'en adjectif. « Sois
    // familier » ne produit rien de mesurable ; « supprime le ne de négation »
    // change une réplique sur deux. Ce sont les marqueurs qui SÉPARENT le
    // français parlé du français écrit lu à voix haute.
    "- Négation SANS le « ne » : « je peux pas », « on va pas », jamais « je ne peux pas ».",
    "- « on » plutôt que « nous » : « on peut faire », jamais « nous pouvons ».",
    "- Formules courtes du quotidien : « ça marche », « pas de souci », « très bien », « d'accord ».",
    "- Va droit au but : « vous pouvez régler quand ? », pas « pensez-vous pouvoir régler ».",
    // L'hésitation a été validée à l'oreille en conditions téléphoniques : la
    // même réplique hésitante sonne nettement plus humaine. Elle est demandée
    // ICI plutôt qu'écrite en dur dans une phrase, mais elle reste bornée aux
    // moments où quelqu'un hésiterait vraiment — un agent qui hésite à chaque
    // phrase est une caricature, qui sonne plus faux qu'un agent neutre.
    "- Quand tu vérifies quelque chose, hésite un peu : « Alors… euh, laissez-moi regarder. »",
    "- N'hésite PAS en te présentant, ni en prenant congé : ça sonne fuyant.",
    "",
    "INTERDIT :",
    "- Le TUTOIEMENT. Familier ne veut pas dire familier avec la personne : c'est « vous ».",
    "- L'argot et le relâché : pas de « ouais », pas de « nickel », pas de « ça craint ».",
    "- Tournures administratives : « nous vous prions », « veuillez », « dans les meilleurs délais ».",
    "- Subjonctif soutenu.",
    "- Toute menace, allusion au contentieux, à un huissier, à une saisie, à un fichage.",
    "- Toute culpabilisation. Tu facilites le paiement, tu ne fais pas honte.",
    "",
    "CHIFFRES :",
    // Demandé en CHIFFRES, et c'est une exigence de sécurité, pas de style.
    // `chiffresInventes` compare des groupes de chiffres : un modèle qui écrit
    // « trente jours » au lieu de « 30 jours » passe la garde sans être vu.
    // L'alternative — reconnaître les nombres en toutes lettres — se heurte à
    // « un »/« une », articles bien plus souvent que numéraux, et produirait
    // des refus sur du français correct. On ferme donc le trou en amont.
    // La synthèse vocale lit « 3 » comme « trois » : rien ne change à l'oreille.
    "- Écris les nombres en CHIFFRES : « 3 fois », « 10 jours », « 400 euros ».",
    "- Jamais en toutes lettres : ni « trois fois », ni « dix jours ».",
    "- Tu ne dis QUE les chiffres qui te sont fournis dans les faits.",
    "- Tu n'en calcules aucun, tu n'en arrondis aucun, tu n'en inventes aucun.",
    "- Aucun montant, aucune date, aucun délai qui ne soit pas dans les faits.",
    "",
    "Tu réponds UNIQUEMENT par la réplique à prononcer. Pas de guillemets, pas de commentaire.",
  ].join("\n");
}

/** Ce que l'intention demande, en une phrase, pour le message utilisateur. */
const OBJECTIF: Readonly<Record<IntentionReplique, string>> = {
  demander_date: "Demande une date de règlement précise. Une seule question, simple.",
  // Le libellé insiste sur la RELATION entre les deux nombres, pas seulement
  // sur leur valeur. Observé sur une vraie sortie de modèle : avec des faits
  // nommés « versements » et « premier_versement_jours », il a produit « trois
  // versements en 10 jours » — c'est-à-dire tout payer sous dix jours au lieu
  // d'étaler. Les deux chiffres étaient pourtant exacts, donc la garde des
  // chiffres inventés n'avait rien à redire : elle vérifie la PROVENANCE d'un
  // nombre, jamais le sens de la phrase qui l'entoure.
  offrir_echelonnement:
    "Propose un paiement en plusieurs fois. Le nombre de versements et le délai " +
    "avant le PREMIER versement sont dans les faits. Le délai ne concerne QUE le " +
    "premier versement — ne dis jamais que tout doit être payé dans ce délai. " +
    "Demande si ça convient.",
  refuser_et_transmettre:
    "Tu n'accordes rien. Dis que tu notes la demande et que tu la transmets, sans dire pourquoi tu ne peux pas.",
  recapituler_promesse:
    "Relis ce qui vient d'être convenu, avec les chiffres des faits, et demande confirmation.",
  clore_contestation:
    "La personne conteste la facture. Tu ne discutes pas. Tu notes, tu transmets, tu prends congé.",
  clore_paiement_annonce:
    "La personne dit avoir déjà payé. Tu notes, tu dis qu'on vérifie, tu prends congé.",
  clore_rappel_humain:
    "La personne veut parler à quelqu'un. Tu notes, tu dis que quelqu'un rappelle, tu prends congé.",
  clore_opposition:
    "La personne ne veut plus être appelée. Tu confirmes que c'est noté, définitivement, et tu prends congé.",
};

/**
 * Le message de tour : l'objectif, les faits, l'historique.
 *
 * L'historique est passé en clair au modèle — c'est ce qui lui permet de
 * rebondir plutôt que de réciter. Il n'est en revanche JAMAIS journalisé
 * (règle 6 : pas de verbatim dans un journal).
 */
export function messageFormulation(
  intention: IntentionReplique,
  faits: FaitsReplique,
  historique: readonly TourParole[] = [],
): string {
  const lignesFaits = Object.entries(faits).map(([cle, valeur]) => `- ${cle} : ${valeur}`);
  const lignesHistorique = historique.map(
    (t) => `${t.locuteur === "agent" ? "Toi" : "La personne"} : ${t.propos}`,
  );

  return [
    `OBJECTIF : ${OBJECTIF[intention]}`,
    "",
    "FAITS (les seuls chiffres que tu as le droit de dire) :",
    ...(lignesFaits.length > 0 ? lignesFaits : ["- (aucun)"]),
    ...(lignesHistorique.length > 0 ? ["", "LA CONVERSATION JUSQU'ICI :", ...lignesHistorique] : []),
  ].join("\n");
}

// ── Les gardes de sortie ───────────────────────────────────────────────────

export type NatureAnomalieReplique =
  | "oralite"
  | "registre_interdit"
  | "chiffre_invente"
  | "trop_de_phrases"
  | "tutoiement"
  | "identite_divulguee"
  | "vide";

/**
 * Formes juridiques et mots de raison sociale trop communs pour identifier
 * quelqu'un. Les garder ferait refuser des répliques parfaitement anodines —
 * et une garde qui refuse ce qu'elle protège finit désactivée.
 */
const MOTS_NON_IDENTIFIANTS = new Set([
  "sarl", "sas", "sasu", "eurl", "sci", "scop", "snc", "eirl",
  "entreprise", "societe", "société", "etablissements", "établissements",
  "monsieur", "madame", "maison", "groupe", "compagnie", "atelier",
]);

/**
 * Les morceaux d'identité prononcés dans cette réplique.
 *
 * ── Pourquoi cette garde existe ────────────────────────────────────────────
 * Le texte des répliques part vers la synthèse vocale, chez un sous-traitant
 * AMÉRICAIN (ADR 002). Sans Zero Retention Mode — réservé aux offres
 * entreprise — ce texte y est conservé. L'ADR laissait deux voies : souscrire
 * l'offre qui donne la garantie, ou **minimiser par construction** en
 * garantissant que le nom du débiteur ne sort jamais. Ceci est la seconde voie.
 *
 * ── Pourquoi c'est faisable ici et pas ailleurs ────────────────────────────
 * On ne cherche pas « un nom » dans un texte libre, ce qui serait une devinette.
 * Le serveur SAIT quel débiteur il appelle : la chaîne à interdire est connue,
 * exacte, et propre à cet appel. La détection est donc sûre.
 *
 * Le modèle, lui, reçoit l'historique complet de la conversation — mais il vit
 * derrière `LLM_BASE_URL`, dans le périmètre souverain. Ce qui traverse
 * l'Atlantique, c'est uniquement ce que l'agent PRONONCE.
 */
export function identitesDivulguees(
  replique: string,
  identites: readonly string[],
): string[] {
  const mots = new Set<string>();
  for (const identite of identites) {
    for (const mot of identite.toLowerCase().split(/[^a-zà-ÿ]+/)) {
      // Deux ou trois lettres : trop court pour identifier, et trop susceptible
      // de tomber dans un mot courant.
      if (mot.length >= 4 && !MOTS_NON_IDENTIFIANTS.has(mot)) mots.add(mot);
    }
  }
  if (mots.size === 0) return [];

  const bas = replique.toLowerCase();
  return [...mots].filter((mot) =>
    new RegExp(`(^|[^a-zà-ÿ])${mot}([^a-zà-ÿ]|$)`, "i").test(bas),
  );
}

/**
 * Le tutoiement, et la raison pour laquelle il a sa propre garde.
 *
 * La consigne demande un registre FAMILIER — négation sans « ne », « on » pour
 * « nous », phrases courtes. C'est ce qu'il faut pour ne pas sonner comme un
 * courrier. Mais « familier » et « familier AVEC la personne » sont deux choses
 * différentes, et un modèle à qui l'on demande de se détendre glisse volontiers
 * de l'un à l'autre.
 *
 * Dans un appel de recouvrement, tutoyer quelqu'un à qui l'on réclame de
 * l'argent n'est pas une maladresse de ton : c'est une familiarité imposée à
 * une personne en position basse, et ça se retourne immédiatement contre
 * l'entreprise qui appelle.
 *
 * D'où une garde plutôt qu'une ligne de consigne de plus. Assouplir le registre
 * sans borner l'écart aurait été assouplir une assertion pour obtenir le ton
 * voulu.
 */
// `te` a été ajouté après coup : la première version laissait passer « Ça te
// va comme ça ? », attrapé par son propre test. Une garde qui ne couvre que
// les formes auxquelles on a pensé donne surtout l'illusion d'être couvert.
const TUTOIEMENT = /(^|[^a-zà-ÿ])(tu|te|toi|ton|ta|tes|t'as|t'es)([^a-zà-ÿ]|$)/i;

export interface AnomalieReplique {
  readonly nature: NatureAnomalieReplique;
  readonly detail: string;
}

/**
 * Colle les groupes de chiffres séparés par une espace : « 1 200 » → « 1200 ».
 *
 * Sans cette normalisation, un modèle qui prononce « mille deux cents » en
 * chiffres groupés (« 1 200 ») serait accusé d'inventer « 1 » et « 200 » alors
 * qu'il répète fidèlement le fait « 1200 ». On traite les deux côtés de la
 * comparaison de la même façon, sinon la garde punit la conformité.
 */
function collerGroupes(texte: string): string {
  return texte.replace(/(\d)[\s  ](?=\d)/g, "$1");
}

function chiffresDe(texte: string): Set<string> {
  return new Set(collerGroupes(texte).match(/\d+/g) ?? []);
}

/**
 * Les nombres prononcés qui ne figurent dans aucun fait transmis.
 *
 * C'est la garde qui applique la règle 3 : « un chiffre affiché à l'utilisateur
 * vient toujours d'un calcul déterministe, jamais du modèle ». Ici l'utilisateur
 * est au téléphone, mais le principe ne change pas — un montant inventé est un
 * engagement pris au nom de l'entreprise.
 *
 * LIMITE ASSUMÉE : les nombres écrits en toutes lettres (« en trois fois »)
 * échappent à cette détection. Elle porte sur ce qui se mesure sans ambiguïté.
 * Les montants et les dates, eux, sortent du modèle en chiffres — c'est le cas
 * qui engage, et c'est celui qui est couvert.
 */
export function chiffresInventes(replique: string, faits: FaitsReplique): string[] {
  const autorises = new Set<string>();
  for (const valeur of Object.values(faits)) {
    for (const c of chiffresDe(valeur)) autorises.add(c);
  }
  return [...chiffresDe(replique)].filter((c) => !autorises.has(c));
}

function compterPhrases(texte: string): number {
  return texte.split(/[.!?…]+/).filter((p) => p.trim().length > 0).length;
}

/**
 * Tout ce qui, dans cette réplique, interdit de la prononcer.
 *
 * Vide = prononçable. Non vide, l'appelant régénère une fois puis retombe sur
 * la réplique de secours ; il ne « nettoie » jamais la sortie. Corriger un
 * texte qui menace laisserait croire que le modèle a compris qu'il ne faut pas
 * menacer.
 */
export function verifierReplique(
  replique: string,
  faits: FaitsReplique,
  /**
   * Ce que l'agent ne doit pas prononcer parce que ça sortirait du périmètre
   * souverain : le nom du débiteur appelé. Vide par défaut — la minimisation
   * est une décision de l'appelant, seul à savoir qui il appelle.
   */
  identites: readonly string[] = [],
): AnomalieReplique[] {
  const texte = replique.trim();
  if (texte.length === 0) return [{ nature: "vide", detail: "réplique vide" }];

  const anomalies: AnomalieReplique[] = [];

  for (const a of verifierOralite(texte) as AnomalieOralite[]) {
    anomalies.push({ nature: "oralite", detail: `${a.nature} — ${a.detail}` });
  }

  for (const r of registresInterdits(texte)) {
    anomalies.push({ nature: "registre_interdit", detail: r.libelle });
  }

  for (const c of chiffresInventes(texte, faits)) {
    anomalies.push({ nature: "chiffre_invente", detail: `« ${c} » ne vient d'aucun fait` });
  }

  const tutoie = TUTOIEMENT.exec(texte);
  if (tutoie) {
    anomalies.push({ nature: "tutoiement", detail: `« ${tutoie[2]} »` });
  }

  for (const mot of identitesDivulguees(texte, identites)) {
    // Le DÉTAIL ne reprend pas le mot trouvé : il finirait dans le journal du
    // repli, et ce mot est précisément la donnée personnelle qu'on protège.
    void mot;
    anomalies.push({
      nature: "identite_divulguee",
      detail: "la réplique nomme le débiteur",
    });
  }

  const phrases = compterPhrases(texte);
  if (phrases > PHRASES_MAX_PAR_REPLIQUE) {
    anomalies.push({
      nature: "trop_de_phrases",
      detail: `${phrases} phrases (maximum ${PHRASES_MAX_PAR_REPLIQUE})`,
    });
  }

  return anomalies;
}

// ── Le filet ───────────────────────────────────────────────────────────────

/**
 * Ce qu'on prononce quand le modèle échoue deux fois, ou qu'il est injoignable.
 *
 * Ces phrases étaient le chemin normal jusqu'à ce lot ; elles sont désormais le
 * recours. Elles restent écrites en français parlé, et `formulation.test.ts`
 * leur applique les MÊMES gardes qu'à la sortie du modèle : un filet qui
 * violerait la règle qu'il protège ne protège rien.
 *
 * Elles n'utilisent que les faits, jamais un chiffre en dur — sans quoi la
 * garde des chiffres inventés les refuserait, à juste titre.
 */
export const REPLIQUES_DE_SECOURS: Readonly<
  Record<IntentionReplique, (faits: FaitsReplique) => string>
> = {
  demander_date: () => "Alors, vous pouvez régler quel jour ?",

  offrir_echelonnement: (f) =>
    `Alors, on peut faire ${f["nombre_de_versements"] ?? ""} fois. ` +
    `Le premier dans ${f["jours_avant_le_premier_versement"] ?? ""} jours. Ça vous va ?`,

  refuser_et_transmettre: () =>
    "Écoutez, je note et je transmets. On revient vers vous là-dessus.",

  recapituler_promesse: (f) =>
    `Alors je résume. Vous réglez ${f["montant"] ?? ""} le ${f["date"] ?? ""}. C'est bien ça ?`,

  clore_contestation: () =>
    "Ah d'accord. Écoutez, je note et je transmets. Quelqu'un revient vers vous. Bonne journée.",

  clore_paiement_annonce: () =>
    "Ah très bien. Du coup je note, et on vérifie de notre côté. Merci, bonne journée.",

  clore_rappel_humain: () =>
    "Bien sûr. Alors je note, et quelqu'un vous rappelle. Merci, bonne journée.",

  // « on ne vous rappellera plus » → « on vous rappellera plus » : c'est la
  // négation sans « ne », le marqueur qui sépare vraiment le parlé de l'écrit
  // lu à voix haute. Le sens de l'engagement ne bouge pas d'un iota.
  clore_opposition: () =>
    "D'accord, c'est noté. On vous rappellera plus. Merci, et bonne journée.",
};
