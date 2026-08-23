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

export async function chargerContexte(tenantId: string): Promise<ContexteResolution> {
  return withTenant(tenantId, async (tx) => {
    const affaires = await tx.select({ id: affairesTable.id, libelle: affairesTable.label }).from(affairesTable);
    const membres = await tx.select({ id: teamMembersTable.id, libelle: teamMembersTable.name }).from(teamMembersTable);
    // Le solde vient d'UNE requête agrégée plutôt que d'une par facture : le
    // contexte se charge à chaque dictée, et un appel par facture ferait
    // grossir la latence avec le carnet de commandes.
    const lignes = await tx.execute(sql`
      SELECT f.id,
             f.number,
             f.customer_name,
             (f.amount_cents - COALESCE(SUM(
                CASE WHEN p.sens = 'ENCAISSEMENT' THEN p.montant_cents
                     ELSE -p.montant_cents END), 0))::int AS solde
        FROM factures f
        LEFT JOIN paiements p ON p.facture_id = f.id
       WHERE f.statut = 'EMISE'
       GROUP BY f.id, f.number, f.customer_name, f.amount_cents`);
    const factures = (lignes.rows as Array<{ id: string; number: string; customer_name: string; solde: number }>)
      .map((f) => ({
        // Le numéro ET le client dans le libellé : on dit « la 181 » comme
        // « la facture Delacroix », et le rapprochement doit attraper les deux.
        id: f.id,
        libelle: `${f.number} ${f.customer_name}`,
        soldeCents: Number(f.solde),
      }));
    const aujourdhui = toDateString(new Date());
    const retards = await tx.execute(sql`
      SELECT f.id, f.customer_name, f.client_id, f.amount_cents, c.telephone
        FROM factures f
        LEFT JOIN clients c ON c.id = f.client_id
       WHERE ${conditionFactureEnRetardSql(aujourdhui)}`);
    const lignesRetard = retards.rows as Array<{
      id: string; customer_name: string; client_id: string | null;
      amount_cents: number; telephone: string | null;
    }>;
    const joignables = lignesRetard
      .filter((f) => f.telephone)
      .map((f) => ({
        clientId: f.client_id,
        factureId: f.id,
        montantCents: Number(f.amount_cents),
        numero: f.telephone!,
        clientNom: f.customer_name,
      }));
    const impayes = { joignables, sansNumero: lignesRetard.length - joignables.length };

    const devisLignes = await tx.execute(sql`
      SELECT d.id, d.reference, d.client_name, d.total_ttc_cents
        FROM devis d
        LEFT JOIN factures f ON f.devis_id = d.id
       WHERE d.status = 'ACCEPTE' AND f.id IS NULL`);
    const devisAFacturer = (devisLignes.rows as Array<{
      id: string; reference: string; client_name: string; total_ttc_cents: number;
    }>).map((d) => ({
      // Référence ET client : on dit « le devis Delacroix » comme « le 0044 ».
      id: d.id,
      libelle: `${d.reference} ${d.client_name}`,
      totalTTCCents: Number(d.total_ttc_cents),
    }));

    const clientsLignes = await tx
      .select({ id: clientsTable.id, nom: clientsTable.nom })
      .from(clientsTable);
    const clients = clientsLignes.map((c) => ({ id: c.id, libelle: c.nom }));

    const prospectsLignes = await tx
      .select({ id: prospectsTable.id, nom: prospectsTable.name })
      .from(prospectsTable)
      .where(sql`stage NOT IN ('GAGNE', 'PERDU')`);
    const prospects = prospectsLignes.map((p) => ({ id: p.id, libelle: p.nom }));

    const catalogueLignes = await tx
      .select()
      .from(catalogueLignesTable)
      .where(eq(catalogueLignesTable.actif, true));
    const catalogue: CatalogueEntree[] = catalogueLignes.map((c) => ({
      id: c.id,
      libelle: c.libelle,
      unite: c.unite,
      prixUnitaireHtCents: c.prixUnitaireHtCents,
      tauxTva: c.tauxTva,
      motsCles: c.motsCles ?? [],
    }));
    const aliasLignes = await tx.select().from(catalogueAliasTable);
    const aliasCatalogue: AliasCatalogue = new Map(
      aliasLignes.map((a) => [a.aliasNormalise, a.catalogueLigneId]),
    );

    const words = affaireWords(await verticalDepuisTx(tx));
    return {
      affaires, membres, factures, devisAFacturer, clients, prospects,
      catalogue, aliasCatalogue, impayes, words,
    };
  });
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
  /**
   * La phrase telle qu'elle a été transcrite.
   *
   * Sert à VÉRIFIER qu'un montant dicté figure bien dans ce que l'utilisateur
   * a dit — un modèle qui hallucine un chiffre est arrêté là. Vide par
   * défaut : aucun montant n'est alors retenu, et les champs concernés
   * retombent sur `CHAMPS_A_COMPLETER`. Le repli est l'état sûr.
   */
  transcription: string = "",
  aujourdhui: Date = new Date(),
): Plan {
  /** Le montant dicté, en centimes, s'il se retrouve dans la phrase. */
  const centimesDits = (euros: number | null | undefined): number | null =>
    centimesDepuisDictee(transcription, euros);
  // `aCompleter` est DÉRIVÉ des champs, une seule fois, au retour : l'écrire
  // sur chacun des sites de construction le ferait diverger au premier oubli.
  const operations: OperationBrute[] = [];
  const questions: QuestionPlan[] = [];
  const incompris = [...nonCompris];
  const { words } = contexte;

  for (const intention of intentions) {
    if (intention.type === "maj_statut_affaire") {
      const r: Resolution = resoudreMention(intention.affaireMentionnee, contexte.affaires);
      if (r.etat === "ambigu") {
        questions.push({
          // « Quelle correspondance pour LE chantier / LA mission … » :
          // l'interrogatif porte sur « correspondance », toujours féminin,
          // et le nom du secteur arrive déjà accordé via `definite`. Déduire
          // le genre du mot ici (tester un « la » en tête, par exemple)
          // réintroduirait une règle de langue dans le code — c'est
          // précisément ce que `AffaireWords` existe pour éviter.
          question: `Quelle correspondance pour ${words.definite} « ${intention.affaireMentionnee} » ?`,
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
        libelle: `${libelleOperation(intention, words)} au ${date}`,
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
        libelle: libelleOperation(intention, words),
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

    if (intention.type === "creer_devis" || intention.type === "creer_facture") {
      // Le chiffrage est DÉTERMINISTE, depuis le catalogue du tenant. Le
      // modèle n'a fourni que des libellés, des quantités et des unités : son
      // schéma ne peut rien porter d'autre.
      const proposees = rapprocherDictee(
        intention.lignes.map((l) => ({
          libelle: l.libelle,
          quantite: l.quantite ?? null,
          unite: l.unite ?? null,
        })),
        contexte.catalogue,
        contexte.aliasCatalogue,
      );
      const { totalHtCents, lignesChiffrees, lignesACompleter } = totalProposition(proposees);

      let clientName: string | null = intention.clientMentionne ?? null;
      let certitude: OperationBrute["certitude"] = "aucune_resolution";
      if (intention.clientMentionne) {
        const r = resoudreMention(intention.clientMentionne, contexte.clients);
        if (r.etat === "ambigu") {
          questions.push({
            question: `Quel client « ${intention.clientMentionne} » ?`,
            candidats: r.candidats,
            mention: intention.clientMentionne,
          });
          continue;
        }
        if (r.etat === "resolu") {
          clientName = r.candidat.libelle;
          certitude = r.certitude;
        }
      }

      const mot = intention.type === "creer_devis" ? "devis" : "facture";
      // Le libellé dit la PROVENANCE des prix et ce qui manque encore. Un
      // total annoncé sans dire que deux lignes sont vides ferait croire à un
      // devis moins cher que la réalité — l'erreur qu'on ne peut pas se
      // permettre sur un prix envoyé à un client.
      const manque =
        lignesACompleter > 0
          ? ` — ${lignesACompleter} ligne(s) sans prix au catalogue, à compléter`
          : "";
      operations.push({
        type: intention.type,
        libelle:
          `Créer un ${mot} en BROUILLON${clientName ? ` pour ${clientName}` : ""} : ` +
          `${lignesChiffrees} ligne(s) chiffrée(s) depuis votre catalogue, ` +
          `${euros(totalHtCents)} HT${manque}`,
        champs: {
          clientName,
          // Ce sont les lignes DICTÉES qu'on conserve, pas le rapprochement :
          // le chiffrage est refait à l'exécution, sur le catalogue tel qu'il
          // est à ce moment-là. Un plan attend jusqu'à une heure, et un prix
          // corrigé entre-temps doit être celui qui s'écrit.
          //
          // Le total du libellé ci-dessus n'est donc qu'un APERÇU, et c'est
          // assumé : il est affiché avant validation, sur un document qui sort
          // en brouillon.
          lignesDicteesJson: JSON.stringify(
            intention.lignes.map((l) => ({
              libelle: l.libelle,
              quantite: l.quantite ?? null,
              unite: l.unite ?? null,
            })),
          ),
        },
        certitude,
      });
      continue;
    }

    if (intention.type === "maj_etape_prospect") {
      const r = resoudreMention(intention.prospectMentionne, contexte.prospects);
      if (r.etat === "ambigu") {
        questions.push({
          question: `Quel prospect « ${intention.prospectMentionne} » ?`,
          candidats: r.candidats,
          mention: intention.prospectMentionne,
        });
        continue;
      }
      if (r.etat === "introuvable") {
        incompris.push(`prospect « ${intention.prospectMentionne} » introuvable`);
        continue;
      }
      operations.push({
        type: intention.type,
        libelle: `Passer « ${r.candidat.libelle} » en ${intention.etape}`,
        champs: { prospectId: r.candidat.id, etape: intention.etape },
        certitude: r.certitude,
      });
      continue;
    }

    if (intention.type === "creer_article_catalogue") {
      // Dicté s'il a réellement été prononcé, à saisir sinon. Le modèle ne
      // FIXE aucun prix : il recopie celui de l'artisan, et on vérifie qu'il
      // figure bien dans la phrase avant de le retenir.
      const prix = centimesDits(intention.montantEuros);
      operations.push({
        type: intention.type,
        libelle:
          `Ajouter au catalogue « ${intention.designation} »` +
          (prix === null ? " — prix à saisir" : ` — ${euros(prix)} HT`),
        champs: {
          libelle: intention.designation,
          unite: intention.unite ?? null,
          prixUnitaireHtCents: prix === null ? null : String(prix),
        },
        certitude: "aucune_resolution",
      });
      continue;
    }

    if (intention.type === "creer_charge_recurrente") {
      const montant = centimesDits(intention.montantEuros);
      operations.push({
        type: intention.type,
        libelle:
          `Déclarer une charge ${intention.cadence}le « ${intention.libelle} »` +
          (montant === null ? " — montant à saisir" : ` — ${euros(montant)}`),
        champs: {
          libelle: intention.libelle,
          cadence: intention.cadence,
          categorie: intention.categorie ?? "AUTRE",
          montantCents: montant === null ? null : String(montant),
        },
        certitude: "aucune_resolution",
      });
      continue;
    }

    if (intention.type === "creer_contrat") {
      // Le nom du client est rapproché pour l'écrire tel qu'il existe déjà.
      // Introuvable, on garde la dictée : le champ est du texte libre, et
      // refuser un contrat parce que le client n'est pas encore en fiche
      // serait imposer un ordre de saisie que personne ne suit sur un
      // chantier.
      const montantContrat = centimesDits(intention.montantEuros);
      let clientName: string | null = intention.clientMentionne ?? null;
      let certitude: OperationBrute["certitude"] = "aucune_resolution";
      if (intention.clientMentionne) {
        const r = resoudreMention(intention.clientMentionne, contexte.clients);
        if (r.etat === "ambigu") {
          questions.push({
            question: `Quel client « ${intention.clientMentionne} » ?`,
            candidats: r.candidats,
            mention: intention.clientMentionne,
          });
          continue;
        }
        if (r.etat === "resolu") {
          clientName = r.candidat.libelle;
          certitude = r.certitude;
        }
      }
      operations.push({
        type: intention.type,
        libelle:
          `Créer le contrat ${intention.cadence} « ${intention.libelle} »` +
          `${clientName ? ` pour ${clientName}` : ""}` +
          (montantContrat === null ? " — montant à saisir" : ` — ${euros(montantContrat)}`),
        champs: {
          libelle: intention.libelle,
          cadence: intention.cadence,
          clientName,
          montantCents: montantContrat === null ? null : String(montantContrat),
        },
        certitude,
      });
      continue;
    }

    if (intention.type === "facturer_devis") {
      const rDevis = resoudreMention(intention.devisMentionne, contexte.devisAFacturer);
      if (rDevis.etat === "ambigu") {
        questions.push({
          question: `Quel devis « ${intention.devisMentionne} » ?`,
          candidats: rDevis.candidats,
          mention: intention.devisMentionne,
        });
        continue;
      }
      if (rDevis.etat === "introuvable") {
        // Explicite : un devis non accepté, ou DÉJÀ facturé, n'est pas dans le
        // contexte — et l'utilisateur doit savoir laquelle des deux raisons
        // s'applique plutôt que de croire à une erreur d'écoute.
        incompris.push(
          `devis « ${intention.devisMentionne} » introuvable parmi les devis acceptés non encore facturés`,
        );
        continue;
      }

      const total = contexte.devisAFacturer.find((d) => d.id === rDevis.candidat.id)?.totalTTCCents ?? 0;
      operations.push({
        type: intention.type,
        libelle:
          `Facturer « ${rDevis.candidat.libelle} » — ${(total / 100).toFixed(2)} € TTC ` +
          `(brouillon : l'émission reste un geste à part)`,
        champs: { devisId: rDevis.candidat.id },
        certitude: rDevis.certitude,
      });
      continue;
    }

    if (intention.type === "lancer_relance") {
      // Les impayés joignables : la définition du retard vient du module
      // partagé (`conditionFactureEnRetardSql`) — en écrire une seconde ici
      // rejouerait le bug que son en-tête raconte.
      //
      // Le NUMÉRO vient du client rattaché : une facture sans client ou sans
      // téléphone ne peut pas être appelée, et elle est comptée à part plutôt
      // qu'ignorée en silence.
      const impayes = contexte.impayes;
      if (impayes.joignables.length === 0) {
        incompris.push(
          impayes.sansNumero > 0
            ? `aucun impayé joignable — ${impayes.sansNumero} facture(s) en retard sans téléphone`
            : "aucune facture en retard",
        );
        continue;
      }

      const total = impayes.joignables.reduce((t, a) => t + a.montantCents, 0);
      operations.push({
        type: intention.type,
        libelle:
          `Préparer une relance pour ${impayes.joignables.length} facture(s) en retard ` +
          `(${(total / 100).toFixed(2)} €)` +
          (impayes.sansNumero > 0 ? ` — ${impayes.sansNumero} sans téléphone, écartée(s)` : "") +
          " — les appels resteront à valider",
        champs: {
          // La liste voyage sérialisée : le plan attend en base, et c'est elle
          // qui sera reprise à l'identique à la validation.
          appels: JSON.stringify(impayes.joignables),
        },
        certitude: "aucune_resolution",
      });
      continue;
    }

    if (intention.type === "enregistrer_reglement") {
      const rFacture = resoudreMention(intention.factureMentionnee, contexte.factures);
      if (rFacture.etat === "ambigu") {
        questions.push({
          question: `Quelle facture « ${intention.factureMentionnee} » ?`,
          candidats: rFacture.candidats,
          mention: intention.factureMentionnee,
        });
        continue;
      }
      if (rFacture.etat === "introuvable") {
        // Volontairement explicite : une facture non émise ou déjà réglée
        // n'est pas dans le contexte, et l'utilisateur doit savoir pourquoi
        // on ne la trouve pas.
        incompris.push(
          `facture « ${intention.factureMentionnee} » introuvable parmi les factures émises non réglées`,
        );
        continue;
      }

      // Deux sources pour le montant, dans cet ordre.
      //
      // 1. Ce qui a été DIT — « il m'a réglé 500 euros sur la 181 » — à
      //    condition que le chiffre se retrouve dans la transcription.
      // 2. Le SOLDE calculé par le serveur, sinon. C'est le repli, et c'est
      //    l'état sûr : il vient du journal des paiements, pas d'une oreille.
      //
      // Dans les deux cas l'écran affiche le montant et le laisse corriger
      // avant la moindre écriture.
      const solde = contexte.factures.find((f) => f.id === rFacture.candidat.id)?.soldeCents ?? 0;
      if (solde <= 0) {
        incompris.push(`facture « ${rFacture.candidat.libelle} » : rien ne reste dû`);
        continue;
      }
      const dit = centimesDits(intention.montantEuros);
      const aEncaisser = dit ?? solde;

      operations.push({
        type: intention.type,
        libelle:
          `Enregistrer ${euros(aEncaisser)} sur « ${rFacture.candidat.libelle} »` +
          (dit === null
            ? " (solde restant — corrigez si le règlement est partiel)"
            : ` (montant dicté ; solde ${euros(solde)})`),
        champs: {
          factureId: rFacture.candidat.id,
          // Centimes : un euro décimal qui voyage en JSON et se reconvertit
          // trois fois finit par perdre un centime. La conversion depuis les
          // euros dictés a lieu une seule fois, dans `centimesDepuisDictee`.
          montantCents: String(aEncaisser),
          moyen: intention.moyen ?? "AUTRE",
        },
        certitude: rFacture.certitude,
      });
      continue;
    }

    if (intention.type === "creer_client") {
      operations.push({
        type: intention.type,
        libelle: libelleOperation(intention, words),
        champs: {
          nom: intention.nom,
          telephone: intention.telephoneMentionne ?? null,
          email: intention.emailMentionne ?? null,
          ville: intention.villeMentionnee ?? null,
        },
        // Rien à rapprocher : on CRÉE. Un rapprochement approximatif sur un
        // client existant fusionnerait deux dossiers, ce qui ne se défait pas.
        certitude: "aucune_resolution",
      });
      continue;
    }

    if (intention.type === "creer_prospect") {
      operations.push({
        type: intention.type,
        libelle: libelleOperation(intention, words),
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
        libelle: libelleOperation(intention, words),
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

    if (intention.type === "pointer_heures") {
      const rAffaire = resoudreMention(intention.affaireMentionnee, contexte.affaires);
      if (rAffaire.etat === "ambigu") {
        questions.push({
          question: `Quelle ${contexte.words.singular} « ${intention.affaireMentionnee} » ?`,
          candidats: rAffaire.candidats,
          mention: intention.affaireMentionnee,
        });
        continue;
      }
      if (rAffaire.etat === "introuvable") {
        incompris.push(`${contexte.words.singular} « ${intention.affaireMentionnee} » introuvable`);
        continue;
      }

      // Le membre est FACULTATIF : « trois heures chez Delacroix » sans nom
      // désigne celui qui parle. Le serveur tranchera à l'exécution — le
      // modèle n'invente aucun identifiant.
      let membreId: string | null = null;
      let membreLibelle = "moi";
      if (intention.membreMentionne) {
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
        membreId = rMembre.candidat.id;
        membreLibelle = rMembre.candidat.libelle;
      }

      // Sans date dictée, c'est aujourd'hui : on pointe en descendant du
      // chantier, pas trois jours après.
      const jour = intention.dateMentionnee
        ? interpreterDate(intention.dateMentionnee, aujourdhui)
        : toDateString(aujourdhui);
      if (jour === null) {
        incompris.push(`pointage : date « ${intention.dateMentionnee} » non comprise`);
        continue;
      }

      operations.push({
        type: intention.type,
        libelle: `Pointer ${intention.heures} h pour « ${membreLibelle} » sur « ${rAffaire.candidat.libelle} » le ${jour}`,
        champs: {
          affaireId: rAffaire.candidat.id,
          ...(membreId ? { membreId } : {}),
          heures: String(intention.heures),
          date: jour,
        },
        certitude: rAffaire.certitude,
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
      libelle: libelleOperation(intention, words),
      champs: { libelle: intention.libelle },
      certitude: "aucune_resolution",
    });
  }

  // Une seule question à la fois : trancher deux ambiguïtés d'un coup demande
  // à l'artisan de tenir deux choix en tête pendant qu'il conduit.
  return {
    operations: operations.map((o) => ({
      ...o,
      aCompleter: champsManquants(o.type, o.champs),
    })),
    questions: questions.slice(0, 1),
    nonCompris: incompris,
  };
}

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
      }[];
      const catalogueCourant = await tx
        .select()
        .from(catalogueLignesTable)
        .where(eq(catalogueLignesTable.actif, true));
      const aliasCourants = await tx.select().from(catalogueAliasTable);
      const proposees: LigneProposee[] = rapprocherDictee(
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
