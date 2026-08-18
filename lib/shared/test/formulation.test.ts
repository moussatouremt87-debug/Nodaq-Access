/**
 * La formulation par le modèle — ticket 4.18.
 *
 * Trois choses sont vérifiées ici, dans cet ordre d'importance :
 *
 *   1. que le modèle ne puisse pas prononcer un chiffre qu'on ne lui a pas
 *      donné — c'est la règle 3 du CLAUDE.md, et c'est la garde qui coûte le
 *      plus cher si elle manque ;
 *   2. que l'annonce d'ouverture reste hors de portée du modèle (US-2) ;
 *   3. que le filet de secours respecte les règles qu'il est censé sauver.
 */
import { describe, test, expect } from "vitest";
import {
  INTENTIONS_REPLIQUE,
  PHRASES_MAX_PAR_REPLIQUE,
  REPLIQUES_DE_SECOURS,
  chiffresInventes,
  consigneFormulation,
  messageFormulation,
  verifierReplique,
  type IntentionReplique,
} from "../src/formulation.js";

const AUCUN_FAIT = {} as const;

// ── a. La garde des chiffres (règle 3) ─────────────────────────────────────

describe("a — le modèle ne peut prononcer que les chiffres qu'on lui donne", () => {
  test("un montant inventé est refusé", () => {
    const faits = { montant: "1200 €", date: "15 septembre" };
    const anomalies = verifierReplique(
      "Alors, vous réglez 1500 € le 15 septembre. C'est bien ça ?",
      faits,
    );
    expect(anomalies.some((a) => a.nature === "chiffre_invente")).toBe(true);
  });

  test("un délai inventé est refusé", () => {
    // Le cas qui engage vraiment : le modèle « arrondit » un délai accordé.
    const faits = { versements: "3", premier_versement_jours: "10" };
    const anomalies = verifierReplique(
      "Du coup on peut faire 3 fois, le premier sous 30 jours. Ça vous va ?",
      faits,
    );
    expect(anomalies.some((a) => a.nature === "chiffre_invente")).toBe(true);
  });

  test("les chiffres fidèlement repris passent", () => {
    const faits = { versements: "3", premier_versement_jours: "10" };
    expect(
      verifierReplique("Du coup on peut faire 3 fois, le premier sous 10 jours.", faits),
    ).toEqual([]);
  });

  test("un montant groupé par espaces n'est pas pris pour une invention", () => {
    // « 1 200 » et « 1200 » sont le même nombre. Sans normalisation, la garde
    // accuserait le modèle d'inventer « 1 » et « 200 » alors qu'il répète le
    // fait mot pour mot — une garde qui punit la conformité finit désarmée.
    const faits = { montant: "1200" };
    expect(chiffresInventes("Vous réglez 1 200 euros.", faits)).toEqual([]);
    expect(chiffresInventes("Vous réglez 1 200 euros.", { montant: "1 200" })).toEqual([]);
  });

  test("une réplique sans aucun chiffre ne déclenche rien", () => {
    expect(chiffresInventes("Alors, quel jour je peux noter ?", AUCUN_FAIT)).toEqual([]);
  });

  test("sans faits, TOUT chiffre est une invention", () => {
    expect(chiffresInventes("Réglez sous 8 jours.", AUCUN_FAIT)).toEqual(["8"]);
  });
});

// ── b. Les autres gardes de sortie ─────────────────────────────────────────

describe("b — registre, oralité, longueur", () => {
  test("une menace est refusée", () => {
    const anomalies = verifierReplique(
      "Sans règlement, on passe au contentieux.",
      AUCUN_FAIT,
    );
    expect(anomalies.some((a) => a.nature === "registre_interdit")).toBe(true);
  });

  test("une tournure administrative est refusée", () => {
    const anomalies = verifierReplique(
      "Nous vous prions de régulariser.",
      AUCUN_FAIT,
    );
    expect(anomalies.some((a) => a.nature === "oralite")).toBe(true);
  });

  test("un monologue est refusé même en phrases courtes", () => {
    // L'oralité borne chaque phrase à quinze mots ; rien n'empêche d'en empiler
    // douze. Au téléphone, ça reste un monologue.
    const empilement = "Bonjour. Je vous appelle. C'est pour la facture. Elle est en retard. Voilà.";
    const anomalies = verifierReplique(empilement, AUCUN_FAIT);
    expect(anomalies.some((a) => a.nature === "trop_de_phrases")).toBe(true);
  });

  test("le plafond est QUATRE phrases — le nombre est l'exigence", () => {
    expect(PHRASES_MAX_PAR_REPLIQUE).toBe(4);
    expect(verifierReplique("Une. Deux. Trois. Quatre.", AUCUN_FAIT)).toEqual([]);
    expect(
      verifierReplique("Une. Deux. Trois. Quatre. Cinq.", AUCUN_FAIT).some(
        (a) => a.nature === "trop_de_phrases",
      ),
    ).toBe(true);
  });

  test("une réplique vide est refusée", () => {
    expect(verifierReplique("   ", AUCUN_FAIT)).toEqual([
      { nature: "vide", detail: "réplique vide" },
    ]);
  });
});

