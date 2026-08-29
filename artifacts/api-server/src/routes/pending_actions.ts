import { Router, type IRouter } from "express";
import { withTenant, pendingActionsTable, activityTable, journalDecisionsTable } from "@workspace/db";
import { TYPE_CAMPAGNE_RELANCE, validerCampagne, rejeterCampagne } from "../lib/campagnes-relance.js";
import { eq, desc } from "drizzle-orm";
import {
  ApprovePendingActionParams,
  RejectPendingActionParams,
} from "@workspace/api-zod";
import { executerPlan, planApplicable, TYPE_PLAN } from "../lib/plan-vocal.js";
import { executerRelanceDevis, TYPE_RELANCE_DEVIS } from "../lib/executer-relance-devis.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

router.get("/pending-actions", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const actions = await withTenant(tenantId, async (tx) =>
    tx.select().from(pendingActionsTable).orderBy(desc(pendingActionsTable.createdAt))
  );
  /*
   * ── NE PAS PROPOSER UN BOUTON QUI VA ÉCHOUER ────────────────────────────
   * Le Cockpit affichait « Approuver » sur tout plan en attente. Un plan
   * devenu inapplicable — expiré, cible disparue, facture entre-temps payée,
   * campagne de relance sans personne à appeler — ne se révélait qu'AU CLIC,
   * derrière « Impossible d'approuver cette action ».
   *
   * L'applicabilité est donc calculée par une SIMULATION : le vrai chemin
   * d'exécution, joué puis annulé (voir `planApplicable`). Pas une seconde
   * série de vérifications, qui finirait par diverger et annoncerait
   * « approuvable » ce que la validation refuse.
   *
   * Le coût est une transaction annulée par action affichée. Il est assumé :
   * la file d'attente d'un artisan compte quelques lignes, et un bouton qui
   * ment coûte plus cher qu'une transaction.
   *
   * Seuls les PLANS sont simulés. Les autres actions en attente suivent leur
   * propre chemin d'approbation, que cette route ne connaît pas.
   */
  const enrichies = await Promise.all(
    actions.map(async (a) => {
      if (a.type !== TYPE_PLAN) return { ...a, applicable: true, motifNonApplicable: null };
      const r = await planApplicable(tenantId, a.id);
      return {
        ...a,
        applicable: r.applicable,
        motifNonApplicable: r.applicable ? null : r.motif,
      };
    }),
  );

  res.json(enrichies);
});

