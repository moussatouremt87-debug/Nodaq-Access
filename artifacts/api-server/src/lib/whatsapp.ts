/**
 * Envoi de messages WhatsApp — par l'opérateur, jamais par un SDK.
 *
 * Décalque assumé de `lib/sms.ts` : même point de sortie (l'API Messages de
 * l'opérateur), même discipline (`fetch` et rien d'autre), mêmes interdits de
 * journalisation. La seule différence tient au préfixe `whatsapp:` que
 * l'opérateur exige des deux côtés de la conversation.
 *
 * CE N'EST PAS UN CANAL DE DÉMARCHAGE. Il n'existe aucune route publique pour
 * écrire un message arbitraire à un numéro arbitraire, et il ne doit pas en
 * exister. Le destinataire est toujours celui d'une relance déjà approuvée
 * par un humain, lu en base — jamais reçu dans un corps de requête, jamais
 * choisi par un modèle.
 *
 * L'EXPÉDITEUR EST UNE VARIABLE À PART, et pas `TELEPHONY_CALLER_ID`. Chez
 * l'opérateur, le numéro qui appelle et celui qui écrit sur WhatsApp sont deux
 * ressources distinctes — en bac à sable, l'expéditeur WhatsApp est un numéro
 * partagé qui n'appartient à personne. Les confondre enverrait les messages
 * depuis un numéro non déclaré, que l'opérateur refuse.
 *
 * RÈGLE 6 : ni le numéro, ni le corps du message ne sont journalisés. Le
 * journal ne porte que le code HTTP.
 */

import { logger } from "./logger.js";

const BASE_TWILIO = "https://api.twilio.com";

export type ResultatWhatsApp =
  | { kind: "envoye"; messageId: string }
  | { kind: "non_configure" }
  | { kind: "numero_inexploitable" }
  | { kind: "refuse_operateur"; status: number };

/**
 * Normalise un numéro en adresse WhatsApp.
 *
 * L'opérateur veut `whatsapp:+33612345678` — préfixe, indicatif, chiffres.
 * Un numéro qu'on ne sait pas normaliser n'est PAS envoyé « au mieux » : il
 * est refusé. Écrire à un mauvais numéro ne se rattrape pas, et un message de
 * recouvrement adressé à un inconnu est pire qu'un message non envoyé.
 */
export function adresseWhatsApp(numero: string | null | undefined): string | null {
  if (!numero) return null;
  const nettoye = numero.replace(/[\s.\-()]/g, "");

  // Trois écritures acceptées, et une seule refusée — délibérément.
  //
  // `+33…` et `0033…` sont les formes qu'un humain saisit. `33…` NU est la
  // troisième : c'est ce que rend `numeroPourWhatsApp` (@nodaq/shared), qui
  // normalise pour `wa.me` — lequel n'accepte pas le `+`. C'est le format que
  // la charge utile d'une relance porte réellement, et l'oublier faisait
  // rejeter comme « inexploitable » un numéro parfaitement valide.
  //
  // Ce qui reste REFUSÉ : un numéro national commençant par `0` sans
  // indicatif. `0612345678` peut être français, italien ou britannique —
  // deviner l'indicatif serait inventer un destinataire.
  let international: string;
  if (nettoye.startsWith("+")) international = nettoye;
  else if (nettoye.startsWith("00")) international = `+${nettoye.slice(2)}`;
  else if (/^[1-9]\d{7,14}$/.test(nettoye)) international = `+${nettoye}`;
  else return null;

  if (!/^\+[1-9]\d{7,14}$/.test(international)) return null;
  return `whatsapp:${international}`;
}

function configuration(): { sid: string; token: string; expediteur: string } | null {
  const sid = process.env["TELEPHONY_ACCOUNT_SID"];
  const token = process.env["TELEPHONY_AUTH_TOKEN"];
  const brut = process.env["WHATSAPP_FROM"];
  if (!sid || !token || !brut) return null;
  // Toléré avec ou sans préfixe : la console de l'opérateur affiche le numéro
  // nu, sa documentation l'écrit préfixé. Les deux se recopient.
  const expediteur = brut.startsWith("whatsapp:") ? brut : `whatsapp:${brut}`;
  return { sid, token, expediteur };
}

/**
 * Envoie un message WhatsApp. Le `texte` est produit par le serveur, jamais
 * par un modèle — un LLM qui rédigerait une relance de recouvrement écrirait
 * tôt ou tard une menace, et un message envoyé ne se retire pas.
 */
export async function envoyerWhatsApp(
  destinataire: string,
  texte: string,
): Promise<ResultatWhatsApp> {
  const config = configuration();
  if (!config) return { kind: "non_configure" };

  const adresse = adresseWhatsApp(destinataire);
  if (!adresse) return { kind: "numero_inexploitable" };

  const corps = new URLSearchParams({
    To: adresse,
    From: config.expediteur,
    Body: texte,
  });

  const reponse = await fetch(
    `${BASE_TWILIO}/2010-04-01/Accounts/${config.sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        // L'authentification de base de l'opérateur. Le jeton ne sort jamais
        // d'ici et n'apparaît dans aucun journal.
        Authorization: `Basic ${Buffer.from(`${config.sid}:${config.token}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: corps,
    },
  );

  if (!reponse.ok) {
    // Code seul : le corps d'erreur de l'opérateur reprend le numéro composé.
    logger.error({ status: reponse.status }, "[whatsapp] envoi refusé");
    return { kind: "refuse_operateur", status: reponse.status };
  }

  const data = (await reponse.json().catch(() => ({}))) as { sid?: string };
  logger.info({ status: reponse.status }, "[whatsapp] envoyé");
  return { kind: "envoye", messageId: data.sid ?? "" };
}
