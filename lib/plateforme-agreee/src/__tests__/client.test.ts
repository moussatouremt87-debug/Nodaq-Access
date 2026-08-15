/**
 * Tests unitaires de @nodaq/plateforme-agreee — client.ts
 *
 * Protège l'invariant central : toute destination d'échange PA vient de
 * PA_BASE_URL. Aucune valeur par défaut, aucune URL en dur. Aucun test
 * n'atteint le réseau : `fetch` est remplacé par un espion.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getConfig, submitInvoice, fetchInboundDocuments } from "../client.js";
import { PaConfigError, PaResponseError } from "../errors.js";

// ─── Aides sur l'environnement ────────────────────────────────────────────────

const REQUIRED_ENV = {
  PA_BASE_URL: "http://pa.test/v1",
  PA_API_KEY: "test-key",
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
  test.each([["PA_BASE_URL"], ["PA_API_KEY"]])(
    "lève PaConfigError nommant %s quand elle est absente",
    async (name) => {
      await withEnv({ [name]: undefined }, () => {
        expect(() => getConfig()).toThrow(PaConfigError);
        expect(() => getConfig()).toThrow(new RegExp(name));
      });
    },
  );

  test("retire la barre oblique finale de PA_BASE_URL", async () => {
    await withEnv({ PA_BASE_URL: "http://pa.test/v1/" }, () => {
      expect(getConfig().baseUrl).toBe("http://pa.test/v1");
    });
  });

  test("aucune valeur par défaut ne pointe vers un fournisseur", async () => {
    await withEnv({ PA_BASE_URL: undefined }, () => {
      expect(() => getConfig()).toThrow(PaConfigError);
    });
  });
});

// ─── submitInvoice() — destination, autorisation, corps ──────────────────────

function stubSubmitOk() {
  const spy = vi.fn(async () =>
    new Response(JSON.stringify({ submissionId: "sub-123", status: "deposee" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function lastCall(spy: { mock: { calls: unknown[][] } }) {
  const call = spy.mock.calls[0] as unknown as [string, RequestInit];
  const [url, init] = call;
  return { url, init, body: JSON.parse(init.body as string) };
}

describe("submitInvoice() — destination, autorisation, corps", () => {
  test("appelle {PA_BASE_URL}/invoices", async () => {
    const spy = stubSubmitOk();
    await submitInvoice(getConfig(), {
      documentType: "FACTURE",
      documentId: "fact-1",
      payload: "<xml/>",
    });
    expect(lastCall(spy).url).toBe("http://pa.test/v1/invoices");
  });

  test("suit PA_BASE_URL quand elle change — aucune constante en dur", async () => {
    const spy = stubSubmitOk();
    await withEnv({ PA_BASE_URL: "http://autre.test/v1" }, async () => {
      await submitInvoice(getConfig(), {
        documentType: "FACTURE",
        documentId: "fact-1",
        payload: "<xml/>",
      });
    });
    expect(lastCall(spy).url).toBe("http://autre.test/v1/invoices");
  });

  test("envoie l'en-tête Bearer avec PA_API_KEY", async () => {
    const spy = stubSubmitOk();
    await submitInvoice(getConfig(), {
      documentType: "FACTURE",
      documentId: "fact-1",
      payload: "<xml/>",
    });
    const headers = lastCall(spy).init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-key");
  });

  test("encode le PDF en base64 quand fourni, l'omet sinon (e-reporting)", async () => {
    const spy = stubSubmitOk();
    await submitInvoice(getConfig(), {
      documentType: "FACTURE",
      documentId: "fact-1",
      payload: "<xml/>",
      pdfBytes: Buffer.from("pdf-bytes"),
    });
    expect(lastCall(spy).body.pdfBase64).toBe(Buffer.from("pdf-bytes").toString("base64"));

    const spy2 = stubSubmitOk();
    await submitInvoice(getConfig(), {
      documentType: "E_REPORTING",
      documentId: "2026-08",
      payload: "{}",
    });
    expect(lastCall(spy2).body.pdfBase64).toBeUndefined();
  });

  test("retourne submissionId et status tels que renvoyés par la PA", async () => {
    stubSubmitOk();
    const result = await submitInvoice(getConfig(), {
      documentType: "FACTURE",
      documentId: "fact-1",
      payload: "<xml/>",
    });
    expect(result).toEqual({ submissionId: "sub-123", status: "deposee" });
  });

  test("lève PaResponseError si submissionId ou status manque", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );
    await expect(
      submitInvoice(getConfig(), { documentType: "FACTURE", documentId: "fact-1", payload: "<xml/>" }),
    ).rejects.toThrow(PaResponseError);
  });
});

// ─── fetchInboundDocuments() — destination, décodage ──────────────────────────

describe("fetchInboundDocuments() — destination et décodage", () => {
  function stubInboundOk() {
    const spy = vi.fn(async () =>
      new Response(
        JSON.stringify({
          documents: [
            {
              id: "doc-1",
              receivedAt: "2026-08-15T10:00:00Z",
              pdfBase64: Buffer.from("pdf-content").toString("base64"),
              sha256: "abc123",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  test("appelle {PA_BASE_URL}/documents", async () => {
    const spy = stubInboundOk();
    await fetchInboundDocuments(getConfig());
    const [url] = spy.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe("http://pa.test/v1/documents");
  });

  test("ajoute ?since= quand fourni", async () => {
    const spy = stubInboundOk();
    await fetchInboundDocuments(getConfig(), "2026-08-01T00:00:00Z");
    const [url] = spy.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get("since")).toBe("2026-08-01T00:00:00Z");
  });

  test("décode le PDF base64 en Buffer", async () => {
    stubInboundOk();
    const docs = await fetchInboundDocuments(getConfig());
    expect(docs).toHaveLength(1);
    expect(docs[0]!.pdfBytes).toEqual(Buffer.from("pdf-content"));
    expect(docs[0]!.id).toBe("doc-1");
    expect(docs[0]!.sha256).toBe("abc123");
  });

  test("lève PaResponseError si un document est incomplet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ documents: [{ id: "doc-1" }] }), { status: 200 }),
      ),
    );
    await expect(fetchInboundDocuments(getConfig())).rejects.toThrow(PaResponseError);
  });
});

// ─── Confidentialité de la journalisation ─────────────────────────────────────

describe("journalisation — le contenu n'apparaît jamais", () => {
  test("aucun octet de PDF ni payload n'apparaît dans les journaux", async () => {
    stubSubmitOk();
    const logged: string[] = [];
    vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });

    const SECRET = "IBAN FR76 3000 1007 1234 5678 9012 345";
    await submitInvoice(getConfig(), {
      documentType: "FACTURE",
      documentId: "fact-1",
      payload: `<xml>${SECRET}</xml>`,
      pdfBytes: Buffer.from(SECRET),
    });

    const all = logged.join("\n");
    expect(all).not.toContain(SECRET);
    expect(all).toContain("FACTURE");
  });
});
