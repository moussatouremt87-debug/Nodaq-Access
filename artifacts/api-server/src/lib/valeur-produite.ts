/**
 * Ce que nodaq a FAIT ce mois-ci, en chiffres qui tiennent debout.
 *
 * ── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
 *
 * Au moment où un artisan pense « je paie quand même 29 € par mois », il doit
 * pouvoir voir en une ligne ce que le produit a produit. C'est le meilleur
 * argument de rétention qui soit, et il ne coûte rien à fabriquer : la matière
 * est déjà en base.
 *
 * ── LA RÈGLE QUI GOUVERNE TOUT CE FICHIER ───────────────────────────────────
 *
 * Chaque nombre affiché est DÉRIVÉ d'une table qui fait foi. Aucun n'est
 * estimé, aucun n'est arrondi vers le haut, aucun ne vient d'un modèle
 * (règle 3). Un panneau de valeur qui exagère est pire qu'un panneau absent :
 * le jour où l'artisan attrape une exagération, il cesse de croire les autres
 * chiffres — y compris ceux qui sont exacts.
 *
 * C'est pourquoi « 7 h 42 économisées » ne figure PAS ici. Le temps gagné ne
 * se dérive d'aucune donnée : il faudrait poser « une relance = X minutes »,
 * c'est-à-dire l'inventer. Un chiffre fabriqué posé à côté de montants réels
 * les contamine tous.
 *
 * ── ET SURTOUT : ON N'ATTRIBUE PAS ──────────────────────────────────────────
 *
 * « nodaq vous a récupéré 4 850 € » serait une revendication de CAUSE. Une
 * facture relancée puis payée l'aurait peut-être été de toute façon, et rien
 * dans la base ne permet de trancher. On dit donc ce qu'on sait :
 * « factures relancées par nodaq, puis encaissées ». C'est un fait, vérifiable
 * ligne à ligne, et il porte déjà tout seul.
 */
import { sql, eq } from "drizzle-orm";
import { withTenant, subscriptionsTable, plansTable } from "@workspace/db";
import { toDateString } from "@nodaq/shared";
import { conditionFactureEnRetardSql } from "./facturesEnRetard.js";

/** Transaction Drizzle telle que `withTenant` la donne. */
type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

export interface ValeurProduite {
  /** Bornes réelles du calcul, en dates métier — jamais implicites. */
  readonly periode: { readonly debut: string; readonly fin: string };
  /**
   * Factures relancées par nodaq PUIS encaissées sur la période.
   * Un FAIT, pas une attribution — voir l'en-tête.
   */
  readonly relanceesPuisEncaissees: {
    readonly nombre: number;
    readonly montantCents: number;
  };
  /** Ce qui est facturé, pas encore payé, et pas encore en retard. */
  readonly encaissementsAVenirCents: number;
  /** Ce qui est en retard, selon LA définition du dépôt. */
  readonly impayes: { readonly nombre: number; readonly montantCents: number };
  /** Documents que nodaq a émis et envoyés à la place de l'artisan. */
  readonly documentsEnvoyes: number;
  /** Propositions de l'agent validées en un clic (règle 4). */
  readonly actionsValidees: number;
  /** Ce que l'abonnement a coûté sur la même période, pour comparer. */
  readonly abonnementCents: number;
}

/** Le premier jour du mois courant, en date métier locale. */
export function debutDuMois(maintenant = new Date()): string {
  return toDateString(new Date(maintenant.getFullYear(), maintenant.getMonth(), 1));
}

