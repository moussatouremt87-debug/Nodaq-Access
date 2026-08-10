/**
 * L'état de règlement d'une facture — RECALCULÉ, jamais posé à la main.
 *
 * ── Pourquoi un module et non deux morceaux de route ────────────────────────
 * `POST /paiements` et `POST /factures/:id/payer` écrivent le MÊME fait. Deux
 * façons d'écrire le même fait, ce sont deux façons de le rendre faux : l'une
 * finit par oublier une règle que l'autre applique. Il n'y a donc qu'un seul
 * calcul, ici, et les deux routes y passent.
 *
 * ── La règle ────────────────────────────────────────────────────────────────
 *   reste dû = amount_cents − Σ(encaissements) + Σ(remboursements)
 *   PAYEE et settled = true UNIQUEMENT quand le reste dû tombe à zéro ou moins.
 *
 * Un encaissement partiel laisse la facture EMISE. C'est tout l'objet du lot :
 * un artisan qui encaisse 3 000 € sur 10 000 € n'avait aucun moyen de l'écrire,
 * et le booléen « soldée » basculait la facture en entier.
 *
 * ── Ce qui n'est PAS touché ─────────────────────────────────────────────────
 * Une facture ANNULEE_PAR_AVOIR garde son statut : un règlement reçu après
 * annulation ne la ressuscite pas. Un BROUILLON non plus — il n'a rien à
 * encaisser.
 */
import { and, eq, sql } from "drizzle-orm";
import { facturesTable, paiementsTable } from "@workspace/db";

type Tx = Parameters<Parameters<typeof import("@workspace/db").withTenant>[1]>[0];

export interface EtatReglement {
  readonly encaisseCents: number;
  readonly resteDuCents: number;
  readonly soldee: boolean;
}

/** Somme nette des paiements rattachés à une facture, en centimes. */
export async function encaisseSurFacture(tx: Tx, factureId: string): Promise<number> {
  const res = await tx.execute(sql`
    SELECT coalesce(sum(
      CASE WHEN sens = 'ENCAISSEMENT' THEN montant_cents ELSE -montant_cents END
    ), 0)::int AS total
    FROM paiements
    WHERE facture_id = ${factureId}
  `);
  const rows = (res as unknown as { rows: Array<{ total: number }> }).rows;
  return rows[0]?.total ?? 0;
}

/**
 * Recalcule et écrit l'état de la facture. À appeler DANS la transaction qui
 * vient d'insérer le paiement, pour qu'un échec n'en laisse aucune moitié.
 */
export async function recalculerFacture(tx: Tx, factureId: string): Promise<EtatReglement | null> {
  const [facture] = await tx
    .select()
    .from(facturesTable)
    .where(eq(facturesTable.id, factureId));
  if (!facture) return null;

  const encaisseCents = await encaisseSurFacture(tx, factureId);
  const resteDuCents = Math.round(facture.amountCents - encaisseCents);
  const soldee = resteDuCents <= 0;

  // Les statuts qu'un règlement n'a pas à modifier. Une facture annulée par
  // avoir ne redevient pas payable parce qu'un virement est arrivé.
  const statutFige = facture.statut === "ANNULEE_PAR_AVOIR" || facture.statut === "BROUILLON";

  await tx
    .update(facturesTable)
    .set({
      residualCents: Math.max(0, resteDuCents),
      ...(statutFige ? {} : { statut: soldee ? "PAYEE" : "EMISE", settled: soldee }),
    })
    .where(and(eq(facturesTable.id, factureId)));

  return { encaisseCents, resteDuCents, soldee };
}
