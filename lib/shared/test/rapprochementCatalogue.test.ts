/**
 * Rapprochement dictée → catalogue.
 *
 * Le test central de ce lot : **aucun prix ne doit être inventé**. Un prix qui
 * n'existe pas dans le catalogue du tenant ne peut pas apparaître sur un devis,
 * quelle que soit la dictée.
 */
import { describe, test, expect } from "vitest";
import {
  rapprocher,
  rapprocherDictee,
  totalProposition,
  normaliser,
  type CatalogueEntree,
} from "../src/rapprochementCatalogue.js";

const CATALOGUE: CatalogueEntree[] = [
  {
    id: "cat-placo",
    libelle: "Cloison BA13",
    unite: "m2",
    prixUnitaireHtCents: 4_500,
    tauxTva: 20,
    motsCles: ["placo", "ba13", "cloison seche"],
  },
  {
    id: "cat-peinture",
    libelle: "Peinture murs deux couches",
    unite: "m2",
    prixUnitaireHtCents: 2_200,
    tauxTva: 10,
    motsCles: ["peinture"],
  },
];

describe("aucun prix inventé — la règle absolue", () => {
  test("un ouvrage ABSENT du catalogue sort SANS prix, marqué à compléter", () => {
    const r = rapprocher(
      { libelle: "Pose d'une véranda en aluminium", quantite: 1, unite: "u" },
      CATALOGUE,
    );
    expect(r.provenance).toBe("a_completer");
    expect(r.prixUnitaireHtCents).toBeNull();
    expect(r.tauxTva).toBeNull();
    expect(r.catalogueLigneId).toBeNull();
  });

  test("l'absence de prix est null, JAMAIS zéro", () => {
    const r = rapprocher({ libelle: "Ouvrage inconnu", quantite: 3, unite: null }, CATALOGUE);
    // 0 est un prix (la gratuité) ; null est une absence. Les confondre
    // ferait signer un devis à 0 € sur une ligne oubliée.
    expect(r.prixUnitaireHtCents).not.toBe(0);
    expect(r.prixUnitaireHtCents).toBeNull();
  });

  test("un catalogue VIDE ne produit que des lignes à compléter", () => {
    const lignes = rapprocherDictee(
      [
        { libelle: "Cloison BA13", quantite: 30, unite: "m2" },
        { libelle: "Peinture", quantite: 50, unite: "m2" },
      ],
      [],
    );
    expect(lignes.every((l) => l.provenance === "a_completer")).toBe(true);
    expect(lignes.every((l) => l.prixUnitaireHtCents === null)).toBe(true);
  });
});

describe("normalisation", () => {
  test("les accents sont retirés — « béton » et « beton » se rencontrent", () => {
    // Sonde volontaire : la plage U+0300–U+036F est invisible à la relecture.
    // Si un éditeur la mange, ce test tombe au lieu de dégrader le
    // rapprochement en silence.
    expect(normaliser("Béton ciré")).toBe("beton cire");
    expect(normaliser("maçonnerie")).toBe("maconnerie");
  });

  test("la ponctuation devient de l'espace", () => {
    expect(normaliser("Cloison B.A.13")).toBe("cloison b a 13");
  });
});

describe("rapprochement par libellé", () => {
  test("libellé identique, à la casse et aux accents près", () => {
    const r = rapprocher({ libelle: "cloison ba13", quantite: 30, unite: "m2" }, CATALOGUE);
    expect(r.provenance).toBe("catalogue");
    expect(r.prixUnitaireHtCents).toBe(4_500);
    expect(r.catalogueLigneId).toBe("cat-placo");
  });

  test("l'unité du catalogue fait foi : c'est elle qui correspond au prix", () => {
    // Dicté « en mètres », tarifé au m². Afficher « mètres » à côté d'un prix
    // au m² ferait multiplier des grandeurs incompatibles.
    const r = rapprocher({ libelle: "Cloison BA13", quantite: 30, unite: "m" }, CATALOGUE);
    expect(r.unite).toBe("m2");
  });
});

