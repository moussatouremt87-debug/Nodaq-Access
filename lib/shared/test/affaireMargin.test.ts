/**
 * Marge d'affaire — cas calculés à la main.
 *
 * `lib/shared` n'avait aucun test alors qu'il porte le calcul le plus sensible
 * du produit : celui qu'on montre au patron d'une TPE en lui disant que c'est
 * le sien. Chaque montant attendu ci-dessous est posé à la main dans le
 * commentaire qui le précède — un test qui recopie la formule du code ne
 * prouve rien.
 *
 * La règle que ces tests protègent : une marge trop belle est pire qu'une
 * absence de marge.
 */
import { describe, test, expect } from "vitest";
import {
  computeAffaireMargin,
  type AffaireCostInput,
  type AffaireImputationInput,
} from "../src/affaireMargin.js";

/** Base neutre — chaque test ne surcharge que ce qu'il éprouve. */
function input(overrides: Partial<AffaireCostInput> = {}): AffaireCostInput {
  return {
    quotedAmountCents: 1_000_000,
    imputations: [],
    labour: null,
    invoicedCents: 0,
    invoicedBasis: "ht",
    depositsCents: 0,
    retentionRateBps: null,
    estimatedMaterialCents: null,
    ...overrides,
  };
}

const materiel = (amountCents: number): AffaireImputationInput => ({
  targetType: "classeur_document",
  amountCents,
  amountBasis: "ht",
  subcontract: false,
});

describe("aucune donnée de coût → jamais 100 % de marge", () => {
  test("ni pièce ni heure → donnees_insuffisantes", () => {
    const r = computeAffaireMargin(input());
    expect(r.kind).toBe("donnees_insuffisantes");
    expect(r.missing).toContain("couts");
    // Le champ marginCents ne doit même pas exister sur cette variante.
    expect("marginCents" in r).toBe(false);
  });
});

describe("heures — inconnu n'est pas zéro", () => {
  test("labour null → « heures » manquantes, jamais mesuré", () => {
    // Une pièce pour qu'il y ait un coût connu, sinon on tombe en
    // donnees_insuffisantes avant d'arriver au sujet du test.
    const r = computeAffaireMargin(input({ imputations: [materiel(200_000)] }));
    expect(r.missing).toContain("heures");
    expect(r.kind).toBe("marge_borne_superieure");
  });

  test("labour [] → zéro heure DÉCLARÉE, ce n'est pas « inconnu »", () => {
    const r = computeAffaireMargin(input({ imputations: [materiel(200_000)], labour: [] }));
    expect(r.missing).not.toContain("heures");
  });
});

describe("coût du membre — inconnu bascule en borne supérieure", () => {
  test("un membre sans coût horaire → borne supérieure, pas marge", () => {
    const r = computeAffaireMargin(
      input({
        imputations: [materiel(200_000)],
        labour: [{ hours: 10, hourlyCostCents: null }],
      }),
    );
    expect(r.kind).toBe("marge_borne_superieure");
    expect(r.missing).toContain("cout_horaire");
  });

  test("les heures non chiffrées ne sont PAS comptées à zéro", () => {
    // Devis 1 000 000. Matériel 200 000. Un membre à 10 h × 3 000 c = 30 000.
    // Un second membre à 10 h de coût inconnu : ses heures existent mais son
    // coût ne peut pas être ajouté. Borne au mieux = 1 000 000 − 200 000 −
    // 30 000 = 770 000. La marge réelle est forcément PLUS BASSE.
    const r = computeAffaireMargin(
      input({
        imputations: [materiel(200_000)],
        labour: [
          { hours: 10, hourlyCostCents: 3_000 },
          { hours: 10, hourlyCostCents: null },
        ],
      }),
    );
    expect(r.kind).toBe("marge_borne_superieure");
    if (r.kind !== "marge_borne_superieure") throw new Error("variante inattendue");
    expect(r.upperBoundCents).toBe(770_000);
  });
});

