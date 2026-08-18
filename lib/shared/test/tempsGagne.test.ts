/**
 * US-A6.5 — le barème du temps de saisie évité.
 *
 * Ce que ces tests protègent :
 *   a. le barème couvre TOUS les types d'intention — un neuvième type ne peut
 *      pas arriver en silence avec un gain de zéro ;
 *   b. les valeurs restent PLAUSIBLES — c'est la traduction en test du point
 *      d'attention de la story : « une estimation exagérée qui se révèle
 *      fausse à l'usage nuirait à la confiance ». Personne ne pourra gonfler
 *      le barème plus tard sans que la suite proteste ;
 *   c. le cumul est bien une somme, et zéro ne s'affiche pas.
 */
import { describe, test, expect } from "vitest";
import {
  BAREME_TEMPS_MANUEL,
  AJUSTEMENTS_PAR_VERTICAL,
  COUT_NAVIGATION_S,
  COUT_CHAMP_S,
  referenceOperationSecondes,
  tempsGagneSecondes,
  formaterTempsGagne,
} from "../src/tempsGagne.js";
import { TYPES_INTENTION } from "../src/intentionVocale.js";

describe("a — le barème couvre tous les types d'intention", () => {
  test("chaque type dictable a son entrée", () => {
    for (const type of TYPES_INTENTION) {
      expect(
        BAREME_TEMPS_MANUEL[type],
        `le type « ${type} » n'a pas d'entrée dans BAREME_TEMPS_MANUEL — il vaudrait 0 en silence`,
      ).toBeDefined();
    }
  });

  test("le barème n'invente aucun type qui n'existe plus", () => {
    for (const type of Object.keys(BAREME_TEMPS_MANUEL)) {
      expect(TYPES_INTENTION as readonly string[]).toContain(type);
    }
  });
});

describe("b — les valeurs restent plausibles", () => {
  test("aucune référence ne dépasse cinq minutes", () => {
    // Ces opérations sont de petites écritures (une affaire, une échéance),
    // pas la rédaction d'un devis complet. Une référence au-delà de cinq
    // minutes signalerait un barème gonflé — exactement ce que la story
    // demande d'éviter.
    for (const type of TYPES_INTENTION) {
      const s = referenceOperationSecondes(type);
      expect(s, `« ${type} » : ${s} s, au-delà du plafond de bon sens`).toBeLessThanOrEqual(300);
      expect(s).toBeGreaterThan(0);
    }
  });

  test("la référence se recalcule à la main depuis le barème", () => {
    // AC3 : la méthode doit être vérifiable. Elle l'est ici, littéralement.
    const attendu = COUT_NAVIGATION_S + BAREME_TEMPS_MANUEL.creer_affaire.champs * COUT_CHAMP_S;
    expect(referenceOperationSecondes("creer_affaire")).toBe(attendu);
  });

  test("aucun ajustement sectoriel n'est livré — rien n'est inventé", () => {
    expect(Object.keys(AJUSTEMENTS_PAR_VERTICAL)).toEqual([]);
  });
});

describe("c — cumul et formatage", () => {
  test("le cumul est la somme des références", () => {
    const ops = [{ type: "creer_affaire" }, { type: "creer_echeance" }, { type: "consigner_activite" }];
    const attendu =
      referenceOperationSecondes("creer_affaire") +
      referenceOperationSecondes("creer_echeance") +
      referenceOperationSecondes("consigner_activite");
    expect(tempsGagneSecondes(ops)).toBe(attendu);
  });

  test("un plan vide ne vaut rien, et ne s'affiche pas", () => {
    expect(tempsGagneSecondes([])).toBe(0);
    expect(formaterTempsGagne(0)).toBeNull();
  });

  test("un type inconnu ne fait pas échouer le cumul", () => {
    expect(tempsGagneSecondes([{ type: "type_qui_nexiste_pas" }])).toBe(0);
  });

  test("le formatage suit l'ordre de grandeur", () => {
    expect(formaterTempsGagne(30)).toBe("30 s");
    expect(formaterTempsGagne(120)).toBe("2 min");
    expect(formaterTempsGagne(3600)).toBe("1 h");
    expect(formaterTempsGagne(3900)).toBe("1 h 5 min");
  });
});
