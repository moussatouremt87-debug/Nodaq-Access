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
  journalDecisionsTable,
  pointagesTable,
  clientsTable,
  facturesTable,
  paiementsTable,
  campagnesRelanceTable,
  catalogueLignesTable,
  catalogueAliasTable,
  devisTable,
  chargesRecurrentesTable,
  contratsTable,
} from "@workspace/db";
// `FactureLine` est le type le PLUS STRICT des deux (`vatRate` y est
// obligatoire) : construire avec lui satisfait aussi `DevisLine`, et évite
// deux constructions parallèles des mêmes lignes.
import type { FactureLine } from "@workspace/db";
import {
  type Intention,
  type Candidat,
  type Resolution,
  type AffaireWords,
  affaireWords,
  resoudreMention,
  interpreterDate,
  toDateString,
  champCorrigeable,
  champsManquants,
  rapprocherDictee,
  totalProposition,
  type CatalogueEntree,
  type AliasCatalogue,
  type LigneProposee,
  centimesDepuisDictee,
  CHAMPS_A_COMPLETER,
  type TypeIntention,
} from "@nodaq/shared";
import { verticalDepuisTx } from "./vertical-tenant.js";
import { conditionFactureEnRetardSql } from "./facturesEnRetard.js";
import { facturerDevis, messageRefusFacturation } from "./facturer-devis.js";
import { regleEnVigueur, TYPE_CAMPAGNE_RELANCE } from "./campagnes-relance.js";
import { recalculerFacture } from "./reglement-facture.js";
import { indexerAuClasseur, nomAuClasseur } from "./indexation-classeur.js";

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
  /**
   * Champs encore VIDES que l'écran doit réclamer avant de valider (lot 4).
   *
   * Presque toujours `[]`. Non vide quand la voix ne peut légitimement pas
   * porter la donnée : un prix de catalogue, un montant de charge ou de
   * contrat, que ni le modèle (règle 3) ni le serveur (rien à calculer) n'ont
   * le droit de produire. Le blocage à l'écran est un confort ;
   * `executerPlan` refuse de toute façon.
   */
  readonly aCompleter: readonly string[];
}

/**
 * Lit un champ que la voix a laissé vide et que l'humain devait remplir.
 *
 * C'est ICI que se tient la garde, pas dans le bouton grisé de l'écran : les
 * corrections voyagent depuis le navigateur et le plan attend en base jusqu'à
 * une heure. Un plan rejoué sans la correction doit échouer, pas écrire un
 * prix à zéro — un article de catalogue à 0 € contaminerait tous les devis
 * suivants sans rien signaler.
 *
 * L'unité est le CENTIME, comme partout dans ce dépôt. Accepter des euros ici
 * ferait diviser un montant par cent, en silence.
 */
function entierPositifRequis(
  op: { readonly type: string; readonly champs: Record<string, string | null> },
  champ: string,
): number {
  const brut = op.champs[champ];
  if (brut === null || brut === undefined || brut.trim() === "") {
    throw new Error(
      `Le champ « ${champ} » doit être renseigné avant de valider — la dictée ne le fournit pas.`,
    );
  }
  const n = Number(brut);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`Le champ « ${champ} » attend un entier de centimes, positif.`);
  }
  return n;
}

/**
 * Les champs réclamés qui empêchent encore d'écrire, et pourquoi.
 *
 * Portée volontairement étroite : uniquement les champs de
 * `CHAMPS_A_COMPLETER`, c'est-à-dire ceux que la voix laisse vides par
 * construction. Les autres champs corrigés gardent leur validation d'origine,
 * là où elle se trouve — élargir la règle ici en ferait une seconde
 * définition, à côté de la première.
 */
function verifierChampsASaisir(
  operations: readonly { readonly type: string; readonly champs: Record<string, string | null> }[],
): readonly { champ: string; motif: "vide" | "format" }[] {
  const vus = new Map<string, "vide" | "format">();
  for (const op of operations) {
    for (const champ of CHAMPS_A_COMPLETER[op.type as TypeIntention] ?? []) {
      const brut = op.champs[champ];
      if (brut === null || brut === undefined || brut.trim() === "") {
        vus.set(champ, "vide");
        continue;
      }
      // Entier de centimes, positif. Pas de virgule, pas de point : 45,00 et
      // 45.00 sont des EUROS, et les accepter diviserait le montant par cent.
      const n = Number(brut.trim());
      if (!Number.isInteger(n) || n < 0) vus.set(champ, "format");
    }
  }
  return [...vus].map(([champ, motif]) => ({ champ, motif }));
}

