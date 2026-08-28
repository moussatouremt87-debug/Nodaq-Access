/**
 * Exécuter une relance de devis approuvée — ticket « la relance envoie enfin ».
 *
 * ── LE DÉFAUT CORRIGÉ ─────────────────────────────────────────────────────
 * `relance_devis` était inséré dans `pending_actions` par
 * `routes/relance-commerciale.ts` et n'était lu par PERSONNE. La campagne
 * examinait les devis, rédigeait objet, corps et lien WhatsApp, créait
 * l'action à valider — et l'approbation se contentait de passer le statut à
 * `APPROUVE`. Aucun message ne partait. Ni e-mail, ni WhatsApp.
 *
 * Le commentaire de `routes/pending_actions.ts` affirmait d'ailleurs que
 * `TYPE_PLAN` était « le seul type jamais inséré dans pending_actions », ce
 * que deux `insert` du dépôt démentaient — dont un cité trois lignes plus bas
 * dans la même fonction. Corrigé avec ce ticket.
 *
 * ── AU PLUS UNE FOIS, JAMAIS DEUX ─────────────────────────────────────────
 * On RÉSERVE l'action avant d'envoyer (`execute_le` posé sous condition qu'il
 * soit nul), puis on envoie hors transaction, puis on consigne le résultat.
 *
 * Ce n'est pas gratuit : si l'envoi échoue après la réservation, il ne sera
 * pas rejoué automatiquement. C'est le compromis VOULU. Un message de
 * relance envoyé deux fois à un client est une faute visible qui abîme la
 * relation ; un message non parti se voit dans le journal et se renvoie d'un
 * geste. Entre les deux, on choisit celui qui se rattrape.
 *
 * Et l'envoi ne se fait PAS dans la transaction : un appel réseau y
 * tiendrait les verrous de la ligne pendant toute la latence de l'opérateur.
 */

import { eq, and, isNull } from "drizzle-orm";
import { withTenant, pendingActionsTable, activityTable } from "@workspace/db";
import { sendDocument } from "./canal-emission.js";
import { envoyerWhatsApp } from "./whatsapp.js";
import { logger } from "./logger.js";

/**
 * Le type d'action. Déclaré ICI et non dans la route qui l'insère : la route
 * d'approbation en a besoin, et une route qui importe une autre route pour
 * une constante finit par créer un cycle.
 */
export const TYPE_RELANCE_DEVIS = "relance_devis";

/**
 * La charge utile figée par la campagne. Tous les champs sont optionnels :
 * les actions créées AVANT ce ticket n'en portent que trois, et une action
 * déjà en file ne doit pas faire échouer l'approbation.
 */
export interface PayloadRelanceDevis {
  devisId?: string;
  objet?: string;
  corps?: string;
  destinataireEmail?: string | null;
  numeroWhatsApp?: string | null;
  texteWhatsApp?: string | null;
}

export type ResultatCanal =
  | { canal: "email"; etat: "envoye" | "echec" | "sans_destinataire"; detail?: string }
  | { canal: "whatsapp"; etat: "envoye" | "echec" | "sans_destinataire" | "non_configure"; detail?: string };

export type ResultatRelance =
  | { kind: "introuvable" }
  | { kind: "deja_execute" }
  | { kind: "execute"; canaux: ResultatCanal[] };

/** Le libellé lisible d'un résultat — c'est lui que l'artisan lira. */
function resumer(canaux: ResultatCanal[]): string {
  const partis = canaux.filter((c) => c.etat === "envoye").map((c) => c.canal);
  if (partis.length === 0) return "Aucun message n'a pu partir";
  if (partis.length === canaux.filter((c) => c.etat !== "sans_destinataire").length) {
    return `Relance envoyée par ${partis.join(" et ")}`;
  }
  return `Relance envoyée par ${partis.join(" et ")} — les autres canaux ont échoué`;
}

