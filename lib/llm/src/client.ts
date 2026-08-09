/**
 * LLM gateway — thin fetch wrapper over the Scaleway OpenAI-compatible HTTP API.
 *
 * INVARIANT: this file never imports any provider SDK (openai, @mistralai/mistralai,
 * @anthropic-ai/sdk, …).  All communication is through standard Node.js fetch.
 * The anti-SDK lint/test gate enforces this invariant automatically.
 *
 * Single exit point: all model traffic (chat, vision, STT) is routed through
 * LLM_BASE_URL.  No default value — a missing variable fails loud with LlmConfigError.
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
  /**
   * Override the model for this single call (e.g. LLM_MODEL_VISION).
   * Falls back to config.model when absent.
   */
  model?: string;
}

// ─── Config resolution ────────────────────────────────────────────────────────

/**
 * Resolve LLM config from environment variables.
 *
 * Reads: LLM_BASE_URL, LLM_API_KEY, LLM_MODEL_CHAT.
 * No default values — every missing variable throws LlmConfigError.
 * A destination by default is precisely the defect we are fixing:
 * a configuration omission must never silently decide where data goes.
 */
export function getConfig(): LlmConfig {
  const baseUrl = process.env["LLM_BASE_URL"];
  if (!baseUrl) throw new LlmConfigError("LLM_BASE_URL");

  const apiKey = process.env["LLM_API_KEY"];
  if (!apiKey) throw new LlmConfigError("LLM_API_KEY");

  const model = process.env["LLM_MODEL_CHAT"];
  if (!model) throw new LlmConfigError("LLM_MODEL_CHAT");

  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey, model };
}

// ─── Core call ────────────────────────────────────────────────────────────────

/**
 * Call the OpenAI-compatible `/chat/completions` endpoint.
 *
 * Accepts an optional `options.model` that replaces `config.model` for this
 * single call — used by vision callers that pass LLM_MODEL_VISION.
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

  // Destructure model override out of options before spreading to avoid
  // setting model twice in the request body.
  const { model: modelOverride, ...restOptions } = options;
  const effectiveModel = modelOverride ?? config.model;

  const body: Record<string, unknown> = {
    model: effectiveModel,
    messages,
    ...restOptions,
  };
  if (tools && tools.length > 0) {
    body["tools"] = tools;
    body["tool_choice"] = restOptions.tool_choice ?? "auto";
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
        JSON.stringify({ model: effectiveModel, status: httpStatus, durationMs }),
      );
      throw new LlmNetworkError(res.status, errorBody);
    }

    const data = (await res.json()) as LlmResponse;

    console.info(
      "[llm] call ok",
      JSON.stringify({
        model: data.model ?? effectiveModel,
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
      JSON.stringify({ model: effectiveModel, status: httpStatus, durationMs }),
    );
    throw err;
  }
}

// ─── Audio transcription ──────────────────────────────────────────────────────

export interface TranscribeResult {
  text: string;
}

/**
 * Transcribe an audio buffer to text using the OpenAI-compatible
 * `/audio/transcriptions` endpoint.
 *
 * Base URL and API key come from LLM_BASE_URL / LLM_API_KEY (same as chat).
 * Model is LLM_MODEL_STT — throws LlmConfigError if absent.
 *
 * Logging records only: model name, duration (ms), HTTP status.
 * Audio content is NEVER logged.
 *
 * @param audioBuffer  Raw audio bytes (webm/opus, mp4/aac, wav, etc.)
 * @param mimeType     MIME type of the audio (e.g. "audio/webm;codecs=opus")
 * @param filename     Suggested filename (extension matters for Whisper)
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string,
  filename = "audio.webm",
): Promise<TranscribeResult> {
  const config = getConfig();

  const sttModel = process.env["LLM_MODEL_STT"];
  if (!sttModel) throw new LlmConfigError("LLM_MODEL_STT");

  const formData = new FormData();
  // Blob constructor accepts BufferSource; convert Buffer → Uint8Array for TypeScript.
  formData.append(
    "file",
    new Blob([new Uint8Array(audioBuffer)], { type: mimeType }),
    filename,
  );
  formData.append("model", sttModel);
  formData.append("language", "fr");
  formData.append("response_format", "json");

  const t0 = Date.now();
  let httpStatus = 0;

  const res = await fetch(`${config.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: formData,
  });

  httpStatus = res.status;
  const durationMs = Date.now() - t0;

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    console.info(
      "[llm:stt] call failed",
      JSON.stringify({ model: sttModel, status: httpStatus, durationMs }),
    );
    throw new LlmNetworkError(res.status, body);
  }

  console.info(
    "[llm:stt] call ok",
    JSON.stringify({ model: sttModel, status: httpStatus, durationMs }),
  );

  const json = (await res.json()) as { text?: string };
  const text = (json.text ?? "").trim();
  if (!text) throw new LlmResponseError("STT returned empty transcription");
  return { text };
}
