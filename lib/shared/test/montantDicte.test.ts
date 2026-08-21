/**
 * Le montant prononcé, retrouvé dans la phrase de l'utilisateur.
 *
 * C'est ce module qui remplace la garde « aucun schéma d'intention ne déclare
 * de champ monétaire » : elle interdisait au modèle de recopier un chiffre
 * qu'on venait de dire, alors que la règle 3 ne lui interdit que d'en fixer
 * un. Si ces tests faiblissent, la relaxe de la règle ouvre le trou qu'elle
 * prétend ne pas ouvrir.
 */
import { describe, test, expect } from "vitest";
import { montantPrononce, centimesDepuisDictee } from "../src/montantDicte.js";

describe("a — un montant réellement prononcé est reconnu", () => {
  test.each([
    ["ajoute au catalogue la pose de placo à 45 euros du mètre", 45],
    ["une charge mensuelle de 1200 euros", 1200],
    // Séparateur de milliers : une transcription vocale en pose volontiers un.
    ["un contrat d'entretien à 1 500 euros par an", 1500],
    ["l'espace fine insécable aussi : 1 500 euros", 1500],
    // Virgule décimale française.
    ["le placo c'est 45,50 euros du mètre carré", 45.5],
    ["45.50 euros, en notation anglaise", 45.5],
    ["il m'a réglé 500 euros sur la 181", 500],
  ])("« %s » porte bien %s €", (phrase, euros) => {
    expect(montantPrononce(phrase, euros)).toBe(true);
  });
});

describe("b — un montant que la phrase ne porte pas est refusé", () => {
  test("le modèle hallucine un chiffre absent", () => {
    // LE cas qui justifie ce module. Sans lui, la relaxe laisserait écrire un
    // prix que personne n'a prononcé, sous couvert de « l'utilisateur valide ».
    expect(montantPrononce("ajoute au catalogue la pose de placo", 45)).toBe(false);
  });

  test("un chiffre proche mais différent ne passe pas", () => {
    expect(montantPrononce("la pose de placo à 45 euros", 4.5)).toBe(false);
    expect(montantPrononce("la pose de placo à 45 euros", 450)).toBe(false);
    expect(montantPrononce("la pose de placo à 45 euros", 46)).toBe(false);
  });

  test("un nombre en toutes lettres n’est PAS reconnu — et c’est assumé", () => {
    // Le repli est l'état sûr : le champ redevient à saisir à l'écran.
    // Chercher à lire les numéraux français buterait sur « un »/« une »,
    // articles bien plus souvent que nombres.
    expect(montantPrononce("la pose de placo à quarante-cinq euros", 45)).toBe(false);
  });
});

describe("c — la conversion en centimes, à un seul endroit", () => {
  test("45 € prononcés donnent 4500 centimes", () => {
    expect(centimesDepuisDictee("le placo à 45 euros", 45)).toBe(4500);
  });

  test("45,70 € ne devient pas 4569 — l’arrondi, pas la troncature", () => {
    // 45.7 * 100 vaut 4569.999… en flottant. Tronquer écrirait 45,69 €.
    expect(centimesDepuisDictee("le placo à 45,70 euros", 45.7)).toBe(4570);
  });

  test.each([
    ["absent", null],
    ["indéfini", undefined],
    ["négatif", -45],
  ])("un montant %s ne produit rien", (_nom, euros) => {
    expect(centimesDepuisDictee("le placo à 45 euros", euros as number | null)).toBeNull();
  });

  test("un montant non retrouvé dans la phrase ne produit rien", () => {
    // Pas « 0 », pas « approximativement » : `null`, c'est-à-dire le repli sur
    // le champ à compléter. Un montant au jugé ne s'écrit jamais.
    expect(centimesDepuisDictee("ajoute la pose de placo", 45)).toBeNull();
  });
});
