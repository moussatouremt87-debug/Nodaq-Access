/**
 * Franchissement d'objectif — la trace, et l'annonce.
 *
 * La table `objectifs_franchissements` existe depuis le lot 4. Rien ne la
 * remplissait : le ticket disait « la notification attend d'avoir un
 * utilisateur ». C'est ce chemin-là.
 *
 * ── ÉVALUÉ À L'ÉMISSION, PAS À LA LECTURE ───────────────────────────────────
 * Le chiffre d'affaires change quand une facture est ÉMISE. On évalue donc à
 * ce moment-là, et non quand quelqu'un consulte le cockpit.
 *
 * Évaluer à la lecture serait plus simple et donnerait une trace fausse :
 * `franchi_le` porterait la date à laquelle on a REGARDÉ, pas celle où le seuil
 * a été franchi. Un artisan qui n'ouvre pas son cockpit pendant trois semaines
 * verrait son objectif « franchi aujourd'hui ». Une trace dont l'horodatage ne
 * veut rien dire ne vaut pas la peine d'être conservée.
 *
 * ── UN FRANCHISSEMENT NE SE DÉFAIT PAS ──────────────────────────────────────
 * Un avoir émis ensuite peut faire repasser le chiffre d'affaires SOUS le
 * seuil. On n'efface pas pour autant : le franchissement a eu lieu, et la
 * table est append-only — `app_user` n'a ni UPDATE ni DELETE dessus.
 *
 * C'est aussi ce qui empêche d'annoncer deux fois le même franchissement à la
 * faveur d'un aller-retour, ce qui serait la façon la plus sûre de ne plus
 * être cru.
 *
 * ── ON N'ANNONCE QUE CE QUI ÉTAIT AFFICHÉ ───────────────────────────────────
 * Un objectif que le cockpit ne SERT PAS — faute de douze mois d'historique,
 * ou faute de paramétrage du seuil — n'est pas franchissable. Féliciter
 * quelqu'un d'avoir dépassé un objectif qu'il n'a jamais vu n'est pas une
 * bonne nouvelle, c'est une énigme.
 */
import { eq, and, sql } from "drizzle-orm";
import {
  withTenant,
  objectifsFranchissementsTable,
  activityTable,
  settingsTable,
} from "@workspace/db";
import {
  debutExercice,
  debutExercicePrecedent,
  toDateString,
  calculerSeuilRentabilite,
  CLE_TAUX_MARGE,
  CLE_CHARGES_FIXES,
} from "@nodaq/shared";
import { caNetCentsSql, statutsCaSql } from "./chiffreAffaires.js";

/** Les deux objectifs du cockpit. Fermé : la table porte le même CHECK. */
export const OBJECTIFS = ["exercice_precedent", "seuil_rentabilite"] as const;
export type Objectif = (typeof OBJECTIFS)[number];

export interface Franchissement {
  readonly objectif: Objectif;
  readonly exercice: number;
  readonly montantCents: number;
}

function execRows<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

/**
 * L'état des deux objectifs, à l'instant présent.
 *
 * Les mêmes bornes et la MÊME définition du chiffre d'affaires que le cockpit
 * — `caNetCentsSql`, statuts en liste blanche et avoirs déduits. Recalculer
 * autrement ici ferait diverger la trace de ce que l'artisan a sous les yeux.
 */
export async function etatObjectifs(
  tenantId: string,
  maintenant: Date = new Date(),
): Promise<{
  exercice: number;
  caN: number;
  caN1Total: number;
  aDouzeMois: boolean;
  seuilCents: number | null;
}> {
  const exercice = maintenant.getFullYear();
  const debutN = debutExercice(maintenant);
  const debutN1 = debutExercicePrecedent(maintenant);
  const finN1Exclue = toDateString(new Date(exercice, 0, 1));

  return withTenant(tenantId, async (tx) => {
    const [caN] = execRows<{ total: number }>(
      await tx.execute(sql`SELECT ${caNetCentsSql({ debut: debutN })} AS total`),
    );
    const [caN1] = execRows<{ total: number }>(
      await tx.execute(sql`
        SELECT ${caNetCentsSql({ debut: debutN1, finExclue: finN1Exclue })} AS total
      `),
    );
    // Douze mois d'historique de factures ÉMISES — un brouillon vieux d'un an
    // ne prouve pas qu'on a un exercice à comparer.
    const [historique] = execRows<{ premiere: string | null }>(await tx.execute(sql`
      SELECT min(issued_date::date)::text AS premiere FROM factures
      WHERE statut IN (${statutsCaSql})
    `));

    const reglages = await tx
      .select({ key: settingsTable.key, value: settingsTable.value })
      .from(settingsTable);
    const parCle = new Map(reglages.map((r) => [r.key, r.value]));
    const nombre = (cle: string): number | null => {
      const v = parCle.get(cle);
      if (typeof v !== "string" || v.trim().length === 0) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const seuil = calculerSeuilRentabilite({
      chargesFixesAnnuellesCents: nombre(CLE_CHARGES_FIXES),
      tauxMargeBps: nombre(CLE_TAUX_MARGE),
    });

    const premiere = historique?.premiere ?? null;
    const douzeMoisAvant = toDateString(
      new Date(exercice - 1, maintenant.getMonth(), maintenant.getDate()),
    );
    const aDouzeMois = premiere !== null && premiere <= douzeMoisAvant;

    return {
      exercice,
      caN: Math.round(caN?.total ?? 0),
      caN1Total: Math.round(caN1?.total ?? 0),
      aDouzeMois,
      seuilCents: seuil?.seuilCents ?? null,
    };
  });
}

/** Le texte annoncé à l'artisan. Un constat, pas un feu d'artifice. */
export function messageFranchissement(f: Franchissement): string {
  const euros = (cents: number): string =>
    new Intl.NumberFormat("fr-FR", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0,
    }).format(cents / 100);

  return f.objectif === "exercice_precedent"
    ? `Vous avez dépassé votre exercice précédent : ${euros(f.montantCents)} facturés.`
    : `Vous avez atteint votre seuil de rentabilité : ${euros(f.montantCents)} facturés.`;
}

