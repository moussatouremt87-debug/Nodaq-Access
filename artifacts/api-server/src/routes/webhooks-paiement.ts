/**
 * POST /webhooks/paiement — retour de Bridge sur un lien de paiement (4.19).
 *
 * C'est ici que « oui oui je vais payer » devient un fait vérifiable : le
 * seul endroit du produit où un encaissement s'écrit sans qu'un humain le
 * saisisse. D'où trois exigences, dans cet ordre.
 *
 * 1. SIGNATURE D'ABORD. Vérifiée sur le corps BRUT, avant toute lecture en
 *    base. Un webhook de paiement non authentifié, c'est un inconnu qui
 *    déclare des règlements dans la comptabilité d'un artisan.
 *
 * 2. LE TENANT VIENT DE LA LIGNE. Le payload ne porte que notre propre
 *    référence (`payment_link_client_reference` = l'identifiant de la ligne
 *    `liens_paiement`, envoyé au lot B). Policy étroite `liens_paiement_
 *    webhook_lookup` (migration 048), quatrième usage du patron œuf-et-poule ;
 *    le tenant est LU depuis la ligne, jamais reçu.
 *
 * 3. IDEMPOTENCE PAR LE MOTEUR. Bridge rejoue, et `paiements` est append-only :
 *    un doublon y écrirait un second encaissement qui n'a jamais eu lieu.
 *    L'index unique sur `bridge_transaction_id` le refuse — une garantie du
 *    moteur, pas une intention du code.
 *
 * ── Ce qu'on n'écrit PAS ──────────────────────────────────────────────────
 * L'issue de l'appel n'est pas touchée. `ISSUES_APPEL` ne contient que
 * `paid_claimed` — « la personne DIT avoir payé » — et un virement confirmé
 * est plus fort que ça : le dégrader en « déclaré » serait mentir dans l'autre
 * sens. La vérité de l'encaissement vit dans `paiements`, qui est la table
 * comptable ; l'appel garde l'issue de la CONVERSATION, qui est ce qu'il
 * décrit.
 *
 * RÈGLE 6 : ni montant, ni référence, ni identifiant de transaction ne sont
 * journalisés. Le journal ne porte que le type d'événement et l'issue.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, withTenant, liensPaiementTable, paiementsTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { secretWebhookPaiement, verifierSignatureWebhook } from "@nodaq/banque-agreee";
import { toDateString } from "@nodaq/shared";
import { logger } from "../lib/logger.js";

export const paiementWebhookRouter: IRouter = Router();

/**
 * Les trois événements de paiement de Bridge (doc vérifiée le 2026-08-20).
 * Les champs sont TOUS optionnels côté schéma : la forme varie selon le type,
 * et un webhook refusé en 400 est un webhook que Bridge rejoue en boucle.
 */
const EvenementPaiement = z.object({
  type: z.string(),
  content: z
    .object({
      payment_link_id: z.string().optional(),
      payment_link_status: z.string().optional(),
      payment_link_client_reference: z.string().optional(),
      payment_status: z.string().optional(),
      payment_transaction_id: z.string().optional(),
      client_reference: z.string().optional(),
      status: z.string().optional(),
    })
    .passthrough(),
});

/** Le lien désigné par NOTRE référence, résolu par la policy étroite. */
async function resoudreLien(reference: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.paiement_lien_id', ${reference}, true)`);
    const [ligne] = await tx
      .select({
        id: liensPaiementTable.id,
        tenantId: liensPaiementTable.tenantId,
        factureId: liensPaiementTable.factureId,
        clientId: liensPaiementTable.clientId,
        montantCents: liensPaiementTable.montantCents,
        statut: liensPaiementTable.statut,
      })
      .from(liensPaiementTable)
      .where(eq(liensPaiementTable.id, reference));
    return ligne ?? null;
  });
}

paiementWebhookRouter.post("/webhooks/paiement", async (req, res): Promise<void> => {
  const secret = secretWebhookPaiement();
  if (!secret) {
    res.status(503).json({ error: "Non configuré." });
    return;
  }

  if (
    !req.rawBody ||
    !verifierSignatureWebhook(req.rawBody, req.headers as Record<string, string>, secret)
  ) {
    // Un seul corps pour tous les rejets : distinguer « mal signé » de
    // « inconnu » renseignerait qui sonde.
    res.status(401).json({ error: "Non autorisé." });
    return;
  }

  const parsed = EvenementPaiement.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Corps invalide." });
    return;
  }
  const { type, content } = parsed.data;

  // Seul `payment.link.updated` en état terminal nous intéresse. Les autres
  // sont accusés en 200 : un webhook qui répond en erreur est un webhook que
  // Bridge rejoue, puis désactive.
  if (type !== "payment.link.updated") {
    res.json({ traite: false });
    return;
  }

  const reference = content.payment_link_client_reference ?? content.client_reference;
  if (!reference) {
    res.json({ traite: false });
    return;
  }

  const lien = await resoudreLien(reference);
  if (!lien) {
    // Référence inconnue : accusée sans rien dire de plus. Un 404 confirmerait
    // à un tiers qu'une référence donnée n'existe pas chez nous.
    res.json({ traite: false });
    return;
  }

  const paye =
    content.payment_link_status === "completed" ||
    content.payment_status === "initiated_in_success";

  if (!paye) {
    // Le lien vit encore (ou a expiré côté Bridge) : rien à écrire tant que
    // l'argent n'est pas parti. Un lien « en cours » n'est pas un encaissement.
    logger.info({ type }, "[paiement] lien non terminal");
    res.json({ traite: false });
    return;
  }

  if (lien.statut === "PAYE") {
    // Rejeu : déjà encaissé. Rien à écrire, et surtout pas une seconde ligne
    // dans `paiements`.
    res.json({ traite: true, deja: true });
    return;
  }

  const transactionId = content.payment_transaction_id ?? content.payment_link_id ?? reference;

  try {
    await withTenant(lien.tenantId, async (tx) => {
      // L'écriture comptable et le marquage du lien dans la MÊME transaction :
      // un encaissement enregistré sans que le lien passe en PAYE se ferait
      // ré-encaisser au rejeu suivant.
      await tx.insert(paiementsTable).values({
        tenantId: lien.tenantId,
        clientId: lien.clientId,
        factureId: lien.factureId,
        date: toDateString(new Date()),
        montantCents: lien.montantCents,
        sens: "ENCAISSEMENT",
        moyen: "VIREMENT",
        nature: "SOLDE",
        reference: `lien-paiement:${lien.id}`,
      });

      await tx
        .update(liensPaiementTable)
        .set({ statut: "PAYE", payeLe: new Date(), bridgeTransactionId: transactionId })
        .where(eq(liensPaiementTable.id, lien.id));
    });
  } catch (err) {
    // L'index unique sur `bridge_transaction_id` a refusé : c'est un rejeu
    // concurrent, pas une panne. On accuse réception — réessayer produirait
    // le même refus.
    const code = (err as { code?: string }).code;
    if (code === "23505") {
      res.json({ traite: true, deja: true });
      return;
    }
    throw err;
  }

  logger.info({ type }, "[paiement] encaissement enregistré");
  res.json({ traite: true });
});
