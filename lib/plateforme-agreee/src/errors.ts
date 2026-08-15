/**
 * Error types for the plateforme agréée (PA) exchange client.
 *
 * No provider SDK is ever imported here — this package talks to the PA
 * exclusively through plain HTTP (Node.js fetch), same discipline as
 * `lib/llm`. The exact request/response shapes below are PROVISOIRE: aucune
 * PA n'est contractée à ce jour (US-A2.6) — voir `client.ts` pour le détail.
 */

/** Thrown at call time when a required environment variable is absent. */
export class PaConfigError extends Error {
  constructor(public readonly missingVar: string) {
    super(
      `Plateforme agréée configuration error: environment variable "${missingVar}" is required but was not provided.`,
    );
    this.name = "PaConfigError";
  }
}

/** Thrown when the PA returns a non-2xx HTTP status. */
export class PaNetworkError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`Plateforme agréée HTTP error ${status}`);
    this.name = "PaNetworkError";
  }
}

/** Thrown when a PA response payload is structurally invalid. */
export class PaResponseError extends Error {
  constructor(message: string) {
    super(`Plateforme agréée response error: ${message}`);
    this.name = "PaResponseError";
  }
}