/**
 * Évalue les objectifs et enregistre les franchissements NOUVEAUX.
 *
 * Rend uniquement ceux qui viennent d'être franchis — jamais ceux qui
 * l'étaient déjà. L'unicité `(tenant, objectif, exercice)` est tenue par le
 * moteur : `ON CONFLICT DO NOTHING` ne rend rien quand la ligne existe, et
 * c'est cela qui garantit qu'on n'annonce pas deux fois.
 *
 * Ne lève JAMAIS. Appelée après l'émission d'une facture, elle ne doit pas
 * pouvoir faire échouer une émission déjà écrite : une facture émise est
 * immuable, et l'annonce d'un objectif ne vaut pas qu'on la remette en cause.
 */
export async function evaluerFranchissements(
  tenantId: string,
  maintenant: Date = new Date(),
): Promise<Franchissement[]> {
  try {
    const etat = await etatObjectifs(tenantId, maintenant);
    const candidats: Franchissement[] = [];

    // On n'annonce que ce que le cockpit SERT : sans douze mois d'historique
    // ni exercice précédent non nul, cet objectif n'est pas affiché.
    if (etat.aDouzeMois && etat.caN1Total > 0 && etat.caN >= etat.caN1Total) {
      candidats.push({
        objectif: "exercice_precedent",
        exercice: etat.exercice,
        montantCents: etat.caN,
      });
    }
    // Sans seuil paramétré, il n'y a pas d'objectif — et surtout pas un seuil
    // à zéro, qui s'afficherait comme déjà atteint.
    if (etat.seuilCents !== null && etat.caN >= etat.seuilCents) {
      candidats.push({
        objectif: "seuil_rentabilite",
        exercice: etat.exercice,
        montantCents: etat.caN,
      });
    }

    if (candidats.length === 0) return [];

    return await withTenant(tenantId, async (tx) => {
      const nouveaux: Franchissement[] = [];
      for (const c of candidats) {
        const [insere] = await tx
          .insert(objectifsFranchissementsTable)
          .values({
            tenantId,
            objectif: c.objectif,
            exercice: c.exercice,
            montantCents: c.montantCents,
          })
          .onConflictDoNothing()
          .returning({ id: objectifsFranchissementsTable.id });
        // Rien rendu = la ligne existait déjà : déjà franchi, déjà annoncé.
        if (!insere) continue;

        nouveaux.push(c);
        await tx.insert(activityTable).values({
          tenantId,
          type: "objectif_franchi",
          label: messageFranchissement(c),
        });
      }
      return nouveaux;
    });
  } catch (err) {
    // Une facture émise est immuable et déjà écrite : l'annonce d'un objectif
    // ne vaut pas qu'on la remette en cause.
    console.error(
      "[objectifs] évaluation du franchissement impossible :",
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/** Les franchissements déjà enregistrés pour un exercice. */
export async function franchissementsDe(
  tenantId: string,
  exercice: number,
): Promise<Array<{ objectif: string; franchiLe: Date; montantCents: number }>> {
  return withTenant(tenantId, (tx) =>
    tx
      .select({
        objectif: objectifsFranchissementsTable.objectif,
        franchiLe: objectifsFranchissementsTable.franchiLe,
        montantCents: objectifsFranchissementsTable.montantCents,
      })
      .from(objectifsFranchissementsTable)
      .where(and(eq(objectifsFranchissementsTable.exercice, exercice))),
  );
}
