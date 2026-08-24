/*
 * Facturer une mission ponctuelle à son terme — US-B8.1.
 *
 * ── Le constat ────────────────────────────────────────────────────────────
 * Le produit savait facturer un DEVIS accepté, et depuis US-A2.3 un CONTRAT
 * récurrent. Entre les deux, rien : une mission menée sans devis — une course,
 * un déménagement, une intervention convenue au téléphone — n'avait aucun
 * chemin vers une facture. Il fallait tout retaper. Pour un transporteur qui
 * fait cinq courses par jour, c'est le métier entier.
 *
 * US-B8.1 demande exactement les deux voies, distinctes : « étant donné une
 * mission ponctuelle, alors elle peut être facturée immédiatement à son
 * terme ; étant donné un contrat récurrent, alors la facturation périodique du
 * tronc commun (US-A2.3) s'applique ». Ce module tient la première.
 *
 * ── Il ne DUPLIQUE aucune conversion ──────────────────────────────────────
 * Si l'affaire porte un devis accepté, ce module ne fabrique rien : il
 * délègue à `facturerDevis`, qui reste LE seul endroit où un devis devient une
 * facture. Deux façons de fabriquer une facture, ce sont deux façons de la
 * rendre fausse — et la seconde diverge toujours en silence.
 *
 * Il ne prend le relais que là où il n'y a rien à convertir : une mission sans
 * devis, dont le montant vendu est la seule source.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { affairesTable, devisTable, facturesTable, type FactureLine } from "@workspace/db";
import { toDateString } from "@nodaq/shared";
import { facturerDevis, type ResultatFacturation } from "./facturer-devis.js";
import { indexerAuClasseur, nomAuClasseur } from "./indexation-classeur.js";

type Tx = Parameters<Parameters<typeof import("@workspace/db").withTenant>[1]>[0];

export type ResultatFacturationAffaire =
  | { readonly kind: "ok"; readonly facture: typeof facturesTable.$inferSelect;
      /** Par quelle voie : le devis accepté, ou le montant vendu. */
      readonly source: "devis" | "montant_vendu" }
  | { readonly kind: "introuvable" }
  /** Aucun devis accepté, aucun montant : il n'y a rien à facturer. */
  | { readonly kind: "sans_montant" }
  /**
   * Une facture existe déjà pour cette mission. PAS une erreur en soi — un
   * acompte puis un solde sont deux factures légitimes sur la même affaire —
   * mais un doublon accidentel l'est, et il est bien plus fréquent.
   */
  | { readonly kind: "deja_facturee"; readonly existantes: readonly string[] }
  /** Le devis accepté a refusé la conversion : on rend SON motif, tel quel. */
  | { readonly kind: "refus_devis"; readonly refus: ResultatFacturation };

export async function facturerAffaire(
  tx: Tx,
  tenantId: string,
  affaireId: string,
  options: { readonly confirmerSecondeFacture?: boolean; readonly vatRate?: number } = {},
): Promise<ResultatFacturationAffaire> {
  const [affaire] = await tx.select().from(affairesTable)
    .where(eq(affairesTable.id, affaireId));
  if (!affaire) return { kind: "introuvable" };

  // ── Le garde-fou du double clic ─────────────────────────────────────────
  // Un index unique serait FAUX ici, contrairement aux contrats : une affaire
  // porte légitimement plusieurs factures (acompte, situations, solde). On ne
  // peut donc pas confier l'unicité au moteur — mais on peut refuser par
  // défaut et exiger que la seconde facture soit VOULUE.
  const dejaFacture = await tx.select({ id: facturesTable.id, number: facturesTable.number })
    .from(facturesTable).where(eq(facturesTable.affaireId, affaireId));
  if (dejaFacture.length > 0 && !options.confirmerSecondeFacture) {
    return {
      kind: "deja_facturee",
      existantes: dejaFacture.map((f) => f.number || f.id),
    };
  }

  // ── Voie 1 : un devis accepté existe — on ne réinvente rien ─────────────
  const [devisAccepte] = await tx.select().from(devisTable).where(and(
    eq(devisTable.affaireId, affaireId),
    eq(devisTable.status, "ACCEPTE"),
    isNotNull(devisTable.acceptedAt),
  ));
  if (devisAccepte) {
    const r = await facturerDevis(tx, tenantId, devisAccepte.id);
    if (r.kind === "ok" || r.kind === "deja") {
      return { kind: "ok", facture: r.facture, source: "devis" };
    }
    // Un devis accepté qui refuse la conversion (écart de montant, aucune
    // ligne) : son motif est plus précis que tout ce qu'on pourrait rédiger
    // ici, et le taire ferait croire à une panne.
    return { kind: "refus_devis", refus: r };
  }

  // ── Voie 2 : le montant vendu de la mission ─────────────────────────────
  const montantHt = affaire.montantVenduHt ?? affaire.quotedAmountCents ?? null;
  if (montantHt === null || montantHt <= 0) return { kind: "sans_montant" };

  const vatRate = options.vatRate ?? 20;
  const lignes: FactureLine[] = [{
    id: crypto.randomUUID(),
    description: affaire.label,
    quantity: 1,
    unitPriceCents: montantHt,
    vatRate,
    vatCategory: "S",
  }];
  const totalTVACents = Math.round((montantHt * vatRate) / 100);

  const aujourdhui = toDateString(new Date());
  const echeance = new Date();
  echeance.setDate(echeance.getDate() + 30);

  const [creee] = await tx.insert(facturesTable).values({
    tenantId,
    customerName: affaire.clientName ?? "Client",
    // Vide : le numéro séquentiel appartient à l'ÉMISSION, jamais avant.
    number: "",
    issuedDate: aujourdhui,
    dueDate: toDateString(echeance),
    amountCents: montantHt + totalTVACents,
    residualCents: montantHt + totalTVACents,
    settled: false,
    statut: "BROUILLON",
    lines: lignes,
    totalHTCents: montantHt,
    totalTVACents,
    autoliquidation: false,
    affaireId,
  }).returning();

  await indexerAuClasseur(tx, {
    tenantId, sourceType: "FACTURE", sourceId: creee!.id,
    nom: nomAuClasseur("FACTURE", creee!.number, creee!.id), affaireId,
  });

  return { kind: "ok", facture: creee!, source: "montant_vendu" };
}

const majuscule = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;

/** Le refus, en français, prêt à afficher. */
export function messageRefusAffaire(r: ResultatFacturationAffaire, motMission: string): string {
  switch (r.kind) {
    case "introuvable":
      // `definite` rend « le chantier » / « la mission », article compris —
      // d'où le verbe : « Le chantier introuvable. » n'est pas une phrase.
      return `${majuscule(motMission)} est introuvable.`;
    case "sans_montant":
      return `Aucun montant sur ${motMission} et aucun devis accepté : il n'y a rien à facturer. ` +
        "Renseignez le montant vendu, ou faites accepter un devis.";
    case "deja_facturee":
      return `${majuscule(motMission)} porte déjà ` +
        `${r.existantes.length === 1 ? "une facture" : `${r.existantes.length} factures`} ` +
        `(${r.existantes.join(", ")}). Confirmez si vous voulez en ajouter une — un acompte ` +
        "puis un solde sont légitimes, un doublon ne l'est pas.";
    default:
      return "";
  }
}
