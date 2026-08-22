/**
 * Mentions AGEC sur les devis de travaux — ticket 4.35.
 *
 * Décret n° 2020-1817. Un devis de travaux sans ces mentions est non conforme,
 * et l'amende se compte en milliers d'euros. Ce qui est en jeu ici n'est pas
 * une fonctionnalité : chaque devis produit sans le bloc est un devis que
 * NOTRE produit a rendu non conforme.
 */
import { describe, test, expect } from "vitest";
import { auditMentionsFR, type FactureForPdf } from "../lib/pdf-generation.js";
import { DECHETS_VIDE } from "@nodaq/shared";

const DEVIS: FactureForPdf = {
  numero: "DEV-2026-0042",
  type: "DEVIS",
  issuedDate: "2026-08-22",
  seller: {
    nom: "Couverture Lemarchand",
    siret: "84219765400028",
    decennaleAssureur: "MAAF",
    decennaleNumero: "DEC-1",
    decennaleCouverture: "France",
  },
  clientName: "Delacroix",
  lines: [{ id: "l1", description: "Pose", quantity: 1, unitPriceCents: 100000, vatRate: 20, vatCategory: "S" }],
  autoliquidation: false,
};

const codes = (d: FactureForPdf, vertical: Parameters<typeof auditMentionsFR>[1]) =>
  auditMentionsFR(d, vertical).map((a) => a.code);

describe("a — un devis de travaux SANS le bloc est signalé", () => {
  test("bâtiment : l'anomalie est levée", () => {
    expect(codes(DEVIS, "batiment")).toContain("mentions_dechets_manquantes");
  });

  test("paysage aussi — le décret vise aussi le jardinage", () => {
    expect(codes(DEVIS, "paysage")).toContain("mentions_dechets_manquantes");
  });

  test("mais elle n'est PAS bloquante", () => {
    // Décision du ticket : « on signale, on n'empêche pas — le dirigeant reste
    // maître ». Refuser l'émission transformerait une obligation de forme en
    // blocage d'activité, sur un document qu'il faut parfois sortir dans
    // l'heure.
    const a = auditMentionsFR(DEVIS, "batiment")
      .find((x) => x.code === "mentions_dechets_manquantes");
    expect(a).toBeDefined();
    expect(a!.bloquant).toBe(false);
  });
});

describe("b — les secteurs hors travaux ne voient rien", () => {
  test.each(["restauration_chr", "professions_liberales", "negoce"] as const)(
    "« %s » n'est pas concerné", (v) => {
      // Ce n'est pas une branche qu'on a pensé à écrire : la règle porte
      // `verticals`, donc elle n'est simplement pas évaluée.
      expect(codes(DEVIS, v)).not.toContain("mentions_dechets_manquantes");
    },
  );
});

describe("c — seuls les DEVIS sont concernés", () => {
  test("une facture de travaux ne déclenche pas la règle", () => {
    // Le décret vise le devis, document d'engagement. L'étendre à la facture
    // serait du zèle qui ferait douter du reste des mentions.
    const facture = { ...DEVIS, type: "FACTURE" as const, dueDate: "2026-09-22" };
    expect(codes(facture, "batiment")).not.toContain("mentions_dechets_manquantes");
  });
});

describe("d — un bloc complet éteint l'anomalie", () => {
  test("les cinq mentions renseignées : plus rien à signaler", () => {
    const complet = {
      ...DEVIS,
      gestionDechets: {
        quantiteTonnes: 2.5,
        natures: ["INERTES"] as const,
        modalites: "Tri sur chantier puis évacuation",
        pointCollecteNom: "Déchèterie de Rouen Est",
        pointCollecteAdresse: "12 rue des Bennes",
        coutCents: 15000,
        sansDechet: false,
      },
    };
    expect(codes(complet, "batiment")).not.toContain("mentions_dechets_manquantes");
  });

  test("un bloc INCOMPLET reste signalé", () => {
    // Un bloc à moitié rempli n'est pas conforme : le décret veut les quatre
    // mentions, pas un début de bonne volonté.
    const partiel = { ...DEVIS, gestionDechets: { ...DECHETS_VIDE, quantiteTonnes: 2 } };
    expect(codes(partiel, "batiment")).toContain("mentions_dechets_manquantes");
  });

  test("« travaux sans déchet » suffit, et c'est une décision tracée", () => {
    const sans = { ...DEVIS, gestionDechets: { ...DECHETS_VIDE, sansDechet: true } };
    expect(codes(sans, "batiment")).not.toContain("mentions_dechets_manquantes");
  });
});
