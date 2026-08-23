/*
 * Le QR de virement SEPA sur la facture — reste du ticket 4.21.
 *
 * ── Le défaut que ces tests visent ────────────────────────────────────────
 * Un QR qui porte un montant différent de celui imprimé au-dessus de lui. Il
 * n'échoue pas, ne lève rien, ne se voit pas : il s'ouvre dans l'application
 * bancaire du client, pré-rempli avec l'autre chiffre, et c'est le client qui
 * paie l'écart — puis l'artisan qui court après la différence.
 *
 * C'est pourquoi `calculerTotaux` est une fonction : un seul calcul, lu par le
 * rendu ET par le QR. Ces tests éprouvent qu'ils lisent bien le même.
 */
import { describe, test, expect } from "vitest";
import { chargeUtileEpc } from "@nodaq/shared";
import {
  calculerTotaux, virementPourFacture, generateHumanPdf,
  type FactureForPdf, type SellerInfo, type FactureLine,
} from "../lib/pdf-generation.js";
// Les flux d'un PDF sont compressés : une recherche naïve dans les octets ne
// prouve rien. `texteBrut` les décompresse.
import { texteBrut } from "./helpers.js";

const IBAN = "FR7630006000011234567890189";

const VENDEUR: SellerInfo = {
  nom: "SARL Dupont Bâtiment",
  siret: "12345678901234",
  adresse: "1 rue de la Paix",
  codePostal: "75001",
  ville: "Paris",
  iban: IBAN,
};

/** Une ligne de facture complète — `id` et `vatCategory` compris. */
function ligne(
  description: string, quantity: number, unitPriceCents: number, vatRate: number,
): FactureLine {
  return {
    id: `l-${description.slice(0, 4)}`, description, quantity, unitPriceCents, vatRate,
    vatCategory: "S",
  };
}

function facture(patch: Partial<FactureForPdf> = {}): FactureForPdf {
  return {
    numero: "FACT-2026-0042",
    type: "FACTURE",
    issuedDate: "2026-08-23",
    seller: VENDEUR,
    clientName: "Madame Martin",
    lines: [ligne("Pose de placo", 10, 4500, 20)],
    autoliquidation: false,
    ...patch,
  };
}

/** Le montant que le QR encode réellement, relu depuis la charge utile. */
function montantEncode(data: FactureForPdf): string | null {
  const totaux = calculerTotaux(data);
  const virement = virementPourFacture(data, totaux.netAPayer);
  if (!virement) return null;
  const charge = chargeUtileEpc(virement);
  return charge ? charge.split("\n")[7]! : null;
}

describe("le QR porte exactement ce qui est imprimé", () => {
  test("sans retenue de garantie : le total TTC", () => {
    // 10 × 45,00 € = 450,00 € HT, TVA 20 % → 540,00 € TTC.
    const d = facture();
    expect(calculerTotaux(d).totalTTC).toBe(54_000);
    expect(montantEncode(d)).toBe("EUR540.00");
  });

  test("avec retenue de garantie : le NET À PAYER, pas le TTC", () => {
    // Le piège de ce lot. La ligne imprimée dit « Net à payer 513,00 € » ;
    // un QR qui porterait 540,00 € ferait payer 27,00 € de trop, et le
    // document ne le dirait nulle part.
    const d = facture({ retenueGarantiePct: 5 });
    const totaux = calculerTotaux(d);
    expect(totaux.totalTTC).toBe(54_000);
    expect(totaux.retenueGarantie).toBe(2_700);
    expect(totaux.netAPayer).toBe(51_300);
    expect(montantEncode(d)).toBe("EUR513.00");
  });

  test("en franchise en base : pas de TVA, et le QR suit", () => {
    const d = facture({ seller: { ...VENDEUR, tvaFranchise: true } });
    expect(calculerTotaux(d).totalTTC).toBe(45_000);
    expect(montantEncode(d)).toBe("EUR450.00");
  });

  test("en autoliquidation : pas de TVA, et le QR suit", () => {
    const d = facture({ autoliquidation: true });
    expect(calculerTotaux(d).totalTTC).toBe(45_000);
    expect(montantEncode(d)).toBe("EUR450.00");
  });

  test("la référence encodée est le numéro de facture", () => {
    const d = facture();
    const charge = chargeUtileEpc(virementPourFacture(d, calculerTotaux(d).netAPayer)!)!;
    expect(charge.split("\n")[10]).toBe("FACT-2026-0042");
  });
});

describe("les trois documents qui ne portent jamais de QR", () => {
  test("un devis n'en porte pas — rien n'est dû avant acceptation", () => {
    expect(virementPourFacture(facture({ type: "DEVIS" }), 54_000)).toBeNull();
  });

  test("un avoir n'en porte pas — l'argent va dans l'autre sens", () => {
    // Le pire défaut possible de ce lot : faire payer une seconde fois un
    // client à qui on doit de l'argent.
    expect(virementPourFacture(facture({ type: "AVOIR" }), 54_000)).toBeNull();
  });

  test("une facture sans IBAN n'en porte pas", () => {
    const sansIban = { ...VENDEUR };
    delete sansIban.iban;
    expect(virementPourFacture(facture({ seller: sansIban }), 54_000)).toBeNull();
  });
});

describe("le PDF lui-même", () => {
  test("la facture porte le bloc, l'IBAN en clair et la référence", async () => {
    const pdf = await generateHumanPdf(facture());
    const texte = texteBrut(pdf);
    expect(texte).toContain("Payer par virement");
    // L'IBAN reste lisible à l'œil : un client sans lecteur de QR, une facture
    // photocopiée. Le QR est un raccourci, jamais la seule voie.
    expect(texte).toContain("FR76 3000 6000 0112 3456 7890 189");
    // Une image est réellement embarquée — sans quoi le bloc annoncerait un
    // code à scanner qui n'existe pas. Elle se cherche dans les objets du
    // document, pas dans les flux décompressés.
    expect(pdf.toString("latin1")).toContain("/Image");
  });

  test("le devis ne porte pas le bloc", async () => {
    const pdf = await generateHumanPdf(facture({ type: "DEVIS" }));
    expect(texteBrut(pdf)).not.toContain("Payer par virement");
  });

  test("un IBAN invalide n'empêche pas la facture d'être produite", async () => {
    // Une facture sans QR reste une facture conforme. Bloquer une émission
    // pour un ornement serait un défaut bien plus grave que celui qu'on évite.
    const pdf = await generateHumanPdf(
      facture({ seller: { ...VENDEUR, iban: "FR7630006000011234567890188" } }),
    );
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(texteBrut(pdf)).not.toContain("Payer par virement");
  });

  test("une facture à zéro ne porte pas de QR", async () => {
    const pdf = await generateHumanPdf(
      facture({ lines: [ligne("Geste commercial", 1, 0, 20)] }),
    );
    expect(texteBrut(pdf)).not.toContain("Payer par virement");
  });
});