router.post("/pending-actions/:id/approve", async (req, res): Promise<void> => {
  const params = ApprovePendingActionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const tenantId = req.tenantId!;

  const [avant] = await withTenant(tenantId, (tx) =>
    tx.select({ type: pendingActionsTable.type })
      .from(pendingActionsTable)
      .where(eq(pendingActionsTable.id, params.data.id)),
  );
  if (!avant) { res.status(404).json({ error: "Action not found" }); return; }

  // Un plan vocal ne se flippe pas : il s'EXÉCUTE. C'est executerPlan, seul,
  // qui écrit — /voix/executer et ce bouton doivent converger sur le même
  // chemin, pas en dupliquer un second qui ne fait que changer un statut
  // sans jamais écrire (c'était le bug : approuver depuis le cockpit ne
  // produisait aucune des opérations proposées par l'agent de chat).
  if (avant.type === TYPE_PLAN) {
    let resultat;
    try {
      resultat = await executerPlan(tenantId, params.data.id, {
        userId: req.session!.userId,
        email: req.session!.email,
      });
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : "erreur" },
        "[pending-actions] exécution impossible",
      );
      res.status(409).json({
        // Même correction que sur `/voix/executer` : la cause était connue au
        // mot près et jetée ici. Les refus levés par `executerPlan` sont
        // rédigés pour être lus ; une erreur inattendue ne l'est pas et reste
        // au journal.
        error:
          err instanceof Error && err.name === "Error"
            ? `${err.message}. Rien n'a été enregistré.`
            : "Une des opérations n'a pas pu être appliquée. Rien n'a été enregistré.",
      });
      return;
    }

    switch (resultat.kind) {
      case "introuvable":
        res.status(404).json({ error: "Action not found" });
        return;
      case "expire":
        res.status(410).json({
          error: "Ce plan a expiré. Redictez votre phrase — vos données ont pu changer entre-temps.",
        });
        return;
      case "deja_applique":
      case "ok": {
        const [action] = await withTenant(tenantId, (tx) =>
          tx.select().from(pendingActionsTable).where(eq(pendingActionsTable.id, params.data.id)),
        );
        res.json(action);
        return;
      }
    }
    return;
  }

  // Une relance de devis S'ENVOIE — elle ne change pas de statut en silence.
  //
  // C'était le défaut : la campagne rédigeait objet, corps et lien WhatsApp,
  // créait l'action, l'humain approuvait, et rien ne partait. `relance_devis`
  // n'était lu par personne dans tout le dépôt.
  //
  // L'envoi se fait AVANT l'écriture du statut et hors de sa transaction : un
  // appel réseau à l'opérateur ne doit pas tenir les verrous de la ligne.
  if (avant.type === TYPE_RELANCE_DEVIS) {
    const resultat = await executerRelanceDevis(tenantId, params.data.id);
    if (resultat.kind === "introuvable") {
      res.status(404).json({ error: "Action not found" });
      return;
    }
    if (resultat.kind === "deja_execute") {
      // 409 et non 200 : rejouer une approbation n'est pas anodin ici, même
      // si rien n'est renvoyé une seconde fois. L'appelant doit le savoir.
      res.status(409).json({ error: "Cette relance a déjà été envoyée." });
      return;
    }
  }

  // Chemin commun : écriture du statut, du journal et des effets propres à
  // certains types. Il suit l'envoi ci-dessus plutôt que de le remplacer —
  // une relance envoyée doit aussi être tracée comme approuvée.
  //
  // (Ce commentaire affirmait autrefois que `TYPE_PLAN` était « le seul type
  // jamais inséré dans pending_actions ». C'était faux : `relance_devis` et
  // `campagne_relance` le sont aussi, le second étant traité dix lignes plus
  // bas dans cette même fonction.)
  const action = await withTenant(tenantId, async (tx) => {
    const [action] = await tx
      .update(pendingActionsTable)
      .set({ status: "APPROUVE", decidedAt: new Date() })
      .where(eq(pendingActionsTable.id, params.data.id))
      .returning();
    if (!action) return null;
    await tx.insert(activityTable).values({
      tenantId,
      type: "action_approved",
      label: `Action approuvée : ${action.label}`,
      meta: null,
    });
    // US-A6.4 — même transaction que la décision.
    await tx.insert(journalDecisionsTable).values({
      tenantId,
      actionId: action.id,
      actionType: action.type,
      actionLabel: action.label,
      actionPayload: action.payload,
      decision: "APPROUVEE",
      decideePar: req.session!.userId,
      decideeParEmail: req.session!.email,
    });
    // Ticket 4.18 US-1 — le mandat de la campagne est GELÉ ici, contre la
    // règle en vigueur, dans la MÊME transaction que la décision : une
    // campagne approuvée dont le mandat n'aurait pas été figé serait un agent
    // sans limites écrites.
    if (action.type === TYPE_CAMPAGNE_RELANCE) {
      await validerCampagne(tx, tenantId, action.id, req.session!.email);
    }
    return action;
  });

  if (!action) { res.status(404).json({ error: "Action not found" }); return; }
  res.json(action);
});

router.post("/pending-actions/:id/reject", async (req, res): Promise<void> => {
  const params = RejectPendingActionParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const tenantId = req.tenantId!;

  const [action] = await withTenant(tenantId, async (tx) => {
    const lignes = await tx.update(pendingActionsTable)
      .set({ status: "REJETE", decidedAt: new Date() })
      .where(eq(pendingActionsTable.id, params.data.id))
      .returning();
    const rejetee = lignes[0];
    // US-A6.4 — un rejet est une décision : il se prouve autant qu'une
    // approbation. Journalisé dans la même transaction.
    if (rejetee) {
      await tx.insert(journalDecisionsTable).values({
        tenantId,
        actionId: rejetee.id,
        actionType: rejetee.type,
        actionLabel: rejetee.label,
        actionPayload: rejetee.payload,
        decision: "REJETEE",
        decideePar: req.session!.userId,
        decideeParEmail: req.session!.email,
      });
      // La campagne suit le sort de son action : laissée « PROPOSEE », elle
      // resterait éligible à une exécution alors que le dirigeant a dit non.
      if (rejetee.type === TYPE_CAMPAGNE_RELANCE) {
        await rejeterCampagne(tx, tenantId, rejetee.id);
      }
    }
    return lignes;
  });
  if (!action) { res.status(404).json({ error: "Action not found" }); return; }
  res.json(action);
});

export default router;
