/**
 * Campagnes de relance vocale — ticket 4.18, US-1.
 *
 * Deux moments, et le second est le seul qui engage :
 *
 *   PROPOSITION — la campagne est créée avec le mandat DEMANDÉ, et une
 *   `pending_action` la met dans la file de validation du cockpit. Rien ne
 *   part.
 *
 *   VALIDATION — le mandat est recalculé contre la règle EN VIGUEUR, puis
 *   GELÉ avec le numéro de version qui l'a produit. C'est ce que l'US-1
 *   demande : « le mandat effectif est figé au moment de l'approbation — le
 *   modifier ensuite exige une nouvelle validation ».
 *
 * Le recalcul à la validation, et non à la proposition, n'est pas un détail :
 * entre les deux, le dirigeant a pu resserrer sa règle. Figer la demande
 * telle quelle laisserait partir des appels sous un mandat que la règle
 * n'autorise plus.
 */
import { and, desc, eq } from "drizzle-orm";
import {
  withTenant,
  campagnesRelanceTable,
  reglesRelanceTable,
  type DrizzleTx,
} from "@workspace/db";
import {
  REGLE_RELANCE_DEFAUT,
  restreindreMandat,
  type MandatCampagne,
  type RegleRelance,
} from "@nodaq/shared";

/** Le type de `pending_action` qui porte une campagne d'appels de relance. */
export const TYPE_CAMPAGNE_RELANCE = "call_dunning";

interface RegleEnVigueur {
  readonly regle: RegleRelance;
  /** 0 = aucune version posée, le défaut prudent s'applique. */
  readonly version: number;
}

/**
 * La règle du tenant au moment où on regarde, dans la transaction courante.
 *
 * Lue DANS la transaction de validation, délibérément : lire avant ouvrirait
 * une fenêtre pendant laquelle un propriétaire pourrait resserrer la règle sans
 * que la campagne en cours de validation en tienne compte.
 */
export async function regleEnVigueur(tx: DrizzleTx, tenantId: string): Promise<RegleEnVigueur> {
  const [ligne] = await tx
    .select()
    .from(reglesRelanceTable)
    .where(eq(reglesRelanceTable.tenantId, tenantId))
    .orderBy(desc(reglesRelanceTable.version))
    .limit(1);

  if (!ligne) return { regle: REGLE_RELANCE_DEFAUT, version: 0 };

  return {
    version: ligne.version,
    regle: {
      echelonnementAutorise: ligne.echelonnementAutorise,
      maxVersements: ligne.maxVersements,
      delaiMaxPremierVersementJours: ligne.delaiMaxPremierVersementJours,
      retardMaxJours: ligne.retardMaxJours,
      lienPaiementAutorise: ligne.lienPaiementAutorise,
      remiseAutorisee: ligne.remiseAutorisee,
    },
  };
}

export type ResultatValidation =
  | { kind: "ok"; mandat: MandatCampagne; regleVersion: number }
  | { kind: "introuvable" }
  | { kind: "deja_validee" };

/**
 * Gèle le mandat d'une campagne au moment de son approbation.
 *
 * Appelée DANS la transaction d'approbation de la `pending_action` : la
 * décision, sa trace au journal et le gel du mandat doivent tenir ou échouer
 * ensemble. Une campagne validée dont le mandat n'aurait pas été figé serait
 * un agent sans limites écrites.
 */
export async function validerCampagne(
  tx: DrizzleTx,
  tenantId: string,
  pendingActionId: string,
  valideeParEmail: string | null,
): Promise<ResultatValidation> {
  const [campagne] = await tx
    .select()
    .from(campagnesRelanceTable)
    .where(
      and(
        eq(campagnesRelanceTable.tenantId, tenantId),
        eq(campagnesRelanceTable.pendingActionId, pendingActionId),
      ),
    );

  if (!campagne) return { kind: "introuvable" };
  // Le rejeu est inoffensif : une campagne déjà validée garde le mandat gelé la
  // première fois, elle n'est pas re-gelée contre une règle qui aurait changé.
  if (campagne.statut !== "PROPOSEE") return { kind: "deja_validee" };

  const { regle, version } = await regleEnVigueur(tx, tenantId);
  // L'invariant : la demande ne peut que RESTREINDRE la règle en vigueur.
  const mandat = restreindreMandat(regle, campagne.mandat);

  await tx
    .update(campagnesRelanceTable)
    .set({
      statut: "VALIDEE",
      mandat,
      regleVersion: version,
      valideeParEmail,
      valideeLe: new Date(),
    })
    .where(eq(campagnesRelanceTable.id, campagne.id));

  return { kind: "ok", mandat, regleVersion: version };
}

/** Marque la campagne rejetée. Même transaction que le rejet de l'action. */
export async function rejeterCampagne(
  tx: DrizzleTx,
  tenantId: string,
  pendingActionId: string,
): Promise<void> {
  await tx
    .update(campagnesRelanceTable)
    .set({ statut: "REJETEE" })
    .where(
      and(
        eq(campagnesRelanceTable.tenantId, tenantId),
        eq(campagnesRelanceTable.pendingActionId, pendingActionId),
        eq(campagnesRelanceTable.statut, "PROPOSEE"),
      ),
    );
}

/** Les campagnes d'un tenant, les plus récentes d'abord. */
export async function listerCampagnes(tenantId: string) {
  return withTenant(tenantId, (tx) =>
    tx
      .select()
      .from(campagnesRelanceTable)
      .where(eq(campagnesRelanceTable.tenantId, tenantId))
      .orderBy(desc(campagnesRelanceTable.createdAt))
      .limit(50),
  );
}
