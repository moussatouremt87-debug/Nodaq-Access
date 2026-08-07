/**
 * Vitest global setup — runs before every test file.
 *
 * What this does:
 *
 *  1. Injects fake LITELLM env vars so `getConfig()` (from @nodaq/llm) never
 *     throws `LlmConfigError` inside test code.  The actual values point to a
 *     non-existent server — that is intentional.
 *
 *  2. Patches `globalThis.fetch` to intercept calls to the fake LiteLLM
 *     endpoint and return a benign text-only assistant response.  This means
 *     `chatCompletion()` succeeds in test code without making real HTTP calls.
 *     All other fetch destinations (Mistral direct, external URLs) are passed
 *     through to the real fetch implementation so existing tests that check
 *     the upload route's 503 behaviour (MISTRAL_API_KEY absent) are unaffected.
 *
 * Why this is needed:
 *  The new architecture removed the @mistralai/mistralai SDK and replaced it
 *  with a plain-fetch LiteLLM client.  Existing adversarial tests that spied
 *  on `Mistral.prototype.chat.complete` now spy on a prototype that is never
 *  instantiated — those spies become harmless no-ops.  The security properties
 *  being tested (auth gate, injection isolation, DB state) are still fully
 *  exercised against a real PostgreSQL database.
 */

const FAKE_LITELLM_BASE = "http://fake-litellm.internal.test";

// ── 1. Inject fake LLM env vars ───────────────────────────────────────────────
process.env["LITELLM_BASE_URL"] = FAKE_LITELLM_BASE;
process.env["LITELLM_API_KEY"] = "vitest-fake-key";
process.env["LLM_MODEL"] = "test/fake-model";

// ── 2. Intercept fetch calls to the fake LiteLLM endpoint ────────────────────
const _originalFetch = globalThis.fetch;

globalThis.fetch = async function patchedFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : (input as Request).url;

  if (url.startsWith(FAKE_LITELLM_BASE)) {
    // Return a minimal, valid OpenAI-compatible chat completion response.
    // No tool_calls → runAgent exits after the first round with a text reply.
    const body = JSON.stringify({
      id: "chatcmpl-vitest",
      object: "chat.completion",
      model: "test/fake-model",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Réponse de l'agent (mode test — LiteLLM intercepté).",
            tool_calls: null,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 8,
        total_tokens: 18,
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // All other destinations (Mistral vision API, etc.) use the real fetch.
  return _originalFetch(input, init);
};
