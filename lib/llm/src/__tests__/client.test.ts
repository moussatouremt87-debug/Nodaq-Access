/**
 * Unit tests for @nodaq/llm client.ts
 *
 * Covers getConfig() precedence rules, defaults, and error surface,
 * plus chatCompletion()'s request shape (endpoint, auth header, body).
 *
 * All tests are pure unit tests — no real HTTP calls are made.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { getConfig, chatCompletion } from "../client.js";
import { LlmConfigError } from "../errors.js";

// ─── Env helpers ──────────────────────────────────────────────────────────────

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    saved[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

// ─── getConfig() — precedence and defaults ────────────────────────────────────

describe("getConfig() — key resolution", () => {
  test("uses LITELLM_API_KEY when both keys are present", () => {
    withEnv(
      {
        LITELLM_API_KEY: "litellm-key",
        MISTRAL_API_KEY: "mistral-key",
        LITELLM_BASE_URL: undefined,
        LLM_MODEL: undefined,
      },
      () => {
        const cfg = getConfig();
        expect(cfg.apiKey).toBe("litellm-key");
      },
    );
  });

  test("falls back to MISTRAL_API_KEY when LITELLM_API_KEY is absent", () => {
    withEnv(
      {
        LITELLM_API_KEY: undefined,
        MISTRAL_API_KEY: "mistral-fallback",
        LITELLM_BASE_URL: undefined,
        LLM_MODEL: undefined,
      },
      () => {
        const cfg = getConfig();
        expect(cfg.apiKey).toBe("mistral-fallback");
      },
    );
  });

  test("throws LlmConfigError('MISTRAL_API_KEY') when neither key is set", () => {
    withEnv(
      { LITELLM_API_KEY: undefined, MISTRAL_API_KEY: undefined },
      () => {
        expect(() => getConfig()).toThrow(LlmConfigError);
        expect(() => getConfig()).toThrow(/MISTRAL_API_KEY/);
      },
    );
  });
});

describe("getConfig() — baseUrl and model defaults", () => {
  test("defaults baseUrl to https://api.mistral.ai/v1 when LITELLM_BASE_URL is absent", () => {
    withEnv(
      {
        LITELLM_API_KEY: "any-key",
        LITELLM_BASE_URL: undefined,
        LLM_MODEL: undefined,
      },
      () => {
        const cfg = getConfig();
        expect(cfg.baseUrl).toBe("https://api.mistral.ai/v1");
      },
    );
  });

  test("uses LITELLM_BASE_URL and strips trailing slash", () => {
    withEnv(
      {
        LITELLM_API_KEY: "any-key",
        LITELLM_BASE_URL: "http://litellm.internal/",
        LLM_MODEL: undefined,
      },
      () => {
        const cfg = getConfig();
        expect(cfg.baseUrl).toBe("http://litellm.internal");
      },
    );
  });

  test("defaults model to mistral-large-latest when LLM_MODEL is absent", () => {
    withEnv(
      {
        LITELLM_API_KEY: "any-key",
        LITELLM_BASE_URL: undefined,
        LLM_MODEL: undefined,
      },
      () => {
        const cfg = getConfig();
        expect(cfg.model).toBe("mistral-large-latest");
      },
    );
  });

  test("uses LLM_MODEL when set", () => {
    withEnv(
      {
        LITELLM_API_KEY: "any-key",
        LITELLM_BASE_URL: undefined,
        LLM_MODEL: "gpt-4o",
      },
      () => {
        const cfg = getConfig();
        expect(cfg.model).toBe("gpt-4o");
      },
    );
  });
});

// ─── chatCompletion() — request shape ─────────────────────────────────────────

describe("chatCompletion() — endpoint, auth header, request body", () => {
  let originalFetch: typeof globalThis.fetch;
  let capturedRequest: { url: string; init: RequestInit } | null = null;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    capturedRequest = null;

    globalThis.fetch = async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url;
      capturedRequest = { url, init: init ?? {} };

      // Return a minimal valid completion
      return new Response(
        JSON.stringify({
          id: "test-id",
          model: "test-model",
          choices: [
            {
              message: { role: "assistant", content: "ok", tool_calls: null },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("posts to baseUrl/chat/completions", async () => {
    const cfg = { baseUrl: "http://proxy.test", apiKey: "k", model: "m" };
    await chatCompletion(cfg, [{ role: "user", content: "hi" }]);
    expect(capturedRequest?.url).toBe("http://proxy.test/chat/completions");
  });

  test("sends Bearer auth header with the configured apiKey", async () => {
    const cfg = { baseUrl: "http://proxy.test", apiKey: "secret-key-123", model: "m" };
    await chatCompletion(cfg, [{ role: "user", content: "hi" }]);
    const auth = (capturedRequest?.init.headers as Record<string, string>)?.["Authorization"];
    expect(auth).toBe("Bearer secret-key-123");
  });

  test("includes model and messages in request body", async () => {
    const cfg = { baseUrl: "http://proxy.test", apiKey: "k", model: "mistral-large-latest" };
    const messages = [{ role: "user" as const, content: "Bonjour" }];
    await chatCompletion(cfg, messages);
    const body = JSON.parse(capturedRequest?.init.body as string) as {
      model: string;
      messages: unknown[];
    };
    expect(body.model).toBe("mistral-large-latest");
    expect(body.messages).toHaveLength(1);
  });

  test("Mistral-direct fallback: calls api.mistral.ai when only MISTRAL_API_KEY is set", async () => {
    await withEnv(
      {
        LITELLM_API_KEY: undefined,
        MISTRAL_API_KEY: "real-mistral-key",
        LITELLM_BASE_URL: undefined,
        LLM_MODEL: undefined,
      },
      async () => {
        const cfg = getConfig();
        await chatCompletion(cfg, [{ role: "user", content: "test" }]);
        expect(capturedRequest?.url).toContain("api.mistral.ai");
        expect(
          (capturedRequest?.init.headers as Record<string, string>)?.["Authorization"],
        ).toBe("Bearer real-mistral-key");
      },
    );
  });

  test("LiteLLM path: calls configured proxy when LITELLM_API_KEY is set", async () => {
    await withEnv(
      {
        LITELLM_API_KEY: "litellm-token",
        MISTRAL_API_KEY: "should-not-be-used",
        LITELLM_BASE_URL: "http://litellm.proxy",
        LLM_MODEL: "openai/gpt-4o",
      },
      async () => {
        const cfg = getConfig();
        await chatCompletion(cfg, [{ role: "user", content: "test" }]);
        expect(capturedRequest?.url).toBe("http://litellm.proxy/chat/completions");
        expect(
          (capturedRequest?.init.headers as Record<string, string>)?.["Authorization"],
        ).toBe("Bearer litellm-token");
      },
    );
  });
});
