/**
 * Plans d'écriture — LE seul chemin par lequel une écriture agentique passe.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║  intention → résolution → PLAN → validation humaine → exécution           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *
 * La voix et l'agent conversationnel y passent tous les deux. Deux chemins
 * d'écriture, ce sont deux endroits où oublier la validation — et sur un
 * produit vocal ce n'est pas une question de conformité : si la transcription
 * entend « Dupont » au lieu de « Dubois », l'erreur est écrite avant que
 * l'artisan l'ait vue.
 *
 * ── AJOUTER UN TYPE D'INTENTION N+1 ─────────────────────────────────────────
 * (équipe/planning couvre `declarer_absence`/`affecter_membre` ; factures,
 * devis, catalogue, clients… restent à faire, un lot à la fois.)
 *
 *  1. `lib/shared/src/intentionVocale.ts` — nouveau schéma `.strict()`
 *     (mentions texte uniquement, jamais d'id ni de nombre), ajouté à
 *     l'union `Intention` et à `TYPES_INTENTION`.
 *  2. `libelleOperation` ci-dessous — un `case` (protégé par le compilateur :
 *     fonction qui retourne `string`, `noImplicitReturns` voit un oubli).
 *  3. `chargerContexte`/`ContexteResolution` — si le type doit résoudre un
 *     nom existant, ajouter la liste de candidats correspondante.
 *  4. `construirePlan` — un bloc `if` explicite AVANT le repli générique du
 *     bas. Ne pas le laisser y retomber : le repli suppose un champ
 *     `libelle` que le nouveau type n'a probablement pas.
 *  5. `executerOperation` — un `case`, écriture réelle. Si la table cible
 *     n'a pas de FK sur l'id référencé (vérifier au cas par cas — c'était le
 *     cas d'`affectations`, pas d'`absences`), ajouter une vérification
 *     d'existence explicite avant d'écrire. Le `default: never` en bas de ce
 *     switch attrapera désormais un `case` oublié À LA COMPILATION — avant
 *     ce lot, cette fonction retournait `void` et un `case` manquant
 *     no-opait EN SILENCE, sans erreur, sans ligne écrite.
 *  6. Optionnel, pour la parité agent de chat : `mistralAgent.ts` — un outil
 *     dans `TOOLS` (+ un outil de lecture `list_*` si le modèle n'a pas déjà
 *     l'id), le nom ajouté à `OUTILS_ECRITURE`, un `case` dans
 *     `proposerEcriture`. Étendre le test qui vérifie que chaque outil
 *     produit son propre type d'opération (`voix.test.ts`, bloc « g »).
 *  7. `routes/voix.ts` → `consigne()` — une ligne SEULEMENT si le type a sa
 *     propre liste blanche dictable (comme les statuts ou les types
 *     d'absence) ; `TYPES_INTENTION.join(", ")` couvre déjà le nom du type.
 *  8. Tests : aller-retour, une ambiguïté, une isolation tenant, et — si
 *     exposé côté agent — l'aller-retour outil de chat. Une branche
 *     `voix-test-<nouveau-type>` dans `vitest.setup.ts`.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  withTenant,
  pendingActionsTable,
  affairesTable,
  prospectsTable,
  echeancesTable,
  classeurTable,
  activityTable,
  absencesTable,
  affectationsTable,
  teamMembersTable,
} from "@workspace/db";
import {
  type Intention,
  type Candidat,
  type Resolution,
  resoudreMention,
  interpreterDate,
  toDateString,
} from "@nodaq/shared";

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/** Une heure. Au-delà, les données du tenant ont pu changer sous le plan. */
export const DUREE_VALIDITE_PLAN_MS = 60 * 60 * 1000;

export const TYPE_PLAN = "PLAN_VOCAL";

// ── Ce qu'un plan contient ───────────────────────────────────────────────────