export async function executerRelanceDevis(
  tenantId: string,
  actionId: string,
): Promise<ResultatRelance> {
  // ── 1. Réserver ─────────────────────────────────────────────────────────
  // `isNull(execute_le)` dans le WHERE : deux approbations concurrentes ne
  // peuvent pas réserver la même action. Celle qui perd ne rend aucune ligne.
  const [reservee] = await withTenant(tenantId, (tx) =>
    tx
      .update(pendingActionsTable)
      .set({ executeLe: new Date() })
      .where(
        and(eq(pendingActionsTable.id, actionId), isNull(pendingActionsTable.executeLe)),
      )
      .returning({ payload: pendingActionsTable.payload, label: pendingActionsTable.label }),
  );

  if (!reservee) {
    // Soit l'action n'existe pas, soit elle était déjà partie. On distingue,
    // parce que la réponse HTTP n'est pas la même.
    const [existe] = await withTenant(tenantId, (tx) =>
      tx
        .select({ id: pendingActionsTable.id })
        .from(pendingActionsTable)
        .where(eq(pendingActionsTable.id, actionId)),
    );
    return existe ? { kind: "deja_execute" } : { kind: "introuvable" };
  }

  const payload = (reservee.payload ?? {}) as PayloadRelanceDevis;
  const canaux: ResultatCanal[] = [];

  // ── 2. Envoyer, hors transaction ────────────────────────────────────────
  if (payload.destinataireEmail && payload.objet && payload.corps) {
    try {
      const resultat = await sendDocument({
        canal: "EMAIL",
        tenantId,
        to: payload.destinataireEmail,
        subject: payload.objet,
        body: payload.corps,
        documentType: "DEVIS",
        ...(payload.devisId ? { documentId: payload.devisId } : {}),
      });
      canaux.push(
        resultat.success
          ? { canal: "email", etat: "envoye" }
          : { canal: "email", etat: "echec", detail: resultat.error ?? "envoi refusé" },
      );
    } catch (err) {
      // RÈGLE 6 : le message d'erreur seul, jamais l'adresse ni le corps.
      logger.error(
        { err: err instanceof Error ? err.message : "erreur" },
        "[relance-devis] e-mail impossible",
      );
      canaux.push({ canal: "email", etat: "echec", detail: "erreur d'envoi" });
    }
  } else {
    canaux.push({ canal: "email", etat: "sans_destinataire" });
  }

  if (payload.numeroWhatsApp && payload.texteWhatsApp) {
    try {
      const resultat = await envoyerWhatsApp(payload.numeroWhatsApp, payload.texteWhatsApp);
      switch (resultat.kind) {
        case "envoye":
          canaux.push({ canal: "whatsapp", etat: "envoye" });
          break;
        case "non_configure":
          canaux.push({ canal: "whatsapp", etat: "non_configure" });
          break;
        case "numero_inexploitable":
          canaux.push({ canal: "whatsapp", etat: "sans_destinataire" });
          break;
        case "refuse_operateur":
          canaux.push({
            canal: "whatsapp",
            etat: "echec",
            detail: `refus de l'opérateur (${resultat.status})`,
          });
          break;
      }
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : "erreur" },
        "[relance-devis] WhatsApp impossible",
      );
      canaux.push({ canal: "whatsapp", etat: "echec", detail: "erreur d'envoi" });
    }
  } else {
    canaux.push({ canal: "whatsapp", etat: "sans_destinataire" });
  }

  // ── 3. Consigner ────────────────────────────────────────────────────────
  // Le résultat est écrit MÊME quand tout a échoué : une relance qui n'est
  // pas partie doit se voir, sinon l'artisan croit avoir relancé.
  await withTenant(tenantId, (tx) =>
    tx.insert(activityTable).values({
      tenantId,
      type: "relance_devis.envoyee",
      label: `${resumer(canaux)} — ${reservee.label}`,
      meta: JSON.stringify({ actionId, canaux }),
    }),
  );

  return { kind: "execute", canaux };
}
