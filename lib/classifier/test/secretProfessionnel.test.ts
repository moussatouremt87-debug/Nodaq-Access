/**
 * US-A7.2 — secret professionnel : marqueurs et défaut renversé.
 *
 * Ce que ces tests protègent :
 *   a. les marqueurs de santé et de secret professionnel classent en
 *      `confidentiel`, QUEL QUE SOIT le secteur — une entreprise du bâtiment
 *      qui reçoit un certificat médical détient de la donnée de santé ;
 *   b. la liste ne dérive pas en filet à tout attraper : « diagnostic moteur »
 *      chez un garagiste doit passer. C'est le test qui empêche d'élargir les
 *      mots-clés jusqu'à casser l'outil pour les autres métiers ;
 *   c. pour une profession à secret professionnel, le DÉFAUT devient
 *      `confidentiel` — la garantie ne peut pas reposer sur une liste de mots,
 *      qui n'attrapera jamais « M. Martin, lombalgie » ;
 *   d. un contenu explicitement public reste publiable, même pour ces
 *      professions : le renversement ne doit pas rendre l'outil inutilisable
 *      pour ce qui n'a rien de confidentiel.
 */
import { describe, test, expect } from "vitest";
import { classify } from "../src/index.js";

describe("a — les marqueurs valent pour tous les secteurs", () => {
  const marqueurs = [
    "Le secret médical m'interdit d'en dire plus",
    "Je joins le certificat médical du salarié",
    "Son dossier médical mentionne une contre-indication",
    "Mon numéro RPPS figure sur la note",
    "Cette information est couverte par le secret professionnel",
  ];

  for (const texte of marqueurs) {
    test(`« ${texte.slice(0, 40)}… » → confidentiel`, async () => {
      const r = await classify({ text: texte });
      expect(r.category).toBe("confidentiel");
      expect(r.signals).toContain("secret-professionnel");
    });
  }

  test("un tenant bâtiment recevant un certificat médical est protégé aussi", async () => {
    const r = await classify({ text: "Le maçon a envoyé son certificat médical pour l'arrêt" });
    expect(r.category).toBe("confidentiel");
  });
});

describe("b — la liste ne casse pas les autres métiers", () => {
  const innocents = [
    "Fais le diagnostic moteur de la camionnette",
    "Diagnostic de panne sur le tableau électrique",
    "Il faut une ordonnance de travaux pour le chantier",
    "On a consulté le médecin du sport pour le sponsoring",
  ];

  for (const texte of innocents) {
    test(`« ${texte.slice(0, 40)}… » n'est pas classé confidentiel`, async () => {
      const r = await classify({ text: texte });
      expect(r.category).not.toBe("confidentiel");
    });
  }
});

describe("c — le défaut renversé pour les professions à secret", () => {
  const anodin = "Peux-tu me rappeler où en est le dossier de Monsieur Martin ?";

  test("secteur à secret professionnel → confidentiel par défaut", async () => {
    const r = await classify({ text: anodin, hints: { secretProfessionnel: true } });
    expect(r.category).toBe("confidentiel");
    expect(r.signals).toContain("defaut-restrictif");
  });

  test("le même message dans un secteur ordinaire reste interne", async () => {
    const r = await classify({ text: anodin });
    expect(r.category).toBe("interne");
  });

  test("aucune liste de mots n'aurait attrapé ce message", async () => {
    // La démonstration du besoin : rien dans « lombalgie, arrêt 15 jours » ne
    // figure ni ne peut raisonnablement figurer dans une liste de marqueurs.
    const dossier = "M. Martin, lombalgie, arrêt 15 jours, revoir lundi";
    expect((await classify({ text: dossier })).category).toBe("interne");
    expect(
      (await classify({ text: dossier, hints: { secretProfessionnel: true } })).category,
    ).toBe("confidentiel");
  });
});

describe("d — le renversement ne bloque pas ce qui est manifestement public", () => {
  test("un communiqué de presse reste publiable pour un cabinet", async () => {
    const r = await classify({
      text: "Communiqué de presse : le cabinet ouvre un second site à Lyon",
      hints: { secretProfessionnel: true },
    });
    expect(r.category).toBe("non_sensible");
  });

  test("un indice `public` explicite l'emporte aussi", async () => {
    const r = await classify({
      text: "Nos horaires d'ouverture pour la rentrée",
      hints: { secretProfessionnel: true, public: true },
    });
    expect(r.category).toBe("non_sensible");
  });
});
