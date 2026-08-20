/**
 * L'audit de transcription — le versant détectif de l'ADR 005.
 *
 * Depuis le pivot, aucune garde ne s'applique AVANT que l'agent parle : celle-ci
 * est la seule qui reste, et elle doit être exacte dans les deux sens — attraper
 * les violations, et ne pas accuser à tort. Une garde qui crie au loup sur du
 * français correct finit désactivée, et avec elle toute la promesse de l'ADR.
 */
import { describe, test, expect } from "vitest";
import { auditerReplique, auditerTranscription } from "../src/formulation.js";

describe("a — ce que l'audit attrape", () => {
  test("un registre interdit", () => {
    const anomalies = auditerReplique("Sans règlement, on passe au contentieux.");
    expect(anomalies.map((a) => a.nature)).toContain("registre_interdit");
  });

  test("le tutoiement", () => {
    const anomalies = auditerReplique("Bon, tu peux régler quand ?");
    expect(anomalies.map((a) => a.nature)).toContain("tutoiement");
  });

  test("le nom du débiteur, quand il est fourni", () => {
    const anomalies = auditerReplique("Alors monsieur Delacroix, on fait comme ça ?", ["Delacroix"]);
    expect(anomalies.map((a) => a.nature)).toContain("identite_divulguee");
  });

  test("l'index de la réplique fautive est rendu — jamais son texte", () => {
    const anomalies = auditerTranscription([
      "Bonjour ! Je suis l'assistant automatique de Dubois.",
      "On va envoyer un huissier.",
    ]);
    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]!.replique).toBe(1);
  });
});

describe("b — ce que l'audit laisse passer, et POURQUOI", () => {
  test("les chiffres ne sont JAMAIS des anomalies ici", () => {
    // Les faits de chaque tour sont inconnaissables après coup : accuser
    // l'agent d'avoir « inventé » 400 alors que le mandat l'avait accordé
    // pendant l'appel serait une fausse alerte systématique. Mieux vaut une
    // garde absente qu'une garde qui accuse à tort — `record_promise` tient
    // l'invariant qui compte.
    expect(auditerReplique("Du coup on peut faire 3 fois, 400 euros le 28 août.")).toEqual([]);
  });

  test("l'oralité n'est pas une violation", () => {
    // Une phrase de seize mots est un défaut de style, pas une faute de
    // conduite. L'audit ne juge que ce qui engage.
    const longue =
      "Je vous remercie beaucoup pour votre patience et je vous souhaite une excellente fin de journée monsieur.";
    expect(auditerReplique(longue)).toEqual([]);
  });

  test("le français parlé correct passe, identités fournies comprises", () => {
    for (const texte of [
      "Alors, vous pouvez régler quand ?",
      "D'accord, je note et je transmets.",
      "Très bien, on vous rappellera plus. Bonne journée.",
    ]) {
      expect(auditerReplique(texte, ["SARL Menuiserie Delacroix"]), texte).toEqual([]);
    }
  });
});
