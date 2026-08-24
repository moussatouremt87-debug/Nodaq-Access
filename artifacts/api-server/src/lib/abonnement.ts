/**
 * Abonnement du tenant — l'état, les compteurs, et les bascules.
 *
 * ── Le statut READONLY se CONSTATE, il ne se planifie pas ─────────────────
 * L'essai échoit sans tâche planifiée : la première lecture (ou tentative
 * d'écriture) qui trouve un TRIAL dont `trial_ends_at` est passé bascule la
 * ligne en READONLY — un UPDATE gardé par `statut = 'TRIAL'`, donc idempotent
 * sous concurrence. La lecture seule ne supprime JAMAIS rien : c'est le même
 * contrat que le tiers de confiance (middleware/lectureSeule.ts).
 *
 * ── Le compteur vocal se DÉRIVE, il ne se stocke pas ──────────────────────
 * « 12/30 appels utilisés » compte les lignes d'`appels_relance` réellement
 * composées (started_at posé) dans le mois calendaire de PARIS. Un compteur
 * matérialisé finirait par mentir ; celui-ci ne peut pas diverger de la table
 * qui fait foi. Seul le FRANCHISSEMENT du seuil d'alerte laisse une trace
 * (usage_franchissements, append-only, unique par tenant/mois/seuil) — c'est
 * elle qui garantit qu'on n'alerte qu'une fois.
 *
 * ── La jauge Fondateurs est GLOBALE et se réclame atomiquement ────────────
 * `fondateurs_compteur` n'a ni tenant_id ni RLS : sous FORCE RLS, personne ne
 * peut compter les abonnements des autres tenants. L'UPDATE conditionnel est
 * l'unique porte : le 51e candidat ne matche pas le WHERE, il n'y a pas de
 * fenêtre de course à fermer.
 */
import { and, eq, isNull, or, gt, sql, inArray } from "drizzle-orm";
import {
  db,
  withTenant,
  plansTable,
  subscriptionsTable,
  fondateursCompteurTable,
  usageFranchissementsTable,
  appelsRelanceTable,
  membershipsTable,
  activityTable,
  type Plan,
  type Subscription,
} from "@workspace/db";
import {
  ESSAI_JOURS,
  SEUIL_ALERTE_USAGE_PCT,
  ROLES_COMPTES_DANS_LA_LIMITE,
  moisCalendaireParis,
} from "@nodaq/shared";

/** Transaction Drizzle telle que `withTenant` la donne. */
type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

export interface EtatAbonnement {
  readonly plan: Plan;
  readonly moduleVocal: Plan | null;
  readonly subscription: Subscription;
  /** Statut APRÈS constat d'échéance d'essai — jamais un TRIAL périmé. */
  readonly statut: "TRIAL" | "ACTIVE" | "READONLY";
  readonly utilisateurs: {
    readonly actifs: number;
    readonly inclus: number;
    readonly supplementaires: number;
    readonly prixSupplementaireCents: number | null;
  };
  readonly appels: {
    readonly utilises: number;
    readonly inclus: number;
    readonly depassement: number;
    readonly prixDepassementCents: number;
    readonly mois: string;
  } | null;
}

/** Les plans, lus tels que la migration les a seedés — jamais réécrits ici. */
export async function tousLesPlans(): Promise<Plan[]> {
  return db.select().from(plansTable);
}

async function planParId(id: string): Promise<Plan> {
  const [plan] = await db.select().from(plansTable).where(eq(plansTable.id, id));
  if (!plan) throw new Error(`plan inconnu : ${id}`);
  return plan;
}

/**
 * Crée l'abonnement d'essai d'un tenant neuf. Appelé dans LA transaction de
 * création du tenant (authService) : un tenant sans abonnement n'existe pas.
 */
export function creerAbonnementEssai(tx: Tx, tenantId: string): Promise<unknown> {
  return tx.insert(subscriptionsTable).values({
    tenantId,
    planId: "equipe",
    statut: "TRIAL",
    trialEndsAt: new Date(Date.now() + ESSAI_JOURS * 24 * 60 * 60 * 1000),
  });
}

