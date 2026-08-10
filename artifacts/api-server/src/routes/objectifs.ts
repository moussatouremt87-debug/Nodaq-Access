/**
 * Objectifs du cockpit — bloc destiné au patron.
 *
 * Deux objectifs : dépasser l'exercice précédent, et atteindre le seuil de
 * rentabilité. Chacun s'accompagne, quand c'est possible, d'une traduction en
 * nombre de chantiers ordinaires — parce qu'un écart de 42 000 € ne dit rien à
 * un couvreur, alors que « trois chantiers » lui dit tout.
 *
 * CE QUE CE FICHIER NE FAIT JAMAIS :
 *  — estimer un seuil de rentabilité. `cr_entries` porte des postes du plan
 *    comptable sans distinction fixe/variable, et « Autres achats (61-62) »
 *    mélange le loyer et la sous-traitance. Les classer d'office serait
 *    inventer un ratio que l'utilisateur n'a pas fourni. Sans saisie
 *    explicite, on se tait et on propose de paramétrer.
 *  — rendre 0 ou null comme seuil : un zéro s'afficherait comme un objectif
 *    déjà atteint.
 *  — appeler un modèle. Les textes sont des gabarits, et le registre est
 *    décidé ici puis transmis au front comme un champ.
 *
 * VISIBILITÉ : le corps de réponse ne contient RIEN pour qui n'a pas le droit
 * de voir. Pas de masquage côté interface — un bloc masqué reste dans la
 * réponse, donc lisible.
 */
import { Router, type IRouter } from "express";
import { sql, eq, and, isNotNull } from "drizzle-orm";
import {
  withTenant,
  facturesTable,
  affairesTable,
  objectifsFranchissementsTable,
} from "@workspace/db";
import {
  toDateString,
  debutExercice,
  debutExercicePrecedent,
  memeJourExercicePrecedent,
  calculerSeuilRentabilite,
  convertirEnChantiers,
  choisirTon,
  joursRestantsExercice,
  MIN_AFFAIRES_POUR_CONVERSION,
  type AffaireTerminee,
  type ConversionChantiers,
  type TonObjectif,
} from "@nodaq/shared";

const router: IRouter = Router();

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

function execRows<T>(result: unknown): T[] {
  return (result as { rows: T[] }).rows;
}

/** Lecture d'un réglage `settings`, sans valeur par défaut inventée. */
async function reglage(tx: Tx, cle: string): Promise<string | null> {
  const rows = execRows<{ value: string }>(
    await tx.execute(sql`SELECT value FROM settings WHERE key = ${cle}`),
  );
  const v = rows[0]?.value;
  return v !== undefined && v.trim().length > 0 ? v.trim() : null;
}

function nombreOuNull(brut: string | null): number | null {
  if (brut === null) return null;
  const n = Number(brut);
  return Number.isFinite(n) ? n : null;
}

// ── Gabarits de texte ────────────────────────────────────────────────────────
//
// Aucun appel modèle. Trois registres, et l'écart entre eux est délibéré :
// « loin » ne contient ni encouragement ni emoji. Un artisan qui n'y est pas
// n'a pas besoin qu'on l'applaudisse — il a besoin d'un constat et d'une
// action.

const euros = (cents: number): string =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
    .format(cents / 100);

function texteObjectif(
  ton: TonObjectif,
  ecartCents: number,
  conversion: ConversionChantiers | null,
  intitule: string,
): { titre: string; message: string; action: string | null } {
  if (ton === "atteint") {
    return {
      titre: `${intitule} : atteint`,
      message: `C'est fait. Vous avez dépassé ${intitule.toLowerCase()}.`,
      action: null,
    };
  }

  const chantiers =
    conversion !== null
      ? ` Soit environ ${conversion.nbChantiers} chantier${conversion.nbChantiers > 1 ? "s" : ""} ` +
        `de votre taille habituelle (${euros(conversion.montantMedianCents)}, ` +
        `${conversion.dureeMedianeJours} jours).`
      : "";

  if (ton === "a_portee") {
    return {
      titre: `${intitule} : à portée`,
      message: `Il vous reste ${euros(ecartCents)} à facturer.${chantiers}`,
      action: "Voir les prospects à relancer",
    };
  }

  // « loin » — constat factuel, action concrète, rien d'autre.
  return {
    titre: intitule,
    message: `Écart restant : ${euros(ecartCents)}.${chantiers}`,
    action: "Chercher des chantiers",
  };
}

