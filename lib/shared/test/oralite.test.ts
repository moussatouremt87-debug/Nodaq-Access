/**
 * La garde d'oralité — ticket 4.18, style oral de l'agent.
 *
 * Une garde qu'on n'a jamais vue se déclencher n'est pas une garde. Celle-ci
 * est donc testée d'abord sur ce qu'elle DOIT attraper, ensuite sur ce qu'elle
 * ne doit PAS attraper — le second point compte autant : une garde qui refuse
 * du français parlé correct serait contournée dans la semaine.
 */
import { describe, test, expect } from "vitest";
import {
  MOTS_MAX_PAR_PHRASE,
  TOURNURES_ECRITES,
  contientMarqueurOral,
  verifierOralite,
} from "../src/oralite.js";

// ── a. Ce qu'elle attrape ──────────────────────────────────────────────────

describe("a — une réplique qui sonne comme un courrier est signalée", () => {
  test.each([
    ["Nous vous prions de bien vouloir régulariser votre situation.", "nous vous prions"],
    ["Veuillez procéder au règlement.", "veuillez"],
    ["Merci de régler dans les meilleurs délais.", "meilleurs délais"],
    ["Par la présente, je vous informe du retard.", "par la présente"],
    ["Je me permets de vous rappeler cette facture.", "je me permets de"],
    ["Dans l'attente de votre retour.", "dans l'attente de"],
    ["Le cas échéant, un échéancier est possible.", "cas échéant"],
    ["Il conviendrait que le règlement intervienne.", "il conviendrait que"],
  ])("« %s » est refusée", (texte) => {
    const anomalies = verifierOralite(texte);
    expect(anomalies.some((a) => a.nature === "tournure_ecrite")).toBe(true);
  });

  test("une phrase de plus de quinze mots est refusée", () => {
    const longue =
      "Je vous appelle aujourd'hui au sujet de la facture numéro quarante-deux qui reste " +
      "impayée depuis plusieurs semaines maintenant et je souhaiterais convenir avec vous " +
      "d'une date de règlement.";
    const anomalies = verifierOralite(longue);
    expect(anomalies.some((a) => a.nature === "phrase_trop_longue")).toBe(true);
  });

  test("le seuil est QUINZE — le nombre est l'exigence", () => {
    // Épinglé littéralement : un test qui suivrait la constante suivrait aussi
    // ses erreurs. Même leçon que le plafond d'insistances du lot 3.
    expect(MOTS_MAX_PAR_PHRASE).toBe(15);

    const quinze = "un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze.";
    const seize = "un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize.";
    expect(verifierOralite(quinze)).toEqual([]);
    expect(verifierOralite(seize).some((a) => a.nature === "phrase_trop_longue")).toBe(true);
  });

  test("le subjonctif imparfait est refusé", () => {
    const anomalies = verifierOralite("Il faudrait qu'il réglât la facture.");
    expect(anomalies.some((a) => a.nature === "tournure_ecrite")).toBe(true);
  });
});

// ── b. Ce qu'elle laisse passer ────────────────────────────────────────────

describe("b — le français parlé correct n'est pas gêné", () => {
  test.each([
    "Bonjour ! Je suis l'assistant automatique de Charpente Dubois.",
    "Alors, quel jour exactement je peux noter ?",
    "Du coup, on peut faire trois fois. Ça vous irait ?",
    "Voilà. Je résume : vous réglez le quinze. C'est bien ça ?",
    "Écoutez, je note votre demande et je la transmets.",
    "Bon, très bien. Je vous remercie, bonne journée.",
  ])("« %s » passe", (texte) => {
    expect(verifierOralite(texte)).toEqual([]);
  });

  test("les mots courants en -ait ou -êt ne déclenchent rien", () => {
    // Le motif du subjonctif imparfait vise `-ât`/`-êt` ; il ne doit pas
    // mordre sur « était », « prêt », « intérêt », sinon la garde refuserait
    // du français parlé banal et finirait désactivée.
    for (const texte of [
      "C'était noté comme ça.",
      "Vous êtes prêt à régler ?",
      "Ça a un intérêt pour vous.",
      "Il paraît que le virement est parti.",
    ]) {
      expect(verifierOralite(texte), texte).toEqual([]);
    }
  });

  test("une phrase vide ou courte ne pose aucun problème", () => {
    expect(verifierOralite("")).toEqual([]);
    expect(verifierOralite("Voilà.")).toEqual([]);
  });
});

// ── c. Les marqueurs d'oral ────────────────────────────────────────────────

describe("c — les marqueurs d'oral sont détectés, jamais imposés", () => {
  test("un texte qui en contient est reconnu", () => {
    expect(contientMarqueurOral("Alors, on fait comme ça.")).toBe(true);
    expect(contientMarqueurOral("Du coup je note.")).toBe(true);
    expect(contientMarqueurOral("Euh… laissez-moi vérifier.")).toBe(true);
  });

  test("un texte sans marqueur n'est PAS refusé par verifierOralite", () => {
    // Exiger un marqueur par réplique produirait une caricature — « alors, du
    // coup, en fait, voilà » — qui sonne plus faux qu'une phrase neutre.
    const neutre = "Je vous remercie, bonne journée.";
    expect(contientMarqueurOral(neutre)).toBe(false);
    expect(verifierOralite(neutre)).toEqual([]);
  });
});

// ── d. La table elle-même ──────────────────────────────────────────────────

describe("d — la table de tournures reste saine", () => {
  test("chaque entrée porte un libellé lisible", () => {
    for (const t of TOURNURES_ECRITES) {
      expect(t.libelle.trim().length).toBeGreaterThan(3);
    }
  });

  test("aucune tournure ne mord sur une réplique de référence du produit", () => {
    // Les répliques réelles de l'agent, passées à toute la table : une garde
    // qui refuserait le produit qu'elle protège serait désarmée le lendemain.
    const repliques = [
      "Bonjour ! Je suis l'assistant automatique de Dubois.",
      "Alors, quel jour exactement je peux noter ?",
      "Je résume : vous réglez mille deux cents euros le quinze. C'est bien ça ?",
      "Écoutez, je note votre demande et je la transmets.",
    ];
    for (const r of repliques) {
      expect(verifierOralite(r), r).toEqual([]);
    }
  });
});