/**
 * L'abonnement courant, échéance d'essai constatée. S'il n'existe pas (tenant
 * antérieur au backfill de la 065 — ne devrait pas arriver), il est créé en
 * essai plutôt que de rendre une erreur : l'absence d'abonnement n'est pas
 * une faute de l'utilisateur.
 */
export async function abonnementCourant(tenantId: string): Promise<Subscription> {
  return withTenant(tenantId, async (tx) => {
    let [sub] = await tx
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.tenantId, tenantId));

    if (!sub) {
      await creerAbonnementEssai(tx, tenantId);
      [sub] = await tx
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.tenantId, tenantId));
    }

    let s = sub!;
    if (s.statut === "TRIAL" && s.trialEndsAt && s.trialEndsAt.getTime() < Date.now()) {
      // Gardé par statut='TRIAL' : deux requêtes concurrentes ne basculent
      // qu'une fois, et une souscription simultanée (ACTIVE) n'est pas écrasée.
      await tx
        .update(subscriptionsTable)
        .set({ statut: "READONLY", updatedAt: new Date() })
        .where(and(eq(subscriptionsTable.id, s.id), eq(subscriptionsTable.statut, "TRIAL")));
      const [rafraichi] = await tx
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.id, s.id));
      s = rafraichi!;
    }

    // Retour de formule programmé : il s'applique à l'échéance, constaté de la
    // même façon paresseuse. Le garde `plan_suivant IS NOT NULL` rend l'UPDATE
    // idempotent sous concurrence.
    if (s.planSuivant && s.echeance && s.echeance.getTime() < Date.now()) {
      await tx
        .update(subscriptionsTable)
        .set({
          planId: s.planSuivant,
          planSuivant: null,
          echeance: null,
          updatedAt: new Date(),
        })
        .where(
          and(eq(subscriptionsTable.id, s.id), sql`${subscriptionsTable.planSuivant} IS NOT NULL`),
        );
      await tx.insert(activityTable).values({
        tenantId,
        type: "abonnement.change_applique",
        label: `Changement de formule appliqué à l'échéance : ${s.planSuivant}.`,
        meta: JSON.stringify({ dePlan: s.planId, versPlan: s.planSuivant }),
      });
      const [rafraichi] = await tx
        .select()
        .from(subscriptionsTable)
        .where(eq(subscriptionsTable.id, s.id));
      s = rafraichi!;
    }
    return s;
  });
}

/** Utilisateurs actifs comptés dans la limite (OWNER, MEMBER — pas les accès
 *  externes). `memberships` est une table d'infrastructure, hors RLS. */
export async function utilisateursActifs(tenantId: string): Promise<number> {
  const [ligne] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(membershipsTable)
    .where(
      and(
        eq(membershipsTable.tenantId, tenantId),
        inArray(membershipsTable.role, [...ROLES_COMPTES_DANS_LA_LIMITE]),
        or(isNull(membershipsTable.expiresAt), gt(membershipsTable.expiresAt, new Date())),
      ),
    );
  return ligne?.n ?? 0;
}

/** Appels réellement composés (started_at posé) sur un mois de Paris. */
export async function appelsDuMois(tenantId: string, mois: string): Promise<number> {
  const [ligne] = await withTenant(tenantId, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(appelsRelanceTable)
      .where(
        and(
          eq(appelsRelanceTable.tenantId, tenantId),
          sql`${appelsRelanceTable.startedAt} IS NOT NULL`,
          sql`to_char(${appelsRelanceTable.startedAt} AT TIME ZONE 'Europe/Paris', 'YYYY-MM') = ${mois}`,
        ),
      ),
  );
  return ligne?.n ?? 0;
}

/**
 * Constate le franchissement du seuil d'alerte d'usage vocal — au moment où
 * un appel démarre, pas quand quelqu'un regarde l'écran (même doctrine que
 * franchissement-objectifs : un horodatage de lecture ne veut rien dire).
 * L'unicité (tenant, mois, seuil) fait qu'une seule des écritures
 * concurrentes laisse une trace, et elle seule annonce.
 */