/** Des centimes, écrits comme l'artisan les lit. */
function euros(centimes: number): string {
  return `${(centimes / 100).toFixed(2)} €`;
}

/** Une opération avant que `aCompleter` n'en soit dérivé. Interne. */
type OperationBrute = Omit<OperationPlanifiee, "aCompleter">;

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
  /** Factures ÉMISES seules : une facture en brouillon ou déjà réglée n'a
   *  pas de règlement à recevoir, et l'offrir au rapprochement ferait
   *  proposer des cibles absurdes.
   *
   *  Chacune porte son SOLDE, calculé ici : c'est le montant que le plan
   *  proposera, et que l'écran laissera corriger. Le modèle n'en produit
   *  aucun (voir `IntentionEnregistrerReglement`). */
  readonly factures: readonly (Candidat & { readonly soldeCents: number })[];
  /** Devis ACCEPTÉS pas encore facturés — les seuls qu'on puisse facturer.
   *  Chacun porte son total TTC, pour que le plan annonce un montant que
   *  l'utilisateur reconnaît avant de valider. */
  readonly devisAFacturer: readonly (Candidat & { readonly totalTTCCents: number })[];
  /** Impayés joignables, et le compte de ceux qui ne le sont pas. */
  readonly impayes: {
    readonly joignables: readonly {
      clientId: string | null;
      factureId: string;
      montantCents: number;
      numero: string;
      clientNom: string;
    }[];
    readonly sansNumero: number;
  };
  /** Clients existants — pour normaliser le nom porté par un contrat.
   *  `contrats.clientName` est du TEXTE, pas une clé étrangère : le
   *  rapprochement ne sert donc qu'à écrire le nom tel qu'il existe déjà,
   *  et une mention introuvable reste écrite telle qu'elle a été dictée. */
  readonly clients: readonly Candidat[];
  /** Prospects encore ouverts — ni gagnés ni perdus. */
  readonly prospects: readonly Candidat[];
  /** Le catalogue tarifaire : LA source de prix d'un devis dicté (règle 3). */
  readonly catalogue: readonly CatalogueEntree[];
  /** Alias appris : « ba13 » → la ligne de catalogue « Cloison BA13 ». */
  readonly aliasCatalogue: AliasCatalogue;
  /** US-A6.1 — le mot du secteur, pour que les libellés soumis à validation
   *  parlent la langue de l'utilisateur (« Créer la mission … » plutôt que
   *  « Créer l'affaire … » chez un consultant). Porté par le contexte, déjà
   *  chargé par tenant, plutôt qu'ajouté en paramètre à `construirePlan` :
   *  c'est une donnée du tenant, comme les affaires et les membres. */
  readonly words: AffaireWords;
}


function libelleOperation(intention: Intention, words: AffaireWords): string {
  switch (intention.type) {
    case "creer_affaire":
      // `definite` porte l'article ACCORDÉ (« l'affaire », « la mission ») :
      // le genre appartient au vocabulaire, pas à une règle de langue
      // recalculée ici — voir AffaireWords dans verticalPacks.ts.
      return `Créer ${words.definite} « ${intention.label} »`;
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
    case "pointer_heures":
      return `Pointer ${intention.heures} h sur « ${intention.affaireMentionnee} »`;
    case "creer_client":
      return `Créer le client « ${intention.nom} »`;
    case "enregistrer_reglement":
      return `Enregistrer le règlement de « ${intention.factureMentionnee} »`;
    case "lancer_relance":
      return "Préparer une campagne de relance téléphonique";
    case "facturer_devis":
      return `Facturer le devis « ${intention.devisMentionne} »`;
    case "creer_article_catalogue":
      return `Ajouter au catalogue « ${intention.designation} »`;
    case "creer_charge_recurrente":
      return `Déclarer la charge ${intention.cadence}le « ${intention.libelle} »`;
    case "creer_contrat":
      return `Créer le contrat ${intention.cadence} « ${intention.libelle} »`;
    case "maj_etape_prospect":
      return `Passer « ${intention.prospectMentionne} » en ${intention.etape}`;
    case "creer_devis":
      return `Créer un devis de ${intention.lignes.length} ligne(s)`;
    case "creer_facture":
      return `Créer une facture de ${intention.lignes.length} ligne(s)`;
  }
}

