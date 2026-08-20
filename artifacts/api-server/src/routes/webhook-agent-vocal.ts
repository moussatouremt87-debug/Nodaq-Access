/**
 * Webhook post-call de la plateforme vocale — ticket 4.18-bis, lot D.
 *
 *   POST /webhooks/agent-vocal
 *
 * La plateforme envoie ici, après analyse, tout ce qu'elle sait de l'appel :
 * transcript, durée, coût. C'est aussi ici que vit le versant DÉTECTIF de
 * l'ADR 005 : les gardes rejouées sur ce que l'agent a réellement dit, et
 * l'appel marqué si une violation apparaît.
 *
 * ── Authentification : signature HMAC, vérifiée à la main ──────────────────
 * En-tête `ElevenLabs-Signature: t=<secondes>,v0=<hmac>` où le condensat est
 * HMAC-SHA256(secret, "t.corpsBrut"). Format établi depuis le CODE SOURCE de
 * leur SDK (webhooks_custom.py) — leur documentation ne le donne pas, et on
 * n'embarque pas un SDK fournisseur pour trente lignes (même doctrine que
 * l'adaptateur de synthèse). Tolérance : 30 minutes, la leur.
 *
 * Le corps BRUT est signé : `req.rawBody`, capturé par le hook `verify`
 * d'express.json — re-sérialiser `req.body` ne reproduirait pas les octets
 * signés (même leçon que le webhook plateforme-agréée).
 *
 * ── Résolution du tenant : œuf-et-poule, troisième du nom ──────────────────
 * Le webhook ne connaît que `conversation_id`. La policy étroite
 * `appels_relance_webhook_lookup` (migration 046) laisse lire LA ligne
 * correspondante ; le tenant est LU depuis elle, puis tout repasse par
 * `withTenant`. Patron identique à l'acceptation publique et au webhook
 * bancaire.
 */
import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { sql, eq, and } from "drizzle-orm";
import { db, withTenant, appelsRelanceTable, campagnesRelanceTable } from "@workspace/db";
import { auditerTranscription, type AnomalieTranscript } from "@nodaq/shared";
import { logger } from "../lib/logger.js";

export const webhookAgentVocalRouter: IRouter = Router();

/** Tolérance d'horodatage — celle du SDK de la plateforme. */
const TOLERANCE_MS = 30 * 60 * 1000;

/**
 * Vérifie `t=...,v0=...` contre le corps brut. Rend false plutôt que de lever :
 * l'appelant décide du code, et AUCUN détail n'est journalisé — un attaquant
 * n'apprend pas lequel des contrôles l'a rejeté.
 */
