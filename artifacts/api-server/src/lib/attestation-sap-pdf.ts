/*
 * Le document d'attestation fiscale SAP — US-B4.1.
 *
 * ── Ce que ce document DOIT porter ────────────────────────────────────────
 * L'attestation ouvre droit à un crédit d'impôt de 50 % (art. 199 sexdecies du
 * CGI). Son contenu n'est pas une question de mise en page : chaque mention
 * absente est une raison pour l'administration de refuser l'avantage au client.
 *
 *   — l'identité du prestataire, son SIRET et son NUMÉRO DE DÉCLARATION SAP,
 *     qui est ce qui prouve que l'activité est éligible ;
 *   — l'identité du client, à qui l'avantage revient ;
 *   — l'année civile concernée ;
 *   — le montant EFFECTIVEMENT PAYÉ par le client, aides déduites ;
 *   — les aides perçues, affichées à part — un total sans ventilation serait
 *     invérifiable, et c'est le client qui devrait s'en expliquer ;
 *   — la référence à l'article du CGI.
 *
 * ── Ce qu'il ne porte PAS ─────────────────────────────────────────────────
 * Aucune mention de ce que le client a acheté au-delà de la nature générale du
 * service. Une attestation n'est pas une facture détaillée, et détailler des
 * interventions à domicile chez un particulier reviendrait à documenter sa vie
 * privée dans une pièce qu'il transmet à l'administration.
 */
import PDFDocument from "pdfkit";
import type { AttestationClient, PrestataireSap } from "@nodaq/shared";

const eur = (cents: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);

export async function genererAttestationSapPdf(
  a: AttestationClient,
  prestataire: PrestataireSap,
  emiseLe: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, autoFirstPage: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let y = doc.page.margins.top;

    doc.fontSize(16).font("Helvetica-Bold")
      .text("Attestation fiscale annuelle", 50, y);
    y += 22;
    doc.fontSize(11).font("Helvetica")
      .text(`Services à la personne — année ${a.annee}`, 50, y);
    y += 30;

    doc.fontSize(11).font("Helvetica-Bold").text("Prestataire", 50, y); y += 16;
    doc.fontSize(9).font("Helvetica");
    for (const l of [
      prestataire.nom,
      prestataire.adresse ?? "",
      prestataire.siret ? `SIRET : ${prestataire.siret}` : "",
      `Numéro de déclaration SAP : ${prestataire.numeroDeclarationSap ?? ""}`,
    ].filter(Boolean)) { doc.text(l, 50, y); y += 12; }
    y += 14;

    doc.fontSize(11).font("Helvetica-Bold").text("Bénéficiaire", 50, y); y += 16;
    doc.fontSize(9).font("Helvetica");
    for (const l of [a.clientNom, a.clientAdresse ?? ""].filter(Boolean)) {
      doc.text(l, 50, y); y += 12;
    }
    y += 20;

    doc.fontSize(10).font("Helvetica").text(
      `Je soussigné, représentant de ${prestataire.nom}, atteste que la personne ` +
      `désignée ci-dessus a versé les sommes suivantes au titre de prestations de ` +
      `services à la personne réalisées en ${a.annee} :`,
      50, y, { width: 495 },
    );
    y += 44;

    const ligne = (libelle: string, montant: string, gras = false) => {
      doc.fontSize(gras ? 11 : 10).font(gras ? "Helvetica-Bold" : "Helvetica");
      doc.text(libelle, 50, y, { width: 340 });
      doc.text(montant, 390, y, { width: 155, align: "right" });
      y += gras ? 20 : 16;
    };

    ligne("Total encaissé sur l'année", eur(a.totalEncaisseCents));
    if (a.aidesCents > 0) {
      // Affichées, jamais fondues dans le total : ces sommes ne sortent pas de
      // la poche du client et n'ouvrent aucun droit.
      ligne("Dont aides versées par un tiers (APA, PCH, CESU préfinancé)", `− ${eur(a.aidesCents)}`);
    }
    y += 4;
    ligne("Montant ouvrant droit à l'avantage fiscal", eur(a.montantEligibleCents), true);
    y += 16;

    doc.fontSize(8).font("Helvetica").text(
      "Les sommes ci-dessus correspondent aux versements effectivement perçus au cours " +
      `de l'année civile ${a.annee}. Elles ouvrent droit, sous conditions, au crédit ` +
      "d'impôt prévu à l'article 199 sexdecies du code général des impôts. Les aides " +
      "versées par un tiers en sont exclues et sont détaillées ci-dessus.",
      50, y, { width: 495 },
    );
    y += 52;

    doc.fontSize(9).font("Helvetica")
      .text(`Attestation établie le ${emiseLe.split("-").reverse().join("/")}.`, 50, y);

    doc.end();
  });
}
