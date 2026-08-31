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

/**
 * Le code de RÉINITIALISATION — un message distinct, et pas par coquetterie.
 *
 * Le texte de connexion dit « saisissez-le pour terminer votre connexion ».
 * L'envoyer à quelqu'un qui a demandé à changer son mot de passe le laisserait
 * croire qu'une connexion est en cours à son insu — exactement l'inquiétude
 * qu'on veut éviter.
 *
 * Et l'avertissement change de sens. Pour la connexion : « sans ce code,
 * personne n'entre ». Ici, un code non demandé signale que quelqu'un CONNAÎT
 * l'adresse et tente de reprendre le compte : cela mérite d'être dit.
 */
export async function envoyerCodeReinitialisation(
  tenantId: string,
  destinataire: string,
  code: string,
): Promise<void> {
  const corps = [
    `Votre code pour changer de mot de passe : ${code}`,
    ``,
    `Saisissez-le dans nodaq pour choisir un nouveau mot de passe.`,
    `Il est valable ${DUREE_CODE_MINUTES} minutes et ne sert qu'une fois.`,
    ``,
    `Si vous n'avez rien demandé, ignorez ce message : votre mot de passe`,
    `actuel reste valable et personne ne peut le changer sans ce code.`,
    `Prévenez-nous si vous recevez plusieurs de ces messages.`,
  ].join("\n");

  await sendDocument({
    canal: "EMAIL",
    tenantId,
    to: destinataire,
    subject: `nodaq — changer votre mot de passe : ${code}`,
    body: corps,
    documentType: "CODE_CONNEXION",
  });
}