describe("aucune pièce rattachée → borne supérieure (décision lot 1)", () => {
  test("main-d'œuvre seule ne donne JAMAIS une marge présentée comme exacte", () => {
    // Tant qu'aucune table d'imputation n'existe, toute affaire a zéro achat
    // rattaché. Présenter la marge main-d'œuvre comme exacte reviendrait à
    // affirmer que le chantier n'a rien coûté en matériel.
    const r = computeAffaireMargin(
      input({ labour: [{ hours: 100, hourlyCostCents: 3_000 }] }),
    );
    expect(r.kind).toBe("marge_borne_superieure");
    expect(r.missing).toContain("aucune_piece_rattachee");
    // Devis 1 000 000 − main-d'œuvre 300 000 = 700 000 au mieux.
    if (r.kind !== "marge_borne_superieure") throw new Error("variante inattendue");
    expect(r.upperBoundCents).toBe(700_000);
  });
});

describe("marge exacte — cas construit à la main", () => {
  test("devis 10 000 €, matériel 2 000 €, 100 h à 30 € → 5 000 € et 50 %", () => {
    // Posé à la main :
    //   devis          1 000 000 c
    //   matériel HT      200 000 c
    //   main-d'œuvre   100 h × 3 000 c = 300 000 c
    //   coût total       500 000 c
    //   marge            500 000 c
    //   marge en bps     500 000 / 1 000 000 × 10 000 = 5 000 (50 %)
    const r = computeAffaireMargin(
      input({
        imputations: [materiel(200_000)],
        labour: [{ hours: 100, hourlyCostCents: 3_000 }],
      }),
    );
    expect(r.kind).toBe("marge");
    if (r.kind !== "marge") throw new Error("variante inattendue");
    expect(r.labourCents).toBe(300_000);
    expect(r.totalCostCents).toBe(500_000);
    expect(r.marginCents).toBe(500_000);
    expect(r.marginBps).toBe(5_000);
  });

  test("coûts sommés PAR MEMBRE, pas via un coût moyen", () => {
    // 10 h à 20 € + 5 h à 40 € = 20 000 + 20 000 = 40 000 c.
    // Un coût moyen (30 €) sur 15 h donnerait 45 000 c — faux de 5 000 c.
    const r = computeAffaireMargin(
      input({
        imputations: [materiel(100_000)],
        labour: [
          { hours: 10, hourlyCostCents: 2_000 },
          { hours: 5, hourlyCostCents: 4_000 },
        ],
      }),
    );
    if (r.kind !== "marge") throw new Error("variante inattendue");
    expect(r.labourCents).toBe(40_000);
    expect(r.labourCents).not.toBe(45_000);
  });
});

describe("garde-fous préexistants — non régressés", () => {
  test("sans devis → couts_seuls, aucune marge inventée", () => {
    const r = computeAffaireMargin(
      input({
        quotedAmountCents: null,
        imputations: [materiel(200_000)],
        labour: [{ hours: 10, hourlyCostCents: 3_000 }],
      }),
    );
    expect(r.kind).toBe("couts_seuls");
    expect("marginCents" in r).toBe(false);
  });

  test("pièce en TTC → borne supérieure via le HT MINIMAL déductible", () => {
    // Une pièce à 240 000 c TTC vaut au moins 240 000 / 1,2 = 200 000 c HT.
    // Borne = 1 000 000 − 0 (aucun coût HT connu) − 200 000 = 800 000.
    const r = computeAffaireMargin(
      input({
        imputations: [
          { targetType: "facture", amountCents: 240_000, amountBasis: "ttc", subcontract: false },
        ],
        labour: [],
      }),
    );
    expect(r.kind).toBe("marge_borne_superieure");
    expect(r.missing).toContain("pieces_ttc");
    if (r.kind !== "marge_borne_superieure") throw new Error("variante inattendue");
    expect(r.upperBoundCents).toBe(800_000);
  });
});
