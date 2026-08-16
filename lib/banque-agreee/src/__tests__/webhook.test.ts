/**
 * Tests unitaires de @nodaq/banque-agreee — webhook.ts
 *
 * Éprouve la garde de signature (CLAUDE.md : « une garde jamais vue
 * échouer n'est pas une garde ») — un webhook forgé, mal signé, ou signé
 * avec un secret différent doit être rejeté.
 */
import { describe, test, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifierSignatureWebhook } from "../webhook.js";

const SECRET = "webhook-secret-test";

function signer(corps: Buffer, secret = SECRET): string {
  const hmac = createHmac("sha256", secret).update(corps).digest("hex");
  return `t=1734000000,v1=${hmac}`;
}

describe("verifierSignatureWebhook", () => {
  test("accepte une signature valide", () => {
    const corps = Buffer.from(JSON.stringify({ type: "item.created" }));
    const header = signer(corps);
    expect(
      verifierSignatureWebhook(corps, { "bridgeapi-signature": header }, SECRET),
    ).toBe(true);
  });

  test("rejette une signature calculée avec un autre secret", () => {
    const corps = Buffer.from(JSON.stringify({ type: "item.created" }));
    const header = signer(corps, "mauvais-secret");
    expect(
      verifierSignatureWebhook(corps, { "bridgeapi-signature": header }, SECRET),
    ).toBe(false);
  });

  test("rejette un corps modifié après signature", () => {
    const corpsOriginal = Buffer.from(JSON.stringify({ type: "item.created" }));
    const header = signer(corpsOriginal);
    const corpsAlteré = Buffer.from(JSON.stringify({ type: "item.deleted" }));
    expect(
      verifierSignatureWebhook(corpsAlteré, { "bridgeapi-signature": header }, SECRET),
    ).toBe(false);
  });

  test("rejette un en-tête absent", () => {
    const corps = Buffer.from("{}");
    expect(verifierSignatureWebhook(corps, {}, SECRET)).toBe(false);
  });

  test("ignore un schéma autre que v1 (pas de rétrogradation d'algorithme)", () => {
    const corps = Buffer.from("{}");
    expect(
      verifierSignatureWebhook(corps, { "bridgeapi-signature": "t=123,v0=abcdef" }, SECRET),
    ).toBe(false);
  });

  test("accepte si au moins un des schémas v1 multiples correspond (rotation de secret)", () => {
    const corps = Buffer.from(JSON.stringify({ type: "item.refreshed" }));
    const bonneSignature = signer(corps).split("v1=")[1];
    const header = `t=1734000000,v1=deadbeef,v1=${bonneSignature}`;
    expect(
      verifierSignatureWebhook(corps, { "bridgeapi-signature": header }, SECRET),
    ).toBe(true);
  });
});
