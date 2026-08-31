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
 * « 4/10 dossiers ce mois-ci » compte les DOSSIERS : les impayés distincts
 * relancés dans le mois calendaire de PARIS (un dossier = un impayé, jamais
 * une tentative — trois rappels sur la même facture font UN dossier, 4.43).
 * Dérivé d'`appels_relance` (started_at posé), clé facture_id — ou
 * l'empreinte du numéro quand la facture a disparu. Un compteur matérialisé
 * finirait par mentir ; celui-ci ne peut pas diverger de la table qui fait
 * foi. Seul le FRANCHISSEMENT du seuil d'alerte laisse une trace
 * (usage_franchissements, append-only, unique par tenant/usage/mois/seuil).
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
  essaiJalonsTable,
  journalDecisionsTable,
  appelsRelanceTable,
  membershipsTable,
  usersTable,
  activityTable,
  type Plan,
  type Subscription,
} from "@workspace/db";
import {
  ESSAI_JOURS,
  ESSAI_JOUR_DEMANDE_CARTE,
  ESSAI_JOUR_ACTIVATION,
  SEUIL_ALERTE_USAGE_PCT,
  ROLES_COMPTES_DANS_LA_LIMITE,
  moisCalendaireParis,
} from "@nodaq/shared";
import { sendDocument } from "./canal-emission.js";

/** Transaction Drizzle telle que `withTenant` la donne. */
type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