// ── c. Ce que le modèle ne formule jamais (US-2) ───────────────────────────

describe("c — l'annonce d'ouverture reste hors de portée du modèle", () => {
  test("la liste des intentions est épinglée, l'ouverture n'y est pas", () => {
    // Une annonce qu'un modèle peut reformuler est une annonce qui peut, un
    // jour, ne plus annoncer. Elle sort de `annonceOuverture()`, mot pour mot.
    //
    // La liste est épinglée LITTÉRALEMENT plutôt que filtrée par nom : ajouter
    // une intention d'ouverture doit obliger quelqu'un à venir modifier ce test
    // — donc à décider, plutôt qu'à laisser passer. (Un filtre sur le nom
    // échouait d'ailleurs à tort sur `clore_paiement_annonce`, où « annonce »
    // désigne le paiement annoncé par le débiteur.)
    expect([...INTENTIONS_REPLIQUE]).toEqual([
      "demander_date",
      "offrir_echelonnement",
      "refuser_et_transmettre",
      "recapituler_promesse",
      "clore_contestation",
      "clore_paiement_annonce",
      "clore_rappel_humain",
      "clore_opposition",
    ]);
  });

  test("aucun objectif ne demande au modèle de se présenter", () => {
    for (const intention of INTENTIONS_REPLIQUE) {
      const message = messageFormulation(intention, {});
      expect(message, intention).not.toMatch(/présente-toi|annonce-toi|assistant automatique/i);
    }
  });
});

// ── d. Le filet de secours ─────────────────────────────────────────────────

describe("d — les répliques de secours respectent les règles qu'elles sauvent", () => {
  const FAITS_PAR_INTENTION: Readonly<Record<IntentionReplique, Record<string, string>>> = {
    demander_date: {},
    offrir_echelonnement: { versements: "3", premier_versement_jours: "10" },
    refuser_et_transmettre: {},
    recapituler_promesse: { montant: "1200 €", date: "15 septembre" },
    clore_contestation: {},
    clore_paiement_annonce: {},
    clore_rappel_humain: {},
    clore_opposition: {},
  };

  test("chaque intention a une réplique de secours", () => {
    for (const intention of INTENTIONS_REPLIQUE) {
      expect(typeof REPLIQUES_DE_SECOURS[intention]).toBe("function");
    }
  });

  test("chaque réplique de secours passe les gardes de sortie", () => {
    for (const intention of INTENTIONS_REPLIQUE) {
      const faits = FAITS_PAR_INTENTION[intention];
      const texte = REPLIQUES_DE_SECOURS[intention](faits);
      expect(verifierReplique(texte, faits), `${intention} → « ${texte} »`).toEqual([]);
    }
  });

  test("aucune réplique de secours n'écrit un chiffre en dur", () => {
    // Un chiffre en dur dans le filet serait un montant décidé par le code de
    // rédaction plutôt que par le noyau — la règle 3 contournée par la porte
    // de service.
    for (const intention of INTENTIONS_REPLIQUE) {
      const texte = REPLIQUES_DE_SECOURS[intention]({});
      expect(/\d/.test(texte), `${intention} → « ${texte} »`).toBe(false);
    }
  });
});

// ── e. La consigne et le message de tour ───────────────────────────────────

describe("e — ce qu'on envoie au modèle", () => {
  test("la consigne interdit explicitement d'inventer un chiffre", () => {
    const c = consigneFormulation();
    expect(c).toMatch(/n'en inventes aucun/i);
    expect(c).toMatch(/parlé/i);
  });

  test("le message de tour porte les faits et l'historique", () => {
    const message = messageFormulation(
      "recapituler_promesse",
      { montant: "1200 €", date: "15 septembre" },
      [
        { locuteur: "agent", propos: "Quel jour je peux noter ?" },
        { locuteur: "debiteur", propos: "Le 15." },
      ],
    );
    expect(message).toContain("montant : 1200 €");
    expect(message).toContain("Le 15.");
    // L'historique est ce qui permet au modèle de REBONDIR plutôt que de
    // réciter : sans lui, on aurait rebâti des phrases pré-écrites avec un
    // détour par le réseau.
    expect(message).toContain("LA CONVERSATION JUSQU'ICI");
  });

  test("sans historique, la section n'apparaît pas", () => {
    const message = messageFormulation("demander_date", {});
    expect(message).not.toContain("LA CONVERSATION JUSQU'ICI");
    expect(message).toContain("(aucun)");
  });
});
