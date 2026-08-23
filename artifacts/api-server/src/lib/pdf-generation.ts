/**
 * PDF generation for factures and avoirs.
 *
 * Two-layer approach:
 *   1. pdfkit renders the human-readable invoice page (all mandatory French mentions).
 *   2. buildFacturXPdf (@nodaq/facturx) attaches the Factur-X CII XML and XMP metadata.
 *
 * Same bytes everywhere: the SHA-256 stored in the DB is computed from the final file —
 * never regenerated for display.
 */

import PDFDocument from "pdfkit";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  buildCiiXml,
  buildFacturXPdf,
  auditInvoice,
  computeVatBreakdown,
} from "@nodaq/facturx";
import type { FacturXInvoice, FacturXLine, FacturXParty } from "@nodaq/facturx";
import QRCode from "qrcode";
import type { Vertical, GestionDechets } from "@nodaq/shared";
import { chargeUtileEpc, formaterIban, type VirementSepa } from "@nodaq/shared";
import { REGLES_MENTIONS } from "./mentions-obligatoires.js";

// ── Local type aliases (mirror lib/db/src/schema/factures.ts) ────────────────

export type FactureAddress = {
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
};

export type FactureLine = {
  id: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  vatRate: number;
  vatCategory: "S" | "Z" | "E" | "AE";
  unit?: string;
};

// ── Storage directory (read-only repli — new PDFs go to the DB) ──────────────
// Computed locally inside readArchivedPdf; no module-level constant exported.

// ── Types ────────────────────────────────────────────────────────────────────

export interface SellerInfo {
  nom: string;
  formeJuridique?: string;
  siret: string;
  /** SIREN (9 chiffres) — mention capital+RCS (US-A1.3). */
  siren?: string;
  tvaIntracom?: string;
  adresse?: string;
  codePostal?: string;
  ville?: string;
  decennaleAssureur?: string;
  decennaleNumero?: string;
  decennaleCouverture?: string;
  tauxHoraire?: number;
  /** Numéro d'inscription à l'ordre professionnel (US-A1.3), affiché si renseigné. */
  numeroOrdre?: string;
  /** Capital social (US-A1.3) — affiché avec `rcsVille` uniquement si les DEUX sont renseignés. */
  capitalSocial?: string;
  /** Ville du RCS (US-A1.3) — voir `capitalSocial`. */
  rcsVille?: string;
  /** Franchise en base de TVA, art. 293 B CGI (US-A1.3) — déclaré, jamais deviné. */
  tvaFranchise?: boolean;
  /** IBAN d'encaissement (ticket 4.19), source du QR de virement du 4.21. */
  iban?: string;
  /** BIC, facultatif : la version 002 de la norme EPC s'en passe dans l'EEE. */
  bic?: string;
}

export interface FactureForPdf {
  numero: string;
  type: "FACTURE" | "AVOIR" | "DEVIS";
  issuedDate: string;
  dueDate?: string;
  validUntil?: string;
  seller: SellerInfo;
  clientName: string;
  clientAddress?: FactureAddress;
  chantierAddress?: FactureAddress;
  lines: FactureLine[];
  autoliquidation: boolean;
  attestationTvaFournie?: boolean;
  retenueGarantiePct?: number;
  notes?: string;
  /**
   * Bloc réglementaire imprimé APRÈS le corps du document et AVANT les
   * conditions de paiement — position exigée par le ticket 4.35.
   *
   * Un titre et des lignes déjà rédigées : ce module met en page, il ne
   * rédige pas. Le texte vient de `texteBlocDechets`, qui est aussi celui
   * affiché à l'écran avant validation — deux rédactions du même bloc
   * finiraient par différer, et celle qu'on relit ne serait plus celle qu'on
   * imprime.
   */
  blocReglementaire?: { titre: string; lignes: readonly string[] };
  /**
   * Le bloc AGEC en DONNÉES, pour que l'audit des mentions puisse dire ce qui
   * manque. `blocReglementaire` ci-dessus n'est que sa mise en page : auditer
   * du texte déjà rédigé obligerait à le relire pour savoir s'il est complet.
   */
  gestionDechets?: GestionDechets | null;
  /**
   * Mot déjà résolu pour l'en-tête d'un document `type: "DEVIS"` (US-A2.1) —
   * ex. "Devis" ou "Proposition commerciale" selon le vertical du tenant.
   * Un mot déjà résolu, pas un vertical brut : ce module reste indépendant
   * de `@nodaq/shared`/`verticalPacks.ts`, c'est à l'appelant de le
   * résoudre. Ignoré pour FACTURE/AVOIR, dont le nom légal ne varie pas.
   */
  documentLabel?: string;
  factureRefNumero?: string;
  affaireRef?: string;
}

