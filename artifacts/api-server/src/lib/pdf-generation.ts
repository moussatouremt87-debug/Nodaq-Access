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
  tvaIntracom?: string;
  adresse?: string;
  codePostal?: string;
  ville?: string;
  decennaleAssureur?: string;
  decennaleNumero?: string;
  decennaleCouverture?: string;
  tauxHoraire?: number;
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
  factureRefNumero?: string;
  affaireRef?: string;
}

// ── Mandatory mentions checks ────────────────────────────────────────────────

export interface MentionIssue {
  code: string;
  message: string;
  bloquant: boolean;
}

export function auditMentionsFR(data: FactureForPdf): MentionIssue[] {
  const issues: MentionIssue[] = [];
  const add = (code: string, message: string, bloquant = true) =>
    issues.push({ code, message, bloquant });

  if (!data.seller.siret?.replace(/\D/g, "")) {
    add(
      "siret_vendeur_manquant",
      "SIRET de l'entreprise absent — mention obligatoire (art. 242 nonies A CGI). L'émission est bloquée jusqu'à renseignement dans Profil entreprise.",
    );
  }
  if (!data.clientName?.trim()) {
    add("client_manquant", "Nom du client absent — la facture ne peut pas être identifiée.");
  }
  if (!data.issuedDate?.match(/^\d{4}-\d{2}-\d{2}$/)) {
    add("date_emission_invalide", "Date d'émission absente ou au mauvais format.");
  }
  if (data.lines.length === 0) {
    add("aucune_ligne", "Facture sans aucune ligne — émission impossible.", false);
  }

  const hasReducedRate = data.lines.some(l => l.vatRate === 10 || l.vatRate === 5.5);
  if (hasReducedRate && !data.attestationTvaFournie) {
    add(
      "attestation_tva_manquante",
      "Ligne(s) au taux réduit (10 % ou 5,5 %) sans attestation TVA signée par le client. L'émission est bloquée : récupérez et cochez l'attestation avant d'émettre.",
    );
  }

  if (!data.seller.decennaleAssureur && !data.autoliquidation) {
    add(
      "decennale_manquante",
      "Assurance décennale non renseignée dans Profil entreprise. La mention est obligatoire sur les factures de travaux (art. L.241-1 C.assur.). Complétez votre profil.",
      false,
    );
  }

  return issues;
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
 * PDF lisible, sans pièce jointe XML.
 *
 * EXPORTÉ pour les DEVIS : Factur-X est un format de facture, et un devis n'en
 * est pas une. Les factures et avoirs passent par `archiveFacturxPdf`, qui
 * ajoute le XML par-dessus ce même rendu.
 */
export async function generateHumanPdf(data: FactureForPdf): Promise<Buffer> {
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
      : data.type === "DEVIS" ? `Devis n° ${data.numero}`
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
    const vatCategories: Record<string, { base: number; vat: number }> = {};
    for (const line of data.lines) {
      const net = Math.round(line.quantity * line.unitPriceCents);
      const vatRate = line.vatRate ?? 20;
      const vatKey = String(vatRate);
      if (!vatCategories[vatKey]) vatCategories[vatKey] = { base: 0, vat: 0 };
      vatCategories[vatKey]!.base += net;

      const desc = line.description.length > 55 ? line.description.slice(0, 52) + "…" : line.description;
      if (y > 720) { doc.addPage(); y = doc.page.margins.top; }
      doc.text(desc, 50, y, { width: 245 });
      doc.text(line.quantity.toFixed(2), 300, y, { width: 40, align: "right" });
      doc.text(fmtCents(line.unitPriceCents), 345, y, { width: 55, align: "right" });
      doc.text(`${vatRate} %`, 405, y, { width: 35, align: "right" });
      doc.text(fmtCents(net), 445, y, { width: 55, align: "right" });
      y += 14;
    }

    // Compute VAT by bucket
    for (const [rate, bucket] of Object.entries(vatCategories)) {
      bucket.vat = data.autoliquidation ? 0 : Math.round((bucket.base * Number(rate)) / 100);
    }
    const totalHT = Object.values(vatCategories).reduce((s, b) => s + b.base, 0);
    const totalTVA = Object.values(vatCategories).reduce((s, b) => s + b.vat, 0);
    const totalTTC = totalHT + totalTVA;

    // Totals
    y += 10;
    doc.moveTo(50, y).lineTo(500, y).lineWidth(0.5).stroke();
    y += 8;

    const totX = 345, amtX = 445, totW = 95, amtW = 55;
    doc.fontSize(9).font("Helvetica");

    for (const [rate, bucket] of Object.entries(vatCategories)) {
      doc.text(`Base TVA ${rate} %`, totX, y, { width: totW });
      doc.text(fmtCents(bucket.base), amtX, y, { width: amtW, align: "right" }); y += 12;
      if (!data.autoliquidation) {
        doc.text(`TVA ${rate} %`, totX, y, { width: totW });
        doc.text(fmtCents(bucket.vat), amtX, y, { width: amtW, align: "right" }); y += 12;
      }
    }

    doc.font("Helvetica-Bold");
    doc.text("Total HT", totX, y, { width: totW }); doc.text(fmtCents(totalHT), amtX, y, { width: amtW, align: "right" }); y += 12;
    if (!data.autoliquidation) {
      doc.text("Total TVA", totX, y, { width: totW }); doc.text(fmtCents(totalTVA), amtX, y, { width: amtW, align: "right" }); y += 12;
    }
    doc.fontSize(11).text("Total TTC", totX, y, { width: totW }); doc.text(fmtCents(totalTTC), amtX, y, { width: amtW, align: "right" }); y += 18;

    if (data.retenueGarantiePct && data.retenueGarantiePct > 0) {
      const rg = Math.round(totalTTC * data.retenueGarantiePct / 100);
      doc.fontSize(9).font("Helvetica");
      doc.text(`Retenue de garantie ${data.retenueGarantiePct} %`, totX, y, { width: totW });
      doc.text(fmtCents(rg), amtX, y, { width: amtW, align: "right" }); y += 12;
      doc.font("Helvetica-Bold").text("Net à payer", totX, y, { width: totW });
      doc.text(fmtCents(totalTTC - rg), amtX, y, { width: amtW, align: "right" }); y += 14;
    }

    // Legal mentions
    if (y > 680) { doc.addPage(); y = doc.page.margins.top; }
    y += 10;
    doc.fontSize(8).font("Helvetica");

    if (data.autoliquidation) {
      doc.text("Autoliquidation — article 283-2 nonies du CGI : TVA non facturée, acquittée par le preneur.", 50, y, { width: W }); y += 24;
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
    vatExemptionReason: data.autoliquidation
      ? "Autoliquidation — article 283-2 nonies du CGI"
      : undefined,
    note: data.notes?.slice(0, 1000),
  };
}

// Re-export for convenience
export { auditInvoice };
