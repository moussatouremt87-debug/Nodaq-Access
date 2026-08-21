/**
 * Quelle app Bridge porte l'initiation de paiement — ticket 4.19.
 *
 * Deux montages sont légitimes : « Bank payment » activé sur l'app
 * d'agrégation, ou une app séparée (un bac à sable, dont la doc Bridge dit que
 * rien n'y est transférable vers la production). Ce qui ne l'est pas : une
 * configuration à moitié posée, où l'on irait chercher l'identifiant manquant
 * dans l'AUTRE app — c'est-à-dire créer des liens de paiement sur un compte
 * que personne n'a désigné.
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { configPaiement, getConfig, BanqueConfigError } from "@nodaq/banque-agreee";

const VARIABLES = [
  "BRIDGE_CLIENT_ID",
  "BRIDGE_CLIENT_SECRET",
  "BRIDGE_WEBHOOK_SECRET",
  "BRIDGE_PAYMENT_CLIENT_ID",
  "BRIDGE_PAYMENT_CLIENT_SECRET",
] as const;

const sauvegarde: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const v of VARIABLES) {
    sauvegarde[v] = process.env[v];
    delete process.env[v];
  }
  process.env["BRIDGE_CLIENT_ID"] = "app-agregation";
  process.env["BRIDGE_CLIENT_SECRET"] = "secret-agregation";
  process.env["BRIDGE_WEBHOOK_SECRET"] = "webhook-agregation";
});

afterEach(() => {
  for (const v of VARIABLES) {
    if (sauvegarde[v] === undefined) delete process.env[v];
    else process.env[v] = sauvegarde[v];
  }
});

describe("a — montage à UNE app", () => {
  test("sans variables dédiées, le paiement utilise l'app d'agrégation", () => {
    const config = configPaiement();
    expect(config.clientId).toBe(getConfig().clientId);
  });
});

describe("b — montage à DEUX apps", () => {
  test("les identifiants dédiés priment, et l'agrégation n'est pas touchée", () => {
    process.env["BRIDGE_PAYMENT_CLIENT_ID"] = "app-sandbox";
    process.env["BRIDGE_PAYMENT_CLIENT_SECRET"] = "secret-sandbox";

    expect(configPaiement().clientId).toBe("app-sandbox");
    // L'agrégation continue de lire SES variables : brancher un bac à sable
    // pour le paiement ne doit pas débrancher la synchronisation bancaire.
    expect(getConfig().clientId).toBe("app-agregation");
  });
});

describe("c — la moitié d'une configuration n'est pas une configuration", () => {
  test.each(["BRIDGE_PAYMENT_CLIENT_ID", "BRIDGE_PAYMENT_CLIENT_SECRET"])(
    "%s seule → lève en nommant la variable manquante",
    (posee) => {
      process.env[posee] = "valeur";
      // Le point : surtout PAS de repli sur l'app d'agrégation. Compléter une
      // configuration à moitié posée reviendrait à créer des liens de paiement
      // sur un compte que personne n'a désigné.
      expect(() => configPaiement()).toThrow(BanqueConfigError);
      expect(() => configPaiement()).toThrow(/BRIDGE_PAYMENT_CLIENT_(ID|SECRET)/);
    },
  );
});
