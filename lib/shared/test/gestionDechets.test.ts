/**
 * Mentions de gestion des déchets — ticket 4.35.
 *
 * Décret n° 2020-1817 (loi AGEC). Un devis de travaux qui ne porte pas ces
 * quatre mentions est non conforme. Ce n'est pas une fonctionnalité : chaque
 * devis produit sans ce bloc est un devis que NOTRE produit a rendu non
 * conforme.
 */
import { describe, test, expect } from "vitest";
import {
  dechetsObligatoires, preremplir, mentionsManquantes, texteBlocDechets,
  DECHETS_VIDE, VERTICALS_DECHETS,
} from "../src/gestionDechets.js";

describe("a — qui est concerné", () => {
  test.each(["batiment", "paysage"])("« %s » est soumis à l'obligation", (v) => {
    expect(dechetsObligatoires(v)).toBe(true);
  });

  test.each(["restauration_chr", "professions_liberales", "negoce"])(
    "« %s » ne l'est pas", (v) => {
      // Un traiteur ne fait pas de travaux : lui imposer ce bloc serait du
      // zèle qui décrédibilise le reste.
      expect(dechetsObligatoires(v)).toBe(false);
    },
  );

  test("un secteur absent ou inconnu ne déclenche rien", () => {
    expect(dechetsObligatoires(null)).toBe(false);
    expect(dechetsObligatoires("inexistant")).toBe(false);
  });

  test("la liste est DÉRIVÉE, pas recopiée", () => {
    // Deux listes de « métiers du bâti » finiraient par diverger.
    expect(VERTICALS_DECHETS.length).toBeGreaterThan(1);
    expect(VERTICALS_DECHETS).toContain("batiment");
  });
});

describe("b — le préremplissage n'invente rien", () => {
  test("les réglages du tenant descendent dans le devis", () => {
    const d = preremplir({
      pointCollecteNom: "Déchèterie de Rouen Est",
      pointCollecteAdresse: "12 rue des Bennes, 76000 Rouen",
      coutForfaitaireCents: 15000,
    });
    expect(d.pointCollecteNom).toBe("Déchèterie de Rouen Est");
    expect(d.coutCents).toBe(15000);
  });

  test("sans réglage, tout reste NUL — aucun point de collecte inventé", () => {
    const d = preremplir({ pointCollecteNom: null, pointCollecteAdresse: null, coutForfaitaireCents: null });
    // Inventer une adresse d'installation sur un document contractuel serait
    // pire que de la laisser vide.
    expect(d.pointCollecteNom).toBeNull();
    expect(d.coutCents).toBeNull();
  });

  test("la quantité n'est JAMAIS préremplie", () => {
    // Elle dépend des travaux, pas d'un réglage. La deviner serait chiffrer.
    expect(preremplir({ pointCollecteNom: "X", pointCollecteAdresse: "Y", coutForfaitaireCents: 1 })
      .quantiteTonnes).toBeNull();
  });
});

describe("c — ce qui manque est nommé", () => {
  test("un bloc vide manque des cinq mentions", () => {
    expect(mentionsManquantes(DECHETS_VIDE)).toHaveLength(5);
  });

  test("« sans déchet » se suffit à lui-même", () => {
    expect(mentionsManquantes({ ...DECHETS_VIDE, sansDechet: true })).toEqual([]);
  });

  test("un bloc complet ne manque de rien", () => {
    expect(mentionsManquantes({
      quantiteTonnes: 2.5,
      natures: ["INERTES"],
      modalites: "Tri sur chantier puis évacuation en benne",
      pointCollecteNom: "Déchèterie de Rouen Est",
      pointCollecteAdresse: "12 rue des Bennes",
      coutCents: 15000,
      sansDechet: false,
    })).toEqual([]);
  });

  test("des modalités faites d'espaces ne comptent pas", () => {
    expect(mentionsManquantes({ ...DECHETS_VIDE, modalites: "   " }))
      .toContain("modalités d'enlèvement");
  });
});

describe("d — le texte imprimé", () => {
  test("« sans déchet » produit la mention alternative, pas un bloc vide", () => {
    const t = texteBlocDechets({ ...DECHETS_VIDE, sansDechet: true });
    expect(t).toEqual(["Ces travaux ne génèrent pas de déchets de chantier."]);
  });

  test("les quatre mentions du décret sont présentes", () => {
    const t = texteBlocDechets({
      quantiteTonnes: 2.5,
      natures: ["INERTES", "DANGEREUX"],
      modalites: "Tri sur chantier",
      pointCollecteNom: "Déchèterie de Rouen Est",
      pointCollecteAdresse: "12 rue des Bennes",
      coutCents: 15000,
      sansDechet: false,
    }).join(" ");
    expect(t).toContain("2.5 tonne(s)");
    expect(t).toContain("inertes");
    expect(t).toContain("dangereux");
    expect(t).toContain("Tri sur chantier");
    expect(t).toContain("Déchèterie de Rouen Est — 12 rue des Bennes");
    expect(t).toContain("150.00 €");
  });

  test("ce qui n'est pas renseigné s'affiche « à préciser »", () => {
    const t = texteBlocDechets(DECHETS_VIDE).join(" ");
    // Cinq mentions, cinq « à préciser » — jamais un blanc muet, jamais une
    // valeur inventée.
    expect(t.match(/à préciser/g)).toHaveLength(5);
  });
});
