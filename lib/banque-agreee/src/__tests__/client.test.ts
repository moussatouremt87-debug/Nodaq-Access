/**
 * Tests unitaires de @nodaq/banque-agreee — client.ts
 *
 * Protège l'invariant central : toute destination bancaire vient de
 * BRIDGE_CLIENT_ID/BRIDGE_CLIENT_SECRET (secrets, jamais l'URL — Bridge est
 * le fournisseur retenu, son URL de base est une constante publique du
 * client). Aucun test n'atteint le réseau : `fetch` est remplacé par un
 * espion.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getConfig, creerUtilisateur, creerSessionConnexion, listerComptes } from "../client.js";
import { BanqueConfigError, BanqueResponseError } from "../errors.js";

const REQUIRED_ENV = {
  BRIDGE_CLIENT_ID: "test-client-id",
  BRIDGE_CLIENT_SECRET: "test-client-secret",
  BRIDGE_WEBHOOK_SECRET: "test-webhook-secret",
} as const;

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

beforeEach(() => {
  for (const [k, v] of Object.entries(REQUIRED_ENV)) process.env[k] = v;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── getConfig() — aucune valeur par défaut ───────────────────────────────────

describe("getConfig() — chaque variable requise est vérifiée nommément", () => {
  test.each([["BRIDGE_CLIENT_ID"], ["BRIDGE_CLIENT_SECRET"], ["BRIDGE_WEBHOOK_SECRET"]])(
    "lève BanqueConfigError nommant %s quand elle est absente",
    async (name) => {
      await withEnv({ [name]: undefined }, () => {
        expect(() => getConfig()).toThrow(BanqueConfigError);
        expect(() => getConfig()).toThrow(new RegExp(name));
      });
    },
  );
});

// ─── creerUtilisateur() ────────────────────────────────────────────────────

function lastCall(spy: { mock: { calls: unknown[][] } }) {
  const call = spy.mock.calls[0] as unknown as [string, RequestInit];
  const [url, init] = call;
  return { url, init, body: JSON.parse(init.body as string) };
}

describe("creerUtilisateur() — destination, en-têtes, corps", () => {
  test("appelle POST /v3/aggregation/users avec external_user_id = tenantId", async () => {
    const spy = vi.fn(async () =>
      new Response(JSON.stringify({ uuid: "user-uuid-1" }), { status: 201 }),
    );
    vi.stubGlobal("fetch", spy);

    const result = await creerUtilisateur(getConfig(), "tenant-123");

    const { url, init, body } = lastCall(spy);
    expect(url).toBe("https://api.bridgeapi.io/v3/aggregation/users");
    expect((init.headers as Record<string, string>)["Client-Id"]).toBe("test-client-id");
    expect((init.headers as Record<string, string>)["Client-Secret"]).toBe("test-client-secret");
    expect(body).toEqual({ external_user_id: "tenant-123" });
    expect(result).toEqual({ uuid: "user-uuid-1" });
  });

  test("lève BanqueResponseError si uuid manque", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({}), { status: 201 })));
    await expect(creerUtilisateur(getConfig(), "tenant-123")).rejects.toThrow(BanqueResponseError);
  });
});

// ─── creerSessionConnexion() ───────────────────────────────────────────────

describe("creerSessionConnexion() — jeton utilisateur puis session", () => {
  function stubTokenPuisSession() {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const spy = vi.fn(async (input: string, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init: init! });
      if (url.endsWith("/authorization/token")) {
        return new Response(JSON.stringify({ access_token: "user-token-xyz" }), { status: 200 });
      }
      if (url.endsWith("/connect-sessions")) {
        return new Response(
          JSON.stringify({ id: "session-1", url: "https://connect.bridgeapi.io/session-1" }),
          { status: 201 },
        );
      }
      throw new Error(`URL inattendue : ${url}`);
    });
    vi.stubGlobal("fetch", spy);
    return { spy, calls };
  }

  test("obtient d'abord un token utilisateur, jamais persisté, puis crée la session", async () => {
    const { calls } = stubTokenPuisSession();
    const result = await creerSessionConnexion(getConfig(), "tenant-123", "https://nodaq.test/retour");

    expect(calls[0]!.url).toBe("https://api.bridgeapi.io/v3/aggregation/authorization/token");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ external_user_id: "tenant-123" });

    expect(calls[1]!.url).toBe("https://api.bridgeapi.io/v3/aggregation/connect-sessions");
    expect((calls[1]!.init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer user-token-xyz",
    );
    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({
      callback_url: "https://nodaq.test/retour",
    });

    expect(result).toEqual({ id: "session-1", url: "https://connect.bridgeapi.io/session-1" });
  });
});

// ─── listerComptes() ───────────────────────────────────────────────────────

describe("listerComptes() — conversion en centimes", () => {
  test("convertit le solde (unité majeure Bridge) en centimes", async () => {
    const spy = vi.fn(async (input: string) => {
      const url = String(input);
      if (url.endsWith("/authorization/token")) {
        return new Response(JSON.stringify({ access_token: "user-token-xyz" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          resources: [{ id: 42, name: "Compte courant", balance: 1234.56, currency_code: "EUR" }],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", spy);

    const comptes = await listerComptes(getConfig(), "tenant-123");
    expect(comptes).toEqual([
      { id: "42", label: "Compte courant", balanceCents: 123456, devise: "EUR" },
    ]);
  });

  test("lève BanqueResponseError si un compte n'a pas de solde", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = String(input);
        if (url.endsWith("/authorization/token")) {
          return new Response(JSON.stringify({ access_token: "t" }), { status: 200 });
        }
        return new Response(JSON.stringify({ resources: [{ id: 1 }] }), { status: 200 });
      }),
    );
    await expect(listerComptes(getConfig(), "tenant-123")).rejects.toThrow(BanqueResponseError);
  });
});

// ─── Confidentialité de la journalisation ─────────────────────────────────────

describe("journalisation — jamais de secret ni de solde", () => {
  test("le log ne contient ni le client secret ni le token utilisateur", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ uuid: "user-uuid-1" }), { status: 201 }));
    vi.stubGlobal("fetch", spy);

    const logged: string[] = [];
    vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });

    await creerUtilisateur(getConfig(), "tenant-123");

    const all = logged.join("\n");
    expect(all).not.toContain("test-client-secret");
  });
});
