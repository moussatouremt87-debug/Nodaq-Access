/*
 * Le vocabulaire de l'interface — ticket 4.29.
 *
 * ── Pourquoi ce fichier existe ────────────────────────────────────────────
 * Session de test du 22/08/2026 : « Un artisan ne comprend pas le mot MRR. »
 * — « "YTD" n'est pas compréhensible pour un artisan. » — « "voir les 1 devis"
 * (ce n'est pas correct en français). »
 *
 * L'utilisateur de ce produit pose des ardoises et relance des impayés. Il ne
 * lit pas de tableau de bord de startup. Un mot qu'il doit traduire mentalement
 * est un mot qui coûte, et il n'y a aucune raison de le lui imposer : « Depuis
 * le 1er janvier » dit exactement ce que « YTD » dit, en français, sans rien
 * perdre.
 *
 * ── Ce que ce module N'EST PAS ────────────────────────────────────────────
 * Pas un système de traduction. Les libellés vivent dans les écrans, là où on
 * les lit. Ce fichier porte deux choses : la LISTE DES INTERDITS, que la garde
 * `vocabulaire.test.ts` fait respecter, et les remplacements retenus, pour que
 * deux écrans ne traduisent pas le même terme différemment.
 */

/**
 * Les termes bannis de l'interface, avec ce qu'il faut dire à la place.
 *
 * La clé est cherchée en MOT ENTIER et sans tenir compte de la casse : « MRR »
 * ne doit pas déclencher sur « mrred », et « pipeline » doit déclencher qu'il
 * soit capitalisé ou non.
 */
export const TERMES_INTERDITS: Readonly<Record<string, string>> = {
  // Anglicismes de gestion. Le premier est celui qui a été signalé nommément.
  MRR: "Revenus récurrents mensuels — ou « Par mois » quand la place manque",
  ARR: "Revenus récurrents annuels",
  YTD: "Depuis le 1er janvier",
  churn: "Clients perdus",
  pipeline: "Affaires en cours de discussion",
  // « Lead » et « deal » n'ont jamais été signalés, mais ils appartiennent à la
  // même famille et arriveraient par la même porte.
  lead: "Prospect",
  deal: "Affaire",
  forecast: "Prévision",
  runway: "Trésorerie devant soi",
  burn: "Dépenses mensuelles",
  // Sigles de la réforme de la facturation électronique. Ils ne disent RIEN à
  // quelqu'un qui pose des ardoises, et le ticket 4.36 les interdit
  // explicitement dans l'interface tant qu'ils ne sont pas expliqués. On dit
  // ce que la chose FAIT, pas comment l'administration la nomme.
  PDP: "Le réseau officiel des factures électroniques",
  PPF: "Le service public de facturation",
};

/**
 * Accord du nom qui suit un compte, en français.
 *
 * « Voir les 1 devis » était affiché tel quel. Deux fautes dans une phrase de
 * quatre mots : l'article et — pour un nom variable — la marque du pluriel.
 *
 * `pluriel` est facultatif : la règle française est appliquée par défaut, et on
 * ne précise que les irréguliers (travail → travaux).
 *
 * ── Les invariables sont gérés, et ce n'est pas du zèle ──────────────────
 * Un nom terminé par s, x ou z ne change pas au pluriel — devis, prix, avis,
 * colis, taux, nez. C'est très exactement la moitié du vocabulaire de ce
 * produit. Sans cette règle, l'appelant doit penser à écrire
 * `accorder(n, 'devis', 'devis')`, et l'oubli produit « 3 deviss ».
 *
 * Je l'ai oublié moi-même en écrivant le premier appel de ce lot : la règle
 * vaut mieux que la vigilance.
 */
export function accorder(compte: number, singulier: string, pluriel?: string): string {
  if (compte <= 1) return singulier;
  if (pluriel !== undefined) return pluriel;
  return /[sxz]$/i.test(singulier) ? singulier : `${singulier}s`;
}

/**
 * « le devis » / « les 3 devis » — l'article ET le nom, accordés.
 *
 * Au singulier le compte DISPARAÎT : « Voir le devis » se lit mieux que
 * « Voir le 1 devis », et personne n'a besoin qu'on lui rappelle qu'il y en a
 * un seul quand il n'y en a qu'un.
 */
export function articleEtNom(
  compte: number,
  singulier: string,
  pluriel?: string,
  feminin = false,
): string {
  const nom = accorder(compte, singulier, pluriel);
  if (compte <= 1) return `${feminin ? "la" : "le"} ${nom}`;
  return `les ${compte} ${nom}`;
}
