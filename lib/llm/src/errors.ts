/**
 * Error types for the LiteLLM gateway.
 *
 * No SDK imports ever appear here — this package communicates with LiteLLM
 * exclusively through the OpenAI-compatible HTTP API via Node.js fetch.
 */

/** Thrown at startup when a required environment variable is absent. */
export class LlmConfigError extends Error {
  constructor(public readonly missingVar: string) {
    super(
      `LLM configuration error: environment variable "${missingVar}" is required but was not provided.`,
    );
    this.name = "LlmConfigError";
  }
}

/** Thrown when LiteLLM returns a non-2xx HTTP status. */
export class LlmNetworkError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`LiteLLM HTTP error ${status}`);
    this.name = "LlmNetworkError";
  }
}

/** Thrown when the response payload is structurally invalid. */
export class LlmResponseError extends Error {
  constructor(message: string) {
    super(`LiteLLM response error: ${message}`);
    this.name = "LlmResponseError";
  }
}