function nombre(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Les factures que nodaq a relancées, puis qui ont été encaissées.
 *
 * Une facture relancée trois fois compte UNE fois — c'est un dossier, pas un
 * nombre de tentatives. Même règle que le compteur d'usage vocal (4.43 §1),
 * et pour la même raison : compter les tentatives gonflerait le chiffre sans
 * rien dire de plus.
 *
 * Le paiement doit être POSTÉRIEUR à la relance. Sans cette borne, une facture
 * payée le lundi et relancée par erreur le mardi serait comptée — on
 * s'attribuerait un encaissement qui précède l'action.
 */
async function relanceesPuisEncaissees(
  tx: Tx, debut: string, fin: string,
): Promise<{ nombre: number; montantCents: number }> {
  const r = await tx.execute(sql`
    WITH relances AS (
      -- Appels vocaux ET envois de relance écrite : les deux sont des
      -- relances faites par le produit. Ne prendre que l'un des deux
      -- sous-estimerait le travail réellement abattu.
      SELECT facture_id, min(started_at)::date AS premiere
        FROM appels_relance
       WHERE facture_id IS NOT NULL AND started_at IS NOT NULL
       GROUP BY facture_id
    ),
    encaisses AS (
      SELECT p.facture_id, sum(p.montant_cents)::bigint AS montant
        FROM paiements p
        JOIN relances r ON r.facture_id = p.facture_id
       WHERE p.sens = 'ENCAISSEMENT'
         AND p.date >= ${debut} AND p.date <= ${fin}
         -- Le paiement suit la relance, jamais l'inverse.
         AND p.date >= r.premiere
       GROUP BY p.facture_id
    )
    SELECT count(*)::int AS nombre, coalesce(sum(montant), 0)::float AS montant
      FROM encaisses
  `);
  const ligne = (r.rows?.[0] ?? {}) as Record<string, unknown>;
  return { nombre: nombre(ligne["nombre"]), montantCents: nombre(ligne["montant"]) };
}

/** Ce que l'abonnement a coûté sur la période — pour que la comparaison existe. */
async function coutAbonnement(tx: Tx): Promise<number> {
  const [ligne] = await tx
    .select({ prix: plansTable.prixMensuelCents, remise: subscriptionsTable.derogationRemiseCents })
    .from(subscriptionsTable)
    .innerJoin(plansTable, eq(plansTable.id, subscriptionsTable.planId));
  if (!ligne) return 0;
  // La dérogation de remise est une DONNÉE par tenant (les places offertes) :
  // un compte offert doit afficher 0, pas le tarif public.
  return Math.max(0, (ligne.prix ?? 0) - (ligne.remise ?? 0));
}

/**
 * Tout le panneau, en une transaction et donc en une photo cohérente.
 *
 * Sans transaction unique, un paiement enregistré entre deux requêtes
 * apparaîtrait dans un chiffre et pas dans l'autre — et l'artisan verrait un
 * total qui ne correspond pas à son détail.
 */
export async function valeurProduite(
  tenantId: string, maintenant = new Date(),
): Promise<ValeurProduite> {
  const debut = debutDuMois(maintenant);
  const fin = toDateString(maintenant);

  return withTenant(tenantId, async (tx) => {
    const relances = await relanceesPuisEncaissees(tx, debut, fin);

    /*
     * `amount_cents` EST le montant TTC : les deux chemins de facturation
     * (`facturer-devis`, `facturer-affaire`) le posent à
     * `totalHTCents + totalTVACents`. Recomposer la somme ici créerait une
     * seconde définition qui divergerait le jour où l'autoliquidation ou une
     * remise changerait le calcul — le défaut qui a coûté trois tickets sur le
     * chiffre d'affaires.
     *
     * Et c'est bien le TTC qui compte ici : l'artisan regarde ce qui va
     * tomber sur son compte, pas une assiette fiscale.
     */
    const r = await tx.execute(sql`
      SELECT
        -- Facturé, pas encore payé, pas encore échu. La liste blanche de
        -- statuts est celle du dépôt : un BROUILLON n'est dû par personne.
        coalesce(sum(CASE WHEN statut IN ('EMISE','ENVOYEE') AND due_date >= ${fin}
                          THEN amount_cents ELSE 0 END), 0)::float AS a_venir,
        count(*) FILTER (WHERE ${conditionFactureEnRetardSql(fin)})::int AS retard_nb,
        coalesce(sum(CASE WHEN ${conditionFactureEnRetardSql(fin)}
                          THEN amount_cents ELSE 0 END), 0)::float AS retard_montant
        FROM factures
    `);
    const f = (r.rows?.[0] ?? {}) as Record<string, unknown>;

    const [envois] = await tx.execute(sql`
      SELECT count(*)::int AS n FROM envois_journal
       WHERE statut = 'envoye'
         AND document_type IN ('FACTURE','DEVIS','AVOIR')
         AND envoye_le >= ${debut}::date
    `).then((x) => x.rows as Array<Record<string, unknown>>);

    const [actions] = await tx.execute(sql`
      SELECT count(*)::int AS n FROM pending_actions
       WHERE status = 'APPROUVE' AND decided_at >= ${debut}::date
    `).then((x) => x.rows as Array<Record<string, unknown>>);

    return {
      periode: { debut, fin },
      relanceesPuisEncaissees: relances,
      encaissementsAVenirCents: nombre(f["a_venir"]),
      impayes: {
        nombre: nombre(f["retard_nb"]),
        montantCents: nombre(f["retard_montant"]),
      },
      documentsEnvoyes: nombre(envois?.["n"]),
      actionsValidees: nombre(actions?.["n"]),
      abonnementCents: await coutAbonnement(tx),
    };
  });
}
