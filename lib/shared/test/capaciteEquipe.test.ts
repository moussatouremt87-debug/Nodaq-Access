/**
 * compteDansCapacite — la seule question que ce module tranche : un
 * sous-traitant compte pour son coût, jamais pour la capacité RH interne.
 */
import { describe, test, expect } from "vitest";
import { compteDansCapacite, TYPE_LIEN_VALUES } from "../src/capaciteEquipe.js";

describe("compteDansCapacite", () => {
  test.each([
    ["SALARIE", true],
    ["APPRENTI", true],
    ["SOUS_TRAITANT", false],
  ])("%s → %s", (typeLien, attendu) => {
    expect(compteDansCapacite(typeLien)).toBe(attendu);
  });

  test("une valeur inconnue compte par défaut — seul SOUS_TRAITANT est exclu explicitement", () => {
    expect(compteDansCapacite("AUTRE_CHOSE")).toBe(true);
  });

  test("les trois valeurs du catalogue sont couvertes", () => {
    expect(TYPE_LIEN_VALUES).toEqual(["SALARIE", "SOUS_TRAITANT", "APPRENTI"]);
  });
});
