/**
 * Error types for the Bridge (ex-Bankin') bank aggregation client.
 *
 * No provider SDK is ever imported here — this package talks to Bridge
 * exclusively through plain HTTP (Node.js fetch), same discipline as
 * `lib/llm` and `lib/plateforme-agreee`.
 */

/** Thrown at call time when a required environment variable is absent. */
export class BanqueConfigError extends Error {
  constructor(public readonly missingVar: string) {
    super(
      `Connecteur bancaire configuration error: environment variable "${missingVar}" is required but was not provided.`,
    );
    this.name = "BanqueConfigError";
  }
}

/** Thrown when Bridge returns a non-2xx HTTP status. */
export class BanqueNetworkError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Bridge HTTP error ${status}`);
    this.name = "BanqueNetworkError";
  }
}

/** Thrown when a Bridge response payload is structurally invalid. */
export class BanqueResponseError extends Error {
  constructor(message: string) {
    super(`Bridge response error: ${message}`);
    this.name = "BanqueResponseError";
  }
}
