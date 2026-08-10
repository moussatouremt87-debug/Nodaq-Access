/**
 * La table de vérité, EN ENTIER.
 *
 * Six lignes × trois canaux = dix-huit combinaisons, aucune omise. C'est le
 * cœur du lot : tout le reste s'y raccorde, et le serveur ne fait qu'appeler
 * cette fonction.
 */
import { describe, test, expect } from "vitest";
import {
  canauxAutorises,
  agregatPubliable,
  SEUIL_ANONYMAT,
  RETENTION_PROSPECTION_JOURS,
  type TypeContact,
  type BaseLegale,
} from "../src/canauxProspection.js";

/**
 * | contact      | base                          | e-mail | téléphone | courrier |
 * |--------------|-------------------------------|--------|-----------|----------|
 * | particulier  | consentement                  | oui    | oui       | oui      |
 * | particulier  | client existant               | oui    | oui       | oui      |
 * | particulier  | intérêt légitime, NON informé  | non    | non       | non      |
 * | particulier  | intérêt légitime, informé      | non    | non       | OUI      |
 * | professionnel| intérêt légitime               | oui    | oui       | oui      |
 * | n'importe    | opposition enregistrée         | non    | non       | non      |
 */
const TABLE: Array<{
  ligne: string;
  contact: TypeContact;
  base: BaseLegale;
  informe: string | null;
  oppose: boolean;
  attendu: { email: boolean; telephone: boolean; courrier: boolean };
}> = [
  {
    ligne: "particulier · consentement",
    contact: "PARTICULIER", base: "CONSENTEMENT", informe: null, oppose: false,
    attendu: { email: true, telephone: true, courrier: true },
  },
  {
    ligne: "particulier · client existant",
    contact: "PARTICULIER", base: "CLIENT_EXISTANT", informe: null, oppose: false,
    attendu: { email: true, telephone: true, courrier: true },
  },
  {
    ligne: "particulier · intérêt légitime, NON informé",
    contact: "PARTICULIER", base: "INTERET_LEGITIME_PARTICULIER", informe: null, oppose: false,
    attendu: { email: false, telephone: false, courrier: false },
  },
  {
    ligne: "particulier · intérêt légitime, INFORMÉ",
    contact: "PARTICULIER", base: "INTERET_LEGITIME_PARTICULIER", informe: "2026-08-01", oppose: false,
    attendu: { email: false, telephone: false, courrier: true },
  },
  {
    ligne: "professionnel · intérêt légitime",
    contact: "PRO", base: "INTERET_LEGITIME_PRO", informe: null, oppose: false,
    attendu: { email: true, telephone: true, courrier: true },
  },
  {
    ligne: "n'importe lequel · OPPOSITION",
    contact: "PRO", base: "INTERET_LEGITIME_PRO", informe: "2026-08-01", oppose: true,
    attendu: { email: false, telephone: false, courrier: false },
  },
];

describe("la table de vérité, ligne par ligne et canal par canal", () => {
  for (const cas of TABLE) {
    for (const canal of ["email", "telephone", "courrier"] as const) {
      test(`${cas.ligne} → ${canal} = ${cas.attendu[canal] ? "oui" : "non"}`, () => {
        const r = canauxAutorises(cas.contact, cas.base, cas.informe, cas.oppose);
        expect(r[canal]).toBe(cas.attendu[canal]);
      });
    }
  }

  test("les dix-huit combinaisons sont bien couvertes", () => {
    // Sans ce compte, retirer une ligne du tableau passerait inaperçu.
    expect(TABLE).toHaveLength(6);
    expect(TABLE.length * 3).toBe(18);
  });
});

describe("LE CAS QU'IL NE FAUT PAS ASSOUPLIR", () => {
  test("un particulier repéré dans un registre public, MÊME INFORMÉ, n'est ni appelé ni e-mailé", () => {
    // L'information au titre de l'article 14 donne le droit de DÉTENIR la
    // donnée, pas celui de démarcher. C'est la ligne que le produit ne
    // franchira pas, et c'est la plus tentante à franchir.
    const r = canauxAutorises("PARTICULIER", "INTERET_LEGITIME_PARTICULIER", "2026-08-01", false);
    expect(r.email).toBe(false);
    expect(r.telephone).toBe(false);
    expect(r.courrier).toBe(true);
  });

  test("non informé, même le courrier est fermé", () => {
    const r = canauxAutorises("PARTICULIER", "INTERET_LEGITIME_PARTICULIER", null, false);
    expect(r).toEqual({ email: false, telephone: false, courrier: false });
  });
});

describe("l'opposition l'emporte sur TOUT", () => {
  test.each([
    ["PARTICULIER", "CONSENTEMENT"],
    ["PARTICULIER", "CLIENT_EXISTANT"],
    ["PARTICULIER", "INTERET_LEGITIME_PARTICULIER"],
    ["PRO", "INTERET_LEGITIME_PRO"],
    ["PRO", "CONSENTEMENT"],
  ])("%s · %s + opposition → aucun canal", (contact, base) => {
    const r = canauxAutorises(contact as TypeContact, base as BaseLegale, "2026-08-01", true);
    expect(r).toEqual({ email: false, telephone: false, courrier: false });
  });
});

describe("incohérences de saisie", () => {
  test("une base « professionnelle » sur un PARTICULIER ferme tout", () => {
    // On ne devine pas ce qui était voulu.
    expect(canauxAutorises("PARTICULIER", "INTERET_LEGITIME_PRO", "2026-08-01", false))
      .toEqual({ email: false, telephone: false, courrier: false });
  });

  test("une base « particulier » sur un PRO ferme tout", () => {
    expect(canauxAutorises("PRO", "INTERET_LEGITIME_PARTICULIER", "2026-08-01", false))
      .toEqual({ email: false, telephone: false, courrier: false });
  });
});

describe("seuil d'anonymat", () => {
  test("quatre occurrences ne sont PAS publiables, cinq le sont", () => {
    // Dans une commune de trois cents habitants, « un permis de rénovation de
    // toiture ce mois-ci » désigne quelqu'un.
    expect(agregatPubliable(4)).toBe(false);
    expect(agregatPubliable(5)).toBe(true);
    expect(SEUIL_ANONYMAT).toBe(5);
  });

  test.each([0, 1, 2, 3, 4])("%i occurrence(s) → tu", (n) => {
    expect(agregatPubliable(n)).toBe(false);
  });
});

describe("conservation", () => {
  test("trois ans", () => {
    expect(RETENTION_PROSPECTION_JOURS).toBe(3 * 365);
  });
});