export interface OperationPlanifiee {
  readonly type: Intention["type"];
  /** Lisible par un artisan : « Créer l'affaire Carrelage Dupont ». */
  readonly libelle: string;
  /** Les champs résolus, prêts à écrire. Aucun montant, aucun prix. */
  readonly champs: Record<string, string | null>;
  /** Ce que la résolution a donné, pour chaque mention rapprochée. */
  readonly certitude: "exacte" | "partielle" | "aucune_resolution";
}

export interface QuestionPlan {
  readonly question: string;
  readonly candidats: readonly Candidat[];
  /** Ce qui était dicté, pour que l'écran puisse le rappeler. */
  readonly mention: string;
}

export interface Plan {
  readonly operations: readonly OperationPlanifiee[];
  readonly questions: readonly QuestionPlan[];
  readonly nonCompris: readonly string[];
}

// ── Construction ─────────────────────────────────────────────────────────────

/** Ce que le serveur connaît du tenant au moment de résoudre. */
export interface ContexteResolution {
  readonly affaires: readonly Candidat[];
  readonly membres: readonly Candidat[];
}

export async function chargerContexte(tenantId: string): Promise<ContexteResolution> {
  return withTenant(tenantId, async (tx) => {
    const affaires = await tx.select({ id: affairesTable.id, libelle: affairesTable.label }).from(affairesTable);
    const membres = await tx.select({ id: teamMembersTable.id, libelle: teamMembersTable.name }).from(teamMembersTable);
    return { affaires, membres };
  });
}

function libelleOperation(intention: Intention): string {
  switch (intention.type) {
    case "creer_affaire":
      return `Créer l'affaire « ${intention.label} »`;
    case "creer_prospect":
      return `Créer le prospect « ${intention.nom} »`;
    case "maj_statut_affaire":
      return `Passer « ${intention.affaireMentionnee} » en ${intention.statut}`;
    case "creer_echeance":
      return `Créer l'échéance « ${intention.libelle} »`;
    case "creer_entree_classeur":
      return `Classer « ${intention.titre} »`;
    case "consigner_activite":
      return `Consigner « ${intention.libelle} »`;
    case "declarer_absence":
      return `Déclarer ${intention.typeAbsence} pour « ${intention.membreMentionne} »`;
    case "affecter_membre":
      return `Affecter « ${intention.membreMentionne} » sur « ${intention.affaireMentionnee} »`;
  }
}

/** Journée standard appliquée aux affectations dictées — jamais un nombre dicté (règle 3 du dépôt). */
const HEURES_PAR_JOUR_DEFAUT = 7;

/**
 * Transforme des intentions en plan.
 *
 * UNE AMBIGUÏTÉ PRODUIT UNE QUESTION ET AUCUNE OPÉRATION. Elle ne se tranche
 * ni par un tirage au sort, ni par le modèle : lui n'a jamais vu les deux
 * Dupont, il ne peut que deviner.
 */
