/**
 * Packs verticaux — le moteur de vocabulaire (US-A1.1).
 *
 * Ce fichier n'avait AUCUN test avant US-A1.1, malgré son en-tête soigné et
 * son architecture ADR-007 — confirmé jamais branché nulle part dans l'app.
 * Ces tests couvrent l'extension à 9 secteurs minimum (backlog v3 Epic A1) :
 * exhaustivité, honnêteté du repli neutre, et le nouvel axe `proposalWord`.
 */
import { describe, test, expect } from "vitest";
import {
  VERTICALS,
  VERTICAL_PACKS,
  PIVOT_VERTICALS,
  affaireWords,
  verticalLabel,
  verticalPack,
  verticalChoices,
  delaiPaiementUsuelJours,
} from "../src/verticalPacks.js";

describe("VERTICALS ↔ VERTICAL_PACKS — exhaustivité", () => {
  test("chaque vertical déclaré a un pack, sans surplus ni manque", () => {
    const declares = new Set(VERTICALS);
    const packes = new Set(Object.keys(VERTICAL_PACKS));
    expect(packes).toEqual(declares);
  });

  test("chaque pack a un proposalWord non vide", () => {
    for (const id of VERTICALS) {
      expect(VERTICAL_PACKS[id].proposalWord.trim().length).toBeGreaterThan(0);
    }
  });

  test("chaque pack a un delaiPaiementUsuelJours défini (0 ou 30)", () => {
    for (const id of VERTICALS) {
      expect([0, 30]).toContain(VERTICAL_PACKS[id].delaiPaiementUsuelJours);
    }
  });

  test("chaque pack a des mots d'affaire non vides", () => {
    for (const id of VERTICALS) {
      const w = VERTICAL_PACKS[id].words;
      expect(w.singular.trim().length).toBeGreaterThan(0);
      expect(w.newLabel.trim().length).toBeGreaterThan(0);
      expect(w.noneLabel.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("les 9 secteurs minimum requis par US-A1.1 sont couverts", () => {
  // bâtiment → batiment, commerce → retail (verticaux déjà existants).
  const attendus: string[] = [
    "batiment", "retail",
    "restauration_chr", "services_personne", "professions_liberales",
    "artisanat_service", "services_entreprises", "transport", "sante_liberale",
  ];

  test.each(attendus)("le vertical %s existe", (id) => {
    expect((VERTICALS as readonly string[]).includes(id)).toBe(true);
  });

  // `retail` reste `inTarget: false` — décision assumée du plan US-A1.1 :
  // on ne touche pas au sens d'`inTarget` (cible du pivot ADR-007) pour les
  // 10 verticaux déjà existants. Seuls les 7 NOUVEAUX verticaux sont ciblés.
  const nouveaux = [
    "restauration_chr", "services_personne", "professions_liberales",
    "artisanat_service", "services_entreprises", "transport", "sante_liberale",
  ];
  test.each(nouveaux)("le nouveau vertical %s est ciblé (inTarget)", (id) => {
    expect(VERTICAL_PACKS[id as (typeof VERTICALS)[number]].inTarget).toBe(true);
  });
});

describe("affaireWords / verticalLabel / verticalPack — repli honnête", () => {
  test("un vertical inconnu ou absent replie sur « affaire », jamais une invention", () => {
    expect(affaireWords(undefined).singular).toBe("affaire");
    expect(affaireWords(null).singular).toBe("affaire");
    expect(affaireWords("secteur-qui-n-existe-pas").singular).toBe("affaire");
  });

  test("bâtiment dit chantier, professions libérales dit mission, santé dit dossier", () => {
    expect(affaireWords("batiment").singular).toBe("chantier");
    expect(affaireWords("professions_liberales").singular).toBe("mission");
    expect(affaireWords("sante_liberale").singular).toBe("dossier");
    expect(affaireWords("artisanat_service").singular).toBe("prestation");
  });

  test("verticalLabel ne rend jamais une chaîne vide, même pour un vertical inconnu", () => {
    expect(verticalLabel("n-importe-quoi").trim().length).toBeGreaterThan(0);
  });

  test("verticalPack('sante_liberale').proposalWord est cohérent avec le pack complet", () => {
    expect(verticalPack("sante_liberale").proposalWord).toBe("Devis");
    expect(verticalPack("professions_liberales").proposalWord).toBe("Proposition commerciale");
  });
});

describe("verticalChoices — les 9 nouveaux sont bien ciblés (cible), pas rangés en ancien", () => {
  test("les 7 verticaux ajoutés par US-A1.1 apparaissent dans le groupe cible", () => {
    const { cible } = verticalChoices();
    const idsCible = new Set(cible.map(c => c.id));
    for (const id of [
      "restauration_chr", "services_personne", "professions_liberales",
      "artisanat_service", "services_entreprises", "transport", "sante_liberale",
    ]) {
      expect(idsCible.has(id)).toBe(true);
    }
  });

  test("PIVOT_VERTICALS (ADR-007, 5 valeurs) n'est pas modifié par cette extension", () => {
    expect(PIVOT_VERTICALS).toEqual(["batiment", "paysage", "evenementiel", "maintenance", "services_projet"]);
  });
});

describe("delaiPaiementUsuelJours — affectation par vertical (US-A3.1)", () => {
  test("encaissement comptant : retail, restauration_chr, negoce, evenementiel", () => {
    for (const id of ["retail", "restauration_chr", "negoce", "evenementiel"]) {
      expect(delaiPaiementUsuelJours(id)).toBe(0);
    }
  });

  test("délai B2B standard : batiment, professions_liberales, services_entreprises, transport, sante_liberale", () => {
    for (const id of [
      "batiment", "professions_liberales", "services_entreprises", "transport", "sante_liberale",
    ]) {
      expect(delaiPaiementUsuelJours(id)).toBe(30);
    }
  });

  test("cas ambigus tranchés prudemment vers le délai standard : services_personne, artisanat_service", () => {
    expect(delaiPaiementUsuelJours("services_personne")).toBe(30);
    expect(delaiPaiementUsuelJours("artisanat_service")).toBe(30);
  });

  test("vertical inconnu/absent → repli neutre (autre), délai standard", () => {
    expect(delaiPaiementUsuelJours(null)).toBe(30);
    expect(delaiPaiementUsuelJours("n-importe-quoi")).toBe(30);
  });
});