describe("rapprochement par mot-clé", () => {
  test("un mot-clé présent comme MOT ENTIER apparie", () => {
    const r = rapprocher(
      { libelle: "Fourniture et pose de placo dans le salon", quantite: 30, unite: "m2" },
      CATALOGUE,
    );
    expect(r.provenance).toBe("catalogue");
    expect(r.catalogueLigneId).toBe("cat-placo");
  });

  test("une SOUS-CHAÎNE n'apparie pas — « emplacement » ne contient pas « placo »", () => {
    const r = rapprocher(
      { libelle: "Étude d'emplacement des prises", quantite: 1, unite: "u" },
      CATALOGUE,
    );
    expect(r.provenance).toBe("a_completer");
  });

  test("deux lignes également plausibles → à compléter, on ne tranche pas au hasard", () => {
    const ambigu: CatalogueEntree[] = [
      { id: "a", libelle: "Peinture intérieure", unite: "m2", prixUnitaireHtCents: 2000, tauxTva: 20, motsCles: ["peinture"] },
      { id: "b", libelle: "Peinture extérieure", unite: "m2", prixUnitaireHtCents: 3000, tauxTva: 20, motsCles: ["peinture"] },
    ];
    const r = rapprocher({ libelle: "peinture du mur", quantite: 10, unite: "m2" }, ambigu);
    expect(r.provenance).toBe("a_completer");
    expect(r.prixUnitaireHtCents).toBeNull();
  });
});

describe("alias appris — par tenant, jamais partagés", () => {
  test("un alias appris l'emporte et est tracé comme tel", () => {
    const alias = new Map([[normaliser("le placo du salon"), "cat-placo"]]);
    const r = rapprocher({ libelle: "Le placo du salon", quantite: 12, unite: "m2" }, CATALOGUE, alias);
    expect(r.provenance).toBe("alias");
    expect(r.prixUnitaireHtCents).toBe(4_500);
  });

  test("un alias ORPHELIN (ligne supprimée) ne produit pas d'approximation", () => {
    const alias = new Map([[normaliser("truc disparu"), "cat-supprime"]]);
    const r = rapprocher({ libelle: "truc disparu", quantite: 1, unite: null }, CATALOGUE, alias);
    expect(r.provenance).toBe("a_completer");
    expect(r.prixUnitaireHtCents).toBeNull();
  });
});

describe("total de la proposition", () => {
  test("les lignes à compléter sont EXCLUES et comptées, jamais additionnées à zéro", () => {
    // Posé à la main : 30 m² × 4 500 c = 135 000 c. La véranda n'a pas de prix
    // et ne doit pas entrer pour 0 — le devis paraîtrait moins cher qu'il n'est.
    const lignes = rapprocherDictee(
      [
        { libelle: "Cloison BA13", quantite: 30, unite: "m2" },
        { libelle: "Pose d'une véranda", quantite: 1, unite: "u" },
      ],
      CATALOGUE,
    );
    const t = totalProposition(lignes);
    expect(t.totalHtCents).toBe(135_000);
    expect(t.lignesChiffrees).toBe(1);
    expect(t.lignesACompleter).toBe(1);
  });

  test("une quantité manquante rend la ligne non chiffrable", () => {
    const lignes = rapprocherDictee(
      [{ libelle: "Cloison BA13", quantite: null, unite: "m2" }],
      CATALOGUE,
    );
    const t = totalProposition(lignes);
    expect(t.totalHtCents).toBe(0);
    expect(t.lignesACompleter).toBe(1);
  });

  test("cas à deux lignes chiffrées, calculé à la main", () => {
    // 30 × 4 500 = 135 000 ; 50 × 2 200 = 110 000 ; total 245 000 c.
    const lignes = rapprocherDictee(
      [
        { libelle: "Cloison BA13", quantite: 30, unite: "m2" },
        { libelle: "Peinture murs deux couches", quantite: 50, unite: "m2" },
      ],
      CATALOGUE,
    );
    expect(totalProposition(lignes).totalHtCents).toBe(245_000);
  });
});