export function construirePlan(
  intentions: readonly Intention[],
  nonCompris: readonly string[],
  contexte: ContexteResolution,
  aujourdhui: Date = new Date(),
): Plan {
  const operations: OperationPlanifiee[] = [];
  const questions: QuestionPlan[] = [];
  const incompris = [...nonCompris];

  for (const intention of intentions) {
    if (intention.type === "maj_statut_affaire") {
      const r: Resolution = resoudreMention(intention.affaireMentionnee, contexte.affaires);
      if (r.etat === "ambigu") {
        questions.push({
          question: `Quelle affaire « ${intention.affaireMentionnee} » ?`,
          candidats: r.candidats,
          mention: intention.affaireMentionnee,
        });
        continue;
      }
      if (r.etat === "introuvable") {
        // Ni opération ni question : on ne peut pas proposer de choix quand il
        // n'y a aucun candidat. L'écran le dira comme un non-compris.
        incompris.push(`affaire « ${intention.affaireMentionnee} » introuvable`);
        continue;
      }
      operations.push({
        type: intention.type,
        libelle: `Passer « ${r.candidat.libelle} » en ${intention.statut}`,
        champs: { affaireId: r.candidat.id, statut: intention.statut },
        certitude: r.certitude,
      });
      continue;
    }

    if (intention.type === "creer_echeance") {
      // Une date non comprise ne devient PAS aujourd'hui : elle reste nulle et
      // l'écran demandera. Poser une échéance à une date que personne n'a dite
      // serait pire que ne rien poser.
      const date = intention.dateMentionnee
        ? interpreterDate(intention.dateMentionnee, aujourdhui)
        : null;
      // `echeances.due_date` est NOT NULL : sans date comprise, l'opération
      // n'est pas créable. On la déclare non comprise plutôt que d'inventer
      // une date — c'est exactement le silence que le plan ne doit pas faire.
      if (date === null) {
        incompris.push(
          intention.dateMentionnee
            ? `échéance « ${intention.libelle} » : date « ${intention.dateMentionnee} » non comprise`
            : `échéance « ${intention.libelle} » : aucune date dictée`,
        );
        continue;
      }
      operations.push({
        type: intention.type,
        libelle: `${libelleOperation(intention)} au ${date}`,
        champs: { libelle: intention.libelle, date },
        certitude: "aucune_resolution",
      });
      continue;
    }

    if (intention.type === "creer_affaire") {
      const dateDebut = intention.dateDebutMentionnee
        ? interpreterDate(intention.dateDebutMentionnee, aujourdhui)
        : null;
      if (intention.dateDebutMentionnee && dateDebut === null) {
        incompris.push(`date « ${intention.dateDebutMentionnee} » non comprise`);
      }
      operations.push({
        type: intention.type,
        libelle: libelleOperation(intention),
        champs: {
          label: intention.label,
          clientNom: intention.clientMentionne ?? null,
          ville: intention.villeMentionnee ?? null,
          dateDebut,
        },
        certitude: "aucune_resolution",
      });
      continue;
    }

    if (intention.type === "creer_prospect") {
      operations.push({
        type: intention.type,
        libelle: libelleOperation(intention),
        champs: {
          nom: intention.nom,
          telephone: intention.telephoneMentionne ?? null,
          ville: intention.villeMentionnee ?? null,
        },
        certitude: "aucune_resolution",
      });
      continue;
    }

    if (intention.type === "creer_entree_classeur") {
      operations.push({
        type: intention.type,
        libelle: libelleOperation(intention),
        champs: { titre: intention.titre, categorie: intention.categorieMentionnee ?? null },
        certitude: "aucune_resolution",
      });
      continue;
    }

    if (intention.type === "declarer_absence") {
      const rMembre = resoudreMention(intention.membreMentionne, contexte.membres);
      if (rMembre.etat === "ambigu") {
        questions.push({
          question: `Quel membre « ${intention.membreMentionne} » ?`,
          candidats: rMembre.candidats,
          mention: intention.membreMentionne,
        });
        continue;
      }
      if (rMembre.etat === "introuvable") {
        incompris.push(`membre « ${intention.membreMentionne} » introuvable`);
        continue;
      }
      const dateDebut = interpreterDate(intention.dateDebutMentionnee, aujourdhui);
      if (dateDebut === null) {
        incompris.push(
          `absence de « ${rMembre.candidat.libelle} » : date « ${intention.dateDebutMentionnee} » non comprise`,
        );
        continue;
      }
      const dateFin = intention.dateFinMentionnee
        ? interpreterDate(intention.dateFinMentionnee, aujourdhui)
        : dateDebut;
      if (dateFin === null) {
        incompris.push(
          `absence de « ${rMembre.candidat.libelle} » : date de fin « ${intention.dateFinMentionnee} » non comprise`,
        );
        continue;
      }
      if (dateFin < dateDebut) {
        incompris.push(`absence de « ${rMembre.candidat.libelle} » : la date de fin précède la date de début`);
        continue;
      }
      const periode = dateDebut === dateFin ? `le ${dateDebut}` : `du ${dateDebut} au ${dateFin}`;
      operations.push({
        type: intention.type,
        libelle: `Déclarer ${intention.typeAbsence} pour « ${rMembre.candidat.libelle} » ${periode}`,
        champs: { membreId: rMembre.candidat.id, typeAbsence: intention.typeAbsence, dateDebut, dateFin },
        certitude: rMembre.certitude,
      });
      continue;
    }

    if (intention.type === "affecter_membre") {
      const rMembre = resoudreMention(intention.membreMentionne, contexte.membres);
      if (rMembre.etat === "ambigu") {
        questions.push({
          question: `Quel membre « ${intention.membreMentionne} » ?`,
          candidats: rMembre.candidats,
          mention: intention.membreMentionne,
        });
        continue;
      }
      if (rMembre.etat === "introuvable") {
        incompris.push(`membre « ${intention.membreMentionne} » introuvable`);
        continue;
      }
      const rAffaire = resoudreMention(intention.affaireMentionnee, contexte.affaires);
      if (rAffaire.etat === "ambigu") {
        questions.push({
          question: `Quelle affaire « ${intention.affaireMentionnee} » ?`,
          candidats: rAffaire.candidats,
          mention: intention.affaireMentionnee,
        });
        continue;
      }
      if (rAffaire.etat === "introuvable") {
        incompris.push(`affaire « ${intention.affaireMentionnee} » introuvable`);
        continue;
      }
      const dateDebut = interpreterDate(intention.dateDebutMentionnee, aujourdhui);
      if (dateDebut === null) {
        incompris.push(
          `affectation de « ${rMembre.candidat.libelle} » : date « ${intention.dateDebutMentionnee} » non comprise`,
        );
        continue;
      }
      const dateFin = intention.dateFinMentionnee
        ? interpreterDate(intention.dateFinMentionnee, aujourdhui)
        : dateDebut;
      if (dateFin === null) {
        incompris.push(
          `affectation de « ${rMembre.candidat.libelle} » : date de fin « ${intention.dateFinMentionnee} » non comprise`,
        );
        continue;
      }
      if (dateFin < dateDebut) {
        incompris.push(`affectation de « ${rMembre.candidat.libelle} » : la date de fin précède la date de début`);
        continue;
      }
      const periode = dateDebut === dateFin ? `le ${dateDebut}` : `du ${dateDebut} au ${dateFin}`;
      operations.push({
        type: intention.type,
        libelle:
          `Affecter « ${rMembre.candidat.libelle} » sur « ${rAffaire.candidat.libelle} » ${periode} ` +
          `(${HEURES_PAR_JOUR_DEFAUT} h/jour)`,
        champs: {
          membreId: rMembre.candidat.id,
          affaireId: rAffaire.candidat.id,
          dateDebut,
          dateFin,
          heuresParJour: String(HEURES_PAR_JOUR_DEFAUT),
        },
        certitude: rMembre.certitude === "exacte" && rAffaire.certitude === "exacte" ? "exacte" : "partielle",
      });
      continue;
    }

    operations.push({
      type: intention.type,
      libelle: libelleOperation(intention),
      champs: { libelle: intention.libelle },
      certitude: "aucune_resolution",
    });
  }

  // Une seule question à la fois : trancher deux ambiguïtés d'un coup demande
  // à l'artisan de tenir deux choix en tête pendant qu'il conduit.
  return { operations, questions: questions.slice(0, 1), nonCompris: incompris };
}

