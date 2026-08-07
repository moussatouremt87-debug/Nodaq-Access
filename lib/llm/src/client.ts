/**
 * LiteLLM gateway — thin fetch wrapper over the OpenAI-compatible HTTP API.
 *
 * INVARIANT: this file never imports any provider SDK (openai, @mistralai/mistralai,
 * @anthropic-ai/sdk, …).  All communication is through standard Node.js fetch.
 * The anti-SDK lint/test gate enforces this invariant automatically.
 */

import { LlmConfigError, LlmNetworkError, LlmResponseError } from "./errors.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** A single part of a multimodal content array (text or image). */
export type LlmContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  /** String for text-only messages; array for multimodal (vision) messages. */
  content: string | LlmContentPart[] | null;
  /** Present on assistant messages that triggered tool calls. */
  tool_calls?: LlmToolCall[];
  /** Present on tool-result messages. */
  tool_call_id?: string;
}

export interface LlmToolFunction {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export interface LlmTool {
  type: "function";
  function: LlmToolFunction;
}

export interface LlmToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface LlmUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface LlmChoice {
  message: {
    role: string;
    content: string | null;
    tool_calls?: LlmToolCall[];
  };
  finish_reason: string;
}

export interface LlmResponse {
  choices: LlmChoice[];
  usage?: LlmUsage;
  model: string;
}

export interface ChatCompletionOptions {
  tool_choice?: "auto" | "none" | "required";
  temperature?: number;
  response_format?: { type: "json_object" } | { type: "text" };
  /** Maximum number of tokens in the completion. */
  max_tokens?: number;
}

// ─── Config resolution ────────────────────────────────────────────────────────

/**
 * Resolve LLM config from environment variables.
 * Throws `LlmConfigError` naming the exact missing variable — never its value.
 */
export function getConfig(): LlmConfig {
  const baseUrl = process.env["LITELLM_BASE_URL"];
  if (!baseUrl) throw new LlmConfigError("LITELLM_BASE_URL");

  const apiKey = process.env["LITELLM_API_KEY"];
  if (!apiKey) throw new LlmConfigError("LITELLM_API_KEY");

  const model = process.env["LLM_MODEL"];
  if (!model) throw new LlmConfigError("LLM_MODEL");

  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, model };
}

// ─── Core call ────────────────────────────────────────────────────────────────

/**
 * Call LiteLLM's OpenAI-compatible `/chat/completions` endpoint.
 *
 * Logging records only: model name, duration (ms), token counts, HTTP status.
 * Message content is NEVER logged.
 */
export async function chatCompletion(
  config: LlmConfig,
  messages: LlmMessage[],
  tools?: LlmTool[],
  options: ChatCompletionOptions = {},
): Promise<LlmResponse> {
  const t0 = Date.now();

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    ...options,
  };
  if (tools && tools.length > 0) {
    body["tools"] = tools;
    body["tool_choice"] = options.tool_choice ?? "auto";
  }

  let httpStatus = 0;
  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    httpStatus = res.status;
    const durationMs = Date.now() - t0;

    if (!res.ok) {
      const errorBody = await res.text().catch(() => "(no body)");
      console.info(
        "[llm] call failed",
        JSON.stringify({ model: config.model, status: httpStatus, durationMs }),
      );
      throw new LlmNetworkError(res.status, errorBody);
    }

    const data = (await res.json()) as LlmResponse;

    console.info(
      "[llm] call ok",
      JSON.stringify({
        model: data.model ?? config.model,
        status: httpStatus,
        durationMs,
        tokens_prompt: data.usage?.prompt_tokens ?? null,
        tokens_completion: data.usage?.completion_tokens ?? null,
      }),
    );

    if (!Array.isArray(data.choices) || data.choices.length === 0) {
      throw new LlmResponseError("response has no choices");
    }

    return data;
  } catch (err) {
    if (err instanceof LlmNetworkError || err instanceof LlmResponseError) throw err;
    const durationMs = Date.now() - t0;
    console.info(
      "[llm] call error",
      JSON.stringify({ model: config.model, status: httpStatus, durationMs }),
    );
    throw err;
  }
}

/**
 * Convenience: call Pixtral (or any vision model) at a Mistral-direct endpoint
 * using MISTRAL_API_KEY.  No SDK — plain fetch to the Mistral v1 API.
 *
 * This helper is intentionally separate from `chatCompletion` because Pixtral
 * uses the direct Mistral API key (not the LiteLLM proxy) and does not go
 * through the classifier.
 */
export async function mistralVisionCompletion(
  messages: LlmMessage[],
  options: ChatCompletionOptions = {},
): Promise<LlmResponse> {
  const apiKey = process.env["MISTRAL_API_KEY"];
  if (!apiKey) throw new LlmConfigError("MISTRAL_API_KEY");

  const model = process.env["PIXTRAL_MODEL"] ?? "pixtral-12b-2409";
  const t0 = Date.now();
  let httpStatus = 0;

  const res = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, ...options }),
  });

  httpStatus = res.status;
  const durationMs = Date.now() - t0;

  if (!res.ok) {
    const errorBody = await res.text().catch(() => "(no body)");
    console.info(
      "[llm:pixtral] call failed",
      JSON.stringify({ model, status: httpStatus, durationMs }),
    );
    throw new LlmNetworkError(res.status, errorBody);
  }

  const data = (await res.json()) as LlmResponse;
  console.info(
    "[llm:pixtral] call ok",
    JSON.stringify({
      model: data.model ?? model,
      status: httpStatus,
      durationMs,
      tokens_prompt: data.usage?.prompt_tokens ?? null,
      tokens_completion: data.usage?.completion_tokens ?? null,
    }),
  );

  return data;
}
