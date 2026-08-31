/**
 * Mot de passe oublié — le chemin de retour.
 *
 * ── POURQUOI C'ÉTAIT UN DÉFAUT BLOQUANT ─────────────────────────────────────
 *
 * Il n'existait AUCUN moyen de réinitialiser un mot de passe. Un artisan qui
 * l'oubliait était enfermé dehors définitivement : pas de lien, pas de route,
 * pas d'écran. Le seul recours aurait été de modifier sa ligne en base à la
 * main. Sur cinquante comptes payants, cela arrive dans la première semaine.
 *
 * ── CE QUI EST RÉUTILISÉ, ET CE QUI NE L'EST PAS ────────────────────────────
 *
 * La mécanique du code à six chiffres est reprise telle quelle : condensat en
 * base, expiration à dix minutes, cinq tentatives, cinq demandes par heure,
 * comparaison en temps constant. Elle a été écrite pour la connexion et elle
 * est bonne ; en réécrire une seconde serait la duplication qui a coûté le
 * plus cher dans ce dépôt.
 *
 * En revanche les codes sont CLOISONNÉS par usage (migration 073). Un code de
 * connexion ne réinitialise pas un mot de passe : ouvrir une session et
 * reprendre un compte n'ont pas la même conséquence, et un code dicté au
 * téléphone ne doit pas donner les deux.
 *
 * ── CE QUE LA RÉINITIALISATION EMPORTE ──────────────────────────────────────
 *
 * Toutes les sessions et tous les appareils de confiance. Quelqu'un qui
 * réinitialise dit « je n'ai plus la main » ; lui rendre son mot de passe en
 * laissant ouvertes les sessions de celui qui la lui a prise n'aurait aucun
 * sens. C'est le geste qui reprend le compte, pas seulement le mot de passe.
 */
import { eq, isNull, and } from "drizzle-orm";
import { db, usersTable, sessionsTable, appareilsConfianceTable } from "@workspace/db";
import { poserCode, verifierCode, type ResultatVerification } from "./code-connexion.js";
import { findUserByEmail } from "./authService.js";
import { hashPassword } from "./password.js";

/** Le nombre minimal de caractères — le même que l'inscription. */
export const LONGUEUR_MINIMALE = 10;

export type ResultatDemande =
  | { readonly kind: "envoye"; readonly userId: string; readonly code: string }
  /** Compte inconnu, ou trop de demandes : l'appelant répond PAREIL. */
  | { readonly kind: "silencieux" };

/**
 * Demande un code de réinitialisation.
 *
 * ── LA RÉPONSE NE DIT JAMAIS SI LE COMPTE EXISTE ────────────────────────────
 *
 * `silencieux` couvre deux cas très différents — adresse inconnue, ou limite
 * horaire atteinte — et c'est délibéré : l'appelant ne peut pas les
 * distinguer, donc il ne peut pas les raconter. Un formulaire qui répond
 * « cette adresse n'existe pas » est un outil d'énumération : on y essaie une
 * liste d'adresses et on apprend lesquelles sont clientes.
 */
export async function demanderReinitialisation(email: string): Promise<ResultatDemande> {
  const utilisateur = await findUserByEmail(email.trim().toLowerCase());
  if (!utilisateur) return { kind: "silencieux" };

  const pose = await poserCode(utilisateur.id, "reinitialisation");
  if (pose.kind !== "ok") return { kind: "silencieux" };

  return { kind: "envoye", userId: utilisateur.id, code: pose.code };
}

export type ResultatReinitialisation =
  | { readonly kind: "ok" }
  | { readonly kind: "trop_court" }
  | { readonly kind: "refuse"; readonly detail: ResultatVerification };

/**
 * Pose le nouveau mot de passe, puis referme tout derrière.
 *
 * L'ordre compte : le mot de passe est changé AVANT que les sessions soient
 * supprimées. Si l'on coupait les sessions d'abord et que l'écriture échouait
 * ensuite, l'utilisateur serait déconnecté partout avec son ancien mot de
 * passe — chassé de chez lui sans avoir obtenu la nouvelle clé.
 */
export async function reinitialiserMotDePasse(
  email: string, code: string, nouveau: string,
): Promise<ResultatReinitialisation> {
  if (nouveau.length < LONGUEUR_MINIMALE) return { kind: "trop_court" };

  const utilisateur = await findUserByEmail(email.trim().toLowerCase());
  /*
   * Compte inconnu : on rend `aucun_code`, exactement ce qu'un compte réel
   * sans code en cours renverrait. Là encore, rien ne distingue les deux.
   */
  if (!utilisateur) return { kind: "refuse", detail: { kind: "aucun_code" } };

  const verif = await verifierCode(utilisateur.id, code, "reinitialisation");
  if (verif.kind !== "ok") return { kind: "refuse", detail: verif };

  await db.update(usersTable)
    .set({ passwordHash: await hashPassword(nouveau) })
    .where(eq(usersTable.id, utilisateur.id));

  // Tout ce qui donnait accès sans le mot de passe tombe.
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, utilisateur.id));
  await db.update(appareilsConfianceTable)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(appareilsConfianceTable.userId, utilisateur.id),
      isNull(appareilsConfianceTable.revokedAt),
    ));

  return { kind: "ok" };
}