// ── Persistance ──────────────────────────────────────────────────────────────

/** Résumé d'une ligne de plan, lisible dans la file de validation existante. */
function resumer(plan: Plan): string {
  if (plan.operations.length === 0) return "Rien à appliquer";
  const premier = plan.operations[0]!.libelle;
  return plan.operations.length === 1
    ? premier
    : `${premier} (+${plan.operations.length - 1})`;
}

export async function enregistrerPlan(tenantId: string, plan: Plan): Promise<string> {
  const [ligne] = await withTenant(tenantId, (tx) =>
    tx
      .insert(pendingActionsTable)
      .values({
        tenantId,
        type: TYPE_PLAN,
        status: "EN_ATTENTE",
        label: resumer(plan),
        description: plan.operations.map((o) => o.libelle).join(" · ") || null,
        payload: plan,
        expireLe: new Date(Date.now() + DUREE_VALIDITE_PLAN_MS),
      })
      .returning({ id: pendingActionsTable.id }),
  );
  return ligne!.id;
}

// ── Exécution ────────────────────────────────────────────────────────────────

async function executerOperation(
  tx: Tx,
  tenantId: string,
  op: OperationPlanifiee,
): Promise<void> {
  switch (op.type) {
    case "creer_affaire": {
      await tx.insert(affairesTable).values({
        tenantId,
        label: op.champs["label"]!,
        status: "PROSPECT",
        ...(op.champs["clientNom"] ? { clientName: op.champs["clientNom"] } : {}),
        ...(op.champs["dateDebut"] ? { startDate: op.champs["dateDebut"] } : {}),
      });
      return;
    }
    case "creer_prospect": {
      await tx.insert(prospectsTable).values({
        tenantId,
        name: op.champs["nom"]!,
        stage: "NOUVEAU",
        ...(op.champs["telephone"] ? { phone: op.champs["telephone"] } : {}),
      });
      return;
    }
    case "maj_statut_affaire": {
      const affaireId = op.champs["affaireId"]!;
      const statut = op.champs["statut"]!;
      const [maj] = await tx
        .update(affairesTable)
        .set({
          status: statut,
          ...(statut === "TERMINEE" ? { completedAt: toDateString(new Date()) } : {}),
        })
        .where(eq(affairesTable.id, affaireId))
        .returning();
      // Une opération qui ne trouve plus sa cible fait ÉCHOUER tout le plan :
      // le plan a été construit sur un état qui n'existe plus, et en appliquer
      // la moitié laisserait l'artisan croire que tout est passé.
      if (!maj) throw new Error(`Affaire ${affaireId} introuvable`);
      return;
    }
    case "creer_echeance": {
      await tx.insert(echeancesTable).values({
        tenantId,
        // Le TYPE fiscal n'est pas dictable : le modèle n'a pas à décider
        // qu'une échéance est de la TVA ou de l'URSSAF. L'artisan le précise
        // après coup, sur l'écran des échéances.
        type: "AUTRE",
        label: op.champs["libelle"]!,
        dueDate: op.champs["date"]!,
      });
      return;
    }
    case "creer_entree_classeur": {
      await tx.insert(classeurTable).values({
        tenantId,
        name: op.champs["titre"]!,
        ...(op.champs["categorie"] ? { category: op.champs["categorie"] } : {}),
      });
      return;
    }
    case "consigner_activite": {
      await tx.insert(activityTable).values({
        tenantId,
        type: "voix",
        label: op.champs["libelle"]!,
      });
      return;
    }
    case "declarer_absence": {
      await tx.insert(absencesTable).values({
        tenantId,
        membreId: op.champs["membreId"]!,
        type: op.champs["typeAbsence"]!,
        dateDebut: op.champs["dateDebut"]!,
        dateFin: op.champs["dateFin"]!,
      });
      return;
    }
    case "affecter_membre": {
      const affaireId = op.champs["affaireId"]!;
      const membreId = op.champs["membreId"]!;
      // affectations n'a AUCUNE contrainte FK sur affaire_id / membre_id
      // (contrairement à absences.membre_id) : une cible disparue entre la
      // construction du plan et son exécution (jusqu'à une heure plus tard,
      // DUREE_VALIDITE_PLAN_MS) s'insérerait sans erreur si on ne vérifie pas
      // ici. Même garantie que maj_statut_affaire ci-dessus.
      const [affaire] = await tx.select({ id: affairesTable.id }).from(affairesTable).where(eq(affairesTable.id, affaireId));
      if (!affaire) throw new Error(`Affaire ${affaireId} introuvable`);
      const [membre] = await tx.select({ id: teamMembersTable.id }).from(teamMembersTable).where(eq(teamMembersTable.id, membreId));
      if (!membre) throw new Error(`Membre ${membreId} introuvable`);

      await tx.insert(affectationsTable).values({
        tenantId,
        affaireId,
        membreId,
        dateDebut: op.champs["dateDebut"]!,
        dateFin: op.champs["dateFin"]!,
        heuresParJour: op.champs["heuresParJour"]!,
        joursOuvresSeulement: true,
      });
      return;
    }
    default: {
      // Garde de compilation : un type d'intention ajouté à l'union sans son
      // `case` ici ne doit PAS silencieusement no-oper — c'était, jusqu'à ce
      // lot, le seul switch de ce fichier sans protection : cette fonction
      // retourne `void`, donc `noImplicitReturns` ne voit rien à reprocher à
      // un `case` manquant. `never` force l'échec de build à la place.
      const _exhaustif: never = op.type;
      throw new Error(`Type d'opération non géré : ${String(_exhaustif)}`);
    }
  }
}

