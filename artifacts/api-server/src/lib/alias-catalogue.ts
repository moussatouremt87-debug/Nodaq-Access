/**
 * Apprentissage des alias du catalogue.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  UN ALIAS S'APPREND D'UNE CORRECTION HUMAINE, JAMAIS D'UNE DÉDUCTION.    ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * L'artisan a dicté « du placo », le rapprochement n'a rien trouvé, il a
 * DÉSIGNÉ lui-même « Cloison BA13 ». C'est cette désignation qu'on retient.
 *
 * Rien n'est appris d'un rapprochement automatique réussi, ni d'une ligne
 * laissée telle quelle : apprendre de ses propres suppositions ferait dériver
 * le catalogue sans que personne s'en aperçoive, et le prix affiché finirait
 * par venir d'une chaîne de déductions que plus personne ne peut relire.
 */
import { and, eq } from "drizzle-orm";
import {
  withTenant,
  catalogueAliasTable,
  catalogueLignesTable,
  type CatalogueAlias,
} from "@workspace/db";
import { normaliser, type AliasCatalogue } from "@nodaq/shared";

/** Charge le dictionnaire d'alias du tenant, prêt pour `rapprocher`. */
export async function chargerAlias(tenantId: string): Promise<AliasCatalogue> {
  const lignes = await withTenant(tenantId, (tx) =>
    tx
      .select({
        alias: catalogueAliasTable.aliasNormalise,
        ligneId: catalogueAliasTable.catalogueLigneId,
      })
      .from(catalogueAliasTable),
  );
  return new Map(lignes.map((l) => [l.alias, l.ligneId]));
}

export type RefusApprentissage =
  | { readonly motif: "libelle_vide" }
  | { readonly motif: "ligne_introuvable" }
  | { readonly motif: "deja_un_libelle"; readonly libelle: string }
  | { readonly motif: "deja_appris_ailleurs"; readonly libelle: string };

export type ResultatApprentissage =
  | { readonly ok: true; readonly alias: CatalogueAlias; readonly remplace: boolean }
  | { readonly ok: false; readonly refus: RefusApprentissage };

/**
 * Apprend un alias, ou refuse en disant pourquoi.
 *
 * ── Trois refus, et chacun protège quelque chose ────────────────────────────
 *
 * `deja_un_libelle` — la phrase dictée EST déjà le libellé exact d'une autre
 * ligne du catalogue. Comme l'alias passe AVANT le libellé dans l'ordre de
 * `rapprocher`, l'apprendre détournerait silencieusement toutes les futures
 * dictées de cette ligne vers une autre. C'est le refus qui compte le plus :
 * l'artisan ne verrait rien, et les prix changeraient.
 *
 * `deja_appris_ailleurs` — la phrase pointe déjà sur une autre ligne. On ne
 * remplace pas en douce : l'appelant doit le demander explicitement, parce que
 * remplacer, c'est décider que l'apprentissage précédent était faux.
 *
 * `ligne_introuvable` — la cible n'existe pas chez ce tenant. Rien à apprendre.
 */
export async function apprendreAlias(
  tenantId: string,
  libelleDicte: string,
  catalogueLigneId: string,
  options: { readonly remplacer?: boolean } = {},
): Promise<ResultatApprentissage> {
  const aliasNormalise = normaliser(libelleDicte);
  if (aliasNormalise.length === 0) {
    return { ok: false, refus: { motif: "libelle_vide" } };
  }

  return withTenant(tenantId, async (tx) => {
    const [ligne] = await tx
      .select()
      .from(catalogueLignesTable)
      .where(eq(catalogueLignesTable.id, catalogueLigneId));
    if (!ligne) return { ok: false as const, refus: { motif: "ligne_introuvable" as const } };

    // La phrase est-elle DÉJÀ le libellé d'une autre ligne ? L'alias passant
    // avant le libellé, l'apprendre détournerait cette ligne-là.
    const toutes = await tx.select().from(catalogueLignesTable);
    const homonyme = toutes.find(
      (c) => c.id !== catalogueLigneId && normaliser(c.libelle) === aliasNormalise,
    );
    if (homonyme) {
      return {
        ok: false as const,
        refus: { motif: "deja_un_libelle" as const, libelle: homonyme.libelle },
      };
    }

    const [existant] = await tx
      .select()
      .from(catalogueAliasTable)
      .where(
        and(
          eq(catalogueAliasTable.aliasNormalise, aliasNormalise),
          eq(catalogueAliasTable.tenantId, tenantId),
        ),
      );

    if (existant && existant.catalogueLigneId !== catalogueLigneId) {
      if (!options.remplacer) {
        const [cible] = await tx
          .select({ libelle: catalogueLignesTable.libelle })
          .from(catalogueLignesTable)
          .where(eq(catalogueLignesTable.id, existant.catalogueLigneId));
        return {
          ok: false as const,
          refus: {
            motif: "deja_appris_ailleurs" as const,
            libelle: cible?.libelle ?? "(ligne supprimée)",
          },
        };
      }
      const [maj] = await tx
        .update(catalogueAliasTable)
        .set({ catalogueLigneId, libelleDicte })
        .where(eq(catalogueAliasTable.id, existant.id))
        .returning();
      return { ok: true as const, alias: maj!, remplace: true };
    }

    if (existant) {
      // Déjà appris, et sur la BONNE ligne : rien à faire, et surtout pas une
      // erreur. Réapprendre la même chose est le geste d'un artisan qui doute.
      return { ok: true as const, alias: existant, remplace: false };
    }

    const [cree] = await tx
      .insert(catalogueAliasTable)
      .values({ tenantId, aliasNormalise, libelleDicte, catalogueLigneId })
      .returning();
    return { ok: true as const, alias: cree!, remplace: false };
  });
}

/** Phrases affichables pour chaque refus. */
export function messageRefus(refus: RefusApprentissage): string {
  switch (refus.motif) {
    case "libelle_vide":
      return "Il n'y a rien à retenir : le libellé dicté est vide.";
    case "ligne_introuvable":
      return "Cette ligne de catalogue n'existe pas.";
    case "deja_un_libelle":
      return (
        `« ${refus.libelle} » porte déjà exactement ce libellé dans votre catalogue. ` +
        `Retenir ce raccourci détournerait toutes vos futures dictées de cette ligne ` +
        `vers une autre, sans que vous le voyiez.`
      );
    case "deja_appris_ailleurs":
      return (
        `Ce raccourci désigne déjà « ${refus.libelle} ». Confirmez le remplacement ` +
        `si l'apprentissage précédent était une erreur.`
      );
  }
}

/** Oublie un alias. Une erreur d'apprentissage doit pouvoir se défaire. */
export async function oublierAlias(tenantId: string, aliasId: string): Promise<boolean> {
  const supprimes = await withTenant(tenantId, (tx) =>
    tx.delete(catalogueAliasTable).where(eq(catalogueAliasTable.id, aliasId)).returning(),
  );
  return supprimes.length > 0;
}
