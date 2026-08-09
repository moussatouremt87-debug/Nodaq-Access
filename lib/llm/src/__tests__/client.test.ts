/**
 * Tests unitaires de @nodaq/llm — client.ts
 *
 * Ce fichier protège l'invariant central du produit : **toute destination de
 * modèle vient de LLM_BASE_URL**. Il n'existe plus de valeur par défaut, plus
 * de repli sur une clé fournisseur, plus d'URL écrite en dur.
 *
 * Aucun test n'atteint le réseau : `fetch` est remplacé par un espion.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getConfig, chatCompletion, transcribeAudio } from "../client.js";
import { LlmConfigError } from "../errors.js";

// ─── Aides sur l'environnement ────────────────────────────────────────────────

const REQUIRED_ENV = {
  LLM_BASE_URL: "http://llm.test/v1",
  LLM_API_KEY: "test-key",
  LLM_MODEL_CHAT: "test/chat-model",
  LLM_MODEL_VISION: "test/vision-model",
  LLM_MODEL_STT: "test/stt-model",
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
  test.each([
    ["LLM_BASE_URL"],
    ["LLM_API_KEY"],
    ["LLM_MODEL_CHAT"],
  ])("lève LlmConfigError nommant %s quand elle est absente", async (name) => {
    await withEnv({ [name]: undefined }, () => {
      expect(() => getConfig()).toThrow(LlmConfigError);
      expect(() => getConfig()).toThrow(new RegExp(name));
    });
  });

  test("retire la barre oblique finale de LLM_BASE_URL", async () => {
    await withEnv({ LLM_BASE_URL: "http://llm.test/v1/" }, () => {
      expect(getConfig().baseUrl).toBe("http://llm.test/v1");
    });
  });

  test("aucune valeur par défaut ne pointe vers un fournisseur", async () => {
    await withEnv({ LLM_BASE_URL: undefined }, () => {
      // Le point du ticket 5.2 : un oubli de configuration ne doit JAMAIS
      // envoyer silencieusement les données quelque part.
      expect(() => getConfig()).toThrow(LlmConfigError);
    });
  });
});

// ─── chatCompletion() — forme de la requête ───────────────────────────────────

function stubFetchOk() {
  const spy = vi.fn(async () =>
    new Response(
      JSON.stringify({
        id: "cmpl-test",
        model: "test/chat-model",
        choices: [
          { index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function lastCall(spy: { mock: { calls: unknown[][] } }) {
  const call = spy.mock.calls[0] as unknown as [string, RequestInit];
  const [url, init] = call;
  return { url, init, body: JSON.parse(init.body as string) };
}

describe("chatCompletion() — destination, autorisation, corps", () => {
  test("appelle {LLM_BASE_URL}/chat/completions", async () => {
    const spy = stubFetchOk();
    await chatCompletion(getConfig(), [{ role: "user", content: "bonjour" }]);
    expect(lastCall(spy).url).toBe("http://llm.test/v1/chat/completions");
  });

  test("suit LLM_BASE_URL quand elle change — aucune constante en dur", async () => {
    const spy = stubFetchOk();
    await withEnv({ LLM_BASE_URL: "http://autre.test/v1" }, async () => {
      await chatCompletion(getConfig(), [{ role: "user", content: "x" }]);
    });
    expect(lastCall(spy).url).toBe("http://autre.test/v1/chat/completions");
  });

  test("envoie l'en-tête Bearer avec LLM_API_KEY", async () => {
    const spy = stubFetchOk();
    await chatCompletion(getConfig(), [{ role: "user", content: "x" }]);
    const headers = lastCall(spy).init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-key");
  });

  test("utilise LLM_MODEL_CHAT par défaut", async () => {
    const spy = stubFetchOk();
    await chatCompletion(getConfig(), [{ role: "user", content: "x" }]);
    expect(lastCall(spy).body.model).toBe("test/chat-model");
  });

  test("un modèle passé en option remplace celui de la configuration", async () => {
    // C'est le mécanisme dont dépend la vision : même chemin réseau,
    // modèle différent.
    const spy = stubFetchOk();
    await chatCompletion(getConfig(), [{ role: "user", content: "x" }], undefined, {
      model: process.env["LLM_MODEL_VISION"],
    });
    expect(lastCall(spy).body.model).toBe("test/vision-model");
  });

  test("transmet les messages tels quels", async () => {
    const spy = stubFetchOk();
    const messages = [
      { role: "system" as const, content: "règle" },
      { role: "user" as const, content: "question" },
    ];
    await chatCompletion(getConfig(), messages);
    expect(lastCall(spy).body.messages).toEqual(messages);
  });

  test("ajoute tool_choice=auto quand des outils sont fournis", async () => {
    const spy = stubFetchOk();
    await chatCompletion(
      getConfig(),
      [{ role: "user", content: "x" }],
      [{ type: "function", function: { name: "t", description: "d", parameters: {} } }],
    );
    expect(lastCall(spy).body.tool_choice).toBe("auto");
  });
});

// ─── transcribeAudio() — même base, endpoint audio ────────────────────────────

describe("transcribeAudio() — destination et modèle", () => {
  function stubSttOk() {
    const spy = vi.fn(async () =>
      new Response(JSON.stringify({ text: "bonjour" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  test("appelle {LLM_BASE_URL}/audio/transcriptions", async () => {
    const spy = stubSttOk();
    await transcribeAudio(Buffer.from("fake-audio"), "audio/webm");
    const [url] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://llm.test/v1/audio/transcriptions");
  });

  test("envoie le modèle LLM_MODEL_STT et l'en-tête Bearer", async () => {
    const spy = stubSttOk();
    await transcribeAudio(Buffer.from("fake-audio"), "audio/webm");
    const [, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-key");
    expect((init.body as FormData).get("model")).toBe("test/stt-model");
  });

  test("lève LlmConfigError nommant LLM_MODEL_STT quand elle est absente", async () => {
    stubSttOk();
    await withEnv({ LLM_MODEL_STT: undefined }, async () => {
      await expect(
        transcribeAudio(Buffer.from("x"), "audio/webm"),
      ).rejects.toThrow(/LLM_MODEL_STT/);
    });
  });
});

// ─── Confidentialité de la journalisation ─────────────────────────────────────

describe("journalisation — le contenu des messages ne fuit jamais", () => {
  test("aucun texte de message n'apparaît dans les journaux", async () => {
    stubFetchOk();
    const logged: string[] = [];
    vi.spyOn(console, "info").mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });

    const SECRET = "IBAN FR76 3000 1007 1234 5678 9012 345";
    await chatCompletion(getConfig(), [
      { role: "user", content: `Voici mon ${SECRET} et le chantier Pasteur` },
    ]);

    const all = logged.join("\n");
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain("Pasteur");
    // …mais le nom du modèle, lui, doit bien être journalisé.
    expect(all).toContain("test/chat-model");
  });
});