export type ResultatExecution =
  | { readonly kind: "introuvable" }
  | { readonly kind: "expire" }
  | { readonly kind: "deja_applique"; readonly executeLe: Date }
  | { readonly kind: "ok"; readonly nbOperations: number };

/**
 * Exécute un plan, relu DEPUIS LA BASE.
 *
 * Jamais depuis le corps de la requête : un plan renvoyé par le navigateur est
 * un plan modifiable par le navigateur, et l'écran de validation ne prouverait
 * plus rien.
 *
 * Toutes les opérations dans UNE transaction : si l'une échoue, aucune n'est
 * écrite. Un plan à moitié appliqué est le pire résultat — l'artisan croit
 * avoir tout dicté.
 */
export async function executerPlan(tenantId: string, planId: string): Promise<ResultatExecution> {
  return withTenant(tenantId, async (tx) => {
    const [ligne] = await tx
      .select()
      .from(pendingActionsTable)
      .where(and(eq(pendingActionsTable.id, planId), eq(pendingActionsTable.type, TYPE_PLAN)));

    if (!ligne) return { kind: "introuvable" as const };
    if (ligne.executeLe) return { kind: "deja_applique" as const, executeLe: ligne.executeLe };
    if (ligne.expireLe && ligne.expireLe.getTime() < Date.now()) {
      return { kind: "expire" as const };
    }

    const plan = ligne.payload as Plan | null;
    const operations = plan?.operations ?? [];

    // Le marquage se fait AVANT les écritures, sous condition `executeLe IS
    // NULL` : deux requêtes simultanées passent le contrôle ci-dessus, mais
    // une seule pose la marque. La seconde ne trouve rien à mettre à jour et
    // n'écrit donc aucune opération.
    const [reserve] = await tx
      .update(pendingActionsTable)
      .set({ executeLe: new Date(), status: "VALIDEE", decidedAt: new Date() })
      .where(and(eq(pendingActionsTable.id, planId), isNull(pendingActionsTable.executeLe)))
      .returning({ id: pendingActionsTable.id });
    if (!reserve) return { kind: "deja_applique" as const, executeLe: new Date() };

    for (const op of operations) {
      await executerOperation(tx, tenantId, op);
    }

    return { kind: "ok" as const, nbOperations: operations.length };
  });
}

/** Purge des plans expirés jamais validés. */
export async function purgerPlansExpires(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    const res = await tx.execute(sql`
      DELETE FROM pending_actions
       WHERE type = ${TYPE_PLAN}
         AND execute_le IS NULL
         AND expire_le IS NOT NULL
         AND expire_le < NOW()
    `);
    return (res as unknown as { rowCount?: number }).rowCount ?? 0;
  });
}
