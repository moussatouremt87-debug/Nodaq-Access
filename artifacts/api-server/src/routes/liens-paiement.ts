/**
 * Les liens de paiement, côté dirigeant — ticket 4.19, lot E.
 *
 * Le lot B a émis les liens, le lot D encaisse leur retour, et le code
 * promettait déjà que « le dirigeant peut renvoyer le lien depuis le
 * cockpit ». Personne ne tenait cette promesse : rien ne les affichait. Ce
 * module la tient.
 *
 * ── Renvoyer, ce n'est pas ré-émettre ─────────────────────────────────────
 * Le renvoi réexpédie le SMS avec l'URL DÉJÀ créée. Il ne crée pas un second
 * lien chez Bridge : deux liens vivants pour la même facture, c'est un risque
 * de double règlement, et c'est le débiteur qui le paierait. Un lien réglé,
 * expiré ou en échec ne se renvoie donc pas — il faut en émettre un nouveau.
 *
 * ── Ce que la liste ne ramène pas ─────────────────────────────────────────
 * L'empreinte du numéro. Elle sert au rapprochement interne et à l'effacement,
 * elle n'a rien à faire dans une réponse JSON lue par un navigateur.
 */
import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import {
  withTenant,
  liensPaiementTable,
  appelsRelanceTable,
  campagnesRelanceTable,
} from "@workspace/db";
import { envoyerSms, texteSmsLienPaiement } from "../lib/sms.js";
import { loadCompanySettings } from "../lib/seller-info.js";
import { numeroAutoriseEnTest } from "../lib/numeros-test.js";
import { logger } from "../lib/logger.js";

export const liensPaiementReadRouter: IRouter = Router();
export const liensPaiementWriteRouter: IRouter = Router();

/** Les 50 derniers liens du tenant. Projection explicite, jamais `select()`. */
liensPaiementReadRouter.get("/relance/liens-paiement", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const lignes = await withTenant(tenantId, (tx) =>
    tx
      .select({
        id: liensPaiementTable.id,
        factureId: liensPaiementTable.factureId,
        montantCents: liensPaiementTable.montantCents,
        statut: liensPaiementTable.statut,
        url: liensPaiementTable.url,
        expireLe: liensPaiementTable.expireLe,
        payeLe: liensPaiementTable.payeLe,
        createdAt: liensPaiementTable.createdAt,
      })
      .from(liensPaiementTable)
      .orderBy(desc(liensPaiementTable.createdAt))
      .limit(50),
  );
  res.json({ liens: lignes });
});

/**
 * Renvoyer le SMS d'un lien encore vivant.
 *
 * Le numéro est relu depuis l'entrée de campagne de l'appel d'origine — jamais
 * reçu dans le corps. Même règle que partout : un destinataire fourni par
 * l'appelant est un SMS envoyé à n'importe qui.
 */
liensPaiementWriteRouter.post(
  "/relance/liens-paiement/:id/renvoyer",
  async (req, res): Promise<void> => {
    const tenantId = req.tenantId!;
    const id = String(req.params["id"] ?? "");
    if (!id) {
      res.status(400).json({ error: "Identifiant manquant." });
      return;
    }

    const contexte = await withTenant(tenantId, async (tx) => {
      const [lien] = await tx
        .select({
          id: liensPaiementTable.id,
          appelId: liensPaiementTable.appelId,
          factureId: liensPaiementTable.factureId,
          montantCents: liensPaiementTable.montantCents,
          statut: liensPaiementTable.statut,
          url: liensPaiementTable.url,
        })
        .from(liensPaiementTable)
        .where(eq(liensPaiementTable.id, id));
      if (!lien?.appelId) return { lien: lien ?? null, numero: null };

      const [appel] = await tx
        .select({ campagneId: appelsRelanceTable.campagneId })
        .from(appelsRelanceTable)
        .where(eq(appelsRelanceTable.id, lien.appelId));
      if (!appel) return { lien, numero: null };

      const [campagne] = await tx
        .select({ appels: campagnesRelanceTable.appels })
        .from(campagnesRelanceTable)
        .where(eq(campagnesRelanceTable.id, appel.campagneId));

      const entrees = (campagne?.appels ?? []) as { factureId?: string; numero?: string }[];
      return { lien, numero: entrees.find((e) => e.factureId === lien.factureId)?.numero ?? null };
    });

    if (!contexte.lien) {
      res.status(404).json({ error: "Lien introuvable." });
      return;
    }
    if (contexte.lien.statut !== "EMIS" || !contexte.lien.url) {
      // Un lien réglé, expiré, révoqué ou en échec ne se renvoie pas : il
      // faudrait en émettre un nouveau, et c'est une autre décision.
      res.status(409).json({
        error: "Ce lien n'est plus actif. Émettez-en un nouveau depuis un appel.",
      });
      return;
    }
    if (!contexte.numero) {
      res.status(409).json({ error: "Le numéro d'origine n'est plus disponible." });
      return;
    }
    if (!numeroAutoriseEnTest(contexte.numero)) {
      res.status(403).json({ error: "Ce numéro n'est pas dans la liste de test." });
      return;
    }

    const reglages = await loadCompanySettings(tenantId);
    const raisonSociale = (reglages["company.raison_sociale"] as string | undefined)?.trim();
    if (!raisonSociale) {
      res.status(409).json({ error: "La raison sociale n'est pas renseignée." });
      return;
    }

    const montant = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(
      contexte.lien.montantCents / 100,
    );
    const sms = await envoyerSms(
      contexte.numero,
      texteSmsLienPaiement(raisonSociale, montant, contexte.lien.url),
    );

    if (sms.kind !== "envoye") {
      // Code seul : ni numéro, ni corps du message (règle 6).
      logger.error({ resultat: sms.kind }, "[lien-paiement] renvoi impossible");
      res.status(502).json({ error: "L'envoi n'a pas abouti. Réessayez dans un moment." });
      return;
    }

    res.json({ renvoye: true });
  },
);