// ── Mandatory mentions checks ────────────────────────────────────────────────

export interface MentionIssue {
  code: string;
  message: string;
  bloquant: boolean;
}

/**
 * Les mentions obligatoires manquantes sur ce document, pour ce secteur.
 *
 * Le corps de cette fonction était une suite de `if` ; les règles vivent
 * désormais dans `mentions-obligatoires.ts`, chacune déclarant les secteurs
 * qu'elle concerne (US-A7.1). Cette fonction n'est plus qu'un ÉVALUATEUR :
 * ajouter une obligation ne la touche pas.
 *
 * Signature et sortie inchangées — `routes/factures.ts` filtre toujours sur
 * `bloquant` et rend un 422 avec `code` et `message`.
 */
export function auditMentionsFR(data: FactureForPdf, vertical: Vertical): MentionIssue[] {
  return REGLES_MENTIONS.filter(
    // Pas de `verticals` = socle commun, évalué partout. C'est ce qui garantit
    // qu'un secteur sans obligation propre ne subit aucune vérification
    // superflue, sans qu'on ait à l'écrire secteur par secteur.
    (regle) => (!regle.verticals || regle.verticals.includes(vertical)) && regle.enDefaut(data),
  ).map(({ code, message, bloquant }) => ({ code, message, bloquant }));
}

// ── Human-readable PDF via pdfkit ────────────────────────────────────────────

function addrLine(addr?: FactureAddress): string[] {
  if (!addr) return [];
  const lines: string[] = [];
  if (addr.street) lines.push(addr.street);
  if (addr.postalCode || addr.city) lines.push([addr.postalCode, addr.city].filter(Boolean).join(" "));
  if (addr.country && addr.country !== "FR") lines.push(addr.country);
  return lines;
}

