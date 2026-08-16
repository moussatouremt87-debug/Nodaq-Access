/**
 * PDF de devis.
 *
 * ── Pourquoi ce module, et pas `archiveFacturxPdf` ──────────────────────────
 * Factur-X est un format de FACTURE : son XML décrit une créance exigible, avec
 * un numéro séquentiel et des conditions de règlement. Un devis n'en est pas
 * une. On produit donc le PDF lisible seul, sans la pièce jointe XML.
 *
 * Le générateur savait déjà le faire : `pdf-generation.ts` porte le type
 * `"DEVIS"` depuis toujours — titre « Devis n° … », « Date : » au lieu de
 * « Date d'émission : », et surtout l'OMISSION des mentions de pénalités de
 * retard et d'indemnité de recouvrement, qui ne concernent que les factures.
 * Ce chemin était écrit, correct, et mort : personne n'appelait le générateur
 * avec ce type.
 *
 * ── CE QUE CE MODULE NE FAIT PAS : archiver ─────────────────────────────────
 * `archived_pdfs` existe pour les documents dont l'immuabilité est une
 * OBLIGATION — une facture émise ne change plus. Un devis reste modifiable tant
 * qu'il n'est pas accepté : archiver chaque version n'aurait aucune valeur
 * juridique et remplirait la table pour rien.
 *
 * EN REVANCHE, à l'acceptation, le devis devient un engagement — et le client a
 * signé POUR UN CONTENU DONNÉ. Archiver la version acceptée se discute
 * sérieusement, et c'est le seul moment où cela aurait du sens. Laissé de côté
 * volontairement : c'est une décision de conservation, pas un détail
 * d'implémentation.
 */
import { eq, sql } from "drizzle-orm";
import { withTenant, devisTable, settingsTable } from "@workspace/db";
import type { Devis, DevisLine } from "@workspace/db";
import { verticalPack, type Vertical } from "@nodaq/shared";
import {
  generateHumanPdf,
  type FactureForPdf,
  type FactureLine,
  type SellerInfo,
} from "./pdf-generation.js";
import { loadSellerInfo } from "./seller-info.js";

// Même clé et même défaut que routes/votre-metier.ts (US-A1.1).
const VERTICAL_SETTING_KEY = "votre-metier.metier";
const DEFAULT_VERTICAL: Vertical = "industrie_btp";

/**
 * Mot du document pour ce tenant (US-A2.1) — "Devis" ou "Proposition
 * commerciale" selon son vertical. Requête dédiée plutôt que d'étendre
 * `chargerEmetteur` : ce dernier a trois appelants (`pdf-devis.ts`,
 * `routes/devis.ts`, `routes/public.ts` — la page d'acceptation publique
 * du client) qu'il aurait fallu tous mettre à jour pour un besoin qui ne
 * concerne que le rendu du PDF.
 */
async function chargerLibelleDocument(tenantId: string): Promise<string> {
  const rows = await withTenant(tenantId, (tx) =>
    tx.select({ value: settingsTable.value }).from(settingsTable).where(
      sql`${settingsTable.key} = ${VERTICAL_SETTING_KEY}`,
    ),
  );
  const vertical = (rows[0]?.value as Vertical | undefined) ?? DEFAULT_VERTICAL;
  return verticalPack(vertical).proposalWord;
}

/**
 * Coordonnées de l'émetteur, lues dans les réglages du tenant. Exportée sous
 * ce nom pour ses trois appelants (`pdf-devis.ts`/`routes/devis.ts`/
 * `routes/public.ts`) ; le mapping `settings → SellerInfo` lui-même vit dans
 * `lib/seller-info.ts`, partagé avec `factures.ts`/`avoirs.ts`.
 */
export async function chargerEmetteur(tenantId: string): Promise<SellerInfo> {
  return loadSellerInfo(tenantId);
}

/**
 * Traduit une ligne de devis en ligne de document.
 *
 * `vatRate` et `vatCategory` sont facultatifs sur un devis — les lignes
 * anciennes n'en portent pas. Les défauts sont posés ICI et pas dans le
 * générateur : 20 % et « S » (taux standard) sont le cas courant du bâtiment,
 * et un PDF ne doit jamais afficher un taux vide.
 */
function ligneDocument(l: DevisLine): FactureLine {
  return {
    id: l.id,
    description: l.description,
    quantity: l.quantity,
    unitPriceCents: l.unitPriceCents,
    vatRate: l.vatRate ?? 20,
    vatCategory: l.vatCategory ?? "S",
    ...(l.unit ? { unit: l.unit } : {}),
  };
}

/**
 * Produit le PDF d'un devis. Rien n'est écrit sur disque ni en base.
 *
 * La date affichée est celle de l'ENVOI quand il a eu lieu, sinon celle de la
 * création : un devis jamais envoyé n'a pas de date d'émission, et en inventer
 * une ferait passer un brouillon pour un document transmis.
 */
export async function genererPdfDevis(devis: Devis, emetteur: SellerInfo): Promise<Buffer> {
  // tz-guard-allow: `dateEnvoi` et `createdAt` sont des INSTANTS (timestamptz),
  // pas des dates métier. Le PDF affiche le jour de l'envoi tel que la base
  // l'a horodaté ; il n'y a pas de borne de période ici.
  const dateDocument = (devis.dateEnvoi ?? devis.createdAt).toISOString().slice(0, 10);
  const documentLabel = await chargerLibelleDocument(devis.tenantId);

  const donnees: FactureForPdf = {
    numero: devis.reference,
    type: "DEVIS",
    issuedDate: dateDocument,
    documentLabel,
    ...(devis.validUntil ? { validUntil: devis.validUntil } : {}),
    seller: emetteur,
    clientName: devis.clientName,
    ...(devis.clientAddress ? { clientAddress: devis.clientAddress } : {}),
    ...(devis.chantierAddress ? { chantierAddress: devis.chantierAddress } : {}),
    lines: (devis.lines ?? []).map(ligneDocument),
    autoliquidation: devis.autoliquidation,
    ...(devis.retenueGarantiePct ? { retenueGarantiePct: devis.retenueGarantiePct } : {}),
    ...(devis.notes ? { notes: devis.notes } : {}),
  };

  return generateHumanPdf(donnees);
}

/** Charge le devis et produit son PDF. `null` si le devis n'existe pas. */
export async function pdfDevisParId(tenantId: string, devisId: string): Promise<Buffer | null> {
  const [devis] = await withTenant(tenantId, (tx) =>
    tx.select().from(devisTable).where(eq(devisTable.id, devisId)),
  );
  if (!devis) return null;
  const emetteur = await chargerEmetteur(tenantId);
  return genererPdfDevis(devis, emetteur);
}

/** Nom de fichier proposé au téléchargement. */
export function nomFichierDevis(reference: string): string {
  return `${reference.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`;
}
