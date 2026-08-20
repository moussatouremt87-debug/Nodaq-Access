/**
 * Envoi de SMS — ticket 4.19, lot B.
 *
 * Un seul usage aujourd'hui : porter le lien de paiement au débiteur qu'on
 * vient d'avoir au téléphone. Ce n'est PAS un canal de démarchage ; il n'y a
 * pas de route publique pour envoyer un SMS arbitraire, et il ne doit pas y
 * en avoir. Le destinataire est toujours le numéro de l'appel en cours, lu en
 * base — jamais reçu dans un corps de requête, jamais choisi par un modèle.
 *
 * Aucun SDK fournisseur (même discipline que `lib/llm` et `lib/banque-agreee`)
 * : `fetch` et rien d'autre. Les identifiants viennent de l'environnement,
 * sans valeur par défaut — absents, l'envoi rend `non_configure` plutôt que
 * d'échouer en silence.
 *
 * RÈGLE 6 : ni le numéro, ni le corps du message ne sont journalisés. Le
 * journal ne porte que le code HTTP et la durée.
 */

import { logger } from "./logger.js";

const BASE_TWILIO = "https://api.twilio.com";

export type ResultatSms =
  | { kind: "envoye"; messageId: string }
  | { kind: "non_configure" }
  | { kind: "refuse_operateur"; status: number };

function configuration(): { sid: string; token: string; expediteur: string } | null {
  const sid = process.env["TELEPHONY_ACCOUNT_SID"];
  const token = process.env["TELEPHONY_AUTH_TOKEN"];
  const expediteur = process.env["TELEPHONY_CALLER_ID"];
  if (!sid || !token || !expediteur) return null;
  return { sid, token, expediteur };
}

/**
 * Envoie un SMS. Le `texte` est produit par le serveur, jamais par un modèle
 * — un LLM qui rédigerait un SMS de recouvrement écrirait tôt ou tard une
 * menace, et un SMS ne se rattrape pas.
 */
export async function envoyerSms(destinataire: string, texte: string): Promise<ResultatSms> {
  const config = configuration();
  if (!config) return { kind: "non_configure" };

  const corps = new URLSearchParams({
    To: destinataire,
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
    logger.error({ status: reponse.status }, "[sms] envoi refusé");
    return { kind: "refuse_operateur", status: reponse.status };
  }

  const data = (await reponse.json().catch(() => ({}))) as { sid?: string };
  logger.info({ status: reponse.status }, "[sms] envoyé");
  return { kind: "envoye", messageId: data.sid ?? "" };
}

/**
 * Le texte du SMS de lien de paiement, produit ICI — déterministe.
 *
 * Court (un SMS long se découpe et coûte double), sans menace, sans
 * culpabilisation : les mêmes interdits que l'agent vocal (US-4). Il nomme
 * l'entreprise créancière, car un lien de paiement anonyme est indiscernable
 * d'une tentative d'hameçonnage — et c'est justement ce qu'on ne veut pas
 * apprendre aux gens à ignorer.
 */
export function texteSmsLienPaiement(
  raisonSociale: string,
  montantParle: string,
  url: string,
): string {
  return `${raisonSociale} : voici le lien pour régler ${montantParle} par virement — ${url}`;
}
