/**
 * Déclenchement d'un appel via la plateforme d'exécution vocale (ticket 4.18-bis).
 *
 * Remplace le worker Python des lots 5-6 : le serveur demande à ElevenLabs de
 * composer, la plateforme prend tout le temps réel (transport, transcription,
 * formulation, synthèse), et revient vers nos routes de tools pour chaque
 * décision — authentifiée par le jeton de l'appel, passé en variable dynamique
 * secrète.
 *
 * ── Ce qui part ici, et rien d'autre ───────────────────────────────────────
 * Le numéro à composer, l'annonce (produite par NOTRE serveur — US-2, mot pour
 * mot), et le jeton de l'appel. Ni nom de débiteur, ni montant : les chiffres
 * n'atteignent l'agent que par `check_mandate`, où le noyau décide.
 *
 * ── Sans configuration, on PLANIFIE sans composer ──────────────────────────
 * Variables absentes → l'appel reste PLANIFIE et l'appelant est prévenu. C'est
 * ce qui permet aux tests de tourner sans clé (doctrine : la CI n'a aucun
 * secret) et à un déploiement sans agent vocal de ne rien casser.
 */
import { eq } from "drizzle-orm";
import { withTenant, appelsRelanceTable } from "@workspace/db";
import { annonceOuverture } from "@nodaq/shared";
import { loadCompanySettings } from "./seller-info.js";
import { logger } from "./logger.js";

const BASE_DEFAUT = "https://api.elevenlabs.io";

export type ResultatDeclenchement =
  | { kind: "declenche"; conversationId: string | null }
  | { kind: "non_configure" }
  | { kind: "sans_raison_sociale" }
  | { kind: "refuse_plateforme" };

function configuration(): {
  cle: string;
  agentId: string;
  telephoneId: string;
  base: string;
} | null {
  // Le fondateur a annoncé ELEVENLABS_API_KEY ; le dépôt portait déjà
  // VOICE_TTS_API_KEY pour le même compte. L'un PUIS l'autre — jamais de
  // valeur par défaut pour une clé.
  const cle = process.env["ELEVENLABS_API_KEY"] || process.env["VOICE_TTS_API_KEY"];
  const agentId = process.env["ELEVENLABS_AGENT_ID"];
  const telephoneId = process.env["ELEVENLABS_PHONE_NUMBER_ID"];
  if (!cle || !agentId || !telephoneId) return null;
  return {
    cle,
    agentId,
    telephoneId,
    base: (process.env["ELEVENLABS_BASE_URL"] || BASE_DEFAUT).replace(/\/$/, ""),
  };
}

export async function declencherAppelVocal(options: {
  tenantId: string;
  appelId: string;
  numero: string;
  jeton: string;
}): Promise<ResultatDeclenchement> {
  const config = configuration();
  if (!config) return { kind: "non_configure" };

  const reglages = await loadCompanySettings(options.tenantId);
  const raisonSociale = reglages["company.raison_sociale"]?.trim();
  if (!raisonSociale) {
    // L'agent DIT ce nom en s'annonçant. « L'assistant automatique de
    // Entreprise » sonne comme une arnaque : on ne compose pas.
    return { kind: "sans_raison_sociale" };
  }

  const reponse = await fetch(`${config.base}/v1/convai/twilio/outbound-call`, {
    method: "POST",
    headers: { "xi-api-key": config.cle, "Content-Type": "application/json" },
    body: JSON.stringify({
      agent_id: config.agentId,
      agent_phone_number_id: config.telephoneId,
      to_number: options.numero,
      conversation_initiation_client_data: {
        dynamic_variables: {
          // L'annonce, mot pour mot (US-2). La plateforme la PRONONCE — elle
          // ne la rédige pas.
          annonce: annonceOuverture(raisonSociale),
          // Le jeton de CET appel : les tools le présentent en Authorization,
          // et le serveur résout le tenant depuis la ligne (lot 6a).
          secret__jeton_appel: options.jeton,
        },
      },
    }),
  });

  if (!reponse.ok) {
    // Code seul : le corps peut reprendre le numéro composé (règle 6).
    logger.error(
      { statut: reponse.status, appelId: options.appelId },
      "[agent-vocal] la plateforme a refusé de composer",
    );
    return { kind: "refuse_plateforme" };
  }

  const corps = (await reponse.json()) as { conversation_id?: string };
  const conversationId = corps.conversation_id ?? null;

  if (conversationId) {
    // Le webhook post-call ne connaîtra QUE cet identifiant : sans lui, la
    // transcription et le coût n'auraient pas de destinataire.
    await withTenant(options.tenantId, (tx) =>
      tx
        .update(appelsRelanceTable)
        .set({ conversationId })
        .where(eq(appelsRelanceTable.id, options.appelId)),
    );
  }

  return { kind: "declenche", conversationId };
}
