/**
 * Temps de saisie évité par une action d'agent validée — US-A6.5.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  Le chiffre affiché est une ESTIMATION DE RÉFÉRENCE, pas une mesure.      ║
 * ║  L'écran doit le dire, et il le dit.                                     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * ── Pourquoi un barème et pas une mesure ─────────────────────────────────
 * Le seul délai réellement mesurable aujourd'hui est celui qui sépare la
 * proposition de sa validation. Il mesure la disponibilité de l'utilisateur —
 * s'il a validé le lendemain matin, il n'a pas « gagné une nuit ». L'AC1 de la
 * story demande d'ailleurs explicitement une « durée de référence pour l'action
 * manuelle équivalente ».
 *
 * ── Pourquoi c'est DÉRIVÉ et non plaqué ──────────────────────────────────
 * Écrire « créer une affaire = 3 minutes » serait exactement le chiffre
 * arbitraire que l'AC3 refuse. La référence se calcule :
 *
 *     navigation vers l'écran + (nombre de champs × coût par champ)
 *
 * Le nombre de champs de chaque type est celui de son schéma dans
 * `intentionVocale.ts` : n'importe qui peut rouvrir ce fichier et refaire le
 * calcul. C'est ce que l'AC3 appelle une méthode « cohérente et vérifiable ».
 *
 * ── Pourquoi les constantes sont BASSES ──────────────────────────────────
 * Le point d'attention de la story est sans ambiguïté : « une estimation
 * exagérée qui se révèle fausse à l'usage nuirait à la confiance plus qu'elle
 * ne l'aiderait ». Une sous-estimation que l'utilisateur constate comme
 * prudente vaut mieux qu'un chiffre flatteur qu'il sait faux. En cas de doute
 * sur une valeur, la baisser.
 */
import type { Intention } from "./intentionVocale.js";
import type { Vertical } from "./verticalPacks.js";

/**
 * Atteindre le bon écran et y ouvrir le bon formulaire : quelques clics depuis
 * n'importe où dans l'application. Volontairement court — on ne compte ni
 * l'hésitation, ni la recherche de l'entrée de menu, ni le temps de lecture.
 */
export const COUT_NAVIGATION_S = 20;

/**
 * Remplir UN champ : cliquer dedans, saisir, en sortir. Certains champs coûtent
 * bien plus (choisir une date dans un sélecteur, retrouver un client dans une
 * liste) — on ne les distingue pas, et on retient la valeur du champ le plus
 * simple. Encore une fois : sous-estimer plutôt que gonfler.
 */
export const COUT_CHAMP_S = 12;

/**
 * Nombre de champs à remplir à la main pour obtenir le même résultat, par type
 * d'intention. Recopié des schémas de `intentionVocale.ts` — le champ `type`
 * lui-même n'en est pas un, l'utilisateur ne le saisit jamais.
 *
 * Le `Record` porte sur l'UNION des types d'intention : ajouter un neuvième
 * type sans l'inscrire ici fait échouer la COMPILATION. C'est la garde qui
 * empêche un type d'arriver en silence avec un gain de zéro.
 */
export const BAREME_TEMPS_MANUEL: Record<Intention["type"], { readonly champs: number }> = {
  // label, clientMentionne, villeMentionnee, dateDebutMentionnee
  creer_affaire: { champs: 4 },
  // nom, telephoneMentionne, villeMentionnee
  creer_prospect: { champs: 3 },
  // affaireMentionnee, statut
  maj_statut_affaire: { champs: 2 },
  // libelle, dateMentionnee
  creer_echeance: { champs: 2 },
  // titre, categorieMentionnee
  creer_entree_classeur: { champs: 2 },
  // libelle
  consigner_activite: { champs: 1 },
  // membreMentionne, typeAbsence, dateDebutMentionnee, dateFinMentionnee
  declarer_absence: { champs: 4 },
  // membreMentionne, affaireMentionnee, dateDebutMentionnee, dateFinMentionnee
  affecter_membre: { champs: 4 },
};

/**
 * Ajustements par secteur — VIDE, délibérément.
 *
 * L'AC3 demande que la référence soit « ajustable si elle s'avère irréaliste
 * pour un secteur donné ». Le point d'entrée existe donc ; il ne contient rien,
 * parce que je n'ai aucune donnée sur le temps de saisie d'un praticien par
 * rapport à un maçon. Inventer des écarts par secteur produirait précisément
 * les chiffres arbitraires que la story cherche à éviter.
 *
 * Le jour où l'usage montre un écart réel : une entrée ici, en centièmes
 * (1.5 = « une fois et demie plus long dans ce secteur »).
 */
export const AJUSTEMENTS_PAR_VERTICAL: Partial<Record<Vertical, number>> = {};

/** Durée de référence d'UNE opération, en secondes. */
export function referenceOperationSecondes(type: string, vertical?: string): number {
  const entree = BAREME_TEMPS_MANUEL[type as Intention["type"]];
  // Un type inconnu ne vaut rien plutôt que de faire échouer l'affichage :
  // mieux vaut un cumul prudent qu'un écran en erreur. La garde de compilation
  // ci-dessus rend ce cas improbable pour les types du produit.
  if (!entree) return 0;
  const base = COUT_NAVIGATION_S + entree.champs * COUT_CHAMP_S;
  const facteur = (vertical && AJUSTEMENTS_PAR_VERTICAL[vertical as Vertical]) || 1;
  return Math.round(base * facteur);
}

/**
 * Temps de saisie évité par un ensemble d'opérations validées, en secondes.
 *
 * N'accepte qu'une forme minimale (`{ type }`) : ce module est partagé et ne
 * doit dépendre ni du plan côté serveur, ni de la réponse d'une route.
 */
export function tempsGagneSecondes(
  operations: readonly { readonly type: string }[],
  vertical?: string,
): number {
  return operations.reduce((total, op) => total + referenceOperationSecondes(op.type, vertical), 0);
}

/**
 * Formate une durée pour l'affichage. Rend `null` pour zéro : un écran qui
 * annonce « 0 min gagnées » dit à l'utilisateur que l'outil ne sert à rien —
 * l'appelant n'affiche alors rien du tout.
 */
export function formaterTempsGagne(secondes: number): string | null {
  if (secondes <= 0) return null;
  if (secondes < 60) return `${secondes} s`;
  const minutes = Math.round(secondes / 60);
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.floor(minutes / 60);
  const reste = minutes % 60;
  return reste === 0 ? `${heures} h` : `${heures} h ${reste} min`;
}