function fmtCents(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

/**
 * Une date métier `AAAA-MM-JJ` en `JJ/MM/AAAA`.
 *
 * Les documents affichaient la date TELLE QU'ELLE EST STOCKÉE : « 2026-08-10 »
 * sur une facture française. C'est le format d'échange, pas celui qu'on montre
 * à un client.
 *
 * PAR DÉCOUPAGE DE CHAÎNE, jamais par `new Date(…)`. Analyser « 2026-08-10 »
 * donne minuit UTC, donc la veille dans tout fuseau négatif : mettre en forme
 * une date ne doit pas pouvoir la changer. C'est le défaut que ce dépôt a
 * corrigé partout ailleurs, et il n'a pas sa place dans un formateur.
 *
 * Ce qui ne ressemble pas à une date métier ressort tel quel : mieux vaut
 * afficher une valeur inattendue que la déformer en silence.
 */
function fmtDateFr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * SIREN (9 chiffres) formaté en 3 groupes de 3, ex. "812 345 676".
 *
 * Préfère `seller.siren` (posé à l'onboarding, déjà validé) ; à défaut,
 * dérive les 9 premiers chiffres du SIRET — un calcul déterministe sur une
 * donnée déjà validée par Luhn, pas une supposition métier. `undefined` si
 * ni l'un ni l'autre ne fournit 9 chiffres.
 */
function formatSiren(seller: SellerInfo): string | undefined {
  const brut = (seller.siren ?? seller.siret ?? "").replace(/\D/g, "").slice(0, 9);
  if (brut.length !== 9) return undefined;
  return brut.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
}

/**
 * Mention capital social + RCS (US-A1.3) — affichée UNIQUEMENT si les deux
 * champs sont renseignés (art. R.123-237 C.com. : la mention n'a de sens
 * qu'avec les deux éléments réunis). Libellé usuel, non revalidé auprès d'un
 * expert-comptable — même réserve que la mention taux réduit plus bas.
 */
function mentionCapitalRcs(seller: SellerInfo): string {
  if (!seller.capitalSocial || !seller.rcsVille) return "";
  const siren = formatSiren(seller);
  return `Capital social : ${seller.capitalSocial} — RCS ${seller.rcsVille}${siren ? " " + siren : ""}`;
}

/**
 * Les totaux du document, en centimes.
 *
 * ── Pourquoi une fonction, et pas un calcul au fil du rendu ───────────────
 * Le QR de virement (ticket 4.21) doit porter EXACTEMENT le net à payer
 * imprimé au-dessus de lui. Un second calcul, même écrit à l'identique,
 * diverge un jour — et le jour où il diverge, personne ne le voit : le QR
 * s'ouvre chez le client avec un autre montant, et c'est lui qui paie
 * l'écart. Un seul calcul, lu deux fois.
 */
export function calculerTotaux(data: FactureForPdf): {
  vatCategories: Record<string, { base: number; vat: number }>;
  masquerTva: boolean;
  totalHT: number;
  totalTVA: number;
  totalTTC: number;
  retenueGarantie: number;
  netAPayer: number;
} {
  const vatCategories: Record<string, { base: number; vat: number }> = {};
  for (const line of data.lines) {
    const net = Math.round(line.quantity * line.unitPriceCents);
    const vatKey = String(line.vatRate ?? 20);
    if (!vatCategories[vatKey]) vatCategories[vatKey] = { base: 0, vat: 0 };
    vatCategories[vatKey]!.base += net;
  }

  // Franchise en base (art. 293 B CGI) : aucune TVA n'est due, quel que soit
  // le taux porté par une ligne — même garde que l'autoliquidation.
  // `auditMentionsFR` bloque déjà l'émission d'une facture incohérente ; ce
  // calcul reste défensif pour les documents (devis) qui n'y passent pas.
  const masquerTva = data.autoliquidation || data.seller.tvaFranchise === true;
  for (const [rate, bucket] of Object.entries(vatCategories)) {
    bucket.vat = masquerTva ? 0 : Math.round((bucket.base * Number(rate)) / 100);
  }

  const totalHT = Object.values(vatCategories).reduce((s, b) => s + b.base, 0);
  const totalTVA = Object.values(vatCategories).reduce((s, b) => s + b.vat, 0);
  const totalTTC = totalHT + totalTVA;
  const retenueGarantie = data.retenueGarantiePct && data.retenueGarantiePct > 0
    ? Math.round(totalTTC * data.retenueGarantiePct / 100)
    : 0;

  return {
    vatCategories, masquerTva, totalHT, totalTVA, totalTTC, retenueGarantie,
    // Le net à payer EST le montant du QR : retenue de garantie déduite,
    // puisque c'est précisément ce que le client doit virer aujourd'hui.
    netAPayer: totalTTC - retenueGarantie,
  };
}

/**
 * Ce que le QR d'une facture doit encoder, ou `null` s'il ne doit pas exister.
 *
 * SÉPARÉ du rendu, et exporté, pour une raison précise : le montant encodé est
 * la seule chose de ce lot qu'on ne peut pas relire à l'œil sur le PDF. Sans
 * cette fonction, le prouver exigerait de décoder une image PNG — et un test
 * qu'on n'écrit pas est une garde qui n'existe pas.
 */
export function virementPourFacture(
  data: FactureForPdf,
  netAPayer: number,
): VirementSepa | null {
  if (data.type !== "FACTURE") return null;
  if (!data.seller.iban) return null;
  return {
    beneficiaire: data.seller.nom,
    iban: data.seller.iban,
    bic: data.seller.bic,
    // Le net à payer, pas le total TTC : c'est ce que le client doit virer
    // aujourd'hui, retenue de garantie déduite.
    montantCents: netAPayer,
    reference: data.numero,
  };
}

/**
 * L'image du QR, ou `null`.
 *
 * ── Trois refus délibérés, tenus par `virementPourFacture` ────────────────
 * 1. Jamais sur un DEVIS : rien n'est dû tant qu'il n'est pas accepté, et un
 *    QR invite à payer.
 * 2. Jamais sur un AVOIR : l'argent va dans l'autre sens. Un QR y ferait
 *    payer le client une seconde fois — le pire défaut possible de ce lot.
 * 3. Jamais sans IBAN valide : `chargeUtileEpc` tranche.
 *
 * Un échec de rendu n'interrompt PAS l'émission : une facture sans QR reste
 * une facture conforme, alors qu'une émission bloquée par un ornement serait
 * un défaut bien plus grave que celui qu'on évite.
 */
async function imageQrVirement(
  data: FactureForPdf,
  netAPayer: number,
): Promise<{ image: Buffer; iban: string } | null> {
  const virement = virementPourFacture(data, netAPayer);
  if (virement === null) return null;

  const charge = chargeUtileEpc(virement);
  if (charge === null) return null;

  try {
    const image = await QRCode.toBuffer(charge, {
      // Niveau M : le compromis retenu par la norme EPC. Plus haut, le QR
      // devient dense au point d'être illisible sur une facture imprimée.
      errorCorrectionLevel: "M",
      type: "png",
      margin: 0,
      scale: 6,
    });
    return { image, iban: formaterIban(virement.iban) };
  } catch {
    // Le contenu du QR n'est PAS journalisé : il porte l'IBAN.
    console.warn("[pdf] QR de virement non rendu");
    return null;
  }
}

/**
 * PDF lisible, sans pièce jointe XML.
 *
 * EXPORTÉ pour les DEVIS : Factur-X est un format de facture, et un devis n'en
 * est pas une. Les factures et avoirs passent par `archiveFacturxPdf`, qui
 * ajoute le XML par-dessus ce même rendu.
 */
export async function generateHumanPdf(data: FactureForPdf): Promise<Buffer> {
  const totaux = calculerTotaux(data);
  // Fabriqué ici, hors du rendu : `qrcode` est asynchrone et pdfkit ne l'est
  // pas. Rien n'est écrit sur le disque — l'image reste un tampon.
  const qrVirement = await imageQrVirement(data, totaux.netAPayer);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = 495;
    let y = doc.page.margins.top;

    const title =
      data.type === "AVOIR" ? `Avoir n° ${data.numero}`
      : data.type === "DEVIS" ? `${data.documentLabel ?? "Devis"} n° ${data.numero}`
      : `Facture n° ${data.numero}`;

    // Header
    doc.fontSize(18).font("Helvetica-Bold").text(title, 50, y);
    y += 28;

    const dateLabel = data.type === "DEVIS" ? "Date :" : "Date d'émission :";
    doc.fontSize(10).font("Helvetica").text(`${dateLabel} ${fmtDateFr(data.issuedDate)}`, 50, y);
    y += 14;
    if (data.dueDate) { doc.text(`Échéance : ${fmtDateFr(data.dueDate)}`, 50, y); y += 14; }
    if (data.validUntil) { doc.text(`Valable jusqu'au : ${fmtDateFr(data.validUntil)}`, 50, y); y += 14; }
    if (data.factureRefNumero) { doc.text(`Correction de la facture n° ${data.factureRefNumero}`, 50, y); y += 14; }
    y += 10;

    // Seller block
    doc.fontSize(11).font("Helvetica-Bold").text("Émetteur", 50, y); y += 16;
    doc.fontSize(9).font("Helvetica");
    const sellerLines = [
      data.seller.nom + (data.seller.formeJuridique ? ` — ${data.seller.formeJuridique}` : ""),
      data.seller.adresse ?? "",
      [data.seller.codePostal, data.seller.ville].filter(Boolean).join(" "),
      `SIRET : ${data.seller.siret}`,
      data.seller.tvaIntracom ? `N° TVA intracommunautaire : ${data.seller.tvaIntracom}` : "",
      // US-A1.3 : capital + RCS uniquement si les DEUX sont renseignés — un
      // seul des deux ne forme pas une mention légale complète.
      mentionCapitalRcs(data.seller),
      data.seller.numeroOrdre ? `N° d'inscription à l'ordre professionnel : ${data.seller.numeroOrdre}` : "",
    ].filter(Boolean);
    for (const line of sellerLines) { doc.text(line, 60, y); y += 13; }

    // Client block
    y += 8;
    doc.fontSize(11).font("Helvetica-Bold").text("Client", 50, y); y += 16;
    doc.fontSize(9).font("Helvetica");
    doc.text(data.clientName, 60, y); y += 13;
    for (const l of addrLine(data.clientAddress)) { doc.text(l, 60, y); y += 13; }

    // Chantier
    if (data.chantierAddress && Object.values(data.chantierAddress).some(Boolean)) {
      y += 8;
      doc.fontSize(11).font("Helvetica-Bold").text("Adresse du chantier", 50, y); y += 16;
      doc.fontSize(9).font("Helvetica");
      for (const l of addrLine(data.chantierAddress)) { doc.text(l, 60, y); y += 13; }
    }
    y += 14;

    // Lines table header
    doc.fontSize(9).font("Helvetica-Bold");
    doc.text("Désignation", 50, y);
    doc.text("Qté", 300, y, { width: 40, align: "right" });
    doc.text("PU HT", 345, y, { width: 55, align: "right" });
    doc.text("TVA", 405, y, { width: 35, align: "right" });
    doc.text("Total HT", 445, y, { width: 55, align: "right" });

    // Le filet passe SOUS l'en-tête, pas au travers.
    //
    // Il était tracé à `y + 5` alors que la ligne de texte fait une dizaine de
    // points de haut : le trait barrait « Désignation … Total HT ». On avance
    // de la hauteur RÉELLE de la ligne, que pdfkit connaît — une constante en
    // dur redeviendrait fausse au premier changement de corps.
    y += doc.currentLineHeight() + 3;
    doc.moveTo(50, y).lineTo(500, y).lineWidth(0.5).stroke();
    y += 8;

    doc.font("Helvetica").fontSize(8);
    const { vatCategories, masquerTva, totalHT, totalTVA, totalTTC } = totaux;
    for (const line of data.lines) {
      const net = Math.round(line.quantity * line.unitPriceCents);
      const vatRate = line.vatRate ?? 20;

      const desc = line.description.length > 55 ? line.description.slice(0, 52) + "…" : line.description;
      if (y > 720) { doc.addPage(); y = doc.page.margins.top; }
      doc.text(desc, 50, y, { width: 245 });
      doc.text(line.quantity.toFixed(2), 300, y, { width: 40, align: "right" });
      doc.text(fmtCents(line.unitPriceCents), 345, y, { width: 55, align: "right" });
      doc.text(`${vatRate} %`, 405, y, { width: 35, align: "right" });
      doc.text(fmtCents(net), 445, y, { width: 55, align: "right" });
      y += 14;
    }

    // Totals
    y += 10;
    doc.moveTo(50, y).lineTo(500, y).lineWidth(0.5).stroke();
    y += 8;

    const totX = 345, amtX = 445, totW = 95, amtW = 55;
    doc.fontSize(9).font("Helvetica");

    for (const [rate, bucket] of Object.entries(vatCategories)) {
      doc.text(`Base TVA ${rate} %`, totX, y, { width: totW });
      doc.text(fmtCents(bucket.base), amtX, y, { width: amtW, align: "right" }); y += 12;
      if (!masquerTva) {
        doc.text(`TVA ${rate} %`, totX, y, { width: totW });
        doc.text(fmtCents(bucket.vat), amtX, y, { width: amtW, align: "right" }); y += 12;
      }
    }

    doc.font("Helvetica-Bold");
    doc.text("Total HT", totX, y, { width: totW }); doc.text(fmtCents(totalHT), amtX, y, { width: amtW, align: "right" }); y += 12;
    if (!masquerTva) {
      doc.text("Total TVA", totX, y, { width: totW }); doc.text(fmtCents(totalTVA), amtX, y, { width: amtW, align: "right" }); y += 12;
    }
    doc.fontSize(11).text("Total TTC", totX, y, { width: totW }); doc.text(fmtCents(totalTTC), amtX, y, { width: amtW, align: "right" }); y += 18;

    if (totaux.retenueGarantie > 0) {
      const rg = totaux.retenueGarantie;
      doc.fontSize(9).font("Helvetica");
      // Boîte élargie vers la gauche : à `totW` (95 pt), « Retenue de garantie
      // 5 % » passait à la ligne et le « % » disparaissait sous la ligne
      // suivante. Le libellé restait lisible — c'est ce qui l'a laissé passer.
      doc.text(`Retenue de garantie ${data.retenueGarantiePct} %`, totX - 60, y, { width: totW + 60 });
      doc.text(fmtCents(rg), amtX, y, { width: amtW, align: "right" }); y += 12;
      doc.font("Helvetica-Bold").text("Net à payer", totX, y, { width: totW });
      doc.text(fmtCents(totaux.netAPayer), amtX, y, { width: amtW, align: "right" }); y += 14;
    }

    // ── QR de virement SEPA (ticket 4.21) ───────────────────────────────
    // Posé APRÈS les totaux, donc juste sous le montant qu'il encode : lu à
    // côté de « Net à payer », personne ne peut se tromper sur ce qu'il fait.
    if (qrVirement) {
      const HAUTEUR_BLOC = 92;
      if (y + HAUTEUR_BLOC > 720) { doc.addPage(); y = doc.page.margins.top; }
      y += 12;

      doc.image(qrVirement.image, 50, y, { width: 72, height: 72 });

      const tx = 134;
      doc.fontSize(9).font("Helvetica-Bold")
        .text("Payer par virement", tx, y, { width: W - 84 });
      doc.fontSize(8).font("Helvetica")
        .text(
          "Scannez ce code avec votre application bancaire : bénéficiaire, "
          + "IBAN, montant et référence seront pré-remplis.",
          tx, y + 13, { width: W - 84 },
        );
      // L'IBAN reste écrit en clair : une application qui ne lit pas les QR,
      // un client qui préfère saisir, une facture photocopiée — le QR est un
      // raccourci, jamais la seule voie.
      doc.font("Helvetica-Bold").text(qrVirement.iban, tx, y + 40, { width: W - 84 });
      doc.font("Helvetica").text(`Référence à rappeler : ${data.numero}`, tx, y + 52, { width: W - 84 });

      y += HAUTEUR_BLOC;
    }

    // Legal mentions
    if (y > 680) { doc.addPage(); y = doc.page.margins.top; }
    y += 10;
    doc.fontSize(8).font("Helvetica");

    if (data.autoliquidation) {
      doc.text("Autoliquidation — article 283-2 nonies du CGI : TVA non facturée, acquittée par le preneur.", 50, y, { width: W }); y += 24;
    }

    // US-A1.3 : franchise en base de TVA — LIBELLÉ NON VÉRIFIÉ auprès d'une
    // source officielle (BOFiP) à ce jour, même réserve que la mention taux
    // réduit ci-dessous. La condition, elle, est déjà auditée et bloquante
    // (`franchise_tva_incoherente`).
    if (data.seller.tvaFranchise) {
      doc.text("TVA non applicable — article 293 B du CGI (franchise en base).", 50, y, { width: W }); y += 14;
    }

    // Réforme 2025 : l'ancienne attestation Cerfa 1301-SD séparée est
    // remplacée par une mention obligatoire directement sur le document
    // (voir le mémo de conformité). LIBELLÉ NON VÉRIFIÉ auprès d'une source
    // officielle (BOFiP) à ce jour — à valider avec un expert-comptable
    // avant une mise en production réelle ; la présence conditionnelle et le
    // taux affiché, eux, sont corrects et testés.
    const hasReducedRate = !data.autoliquidation
      && data.lines.some(l => (l.vatRate ?? 20) === 10 || (l.vatRate ?? 20) === 5.5);
    if (hasReducedRate) {
      doc.text("Taux de TVA réduit applicable — article 279-0 bis du CGI.", 50, y, { width: W }); y += 14;
    }

    if (data.type !== "DEVIS") {
      doc.text("Conditions de règlement : paiement à 30 jours net. Pas d'escompte pour paiement anticipé.", 50, y, { width: W }); y += 14;
      doc.text("En cas de retard de paiement, des pénalités de retard seront appliquées au taux de 3 fois le taux d'intérêt légal en vigueur, conformément aux articles L.441-10 et D.441-5 du Code de commerce.", 50, y, { width: W }); y += 22;
      doc.text("Toute facture impayée donnera lieu au versement d'une indemnité forfaitaire de 40 € pour frais de recouvrement (art. D.441-5 C.com.).", 50, y, { width: W }); y += 14;
    }

    if (data.seller.decennaleAssureur) {
      doc.text(
        `Assurance décennale : ${data.seller.decennaleAssureur}${data.seller.decennaleNumero ? " — Police n° " + data.seller.decennaleNumero : ""}${data.seller.decennaleCouverture ? " — Couverture : " + data.seller.decennaleCouverture : ""}.`,
        50, y, { width: W },
      ); y += 14;
    }

    if (data.blocReglementaire && data.blocReglementaire.lignes.length > 0) {
      y += 10;
      doc.font("Helvetica-Bold").text(data.blocReglementaire.titre, 50, y, { width: W });
      doc.font("Helvetica");
      for (const ligne of data.blocReglementaire.lignes) {
        y = doc.y + 2;
        doc.text(ligne, 50, y, { width: W });
      }
      y = doc.y;
    }
    if (data.notes) { y += 6; doc.text(data.notes.slice(0, 300), 50, y, { width: W }); }

    doc.end();
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface GeneratedPdf {
  bytes: Buffer;
  sha256: string;
}

/**
 * Generate a Factur-X PDF and return its bytes and SHA-256.
 * Nothing is written to disk — the caller is responsible for persisting the
 * bytes to the `archived_pdfs` table inside its own DB transaction.
 */
export async function archiveFacturxPdf(
  data: FactureForPdf,
  facturxInvoice: FacturXInvoice,
): Promise<GeneratedPdf> {
  const humanPdfBuffer = await generateHumanPdf(data);
  const xml = buildCiiXml(facturxInvoice, "EN16931");
  const finalBytes = await buildFacturXPdf(facturxInvoice, xml, "EN16931", humanPdfBuffer);
  const sha256 = crypto.createHash("sha256").update(finalBytes).digest("hex");
  return { bytes: Buffer.from(finalBytes), sha256 };
}

/**
 * Read a PDF from the local disk — fallback for documents emitted before the
 * DB-archival migration, where `pdf_path` is still set.
 * Computes STORAGE_DIR locally so the module no longer exports it.
 */
export function readArchivedPdf(relativePath: string): Buffer | null {
  const storageDir = process.env.STORAGE_DIR ?? path.join(process.cwd(), "storage");
  const fullPath = path.join(storageDir, relativePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath);
}

/** Build a FacturXInvoice from internal facture data. */
export function buildFacturxInvoice(
  data: FactureForPdf,
  numero: string,
): FacturXInvoice {
  const lines: FacturXLine[] = data.lines.map(l => ({
    description: l.description.slice(0, 500),
    quantity: l.quantity,
    unitPriceCents: l.unitPriceCents,
    vatRate: data.autoliquidation ? 0 : (l.vatRate ?? 20),
    vatCategory: data.autoliquidation ? ("AE" as const) : (l.vatCategory ?? ("S" as const)),
    unit: l.unit,
  }));

  const placeholderInvoice = {
    number: numero,
    issueDate: data.issuedDate,
    currency: "EUR" as const,
    operationCategory: "prestation_services" as const,
    seller: {
      name: data.seller.nom,
      siret: data.seller.siret?.replace(/\s/g, "") ?? "",
      vatNumber: data.seller.tvaIntracom,
      address: { street: data.seller.adresse ?? "", postalCode: data.seller.codePostal ?? "", city: data.seller.ville ?? "", countryCode: "FR" as const },
    },
    buyer: {
      name: data.clientName,
      siret: "00000000000000",
      address: { street: data.clientAddress?.street ?? "", postalCode: data.clientAddress?.postalCode ?? "", city: data.clientAddress?.city ?? "", countryCode: "FR" as const },
    },
    lines,
    totals: { netCents: 0, vatCents: 0, grossCents: 0, dueCents: 0 },
  };

  const breakdown = computeVatBreakdown(placeholderInvoice);
  const netCents = breakdown.netCents;
  const vatCents = data.autoliquidation ? 0 : breakdown.vatCents;

  const sellerParty: FacturXParty = {
    name: data.seller.nom.slice(0, 200),
    siret: data.seller.siret?.replace(/\s/g, "") ?? "00000000000000",
    vatNumber: data.seller.tvaIntracom,
    address: {
      street: data.seller.adresse ?? "",
      postalCode: data.seller.codePostal ?? "",
      city: data.seller.ville ?? "",
      countryCode: "FR",
    },
  };

  const buyerParty: FacturXParty = {
    name: data.clientName.slice(0, 200),
    siret: "00000000000000",
    address: {
      street: data.clientAddress?.street ?? "",
      postalCode: data.clientAddress?.postalCode ?? "",
      city: data.clientAddress?.city ?? "",
      countryCode: data.clientAddress?.country ?? "FR",
    },
  };

  return {
    number: numero,
    issueDate: data.issuedDate,
    dueDate: data.dueDate,
    currency: "EUR",
    operationCategory: "prestation_services",
    seller: sellerParty,
    buyer: buyerParty,
    lines,
    totals: {
      netCents,
      vatCents,
      grossCents: netCents + vatCents,
      dueCents: netCents + vatCents,
    },
    // US-A1.3 : sans cette mention, l'audit Factur-X (BR-CO, `lib/facturx`)
    // bloque lui-même toute facture sans TVA facturée — indépendamment de
    // `auditMentionsFR` ci-dessus, qui vérifie la cohérence du PROFIL avec
    // les LIGNES, pas la présence de cette mention côté Factur-X.
    vatExemptionReason: data.autoliquidation
      ? "Autoliquidation — article 283-2 nonies du CGI"
      : data.seller.tvaFranchise
        ? "TVA non applicable, art. 293 B du CGI"
        : undefined,
    note: data.notes?.slice(0, 1000),
  };
}

// Re-export for convenience
export { auditInvoice };