/** Journée standard appliquée aux affectations dictées — jamais un nombre dicté (règle 3 du dépôt). */
const HEURES_PAR_JOUR_DEFAUT = 7;


// ── Persistance ──────────────────────────────────────────────────────────────

/**
 * Sérialisation stable, clés triées récursivement.
 *
 * `JSON.stringify` seul dépend de l'ORDRE D'INSERTION des clés — et le type
 * `jsonb` de Postgres ne le préserve pas au stockage (contrairement à `json`).
 * Deux opérations strictement identiques en mémoire peuvent donc redonner un
 * texte différent une fois l'une des deux relue depuis `payload`, cassant
 * silencieusement toute comparaison de doublon par égalité de chaîne.
 */
function jsonCanonique(valeur: unknown): string {
  const trier = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(trier);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((cle) => [cle, trier((v as Record<string, unknown>)[cle])]),
      );
    }
    return v;
  };
  return JSON.stringify(trier(valeur));
}

/** Résumé d'une ligne de plan, lisible dans la file de validation existante. */
function resumer(plan: Plan): string {
  if (plan.operations.length === 0) return "Rien à appliquer";
  const premier = plan.operations[0]!.libelle;
  return plan.operations.length === 1
    ? premier
    : `${premier} (+${plan.operations.length - 1})`;
}

export async function enregistrerPlan(tenantId: string, plan: Plan): Promise<string> {
  return withTenant(tenantId, async (tx) => {
    // Un « OK » en langage naturel dans le chat, alors qu'un plan identique
    // est déjà EN_ATTENTE, ne doit jamais poser un second plan en doublon :
    // le modèle n'a aucun moyen de distinguer « confirme celui-ci » de
    // « propose-le à nouveau », donc c'est ici, côté serveur et
    // déterministe, que le doublon est empêché — pas en espérant que le
    // modèle ne se répète jamais.
    const enAttente = await tx
      .select({ id: pendingActionsTable.id, payload: pendingActionsTable.payload })
      .from(pendingActionsTable)
      .where(
        and(
          eq(pendingActionsTable.tenantId, tenantId),
          eq(pendingActionsTable.type, TYPE_PLAN),
          eq(pendingActionsTable.status, "EN_ATTENTE"),
          isNull(pendingActionsTable.executeLe),
          isNull(pendingActionsTable.decidedAt),
        ),
      );

    const operationsJson = jsonCanonique(plan.operations);
    const doublon = enAttente.find(
      (ligne) => jsonCanonique((ligne.payload as Plan | null)?.operations ?? []) === operationsJson,
    );
    if (doublon) return doublon.id;

    const [ligne] = await tx
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
      .returning({ id: pendingActionsTable.id });
    return ligne!.id;
  });
}

// ── Exécution ────────────────────────────────────────────────────────────────