// ── Route ────────────────────────────────────────────────────────────────────

router.get("/cockpit/objectifs", async (req, res): Promise<void> => {
  const tenantId = req.tenantId!;
  const role = req.session?.role ?? "";

  const donnees = await withTenant(tenantId, async (tx) => {
    const actif = await reglage(tx, "objectifs.actif");
    const visibilite = await reglage(tx, "objectifs.visibilite");
    return { actif, visibilite };
  });

  // Le patron peut masquer le bloc pour lui-même.
  if (donnees.actif === "false") {
    res.json({ objectifs: [] });
    return;
  }

  // ACCOUNTANT est exclu par défaut : un expert-comptable délégué n'a pas à
  // lire les objectifs commerciaux de son client.
  const visibiliteEffective = donnees.visibilite === "equipe" ? "equipe" : "owner_only";
  const autorise =
    role === "OWNER" || (visibiliteEffective === "equipe" && role === "MEMBER");

  if (!autorise) {
    // Corps VIDE — rien à masquer côté interface, il n'y a rien à masquer.
    res.json({ objectifs: [] });
    return;
  }

  const maintenant = new Date();
  const exercice = maintenant.getFullYear();

  const calcul = await withTenant(tenantId, async (tx) => {
    const debutN = debutExercice(maintenant);
    const debutN1 = debutExercicePrecedent(maintenant);
    const memeJourN1 = memeJourExercicePrecedent(maintenant);
    const finN1 = toDateString(new Date(exercice - 1, 11, 31));

    // Chiffre d'affaires FACTURÉ — jamais filtré sur l'encaissement.
    const [caN] = execRows<{ total: number }>(await tx.execute(sql`
      SELECT coalesce(sum(amount_cents), 0)::float AS total FROM factures
      WHERE issued_date::date >= ${debutN}::date
    `));
    const [caN1MemePeriode] = execRows<{ total: number }>(await tx.execute(sql`
      SELECT coalesce(sum(amount_cents), 0)::float AS total FROM factures
      WHERE issued_date::date >= ${debutN1}::date AND issued_date::date < ${memeJourN1}::date
    `));
    const [caN1Total] = execRows<{ total: number; nb: number; premiere: string | null }>(
      await tx.execute(sql`
        SELECT coalesce(sum(amount_cents), 0)::float AS total,
               count(*)::int AS nb,
               min(issued_date::date)::text AS premiere
        FROM factures
        WHERE issued_date::date >= ${debutN1}::date AND issued_date::date <= ${finN1}::date
      `),
    );

    // Douze mois d'historique exigés — la plus ancienne facture émise.
    const [historique] = execRows<{ premiere: string | null }>(await tx.execute(sql`
      SELECT min(issued_date::date)::text AS premiere FROM factures
    `));

    // Affaires terminées sur douze mois glissants, avec montant et dates.
    const douzeMois = toDateString(
      new Date(maintenant.getFullYear() - 1, maintenant.getMonth(), maintenant.getDate()),
    );
    const affaires = await tx
      .select({
        montant: affairesTable.invoicedAmountCents,
        debut: affairesTable.startDate,
        fin: affairesTable.completedAt,
      })
      .from(affairesTable)
      .where(and(
        isNotNull(affairesTable.completedAt),
        isNotNull(affairesTable.startDate),
        isNotNull(affairesTable.invoicedAmountCents),
        sql`completed_at::date >= ${douzeMois}::date`,
      ));

    const franchissements = await tx.select().from(objectifsFranchissementsTable)
      .where(eq(objectifsFranchissementsTable.exercice, exercice));

    const chargesFixes = nombreOuNull(await reglage(tx, "objectifs.charges_fixes_annuelles"));
    const tauxMarge = nombreOuNull(await reglage(tx, "objectifs.taux_marge"));

    return {
      caN: caN?.total ?? 0,
      caN1MemePeriode: caN1MemePeriode?.total ?? 0,
      caN1Total: caN1Total?.total ?? 0,
      premiereFacture: historique?.premiere ?? null,
      affaires,
      franchissements,
      chargesFixes,
      tauxMarge,
    };
  });

  const affairesTerminees: AffaireTerminee[] = calcul.affaires
    .map((a) => {
      const debut = new Date(`${a.debut}T00:00:00Z`).getTime();
      const fin = new Date(`${a.fin}T00:00:00Z`).getTime();
      if (Number.isNaN(debut) || Number.isNaN(fin)) return null;
      return {
        montantCents: Math.round(a.montant ?? 0),
        dureeJours: Math.max(1, Math.round((fin - debut) / 86_400_000)),
      };
    })
    .filter((a): a is AffaireTerminee => a !== null && a.montantCents > 0);

  const joursRestants = joursRestantsExercice(maintenant);
  const objectifs: unknown[] = [];

  // ── Objectif 1 : dépasser l'exercice précédent ──────────────────────────────
  //
  // Exigé : douze mois d'historique de factures émises. En deçà, la
  // comparaison porterait sur un exercice partiel et l'objectif serait faux.
  const aDouzeMois =
    calcul.premiereFacture !== null &&
    new Date(`${calcul.premiereFacture}T00:00:00Z`).getTime() <=
      new Date(`${toDateString(new Date(exercice - 1, maintenant.getMonth(), maintenant.getDate()))}T00:00:00Z`).getTime();

  if (aDouzeMois && calcul.caN1Total > 0) {
    const ecart = Math.max(0, Math.round(calcul.caN1Total - calcul.caN));
    const conversion = convertirEnChantiers(ecart, affairesTerminees);
    const ton = choisirTon(ecart, conversion, joursRestants);
    objectifs.push({
      id: "exercice_precedent",
      ton,
      ...texteObjectif(ton, ecart, conversion, "L'exercice précédent"),
      ecartCents: ecart,
      // Contexte : où en était-on à la même date l'an dernier.
      avanceSurMemePeriodeCents: Math.round(calcul.caN - calcul.caN1MemePeriode),
      totalExercicePrecedentCents: Math.round(calcul.caN1Total),
      caExerciceCents: Math.round(calcul.caN),
      conversion,
      dejaFranchi: calcul.franchissements.some((f) => f.objectif === "exercice_precedent"),
    });
  }

  // ── Objectif 2 : seuil de rentabilité ──────────────────────────────────────
  const seuil = calculerSeuilRentabilite({
    chargesFixesAnnuellesCents: calcul.chargesFixes,
    tauxMargeBps: calcul.tauxMarge,
  });

  if (seuil === null) {
    // Ni valeur, ni zéro, ni null déguisé en objectif : on annonce seulement
    // que c'est paramétrable, et le front propose de le faire.
    objectifs.push({ id: "seuil_rentabilite", configurable: true });
  } else {
    const ecart = Math.max(0, Math.round(seuil.seuilCents - calcul.caN));
    const conversion = convertirEnChantiers(ecart, affairesTerminees);
    const ton = choisirTon(ecart, conversion, joursRestants);
    objectifs.push({
      id: "seuil_rentabilite",
      ton,
      ...texteObjectif(ton, ecart, conversion, "Le seuil de rentabilité"),
      ecartCents: ecart,
      seuilCents: seuil.seuilCents,
      provenance: seuil.provenance,
      caExerciceCents: Math.round(calcul.caN),
      conversion,
      dejaFranchi: calcul.franchissements.some((f) => f.objectif === "seuil_rentabilite"),
    });
  }

  res.json({
    exercice,
    objectifs,
    /** Sous ce seuil d'affaires terminées, aucune conversion n'est proposée. */
    minAffairesPourConversion: MIN_AFFAIRES_POUR_CONVERSION,
    nbAffairesObservees: affairesTerminees.length,
  });
});

export default router;
