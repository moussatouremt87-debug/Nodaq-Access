/**
 * La validation d'IBAN — ticket 4.19.
 *
 * L'IBAN validé ici est celui qui RECEVRA l'argent. Le test compte autant dans
 * les deux sens : refuser un IBAN correct bloque un tenant entier ; accepter
 * un IBAN faux envoie des virements dans le vide.
 */
import { describe, test, expect } from "vitest";
import { verifierIban, normaliserIban, formaterIban, messageRefusIban } from "../src/iban.js";

describe("a — ce que la validation accepte", () => {
  test("des IBAN de test valides, dans plusieurs pays", () => {
    // IBAN de démonstration publics (jeux d'essai de la norme), aucun compte réel.
    for (const iban of [
      "FR1420041010050500013M02606",
      "DE89370400440532013000",
      "BE68539007547034",
      "NL91ABNA0417164300",
      "ES9121000418450200051332",
    ]) {
      expect(verifierIban(iban), iban).toBeNull();
    }
  });

  test("les espaces et la casse de la saisie n'ont aucune importance", () => {
    expect(verifierIban("fr14 2004 1010 0505 0001 3M02 606")).toBeNull();
    expect(verifierIban("  FR1420041010050500013M02606  ")).toBeNull();
  });
});

describe("b — ce qu'elle refuse, et pourquoi c'est le point", () => {
  test("un chiffre inversé casse la clé de contrôle", () => {
    // Le défaut le plus courant d'une saisie manuelle, et le seul que la
    // longueur ne voit pas : deux chiffres permutés.
    expect(verifierIban("FR1420041010050500013M02660")).toBe("cle_de_controle");
  });

  test("une longueur fausse pour le pays", () => {
    expect(verifierIban("FR142004101005050001")).toBe("longueur");
  });

  test("un pays inconnu", () => {
    expect(verifierIban("ZZ1420041010050500013M02606")).toBe("pays_inconnu");
  });

  test("des caractères qui n'ont rien à faire dans un IBAN", () => {
    expect(verifierIban("FR14-2004-1010/0505*0001")).toBe("caracteres_invalides");
  });

  test("vide", () => {
    expect(verifierIban("")).toBe("vide");
    expect(verifierIban("   ")).toBe("vide");
  });
});

describe("c — la présentation", () => {
  test("normaliser retire les séparateurs et met en majuscules", () => {
    expect(normaliserIban("fr14 2004-1010")).toBe("FR1420041010");
  });

  test("formater regroupe par 4, sans espace de fin", () => {
    expect(formaterIban("FR1420041010050500013M02606")).toBe(
      "FR14 2004 1010 0505 0001 3M02 606",
    );
  });

  test("chaque refus porte un message français exploitable", () => {
    for (const refus of ["vide", "caracteres_invalides", "pays_inconnu", "longueur", "cle_de_controle"] as const) {
      const message = messageRefusIban(refus);
      expect(message.length, refus).toBeGreaterThan(10);
      // Un message qui nomme le champ technique ne dit rien à un artisan.
      expect(message, refus).not.toMatch(/mod ?97|ISO|checksum/i);
    }
  });
});