export async function constaterFranchissementUsage(
  tx: Tx,
  tenantId: string,
  mois: string,
  utilises: number,
  inclus: number,
): Promise<void> {
  if (inclus <= 0 || utilises * 100 < SEUIL_ALERTE_USAGE_PCT * inclus) return;
  const inseres = (await tx
    .insert(usageFranchissementsTable)
    .values({ tenantId, mois, seuilPct: SEUIL_ALERTE_USAGE_PCT })
    .onConflictDoNothing()
    .returning({ id: usageFranchissementsTable.id })) as Array<{ id: string }>;
  if (inseres.length === 0) return;
  await tx.insert(activityTable).values({
    tenantId,
    type: "abonnement.usage_seuil",
    label: `Relance vocale : ${utilises} appels sur ${inclus} inclus ce mois-ci (${SEUIL_ALERTE_USAGE_PCT} % atteints). Au-delà, chaque appel est compté en dépassement — jamais coupé.`,
    meta: JSON.stringify({ mois, utilises, inclus }),
  });
}

/**
 * Constate l'usage vocal du mois au démarrage d'un appel — le seul moment où
 * le compteur avance. Sans module actif, il n'y a rien à constater.
 */
export async function constaterUsageVocal(tenantId: string): Promise<void> {
  const sub = await abonnementCourant(tenantId);
  if (!sub.moduleVocal) return;
  const module = await planParId("module_vocal");
  const mois = moisCalendaireParis(new Date());
  const utilises = await appelsDuMois(tenantId, mois);
  await withTenant(tenantId, (tx) =>
    constaterFranchissementUsage(tx, tenantId, mois, utilises, module.appelsInclus),
  );
}

/**
 * Réclame une place Fondateurs. L'UPDATE conditionnel est atomique : il rend
 * `false` quand les 50 places sont prises ou que le fondateur a fermé
 * l'offre — sans fenêtre entre lecture et écriture.
 */
export async function reclamerPlaceFondateurs(tx: Tx): Promise<boolean> {
  const prises = (await tx
    .update(fondateursCompteurTable)
    .set({ placesPrises: sql`${fondateursCompteurTable.placesPrises} + 1` })
    .where(
      and(
        eq(fondateursCompteurTable.id, "global"),
        isNull(fondateursCompteurTable.fermeLe),
        sql`${fondateursCompteurTable.placesPrises} < ${fondateursCompteurTable.placesTotales}`,
      ),
    )
    .returning({ id: fondateursCompteurTable.id })) as Array<{ id: string }>;
  return prises.length > 0;
}

/** La jauge Fondateurs, pour l'écran et la page publique. */
export async function placesFondateurs(): Promise<{
  totales: number;
  prises: number;
  ouverte: boolean;
}> {
  const [ligne] = await db
    .select()
    .from(fondateursCompteurTable)
    .where(eq(fondateursCompteurTable.id, "global"));
  if (!ligne) return { totales: 0, prises: 0, ouverte: false };
  return {
    totales: ligne.placesTotales,
    prises: ligne.placesPrises,
    ouverte: ligne.fermeLe === null && ligne.placesPrises < ligne.placesTotales,
  };
}

/** L'état complet, tel que l'écran Abonnement l'affiche. */
export async function etatAbonnement(tenantId: string): Promise<EtatAbonnement> {
  const sub = await abonnementCourant(tenantId);
  const plan = await planParId(sub.planId);
  const moduleVocal = sub.moduleVocal ? await planParId("module_vocal") : null;
  const actifs = await utilisateursActifs(tenantId);

  const inclus = plan.utilisateursInclus;
  const supplementaires = Math.max(0, actifs - inclus);

  let appels: EtatAbonnement["appels"] = null;
  if (moduleVocal) {
    const mois = moisCalendaireParis(new Date());
    const utilises = await appelsDuMois(tenantId, mois);
    appels = {
      utilises,
      inclus: moduleVocal.appelsInclus,
      depassement: Math.max(0, utilises - moduleVocal.appelsInclus),
      prixDepassementCents: moduleVocal.prixAppelSuppCents ?? 0,
      mois,
    };
  }

  return {
    plan,
    moduleVocal,
    subscription: sub,
    statut: sub.statut as EtatAbonnement["statut"],
    utilisateurs: {
      actifs,
      inclus,
      supplementaires,
      prixSupplementaireCents: plan.prixUtilisateurSuppCents,
    },
    appels,
  };
}
