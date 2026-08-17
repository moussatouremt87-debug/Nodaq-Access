/**
 * Habilitations — statut calculé au vol, jamais un envoi poussé (aucun
 * scheduler dans ce dépôt). Cas posés à la main, comme retardPaiement.test.ts.
 */
import { describe, test, expect } from "vitest";
import {
  statutHabilitation,
  habilitationsSuggereesParVertical,
  SEUIL_ALERTE_JOURS,
} from "../src/habilitations.js";

describe("statutHabilitation", () => {
  test("sans date d'expiration → SANS_EXPIRATION, jamais EXPIREE", () => {
    expect(statutHabilitation(null, "2026-08-17")).toBe("SANS_EXPIRATION");
  });

  test("expirée hier → EXPIREE", () => {
    expect(statutHabilitation("2026-08-16", "2026-08-17")).toBe("EXPIREE");
  });

  test("expire aujourd'hui même → pas encore expirée (même doctrine que estFactureEnRetard)", () => {
    expect(statutHabilitation("2026-08-17", "2026-08-17")).not.toBe("EXPIREE");
  });

  test("expire dans 30 jours pile (le seuil par défaut) → BIENTOT_EXPIREE", () => {
    expect(statutHabilitation("2026-09-16", "2026-08-17")).toBe("BIENTOT_EXPIREE");
  });

  test("expire dans 31 jours → VALIDE, hors de la fenêtre d'alerte", () => {
    expect(statutHabilitation("2026-09-17", "2026-08-17")).toBe("VALIDE");
  });

  test("expire loin dans le futur → VALIDE", () => {
    expect(statutHabilitation("2028-01-01", "2026-08-17")).toBe("VALIDE");
  });

  test("un seuil personnalisé déplace la fenêtre BIENTOT_EXPIREE", () => {
    expect(statutHabilitation("2026-08-24", "2026-08-17", 7)).toBe("BIENTOT_EXPIREE");
    expect(statutHabilitation("2026-08-25", "2026-08-17", 7)).toBe("VALIDE");
  });

  test("la fenêtre franchit un changement de mois sans erreur de date", () => {
    // 17 août + 30 jours = 16 septembre, pas une date invalide type "31 février".
    expect(statutHabilitation("2026-09-16", "2026-08-17")).toBe("BIENTOT_EXPIREE");
    expect(SEUIL_ALERTE_JOURS).toBe(30);
  });
});

describe("habilitationsSuggereesParVertical", () => {
  test("bâtiment → habilitation électrique et CACES", () => {
    const suggestions = habilitationsSuggereesParVertical("batiment");
    expect(suggestions.map((s) => s.type)).toEqual(["habilitation_electrique", "caces"]);
  });

  test("transport → permis, carte conducteur, FIMO/FCO", () => {
    const suggestions = habilitationsSuggereesParVertical("transport");
    expect(suggestions.map((s) => s.type)).toEqual(["permis_conduire", "carte_conducteur", "fimo_fco"]);
  });

  test("santé libérale → diplôme d'État et autorisation d'exercice", () => {
    const suggestions = habilitationsSuggereesParVertical("sante_liberale");
    expect(suggestions.map((s) => s.type)).toEqual(["diplome_etat", "autorisation_exercice"]);
  });

  test("services aux entreprises → carte professionnelle CNAPS (registre 'sécurité privée')", () => {
    const suggestions = habilitationsSuggereesParVertical("services_entreprises");
    expect(suggestions.map((s) => s.type)).toEqual(["carte_pro_cnaps"]);
  });

  test("un vertical sans habilitation notoire → aucune suggestion inventée", () => {
    expect(habilitationsSuggereesParVertical("restauration_chr")).toEqual([]);
    expect(habilitationsSuggereesParVertical("autre")).toEqual([]);
  });

  test("vertical inconnu ou absent → tableau vide, jamais un crash", () => {
    expect(habilitationsSuggereesParVertical(null)).toEqual([]);
    expect(habilitationsSuggereesParVertical(undefined)).toEqual([]);
    expect(habilitationsSuggereesParVertical("n_importe_quoi")).toEqual([]);
  });
});
