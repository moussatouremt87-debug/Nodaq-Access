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
  identitesDivulguees,
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
    const faits = { nombre_de_versements: "3", jours_avant_le_premier_versement: "10" };
    const anomalies = verifierReplique(
      "Du coup on peut faire 3 fois, le premier sous 30 jours. Ça vous va ?",
      faits,
    );
    expect(anomalies.some((a) => a.nature === "chiffre_invente")).toBe(true);
  });

  test("les chiffres fidèlement repris passent", () => {
    const faits = { nombre_de_versements: "3", jours_avant_le_premier_versement: "10" };
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

  test("le tutoiement est refusé", () => {
    // La consigne demande un registre FAMILIER. Un modèle à qui l'on demande
    // de se détendre glisse volontiers de « familier » à « familier avec la
    // personne » — et tutoyer quelqu'un à qui l'on réclame de l'argent se
    // retourne aussitôt contre l'entreprise qui appelle.
    for (const texte of [
      "Alors, tu peux régler quand ?",
      "D'accord, je note ton virement.",
      "Ça te va comme ça ?",
      "Bon, t'as reçu la facture ?",
    ]) {
      const anomalies = verifierReplique(texte, AUCUN_FAIT);
      expect(anomalies.some((a) => a.nature === "tutoiement"), texte).toBe(true);
    }
  });

  test("le vouvoiement familier n'est PAS pris pour du tutoiement", () => {
    // La garde doit laisser passer exactement le registre qu'on vient de
    // demander, sinon elle refuse ce qu'elle protège et finit désactivée.
    for (const texte of [
      "Alors, vous pouvez régler quand ?",
      "On peut faire ça, ça vous va ?",
      "Je peux pas vous le dire là, je transmets.",
      "Très bien, on vous rappellera plus.",
      "Votre facture, on la vérifie de notre côté.",
    ]) {
      expect(verifierReplique(texte, AUCUN_FAIT), texte).toEqual([]);
    }
  });

  test("nommer le débiteur est refusé — le texte part chez un tiers américain", () => {
    // ADR 002 : sans Zero Retention Mode, le texte des répliques est conservé
    // chez le fournisseur de synthèse. La minimisation par construction est la
    // seconde voie que l'ADR laissait ouverte ; c'est celle-ci.
    for (const texte of [
      "Alors, monsieur Delacroix, vous réglez quand ?",
      "D'accord. Je note pour Delacroix.",
      "Très bien, DELACROIX, c'est noté.",
    ]) {
      const anomalies = verifierReplique(texte, AUCUN_FAIT, ["Menuiserie Delacroix"]);
      expect(anomalies.some((a) => a.nature === "identite_divulguee"), texte).toBe(true);
    }
  });

  test("le détail de l'anomalie ne REPREND pas le nom", () => {
    // Il finirait dans le journal du repli — c'est-à-dire exactement la donnée
    // personnelle qu'on est en train de protéger.
    const anomalies = verifierReplique("Bonjour Delacroix.", AUCUN_FAIT, ["Delacroix"]);
    const detail = anomalies.find((a) => a.nature === "identite_divulguee")?.detail ?? "";
    expect(detail).not.toMatch(/delacroix/i);
  });

  test("la forme juridique et les mots courts ne déclenchent rien", () => {
    // Une garde qui refuse « SARL » refuserait une réplique sur deux, et
    // finirait désactivée dans la semaine.
    for (const texte of [
      "Alors, on peut faire comme ça. Ça vous va ?",
      "Très bien, je note. Merci, bonne journée.",
      "D'accord, votre entreprise a bien reçu la facture ?",
    ]) {
      expect(
        verifierReplique(texte, AUCUN_FAIT, ["SARL Menuiserie Delacroix", "Monsieur Li"]),
        texte,
      ).toEqual([]);
    }
  });

  test("sans identité fournie, la garde ne fait rien", () => {
    // Elle est une DÉCISION de l'appelant : lui seul sait qui il appelle.
    expect(identitesDivulguees("Bonjour Delacroix.", [])).toEqual([]);
    expect(verifierReplique("Bonjour Delacroix.", AUCUN_FAIT)).toEqual([]);
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
    offrir_echelonnement: { nombre_de_versements: "3", jours_avant_le_premier_versement: "10" },
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

  test("la consigne exige les nombres en chiffres — c'est ce qui rend la garde efficace", () => {
    // Observé sur une vraie sortie : « trois versements », « dix jours ». Deux
    // nombres corrects, mais écrits en lettres — donc invisibles pour
    // `chiffresInventes`, qui compare des groupes de chiffres. La garde était
    // contournable sans le vouloir, simplement en changeant d'orthographe.
    expect(consigneFormulation()).toMatch(/en CHIFFRES/);
    expect(consigneFormulation()).toMatch(/toutes lettres/i);
  });

  test("la consigne demande le registre familier en règles applicables", () => {
    // « Sois familier » ne produit rien de mesurable ; « supprime le ne de
    // négation » change une réplique sur deux. Ce test épingle le fait que la
    // consigne donne des RÈGLES et pas un adjectif.
    const c = consigneFormulation();
    expect(c).toMatch(/négation sans le « ne »/i);
    expect(c).toMatch(/« on » plutôt que « nous »/i);
    // Et la borne qui va avec : familier, mais pas avec la personne.
    expect(c).toMatch(/tutoiement/i);
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
