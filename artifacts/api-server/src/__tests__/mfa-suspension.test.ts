/**
 * La suspension du second facteur, et sa limite — 2026-08-21.
 *
 * Le fondateur a suspendu le MFA le temps que le produit ne soit pas en
 * ligne. Ces tests protègent la SEULE chose qui rend cette bascule
 * acceptable : elle est **inerte en production**, quoi que vaille la variable.
 *
 * Une bascule capable d'éteindre l'authentification forte en production
 * serait exactement l'interrupteur qu'on finit par trouver actif sur le
 * serveur qui compte — par une copie de `.env`, un modèle recopié, un
 * `docker-compose` repris d'ailleurs. Personne ne l'aurait décidé ; il serait
 * arrivé là tout seul.
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { secondFacteurSuspendu } from "../lib/mfa-suspension.js";

const SAUVEGARDE = {
  NODE_ENV: process.env["NODE_ENV"],
  MFA: process.env["MFA_SUSPENDU_HORS_PRODUCTION"],
};

beforeEach(() => {
  delete process.env["MFA_SUSPENDU_HORS_PRODUCTION"];
});

afterEach(() => {
  if (SAUVEGARDE.NODE_ENV === undefined) delete process.env["NODE_ENV"];
  else process.env["NODE_ENV"] = SAUVEGARDE.NODE_ENV;
  if (SAUVEGARDE.MFA === undefined) delete process.env["MFA_SUSPENDU_HORS_PRODUCTION"];
  else process.env["MFA_SUSPENDU_HORS_PRODUCTION"] = SAUVEGARDE.MFA;
});

describe("a — la production ne se laisse jamais désarmer", () => {
  test("variable posée + NODE_ENV=production → le second facteur RESTE exigé", () => {
    process.env["NODE_ENV"] = "production";
    process.env["MFA_SUSPENDU_HORS_PRODUCTION"] = "true";

    // C'est LE test de ce fichier. S'il tombe, la bascule est devenue un
    // interrupteur d'authentification forte en production.
    expect(secondFacteurSuspendu()).toBe(false);
  });
});

describe("b — hors production, la suspension demande un OUI explicite", () => {
  test("variable absente → rien n'est suspendu", () => {
    process.env["NODE_ENV"] = "development";
    expect(secondFacteurSuspendu()).toBe(false);
  });

  test.each(["", "1", "yes", "oui", "TRUE", "false"])(
    "« %s » ne suspend pas — seul le littéral `true` compte",
    (valeur) => {
      // Une valeur approximative qui suspendrait le MFA ferait de la faute de
      // frappe une décision de sécurité.
      process.env["NODE_ENV"] = "development";
      process.env["MFA_SUSPENDU_HORS_PRODUCTION"] = valeur;
      expect(secondFacteurSuspendu()).toBe(false);
    },
  );

  test("« true » exactement, hors production → suspendu", () => {
    process.env["NODE_ENV"] = "development";
    process.env["MFA_SUSPENDU_HORS_PRODUCTION"] = "true";
    expect(secondFacteurSuspendu()).toBe(true);
  });
});
