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
 *    C'est la mise à jour conditionnelle (`WHERE statut <> 'PAYE'`) qui
 *    arbitre — atomique, donc juste même sur deux webhooks concurrents.
 *
 *    La première version de cette route s'en remettait à l'index unique sur
 *    `bridge_transaction_id`. Une injection a montré que c'était faux :
 *    réécrire une ligne avec la valeur qu'elle porte déjà ne viole aucune
 *    contrainte, et le doublon passait. L'index reste utile pour un AUTRE cas
 *    — deux liens distincts revendiquant la même transaction — mais il ne
 *    protège pas le rejeu.
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
import { sql, eq, and, ne } from "drizzle-orm";
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
    // Sortie rapide sur le rejeu le plus courant : elle évite d'ouvrir une
    // transaction pour rien. Ce n'est PAS la garde — la garde est le `WHERE`
    // ci-dessous, et l'épreuve le montre : retirer ce test-ci ne fait échouer
    // aucun test.
    res.json({ traite: true, deja: true });
    return;
  }

  const transactionId = content.payment_transaction_id ?? content.payment_link_id ?? reference;

  const encaisse = await withTenant(lien.tenantId, async (tx) => {
    // ── LA garde d'idempotence, tenue par le MOTEUR ────────────────────────
    // Le marquage passe EN PREMIER, conditionné à `statut <> 'PAYE'` : c'est
    // la mise à jour elle-même qui arbitre. Deux webhooks concurrents pour le
    // même lien ? Un seul verra une ligne modifiée, l'autre zéro, et il
    // n'écrira rien.
    const marques = await tx
      .update(liensPaiementTable)
      .set({ statut: "PAYE", payeLe: new Date(), bridgeTransactionId: transactionId })
      .where(and(eq(liensPaiementTable.id, lien.id), ne(liensPaiementTable.statut, "PAYE")))
      .returning({ id: liensPaiementTable.id });

    if (marques.length === 0) return false;

    // Même transaction : un encaissement écrit sans que le lien passe en PAYE
    // se ferait ré-encaisser au rejeu suivant.
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
    return true;
  });

  if (!encaisse) {
    res.json({ traite: true, deja: true });
    return;
  }

  logger.info({ type }, "[paiement] encaissement enregistré");
  res.json({ traite: true });
});
