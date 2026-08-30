/**
 * Consigner une activité — avec son auteur quand il y en a un.
 *
 * ── POURQUOI CE PASSAGE OBLIGÉ ──────────────────────────────────────────────
 * `activity` s'écrivait à dix-sept endroits, par appel direct à
 * `tx.insert(activityTable)`. La colonne d'auteur, ajoutée par la migration
 * 067, aurait donc dû être renseignée dix-sept fois — et un oubli n'aurait
 * produit aucune erreur : juste une ligne d'historique anonyme, indiscernable
 * d'une action du système.
 *
 * C'est le mode de défaillance qu'on ne peut pas se permettre ici : le
 * fondateur veut savoir QUI a fait quoi, et une ligne sans auteur lui dirait
 * « c'est le système » alors que c'est sa secrétaire.
 *
 * Cette fonction rend donc l'auteur EXPLICITE dans la signature : on le
 * fournit, ou on déclare qu'il n'y en a pas. Écrire `auteur: null` est une
 * décision qu'on prend en le tapant ; oublier un champ n'en est pas une.
 */
import { activityTable, type DrizzleTx } from "@workspace/db";

/**
 * Qui a agi. `null` désigne le SYSTÈME — un renouvellement d'abonnement, un
 * objectif franchi, une relance exécutée par un travail de fond.
 *
 * Ce n'est pas une donnée manquante, c'est une information : l'écran affiche
 * « par nodaq » plutôt qu'un nom inventé.
 */
export type AuteurActivite = { readonly userId: string; readonly nom: string | null } | null;

export interface ActiviteAConsigner {
  readonly type: string;
  readonly label: string;
  readonly meta?: string | null;
}

/**
 * Écrit une ligne d'activité DANS la transaction reçue.
 *
 * Le `tx` est un paramètre et non un pool : une activité consignée hors de la
 * transaction qui l'a produite survivrait à son annulation, et l'historique
 * mentionnerait une affaire qui n'existe pas.
 */
export async function consignerActivite(
  tx: DrizzleTx,
  tenantId: string,
  activite: ActiviteAConsigner,
  auteur: AuteurActivite,
): Promise<void> {
  await tx.insert(activityTable).values({
    tenantId,
    type: activite.type,
    label: activite.label,
    ...(activite.meta !== undefined && activite.meta !== null ? { meta: activite.meta } : {}),
    // Le nom est COPIÉ, pas joint : un membre qui quitte l'entreprise ne doit
    // pas effacer l'historique de ce qu'il a fait.
    ...(auteur ? { auteurUserId: auteur.userId, auteurNom: auteur.nom } : {}),
  });
}

/**
 * L'auteur tiré d'une session Express, ou `null`.
 *
 * Sert aux routes : `auteurDeLaSession(req.session)`. Une session absente rend
 * `null` plutôt que de lever — une route non authentifiée n'existe pas dans ce
 * dépôt, mais un helper qui casse l'écriture d'un historique serait une
 * mauvaise affaire.
 */
export function auteurDeLaSession(
  session: { userId?: string; nom?: string | null } | undefined,
): AuteurActivite {
  if (!session?.userId) return null;
  return { userId: session.userId, nom: session.nom ?? null };
}