export interface EtatAbonnement {
  readonly plan: Plan;
  readonly moduleVocal: Plan | null;
  readonly subscription: Subscription;
  /** Statut APRÈS constat d'échéance d'essai — jamais un TRIAL périmé. */
  readonly statut: "TRIAL" | "ACTIVE" | "READONLY" | "EN_ATTENTE";
  readonly utilisateurs: {
    readonly actifs: number;
    readonly inclus: number;
    readonly supplementaires: number;
    readonly prixSupplementaireCents: number | null;
  };
  readonly dossiers: {
    readonly utilises: number;
    readonly inclus: number;
    readonly depassement: number;
    readonly prixDepassementCents: number;
    readonly mois: string;
  } | null;
  /** Présent pendant l'essai : ce que le bandeau et les jalons affichent. */
  readonly essai: {
    readonly joursRestants: number;
    /** TRUE à partir du jour 10 — jamais avant (4.43 §5). */
    readonly demanderCarte: boolean;
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
 * Crée l'abonnement d'un tenant neuf. Appelé dans LA transaction de création
 * du tenant (authService) : un tenant sans abonnement n'existe pas.
 *
 * ── PLUS D'ESSAI GRATUIT (décision fondateur, 31/08/2026) ───────────────────
 *
 * Les 50 places Fondateurs à 29 €/mois se paient dès l'inscription. Une
 * poignée de TPE sélectionnées à la main sont offertes — mais par DÉROGATION
 * DE REMISE sur leur ligne, pas par un essai : la place est consommée, le prix
 * est verrouillé, et la gratuité se lit dans la donnée plutôt que de se
 * deviner d'un statut.
 *
 * Le plan reste `equipe` tant que la souscription n'a pas eu lieu : il fixe
 * les LIMITES visibles (5 sièges), pas ce qui est dû. Rien n'est facturé en
 * EN_ATTENTE.
 *
 * `trialEndsAt` reste NUL, et c'est ce qui compte : le constat paresseux
 * TRIAL → READONLY est gardé par `statut = 'TRIAL'`, donc il ne touchera
 * jamais une ligne EN_ATTENTE. Aucune date ne court, rien n'expire.
 */
export function creerAbonnementEnAttente(tx: Tx, tenantId: string): Promise<unknown> {
  return tx.insert(subscriptionsTable).values({
    tenantId,
    planId: "equipe",
    statut: "EN_ATTENTE",
  });
}

/**
 * L'abonnement courant, échéance d'essai constatée. S'il n'existe pas (tenant
 * antérieur au backfill de la 065 — ne devrait pas arriver), il est créé
 * EN_ATTENTE plutôt que de rendre une erreur : l'absence d'abonnement n'est
 * pas une faute de l'utilisateur.
 *
 * Le constat TRIAL → READONLY reste en place et ne concerne QUE les essais
 * déjà en cours au 31/08/2026. Un essai accordé est une promesse faite : la
 * révoquer par migration l'aurait rompue sans prévenir. Ils s'éteignent
 * d'eux-mêmes ; aucune inscription nouvelle n'en ouvre.
 */
export async function abonnementCourant(tenantId: string): Promise<Subscription> {
  return withTenant(tenantId, async (tx) => {
    let [sub] = await tx
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.tenantId, tenantId));

    if (!sub) {
      await creerAbonnementEnAttente(tx, tenantId);
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

/**
 * Dossiers de relance du mois : les IMPAYÉS DISTINCTS ayant eu au moins une
 * tentative réellement composée (started_at posé) dans le mois de Paris. La
 * clé du dossier est la facture ; quand elle a disparu (client supprimé,
 * l'appel reste comptable — doctrine appels_relance), l'empreinte du numéro
 * prend le relais. Les tentatives ne décomptent JAMAIS rien : trois rappels
 * sur le même impayé font un seul dossier (4.43 §1).
 */
export async function dossiersDuMois(tenantId: string, mois: string): Promise<number> {
  const [ligne] = await withTenant(tenantId, (tx) =>
    tx
      .select({
        n: sql<number>`count(distinct coalesce(${appelsRelanceTable.factureId}, 'tel:' || ${appelsRelanceTable.empreinteNumero}))::int`,
      })
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
 * Constate le franchissement du seuil d'alerte d'un usage — au moment où le
 * compteur avance, pas quand quelqu'un regarde l'écran (même doctrine que
 * franchissement-objectifs : un horodatage de lecture ne veut rien dire).
 * L'unicité (tenant, usage, mois, seuil) fait qu'une seule des écritures
 * concurrentes laisse une trace, et elle seule annonce.
 */
export async function constaterFranchissementUsage(
  tx: Tx,
  tenantId: string,
  usage: "vocal" | "whatsapp",
  mois: string,
  utilises: number,
  inclus: number,
): Promise<void> {
  if (inclus <= 0 || utilises * 100 < SEUIL_ALERTE_USAGE_PCT * inclus) return;
  const inseres = (await tx
    .insert(usageFranchissementsTable)
    .values({ tenantId, usage, mois, seuilPct: SEUIL_ALERTE_USAGE_PCT })
    .onConflictDoNothing()
    .returning({ id: usageFranchissementsTable.id })) as Array<{ id: string }>;
  if (inseres.length === 0) return;
  await tx.insert(activityTable).values({
    tenantId,
    type: "abonnement.usage_seuil",
    label:
      usage === "vocal"
        ? `Relance vocale : ${utilises} dossiers sur ${inclus} inclus ce mois-ci (${SEUIL_ALERTE_USAGE_PCT} % atteints). Au-delà, chaque dossier supplémentaire est compté et facturé — jamais coupé.`
        : `Relances WhatsApp : ${utilises} conversations sur ${inclus} incluses ce mois-ci. Au-delà, rien n'est bloqué — l'usage est simplement signalé.`,
    meta: JSON.stringify({ usage, mois, utilises, inclus }),
  });
}

/**
 * Constate l'usage vocal du mois au démarrage d'un appel — le seul moment où
 * le compteur peut avancer (un dossier n'avance que si l'impayé n'avait pas
 * encore été relancé ce mois-ci). Sans module actif, rien à constater.
 */
export async function constaterUsageVocal(tenantId: string): Promise<void> {
  const sub = await abonnementCourant(tenantId);
  if (!sub.moduleVocal) return;
  const module = await planParId("module_vocal");
  const mois = moisCalendaireParis(new Date());
  const utilises = await dossiersDuMois(tenantId, mois);
  await withTenant(tenantId, (tx) =>
    constaterFranchissementUsage(tx, tenantId, "vocal", mois, utilises, module.dossiersInclus),
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

  let dossiers: EtatAbonnement["dossiers"] = null;
  if (moduleVocal) {
    const mois = moisCalendaireParis(new Date());
    const utilises = await dossiersDuMois(tenantId, mois);
    dossiers = {
      utilises,
      inclus: moduleVocal.dossiersInclus,
      depassement: Math.max(0, utilises - moduleVocal.dossiersInclus),
      prixDepassementCents: moduleVocal.prixDossierSuppCents ?? 0,
      mois,
    };
  }

  let essai: EtatAbonnement["essai"] = null;
  if (sub.statut === "TRIAL" && sub.trialEndsAt) {
    const joursRestants = Math.max(
      0,
      Math.ceil((sub.trialEndsAt.getTime() - Date.now()) / 86_400_000),
    );
    essai = {
      joursRestants,
      demanderCarte: ESSAI_JOURS - joursRestants >= ESSAI_JOUR_DEMANDE_CARTE,
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
    dossiers,
    essai,
  };
}

// ── Jalons d'essai (4.43 §5) ────────────────────────────────────────────────
//
// Constatés PARESSEUSEMENT, à l'activité du tenant (lecture de l'abonnement,
// requêtes mutantes) — ce dépôt n'a pas d'ordonnanceur, et c'est assumé : un
// tenant totalement absent ne recevra le jalon qu'à son retour. L'unicité
// (tenant, jalon) de la table essai_jalons garantit qu'un jalon constaté en
// concurrence ne part qu'une fois. La carte n'est JAMAIS demandée avant J10.

/** Les adresses des propriétaires — destinataires des e-mails de jalon. */
async function emailsProprietaires(tenantId: string): Promise<string[]> {
  const lignes = await db
    .select({ email: usersTable.email })
    .from(membershipsTable)
    .innerJoin(usersTable, eq(usersTable.id, membershipsTable.userId))
    .where(and(eq(membershipsTable.tenantId, tenantId), eq(membershipsTable.role, "OWNER")));
  return lignes.map((l) => l.email);
}

/** Une action proposée par l'assistant a-t-elle déjà été VALIDÉE ? La preuve
 *  vit dans journal_decisions (immuable), pas dans la file de travail. */
async function aValideUneAction(tenantId: string): Promise<boolean> {
  const [ligne] = await withTenant(tenantId, (tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(journalDecisionsTable)
      .where(
        and(
          eq(journalDecisionsTable.tenantId, tenantId),
          eq(journalDecisionsTable.decision, "APPROUVEE"),
        ),
      ),
  );
  return (ligne?.n ?? 0) > 0;
}

async function poserJalon(
  tenantId: string,
  jalon: "J7_ACTIVATION" | "J10_CARTE",
): Promise<boolean> {
  const inseres = (await withTenant(tenantId, (tx) =>
    tx
      .insert(essaiJalonsTable)
      .values({ tenantId, jalon })
      .onConflictDoNothing()
      .returning({ id: essaiJalonsTable.id }),
  )) as Array<{ id: string }>;
  return inseres.length > 0;
}

/**
 * Constate les jalons d'essai dus, et envoie ce qui doit l'être. Sans effet
 * hors essai. Chaque jalon ne part qu'une fois (unicité en base) ; l'e-mail
 * est envoyé APRÈS la pose du jalon — un envoi qui échoue ne sera pas rejoué,
 * plutôt qu'un envoi en double, et le bandeau à l'écran couvre le J10.
 */
export async function constaterJalonsEssai(tenantId: string): Promise<void> {
  const sub = await abonnementCourant(tenantId);
  if (sub.statut !== "TRIAL" || !sub.trialEndsAt) return;
  const joursRestants = Math.ceil((sub.trialEndsAt.getTime() - Date.now()) / 86_400_000);
  const jourDeLEssai = ESSAI_JOURS - joursRestants;

  // J10 — la demande de carte : un message de continuité, pas une menace.
  // Structurellement impossible avant le jour 10 (interdit du ticket).
  if (jourDeLEssai >= ESSAI_JOUR_DEMANDE_CARTE) {
    if (await poserJalon(tenantId, "J10_CARTE")) {
      await withTenant(tenantId, (tx) =>
        tx.insert(activityTable).values({
          tenantId,
          type: "abonnement.essai_carte",
          label: `Ton essai se termine dans ${Math.max(0, joursRestants)} jours. Ajoute ta carte pour que tes relances en cours continuent de tourner.`,
          meta: JSON.stringify({ jourDeLEssai, joursRestants }),
        }),
      );
      for (const email of await emailsProprietaires(tenantId)) {
        await sendDocument({
          canal: "EMAIL",
          tenantId,
          to: email,
          subject: "Ton essai nodaq se termine bientôt",
          body: `Bonjour,\n\nTon essai se termine dans ${Math.max(0, joursRestants)} jours. Ajoute ta carte pour que tes relances en cours continuent de tourner — tout est prêt dans Réglages → Abonnement.\n\nSi tu ne fais rien, ton espace passera simplement en lecture seule : aucune donnée ne sera supprimée.\n\nÀ bientôt,\nnodaq`,
          documentType: "ESSAI",
          documentId: `essai-j10-${tenantId}`,
        });
      }
    }
    return;
  }

  // J7 — l'e-mail d'activation, SEULEMENT si aucune action proposée par
  // l'assistant n'a été validée : quelqu'un qui relance déjà n'a pas besoin
  // qu'on lui montre la relance.
  if (jourDeLEssai >= ESSAI_JOUR_ACTIVATION && !(await aValideUneAction(tenantId))) {
    if (await poserJalon(tenantId, "J7_ACTIVATION")) {
      for (const email of await emailsProprietaires(tenantId)) {
        await sendDocument({
          canal: "EMAIL",
          tenantId,
          to: email,
          subject: "On te montre la relance en 10 minutes ?",
          body: `Bonjour,\n\nTu n'as pas encore testé la relance — réponds à ce mail et on te montre en 10 minutes.\n\nMoussa, fondateur de nodaq`,
          documentType: "ESSAI",
          documentId: `essai-j7-${tenantId}`,
        });
      }
    }
  }
}
