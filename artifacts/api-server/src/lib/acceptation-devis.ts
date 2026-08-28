/**
 * Prévenir l'artisan qu'un client vient d'accepter son devis.
 *
 * ── LE DÉFAUT CORRIGÉ ─────────────────────────────────────────────────────
 * L'acceptation publique (`routes/public.ts`) écrivait QUATRE champs dans la
 * table des devis — statut, horodatage, signataire, adresse — et rien d'autre.
 * Pas d'entrée dans `activity`, pas d'e-mail, aucun signal.
 *
 * Un client signait, et l'artisan ne l'apprenait qu'en allant regarder la
 * liste de ses devis. C'est pourtant l'événement commercialement le plus
 * important du produit, et celui où le rappel doit être le plus rapide :
 * c'est au moment de la signature qu'on cale une date, pas trois jours après.
 *
 * Le reste du produit fait d'ailleurs l'inverse — un objectif franchi écrit
 * dans `activity`, une relance approuvée aussi.
 *
 * ── CE QUE CE MODULE NE FAIT PAS ──────────────────────────────────────────
 * Il ne crée AUCUNE affaire. Accepter est l'acte du CLIENT ; ouvrir un
 * chantier est la décision de l'ARTISAN, qui regarde son planning, sa
 * capacité et ses approvisionnements avant d'engager. `POST /devis/:id/convert`
 * reste sa main. On le prévient au bon moment, on ne décide pas pour lui.
 */

import { and, eq } from "drizzle-orm";
import { db, withTenant, activityTable, membershipsTable, usersTable } from "@workspace/db";
import { sendDocument } from "./canal-emission.js";
import { logger } from "./logger.js";

/** Le type de la transaction, dérivé comme partout ailleurs dans ce dossier :
 *  `@workspace/db` ne l'exporte pas. */
type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/** Ce qu'il faut savoir du devis accepté pour l'annoncer. */
export interface DevisAccepte {
  readonly id: string;
  readonly reference: string;
  readonly clientName: string;
  readonly totalTTCCents: number;
  readonly signataire: string;
}

function montant(cents: number): string {
  return `${(cents / 100).toFixed(2)} €`;
}

/**
 * L'entrée du fil d'activité, écrite DANS la transaction de l'acceptation.
 *
 * Même transaction et pas après : un devis signé sans trace est précisément
 * ce qu'on corrige. Si l'écriture de la trace échoue, l'acceptation échoue
 * aussi, et le client la refait — ce qui est préférable à une signature
 * silencieuse.
 */
export function journaliserAcceptation(
  tx: Tx,
  tenantId: string,
  devis: DevisAccepte,
): Promise<unknown> {
  return tx.insert(activityTable).values({
    tenantId,
    type: "devis.accepte",
    label:
      `${devis.signataire} a accepté le devis ${devis.reference} ` +
      `(${devis.clientName}) — ${montant(devis.totalTTCCents)} TTC`,
    meta: JSON.stringify({ devisId: devis.id, reference: devis.reference }),
  });
}

/** Les adresses des propriétaires du tenant. */
async function emailsProprietaires(tenantId: string): Promise<string[]> {
  const lignes = await db
    .select({ email: usersTable.email })
    .from(membershipsTable)
    .innerJoin(usersTable, eq(usersTable.id, membershipsTable.userId))
    .where(and(eq(membershipsTable.tenantId, tenantId), eq(membershipsTable.role, "OWNER")));
  return lignes.map((l) => l.email);
}

/**
 * L'e-mail d'annonce, envoyé HORS transaction.
 *
 * Un appel réseau dans la transaction de l'acceptation tiendrait les verrous
 * de la ligne pendant toute la latence du fournisseur — et le client, lui,
 * attend sa confirmation à l'écran.
 *
 * NE LÈVE JAMAIS. L'acceptation est l'acte du client : elle est écrite,
 * horodatée, et ne se rejoue pas. Un échec de notification ne doit ni la
 * défaire ni faire échouer sa réponse. Il est journalisé — code HTTP seul,
 * jamais l'adresse ni le corps (règle 6).
 *
 * UN MESSAGE PAR PROPRIÉTAIRE, et non un seul en copie : mettre plusieurs
 * adresses dans le même `to` révélerait à chaque associé l'adresse des
 * autres, ce qui n'est pas à nous d'en décider.
 */
export async function previenirAcceptation(
  tenantId: string,
  devis: DevisAccepte,
  lienApp: string,
): Promise<void> {
  let destinataires: string[];
  try {
    destinataires = await emailsProprietaires(tenantId);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : "erreur" },
      "[acceptation] destinataires introuvables",
    );
    return;
  }

  const objet = `${devis.clientName} a accepté le devis ${devis.reference}`;
  const corps = [
    `Bonjour,`,
    ``,
    `${devis.signataire} vient d'accepter le devis ${devis.reference} pour ${devis.clientName},`,
    `d'un montant de ${montant(devis.totalTTCCents)} TTC.`,
    ``,
    `Vous pouvez le convertir en affaire depuis votre liste de devis :`,
    lienApp,
    ``,
    `C'est le bon moment pour rappeler et caler une date.`,
    ``,
    `NODAQ`,
  ].join("\n");

  for (const destinataire of destinataires) {
    try {
      const envoi = await sendDocument({
        canal: "EMAIL",
        tenantId,
        to: destinataire,
        subject: objet,
        body: corps,
        documentType: "DEVIS",
        documentId: devis.id,
      });
      if (!envoi.success) {
        logger.warn({ motif: envoi.error }, "[acceptation] annonce non partie");
      }
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : "erreur" },
        "[acceptation] annonce impossible",
      );
    }
  }
}
