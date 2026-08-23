/*
 * La caution à première demande — US-B1.2, et l'avertissement décennale — US-B1.3.
 *
 * ── Ce que la caution change, et pourquoi c'est délicat ───────────────────
 * En mode RETENUE, un pourcentage est déduit du net à payer et consigné. En
 * mode CAUTION, une garantie bancaire le remplace : le client paie
 * l'intégralité du TTC, et la trésorerie de l'artisan n'est pas immobilisée.
 *
 * Ce choix décide donc du NET À PAYER — donc du montant que porte le QR de
 * virement (ticket 4.21). Une seule source, `calculerTotaux`, pour que le QR
 * et la ligne imprimée ne puissent pas diverger : c'est le même invariant que
 * pour la retenue, étendu au nouveau mode.
 */
import { describe, test, expect } from "vitest";
import { chargeUtileEpc } from "@nodaq/shared";
import {
  calculerTotaux, virementPourFacture, generateHumanPdf,
  type FactureForPdf, type SellerInfo, type FactureLine,
} from "../lib/pdf-generation.js";
import { texteBrut } from "./helpers.js";
import { REGLES_MENTIONS } from "../lib/mentions-obligatoires.js";

const VENDEUR: SellerInfo = {
  nom: "SARL Dupont Bâtiment", siret: "12345678901234",
  adresse: "1 rue de la Paix", codePostal: "75001", ville: "Paris",
  iban: "FR7630006000011234567890189",
};

const ligne = (ht: number): FactureLine => ({
  id: "l1", description: "Lot gros œuvre", quantity: 1,
  unitPriceCents: ht, vatRate: 20, vatCategory: "S",
});

function facture(patch: Partial<FactureForPdf> = {}): FactureForPdf {
  return {
    numero: "FACT-2026-0042", type: "FACTURE",
    issuedDate: "2026-05-01", seller: VENDEUR, clientName: "Madame Martin",
    lines: [ligne(100_000)], autoliquidation: false,
    retenueGarantiePct: 5,
    ...patch,
  };
}

describe("les deux modes de garantie", () => {
  test("en RETENUE, le montant est DÉDUIT du net à payer", () => {
    const t = calculerTotaux(facture({ garantieMode: "RETENUE" }));
    expect(t.totalTTC).toBe(120_000);
    expect(t.garantieCents).toBe(6_000);
    expect(t.retenueGarantie).toBe(6_000);
    expect(t.netAPayer).toBe(114_000);
  });

  test("en CAUTION, rien n'est déduit — le client paie tout le TTC", () => {
    // C'est TOUT l'intérêt de l'alternative : la trésorerie n'est pas
    // immobilisée. Déduire quand même annulerait la raison d'y recourir.
    const t = calculerTotaux(facture({ garantieMode: "CAUTION" }));
    expect(t.totalTTC).toBe(120_000);
    expect(t.retenueGarantie).toBe(0);
    expect(t.netAPayer).toBe(120_000);
  });

  test("en CAUTION, le montant garanti reste CALCULÉ, pour être affiché", () => {
    // Sans lui, le client ignorerait ce que la banque garantit — et le
    // découvrirait au moment de faire jouer la garantie.
    const t = calculerTotaux(facture({ garantieMode: "CAUTION" }));
    expect(t.garantieCents).toBe(6_000);
    expect(t.parCaution).toBe(true);
  });

  test("sans mode précisé, on retombe sur la RETENUE", () => {
    // Le défaut historique. Basculer silencieusement les factures existantes
    // en caution changerait leur net à payer sans que personne l'ait demandé.
    const t = calculerTotaux(facture({}));
    expect(t.netAPayer).toBe(114_000);
  });
});

describe("le QR de virement suit le mode", () => {
  const montant = (f: FactureForPdf) => {
    const t = calculerTotaux(f);
    const v = virementPourFacture(f, t.netAPayer);
    return v ? chargeUtileEpc(v)!.split("\n")[7] : null;
  };

  test("en RETENUE, le QR porte le net à payer", () => {
    expect(montant(facture({ garantieMode: "RETENUE" }))).toBe("EUR1140.00");
  });

  test("en CAUTION, le QR porte le TTC entier", () => {
    // Le piège de ce lot : un QR resté au net à payer ferait virer 1 140 €
    // pour une facture de 1 200 €, et l'artisan courrait après 60 € sans
    // savoir d'où vient l'écart.
    expect(montant(facture({ garantieMode: "CAUTION" }))).toBe("EUR1200.00");
  });
});

describe("le document imprimé", () => {
  test("en RETENUE, il porte la ligne « Net à payer »", async () => {
    const pdf = await generateHumanPdf(facture({ garantieMode: "RETENUE" }));
    const texte = texteBrut(pdf);
    expect(texte).toContain("Retenue de garantie");
    expect(texte).toContain("Net à payer");
  });

  test("en CAUTION, il ANNONCE la garantie et dit que rien n'est retenu", async () => {
    const pdf = await generateHumanPdf(facture({
      garantieMode: "CAUTION",
      cautionOrganisme: "Crédit Mutuel",
      cautionEcheance: "2027-05-01",
    }));
    const texte = texteBrut(pdf);
    expect(texte).toContain("Garantie à première demande");
    expect(texte).toContain("Crédit Mutuel");
    expect(texte).toMatch(/[Aa]ucune retenue/);
    // Et surtout : pas de ligne « Net à payer » qui contredirait le TTC.
    expect(texte).not.toContain("Net à payer");
  });
});

describe("l'avertissement décennale — US-B1.3", () => {
  const regle = REGLES_MENTIONS.find((r) => r.code === "decennale_manquante")!;

  test("il DIT la sanction, il ne la sous-entend pas", () => {
    // Le libellé d'avant — « la mention est obligatoire, complétez votre
    // profil » — était le « rappel générique sous-dimensionné » que la story
    // nomme. Un avertissement lu comme une formalité se remet à demain.
    expect(regle.message).toContain("6 mois");
    expect(regle.message).toContain("75 000");
    expect(regle.message).toContain("L.243-3");
    expect(regle.message).toMatch(/responsabilité civile/);
  });

  test("il reste NON bloquant", () => {
    // Contrairement au SIRET. Une facture émise vaut mieux qu'une facture
    // retenue, et l'artisan est seul juge de son assurance.
    expect(regle.bloquant).toBe(false);
  });
});