async function executerOperation(
  tx: Tx,
  tenantId: string,
  op: OperationPlanifiee,
  /** Adresse de celui qui valide — sert à savoir qui pointe quand aucun nom
   *  n'a été dicté. Absente pour les chemins qui n'en ont pas besoin. */
  emailDecideur?: string,
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
    case "creer_devis":
    case "creer_facture": {
      // Le catalogue est relu maintenant : c'est LUI qui fixe les prix, pas le
      // modèle, et pas un instantané pris une heure plus tôt.
      const dictees = JSON.parse(op.champs["lignesDicteesJson"] ?? "[]") as {
        libelle: string; quantite: number | null; unite: string | null;
        /** Prix dicté, déjà vérifié dans la transcription. Absent le plus souvent. */
        prixUnitaireHtCents?: number | null;
      }[];
      const catalogueCourant = await tx
        .select()
        .from(catalogueLignesTable)
        .where(eq(catalogueLignesTable.actif, true));
      const aliasCourants = await tx.select().from(catalogueAliasTable);
      const proposees: LigneProposee[] = rapprocherDictee(
        // `dictees` porte déjà `prixUnitaireHtCents` quand l'utilisateur a
        // prononcé un montant. `rapprocher` ne s'en sert QUE si le catalogue
        // ne connaît pas la ligne — la priorité du tarif est tenue là-bas.
        dictees,
        catalogueCourant.map((c) => ({
          id: c.id, libelle: c.libelle, unite: c.unite,
          prixUnitaireHtCents: c.prixUnitaireHtCents, tauxTva: c.tauxTva,
          motsCles: c.motsCles ?? [],
        })),
        new Map(aliasCourants.map((a) => [a.aliasNormalise, a.catalogueLigneId])),
      );
      // Une ligne sans prix entre à 0 dans le BROUILLON — et c'est le seul
      // endroit où c'est acceptable : le libellé du plan a annoncé combien de
      // lignes restaient à compléter, et un brouillon ne part chez personne.
      // L'émission, elle, refusera un document incohérent.
      const lignes: FactureLine[] = proposees.map((l) => ({
        id: crypto.randomUUID(),
        description: l.libelle,
        quantity: l.quantite ?? 1,
        unitPriceCents: l.prixUnitaireHtCents ?? 0,
        vatRate: l.tauxTva ?? 20,
        vatCategory: "S",
        ...(l.unite ? { unit: l.unite } : {}),
      }));
      const totalHT = lignes.reduce((n, l) => n + l.quantity * l.unitPriceCents, 0);
      const totalTVA = lignes.reduce(
        (n, l) => n + Math.round(l.quantity * l.unitPriceCents * ((l.vatRate ?? 20) / 100)),
        0,
      );
      const client = op.champs["clientName"] ?? "Client à préciser";

      if (op.type === "creer_devis") {
        const nb = (await tx.select({ id: devisTable.id }).from(devisTable)).length;
        const [dictee] = await tx.insert(devisTable).values({
          tenantId,
          reference: `DEV-${new Date().getFullYear()}-${String(nb + 1).padStart(4, "0")}`,
          clientName: client,
          status: "BROUILLON",
          lines: lignes,
          totalHTCents: totalHT,
          totalTTCCents: totalHT + totalTVA,
        }).returning();
        await indexerAuClasseur(tx, {
          tenantId, sourceType: "DEVIS", sourceId: dictee!.id,
          nom: nomAuClasseur("DEVIS", dictee!.reference, dictee!.id),
        });
        return;
      }

      const [facturee] = await tx.insert(facturesTable).values({
        tenantId,
        customerName: client,
        // Sans numéro, comme toute facture en brouillon : l'émission scelle un
        // document immuable et consomme un numéro de séquence, elle ne se
        // dicte pas.
        number: "",
        statut: "BROUILLON",
        issuedDate: toDateString(new Date()),
        dueDate: toDateString(new Date()),
        lines: lignes,
        totalHTCents: totalHT,
        totalTVACents: totalTVA,
        amountCents: totalHT + totalTVA,
      }).returning();
      await indexerAuClasseur(tx, {
        tenantId, sourceType: "FACTURE", sourceId: facturee!.id,
        nom: nomAuClasseur("FACTURE", facturee!.number, facturee!.id),
      });
      return;
    }
    case "maj_etape_prospect": {
      const [maj] = await tx
        .update(prospectsTable)
        .set({ stage: op.champs["etape"]! })
        .where(eq(prospectsTable.id, op.champs["prospectId"]!))
        .returning({ id: prospectsTable.id });
      // Même exigence que `maj_statut_affaire` : une cible disparue fait
      // échouer TOUT le plan, elle ne s'ignore pas.
      if (!maj) throw new Error(`Prospect ${op.champs["prospectId"]} introuvable`);
      return;
    }
    case "creer_article_catalogue": {
      const prix = entierPositifRequis(op, "prixUnitaireHtCents");
      await tx.insert(catalogueLignesTable).values({
        tenantId,
        libelle: op.champs["libelle"]!,
        prixUnitaireHtCents: prix,
        ...(op.champs["unite"] ? { unite: op.champs["unite"] } : {}),
      });
      return;
    }
    case "creer_charge_recurrente": {
      const montant = entierPositifRequis(op, "montantCents");
      await tx.insert(chargesRecurrentesTable).values({
        tenantId,
        label: op.champs["libelle"]!,
        category: op.champs["categorie"] ?? "AUTRE",
        cadence: op.champs["cadence"]!,
        // La charge court à partir d'aujourd'hui : une date de début dictée
        // serait une donnée de plus à entendre de travers, pour un réglage
        // que l'écran change en deux gestes.
        startDate: toDateString(new Date()),
        amountCents: montant,
      });
      return;
    }
    case "creer_contrat": {
      const montant = entierPositifRequis(op, "montantCents");
      const [contratDicte] = await tx.insert(contratsTable).values({
        tenantId,
        label: op.champs["libelle"]!,
        cadence: op.champs["cadence"]!,
        startDate: toDateString(new Date()),
        amountCents: montant,
        ...(op.champs["clientName"] ? { clientName: op.champs["clientName"] } : {}),
      }).returning();
      await indexerAuClasseur(tx, {
        tenantId, sourceType: "CONTRAT", sourceId: contratDicte!.id,
        nom: nomAuClasseur("CONTRAT", contratDicte!.label, contratDicte!.id),
      });
      return;
    }
    case "facturer_devis": {
      // Le module partagé, pas une seconde conversion : c'est lui qui compare
      // le total de la facture à celui du devis signé, et qui refuse l'écart.
      const r = await facturerDevis(tx, tenantId, op.champs["devisId"]!);
      if (r.kind !== "ok" && r.kind !== "deja") {
        // Refus explicite plutôt qu'un brouillon faux : la transaction annule
        // tout le plan, et le message dit lequel des cas s'applique.
        throw new Error(messageRefusFacturation(r));
      }
      return;
    }
    case "lancer_relance": {
      const appels = JSON.parse(op.champs["appels"] ?? "[]") as Array<{
        clientId: string | null; factureId: string; montantCents: number;
        numero: string; clientNom: string;
      }>;
      if (appels.length === 0) throw new Error("Campagne de relance sans appel");

      // La règle du tenant DANS LA VERSION DU JOUR, figée sur la campagne :
      // c'est elle qui bornera ce que l'agent peut accorder, et elle ne doit
      // pas bouger si le dirigeant la modifie avant de valider (US-9).
      const { regle, version } = await regleEnVigueur(tx, tenantId);

      const [action] = await tx
        .insert(pendingActionsTable)
        .values({
          tenantId,
          type: TYPE_CAMPAGNE_RELANCE,
          label: `Relance téléphonique — ${appels.length} appel${appels.length > 1 ? "s" : ""}`,
          description:
            "Chaque appel de cette liste sera passé par l'assistant vocal, dans les limites du mandat ci-dessous.",
          amountCents: appels.reduce((t, a) => t + a.montantCents, 0),
          payload: { appels, mandat: regle },
        })
        .returning();

      // La campagne naît PROPOSÉE : valider la dictée prépare la relance, elle
      // ne la déclenche pas. Aucun appel n'existe hors d'une pending_action
      // approuvée (règle 4) — et la voix ne peut pas approuver à la place du
      // dirigeant.
      await tx.insert(campagnesRelanceTable).values({
        tenantId,
        pendingActionId: action!.id,
        appels,
        mandat: regle,
        regleVersion: version,
      });
      return;
    }
    case "enregistrer_reglement": {
      const factureId = op.champs["factureId"]!;
      const [f] = await tx.select().from(facturesTable).where(eq(facturesTable.id, factureId));
      if (!f) throw new Error(`Facture ${factureId} introuvable`);
      // Une facture réglée entre la construction du plan et sa validation
      // (jusqu'à une heure) ne doit pas recevoir un second encaissement.
      if (f.statut !== "EMISE") throw new Error(`Facture ${factureId} n'est plus à régler`);

      // Sans montant dicté, c'est le SOLDE — calculé par le serveur depuis le
      // journal des paiements, jamais par le modèle (règle 3). Le calcul est
      // celui de la route `/factures/:id/payer`, pas une seconde version.
      // Le montant vient du plan — c'est-à-dire du solde calculé au serveur,
      // éventuellement corrigé à l'écran par l'utilisateur. Jamais du modèle.
      const montantCents = Number(op.champs["montantCents"]);
      if (!Number.isFinite(montantCents) || montantCents <= 0) {
        throw new Error("Montant de règlement invalide");
      }

      await tx.insert(paiementsTable).values({
        tenantId,
        factureId,
        clientId: f.clientId ?? null,
        affaireId: f.affaireId ?? null,
        date: toDateString(new Date()),
        montantCents,
        sens: "ENCAISSEMENT",
        moyen: op.champs["moyen"] ?? "AUTRE",
        nature: "SOLDE",
      });
      // Le statut se DÉDUIT du journal, il ne s'écrit pas à la main : deux
      // façons d'écrire le même fait sont deux façons de le rendre faux.
      await recalculerFacture(tx, factureId);
      return;
    }
    case "creer_client": {
      await tx.insert(clientsTable).values({
        tenantId,
        nom: op.champs["nom"]!,
        // Le TYPE n'est pas dicté : particulier et professionnel n'obéissent
        // pas aux mêmes règles de démarchage (voir `canauxProspection`), et
        // le déduire d'un nom entendu serait une décision juridique prise par
        // un modèle. Le défaut de la table s'applique, l'écran corrige.
        ...(op.champs["telephone"] ? { telephone: op.champs["telephone"] } : {}),
        ...(op.champs["email"] ? { email: op.champs["email"] } : {}),
        ...(op.champs["ville"] ? { ville: op.champs["ville"] } : {}),
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
    case "pointer_heures": {
      const affaireId = op.champs["affaireId"]!;
      // Même garantie que pour l'affectation : `pointages` n'a pas de FK sur
      // l'affaire côté membre, et une cible disparue entre la construction du
      // plan et son exécution s'insérerait sans bruit.
      const [affaire] = await tx.select({ id: affairesTable.id }).from(affairesTable).where(eq(affairesTable.id, affaireId));
      if (!affaire) throw new Error(`Affaire ${affaireId} introuvable`);

      // Membre non dicté = celui qui parle. Résolu ICI, côté serveur, par
      // l'adresse de la session : le modèle n'a jamais désigné personne.
      //
      // `team_members` ne porte PAS de lien vers le compte utilisateur — seulement
      // une adresse. Le rapprochement se fait donc sur elle, et son échec est
      // EXPLICITE : mieux vaut refuser que pointer les heures de quelqu'un
      // d'autre parce qu'une correspondance approximative a semblé plausible.
      let membreId = op.champs["membreId"] ?? null;
      if (!membreId) {
        if (!emailDecideur) {
          throw new Error("Sans nom dicté, il faut une adresse de session pour savoir qui pointe");
        }
        const [moi] = await tx
          .select({ id: teamMembersTable.id })
          .from(teamMembersTable)
          .where(eq(teamMembersTable.email, emailDecideur));
        if (!moi) {
          throw new Error(
            "Aucun membre d'équipe ne porte votre adresse : précisez le nom dans la dictée",
          );
        }
        membreId = moi.id;
      }

      await tx.insert(pointagesTable).values({
        tenantId,
        membreId,
        affaireId,
        date: op.champs["date"]!,
        heures: op.champs["heures"]!,
        // « confirmé » et non « proposé » : ces heures viennent de la bouche
        // de l'utilisateur, qui vient de valider le plan à l'écran. Une
        // proposition serait une heure que personne n'a affirmée.
        source: "confirme",
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
  /** Une correction portait sur un champ hors liste blanche : rien n'est écrit. */
  | { readonly kind: "correction_refusee"; readonly champs: readonly string[] }
  /**
   * Un champ que la voix laisse vide n'a pas été rempli (lot 4).
   *
   * Distinct du 409 « la cible a disparu » : rien n'est en conflit ici, il
   * manque une donnée que seul l'humain détient. Confondre les deux dirait à
   * l'utilisateur que ses données ont bougé, alors qu'il lui suffit de taper
   * un prix.
   */
  | {
      readonly kind: "champ_manquant";
      readonly champs: readonly { readonly champ: string; readonly motif: "vide" | "format" }[];
    }
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
/**
 * Corrections apportées à l'écran avant validation : index d'opération →
 * champ → nouvelle valeur. Voir `appliquerCorrections`.
 */
export type CorrectionsPlan = Readonly<Record<string, Readonly<Record<string, string>>>>;

/**
 * Applique les corrections de l'utilisateur au plan, en n'acceptant QUE les
 * champs issus de la dictée (`CHAMPS_CORRIGEABLES`).
 *
 * Tout le reste est ignoré en silence côté données, mais COMPTÉ : un champ
 * refusé n'est pas une faute de l'utilisateur — l'écran ne les propose pas —
 * c'est le signe d'une requête forgée, et l'appelant la refuse.
 *
 * Ce qui est en jeu : un `affaireId` réécrit à la main ne serait pas une
 * correction de transcription, mais le choix d'une AUTRE cible que celle que
 * le serveur a résolue et montrée à l'écran. La validation humaine porterait
 * alors sur un libellé qui ne décrit plus l'opération exécutée.
 */
export function appliquerCorrections(
  operations: readonly OperationPlanifiee[],
  corrections: CorrectionsPlan,
): { readonly operations: readonly OperationPlanifiee[]; readonly refuses: readonly string[] } {
  const refuses: string[] = [];
  const sortie = operations.map((op, i) => {
    const patch = corrections[String(i)];
    if (!patch) return op;
    const champs: Record<string, string | null> = { ...op.champs };
    for (const [champ, valeur] of Object.entries(patch)) {
      if (!champCorrigeable(op.type, champ)) {
        refuses.push(`${op.type}.${champ}`);
        continue;
      }
      champs[champ] = valeur;
    }
    // Le champ réclamé qu'on vient de remplir ne l'est plus : recalculer,
    // sans quoi l'écran continuerait de le réclamer après correction.
    return { ...op, champs, aCompleter: champsManquants(op.type, champs) };
  });
  return { operations: sortie, refuses };
}

export async function executerPlan(
  tenantId: string,
  planId: string,
  /** US-A6.4 — qui approuve. Les deux appelants le connaissent
   *  (`/voix/executer` et `/pending-actions/:id/approve`) ; sans lui le
   *  journal ne prouverait que la date, pas l'auteur. */
  decideur?: { userId: string; email: string },
  /** Corrections saisies à l'écran de validation, déjà filtrées ou non. */
  corrections?: CorrectionsPlan,
): Promise<ResultatExecution> {
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
    const brutes = plan?.operations ?? [];
    // Les corrections sont appliquées AVANT toute écriture, et le résultat
    // filtré est ce qui s'exécute — pas le plan d'origine.
    const { operations, refuses } = corrections
      ? appliquerCorrections(brutes, corrections)
      : { operations: brutes, refuses: [] as readonly string[] };
    if (refuses.length > 0) return { kind: "correction_refusee" as const, champs: refuses };

    // Avant d'ouvrir la moindre écriture : un plan dont un champ réclamé est
    // vide, ou rempli avec autre chose qu'un entier de centimes, ne s'applique
    // pas. `executerOperation` refuserait aussi, mais en cours de transaction,
    // et l'utilisateur ne verrait qu'un « rien n'a été enregistré » sans savoir
    // quoi corriger.
    //
    // Le format est vérifié ICI, et pas seulement le vide : « 45,00 » est
    // exactement ce qu'on tape dans un champ prix, et le laisser tomber dans
    // le refus générique dirait à l'utilisateur que ses données ont bougé.
    const defauts = verifierChampsASaisir(operations);
    if (defauts.length > 0) return { kind: "champ_manquant" as const, champs: defauts };

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

    // US-A6.4 — dans LA MÊME transaction que l'exécution : si une opération
    // échoue plus bas, tout est annulé, journal compris. On ne consigne jamais
    // une approbation qui n'a rien produit.
    await tx.insert(journalDecisionsTable).values({
      tenantId,
      actionId: planId,
      actionType: ligne.type,
      actionLabel: ligne.label,
      actionPayload: ligne.payload,
      decision: "APPROUVEE",
      decideePar: decideur?.userId ?? null,
      decideeParEmail: decideur?.email ?? null,
    });

    for (const op of operations) {
      await executerOperation(tx, tenantId, op, decideur?.email);
    }

    return { kind: "ok" as const, nbOperations: operations.length };
  });
}

/**
 * Purge des plans expirés jamais validés.
 *
 * US-A6.4 — journalise AVANT de supprimer. Sans cela, câbler un jour cette
 * fonction viderait l'historique en silence : les expirations n'y figurent
 * aujourd'hui que parce que la ligne d'origine traîne encore en base.
 */
export async function purgerPlansExpires(tenantId: string): Promise<number> {
  return withTenant(tenantId, async (tx) => {
    await tx.execute(sql`
      INSERT INTO journal_decisions
        (id, tenant_id, action_id, action_type, action_label, action_payload, decision, decidee_le)
      SELECT gen_random_uuid()::text, tenant_id, id, type, label, payload, 'EXPIREE', COALESCE(expire_le, NOW())
        FROM pending_actions
       WHERE type = ${TYPE_PLAN}
         AND execute_le IS NULL
         AND expire_le IS NOT NULL
         AND expire_le < NOW()
    `);
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
