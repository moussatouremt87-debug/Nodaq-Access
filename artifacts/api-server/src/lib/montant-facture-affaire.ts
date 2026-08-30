/**
 * Le montant FACTURÉ d'un chantier — dérivé, jamais tenu à jour.
 *
 * ── CE QUI A ÉTÉ CONSTATÉ ───────────────────────────────────────────────────
 *
 * Le 29/08/2026 : 136 706 € facturés sur quatre chantiers, et un écran Marge
 * qui affichait « 0,00 € », « marge non mesurée » et un tableau vide.
 *
 * La colonne `affaires.invoiced_amount_cents` existe, l'écran la lit, et RIEN
 * ne l'écrit — ni la facturation d'un devis, ni l'émission. Seule une saisie
 * manuelle sur chaque chantier la renseigne. L'écran filtrait donc sur un
 * champ toujours nul et se vidait entièrement.
 *
 * ── POURQUOI ON DÉRIVE PLUTÔT QUE D'ENTRETENIR ─────────────────────────────
 *
 * Le réflexe serait de mettre la colonne à jour à chaque écriture de facture.
 * Il faudrait alors y penser à la facturation d'un devis, à la création
 * directe, à l'émission, à l'avoir, à la suppression, à la modification des
 * lignes — et un seul oubli remet le compteur à faux, silencieusement. C'est
 * exactement ainsi qu'il est arrivé à zéro.
 *
 * Le montant facturé d'un chantier N'EST PAS une donnée : c'est la somme de
 * ses factures. On la calcule, elle ne peut plus dériver.
 *
 * ── LE REPLI SUR LA SAISIE MANUELLE ────────────────────────────────────────
 *
 * Un chantier repris d'un ancien logiciel n'a aucune facture DANS nodaq : sa
 * seule source est le montant saisi à la main. Le dériver à zéro effacerait le
 * passé de l'entreprise. Même raisonnement que le repli sur le TTC des
 * factures reprises, dans `productionVendue`.
 *
 * Dès qu'une facture existe, c'est elle qui fait foi : la saisie manuelle est
 * un repli, jamais une addition.
 */
import { sql } from "drizzle-orm";
import type { DrizzleTx } from "@workspace/db";
import { statutsCaSql } from "./chiffreAffaires.js";

/**
 * Somme HT facturée par chantier, pour le tenant courant.
 *
 * HT, et statuts du chiffre d'affaires : les mêmes règles que partout
 * ailleurs. Un brouillon n'a été envoyé à personne, et la TVA n'est pas un
 * produit.
 */
export async function montantFactureParAffaire(tx: DrizzleTx): Promise<Map<string, number>> {
  const lignes = await tx.execute(sql`
    SELECT affaire_id,
           coalesce(sum(CASE WHEN total_ht_cents > 0 THEN total_ht_cents ELSE amount_cents END), 0)::bigint AS ht
      FROM factures
     WHERE affaire_id IS NOT NULL
       AND statut IN (${statutsCaSql})
     GROUP BY affaire_id
  `);
  const par = new Map<string, number>();
  for (const r of lignes.rows as Array<{ affaire_id: string; ht: string | number }>) {
    par.set(r.affaire_id, Number(r.ht));
  }
  return par;
}

/**
 * Le montant facturé retenu pour un chantier : ses factures si elles existent,
 * sinon la saisie manuelle. `null` quand ni l'un ni l'autre — une absence,
 * jamais un zéro, car « 0 € facturé » et « rien n'est connu » ne se lisent pas
 * de la même façon.
 */
export function montantFactureAffaire(
  affaireId: string,
  parAffaire: ReadonlyMap<string, number>,
  saisieManuelleCents: number | null | undefined,
): number | null {
  const derive = parAffaire.get(affaireId);
  if (derive !== undefined) return derive;
  return saisieManuelleCents ?? null;
}
