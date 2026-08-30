import { afterEach, describe, expect, test, vi } from "vitest";

import { exchangeOAuthCode, revokeOAuthAuthorization } from "../lib/connecteurs-oauth.js";

const ENV = {
  PENNYLANE_OAUTH_CLIENT_ID: "pennylane-client-test",
  PENNYLANE_OAUTH_CLIENT_SECRET: "pennylane-secret-test",
  STRIPE_OAUTH_CLIENT_ID: "stripe-client-test",
  STRIPE_PLATFORM_SECRET_KEY: "sk_test_stripe-platform-test",
  GOOGLE_OAUTH_CLIENT_ID: "google-client-test",
  GOOGLE_OAUTH_CLIENT_SECRET: "google-secret-test",
  SLACK_OAUTH_CLIENT_ID: "slack-client-test",
  SLACK_OAUTH_CLIENT_SECRET: "slack-secret-test",
} as const;
const ORIGINAL_NODE_ENV = process.env["NODE_ENV"];

function configure(): void {
  for (const [name, value] of Object.entries(ENV)) process.env[name] = value;
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of Object.keys(ENV)) delete process.env[name];
  delete process.env["STRIPE_CONNECT_ALLOW_TEST_MODE"];
  if (ORIGINAL_NODE_ENV === undefined) delete process.env["NODE_ENV"];
  else process.env["NODE_ENV"] = ORIGINAL_NODE_ENV;
});

describe("séparation explicite des environnements Stripe", () => {
  test("un compte test exige un drapeau dédié quand le SPA construit tourne en production", async () => {
    configure();
    process.env["NODE_ENV"] = "production";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      stripe_user_id: "acct_test_preview",
      livemode: false,
      scope: "read_write",
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    const exchange = () => exchangeOAuthCode({
      provider: "STRIPE",
      code: "stripe-code-test",
      callbackUrl: "http://127.0.0.1:8080/api/connecteurs/STRIPE/retour",
    });
    await expect(exchange()).rejects.toMatchObject({ code: "FOURNISSEUR_REFUSE" });

    process.env["STRIPE_CONNECT_ALLOW_TEST_MODE"] = "true";
    await expect(exchange()).resolves.toMatchObject({
      accountId: "acct_test_preview",
      livemode: false,
    });
  });
});

describe("révocation distante des autorisations OAuth", () => {
  test("Google reste manuel car son endpoint révoquerait tous les jetons du projet", async () => {
    configure();
    const external = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", external);

    await expect(revokeOAuthAuthorization({
      provider: "GOOGLE_DRIVE",
      accessToken: "google-access",
      refreshToken: "google-refresh",
    })).resolves.toBe("MANUAL_REQUIRED");
    expect(external).not.toHaveBeenCalled();
  });

  test("Slack reste manuel car un workspace peut être partagé entre plusieurs tenants", async () => {
    configure();
    const external = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(
      JSON.stringify({ ok: true, revoked: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", external);

    await expect(revokeOAuthAuthorization({
      provider: "SLACK",
      accessToken: "xoxb-access-test",
    })).resolves.toBe("MANUAL_REQUIRED");
    expect(external).not.toHaveBeenCalled();
  });

  test("Slack avec rotation conserve l'action manuelle tant qu'un refresh token existe", async () => {
    configure();
    const external = vi.fn();
    vi.stubGlobal("fetch", external);

    await expect(revokeOAuthAuthorization({
      provider: "SLACK",
      accessToken: "xoxe.xoxb-access-test",
      refreshToken: "xoxe-refresh-test",
    })).resolves.toBe("MANUAL_REQUIRED");
    expect(external).not.toHaveBeenCalled();
  });

  test("Stripe reste manuel car la désautorisation casserait les autres tenants du même compte", async () => {
    configure();
    const external = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(
      JSON.stringify({ stripe_user_id: "acct_nodaq_test" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", external);

    await expect(revokeOAuthAuthorization({
      provider: "STRIPE",
      accountId: "acct_nodaq_test",
    })).resolves.toBe("MANUAL_REQUIRED");
    expect(external).not.toHaveBeenCalled();
  });

  test("Pennylane révoque le jeton avec les identifiants de la plateforme", async () => {
    configure();
    const external = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", external);

    await expect(revokeOAuthAuthorization({
      provider: "PENNYLANE",
      accessToken: "pennylane-access",
      refreshToken: "pennylane-refresh",
    })).resolves.toBe("REVOKED");

    const [url, options] = external.mock.calls[0]!;
    expect(url).toBe("https://app.pennylane.com/oauth/revoke");
    expect(options?.redirect).toBe("error");
    expect(Object.fromEntries(new URLSearchParams(String(options?.body)))).toEqual({
      client_id: "pennylane-client-test",
      client_secret: "pennylane-secret-test",
      token: "pennylane-refresh",
    });
  });
});
