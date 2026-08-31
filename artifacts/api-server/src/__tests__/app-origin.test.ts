import { afterEach, describe, expect, test } from "vitest";

import { cookieDoitEtreSecurise, oauthCallbackUrl, verifierOriginesDemarrage } from "../lib/app-origin.js";

const previousNodeEnv = process.env["NODE_ENV"];

afterEach(() => {
  delete process.env["APP_URL"];
  delete process.env["PUBLIC_URL"];
  if (previousNodeEnv === undefined) delete process.env["NODE_ENV"];
  else process.env["NODE_ENV"] = previousNodeEnv;
});

describe("origines canoniques des connexions externes", () => {
  test("normalise une barre finale sans créer de double slash", () => {
    process.env["PUBLIC_URL"] = "https://app.nodaq.test/";
    expect(oauthCallbackUrl("GOOGLE_DRIVE")).toBe(
      "https://app.nodaq.test/api/connecteurs/GOOGLE_DRIVE/retour",
    );
  });

  test("le callback suit l'origine du cookie même si APP_URL pointe ailleurs", () => {
    process.env["PUBLIC_URL"] = "https://session.nodaq.test";
    process.env["APP_URL"] = "https://liens.nodaq.test";
    expect(oauthCallbackUrl("SLACK")).toBe(
      "https://session.nodaq.test/api/connecteurs/SLACK/retour",
    );
  });

  test("refuse chemins, paramètres et fragments", () => {
    for (const invalid of [
      "https://app.nodaq.test/sous-chemin",
      "https://app.nodaq.test/?environnement=test",
      "https://app.nodaq.test/#fragment",
    ]) {
      process.env["APP_URL"] = invalid;
      expect(() => verifierOriginesDemarrage()).toThrow(/APP_URL/);
    }
  });

  test("impose HTTPS aux origines publiques en production", () => {
    process.env["NODE_ENV"] = "production";
    process.env["PUBLIC_URL"] = "http://app.nodaq.test";
    expect(() => verifierOriginesDemarrage()).toThrow(/https/);
    process.env["PUBLIC_URL"] = "https://app.nodaq.test";
    process.env["APP_URL"] = "http://liens.nodaq.test";
    expect(() => verifierOriginesDemarrage()).toThrow(/https/);
  });

  test("autorise HTTP pour les tests locaux même avec un SPA construit", () => {
    process.env["NODE_ENV"] = "production";
    for (const localOrigin of [
      "http://localhost:8080",
      "http://127.0.0.1:8080",
      "http://192.168.1.20:8080",
      "http://10.0.0.20:8080",
      "http://172.16.0.20:8080",
    ]) {
      process.env["PUBLIC_URL"] = localOrigin;
      process.env["APP_URL"] = localOrigin;
      expect(() => verifierOriginesDemarrage()).not.toThrow();
    }
  });

  test("le cookie suit PUBLIC_URL, pas NODE_ENV", () => {
    process.env["NODE_ENV"] = "production";
    process.env["PUBLIC_URL"] = "https://app.nodaq.test";
    expect(cookieDoitEtreSecurise()).toBe(true);
    process.env["NODE_ENV"] = "test";
    process.env["PUBLIC_URL"] = "http://127.0.0.1:8080";
    expect(cookieDoitEtreSecurise()).toBe(false);
  });
});