export function signatureValide(entete: string | undefined, corpsBrut: Buffer, secret: string): boolean {
  if (!entete) return false;
  let t: string | undefined;
  let v0: string | undefined;
  for (const morceau of entete.split(",")) {
    if (morceau.startsWith("t=")) t = morceau.slice(2);
    else if (morceau.startsWith("v0=")) v0 = morceau.slice(3);
  }
  if (!t || !v0 || !/^\d+$/.test(t)) return false;

  if (Number(t) * 1000 < Date.now() - TOLERANCE_MS) return false;

  const attendu = crypto
    .createHmac("sha256", secret)
    .update(`${t}.${corpsBrut.toString("utf8")}`)
    .digest("hex");

  const a = Buffer.from(v0, "utf8");
  const b = Buffer.from(attendu, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

interface TourTranscript {
  role?: string;
  message?: string | null;
}

/** Retrouve l'appel par le conversation_id, via la policy étroite. */
async function appelParConversation(conversationId: string): Promise<{
  appelId: string;
  tenantId: string;
  campagneId: string;
  factureId: string | null;
  issue: string | null;
} | null> {
  return db.transaction(async (tx) => {
    // set_config(..., true) : portée transaction, sinon le réglage fuit entre
    // requêtes à cause du pooling — même règle que partout.
    await tx.execute(sql`SELECT set_config('app.voice_conversation_id', ${conversationId}, true)`);
    const lignes = await tx.execute<{
      id: string;
      tenant_id: string;
      campagne_id: string;
      facture_id: string | null;
      issue: string | null;
    }>(sql`SELECT id, tenant_id, campagne_id, facture_id, issue FROM appels_relance`);
    const l = lignes.rows[0];
    return l
      ? { appelId: l.id, tenantId: l.tenant_id, campagneId: l.campagne_id, factureId: l.facture_id, issue: l.issue }
      : null;
  });
}

webhookAgentVocalRouter.post("/webhooks/agent-vocal", async (req, res): Promise<void> => {
  const secret = process.env["ELEVENLABS_WEBHOOK_SECRET"];
  if (!secret) {
    // Configuration absente : on refuse tout plutôt que d'accepter tout. Un
    // webhook sans signature accepterait des transcriptions forgées.
    res.status(503).json({ error: "Webhook non configuré." });
    return;
  }

  const entete = req.headers["elevenlabs-signature"];
  if (!req.rawBody || !signatureValide(typeof entete === "string" ? entete : undefined, req.rawBody, secret)) {
    // Une seule réponse pour tous les rejets : signature absente, périmée ou
    // fausse. La différence n'instruirait qu'un attaquant.
    res.status(401).json({ error: "Signature invalide." });
    return;
  }

  const evenement = req.body as {
    type?: string;
    data?: {
      conversation_id?: string;
      transcript?: TourTranscript[];
      metadata?: { call_duration_secs?: number; cost?: number };
    };
  };

  // L'audio en base64 (post_call_audio) est ACQUITTÉ et jeté : le produit ne
  // conserve pas l'audio (§6 du ticket 4.18), et ne pas répondre 200 ferait
  // désactiver le webhook entier au bout de dix échecs.
  if (evenement.type !== "post_call_transcription") {
    res.status(200).json({ recu: true, traite: false });
    return;
  }

  const conversationId = evenement.data?.conversation_id;
  if (!conversationId) {
    res.status(200).json({ recu: true, traite: false });
    return;
  }

  const appel = await appelParConversation(conversationId);
  if (!appel) {
    // Inconnu chez nous : acquitté sans traitement. Un 4xx entrerait dans le
    // compteur d'échecs de la plateforme et finirait par couper le webhook —
    // pour des conversations qui ne nous concernent pas.
    res.status(200).json({ recu: true, traite: false });
    return;
  }

  const tours = evenement.data?.transcript ?? [];
  const transcription = tours
    .filter((t) => typeof t.message === "string" && t.message.trim().length > 0)
    .map((t) => `${t.role === "agent" ? "agent" : "client"} : ${t.message!.trim()}`)
    .join("\n");

  // Le nom du débiteur, pour l'audit d'identité : lu depuis la campagne, comme
  // partout — jamais depuis le corps du webhook.
  const identites = await withTenant(appel.tenantId, async (tx) => {
    const [campagne] = await tx
      .select({ appels: campagnesRelanceTable.appels })
      .from(campagnesRelanceTable)
      .where(eq(campagnesRelanceTable.id, appel.campagneId));
    const entrees = (campagne?.appels ?? []) as { factureId?: string; clientNom?: string }[];
    const nom = entrees.find((e) => e.factureId === appel.factureId)?.clientNom;
    return nom ? [nom] : [];
  });

  const repliquesAgent = tours
    .filter((t) => t.role === "agent" && typeof t.message === "string")
    .map((t) => t.message!.trim());
  const anomalies: AnomalieTranscript[] = auditerTranscription(repliquesAgent, identites);

  if (anomalies.length > 0) {
    // Les NATURES seules dans le journal — le détail vit en base, sur la ligne
    // de l'appel, où le dirigeant le lira. Règle 6 : pas de verbatim.
    logger.warn(
      { appelId: appel.appelId, natures: anomalies.map((a) => a.nature) },
      "[agent-vocal] l'audit du transcript a relevé des violations",
    );
  }

  const dureeSecondes = evenement.data?.metadata?.call_duration_secs ?? null;
  // Le champ `cost` de la plateforme est exprimé dans SON unité (crédits).
  // Conservé brut ×1000 pour ne pas perdre la décimale ; la conversion en
  // euros appartient au pricing v2, avec le taux du contrat — pas à ce webhook.
  const cout = evenement.data?.metadata?.cost;

  await withTenant(appel.tenantId, (tx) =>
    tx
      .update(appelsRelanceTable)
      .set({
        transcription: transcription || null,
        dureeSecondes,
        ...(typeof cout === "number" ? { coutMillicents: Math.round(cout * 1000) } : {}),
        auditTranscript: { anomalies, verifieLe: new Date().toISOString() },
        // L'issue posée par un tool PENDANT l'appel fait foi ; sans elle,
        // personne ne s'est engagé à rien : injoignable.
        ...(appel.issue ? {} : { issue: "unreachable" }),
        statut: "TERMINE",
        // Le jeton meurt avec l'appel — la policy l'exige déjà par le statut,
        // l'effacement rend la révocation vraie même si la policy s'élargit.
        jetonSha256: null,
        endedAt: new Date(),
      })
      .where(and(eq(appelsRelanceTable.tenantId, appel.tenantId), eq(appelsRelanceTable.id, appel.appelId))),
  );

  res.status(200).json({ recu: true, traite: true });
});
