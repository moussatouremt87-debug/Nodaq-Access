/**
 * L'envoi du code de connexion, et rien d'autre.
 *
 * Isolé dans son propre module pour une raison précise : c'est le SEUL endroit
 * du serveur où un code en clair traverse une frontière. Le garder visible et
 * court permet de vérifier d'un coup d'œil qu'il n'est ni journalisé, ni
 * renvoyé, ni stocké.
 *
 * `sendDocument` n'enregistre que le destinataire, le type et le statut —
 * jamais le corps (vérifié dans `canal-emission.ts`). Le code ne touche donc
 * aucune table.
 */
import { sendDocument } from "./canal-emission.js";
import { DUREE_CODE_MINUTES } from "./code-connexion.js";

/**
 * « p… @gmail.com » — de quoi se rappeler QUELLE boîte regarder, sans
 * confirmer une adresse complète à quelqu'un qui n'aurait que le mot de passe.
 */
export function masquerEmail(email: string): string {
  const [avant, apres] = email.split("@");
  if (!avant || !apres) return "votre adresse";
  const tete = avant.slice(0, 1);
  return `${tete}${"•".repeat(Math.max(2, Math.min(avant.length - 1, 6)))}@${apres}`;
}

export async function envoyerCodeConnexion(
  tenantId: string,
  destinataire: string,
  code: string,
): Promise<void> {
  const corps = [
    `Votre code de connexion : ${code}`,
    ``,
    `Saisissez-le dans nodaq pour terminer votre connexion.`,
    `Il est valable ${DUREE_CODE_MINUTES} minutes et ne sert qu'une fois.`,
    ``,
    `Si vous n'avez pas tenté de vous connecter, ignorez ce message :`,
    `sans ce code, personne n'entre. Changez votre mot de passe si cela se répète.`,
  ].join("\n");

  await sendDocument({
    canal: "EMAIL",
    tenantId,
    to: destinataire,
    subject: `Votre code de connexion nodaq : ${code}`,
    body: corps,
    // Un type à part : ce n'est pas un document commercial. Le journal en
    // gardera la trace d'ENVOI (parti / échoué), jamais le contenu.
    documentType: "CODE_CONNEXION",
  });
}
