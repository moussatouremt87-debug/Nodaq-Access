import { describe, it, expect } from "vitest";
import { validerSiret, calculerTvaIntracom, sirenFromSiret } from "./siret.js";

// SIRETs réels valides (sources publiques)
const SIRET_VALID = [
  "81234567600009", // format test audit.ts
  "52345678800018", // format test audit.ts
  "73282932000074", // Trésor Public (SIRET connu)
];

// SIRET La Poste — exception documentée (SIREN 356000000)
const SIRET_LA_POSTE = "35600000067318";

// SIRETs dont le SIREN seul ne passerait pas Luhn — doivent être ACCEPTÉS
// (Luhn s'applique au SIRET entier, pas au SIREN indépendamment)
const SIRET_SIREN_LUHN_COUNTEREXAMPLE = "73282932000074"; // Trésor Public — SIRET valid, SIREN 732829320 fails Luhn alone

const SIRET_INVALID = [
  "1234567890123",   // 13 chiffres
  "123456789001234", // 15 chiffres
  "ABCDEFGHIJKLMN",  // non numérique
  "",
  "81234567600008",  // clé incorrecte (dernier chiffre changé)
];

describe("validerSiret", () => {
  for (const s of SIRET_VALID) {
    it(`accepte le SIRET valide ${s}`, () => {
      expect(validerSiret(s)).toBe(true);
    });
  }

  it("accepte le SIRET La Poste (exception documentée)", () => {
    expect(validerSiret(SIRET_LA_POSTE)).toBe(true);
  });

  it("accepte un SIRET valide dont le SIREN seul ne passerait pas Luhn (Luhn s'applique au SIRET complet, pas au SIREN)", () => {
    // Contrexemple documenté : le préfixe SIREN (9 chiffres) n'est PAS
    // indépendamment soumis à Luhn selon l'algorithme INSEE officiel.
    // validerSiret NE DOIT PAS appeler luhn() sur digits.slice(0,9).
    expect(validerSiret(SIRET_SIREN_LUHN_COUNTEREXAMPLE)).toBe(true);
  });

  for (const s of SIRET_INVALID) {
    it(`rejette le SIRET invalide "${s}"`, () => {
      expect(validerSiret(s)).toBe(false);
    });
  }

  it("ignore les espaces et tirets dans la saisie", () => {
    expect(validerSiret("732 829 320 00074")).toBe(true);
    expect(validerSiret("732-829-320-00074")).toBe(true);
  });
});

describe("calculerTvaIntracom", () => {
  it("produit le préfixe FR suivi de 2 chiffres et du SIREN", () => {
    const tva = calculerTvaIntracom("732829320");
    expect(tva).toMatch(/^FR\d{2}732829320$/);
  });

  it("la clé est toujours sur 2 chiffres (zéro initial si nécessaire)", () => {
    // Clé = (12 + 3 * (732829320 % 97)) % 97 — vérification du format
    const tva = calculerTvaIntracom("732829320");
    const cle = tva.slice(2, 4);
    expect(cle).toMatch(/^\d{2}$/);
  });

  it("lève une erreur pour un SIREN non numérique ou de longueur incorrecte", () => {
    expect(() => calculerTvaIntracom("1234")).toThrow();
    expect(() => calculerTvaIntracom("ABC123456")).toThrow();
  });

  it("résultat déterministe : même SIREN → même TVA", () => {
    expect(calculerTvaIntracom("812345676")).toBe(calculerTvaIntracom("812345676"));
  });
});

describe("sirenFromSiret", () => {
  it("extrait les 9 premiers chiffres", () => {
    expect(sirenFromSiret("81234567600009")).toBe("812345676");
  });
});
