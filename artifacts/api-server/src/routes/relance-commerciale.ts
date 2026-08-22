/**
 * Relancer les devis restés sans réponse — ticket 4.33.
 *
 * ── Ce que cette route fait, et surtout ce qu'elle NE fait pas ────────────
 * Elle PROPOSE. Chaque devis retenu devient une `pending_action` à valider
 * d'un clic dans le cockpit — règle 4, sans exception. Relancer un client est
 * un geste commercial qui engage le nom de l'entreprise, pas une notification
 * qu'on déclenche en masse.
 *
 * Elle n'envoie donc aucun e-mail et n'ouvre aucun WhatsApp : elle prépare le
 * message et le lien, l'humain décide.
 *
 * ── Pourquoi elle réutilise la file existante ─────────────────────────────
 * Le groupe `relances` de `PENDING_ACTION_GROUPS` accueille déjà `send_dunning`
 * et `call_dunning`. Ouvrir une seconde file pour le commercial obligerait
 * l'utilisateur à regarder deux endroits pour la même question — « qu'est-ce
 * que je dois valider aujourd'hui ? ».
 */
import { Router, type IRouter } from "express";
import { and, eq, isNotNull } from "drizzle-orm";
import {
  withTenant,
  devisTable,
  clientsTable,
  pendingActionsTable,
  reglesRelanceTable,
  tenantsTable,
} from "@workspace/db";
import {
  decider,
  redigerRelance,
  toDateString,
  type DevisRelancable,
} from "@nodaq/shared";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

/** Le type d'action posé dans la file. Groupe `relances` du catalogue. */
export const TYPE_RELANCE_DEVIS = "relance_devis";

router.post("/relance/devis/proposer", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const aujourdhui = toDateString(new Date());

  const resultat = await withTenant(tenantId, async (tx) => {
    // La règle EN VIGUEUR, c'est-à-dire la version la plus haute. Le délai est
    // lu ici et non figé : le régler doit s'appliquer à la campagne suivante.
    const [regle] = await tx
      .select()
      .from(reglesRelanceTable)
      .orderBy(desc(reglesRelanceTable.version))
      .limit(1);
    const delaiJours = regle?.relanceDevisJours ?? 7;

    const lignes = await tx
      .select({
        id: devisTable.id,
        reference: devisTable.reference,
        clientName: devisTable.clientName,
        clientId: devisTable.clientId,
        status: devisTable.status,
        dateEnvoi: devisTable.dateEnvoi,
        validUntil: devisTable.validUntil,
        totalTTCCents: devisTable.totalTTCCents,
        derniereRelanceLe: devisTable.derniereRelanceLe,
      })
      .from(devisTable)
      .where(and(eq(devisTable.status, "ENVOYE"), isNotNull(devisTable.dateEnvoi)));

    const clients = await tx
      .select({ id: clientsTable.id, telephone: clientsTable.telephone })
      .from(clientsTable);
    const telephones = new Map(clients.map((c) => [c.id, c.telephone]));

    const candidats: DevisRelancable[] = lignes.map((d) => ({
      id: d.id,
      reference: d.reference,
      clientNom: d.clientName,
      clientTelephone: d.clientId ? (telephones.get(d.clientId) ?? null) : null,
      statut: d.status,
      // `dateEnvoi` est un timestamp en base ; la décision raisonne en JOURS
      // calendaires, comme tout ce dépôt dès qu'il s'agit d'une date métier.
      dateEnvoi: d.dateEnvoi ? toDateString(new Date(d.dateEnvoi)) : null,
      validUntil: d.validUntil,
      totalTTCCents: d.totalTTCCents,
      derniereRelance: d.derniereRelanceLe,
    }));

    const decisions = candidats.map((c) => decider(c, delaiJours, aujourdhui));
    const aRelancer = decisions.filter((d) => d.relancer);

    // Le nom qui SIGNE le message. Lu en base : la session ne le porte pas, et
    // un message signé « votre artisan » ferait douter de son authenticité.
    const [tenant] = await tx.select({ nom: tenantsTable.nom }).from(tenantsTable);
    const nomEntreprise = tenant?.nom ?? "Votre artisan";
    for (const d of aRelancer) {
      const message = redigerRelance(d.devis, d.joursSansReponse, nomEntreprise);
      await tx.insert(pendingActionsTable).values({
        tenantId,
        type: TYPE_RELANCE_DEVIS,
        label: `Relancer ${d.devis.clientNom} — devis ${d.devis.reference}`,
        description:
          `Sans réponse depuis ${d.joursSansReponse} jours.` +
          (message.lienWhatsApp ? "" : " Aucun numéro exploitable : e-mail seulement."),
        // Le message est FIGÉ ici, tel qu'il sera envoyé. Le recalculer à la
        // validation ferait valider un texte et en envoyer un autre — le
        // devis a pu changer entre-temps.
        payload: {
          devisId: d.devis.id,
          objet: message.objet,
          corps: message.corps,
          lienWhatsApp: message.lienWhatsApp,
          joursSansReponse: d.joursSansReponse,
        },
      });
      // Marqué TOUT DE SUITE : la proposition faite, le devis ne doit pas
      // ressortir à la prochaine campagne, même si l'humain n'a pas encore
      // tranché. Sinon la file se remplit de doublons.
      await tx
        .update(devisTable)
        .set({ derniereRelanceLe: aujourdhui })
        .where(eq(devisTable.id, d.devis.id));
    }

    return {
      delaiJours,
      examines: decisions.length,
      proposes: aRelancer.length,
      // Les écartés sont RENDUS avec leur motif : une campagne qui ne propose
      // rien doit pouvoir dire pourquoi, sinon elle passe pour cassée.
      ecartes: decisions
        .filter((d) => !d.relancer)
        .map((d) => ({ reference: d.devis.reference, motif: d.motif })),
    };
  });

  res.status(201).json(resultat);
});

export default router;
