/**
 * Facturer un devis accepté — LE seul endroit où cette conversion existe.
 *
 * Extrait de la route au ticket 4.21 pour que le chemin VOCAL l'emprunte au
 * lieu d'en écrire une seconde version. Une facture est un document opposable
 * à un client : deux façons de la fabriquer, ce sont deux façons de la rendre
 * fausse — et la seconde diverge toujours en silence, un arrondi à la fois.
 *
 * ── L'invariant, rappelé ici parce qu'il est le cœur du module ────────────
 * Un devis applique sa remise au SOUS-TOTAL, une facture calcule ligne par
 * ligne. La conversion reporte donc la remise sur chaque prix unitaire, puis
 * COMPARE les deux totaux — et refuse en cas d'écart. Facturer un montant qui
 * n'est pas celui qui a été signé n'est pas une approximation acceptable.
 *
 * ── Elle ne fait pas d'émission ───────────────────────────────────────────
 * La facture naît en BROUILLON, sans numéro : la numérotation séquentielle,
 * la date d'émission et l'archive PDF appartiennent à `/factures/:id/emettre`,
 * qui les pose ensemble et sans retour.
 */
import { eq } from "drizzle-orm";
import { devisTable, facturesTable, type FactureLine } from "@workspace/db";
import { toDateString } from "@nodaq/shared";
import { indexerAuClasseur, nomAuClasseur } from "./indexation-classeur.js";
/** Même définition que `reglement-facture.ts` : la transaction de `withTenant`. */
type Tx = Parameters<Parameters<typeof import("@workspace/db").withTenant>[1]>[0];

/** Totaux d'une facture, calculés par le SERVEUR — jamais par un modèle. */
export function totauxFacture(lines: FactureLine[], autoliquidation: boolean) {
  const totalHTCents = lines.reduce(
    (acc, l) => acc + Math.round(l.quantity * l.unitPriceCents),
    0,
  );
  const totalTVACents = autoliquidation
    ? 0
    : lines.reduce((acc, l) => {
        const base = Math.round(l.quantity * l.unitPriceCents);
        return acc + Math.round((base * (l.vatRate ?? 20)) / 100);
      }, 0);
  return { totalHTCents, totalTVACents, amountCents: totalHTCents + totalTVACents };
}

export type ResultatFacturation =
  | { readonly kind: "ok"; readonly facture: typeof facturesTable.$inferSelect }
  /** Déjà facturé : on rend la facture existante, le geste est idempotent. */
  | { readonly kind: "deja"; readonly facture: typeof facturesTable.$inferSelect }
  | { readonly kind: "introuvable" }
  | { readonly kind: "non_accepte"; readonly statut: string }
  | { readonly kind: "sans_ligne" }
  /** La facture ne vaudrait pas le devis : les deux montants, en centimes. */
  | { readonly kind: "ecart"; readonly attendu: number; readonly obtenu: number };

export async function facturerDevis(
  tx: Tx,
  tenantId: string,
  devisId: string,
): Promise<ResultatFacturation> {
  const [d] = await tx.select().from(devisTable).where(eq(devisTable.id, devisId));
  if (!d) return { kind: "introuvable" as const };
  if (d.status !== "ACCEPTE") return { kind: "non_accepte" as const, statut: d.status };

  // Déjà facturé : on rend la facture existante plutôt qu'une erreur. Le
  // geste est idempotent côté appelant, et l'index unique de la migration
  // 049 tient le cas où deux requêtes arrivent ensemble.
  const [deja] = await tx.select().from(facturesTable).where(eq(facturesTable.devisId, d.id));
  if (deja) return { kind: "deja" as const, facture: deja };

  if (d.lines.length === 0) return { kind: "sans_ligne" as const };

  // La remise du devis est reportée sur CHAQUE prix unitaire, avec la même
  // formule que celle des totaux du devis. Les lignes restent lisibles
  // (« 10 m² à 45 € » devient « 10 m² à 42,75 € »), et le total suit.
  const facteur = 1 - (d.remise ?? 0) / 100;
  const lignes: FactureLine[] = d.lines.map((l) => ({
    id: crypto.randomUUID(),
    description: l.description,
    quantity: l.quantity,
    unitPriceCents: Math.round(l.unitPriceCents * facteur),
    vatRate: d.tvaRate,
    vatCategory: "S" as const,
  }));

  const { totalHTCents, totalTVACents, amountCents } = totauxFacture(lignes, false);

  // LA garde : ce qu'on s'apprête à facturer vaut-il ce qui a été accepté ?
  // Un écart d'arrondi de quelques centimes est possible ; le taire ne l'est
  // pas. L'écart est rendu à l'appelant, en centimes, pour qu'il tranche.
  if (amountCents !== d.totalTTCCents) {
    return {
      kind: "ecart" as const,
      attendu: d.totalTTCCents,
      obtenu: amountCents,
    };
  }

  const aujourdhui = toDateString(new Date());
  const echeance = new Date();
  echeance.setDate(echeance.getDate() + 30);

  const [creee] = await tx
    .insert(facturesTable)
    .values({
      tenantId,
      customerName: d.clientName,
      // Vide : le numéro séquentiel est attribué à L'ÉMISSION, jamais avant.
      // Un brouillon numéroté trouerait la séquence s'il était supprimé.
      number: "",
      issuedDate: aujourdhui,
      dueDate: toDateString(echeance),
      amountCents,
      residualCents: amountCents,
      settled: false,
      statut: "BROUILLON",
      lines: lignes,
      totalHTCents,
      totalTVACents,
      devisId: d.id,
      ...(d.affaireId ? { affaireId: d.affaireId } : {}),
      ...(d.notes ? { notes: d.notes } : {}),
    })
    .returning();

  // Ticket 4.31 b — la facture issue d'un devis entre au Classeur comme
  // toute autre. Ici plutôt que dans la route : ce module est le SEUL chemin
  // de conversion, l'écran et la voix passent tous les deux par lui.
  await indexerAuClasseur(tx, {
    tenantId, sourceType: "FACTURE", sourceId: creee!.id,
    nom: nomAuClasseur("FACTURE", creee!.number, creee!.id), affaireId: creee!.affaireId,
  });

  return { kind: "ok" as const, facture: creee! };
}

/** Message français d'un refus, pour une route ou pour un plan vocal. */
export function messageRefusFacturation(r: ResultatFacturation): string {
  switch (r.kind) {
    case "introuvable":
      return "Devis introuvable.";
    case "non_accepte":
      return `Seul un devis accepté se facture. Celui-ci est en ${r.statut}.`;
    case "sans_ligne":
      return "Ce devis n'a aucune ligne : il n'y a rien à facturer.";
    case "ecart":
      return (
        `La facture ne vaudrait pas le devis accepté (${(r.obtenu / 100).toFixed(2)} € ` +
        `contre ${(r.attendu / 100).toFixed(2)} €). Rien n'a été créé.`
      );
    default:
      return "";
  }
}
