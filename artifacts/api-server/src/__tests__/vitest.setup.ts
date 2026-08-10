/**
 * Vitest global setup — runs before every test file.
 *
 * What this does:
 *
 *  1. Injects fake LLM env vars so `getConfig()` (from @nodaq/llm) never
 *     throws `LlmConfigError` inside test code.  The actual values point to a
 *     non-existent server — that is intentional.
 *
 *  2. Patches `globalThis.fetch` to intercept calls to the fake LLM endpoint
 *     and return benign responses:
 *     - /chat/completions  → valid OpenAI-compatible chat completion
 *     - /audio/transcriptions → valid STT response
 *     All other fetch destinations are passed through to the real fetch.
 *
 * Why this is needed:
 *  The architecture routes all model traffic (chat, vision, STT) through a single
 *  LLM_BASE_URL.  Tests must not call any real provider, so we intercept all
 *  requests to FAKE_LLM_BASE and return minimal valid responses.
 */

import { randomBytes } from "node:crypto";

const FAKE_LLM_BASE = "http://fake-llm.internal.test";

// ── 1. Inject fake LLM env vars ───────────────────────────────────────────────
process.env["LLM_BASE_URL"]      = FAKE_LLM_BASE;
process.env["LLM_API_KEY"]       = "vitest-fake-key";
process.env["LLM_MODEL_CHAT"]    = "test/fake-chat-model";
process.env["LLM_MODEL_VISION"]  = "test/fake-vision-model";
process.env["LLM_MODEL_STT"]     = "test/fake-stt-model";

// ── 1 bis. Clé de chiffrement, ENGENDRÉE À CHAQUE EXÉCUTION ──────────────────
//
// Pas de constante : une clé écrite en dur dans le dépôt est une clé publiée,
// et une clé qui RESSEMBLE à une vraie finit copiée en production par quelqu'un
// de pressé. On en tire une au sort à chaque lancement — les tests n'ont besoin
// d'aucune stabilité entre exécutions, puisqu'ils écrivent et relisent dans la
// même vie de processus.
//
// `??=` et non `=` : une clé posée par l'appelant l'emporte, ce dont le test de
// rotation a besoin pour piloter les deux générations.
process.env["ENCRYPTION_KEY"] ??= randomBytes(32).toString("base64");

// ── 2. Intercept fetch calls to the fake LLM endpoint ────────────────────────
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

  if (url.startsWith(FAKE_LLM_BASE)) {
    // STT endpoint — return a minimal valid transcription response.
    if (url.endsWith("/audio/transcriptions")) {
      const body = JSON.stringify({ text: "transcription test (interceptée par vitest)" });
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Chat/vision endpoint — return a minimal, valid OpenAI-compatible response.
    //
    // Smart tool-call simulation: if the request body contains a user message
    // that asks to create a specific prospect ("Jean Dupont") AND there are no
    // pending tool-result messages yet, return a create_prospect tool call so
    // that agent integration tests can verify full tool execution without a
    // real LLM.  For all other requests, return a plain text response.
    let parsedBody: { messages?: Array<{ role: string; content: unknown }> } = {};
    try {
      parsedBody = JSON.parse(init?.body as string ?? "{}");
    } catch {
      // ignore parse errors — fall through to text response
    }
    const msgs = parsedBody.messages ?? [];
    const hasPendingToolResult = msgs.some((m) => m.role === "tool");
    const lastUserContent = [...msgs]
      .reverse()
      .find((m) => m.role === "user");
    const userText =
      typeof lastUserContent?.content === "string"
        ? lastUserContent.content.toLowerCase()
        : "";

    // Dictée de devis : le simulateur rend un DÉCOUPAGE (libellé, quantité,
    // unité) et JAMAIS de prix — exactement ce que le vrai modèle a le droit de
    // produire. Un simulateur qui renverrait un prix masquerait une régression :
    // la route doit rester incapable d'en faire passer un.
    if (userText.includes("cloison") || userText.includes("dictee-test")) {
      const decoupage = JSON.stringify({
        id: "chatcmpl-vitest-dictee",
        object: "chat.completion",
        model: "test/fake-chat-model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: JSON.stringify({
                intentions: [
                  { libelle: "Cloison BA13", quantite: 30, unite: "m2" },
                  { libelle: "Pose d'une veranda en aluminium", quantite: 1, unite: "u" },
                ],
              }),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 30, total_tokens: 50 },
      });
      return new Response(decoupage, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // create_prospect simulation: one round only (no pending tool result)
    if (!hasPendingToolResult && userText.includes("jean dupont")) {
      const toolCallBody = JSON.stringify({
        id: "chatcmpl-vitest-tool",
        object: "chat.completion",
        model: "test/fake-chat-model",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_vitest_jean_dupont",
                  type: "function",
                  function: {
                    name: "create_prospect",
                    arguments: JSON.stringify({
                      name: "Jean Dupont",
                      phone: "0612345678",
                    }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
      });
      return new Response(toolCallBody, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Default: plain text response — no tool calls, agent exits cleanly.
    const body = JSON.stringify({
      id: "chatcmpl-vitest",
      object: "chat.completion",
      model: "test/fake-chat-model",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Réponse de l'agent (mode test — LLM intercepté).",
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

  // All other destinations use the real fetch.
  return _originalFetch(input, init);
};
